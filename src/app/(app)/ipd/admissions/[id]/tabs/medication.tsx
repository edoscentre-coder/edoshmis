import { randomUUID } from "node:crypto";
import { AlertTriangle, Pill, Plus, ShieldCheck } from "lucide-react";
import { Badge, Card, CardHeader, Disclosure, EmptyState, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { ActionForm } from "@/components/ui/action-form";
import { can } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime, fmtTime, hoursAgoIso, nairobiLocalInput, nowMs, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { discontinueOrder, markDoseError, prescribe, recordDose } from "../../../actions";
import type { Ctx } from "../context";

interface Order {
  id: string;
  drug_id: string | null;
  drug_name: string;
  dose: number;
  dose_unit: string;
  route: string;
  frequency: string;
  schedule_times: string[];
  is_prn: boolean;
  prn_indication: string | null;
  prn_max_doses_per_day: number | null;
  start_at: string;
  end_at: string | null;
  instructions: string | null;
  reconciliation: string;
  status: string;
  prescribed_at: string;
  allergy_override_reason: string | null;
  interaction_override_reason: string | null;
  verify_note: string | null;
  discontinue_reason: string | null;
  prescriber: { full_name: string } | null;
  verifier: { full_name: string } | null;
  edoshmis_drugs: { is_controlled: boolean } | null;
}
interface Slot {
  id: string;
  order_id: string;
  scheduled_for: string | null;
  status: string;
  administered_at: string | null;
  dose_given: string | null;
  reason: string | null;
  entered_in_error: boolean;
  giver: { full_name: string } | null;
  witness: { full_name: string } | null;
}

const STATUS_TONE: Record<string, string> = {
  scheduled: "border-line-strong bg-surface text-ink-soft",
  administered: "border-positive/40 bg-positive-soft text-positive-ink",
  delayed: "border-attention/40 bg-attention-soft text-attention-ink",
  missed: "border-critical/40 bg-critical-soft text-critical-ink",
  refused: "border-attention/40 bg-attention-soft text-attention-ink",
  withheld: "border-info/40 bg-info-soft text-info-ink",
  discontinued: "border-line bg-surface-sunk text-ink-faint",
};

/**
 * Medication orders and the eMAR. Orders flow prescribed → verified by
 * pharmacy → given; until pharmacy verifies, the eMAR shows the order but
 * offers nothing to record. Each due dose is its own slot: administered
 * (time, by whom, witness for controlled drugs) or not, with the reason.
 */
export async function MedicationTab({ ctx }: { ctx: Ctx }) {
  const { s, admission: a, open } = ctx;
  const supabase = await createClient();
  if (open) await supabase.rpc("edoshmis_generate_mar", { p_admission: a.id, p_hours: 24 });

  const [{ data: orders }, { data: slots }, drugs, staff] = await Promise.all([
    supabase
      .from("edoshmis_medication_orders")
      .select("*, prescriber:edoshmis_staff!edoshmis_medication_orders_prescribed_by_fkey(full_name), verifier:edoshmis_staff!edoshmis_medication_orders_verified_by_fkey(full_name), edoshmis_drugs(is_controlled)")
      .eq("admission_id", a.id)
      .order("prescribed_at", { ascending: false }),
    supabase
      .from("edoshmis_medication_administrations")
      .select("id, order_id, scheduled_for, status, administered_at, dose_given, reason, entered_in_error, giver:edoshmis_staff!edoshmis_medication_administrations_administered_by_fkey(full_name), witness:edoshmis_staff!edoshmis_medication_administrations_witness_id_fkey(full_name)")
      .eq("admission_id", a.id)
      .or(`scheduled_for.gte.${hoursAgoIso(36)},scheduled_for.is.null`)
      .order("scheduled_for", { ascending: true, nullsFirst: false })
      .order("administered_at", { ascending: true }),
    can(s, "meds.prescribe") ? supabase.from("edoshmis_drugs").select("id, generic_name, strength, form, default_route, is_controlled").eq("is_active", true).order("generic_name") : Promise.resolve({ data: null }),
    can(s, "meds.administer") ? supabase.from("edoshmis_staff").select("id, full_name").eq("organization_id", s.staff.organizationId).eq("status", "active").neq("id", s.staff.id).order("full_name") : Promise.resolve({ data: null }),
  ]);
  const list = (orders ?? []) as unknown as Order[];
  const marBy = new Map<string, Slot[]>();
  for (const x of (slots ?? []) as unknown as Slot[]) (marBy.get(x.order_id) ?? marBy.set(x.order_id, []).get(x.order_id)!).push(x);
  const active = list.filter((o) => ["prescribed", "verified", "on_hold"].includes(o.status));
  const past = list.filter((o) => !["prescribed", "verified", "on_hold"].includes(o.status));
  const give = can(s, "meds.administer") && open;
  const now = nowMs();

  return (
    <div className="flex flex-col gap-5">
      {can(s, "meds.prescribe") && open && (
        <Disclosure label="Prescribe" icon={Plus} variant="primary" size="md">
          <ActionForm action={prescribe.bind(null, a.id)} submitLabel="Prescribe" resetOnSuccess>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Drug (catalogue)" className="sm:col-span-2" hint={drugs.data?.length ? undefined : "The pharmacy has not added drugs yet — type the name instead"}>
                <Select name="drug_id" defaultValue="">
                  <option value="">— Not in catalogue —</option>
                  {drugs.data?.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.generic_name} {d.strength ?? ""} · {d.form}
                      {d.is_controlled ? " · controlled" : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="…or drug name" className="sm:col-span-2" hint="Only when not in the catalogue (no allergy class or interaction check)">
                <Input name="drug_name" />
              </Field>
              <Field label="Dose" required>
                <Input name="dose" inputMode="decimal" required />
              </Field>
              <Field label="Unit" required>
                <Select name="dose_unit" defaultValue="mg">
                  {["mg", "g", "mcg", "ml", "units", "iu", "mmol", "tablet", "capsule", "puff", "drop", "sachet", "other"].map((u) => (
                    <option key={u}>{u}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Route" required>
                <Select name="route" defaultValue="oral">
                  {["oral", "iv", "im", "sc", "sl", "pr", "pv", "topical", "inhaled", "nebulised", "ng", "ophthalmic", "otic", "nasal", "other"].map((r) => (
                    <option key={r} value={r}>
                      {r.toUpperCase()}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Frequency" required>
                <Select name="frequency" defaultValue="bd">
                  {[["od", "OD — once daily"], ["bd", "BD — twice daily"], ["tds", "TDS — three times"], ["qds", "QDS — four times"], ["q4h", "4-hourly"], ["q6h", "6-hourly"], ["q8h", "8-hourly"], ["q12h", "12-hourly"], ["nocte", "Nocte"], ["mane", "Mane"], ["weekly", "Weekly"], ["stat", "STAT — once now"], ["prn", "PRN — as needed"], ["custom", "Custom times"]].map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Due times" hint="Ward times, e.g. 06:00, 14:00, 22:00. Not for PRN/STAT." className="sm:col-span-2">
                <Input name="schedule_times" placeholder="06:00, 18:00" />
              </Field>
              <Field label="PRN for" hint="Required for PRN">
                <Input name="prn_indication" placeholder="e.g. Pain > 4/10" />
              </Field>
              <Field label="PRN max / 24 h">
                <Input name="prn_max_doses_per_day" inputMode="numeric" />
              </Field>
              <Field label="Start">
                <Input name="start_at" type="datetime-local" defaultValue={nairobiLocalInput()} />
              </Field>
              <Field label="Stop (optional)">
                <Input name="end_at" type="datetime-local" />
              </Field>
              <Field label="Reconciliation">
                <Select name="reconciliation" defaultValue="new">
                  <option value="new">New in hospital</option>
                  <option value="continued_from_home">Continued from home</option>
                  <option value="changed_from_home">Changed from home dose</option>
                </Select>
              </Field>
              <Field label="Instructions" className="sm:col-span-2 lg:col-span-3">
                <Input name="instructions" placeholder="e.g. After food; check BP before" />
              </Field>
              <Field label="Allergy override reason" hint="Only if warned" className="sm:col-span-2">
                <Input name="allergy_override_reason" />
              </Field>
              <Field label="Interaction override reason" hint="Only if warned" className="sm:col-span-2">
                <Input name="interaction_override_reason" />
              </Field>
            </div>
          </ActionForm>
        </Disclosure>
      )}

      <Card>
        <CardHeader title={`Medication chart · ${active.length} active`} icon={Pill} description="Doses from yesterday through the next 24 hours" />
        {active.length === 0 ? (
          <EmptyState icon={Pill} title="No active medication" />
        ) : (
          <ul className="divide-y divide-line">
            {active.map((o) => {
              const mar = marBy.get(o.id) ?? [];
              const controlled = o.edoshmis_drugs?.is_controlled;
              return (
                <li key={o.id} className="px-4 py-4 sm:px-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {o.drug_name} {controlled && <Badge tone="attention">Controlled</Badge>}
                      </p>
                      <p className="text-sm text-ink-soft">
                        {Number(o.dose)} {o.dose_unit} · {o.route.toUpperCase()} · {o.frequency.toUpperCase()}
                        {o.is_prn && o.prn_indication ? ` for ${o.prn_indication}` : ""}
                        {o.prn_max_doses_per_day ? ` · max ${o.prn_max_doses_per_day}/24 h` : ""}
                      </p>
                      <p className="text-xs text-ink-faint">
                        {o.prescriber?.full_name} · {fmtDateTime(o.prescribed_at)}
                        {o.instructions ? ` · ${o.instructions}` : ""}
                        {o.reconciliation !== "new" ? ` · ${titleCase(o.reconciliation)}` : ""}
                      </p>
                      {(o.allergy_override_reason || o.interaction_override_reason) && (
                        <p className="mt-1 flex items-start gap-1 text-xs text-attention-ink">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                          Prescribed despite warning: {[o.allergy_override_reason, o.interaction_override_reason].filter(Boolean).join("; ")}
                        </p>
                      )}
                    </div>
                    <span className="flex items-center gap-1.5">
                      {o.status === "prescribed" ? (
                        <Badge tone="attention">Awaiting pharmacy</Badge>
                      ) : (
                        <Badge tone="positive">
                          <ShieldCheck className="h-3 w-3" aria-hidden="true" /> Verified{o.verifier ? ` · ${o.verifier.full_name}` : ""}
                        </Badge>
                      )}
                      {can(s, "meds.prescribe") && open && (
                        <Disclosure label="Stop" variant="ghost">
                          <ActionForm action={discontinueOrder.bind(null, o.id)} submitLabel="Discontinue" submitVariant="danger">
                            <Field label="Reason" required>
                              <Input name="reason" required />
                            </Field>
                          </ActionForm>
                        </Disclosure>
                      )}
                    </span>
                  </div>

                  {/* eMAR row */}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {mar.length === 0 && !o.is_prn && o.frequency !== "stat" && (
                      <span className="text-xs text-ink-faint">{o.status === "prescribed" ? "Doses appear once pharmacy verifies." : "No doses due in this window."}</span>
                    )}
                    {mar.map((m) => {
                      const due = m.scheduled_for ? new Date(m.scheduled_for).getTime() : null;
                      const late = m.status === "scheduled" && due !== null && due < now - 3600_000;
                      return (
                        <div key={m.id} className={cn("min-w-[118px] rounded-lg border px-2.5 py-2 text-xs", STATUS_TONE[m.status], late && "border-critical/50 bg-critical-soft/60 text-critical-ink", m.entered_in_error && "line-through opacity-60")}>
                          <p className="tnum font-semibold">{m.scheduled_for ? `${fmtDateTime(m.scheduled_for)}` : "PRN / STAT"}</p>
                          <p>
                            {late ? "Overdue" : titleCase(m.status)}
                            {m.administered_at ? ` ${fmtTime(m.administered_at)}` : ""}
                          </p>
                          {m.giver && <p className="truncate text-[11px] opacity-80">{m.giver.full_name}{m.witness ? ` · w/ ${m.witness.full_name}` : ""}</p>}
                          {m.reason && <p className="text-[11px] opacity-80">{m.reason}</p>}
                          {give && o.status === "verified" && (m.status === "scheduled" || m.status === "delayed") && (
                            <Disclosure label="Record" variant="secondary" className="mt-1.5">
                              <DoseForm slot={m.id} order={null} controlled={Boolean(controlled)} staff={staff.data ?? []} />
                            </Disclosure>
                          )}
                          {give && !m.entered_in_error && m.status !== "scheduled" && m.status !== "discontinued" && (
                            <Disclosure label="Error" variant="ghost" className="mt-1">
                              <ActionForm action={markDoseError.bind(null, m.id)} submitLabel="Mark in error" submitVariant="danger">
                                <Field label="Reason" required>
                                  <Input name="reason" required />
                                </Field>
                              </ActionForm>
                            </Disclosure>
                          )}
                        </div>
                      );
                    })}
                    {give && o.status === "verified" && (o.is_prn || o.frequency === "stat") && (
                      <Disclosure label={o.is_prn ? "Give PRN dose" : "Give STAT dose"} variant="primary">
                        <DoseForm slot={null} order={o.id} controlled={Boolean(controlled)} staff={staff.data ?? []} />
                      </Disclosure>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {past.length > 0 && (
        <Card>
          <CardHeader title={`Stopped and completed · ${past.length}`} />
          <ul className="divide-y divide-line">
            {past.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm text-ink-soft">
                <span>
                  {o.drug_name} {Number(o.dose)} {o.dose_unit} {o.route.toUpperCase()} {o.frequency.toUpperCase()}
                  {(o.discontinue_reason || o.verify_note) && <span className="block text-xs text-ink-faint">{o.discontinue_reason ?? o.verify_note}</span>}
                </span>
                <Badge tone={o.status === "rejected" ? "critical" : "neutral"}>{o.status === "rejected" ? "Not verified by pharmacy" : titleCase(o.status)}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function DoseForm({ slot, order, controlled, staff }: { slot: string | null; order: string | null; controlled: boolean; staff: { id: string; full_name: string }[] }) {
  return (
    <ActionForm action={recordDose.bind(null, slot, order)} submitLabel="Save" className="min-w-[240px] text-ink">
      <input type="hidden" name="client_id" value={randomUUID()} />
      <Field label="Outcome">
        <Select name="status" defaultValue="administered">
          <option value="administered">Given</option>
          <option value="delayed">Delayed (will give)</option>
          <option value="refused">Refused by patient</option>
          <option value="withheld">Withheld (clinical reason)</option>
          <option value="missed">Missed</option>
        </Select>
      </Field>
      <Field label="Time given">
        <Input name="administered_at" type="datetime-local" defaultValue={nairobiLocalInput()} />
      </Field>
      <Field label="Dose given" hint="Defaults to the prescribed dose">
        <Input name="dose_given" />
      </Field>
      {controlled && (
        <Field label="Witness" required hint="Controlled drug — a second staff member">
          <Select name="witness_id" defaultValue="">
            <option value="">Choose</option>
            {staff.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Reason" hint="Required if not given">
        <Textarea name="reason" className="min-h-14" />
      </Field>
    </ActionForm>
  );
}
