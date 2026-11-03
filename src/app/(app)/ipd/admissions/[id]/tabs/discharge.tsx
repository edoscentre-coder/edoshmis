import { Check, Circle, DoorOpen } from "lucide-react";
import { PrintButton } from "@/components/ui/print-button";
import { Badge, Card, CardBody, CardHeader, Disclosure, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { ActionForm } from "@/components/ui/action-form";
import { can } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, fmtDateTime, fullName, ksh, nairobiLocalInput, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { authoriseDischarge, cancelDischarge, clearDischarge, dischargeStep, initiateDischarge, saveDischargeSummary } from "../../../actions";
import type { Ctx } from "../context";

const TYPES = [
  ["routine", "Routine discharge"],
  ["against_medical_advice", "Against medical advice"],
  ["transfer_out", "Transfer to another facility"],
  ["death", "Death in hospital"],
  ["absconded", "Absconded"],
] as const;

/**
 * Discharge as a checklist the database enforces: every step names who did
 * it and when, and "Authorise" stays refused until all are done. Only then
 * is the bed released and the admission closed.
 */
export async function DischargeTab({ ctx }: { ctx: Ctx }) {
  const { s, admission: a, patient: p } = ctx;
  const supabase = await createClient();
  const { data: dc } = await supabase
    .from("edoshmis_discharges")
    .select(
      "*, initiator:edoshmis_staff!edoshmis_discharges_initiated_by_fkey(full_name), summ:edoshmis_staff!edoshmis_discharges_summary_completed_by_fkey(full_name), recon:edoshmis_staff!edoshmis_discharges_meds_reconciled_by_fkey(full_name), inv:edoshmis_staff!edoshmis_discharges_investigations_reviewed_by_fkey(full_name), auth:edoshmis_staff!edoshmis_discharges_authorised_by_fkey(full_name), edoshmis_discharge_clearances(kind, status, note, cleared_at, clearer:edoshmis_staff!edoshmis_discharge_clearances_cleared_by_fkey(full_name))",
    )
    .eq("admission_id", a.id)
    .neq("status", "cancelled")
    .maybeSingle();

  if (!dc) {
    if (a.status !== "active" || !can(s, "discharge.initiate")) {
      return <Card><CardBody className="text-sm text-ink-faint">No discharge in progress.</CardBody></Card>;
    }
    return (
      <Card className="max-w-xl">
        <CardHeader title="Start discharge" icon={DoorOpen} description="The patient keeps the bed until the discharge is authorised." />
        <CardBody>
          <ActionForm action={initiateDischarge.bind(null, a.id)} submitLabel="Start discharge">
            <Field label="Type" required>
              <Select name="discharge_type" defaultValue="routine">
                {TYPES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Destination">
              <Input name="destination" placeholder="Home, receiving facility, mortuary…" />
            </Field>
            <Field label="Time of death" hint="Only for a death in hospital">
              <Input name="time_of_death" type="datetime-local" />
            </Field>
            <Field label="Cause of death (as certified)">
              <Input name="cause_of_death" />
            </Field>
          </ActionForm>
        </CardBody>
      </Card>
    );
  }

  const [{ data: bal }, { data: finalDx }] = await Promise.all([
    can(s, "billing.read", "discharge.authorize") ? supabase.from("edoshmis_account_balances").select("balance").eq("admission_id", a.id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("edoshmis_diagnoses").select("description, icd10_code, rank").eq("admission_id", a.id).eq("kind", "final").eq("status", "active").order("rank"),
  ]);
  const d = dc as Record<string, unknown> & {
    id: string; status: string; discharge_type: string; initiated_at: string; summary_completed_at: string | null; meds_reconciled_at: string | null;
    investigations_reviewed_at: string | null; authorised_at: string | null; discharged_at: string | null;
    initiator: { full_name: string } | null; summ: { full_name: string } | null; recon: { full_name: string } | null; inv: { full_name: string } | null; auth: { full_name: string } | null;
    edoshmis_discharge_clearances: { kind: string; status: string; note: string | null; cleared_at: string | null; clearer: { full_name: string } | null }[];
  };
  const v = (k: string) => (d[k] as string | null) ?? "";
  const open = d.status === "initiated";
  const clinician = can(s, "discharge.initiate") && open;
  const clearance = (k: string) => d.edoshmis_discharge_clearances.find((c) => c.kind === k);
  const allDone =
    d.summary_completed_at && d.meds_reconciled_at && d.investigations_reviewed_at && d.edoshmis_discharge_clearances.every((c) => c.status !== "pending");

  if (d.status === "authorised") {
    return (
      <Card className="max-w-3xl print:border-0 print:shadow-none">
        <CardHeader
          title="Discharge summary"
          description={`${titleCase(d.discharge_type)} · authorised by ${d.auth?.full_name} ${fmtDateTime(d.authorised_at)}`}
          actions={
            <PrintButton />
          }
        />
        <CardBody className="flex flex-col gap-3 text-sm">
          <p className="tnum text-xs text-ink-soft">
            {fullName(p)} · {p.hospital_number} · {a.admission_number} · admitted {fmtDateTime(a.admitted_at)} · discharged {fmtDateTime(d.discharged_at)}
          </p>
          <Block label="Final diagnosis">{finalDx?.map((x) => `${x.description}${x.icd10_code ? ` (${x.icd10_code})` : ""}${x.rank === "secondary" ? " — secondary" : ""}`).join("\n")}</Block>
          <Block label="Hospital course">{v("hospital_course")}</Block>
          <Block label="Treatment received">{v("treatment_received")}</Block>
          <Block label="Procedures">{v("procedures_performed")}</Block>
          <Block label="Investigations">{v("investigation_summary")}</Block>
          <Block label="Condition at discharge">{v("condition_at_discharge")}</Block>
          <Block label="Medication on discharge">{v("discharge_medications")}</Block>
          <Block label="Instructions to patient">{v("patient_instructions")}</Block>
          <Block label="Follow-up">{[v("follow_up_date") && fmtDate(v("follow_up_date")), v("follow_up_with")].filter(Boolean).join(" · ")}</Block>
          <Block label="Referral">{[v("referral_to"), v("referral_reason")].filter(Boolean).join(" — ")}</Block>
          {d.discharge_type === "death" && <Block label="Death">{`${fmtDateTime(v("time_of_death"))} · ${v("cause_of_death")}`}</Block>}
          <Block label="Destination">{v("destination")}</Block>
          <p className="mt-2 text-xs text-ink-faint">Summary by {d.summ?.full_name} · medication reconciled by {d.recon?.full_name} · authorised by {d.auth?.full_name}</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <div className="flex min-w-0 flex-col gap-5">
        <Card>
          <CardHeader title={`Discharge summary — ${titleCase(d.discharge_type)}`} description={`Started by ${d.initiator?.full_name} ${fmtDateTime(d.initiated_at)}`} />
          <CardBody>
            {clinician ? (
              <ActionForm
                action={saveDischargeSummary.bind(null, d.id)}
                submitLabel="Save and mark complete"
                resetOnSuccess={false}
                footer={
                  <button type="submit" name="intent" value="save" className="text-sm text-ink-soft hover:text-ink">
                    Save draft
                  </button>
                }
              >
                <p className="rounded-lg bg-surface-sunk px-3 py-2 text-xs text-ink-soft">
                  Final diagnosis:{" "}
                  {finalDx?.length ? finalDx.map((x) => x.description).join("; ") : <span className="text-attention-ink">none yet — add it on the Diagnosis tab (certainty: final)</span>}
                </p>
                <Field label="Hospital course" required>
                  <Textarea name="hospital_course" defaultValue={v("hospital_course")} className="min-h-28" />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Treatment received">
                    <Textarea name="treatment_received" defaultValue={v("treatment_received")} className="min-h-16" />
                  </Field>
                  <Field label="Procedures performed">
                    <Textarea name="procedures_performed" defaultValue={v("procedures_performed")} className="min-h-16" />
                  </Field>
                  <Field label="Investigation results">
                    <Textarea name="investigation_summary" defaultValue={v("investigation_summary")} className="min-h-16" />
                  </Field>
                  <Field label="Condition at discharge" required>
                    <Textarea name="condition_at_discharge" defaultValue={v("condition_at_discharge")} className="min-h-16" />
                  </Field>
                  <Field label="Medication on discharge">
                    <Textarea name="discharge_medications" defaultValue={v("discharge_medications")} className="min-h-16" />
                  </Field>
                  <Field label="Instructions to patient">
                    <Textarea name="patient_instructions" defaultValue={v("patient_instructions")} className="min-h-16" />
                  </Field>
                  <Field label="Follow-up date">
                    <Input name="follow_up_date" type="date" defaultValue={v("follow_up_date")} />
                  </Field>
                  <Field label="Follow-up with">
                    <Input name="follow_up_with" defaultValue={v("follow_up_with")} placeholder="e.g. Medical clinic" />
                  </Field>
                  <Field label="Referred to">
                    <Input name="referral_to" defaultValue={v("referral_to")} />
                  </Field>
                  <Field label="Referral reason">
                    <Input name="referral_reason" defaultValue={v("referral_reason")} />
                  </Field>
                  <Field label="Destination">
                    <Input name="destination" defaultValue={v("destination")} />
                  </Field>
                  {d.discharge_type === "death" && (
                    <Field label="Cause of death (as certified)" required>
                      <Input name="cause_of_death" defaultValue={v("cause_of_death")} />
                    </Field>
                  )}
                </div>
              </ActionForm>
            ) : (
              <p className="text-sm text-ink-soft">{v("hospital_course") || "The summary is being written by the clinical team."}</p>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="flex min-w-0 flex-col gap-5 lg:sticky lg:top-20 lg:self-start">
        <Card>
          <CardHeader title="Checklist" />
          <ol className="flex flex-col divide-y divide-line">
            <Step done={!!d.summary_completed_at} label="Discharge summary" by={d.summ?.full_name} at={d.summary_completed_at} />
            <Step done={!!d.meds_reconciled_at} label="Medication reconciliation" by={d.recon?.full_name} at={d.meds_reconciled_at}>
              {clinician && !d.meds_reconciled_at && (
                <Disclosure label="Confirm" variant="secondary">
                  <ActionForm action={dischargeStep.bind(null, d.id, "meds_reconciled")} submitLabel="Reconciled">
                    <p className="text-xs text-ink-soft">Every inpatient order has been stopped or carried into the discharge medication list.</p>
                    <Field label="Note" hint="e.g. 'No discharge medication' if none">
                      <Input name="note" />
                    </Field>
                  </ActionForm>
                </Disclosure>
              )}
            </Step>
            <Step done={!!d.investigations_reviewed_at} label="Investigations reviewed" by={d.inv?.full_name} at={d.investigations_reviewed_at}>
              {clinician && !d.investigations_reviewed_at && (
                <Disclosure label="Confirm" variant="secondary">
                  <ActionForm action={dischargeStep.bind(null, d.id, "investigations_reviewed")} submitLabel="Reviewed">
                    <Field label="Outstanding results / note">
                      <Input name="note" placeholder="e.g. Culture pending — clinic to follow up" />
                    </Field>
                  </ActionForm>
                </Disclosure>
              )}
            </Step>
            {(["billing", "pharmacy", "nursing"] as const).map((k) => {
              const c = clearance(k);
              const mine = can(s, `discharge.clear_${k}`) && open;
              return (
                <Step
                  key={k}
                  done={!!c && c.status !== "pending"}
                  label={`${titleCase(k)} clearance${c && c.status !== "pending" && c.status !== "cleared" ? ` — ${titleCase(c.status)}` : ""}`}
                  by={c?.clearer?.full_name}
                  at={c?.cleared_at ?? null}
                  note={c?.note ?? (k === "billing" && bal ? `Balance ${ksh(bal.balance)}` : undefined)}
                >
                  {mine && (
                    <Disclosure label={c?.status === "pending" ? "Clear" : "Change"} variant="secondary">
                      <ActionForm action={clearDischarge.bind(null, d.id, k)} submitLabel="Save">
                        <Field label="Status">
                          <Select name="status" defaultValue="cleared">
                            <option value="cleared">Cleared</option>
                            {k === "billing" && <option value="deferred">Deferred — balance to be settled later</option>}
                            <option value="not_applicable">Not applicable</option>
                            <option value="pending">Back to pending</option>
                          </Select>
                        </Field>
                        <Field label="Note" hint="Required when deferred or not applicable">
                          <Input name="note" />
                        </Field>
                      </ActionForm>
                    </Disclosure>
                  )}
                </Step>
              );
            })}
          </ol>
        </Card>

        {open && can(s, "discharge.authorize") && (
          <Card className={cn(allDone ? "border-positive/40" : "")}>
            <CardHeader title="Authorise discharge" description="Releases the bed and closes the admission" />
            <CardBody>
              <ActionForm action={authoriseDischarge.bind(null, d.id)} submitLabel="Authorise and discharge" confirm="Authorise this discharge? The bed is released and the admission closed.">
                {!allDone && <p className="text-xs text-attention-ink">Not every step is done yet; the system will say which.</p>}
                <Field label="Left the ward at">
                  <Input name="discharged_at" type="datetime-local" defaultValue={nairobiLocalInput()} />
                </Field>
              </ActionForm>
            </CardBody>
          </Card>
        )}

        {clinician && (
          <Disclosure label="Cancel discharge" variant="ghost">
            <ActionForm action={cancelDischarge.bind(null, d.id)} submitLabel="Cancel discharge" submitVariant="danger">
              <Field label="Reason" required>
                <Input name="reason" required placeholder="e.g. Spiked a fever" />
              </Field>
            </ActionForm>
          </Disclosure>
        )}
      </div>
    </div>
  );
}

function Step({ done, label, by, at, note, children }: { done: boolean; label: string; by?: string; at: string | null; note?: string; children?: React.ReactNode }) {
  return (
    <li className="px-5 py-3">
      <div className="flex items-start gap-2.5">
        {done ? (
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-positive text-white">
            <Check className="h-3 w-3" aria-hidden="true" />
          </span>
        ) : (
          <Circle className="mt-0.5 h-5 w-5 shrink-0 text-line-strong" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <p className={cn("text-sm", done ? "text-ink" : "font-medium text-ink")}>{label}</p>
          {done && by && <p className="text-xs text-ink-faint">{by} · {fmtDateTime(at)}</p>}
          {note && <p className="text-xs text-ink-soft">{note}</p>}
          {children && <div className="mt-2">{children}</div>}
        </div>
        {!done && <Badge tone="attention">To do</Badge>}
      </div>
    </li>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div>
      <p className="text-[11px] font-medium tracking-wide text-ink-faint uppercase">{label}</p>
      <p className="mt-0.5 whitespace-pre-wrap">{children}</p>
    </div>
  );
}
