import type { Metadata } from "next";
import { Activity, AlertTriangle, BellRing, Pill, Plus, Trash2 } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, Disclosure, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
import { ActionButton, ActionForm } from "@/components/ui/action-form";
import { can, requireStaff } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, ksh, titleCase } from "@/lib/format";
import { addBand, addEscalationRule, addInteraction, deleteBand, deleteEscalationRule, deleteInteraction, saveDrug } from "../actions";

export const metadata: Metadata = { title: "Clinical settings" };

const PARAMS = ["respiratory_rate", "spo2", "supplemental_o2", "systolic_bp", "pulse", "temperature", "consciousness"] as const;
const FORMS = ["tablet", "capsule", "syrup", "suspension", "injection", "infusion", "cream", "ointment", "drops", "inhaler", "suppository", "patch", "other"] as const;

/**
 * The clinical rules the system applies, entered and owned by the hospital.
 * EDOSHMIS ships none: early-warning bands and escalation responses must be
 * taken from the scoring system your clinical governance has adopted and
 * signed off by name; drug interactions are cited to their reference.
 */
export default async function ClinicalSettings() {
  const s = await requireStaff();
  const config = can(s, "admin.clinical_config");
  const pharmacy = can(s, "meds.verify");
  if (!config && !pharmacy) return <EmptyState icon={Activity} title="Your role does not include clinical settings." />;
  const supabase = await createClient();
  const [{ data: bands }, { data: rules }, { data: drugs }, { data: inter }, { data: tariffs }] = await Promise.all([
    supabase.from("edoshmis_observation_bands").select("*").eq("facility_id", s.facility.id).order("scheme").order("parameter").order("min_value", { nullsFirst: true }),
    supabase.from("edoshmis_escalation_rules").select("*").eq("facility_id", s.facility.id).order("scheme").order("min_total"),
    supabase.from("edoshmis_drugs").select("*").eq("organization_id", s.staff.organizationId).order("generic_name"),
    supabase.from("edoshmis_drug_interactions").select("id, severity, description, source, a:edoshmis_drugs!edoshmis_drug_interactions_drug_a_fkey(generic_name), b:edoshmis_drugs!edoshmis_drug_interactions_drug_b_fkey(generic_name)").eq("organization_id", s.staff.organizationId),
    supabase.from("edoshmis_tariffs").select("id, name, price").eq("facility_id", s.facility.id).eq("category", "medication").eq("is_active", true).order("name"),
  ]);
  const schemes = [...new Set((bands ?? []).map((b) => b.scheme))];

  return (
    <>
      <PageHeader title="Clinical settings" description="Rules the system applies — set and approved by your clinicians." />
      <div className="flex flex-col gap-5">
        {config && (
          <>
            <p className="flex items-start gap-2 rounded-xl border border-attention/40 bg-attention-soft px-4 py-3 text-sm text-attention-ink">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              EDOSHMIS does not supply clinical thresholds. Enter the bands of the early-warning system your hospital has adopted (for example its NEWS2 or PEWS chart) exactly as approved, and record who approved them.
              Until bands exist, observations are stored but not scored.
            </p>

            <Card>
              <CardHeader
                title="Early-warning score bands"
                icon={Activity}
                description={bands?.length ? `${bands.length} band(s) · schemes: ${schemes.join(", ")}` : "None configured"}
                actions={
                  <Disclosure label="Add band" icon={Plus}>
                    <ActionForm action={addBand} submitLabel="Add band">
                      <div className="grid gap-3 sm:grid-cols-3">
                        <Field label="Scheme">
                          <Select name="scheme" defaultValue="adult">
                            {["adult", "paediatric", "maternity", "neonatal"].map((x) => (
                              <option key={x} value={x}>
                                {titleCase(x)}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="Parameter">
                          <Select name="parameter">
                            {PARAMS.map((p) => (
                              <option key={p} value={p}>
                                {titleCase(p)}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="Score" required>
                          <Input name="score" type="number" min={0} max={10} required />
                        </Field>
                        <Field label="From (inclusive)" hint="Blank = no lower limit">
                          <Input name="min_value" inputMode="decimal" />
                        </Field>
                        <Field label="To (inclusive)" hint="Blank = no upper limit">
                          <Input name="max_value" inputMode="decimal" />
                        </Field>
                        <Field label="…or matches" hint="Consciousness: alert, new_confusion, voice, pain, unresponsive. Oxygen: true / false">
                          <Input name="match_value" />
                        </Field>
                        <Field label="Approved by" required>
                          <Input name="approved_by" required placeholder="Name, title" />
                        </Field>
                        <Field label="Approved on">
                          <Input name="approved_at" type="date" />
                        </Field>
                      </div>
                    </ActionForm>
                  </Disclosure>
                }
              />
              {bands?.length ? (
                <div className="overflow-x-auto">
                  <table className="tnum w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="text-left text-xs text-ink-faint">
                        <th className="px-5 py-2 font-medium">Scheme</th>
                        <th className="px-3 py-2 font-medium">Parameter</th>
                        <th className="px-3 py-2 font-medium">Range / value</th>
                        <th className="px-3 py-2 font-medium">Score</th>
                        <th className="px-3 py-2 font-medium">Approved</th>
                        <th className="px-5 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {bands.map((b) => (
                        <tr key={b.id} className="border-t border-line">
                          <td className="px-5 py-2">{titleCase(b.scheme)}</td>
                          <td className="px-3 py-2">{titleCase(b.parameter)}</td>
                          <td className="px-3 py-2">{b.match_value ?? `${b.min_value ?? "…"} – ${b.max_value ?? "…"}`}</td>
                          <td className="px-3 py-2 font-semibold">{b.score}</td>
                          <td className="px-3 py-2 text-xs text-ink-soft">
                            {b.approved_by}, {fmtDate(b.approved_at)}
                          </td>
                          <td className="px-5 py-2 text-right">
                            <ActionButton action={deleteBand.bind(null, b.id)} variant="ghost" confirm="Remove this band?">
                              <Trash2 className="h-3.5 w-3.5" aria-label="Remove" />
                            </ActionButton>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <CardBody className="text-sm text-ink-faint">No bands.</CardBody>
              )}
            </Card>

            <Card>
              <CardHeader
                title="Escalation rules"
                icon={BellRing}
                description="What a score means and the response expected — an escalation opens automatically when one matches"
                actions={
                  <Disclosure label="Add rule" icon={Plus}>
                    <ActionForm action={addEscalationRule} submitLabel="Add rule">
                      <div className="grid gap-3 sm:grid-cols-3">
                        <Field label="Scheme">
                          <Select name="scheme" defaultValue="adult">
                            {["adult", "paediatric", "maternity", "neonatal"].map((x) => (
                              <option key={x} value={x}>
                                {titleCase(x)}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="Total score at least">
                          <Input name="min_total" type="number" min={0} />
                        </Field>
                        <Field label="…or any one parameter scoring">
                          <Input name="single_parameter" type="number" min={0} />
                        </Field>
                        <Field label="Level">
                          <Select name="level" defaultValue="medium">
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                          </Select>
                        </Field>
                        <Field label="Response expected" required className="sm:col-span-2">
                          <Input name="response" required placeholder="As written in your escalation policy" />
                        </Field>
                        <Field label="Repeat obs every (min)">
                          <Input name="repeat_minutes" type="number" min={5} />
                        </Field>
                        <Field label="Approved by" required>
                          <Input name="approved_by" required />
                        </Field>
                        <Field label="Approved on">
                          <Input name="approved_at" type="date" />
                        </Field>
                      </div>
                    </ActionForm>
                  </Disclosure>
                }
              />
              {rules?.length ? (
                <ul className="divide-y divide-line">
                  {rules.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm">
                      <span>
                        <Badge tone={r.level === "high" ? "critical" : r.level === "medium" ? "attention" : "info"}>{r.level}</Badge>{" "}
                        {titleCase(r.scheme)}: {[r.min_total != null && `total ≥ ${r.min_total}`, r.single_parameter != null && `any parameter ≥ ${r.single_parameter}`].filter(Boolean).join(" or ")} → {r.response}
                        <span className="block text-xs text-ink-faint">
                          {r.approved_by}, {fmtDate(r.approved_at)}
                          {r.repeat_minutes ? ` · repeat every ${r.repeat_minutes} min` : ""}
                        </span>
                      </span>
                      <ActionButton action={deleteEscalationRule.bind(null, r.id)} variant="ghost" confirm="Remove this rule?">
                        <Trash2 className="h-3.5 w-3.5" aria-label="Remove" />
                      </ActionButton>
                    </li>
                  ))}
                </ul>
              ) : (
                <CardBody className="text-sm text-ink-faint">No rules.</CardBody>
              )}
            </Card>
          </>
        )}

        <Card>
          <CardHeader
            title={`Drug catalogue · ${drugs?.length ?? 0}`}
            icon={Pill}
            description="Prescribers pick from this list. The class is used for allergy checks (an allergy to “penicillin” matches drugs whose class is penicillin)."
            actions={
              <Disclosure label="Add drug" icon={Plus}>
                <DrugForm tariffs={tariffs ?? []} />
              </Disclosure>
            }
          />
          {drugs?.length ? (
            <ul className="divide-y divide-line">
              {drugs.map((d) => (
                <li key={d.id} className="px-5 py-2.5 text-sm">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                      <span className={d.is_active ? "" : "text-ink-faint line-through"}>
                        <span className="font-medium">
                          {d.generic_name} {d.strength}
                        </span>
                        <span className="block text-xs text-ink-faint">
                          {titleCase(d.form)}
                          {d.brand_name ? ` · ${d.brand_name}` : ""}
                          {d.drug_class ? ` · class: ${d.drug_class}` : ""}
                        </span>
                      </span>
                      {d.is_controlled && <Badge tone="attention">Controlled</Badge>}
                    </summary>
                    <div className="mt-3">
                      <DrugForm d={d} tariffs={tariffs ?? []} />
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          ) : (
            <CardBody className="text-sm text-ink-faint">The catalogue is empty. Prescribers can still type a drug name, without class-based allergy or interaction checks.</CardBody>
          )}
        </Card>

        <Card>
          <CardHeader
            title={`Drug interactions · ${inter?.length ?? 0}`}
            description="Pairs that warn the prescriber. Each must cite its reference."
            actions={
              (drugs?.length ?? 0) >= 2 && (
                <Disclosure label="Add interaction" icon={Plus}>
                  <ActionForm action={addInteraction} submitLabel="Add">
                    <div className="grid gap-3 sm:grid-cols-2">
                      {(["drug_a", "drug_b"] as const).map((k) => (
                        <Field key={k} label={k === "drug_a" ? "Drug" : "With"}>
                          <Select name={k} required defaultValue="">
                            <option value="" disabled>
                              Choose
                            </option>
                            {drugs?.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.generic_name} {d.strength}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      ))}
                      <Field label="Severity">
                        <Select name="severity" defaultValue="major">
                          <option value="minor">Minor</option>
                          <option value="moderate">Moderate</option>
                          <option value="major">Major</option>
                          <option value="contraindicated">Contraindicated</option>
                        </Select>
                      </Field>
                      <Field label="Reference" required hint="e.g. BNF, Kenya National Formulary, product SmPC">
                        <Input name="source" required />
                      </Field>
                      <Field label="Effect / advice" required className="sm:col-span-2">
                        <Input name="description" required />
                      </Field>
                    </div>
                  </ActionForm>
                </Disclosure>
              )
            }
          />
          {inter?.length ? (
            <ul className="divide-y divide-line">
              {(inter as unknown as { id: string; severity: string; description: string; source: string; a: { generic_name: string }; b: { generic_name: string } }[]).map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm">
                  <span>
                    <span className="font-medium">
                      {i.a.generic_name} + {i.b.generic_name}
                    </span>{" "}
                    <Badge tone={i.severity === "contraindicated" || i.severity === "major" ? "critical" : "attention"}>{i.severity}</Badge>
                    <span className="block text-xs text-ink-soft">
                      {i.description} — {i.source}
                    </span>
                  </span>
                  <ActionButton action={deleteInteraction.bind(null, i.id)} variant="ghost" confirm="Remove this interaction?">
                    <Trash2 className="h-3.5 w-3.5" aria-label="Remove" />
                  </ActionButton>
                </li>
              ))}
            </ul>
          ) : (
            <CardBody className="text-sm text-ink-faint">None entered — prescribers get no interaction warnings until the pharmacy adds them.</CardBody>
          )}
        </Card>
      </div>
    </>
  );
}

function DrugForm({ d, tariffs }: { d?: Record<string, string | boolean | null>; tariffs: { id: string; name: string; price: number }[] }) {
  return (
    <ActionForm action={saveDrug.bind(null, (d?.id as string) ?? null)} submitLabel={d ? "Save" : "Add drug"} resetOnSuccess={!d}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Generic name" required>
          <Input name="generic_name" required defaultValue={(d?.generic_name as string) ?? ""} />
        </Field>
        <Field label="Strength">
          <Input name="strength" defaultValue={(d?.strength as string) ?? ""} placeholder="500 mg" />
        </Field>
        <Field label="Form" required>
          <Select name="form" defaultValue={(d?.form as string) ?? "tablet"}>
            {FORMS.map((f) => (
              <option key={f} value={f}>
                {titleCase(f)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Brand">
          <Input name="brand_name" defaultValue={(d?.brand_name as string) ?? ""} />
        </Field>
        <Field label="Class" hint="Used in allergy checks">
          <Input name="drug_class" defaultValue={(d?.drug_class as string) ?? ""} placeholder="e.g. Penicillin" />
        </Field>
        <Field label="Usual route">
          <Input name="default_route" defaultValue={(d?.default_route as string) ?? ""} />
        </Field>
        <Field label="Price on issue" hint="Charged when dispensed">
          <Select name="tariff_id" defaultValue={(d?.tariff_id as string) ?? ""}>
            <option value="">Not charged per issue</option>
            {tariffs.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {ksh(t.price)}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" name="is_controlled" defaultChecked={Boolean(d?.is_controlled)} className="h-4 w-4 accent-brand" /> Controlled (witness on administration)
        </label>
        {d && (
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" name="inactive" defaultChecked={!d.is_active} className="h-4 w-4 accent-brand" /> No longer stocked
          </label>
        )}
      </div>
    </ActionForm>
  );
}
