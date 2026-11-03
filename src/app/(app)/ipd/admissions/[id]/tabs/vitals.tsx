import { randomUUID } from "node:crypto";
import Link from "next/link";
import { Activity, AlertTriangle, BellRing, Info } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, Disclosure, EmptyState, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { ActionButton, ActionForm } from "@/components/ui/action-form";
import { ObsTrend } from "@/components/charts/obs-trend";
import { can } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime, nairobiLocalInput, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { escalation, markObservationError, recordObservation } from "../../../actions";
import type { Ctx } from "../context";

interface Obs {
  id: string;
  observed_at: string;
  temperature: number | null;
  pulse: number | null;
  respiratory_rate: number | null;
  systolic_bp: number | null;
  diastolic_bp: number | null;
  spo2: number | null;
  supplemental_o2: boolean | null;
  weight_kg: number | null;
  height_cm: number | null;
  bmi: number | null;
  pain_score: number | null;
  blood_glucose_mmol: number | null;
  consciousness: string | null;
  ews_score: number | null;
  ews_level: string | null;
  ews_breakdown: Record<string, number> | null;
  notes: string | null;
  entered_in_error: boolean;
  error_reason: string | null;
  recorder: { full_name: string } | null;
}

export async function VitalsTab({ ctx }: { ctx: Ctx }) {
  const { s, admission: a, open } = ctx;
  const supabase = await createClient();
  const [{ data }, { data: esc }, { count: bands }] = await Promise.all([
    supabase.from("edoshmis_observations").select("*, recorder:edoshmis_staff!edoshmis_observations_recorded_by_fkey(full_name)").eq("admission_id", a.id).order("observed_at", { ascending: false }).limit(200),
    supabase
      .from("edoshmis_escalations")
      .select("id, level, reason, response_expected, status, created_at, acknowledged_at, resolved_at, outcome, ack:edoshmis_staff!edoshmis_escalations_acknowledged_by_fkey(full_name), res:edoshmis_staff!edoshmis_escalations_resolved_by_fkey(full_name)")
      .eq("admission_id", a.id)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase.from("edoshmis_observation_bands").select("id", { count: "exact", head: true }).eq("facility_id", a.facility_id),
  ]);
  const rows = (data ?? []) as unknown as Obs[];
  const valid = rows.filter((r) => !r.entered_in_error).reverse();
  const series = (k: keyof Obs) => valid.filter((r) => r[k] != null).map((r) => ({ at: r.observed_at, v: Number(r[k]) }));
  const record = can(s, "vitals.record") && open;
  const escalate = can(s, "vitals.escalate");

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <div className="order-2 flex min-w-0 flex-col gap-5 lg:order-1">
        {!bands && (
          <p className="flex items-start gap-2 rounded-xl border border-info/30 bg-info-soft px-4 py-3 text-sm text-info-ink">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              No early-warning score is configured for this facility, so readings are recorded but not scored or escalated automatically. EDOSHMIS does not ship clinical thresholds;
              your clinical lead sets and approves them{can(s, "admin.clinical_config") && (
                <>
                  {" "}
                  under{" "}
                  <Link href="/admin/clinical" className="underline">
                    Clinical settings
                  </Link>
                </>
              )}
              .
            </span>
          </p>
        )}

        {(esc?.length ?? 0) > 0 && (
          <Card>
            <CardHeader title="Escalations" icon={BellRing} />
            <ul className="divide-y divide-line">
              {(esc as unknown as { id: string; level: string; reason: string; response_expected: string | null; status: string; created_at: string; outcome: string | null; ack: { full_name: string } | null; res: { full_name: string } | null }[]).map((e) => (
                <li key={e.id} className={cn("px-5 py-3 text-sm", e.status !== "resolved" && e.level === "high" && "bg-critical-soft/40")}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <AlertTriangle className={cn("h-4 w-4", e.level === "high" ? "text-critical" : "text-attention")} aria-hidden="true" />
                      <strong>{e.reason}</strong>
                      <Badge tone={e.level === "high" ? "critical" : e.level === "medium" ? "attention" : "info"}>{e.level}</Badge>
                    </span>
                    <span className="text-xs text-ink-faint">{fmtDateTime(e.created_at)}</span>
                  </div>
                  {e.response_expected && <p className="mt-1 text-ink-soft">Expected response: {e.response_expected}</p>}
                  {e.status === "resolved" ? (
                    <p className="mt-1 text-xs text-positive-ink">
                      Resolved by {e.res?.full_name}: {e.outcome}
                    </p>
                  ) : (
                    escalate && (
                      <div className="mt-2 flex flex-wrap items-start gap-2">
                        {e.status === "open" ? (
                          <ActionButton action={escalation.bind(null, e.id, "acknowledge")} variant="primary">
                            Acknowledge
                          </ActionButton>
                        ) : (
                          <span className="text-xs text-ink-faint">Acknowledged by {e.ack?.full_name}</span>
                        )}
                        <Disclosure label="Resolve" variant="secondary">
                          <ActionForm action={escalation.bind(null, e.id, "resolve")} submitLabel="Resolve">
                            <Field label="What was done" required>
                              <Textarea name="outcome" required className="min-h-16" placeholder="e.g. Reviewed by Dr X, O₂ 2 L, repeat obs in 30 min" />
                            </Field>
                          </ActionForm>
                        </Disclosure>
                      </div>
                    )
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <ObsTrend title="Temperature" unit="°C" points={series("temperature")} />
          <ObsTrend title="Pulse" unit="/min" points={series("pulse")} />
          <ObsTrend title="Respiratory rate" unit="/min" points={series("respiratory_rate")} />
          <ObsTrend title="Systolic BP" unit="mmHg" points={series("systolic_bp")} />
          <ObsTrend title="SpO₂" unit="%" points={series("spo2")} />
          {bands ? <ObsTrend title="Early warning score" points={series("ews_score")} /> : <ObsTrend title="Blood glucose" unit="mmol/L" points={series("blood_glucose_mmol")} />}
        </div>

        <Card>
          <CardHeader title={`Readings · ${rows.length}`} icon={Activity} />
          {rows.length === 0 ? (
            <EmptyState icon={Activity} title="No observations yet" />
          ) : (
            <div className="overflow-x-auto">
              <table className="tnum w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-faint">
                    <th className="px-4 py-2 font-medium">Time</th>
                    <th className="px-2 py-2 font-medium">T °C</th>
                    <th className="px-2 py-2 font-medium">P</th>
                    <th className="px-2 py-2 font-medium">RR</th>
                    <th className="px-2 py-2 font-medium">BP</th>
                    <th className="px-2 py-2 font-medium">SpO₂</th>
                    <th className="px-2 py-2 font-medium">AVPU</th>
                    <th className="px-2 py-2 font-medium">Pain</th>
                    <th className="px-2 py-2 font-medium">Gluc</th>
                    <th className="px-2 py-2 font-medium">EWS</th>
                    <th className="px-4 py-2 font-medium">By</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={cn("border-t border-line align-top", r.entered_in_error && "text-ink-faint line-through")}>
                      <td className="px-4 py-2 whitespace-nowrap">{fmtDateTime(r.observed_at)}</td>
                      <td className="px-2 py-2">{r.temperature ?? "—"}</td>
                      <td className="px-2 py-2">{r.pulse ?? "—"}</td>
                      <td className="px-2 py-2">{r.respiratory_rate ?? "—"}</td>
                      <td className="px-2 py-2">{r.systolic_bp != null ? `${r.systolic_bp}/${r.diastolic_bp ?? "–"}` : "—"}</td>
                      <td className="px-2 py-2">
                        {r.spo2 ?? "—"}
                        {r.supplemental_o2 ? " (O₂)" : ""}
                      </td>
                      <td className="px-2 py-2">{r.consciousness ? titleCase(r.consciousness) : "—"}</td>
                      <td className="px-2 py-2">{r.pain_score ?? "—"}</td>
                      <td className="px-2 py-2">{r.blood_glucose_mmol ?? "—"}</td>
                      <td className="px-2 py-2">
                        {r.ews_score != null ? (
                          <span title={r.ews_breakdown ? Object.entries(r.ews_breakdown).map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(", ") : undefined}>
                            <Badge tone={r.ews_level === "high" ? "critical" : r.ews_level === "medium" ? "attention" : r.ews_level === "low" ? "info" : "neutral"}>{r.ews_score}</Badge>
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-ink-soft">
                        {r.recorder?.full_name}
                        {r.entered_in_error ? <span className="block text-critical-ink no-underline">Error: {r.error_reason}</span> : null}
                        {record && !r.entered_in_error && (
                          <Disclosure label="Error" variant="ghost">
                            <ActionForm action={markObservationError.bind(null, r.id)} submitLabel="Mark entered in error" submitVariant="danger">
                              <Field label="Reason" required>
                                <Input name="reason" required placeholder="e.g. Wrong patient" />
                              </Field>
                            </ActionForm>
                          </Disclosure>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {record && (
        <div className="order-1 lg:order-2 lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardHeader title="Record observations" description="Leave blank what was not measured" />
            <CardBody>
              <ActionForm action={recordObservation.bind(null, a.id, a.facility_id)} submitLabel="Save observations">
                <input type="hidden" name="client_id" value={randomUUID()} />
                <Field label="Time taken">
                  <Input name="observed_at" type="datetime-local" defaultValue={nairobiLocalInput()} />
                </Field>
                <div className="grid grid-cols-3 gap-2.5">
                  <Num name="temperature" label="Temp °C" step="0.1" />
                  <Num name="pulse" label="Pulse" />
                  <Num name="respiratory_rate" label="Resp rate" />
                  <Num name="systolic_bp" label="Systolic" />
                  <Num name="diastolic_bp" label="Diastolic" />
                  <Num name="spo2" label="SpO₂ %" />
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <Field label="Oxygen">
                    <Select name="supplemental_o2" defaultValue="no">
                      <option value="no">Room air</option>
                      <option value="yes">On oxygen</option>
                    </Select>
                  </Field>
                  <Num name="o2_flow_l_min" label="O₂ L/min" step="0.5" />
                  <Field label="Consciousness">
                    <Select name="consciousness" defaultValue="">
                      <option value="">Not assessed</option>
                      <option value="alert">Alert</option>
                      <option value="new_confusion">New confusion</option>
                      <option value="voice">Responds to voice</option>
                      <option value="pain">Responds to pain</option>
                      <option value="unresponsive">Unresponsive</option>
                    </Select>
                  </Field>
                  <Num name="pain_score" label="Pain 0–10" />
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                  <Num name="blood_glucose_mmol" label="Glucose" step="0.1" />
                  <Num name="weight_kg" label="Weight kg" step="0.1" />
                  <Num name="height_cm" label="Height cm" step="0.5" />
                </div>
                <Field label="Scheme" hint="Which configured early-warning bands to score against">
                  <Select name="scheme" defaultValue="adult">
                    <option value="adult">Adult</option>
                    <option value="paediatric">Paediatric</option>
                    <option value="maternity">Maternity</option>
                    <option value="neonatal">Neonatal</option>
                  </Select>
                </Field>
                <Field label="Note">
                  <Input name="notes" />
                </Field>
              </ActionForm>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}

function Num({ name, label, step }: { name: string; label: string; step?: string }) {
  return (
    <Field label={label}>
      <Input name={name} type="number" inputMode="decimal" step={step ?? "1"} className="tnum h-11 text-base" />
    </Field>
  );
}
