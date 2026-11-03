import type { Metadata } from "next";
import { AlertTriangle, FlaskConical, Plus, Trash2 } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, Disclosure, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
import { ActionButton, ActionForm } from "@/components/ui/action-form";
import { can, requireStaff } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { ksh, titleCase } from "@/lib/format";
import { addLabParameter, deleteLabParameter, saveLabTest } from "../../lab/actions";

export const metadata: Metadata = { title: "Lab catalogue" };

const DISCIPLINES = ["haematology", "biochemistry", "microbiology", "serology", "immunology", "parasitology", "urinalysis", "histopathology", "cytology", "blood_bank", "molecular", "other"] as const;

/**
 * The lab's own test catalogue. Reference ranges and critical limits are the
 * laboratory's — from its validated methods and analysers — entered here per
 * parameter, by sex and age band where they differ. None are supplied.
 */
export default async function LabCatalogue() {
  const s = await requireStaff();
  if (!can(s, "lab.configure")) return <EmptyState icon={FlaskConical} title="Your role does not include the lab catalogue." />;
  const supabase = await createClient();
  const [{ data: tests }, { data: tariffs }] = await Promise.all([
    supabase.from("edoshmis_lab_tests").select("*, edoshmis_lab_parameters(*)").eq("facility_id", s.facility.id).order("discipline").order("name"),
    supabase.from("edoshmis_tariffs").select("id, name, price").eq("facility_id", s.facility.id).eq("category", "laboratory").eq("is_active", true).order("name"),
  ]);

  return (
    <>
      <PageHeader title="Laboratory catalogue" description="Tests, their parameters, and the lab's own reference ranges." />
      <p className="mb-4 flex items-start gap-2 rounded-xl border border-attention/40 bg-attention-soft px-4 py-3 text-sm text-attention-ink">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        Enter reference ranges and critical limits exactly as your laboratory has validated them for its methods. A result is flagged only against a range entered here.
      </p>
      <Disclosure label="Add a test" icon={Plus} variant="primary" size="md" className="mb-5">
        <TestForm tariffs={tariffs ?? []} />
      </Disclosure>
      {!tests?.length ? (
        <Card>
          <EmptyState icon={FlaskConical} title="No tests yet" />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {(tests as unknown as (Record<string, string | number | boolean | null> & { id: string; edoshmis_lab_parameters: Record<string, string | number | null>[] })[]).map((t) => (
            <Card key={t.id}>
              <CardHeader
                title={`${t.name} · ${t.code}`}
                icon={FlaskConical}
                description={`${titleCase(t.discipline as string)} · ${t.specimen_type}${t.container ? ` (${t.container})` : ""}${t.turnaround_hours != null ? ` · TAT ${t.turnaround_hours} h` : ""}${t.is_active ? "" : " · inactive"}`}
                actions={
                  <>
                    <Disclosure label="Add parameter" icon={Plus}>
                      <ParamForm testId={t.id} />
                    </Disclosure>
                    <Disclosure label="Edit test">
                      <TestForm t={t} tariffs={tariffs ?? []} />
                    </Disclosure>
                  </>
                }
              />
              {t.edoshmis_lab_parameters.length ? (
                <div className="overflow-x-auto">
                  <table className="tnum w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="text-left text-xs text-ink-faint">
                        <th className="px-5 py-2 font-medium">Parameter</th>
                        <th className="px-3 py-2 font-medium">Applies to</th>
                        <th className="px-3 py-2 font-medium">Reference</th>
                        <th className="px-3 py-2 font-medium">Critical</th>
                        <th className="px-5 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {t.edoshmis_lab_parameters
                        .sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
                        .map((x) => (
                          <tr key={x.id as string} className="border-t border-line">
                            <td className="px-5 py-2">
                              {x.name} {x.unit && <span className="text-xs text-ink-faint">({x.unit})</span>}
                              {x.value_type !== "numeric" && <Badge className="ml-1">{x.value_type}</Badge>}
                            </td>
                            <td className="px-3 py-2 text-xs text-ink-soft">
                              {[x.sex ? titleCase(x.sex as string) : "Any sex", x.age_min_years != null || x.age_max_years != null ? `age ${x.age_min_years ?? 0}–${x.age_max_years ?? "∞"} y` : "any age"].join(", ")}
                            </td>
                            <td className="px-3 py-2">{x.ref_text ?? (x.ref_low != null || x.ref_high != null ? `${x.ref_low ?? "…"} – ${x.ref_high ?? "…"}` : x.choices ? `Abnormal: ${(x.abnormal_choices as unknown as string[] | null)?.join(", ") ?? "—"}` : <span className="text-attention-ink">Not set</span>)}</td>
                            <td className="px-3 py-2 text-critical-ink">{x.critical_low != null || x.critical_high != null ? `< ${x.critical_low ?? "—"} / > ${x.critical_high ?? "—"}` : ""}</td>
                            <td className="px-5 py-2 text-right">
                              <ActionButton action={deleteLabParameter.bind(null, x.id as string)} variant="ghost" confirm="Remove this parameter?">
                                <Trash2 className="h-3.5 w-3.5" aria-label="Remove" />
                              </ActionButton>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <CardBody className="text-sm text-attention-ink">No parameters — results cannot be entered for this test yet.</CardBody>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function TestForm({ t, tariffs }: { t?: Record<string, string | number | boolean | null>; tariffs: { id: string; name: string; price: number }[] }) {
  return (
    <ActionForm action={saveLabTest.bind(null, (t?.id as string) ?? null)} submitLabel={t ? "Save" : "Add test"} resetOnSuccess={!t}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name" required>
          <Input name="name" required defaultValue={(t?.name as string) ?? ""} placeholder="Full blood count" />
        </Field>
        <Field label="Code" required>
          <Input name="code" required defaultValue={(t?.code as string) ?? ""} className="uppercase" placeholder="FBC" />
        </Field>
        <Field label="Discipline">
          <Select name="discipline" defaultValue={(t?.discipline as string) ?? "haematology"}>
            {DISCIPLINES.map((d) => (
              <option key={d} value={d}>
                {titleCase(d)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Specimen" required>
          <Input name="specimen_type" required defaultValue={(t?.specimen_type as string) ?? ""} placeholder="Whole blood (EDTA)" />
        </Field>
        <Field label="Container">
          <Input name="container" defaultValue={(t?.container as string) ?? ""} placeholder="Purple top" />
        </Field>
        <Field label="Turnaround (hours)">
          <Input name="turnaround_hours" type="number" min={0} defaultValue={t?.turnaround_hours != null ? String(t.turnaround_hours) : ""} />
        </Field>
        <Field label="Price" hint={tariffs.length ? undefined : "Add laboratory prices under Tariffs"}>
          <Select name="tariff_id" defaultValue={(t?.tariff_id as string) ?? ""}>
            <option value="">Not charged</option>
            {tariffs.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} · {ksh(x.price)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Patient preparation" className="sm:col-span-2">
          <Input name="instructions" defaultValue={(t?.instructions as string) ?? ""} placeholder="e.g. Fasting 8 hours" />
        </Field>
        {t && (
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" name="inactive" defaultChecked={!t.is_active} className="h-4 w-4 accent-brand" /> No longer offered
          </label>
        )}
      </div>
    </ActionForm>
  );
}

function ParamForm({ testId }: { testId: string }) {
  return (
    <ActionForm action={addLabParameter.bind(null, testId)} submitLabel="Add parameter">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name" required hint="Same name for each sex/age band of one parameter">
          <Input name="name" required placeholder="Haemoglobin" />
        </Field>
        <Field label="Unit">
          <Input name="unit" placeholder="g/dL" />
        </Field>
        <Field label="Type">
          <Select name="value_type" defaultValue="numeric">
            <option value="numeric">Number</option>
            <option value="choice">Choice</option>
            <option value="text">Free text</option>
          </Select>
        </Field>
        <Field label="Sex">
          <Select name="sex" defaultValue="">
            <option value="">Any</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </Select>
        </Field>
        <Field label="Age from (years)">
          <Input name="age_min_years" inputMode="decimal" />
        </Field>
        <Field label="Age below (years)">
          <Input name="age_max_years" inputMode="decimal" />
        </Field>
        <Field label="Reference low">
          <Input name="ref_low" inputMode="decimal" />
        </Field>
        <Field label="Reference high">
          <Input name="ref_high" inputMode="decimal" />
        </Field>
        <Field label="Reference as text" hint="Instead of numbers">
          <Input name="ref_text" />
        </Field>
        <Field label="Critical below">
          <Input name="critical_low" inputMode="decimal" />
        </Field>
        <Field label="Critical above">
          <Input name="critical_high" inputMode="decimal" />
        </Field>
        <Field label="Order">
          <Input name="sort_order" type="number" defaultValue="0" />
        </Field>
        <Field label="Choices" hint="Comma-separated, for a choice parameter" className="sm:col-span-2">
          <Input name="choices" placeholder="Negative, Positive" />
        </Field>
        <Field label="Abnormal choices">
          <Input name="abnormal_choices" placeholder="Positive" />
        </Field>
      </div>
    </ActionForm>
  );
}
