import type { Metadata } from "next";
import Link from "next/link";
import { BedDouble, ClipboardList } from "lucide-react";
import { Badge, Card, CardHeader, Disclosure, EmptyState, Field, Input, PageHeader, Select, Textarea } from "@/components/ui/primitives";
import { ActionForm } from "@/components/ui/action-form";
import { can, requireStaff } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { ageOf, fmtDateTime, fullName, titleCase } from "@/lib/format";
import { admit, cancelRequest, decideRequest } from "../actions";

export const metadata: Metadata = { title: "Admissions" };

interface Req {
  id: string;
  status: string;
  source: string;
  priority: string;
  provisional_diagnosis: string;
  provisional_icd10: string | null;
  indication: string;
  payment_category: string;
  requested_at: string;
  decision_note: string | null;
  preferred_ward_id: string | null;
  edoshmis_patients: { id: string; first_name: string; middle_name: string | null; last_name: string; sex: string; date_of_birth: string | null; dob_estimated: boolean; hospital_number: string };
  requester: { full_name: string; designation: string } | null;
  consultant: { full_name: string } | null;
}

/**
 * The admission workflow, step by step:
 *   requested → clinically authorised (or rejected with a reason) → bed found → admitted.
 * The bed list offered for each request is only beds that are free now and
 * that the patient's sex may use; the database re-checks both on admit.
 */
export default async function AdmissionsQueue() {
  const s = await requireStaff();
  if (!can(s, "ipd.read", "ipd.request_admission")) return <EmptyState icon={ClipboardList} title="Your role does not include admissions." />;
  const supabase = await createClient();
  await supabase.rpc("edoshmis_expire_reservations", { p_facility: s.facility.id });

  const [{ data: reqs }, { data: beds }] = await Promise.all([
    supabase
      .from("edoshmis_admission_requests")
      .select(
        "id, status, source, priority, provisional_diagnosis, provisional_icd10, indication, payment_category, requested_at, decision_note, preferred_ward_id, edoshmis_patients(id, first_name, middle_name, last_name, sex, date_of_birth, dob_estimated, hospital_number), requester:edoshmis_staff!edoshmis_admission_requests_requested_by_fkey(full_name, designation), consultant:edoshmis_staff!edoshmis_admission_requests_responsible_consultant_id_fkey(full_name)",
      )
      .eq("facility_id", s.facility.id)
      .in("status", ["pending", "approved"])
      .order("requested_at"),
    supabase
      .from("edoshmis_beds")
      .select("id, bed_number, status, sex_restriction, is_isolation, ward_id, edoshmis_wards!edoshmis_beds_ward_id_fkey(name, sex_restriction, status), edoshmis_bed_reservations(request_id, status)")
      .eq("facility_id", s.facility.id)
      .eq("is_active", true)
      .in("status", ["available", "reserved"])
      .order("bed_number"),
  ]);
  const list = (reqs ?? []) as unknown as Req[];
  const pending = list.filter((r) => r.status === "pending");
  const approved = list.filter((r) => r.status === "approved");
  type Bed = { id: string; bed_number: string; status: string; sex_restriction: string; is_isolation: boolean; ward_id: string; edoshmis_wards: { name: string; sex_restriction: string; status: string }; edoshmis_bed_reservations: { request_id: string | null; status: string }[] };
  const freeBeds = (beds ?? []) as unknown as Bed[];

  const bedsFor = (r: Req) =>
    freeBeds
      .filter((b) => b.edoshmis_wards.status !== "closed")
      .filter((b) => b.status === "available" || b.edoshmis_bed_reservations.some((x) => x.status === "held" && x.request_id === r.id))
      .filter((b) => [b.sex_restriction, b.edoshmis_wards.sex_restriction].every((x) => x === "any" || x === r.edoshmis_patients.sex))
      .sort((a, b) => Number(b.ward_id === r.preferred_ward_id) - Number(a.ward_id === r.preferred_ward_id));

  return (
    <>
      <PageHeader title="Admissions" description="Requests to decide, and approved admissions waiting for a bed." />

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title={`To decide · ${pending.length}`} description="Clinical authorisation" icon={ClipboardList} />
          {pending.length === 0 ? (
            <EmptyState icon={ClipboardList} title="No requests waiting" />
          ) : (
            <ul className="divide-y divide-line">
              {pending.map((r) => (
                <li key={r.id} className="px-4 py-4 sm:px-5">
                  <RequestSummary r={r} />
                  <div className="mt-3 flex flex-wrap gap-2">
                    {can(s, "ipd.approve_admission") && (
                      <>
                        <Disclosure label="Approve" variant="primary">
                          <ActionForm action={decideRequest.bind(null, r.id, true)} submitLabel="Approve admission">
                            <Field label="Note (optional)">
                              <Input name="note" />
                            </Field>
                          </ActionForm>
                        </Disclosure>
                        <Disclosure label="Reject" variant="danger">
                          <ActionForm action={decideRequest.bind(null, r.id, false)} submitLabel="Reject" submitVariant="danger">
                            <Field label="Reason" required hint="The requesting clinician sees this">
                              <Textarea name="note" required className="min-h-16" />
                            </Field>
                          </ActionForm>
                        </Disclosure>
                      </>
                    )}
                    {can(s, "ipd.request_admission") && <CancelRequest id={r.id} />}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title={`Waiting for a bed · ${approved.length}`} description="Allocate a bed to admit" icon={BedDouble} />
          {approved.length === 0 ? (
            <EmptyState icon={BedDouble} title="Nobody waiting for a bed" />
          ) : (
            <ul className="divide-y divide-line">
              {approved.map((r) => {
                const options = bedsFor(r);
                return (
                  <li key={r.id} className="px-4 py-4 sm:px-5">
                    <RequestSummary r={r} />
                    <div className="mt-3 flex flex-wrap gap-2">
                      {can(s, "ipd.allocate_bed") &&
                        (options.length === 0 ? (
                          <p className="rounded-lg bg-attention-soft px-3 py-2 text-sm text-attention-ink">
                            No free bed this patient can use. Check the{" "}
                            <Link href="/ipd/beds" className="underline">
                              bed board
                            </Link>{" "}
                            — beds being cleaned come back when marked clean.
                          </p>
                        ) : (
                          <Disclosure label="Allocate bed and admit" variant="primary">
                            <ActionForm action={admit.bind(null, r.id)} submitLabel="Admit">
                              <Field label="Bed" required>
                                <Select name="bed_id" required defaultValue="">
                                  <option value="" disabled>
                                    Choose a free bed
                                  </option>
                                  {Object.entries(groupBy(options, (b) => b.edoshmis_wards.name)).map(([ward, bs]) => (
                                    <optgroup key={ward} label={ward}>
                                      {bs.map((b) => (
                                        <option key={b.id} value={b.id}>
                                          {b.bed_number}
                                          {b.status === "reserved" ? " (reserved for this patient)" : ""}
                                          {b.is_isolation ? " · isolation" : ""}
                                        </option>
                                      ))}
                                    </optgroup>
                                  ))}
                                </Select>
                              </Field>
                              <div className="grid grid-cols-2 gap-3">
                                <Field label="Category">
                                  <Select name="patient_category" defaultValue="general">
                                    <option value="general">General</option>
                                    <option value="private">Private</option>
                                    <option value="vip">VIP</option>
                                    <option value="staff">Staff</option>
                                  </Select>
                                </Field>
                                <Field label="Expected discharge">
                                  <Input name="expected_discharge_date" type="date" />
                                </Field>
                              </div>
                              <label className="flex items-center gap-2 text-sm">
                                <input type="checkbox" name="consent_obtained" className="h-4 w-4 accent-brand" /> Admission consent obtained
                              </label>
                              <Field label="Consent given by">
                                <Input name="consent_by" placeholder="Patient / guardian's name" />
                              </Field>
                              <Field label="Ward handover note">
                                <Textarea name="notes" className="min-h-16" />
                              </Field>
                            </ActionForm>
                          </Disclosure>
                        ))}
                      {can(s, "ipd.request_admission") && <CancelRequest id={r.id} />}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function RequestSummary({ r }: { r: Req }) {
  const p = r.edoshmis_patients;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/patients/${p.id}`} className="font-medium text-ink hover:text-brand">
          {fullName(p)}
        </Link>
        <span className="flex gap-1">
          <Badge tone={r.priority === "emergency" ? "critical" : r.priority === "urgent" ? "attention" : "neutral"}>{titleCase(r.priority)}</Badge>
          <Badge>{titleCase(r.source)}</Badge>
          <Badge tone="info">{titleCase(r.payment_category)}</Badge>
        </span>
      </div>
      <p className="tnum text-xs text-ink-faint">
        {p.hospital_number} · {ageOf(p.date_of_birth, p.dob_estimated)} · {titleCase(p.sex)} · requested {fmtDateTime(r.requested_at)} by {r.requester?.full_name ?? "—"}
      </p>
      <p className="text-sm">
        <strong className="font-medium">{r.provisional_diagnosis}</strong>
        {r.provisional_icd10 && <span className="tnum ml-1.5 text-xs text-ink-faint">{r.provisional_icd10}</span>}
      </p>
      <p className="text-sm text-ink-soft">{r.indication}</p>
      {r.consultant && <p className="text-xs text-ink-faint">Consultant: {r.consultant.full_name}</p>}
      {r.decision_note && <p className="text-xs text-ink-faint">Approval note: {r.decision_note}</p>}
    </div>
  );
}

function CancelRequest({ id }: { id: string }) {
  return (
    <Disclosure label="Cancel request" variant="ghost">
      <ActionForm action={cancelRequest.bind(null, id)} submitLabel="Cancel request" submitVariant="danger">
        <Field label="Reason" required>
          <Input name="note" required placeholder="e.g. Managed as outpatient, referred out" />
        </Field>
      </ActionForm>
    </Disclosure>
  );
}

function groupBy<T>(xs: T[], key: (x: T) => string) {
  return xs.reduce<Record<string, T[]>>((acc, x) => ((acc[key(x)] ??= []).push(x), acc), {});
}
