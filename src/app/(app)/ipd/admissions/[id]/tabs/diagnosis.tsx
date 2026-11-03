import { Stethoscope } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, Disclosure, EmptyState, Field, Input, Select } from "@/components/ui/primitives";
import { ActionForm } from "@/components/ui/action-form";
import { can } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime, titleCase } from "@/lib/format";
import { addDiagnosis, setDiagnosisStatus } from "../../../actions";
import type { Ctx } from "../context";

/**
 * Diagnoses are a history, not a field: a working diagnosis that turns out
 * wrong is marked refuted (with the reason) and the new one added, so the
 * record shows what was thought when. The final diagnosis — rank primary,
 * kind final — is what the discharge summary requires.
 */
export async function DiagnosisTab({ ctx }: { ctx: Ctx }) {
  const { s, admission: a, open } = ctx;
  const supabase = await createClient();
  const { data } = await supabase
    .from("edoshmis_diagnoses")
    .select("*, recorder:edoshmis_staff!edoshmis_diagnoses_recorded_by_fkey(full_name)")
    .eq("admission_id", a.id)
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as unknown as {
    id: string; rank: string; kind: string; description: string; icd10_code: string | null; status: string; status_reason: string | null; created_at: string; recorder: { full_name: string } | null;
  }[];
  const write = can(s, "clinical.diagnose");

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <Card className="order-2 lg:order-1">
        <CardHeader title="Diagnoses" icon={Stethoscope} />
        {rows.length === 0 ? (
          <EmptyState icon={Stethoscope} title="No diagnoses recorded" />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((d) => (
              <li key={d.id} className={`px-5 py-3 text-sm ${d.status !== "active" ? "text-ink-faint" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className={d.status === "entered_in_error" || d.status === "refuted" ? "line-through" : ""}>
                    <span className="font-medium">{d.description}</span>
                    {d.icd10_code && <span className="tnum ml-1.5 text-xs text-ink-faint">{d.icd10_code}</span>}
                  </span>
                  <span className="flex flex-wrap gap-1">
                    <Badge tone={d.rank === "primary" ? "brand" : "neutral"}>{titleCase(d.rank)}</Badge>
                    <Badge tone={d.kind === "final" ? "positive" : "neutral"}>{titleCase(d.kind)}</Badge>
                    {d.status !== "active" && <Badge>{titleCase(d.status)}</Badge>}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-ink-faint">
                  {d.recorder?.full_name} · {fmtDateTime(d.created_at)}
                  {d.status_reason ? ` · ${d.status_reason}` : ""}
                </p>
                {write && d.status === "active" && (
                  <Disclosure label="Change status" variant="ghost" className="mt-1.5">
                    <ActionForm action={setDiagnosisStatus.bind(null, d.id)} submitLabel="Save">
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Now">
                          <Select name="status" defaultValue="resolved">
                            <option value="resolved">Resolved</option>
                            <option value="refuted">Refuted (ruled out)</option>
                            <option value="entered_in_error">Entered in error</option>
                          </Select>
                        </Field>
                        <Field label="Reason" hint="Required unless resolved">
                          <Input name="reason" />
                        </Field>
                      </div>
                    </ActionForm>
                  </Disclosure>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {write && open && (
        <Card className="order-1 lg:order-2 lg:sticky lg:top-20 lg:self-start">
          <CardHeader title="Add diagnosis" />
          <CardBody>
            <ActionForm action={addDiagnosis.bind(null, a.id, a.facility_id, a.patient_id)} submitLabel="Add">
              <Field label="Diagnosis" required>
                <Input name="description" required />
              </Field>
              <Field label="ICD-10 code" hint="e.g. J18.9 — letter, two digits, optional decimal">
                <Input name="icd10_code" className="uppercase" pattern="[A-Za-z][0-9]{2}(\.[0-9A-Za-z]{1,4})?" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Rank">
                  <Select name="rank" defaultValue="secondary">
                    <option value="primary">Primary</option>
                    <option value="secondary">Secondary</option>
                  </Select>
                </Field>
                <Field label="Certainty">
                  <Select name="kind" defaultValue="working">
                    <option value="provisional">Provisional</option>
                    <option value="working">Working</option>
                    <option value="final">Final</option>
                  </Select>
                </Field>
              </div>
            </ActionForm>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
