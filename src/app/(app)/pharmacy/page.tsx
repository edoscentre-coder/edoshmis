import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, PackageCheck, Pill } from "lucide-react";
import { Badge, Card, CardHeader, Disclosure, EmptyState, Field, Input, PageHeader, Textarea } from "@/components/ui/primitives";
import { ActionForm } from "@/components/ui/action-form";
import { can, requireStaff } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime, fullName } from "@/lib/format";
import { dispense, verifyOrder } from "./actions";
import { dispenseOutpatient } from "../opd/actions";

export const metadata: Metadata = { title: "Pharmacy" };

interface Order {
  id: string;
  patient_id: string;
  admission_id: string;
  drug_name: string;
  dose: number;
  dose_unit: string;
  route: string;
  frequency: string;
  is_prn: boolean;
  prn_indication: string | null;
  instructions: string | null;
  prescribed_at: string;
  allergy_override_reason: string | null;
  interaction_override_reason: string | null;
  status: string;
  prescriber: { full_name: string } | null;
  edoshmis_patients: { first_name: string; middle_name: string | null; last_name: string; hospital_number: string } | null;
  edoshmis_admissions: { edoshmis_wards: { name: string } | null; edoshmis_beds: { bed_number: string } | null } | null;
  edoshmis_medication_dispenses: { id: string; quantity: number; unit: string; dispensed_at: string }[];
}

/**
 * The pharmacy's inpatient queue: prescriptions to verify, then to issue.
 * Verifying is a clinical check — the patient's allergies and any warning
 * the prescriber overrode are shown with the order — and nothing reaches the
 * ward's eMAR until it is done.
 */
export default async function PharmacyPage() {
  const s = await requireStaff();
  if (!can(s, "meds.verify")) return <EmptyState icon={Pill} title="Your role does not include the pharmacy." />;
  const supabase = await createClient();
  const cols =
    "id, patient_id, admission_id, drug_name, dose, dose_unit, route, frequency, is_prn, prn_indication, instructions, prescribed_at, allergy_override_reason, interaction_override_reason, status, prescriber:edoshmis_staff!edoshmis_medication_orders_prescribed_by_fkey(full_name), edoshmis_patients(first_name, middle_name, last_name, hospital_number), edoshmis_admissions(edoshmis_wards!edoshmis_admissions_current_ward_id_fkey(name), edoshmis_beds!edoshmis_admissions_current_bed_id_fkey(bed_number)), edoshmis_medication_dispenses(id, quantity, unit, dispensed_at)";
  const [{ data: toVerify }, { data: verified }] = await Promise.all([
    supabase.from("edoshmis_medication_orders").select(cols).eq("facility_id", s.facility.id).eq("status", "prescribed").order("prescribed_at"),
    supabase.from("edoshmis_medication_orders").select(cols).eq("facility_id", s.facility.id).eq("status", "verified").order("prescribed_at", { ascending: false }).limit(100),
  ]);
  const { data: opRx } = await supabase
    .from("edoshmis_outpatient_prescriptions")
    .select("id, patient_id, encounter_id, drug_name, dose, dose_unit, route, frequency, duration_days, quantity, instructions, allergy_override_reason, prescribed_at, prescriber:edoshmis_staff!edoshmis_outpatient_prescriptions_prescribed_by_fkey(full_name), edoshmis_patients(first_name, middle_name, last_name, hospital_number)")
    .eq("facility_id", s.facility.id)
    .eq("status", "prescribed")
    .order("prescribed_at");
  const outpatient = (opRx ?? []) as unknown as {
    id: string; patient_id: string; encounter_id: string; drug_name: string; dose: number; dose_unit: string; route: string; frequency: string; duration_days: number | null; quantity: number;
    instructions: string | null; allergy_override_reason: string | null; prescribed_at: string; prescriber: { full_name: string } | null;
    edoshmis_patients: { first_name: string; middle_name: string | null; last_name: string; hospital_number: string } | null;
  }[];
  const queue = (toVerify ?? []) as unknown as Order[];
  const issue = (verified ?? []) as unknown as Order[];

  const patientIds = [...new Set([...queue, ...issue, ...outpatient].map((o) => o.patient_id))];
  const { data: allergies } = patientIds.length
    ? await supabase.from("edoshmis_patient_allergies").select("patient_id, substance, severity").in("patient_id", patientIds).eq("status", "active")
    : { data: [] };
  const allergyBy = new Map<string, string[]>();
  for (const a of allergies ?? []) (allergyBy.get(a.patient_id) ?? allergyBy.set(a.patient_id, []).get(a.patient_id)!).push(`${a.substance} (${a.severity.replace(/_/g, " ")})`);

  const row = (o: Order) => (
    <div className="min-w-0">
      <p className="font-medium">
        {o.drug_name} <span className="font-normal text-ink-soft">{Number(o.dose)} {o.dose_unit} · {o.route.toUpperCase()} · {o.frequency.toUpperCase()}</span>
      </p>
      {o.is_prn && o.prn_indication && <p className="text-xs text-ink-soft">PRN for {o.prn_indication}</p>}
      {o.instructions && <p className="text-xs text-ink-soft">{o.instructions}</p>}
      <p className="text-xs text-ink-faint">
        <Link href={`/ipd/admissions/${o.admission_id}?tab=meds`} className="text-brand hover:underline">
          {o.edoshmis_patients ? fullName(o.edoshmis_patients) : "Patient"}
        </Link>{" "}
        · {o.edoshmis_patients?.hospital_number} · {o.edoshmis_admissions?.edoshmis_wards?.name ?? "—"} bed {o.edoshmis_admissions?.edoshmis_beds?.bed_number ?? "—"} · {o.prescriber?.full_name}, {fmtDateTime(o.prescribed_at)}
      </p>
      {allergyBy.get(o.patient_id) && (
        <p className="mt-1 flex items-center gap-1 text-xs font-medium text-critical-ink">
          <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Allergies: {allergyBy.get(o.patient_id)!.join(", ")}
        </p>
      )}
      {(o.allergy_override_reason || o.interaction_override_reason) && (
        <p className="mt-1 text-xs text-attention-ink">Prescriber overrode a warning: {[o.allergy_override_reason, o.interaction_override_reason].filter(Boolean).join("; ")}</p>
      )}
    </div>
  );

  return (
    <>
      <PageHeader title="Pharmacy" description="Inpatient prescriptions to verify and issue, and outpatient prescriptions to dispense." />
      <Card className="mb-5">
        <CardHeader title={`Outpatient prescriptions · ${outpatient.length}`} icon={Pill} />
        {outpatient.length === 0 ? (
          <EmptyState icon={Pill} title="No outpatient prescriptions waiting" />
        ) : (
          <ul className="divide-y divide-line">
            {outpatient.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 px-4 py-3 text-sm sm:px-5">
                <div>
                  <p className="font-medium">
                    {r.drug_name}{" "}
                    <span className="font-normal text-ink-soft">
                      {Number(r.dose)} {r.dose_unit} · {r.route.toUpperCase()} · {r.frequency.toUpperCase()}
                      {r.duration_days ? ` × ${r.duration_days} d` : ""} · qty {Number(r.quantity)}
                    </span>
                  </p>
                  {r.instructions && <p className="text-xs text-ink-soft">{r.instructions}</p>}
                  <p className="text-xs text-ink-faint">
                    <Link href={`/visits/${r.encounter_id}`} className="text-brand hover:underline">
                      {r.edoshmis_patients ? fullName(r.edoshmis_patients) : "Patient"}
                    </Link>{" "}
                    · {r.edoshmis_patients?.hospital_number} · {r.prescriber?.full_name}, {fmtDateTime(r.prescribed_at)}
                  </p>
                  {allergyBy.get(r.patient_id) && (
                    <p className="mt-1 flex items-center gap-1 text-xs font-medium text-critical-ink">
                      <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Allergies: {allergyBy.get(r.patient_id)!.join(", ")}
                    </p>
                  )}
                  {r.allergy_override_reason && <p className="mt-1 text-xs text-attention-ink">Prescriber overrode an allergy warning: {r.allergy_override_reason}</p>}
                </div>
                <Disclosure label="Dispense" variant="primary">
                  <ActionForm action={dispenseOutpatient.bind(null, r.id)} submitLabel="Dispensed">
                    <div className="grid grid-cols-3 gap-3">
                      <Field label="Quantity">
                        <Input name="quantity" inputMode="decimal" defaultValue={String(Number(r.quantity))} />
                      </Field>
                      <Field label="Batch">
                        <Input name="batch_number" />
                      </Field>
                      <Field label="Expiry">
                        <Input name="expiry_date" type="date" />
                      </Field>
                    </div>
                  </ActionForm>
                </Disclosure>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title={`To verify · ${queue.length}`} icon={Pill} />
          {queue.length === 0 ? (
            <EmptyState icon={Pill} title="Nothing to verify" />
          ) : (
            <ul className="divide-y divide-line">
              {queue.map((o) => (
                <li key={o.id} className="flex flex-col gap-2 px-4 py-3 text-sm sm:px-5">
                  {row(o)}
                  <div className="flex flex-wrap gap-2">
                    <Disclosure label="Verify" variant="primary">
                      <ActionForm action={verifyOrder.bind(null, o.id, true)} submitLabel="Verify">
                        <Field label="Note (optional)">
                          <Input name="note" />
                        </Field>
                      </ActionForm>
                    </Disclosure>
                    <Disclosure label="Query / reject" variant="danger">
                      <ActionForm action={verifyOrder.bind(null, o.id, false)} submitLabel="Return to prescriber" submitVariant="danger">
                        <Field label="Why" required hint="The prescriber sees this on the medication chart">
                          <Textarea name="note" required className="min-h-16" />
                        </Field>
                      </ActionForm>
                    </Disclosure>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title={`Verified · issue to ward`} icon={PackageCheck} />
          {issue.length === 0 ? (
            <EmptyState icon={PackageCheck} title="No verified orders" />
          ) : (
            <ul className="divide-y divide-line">
              {issue.map((o) => (
                <li key={o.id} className="flex flex-col gap-2 px-4 py-3 text-sm sm:px-5">
                  <div className="flex items-start justify-between gap-2">
                    {row(o)}
                    {o.edoshmis_medication_dispenses.length > 0 ? (
                      <Badge tone="positive">
                        Issued {o.edoshmis_medication_dispenses.reduce((n, d) => n + Number(d.quantity), 0)} {o.edoshmis_medication_dispenses[0].unit}
                      </Badge>
                    ) : (
                      <Badge tone="attention">Not issued</Badge>
                    )}
                  </div>
                  <Disclosure label="Issue" variant="secondary">
                    <ActionForm action={dispense.bind(null, o.id)} submitLabel="Record issue">
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Quantity" required>
                          <Input name="quantity" inputMode="decimal" required />
                        </Field>
                        <Field label="Unit">
                          <Input name="unit" defaultValue={o.dose_unit} />
                        </Field>
                        <Field label="Batch">
                          <Input name="batch_number" />
                        </Field>
                        <Field label="Expiry" hint="Expired stock is refused">
                          <Input name="expiry_date" type="date" />
                        </Field>
                      </div>
                    </ActionForm>
                  </Disclosure>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
