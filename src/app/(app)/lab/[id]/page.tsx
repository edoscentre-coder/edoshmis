import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, FlaskConical, PhoneCall } from "lucide-react";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Badge, Card, CardBody, CardHeader, Disclosure, Fact, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
import { ActionButton, ActionForm } from "@/components/ui/action-form";
import { PrintButton } from "@/components/ui/print-button";
import { FLAG_MARK, FLAG_TONE } from "@/components/clinical/investigations";
import { can, requireStaff } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { ageOf, fmtDateTime, fullName, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { criticalCall, enterResults, labStep, validateLab } from "../actions";

export const metadata: Metadata = { title: "Lab order" };

interface Param { id: string; name: string; unit: string | null; value_type: string; choices: string[] | null; ref_low: number | null; ref_high: number | null; ref_text: string | null; sex: string | null; age_min_years: number | null; age_max_years: number | null; sort_order: number }
interface Result { id: string; item_id: string; parameter_id: string; value_text: string; unit: string | null; flag: string | null; ref_display: string | null; is_current: boolean; version: number; amend_reason: string | null; entered_at: string; enterer: { full_name: string } | null }

export default async function LabOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireStaff();
  const { id } = await params;
  const supabase = await createClient();
  const { data: o } = await supabase
    .from("edoshmis_lab_orders")
    .select("*, edoshmis_patients(id, first_name, middle_name, last_name, hospital_number, sex, date_of_birth, dob_estimated), orderer:edoshmis_staff!edoshmis_lab_orders_ordered_by_fkey(full_name), collector:edoshmis_staff!edoshmis_lab_orders_collected_by_fkey(full_name), validator:edoshmis_staff!edoshmis_lab_orders_validated_by_fkey(full_name), edoshmis_lab_order_items(id, test_id, test_name, status)")
    .eq("id", id)
    .maybeSingle();
  if (!o) notFound();
  const p = o.edoshmis_patients as { id: string; first_name: string; middle_name: string | null; last_name: string; hospital_number: string; sex: string; date_of_birth: string | null; dob_estimated: boolean };
  const items = o.edoshmis_lab_order_items as { id: string; test_id: string; test_name: string; status: string }[];
  const [{ data: params_ }, { data: results }, { data: calls }] = await Promise.all([
    supabase.from("edoshmis_lab_parameters").select("*").in("test_id", items.map((i) => i.test_id)).order("sort_order"),
    supabase.from("edoshmis_lab_results").select("*, enterer:edoshmis_staff!edoshmis_lab_results_entered_by_fkey(full_name)").eq("order_id", id).order("version"),
    supabase.from("edoshmis_lab_critical_calls").select("result_id, communicated_to, communicated_at, read_back").eq("order_id", id),
  ]);
  const allParams = (params_ ?? []) as unknown as (Param & { test_id: string })[];
  const res = (results ?? []) as unknown as Result[];
  const called = new Set((calls ?? []).map((c) => c.result_id));
  const process = can(s, "lab.process");
  const validate = can(s, "lab.validate");
  const workable = ["received", "in_progress", "resulted"].includes(o.status);
  // One input row per parameter name (sex/age bands share a name; the database picks the band).
  const paramsFor = (testId: string) => Object.values(Object.fromEntries(allParams.filter((x) => x.test_id === testId).map((x) => [x.name, x]))).sort((a, b) => a.sort_order - b.sort_order);
  const pendingCritical = res.filter((r) => r.is_current && (r.flag === "critical_low" || r.flag === "critical_high") && !called.has(r.id));

  return (
    <>
      <Breadcrumbs trail={[{ label: "Laboratory", href: "/lab" }, { label: o.order_number }]} />
      <PageHeader
        eyebrow={<span className="tnum">{o.order_number}{o.accession ? ` · ${o.accession}` : ""}</span>}
        title={
          <Link href={`/patients/${p.id}`} className="hover:text-brand">
            {fullName(p)}
          </Link>
        }
        description={`${p.hospital_number} · ${ageOf(p.date_of_birth, p.dob_estimated)} · ${titleCase(p.sex)} · ordered by ${(o.orderer as { full_name: string } | null)?.full_name} ${fmtDateTime(o.ordered_at)}`}
        actions={
          <>
            {o.priority !== "routine" && <Badge tone="critical">{o.priority.toUpperCase()}</Badge>}
            <Badge tone={o.status === "validated" ? "positive" : "info"}>{titleCase(o.status)}</Badge>
            {o.status === "validated" && <PrintButton label="Print report" />}
          </>
        }
      />

      {o.clinical_info && <p className="mb-4 rounded-lg bg-surface-sunk px-3 py-2 text-sm text-ink-soft">Clinical information: {o.clinical_info}</p>}
      {o.cancel_reason && <p className="mb-4 rounded-lg bg-attention-soft px-3 py-2 text-sm text-attention-ink">{o.cancel_reason}</p>}

      <div className="no-print mb-5 flex flex-wrap gap-2">
        {o.status === "ordered" && can(s, "lab.collect") && (
          <ActionButton action={labStep.bind(null, id, "collect")} variant="primary">
            Collect specimen
          </ActionButton>
        )}
        {o.status === "collected" && process && (
          <>
            <ActionButton action={labStep.bind(null, id, "receive")} variant="primary">
              Receive in lab
            </ActionButton>
            <Disclosure label="Reject specimen" variant="danger">
              <ActionForm action={labStep.bind(null, id, "reject")} submitLabel="Reject — recollect" submitVariant="danger">
                <Field label="Why" required>
                  <Select name="note" defaultValue="Haemolysed">
                    <option>Haemolysed</option>
                    <option>Clotted</option>
                    <option>Insufficient volume</option>
                    <option>Unlabelled or mislabelled</option>
                    <option>Wrong container</option>
                    <option>Delayed in transit</option>
                  </Select>
                </Field>
              </ActionForm>
            </Disclosure>
          </>
        )}
        {o.status === "resulted" && validate && (
          <ActionButton action={validateLab.bind(null, id)} variant="primary" confirm="Validate and release these results to the clinician?">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Validate and release
          </ActionButton>
        )}
        {!["validated", "cancelled"].includes(o.status) && can(s, "lab.order", "lab.process") && (
          <Disclosure label="Cancel order" variant="ghost">
            <ActionForm action={labStep.bind(null, id, "cancel")} submitLabel="Cancel order" submitVariant="danger">
              <Field label="Reason" required>
                <Input name="note" required />
              </Field>
            </ActionForm>
          </Disclosure>
        )}
      </div>

      {pendingCritical.length > 0 && (
        <Card className="mb-5 border-critical/40">
          <CardHeader title="Critical values to communicate" icon={PhoneCall} description="Phone the ward or clinician now; they read it back. Validation waits for this." />
          <ul className="divide-y divide-line">
            {pendingCritical.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <span className="font-semibold text-critical-ink">
                  <AlertTriangle className="mr-1 inline h-4 w-4" aria-hidden="true" />
                  {allParams.find((x) => x.id === r.parameter_id)?.name}: {r.value_text} {r.unit}
                </span>
                {process && (
                  <Disclosure label="Record call" variant="primary">
                    <ActionForm action={criticalCall.bind(null, r.id)} submitLabel="Recorded">
                      <Field label="Given to" required>
                        <Input name="to" required placeholder="Name and role, e.g. Dr Otieno (MO)" />
                      </Field>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="read_back" className="h-4 w-4 accent-brand" /> They read the result back
                      </label>
                      <Field label="Note">
                        <Input name="note" />
                      </Field>
                    </ActionForm>
                  </Disclosure>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="flex flex-col gap-5">
        {items.map((it) => {
          const ps = paramsFor(it.test_id);
          const current = res.filter((r) => r.item_id === it.id && r.is_current);
          const history = res.filter((r) => r.item_id === it.id && !r.is_current);
          const canEnter = it.status !== "cancelled" && ((workable && process && it.status !== "validated") || (it.status === "validated" && validate));
          return (
            <Card key={it.id}>
              <CardHeader title={it.test_name} icon={FlaskConical} actions={<Badge tone={it.status === "validated" ? "positive" : "neutral"}>{titleCase(it.status)}</Badge>} />
              <CardBody>
                {ps.length === 0 ? (
                  <p className="text-sm text-attention-ink">This test has no parameters set up. Add them in the test catalogue before results can be entered.</p>
                ) : canEnter ? (
                  <ActionForm action={enterResults.bind(null, it.id)} submitLabel={it.status === "validated" ? "Amend results" : "Save results"} resetOnSuccess={false}>
                    <div className="overflow-x-auto">
                      <table className="tnum w-full min-w-[480px] text-sm">
                        <thead>
                          <tr className="text-left text-xs text-ink-faint">
                            <th className="py-1.5 pr-3 font-medium">Parameter</th>
                            <th className="py-1.5 pr-3 font-medium">Result</th>
                            <th className="py-1.5 pr-3 font-medium">Flag</th>
                            <th className="py-1.5 font-medium">Reference</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ps.map((x) => {
                            const r = current.find((c) => c.parameter_id === x.id) ?? current.find((c) => allParams.find((a) => a.id === c.parameter_id)?.name === x.name);
                            return (
                              <tr key={x.id} className="border-t border-line">
                                <td className="py-1.5 pr-3">{x.name}</td>
                                <td className="py-1.5 pr-3">
                                  {x.value_type === "choice" && x.choices?.length ? (
                                    <select name={`p:${x.id}`} defaultValue={r?.value_text ?? ""} className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-sm">
                                      <option value="">—</option>
                                      {x.choices.map((c) => (
                                        <option key={c}>{c}</option>
                                      ))}
                                    </select>
                                  ) : (
                                    <span className="flex items-center gap-1.5">
                                      <input name={`p:${x.id}`} defaultValue={r?.value_text ?? ""} inputMode={x.value_type === "numeric" ? "decimal" : "text"} className="h-9 w-28 rounded-lg border border-line-strong bg-surface px-2 text-sm" />
                                      <span className="text-xs text-ink-faint">{x.unit}</span>
                                    </span>
                                  )}
                                </td>
                                <td className={cn("py-1.5 pr-3", FLAG_TONE[r?.flag ?? "normal"])}>{r?.flag ? FLAG_MARK[r.flag] ?? "" : ""}</td>
                                <td className="py-1.5 text-xs text-ink-faint">{r?.ref_display ?? x.ref_text ?? (x.ref_low != null || x.ref_high != null ? `${x.ref_low ?? ""} – ${x.ref_high ?? ""}` : "No range set")}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {it.status === "validated" && (
                      <Field label="Reason for amending" required hint="The previous value is kept and shown as superseded">
                        <Input name="amend_reason" required />
                      </Field>
                    )}
                  </ActionForm>
                ) : current.length ? (
                  <table className="tnum w-full text-sm">
                    <tbody>
                      {current.map((r) => (
                        <tr key={r.id} className="border-t border-line first:border-0">
                          <td className="py-1.5 pr-3 text-ink-soft">{allParams.find((x) => x.id === r.parameter_id)?.name}</td>
                          <td className={cn("py-1.5 pr-3", FLAG_TONE[r.flag ?? "normal"])}>
                            {r.value_text} {r.unit} {r.flag ? FLAG_MARK[r.flag] ?? "" : ""}
                          </td>
                          <td className="py-1.5 text-xs text-ink-faint">{r.ref_display}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-sm text-ink-faint">{o.status === "ordered" ? "Awaiting specimen collection." : o.status === "collected" ? "Awaiting receipt in the lab." : "No results yet."}</p>
                )}
                {history.length > 0 && (
                  <details className="mt-3 text-xs text-ink-soft">
                    <summary className="cursor-pointer text-ink-faint">Superseded values ({history.length})</summary>
                    <ul className="mt-1">
                      {history.map((r) => (
                        <li key={r.id} className="line-through">
                          {allParams.find((x) => x.id === r.parameter_id)?.name}: {r.value_text} (v{r.version}, {r.enterer?.full_name}, {fmtDateTime(r.entered_at)})
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {current.some((r) => r.amend_reason) && <p className="mt-2 text-xs text-attention-ink">Amended: {current.filter((r) => r.amend_reason).map((r) => r.amend_reason).join("; ")}</p>}
              </CardBody>
            </Card>
          );
        })}
      </div>

      <Card className="mt-5">
        <CardBody>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Fact label="Collected">{o.collected_at ? `${fmtDateTime(o.collected_at)} · ${(o.collector as { full_name: string } | null)?.full_name}` : null}</Fact>
            <Fact label="Received">{o.received_at ? fmtDateTime(o.received_at) : null}</Fact>
            <Fact label="Validated">{o.validated_at ? `${fmtDateTime(o.validated_at)} · ${(o.validator as { full_name: string } | null)?.full_name}` : null}</Fact>
            <Fact label="Critical calls">{calls?.length ? calls.map((c) => `${c.communicated_to} ${fmtDateTime(c.communicated_at)}`).join("; ") : "None"}</Fact>
          </dl>
        </CardBody>
      </Card>
    </>
  );
}
