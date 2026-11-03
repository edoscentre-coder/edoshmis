import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, BedDouble, CheckCircle2, HeartPulse, IdCard, Plus, ShieldAlert, ShieldCheck, Stethoscope, Users } from "lucide-react";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Badge, Card, CardBody, CardHeader, Disclosure, Fact, Field, Input, PageHeader, Select, Textarea } from "@/components/ui/primitives";
import { ActionButton, ActionForm } from "@/components/ui/action-form";
import { can, requireStaff } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { ageOf, fmtDate, fmtDateTime, fullName, lengthOfStay, titleCase, todayNairobi } from "@/lib/format";
import { addAlert, addAllergy, addCoverage, addHistory, markNoKnownAllergies, requestAdmission, resolveAlert, setAllergyStatus } from "../actions";
import { bookAppointment, checkIn } from "../../opd/actions";
import { TRIAGE } from "@/components/opd/queue-board";
import { nairobiLocalInput } from "@/lib/format";

export const metadata: Metadata = { title: "Patient" };

const STATUS_TONE: Record<string, "brand" | "positive" | "neutral" | "critical" | "attention"> = {
  active: "brand",
  discharge_in_progress: "attention",
  discharged: "positive",
  discharged_ama: "attention",
  transferred_out: "neutral",
  deceased: "neutral",
  absconded: "critical",
};

export default async function PatientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ registered?: string }> }) {
  const s = await requireStaff();
  const { id } = await params;
  const { registered } = await searchParams;
  const supabase = await createClient();

  const { data: p } = await supabase.from("edoshmis_patients").select("*").eq("id", id).maybeSingle();
  if (!p) notFound();
  await supabase.rpc("edoshmis_log_access", { p_patient: id, p_facility: s.facility.id, p_context: "patient_record" });

  const clinical = can(s, "patients.clinical");
  const [ids, contacts, coverage, allergies, history, alerts, admissions, requests, wards, consultants] = await Promise.all([
    supabase.from("edoshmis_patient_identifiers").select("id, id_type, value").eq("patient_id", id),
    supabase.from("edoshmis_patient_contacts").select("*").eq("patient_id", id).order("is_primary", { ascending: false }),
    supabase.from("edoshmis_patient_coverage").select("*").eq("patient_id", id).eq("is_active", true),
    clinical ? supabase.from("edoshmis_patient_allergies").select("*").eq("patient_id", id).eq("status", "active").order("created_at") : null,
    clinical ? supabase.from("edoshmis_patient_history").select("*").eq("patient_id", id).eq("status", "active").order("created_at") : null,
    supabase.from("edoshmis_patient_alerts").select("*").eq("patient_id", id).eq("is_active", true).order("created_at"),
    can(s, "ipd.read", "billing.read")
      ? supabase
          .from("edoshmis_admissions")
          .select("id, admission_number, admitted_at, discharged_at, status, edoshmis_wards!edoshmis_admissions_current_ward_id_fkey(name), edoshmis_facilities(name)")
          .eq("patient_id", id)
          .order("admitted_at", { ascending: false })
      : null,
    can(s, "ipd.read", "ipd.request_admission")
      ? supabase.from("edoshmis_admission_requests").select("id, status, requested_at, provisional_diagnosis").eq("patient_id", id).in("status", ["pending", "approved"])
      : null,
    can(s, "ipd.request_admission") ? supabase.from("edoshmis_wards").select("id, name").eq("facility_id", s.facility.id).neq("status", "closed").order("sort_order") : null,
    can(s, "ipd.request_admission")
      ? supabase.from("edoshmis_staff").select("id, full_name").eq("organization_id", s.staff.organizationId).eq("status", "active").eq("designation", "consultant").order("full_name")
      : null,
  ]);

  const current = admissions?.data?.find((a) => a.status === "active" || a.status === "discharge_in_progress");
  const [openVisit, depts, clinicians, upcoming] = await Promise.all([
    can(s, "opd.read") ? supabase.from("edoshmis_encounters").select("id, kind, encounter_number, stage").eq("patient_id", id).eq("facility_id", s.facility.id).eq("status", "open").in("kind", ["opd", "emergency"]).maybeSingle() : null,
    can(s, "opd.register") ? supabase.from("edoshmis_departments").select("id, name").eq("facility_id", s.facility.id).eq("is_active", true).order("name") : null,
    can(s, "opd.register") ? supabase.from("edoshmis_staff").select("id, full_name, designation").eq("organization_id", s.staff.organizationId).eq("status", "active").in("designation", ["consultant", "medical_officer", "clinical_officer", "paediatrician"]).order("full_name") : null,
    can(s, "opd.read") ? supabase.from("edoshmis_appointments").select("id, scheduled_at, status, reason").eq("patient_id", id).eq("status", "booked").gte("scheduled_at", todayNairobi()).order("scheduled_at").limit(5) : null,
  ]);
  const openRequest = requests?.data?.[0];
  const allergyList = allergies?.data ?? [];

  return (
    <>
      <Breadcrumbs trail={[{ label: "Patients", href: "/patients" }, { label: fullName(p) }]} />
      {registered && (
        <p className="mb-4 flex items-center gap-2 rounded-lg bg-positive-soft px-3 py-2 text-sm text-positive-ink">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          Registered as {p.hospital_number}.
        </p>
      )}
      <PageHeader
        eyebrow={<span className="tnum">{p.hospital_number}</span>}
        title={fullName(p)}
        description={`${ageOf(p.date_of_birth, p.dob_estimated)} · ${titleCase(p.sex)}${p.date_of_birth ? ` · born ${fmtDate(p.date_of_birth)}${p.dob_estimated ? " (estimated)" : ""}` : ""}${p.phone ? ` · ${p.phone}` : ""}`}
        actions={
          <>
            {p.is_deceased && <Badge>Deceased {fmtDate(p.deceased_at)}</Badge>}
            {current && (
              <Link href={`/ipd/admissions/${current.id}`} className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand-dark">
                <BedDouble className="h-4 w-4" aria-hidden="true" />
                Open inpatient record
              </Link>
            )}
          </>
        }
      />

      {/* Safety strip: alerts and allergies, before anything else. */}
      {(alerts.data?.length || (clinical && (allergyList.length || p.allergies_reviewed !== "nkda"))) && (
        <div className="mb-5 flex flex-col gap-2">
          {alerts.data?.map((a) => (
            <div
              key={a.id}
              className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-2.5 text-sm ${a.severity === "critical" ? "border-critical/30 bg-critical-soft text-critical-ink" : a.severity === "warning" ? "border-attention/40 bg-attention-soft text-attention-ink" : "border-info/30 bg-info-soft text-info-ink"}`}
            >
              <span className="flex items-start gap-2">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {a.message}
              </span>
              {clinical && <ActionButton action={resolveAlert.bind(null, a.id)} variant="ghost">Resolve</ActionButton>}
            </div>
          ))}
          {clinical &&
            (allergyList.length ? (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-critical/30 bg-critical-soft px-4 py-2.5 text-sm text-critical-ink">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                <strong>Allergies:</strong>
                {allergyList.map((a) => (
                  <span key={a.id}>
                    {a.substance} ({a.severity.replace(/_/g, " ")}
                    {a.reaction ? ` — ${a.reaction}` : ""})
                  </span>
                ))}
              </div>
            ) : p.allergies_reviewed === "nkda" ? null : (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-attention/40 bg-attention-soft px-4 py-2.5 text-sm text-attention-ink">
                <span className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                  Allergy status not recorded. Ask, then record allergies or “no known allergies”.
                </span>
                <ActionButton action={markNoKnownAllergies.bind(null, id)} variant="secondary">
                  No known allergies
                </ActionButton>
              </div>
            ))}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader title="Demographics" icon={IdCard} />
            <CardBody>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                <Fact label="Hospital number">{p.hospital_number}</Fact>
                {(ids.data ?? []).map((i) => (
                  <Fact key={i.id} label={titleCase(i.id_type)}>
                    {i.value}
                  </Fact>
                ))}
                <Fact label="Phone">{[p.phone, p.phone_alt].filter(Boolean).join(", ")}</Fact>
                <Fact label="County">{[p.county, p.sub_county].filter(Boolean).join(", ")}</Fact>
                <Fact label="Address">{p.address}</Fact>
                <Fact label="Occupation">{p.occupation}</Fact>
                <Fact label="Marital status">{p.marital_status}</Fact>
                <Fact label="Blood group">{p.blood_group}</Fact>
                <Fact label="Consent">
                  {p.consent_data_processing ? `Data: yes (${fmtDate(p.consent_recorded_at)})` : "Not recorded"}
                  {p.consent_sms ? " · SMS: yes" : " · SMS: no"}
                </Fact>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Contacts" icon={Users} />
            {contacts.data?.length ? (
              <ul className="divide-y divide-line">
                {contacts.data.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm">
                    <span>
                      <span className="font-medium">{c.full_name}</span>
                      <span className="text-ink-faint"> · {c.relationship ?? titleCase(c.kind)}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge>{titleCase(c.kind)}</Badge>
                      {c.phone && (
                        <a href={`tel:${c.phone}`} className="tnum text-brand hover:underline">
                          {c.phone}
                        </a>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <CardBody className="text-sm text-ink-faint">No next of kin or emergency contact recorded.</CardBody>
            )}
          </Card>

          {clinical && (
            <Card>
              <CardHeader
                title="Medical history"
                icon={Stethoscope}
                actions={
                  <Disclosure label="Add" icon={Plus}>
                    <ActionForm action={addHistory.bind(null, id)} submitLabel="Add to history">
                      <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
                        <Field label="Kind">
                          <Select name="kind" defaultValue="medical">
                            {["medical", "surgical", "chronic", "family", "social", "obstetric", "other"].map((k) => (
                              <option key={k} value={k}>
                                {titleCase(k)}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="Description" required>
                          <Input name="description" required placeholder="e.g. Hypertension, on amlodipine" />
                        </Field>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="ICD-10" hint="Optional">
                          <Input name="icd10_code" className="uppercase" placeholder="I10" />
                        </Field>
                        <Field label="Since">
                          <Input name="onset" placeholder="e.g. 2019" />
                        </Field>
                      </div>
                    </ActionForm>
                  </Disclosure>
                }
              />
              {history?.data?.length ? (
                <ul className="divide-y divide-line">
                  {history.data.map((h) => (
                    <li key={h.id} className="flex items-start justify-between gap-3 px-5 py-2.5 text-sm">
                      <span>
                        {h.description}
                        {h.icd10_code && <span className="tnum ml-1.5 text-xs text-ink-faint">{h.icd10_code}</span>}
                        {h.onset && <span className="block text-xs text-ink-faint">Since {h.onset}</span>}
                      </span>
                      <Badge>{titleCase(h.kind)}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <CardBody className="text-sm text-ink-faint">Nothing recorded.</CardBody>
              )}
            </Card>
          )}

          {admissions && (
            <Card>
              <CardHeader title="Admissions" icon={BedDouble} />
              {admissions.data?.length ? (
                <ul className="divide-y divide-line">
                  {admissions.data.map((a) => (
                    <li key={a.id}>
                      <Link href={`/ipd/admissions/${a.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm hover:bg-surface-sunk">
                        <span>
                          <span className="tnum font-medium">{a.admission_number}</span>
                          <span className="block text-xs text-ink-faint">
                            {fmtDate(a.admitted_at)} → {a.discharged_at ? fmtDate(a.discharged_at) : "now"} · {lengthOfStay(a.admitted_at, a.discharged_at)} day(s) ·{" "}
                            {(a.edoshmis_wards as unknown as { name: string } | null)?.name ?? (a.edoshmis_facilities as unknown as { name: string } | null)?.name}
                          </span>
                        </span>
                        <Badge tone={STATUS_TONE[a.status] ?? "neutral"}>{titleCase(a.status)}</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <CardBody className="text-sm text-ink-faint">No admissions.</CardBody>
              )}
            </Card>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          {can(s, "opd.read") && !current && !p.is_deceased && (
            <Card>
              <CardHeader title="Visit" icon={Stethoscope} />
              <CardBody className="flex flex-col gap-3">
                {openVisit?.data ? (
                  <Link href={`/visits/${openVisit.data.id}`} className="rounded-lg border border-brand/30 bg-brand-tint px-3 py-2 text-sm font-medium text-brand-darker">
                    Open {openVisit.data.kind === "emergency" ? "emergency" : "outpatient"} visit {openVisit.data.encounter_number} — {titleCase(openVisit.data.stage)}
                  </Link>
                ) : (
                  can(s, "opd.register") && (
                    <Disclosure label="Check in" variant="primary" size="md">
                      <ActionForm action={checkIn.bind(null, id)} submitLabel="Check in">
                        <div className="grid grid-cols-2 gap-3">
                          <Field label="Visit">
                            <Select name="kind" defaultValue="opd">
                              <option value="opd">Outpatient</option>
                              <option value="emergency">Emergency</option>
                            </Select>
                          </Field>
                          <Field label="Payment">
                            <Select name="payment_category" defaultValue={coverage.data?.some((c) => c.payer_type === "sha") ? "sha" : "cash"}>
                              <option value="cash">Cash / M-Pesa</option>
                              <option value="sha">SHA</option>
                              <option value="insurance">Insurance</option>
                              <option value="corporate">Corporate</option>
                              <option value="waiver">Waiver</option>
                            </Select>
                          </Field>
                          <Field label="Clinic / department">
                            <Select name="department_id" defaultValue="">
                              <option value="">General</option>
                              {depts?.data?.map((d) => (
                                <option key={d.id} value={d.id}>
                                  {d.name}
                                </option>
                              ))}
                            </Select>
                          </Field>
                          <Field label="Emergency triage" hint="If assessed at the door">
                            <Select name="triage_category" defaultValue="">
                              <option value="">—</option>
                              {Object.entries(TRIAGE).map(([k, t]) => (
                                <option key={k} value={k}>
                                  {t.label}
                                </option>
                              ))}
                            </Select>
                          </Field>
                        </div>
                        <Field label="Complaint">
                          <Input name="chief_complaint" />
                        </Field>
                        <Field label="Arrived by" hint="Emergency only">
                          <Select name="arrival_mode" defaultValue="">
                            <option value="">—</option>
                            <option value="walk_in">Walked in</option>
                            <option value="ambulance">Ambulance</option>
                            <option value="private_vehicle">Private vehicle</option>
                            <option value="police">Police</option>
                            <option value="referral">Referral</option>
                          </Select>
                        </Field>
                      </ActionForm>
                    </Disclosure>
                  )
                )}
                {upcoming?.data && upcoming.data.length > 0 && (
                  <ul className="text-sm">
                    {upcoming.data.map((a) => (
                      <li key={a.id} className="text-ink-soft">
                        Appointment {fmtDateTime(a.scheduled_at)}
                        {a.reason ? ` — ${a.reason}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
                {can(s, "opd.register") && (
                  <Disclosure label="Book appointment">
                    <ActionForm action={bookAppointment.bind(null, id)} submitLabel="Book">
                      <Field label="When" required>
                        <Input name="scheduled_at" type="datetime-local" required defaultValue={nairobiLocalInput()} />
                      </Field>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Clinic">
                          <Select name="department_id" defaultValue="">
                            <option value="">General</option>
                            {depts?.data?.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.name}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="With">
                          <Select name="clinician_id" defaultValue="">
                            <option value="">Any clinician</option>
                            {clinicians?.data?.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.full_name}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      </div>
                      <Field label="Reason">
                        <Input name="reason" />
                      </Field>
                    </ActionForm>
                  </Disclosure>
                )}
              </CardBody>
            </Card>
          )}
          {can(s, "ipd.request_admission") && !current && !p.is_deceased && (
            <Card>
              <CardHeader title="Admit" icon={BedDouble} />
              <CardBody>
                {openRequest ? (
                  <p className="text-sm text-ink-soft">
                    Admission {openRequest.status === "pending" ? "requested" : "approved"} {fmtDateTime(openRequest.requested_at)} for{" "}
                    <strong>{openRequest.provisional_diagnosis}</strong>.{" "}
                    <Link href="/ipd/admissions" className="text-brand hover:underline">
                      See the queue
                    </Link>
                  </p>
                ) : (
                  <Disclosure label="Request admission" variant="primary" size="md">
                    <ActionForm action={requestAdmission.bind(null, id)} submitLabel="Send request">
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="From" required>
                          <Select name="source" defaultValue="opd">
                            <option value="opd">Outpatients</option>
                            <option value="emergency">Emergency</option>
                            <option value="theatre">Theatre / recovery</option>
                            <option value="referral">Referral in</option>
                            <option value="direct">Direct (consultant)</option>
                            <option value="transfer_in">Transfer from another facility</option>
                          </Select>
                        </Field>
                        <Field label="Priority">
                          <Select name="priority" defaultValue="urgent">
                            <option value="emergency">Emergency</option>
                            <option value="urgent">Urgent</option>
                            <option value="elective">Elective</option>
                          </Select>
                        </Field>
                      </div>
                      <div className="grid grid-cols-[1fr_96px] gap-3">
                        <Field label="Provisional diagnosis" required>
                          <Input name="provisional_diagnosis" required />
                        </Field>
                        <Field label="ICD-10">
                          <Input name="provisional_icd10" className="uppercase" placeholder="J18.9" pattern="[A-Za-z][0-9]{2}(\.[0-9A-Za-z]{1,4})?" />
                        </Field>
                      </div>
                      <Field label="Why admit" required>
                        <Textarea name="indication" required className="min-h-20" />
                      </Field>
                      <Field label="History">
                        <Textarea name="clinical_history" className="min-h-16" />
                      </Field>
                      <Field label="Initial assessment">
                        <Textarea name="initial_assessment" className="min-h-16" />
                      </Field>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Preferred ward">
                          <Select name="preferred_ward_id" defaultValue="">
                            <option value="">Any</option>
                            {wards?.data?.map((w) => (
                              <option key={w.id} value={w.id}>
                                {w.name}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="Consultant">
                          <Select name="responsible_consultant_id" defaultValue="">
                            <option value="">To be assigned</option>
                            {consultants?.data?.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.full_name}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Payment">
                          <Select name="payment_category" defaultValue={coverage.data?.some((c) => c.payer_type === "sha") ? "sha" : "cash"}>
                            <option value="cash">Cash / M-Pesa</option>
                            <option value="sha">SHA</option>
                            <option value="insurance">Private insurance</option>
                            <option value="corporate">Corporate</option>
                            <option value="waiver">Waiver</option>
                          </Select>
                        </Field>
                        <Field label="Accompanied by">
                          <Input name="accompanying_person" />
                        </Field>
                      </div>
                      <Field label="Referring facility">
                        <Input name="referring_facility" />
                      </Field>
                    </ActionForm>
                  </Disclosure>
                )}
              </CardBody>
            </Card>
          )}

          {clinical && (
            <Card>
              <CardHeader
                title="Allergies"
                icon={HeartPulse}
                actions={
                  <Disclosure label="Add" icon={Plus}>
                    <ActionForm action={addAllergy.bind(null, id)} submitLabel="Record allergy">
                      <Field label="Substance" required hint="Drug name or class, e.g. Penicillin">
                        <Input name="substance" required />
                      </Field>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Type">
                          <Select name="category" defaultValue="drug">
                            <option value="drug">Drug</option>
                            <option value="food">Food</option>
                            <option value="environmental">Environmental</option>
                            <option value="other">Other</option>
                          </Select>
                        </Field>
                        <Field label="Severity">
                          <Select name="severity" defaultValue="unknown">
                            <option value="mild">Mild</option>
                            <option value="moderate">Moderate</option>
                            <option value="severe">Severe</option>
                            <option value="life_threatening">Life-threatening</option>
                            <option value="unknown">Unknown</option>
                          </Select>
                        </Field>
                      </div>
                      <Field label="Reaction">
                        <Input name="reaction" placeholder="e.g. Rash, anaphylaxis" />
                      </Field>
                    </ActionForm>
                  </Disclosure>
                }
              />
              {allergyList.length ? (
                <ul className="divide-y divide-line">
                  {allergyList.map((a) => (
                    <li key={a.id} className="flex items-start justify-between gap-2 px-5 py-2.5 text-sm">
                      <span>
                        <span className="font-medium">{a.substance}</span>
                        <span className="block text-xs text-ink-faint">
                          {titleCase(a.category)} · {titleCase(a.severity)}
                          {a.reaction ? ` · ${a.reaction}` : ""}
                        </span>
                      </span>
                      <ActionButton action={setAllergyStatus.bind(null, a.id)} hidden={{ status: "entered_in_error" }} variant="ghost" confirm="Mark this allergy as entered in error?">
                        Entered in error
                      </ActionButton>
                    </li>
                  ))}
                </ul>
              ) : (
                <CardBody className="text-sm text-ink-faint">
                  {p.allergies_reviewed === "nkda" ? "No known allergies (asked)." : "Not yet recorded."}
                </CardBody>
              )}
            </Card>
          )}

          <Card>
            <CardHeader
              title="Cover"
              icon={ShieldCheck}
              description="SHA and insurance. Verified by hand until an approved payer integration is connected."
              actions={
                can(s, "patients.edit") && (
                  <Disclosure label="Add" icon={Plus}>
                    <ActionForm action={addCoverage.bind(null, id)} submitLabel="Save cover">
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Payer type">
                          <Select name="payer_type" defaultValue="sha">
                            <option value="sha">SHA</option>
                            <option value="private_insurance">Private insurance</option>
                            <option value="corporate">Corporate</option>
                            <option value="nhif_legacy">NHIF (legacy record)</option>
                          </Select>
                        </Field>
                        <Field label="Payer name">
                          <Input name="payer_name" placeholder="SHA, or the insurer" />
                        </Field>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Member number" required>
                          <Input name="member_number" required />
                        </Field>
                        <Field label="Valid to">
                          <Input name="valid_to" type="date" />
                        </Field>
                      </div>
                      <Field label="Principal member">
                        <Input name="principal_name" />
                      </Field>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="verified" className="h-4 w-4 accent-brand" /> I have checked this with the payer
                      </label>
                      <Field label="How it was checked">
                        <Input name="verification_note" placeholder="e.g. SHA portal, eligibility confirmed" />
                      </Field>
                    </ActionForm>
                  </Disclosure>
                )
              }
            />
            {coverage.data?.length ? (
              <ul className="divide-y divide-line">
                {coverage.data.map((c) => (
                  <li key={c.id} className="flex items-start justify-between gap-2 px-5 py-2.5 text-sm">
                    <span>
                      <span className="font-medium">{c.payer_name}</span>
                      <span className="tnum block text-xs text-ink-faint">
                        {c.member_number}
                        {c.valid_to ? ` · to ${fmtDate(c.valid_to)}` : ""}
                      </span>
                    </span>
                    {c.verified_at ? <Badge tone="positive">Verified {fmtDate(c.verified_at)}</Badge> : <Badge tone="attention">Not verified</Badge>}
                  </li>
                ))}
              </ul>
            ) : (
              <CardBody className="text-sm text-ink-faint">Cash patient — no cover recorded.</CardBody>
            )}
          </Card>

          {clinical && (
            <Card>
              <CardHeader
                title="Alerts"
                icon={ShieldAlert}
                actions={
                  <Disclosure label="Add" icon={Plus}>
                    <ActionForm action={addAlert.bind(null, id)} submitLabel="Add alert">
                      <Field label="Severity">
                        <Select name="severity" defaultValue="warning">
                          <option value="info">Information</option>
                          <option value="warning">Warning</option>
                          <option value="critical">Critical</option>
                        </Select>
                      </Field>
                      <Field label="Alert" required hint="Shown at the top of the record to everyone who opens it">
                        <Input name="message" required placeholder="e.g. Same name as another inpatient — check hospital number" />
                      </Field>
                    </ActionForm>
                  </Disclosure>
                }
              />
              <CardBody className="text-sm text-ink-faint">{alerts.data?.length ? `${alerts.data.length} active, shown above.` : "None."}</CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
