import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { Activity, AlertTriangle, BedDouble, DoorOpen, FileSignature, Lock, NotebookPen, PenLine, Pill, Stethoscope, Wallet } from "lucide-react";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Badge, Card, CardBody, CardHeader, Disclosure, EmptyState, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { ActionButton, ActionForm } from "@/components/ui/action-form";
import { Investigations } from "@/components/clinical/investigations";
import { AccountView } from "@/components/billing/account-view";
import { TRIAGE } from "@/components/opd/queue-board";
import { can, requireStaff } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { ageOf, fmtDateTime, fullName, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  addConsultationAddendum, addVisitDiagnosis, cancelOutpatientRx, closeVisit, prescribeOutpatient, recordTriage, requestAdmissionFromVisit, setStage, signConsultation, writeConsultation,
} from "../../opd/actions";

export const metadata: Metadata = { title: "Visit" };

const SECTIONS = [
  ["care", "Consultation"],
  ["triage", "Triage"],
  ["investigations", "Investigations"],
  ["bill", "Bill"],
] as const;

/**
 * One outpatient or emergency visit, start to finish, on one page: triage,
 * the doctor's consultation, diagnoses, prescriptions, investigations, the
 * bill, and how the visit ends — home, referred, or admitted through an
 * admission request that carries the visit with it.
 */
export default async function VisitPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const s = await requireStaff();
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const supabase = await createClient();
  const { data: v } = await supabase
    .from("edoshmis_encounters")
    .select("*, edoshmis_patients(id, hospital_number, first_name, middle_name, last_name, sex, date_of_birth, dob_estimated, phone, allergies_reviewed), clinician:edoshmis_staff!edoshmis_encounters_assigned_clinician_id_fkey(full_name), edoshmis_departments(name)")
    .eq("id", id)
    .maybeSingle();
  if (!v || !["opd", "emergency"].includes(v.kind)) notFound();
  await supabase.rpc("edoshmis_log_access", { p_patient: v.patient_id, p_facility: v.facility_id, p_context: "visit" });
  const p = v.edoshmis_patients as { id: string; hospital_number: string; first_name: string; middle_name: string | null; last_name: string; sex: string; date_of_birth: string | null; dob_estimated: boolean; phone: string | null; allergies_reviewed: string | null };
  const open = v.status === "open";
  const clinical = can(s, "opd.consult", "opd.triage");
  const consult = can(s, "opd.consult");
  const sections = SECTIONS.filter(([k]) => (k === "bill" ? can(s, "billing.read") : k === "triage" ? can(s, "opd.triage", "opd.consult") : clinical));
  const tab = (sections.find(([k]) => k === tabParam)?.[0] ?? sections[0]?.[0]) as string | undefined;

  const [{ data: allergies }, { data: alerts }, { data: account }] = await Promise.all([
    can(s, "patients.clinical") ? supabase.from("edoshmis_patient_allergies").select("substance, severity, reaction").eq("patient_id", p.id).eq("status", "active") : Promise.resolve({ data: null }),
    supabase.from("edoshmis_patient_alerts").select("severity, message").eq("patient_id", p.id).eq("is_active", true),
    supabase.from("edoshmis_billing_accounts").select("id").eq("encounter_id", id).is("admission_id", null).maybeSingle(),
  ]);
  const t = v.triage_category ? TRIAGE[v.triage_category] : null;

  return (
    <>
      <Breadcrumbs trail={[{ label: v.kind === "emergency" ? "Emergency" : "Outpatients", href: v.kind === "emergency" ? "/emergency" : "/opd" }, { label: fullName(p) }]} />
      <section className="mb-4 rounded-xl border border-line bg-surface shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 sm:px-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold sm:text-xl">
                <Link href={`/patients/${p.id}`} className="hover:text-brand">
                  {fullName(p)}
                </Link>
              </h1>
              {t && <span className={cn("rounded-md px-1.5 py-0.5 text-xs font-semibold", t.tone)}>{t.label}</span>}
              <Badge tone={open ? "brand" : "neutral"}>{open ? titleCase(v.stage) : `Closed · ${titleCase(v.outcome)}`}</Badge>
            </div>
            <p className="tnum mt-0.5 text-xs text-ink-soft">
              {p.hospital_number} · {ageOf(p.date_of_birth, p.dob_estimated)} · {titleCase(p.sex)} · {v.encounter_number}
              {v.queue_number != null ? ` · queue ${v.kind === "emergency" ? "E" : ""}${v.queue_number}` : ""} · arrived {fmtDateTime(v.started_at)}
            </p>
            {v.chief_complaint && <p className="mt-1 text-sm text-ink-soft">{v.chief_complaint}</p>}
          </div>
          <div className="text-right text-xs text-ink-soft">
            {(v.clinician as { full_name: string } | null)?.full_name && <p>With {(v.clinician as { full_name: string }).full_name}</p>}
            {(v.edoshmis_departments as { name: string } | null)?.name && <p>{(v.edoshmis_departments as { name: string }).name}</p>}
            <p>{titleCase(v.payment_category)}</p>
          </div>
        </div>
        {(allergies || alerts?.length) && (
          <div className="flex flex-col gap-1 border-t border-line px-4 py-2 text-sm sm:px-5">
            {allergies &&
              (allergies.length ? (
                <p className="flex items-center gap-1.5 font-medium text-critical-ink">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" /> Allergies: {allergies.map((a) => `${a.substance} (${a.severity.replace(/_/g, " ")})`).join(" · ")}
                </p>
              ) : (
                <p className={cn("text-xs", p.allergies_reviewed === "nkda" ? "text-positive-ink" : "text-attention-ink")}>
                  {p.allergies_reviewed === "nkda" ? "No known allergies (asked)" : "Allergy status not recorded — ask before prescribing"}
                </p>
              ))}
            {alerts?.map((a, i) => (
              <p key={i} className="text-xs text-attention-ink">
                {a.message}
              </p>
            ))}
          </div>
        )}
      </section>

      {sections.length === 0 ? (
        <Card>
          <EmptyState icon={Lock} title="The clinical record of this visit is for the clinical team" />
        </Card>
      ) : (
        <>
          <nav className="-mx-4 mb-5 overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label="Sections">
            <ul className="flex min-w-max gap-1 border-b border-line">
              {sections.map(([k, label]) => (
                <li key={k}>
                  <Link
                    href={`/visits/${id}?tab=${k}`}
                    aria-current={k === tab ? "page" : undefined}
                    className={cn("-mb-px inline-flex h-10 items-center border-b-2 px-3 text-sm whitespace-nowrap", k === tab ? "border-brand font-medium text-brand-darker" : "border-transparent text-ink-soft hover:text-ink")}
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {tab === "care" && <CareSection s={s} visit={v} patientId={p.id} open={open} consult={consult} />}
          {tab === "triage" && <TriageSection s={s} visit={v} open={open} />}
          {tab === "investigations" && <Investigations s={s} encounterId={id} patientSex={p.sex} open={open} />}
          {tab === "bill" && (account ? <AccountView s={s} accountId={account.id} admissionId={null} /> : <EmptyState icon={Wallet} title="No bill for this visit" />)}
        </>
      )}
    </>
  );
}

type V = Record<string, unknown> & { id: string; facility_id: string; kind: string; stage: string; status: string };

async function CareSection({ s, visit: v, patientId, open, consult }: { s: Awaited<ReturnType<typeof requireStaff>>; visit: V; patientId: string; open: boolean; consult: boolean }) {
  const supabase = await createClient();
  const [{ data: notes }, { data: dx }, { data: rx }, drugs, wards, consultants, { data: req }] = await Promise.all([
    supabase
      .from("edoshmis_consultations")
      .select("*, author:edoshmis_staff!edoshmis_consultations_author_id_fkey(full_name), edoshmis_consultation_addenda(id, body, created_at, author:edoshmis_staff!edoshmis_consultation_addenda_author_id_fkey(full_name))")
      .eq("encounter_id", v.id)
      .order("created_at", { ascending: false }),
    supabase.from("edoshmis_diagnoses").select("id, rank, kind, description, icd10_code, status").eq("encounter_id", v.id).is("admission_id", null).order("created_at"),
    supabase.from("edoshmis_outpatient_prescriptions").select("*").eq("encounter_id", v.id).order("prescribed_at"),
    consult && open ? supabase.from("edoshmis_drugs").select("id, generic_name, strength, form").eq("is_active", true).order("generic_name") : Promise.resolve({ data: null }),
    can(s, "ipd.request_admission") && open ? supabase.from("edoshmis_wards").select("id, name").eq("facility_id", s.facility.id).neq("status", "closed").order("sort_order") : Promise.resolve({ data: null }),
    can(s, "ipd.request_admission") && open ? supabase.from("edoshmis_staff").select("id, full_name").eq("organization_id", s.staff.organizationId).eq("status", "active").eq("designation", "consultant").order("full_name") : Promise.resolve({ data: null }),
    supabase.from("edoshmis_admission_requests").select("id, status").eq("source_encounter_id", v.id).in("status", ["pending", "approved", "admitted"]).maybeSingle(),
  ]);
  type Note = { id: string; author_id: string; author_designation: string; presenting_complaint: string | null; history: string | null; examination: string; assessment: string | null; plan: string | null; status: string; signed_at: string | null; created_at: string; author: { full_name: string } | null; edoshmis_consultation_addenda: { id: string; body: string; created_at: string; author: { full_name: string } | null }[] };

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
      <div className="order-2 flex min-w-0 flex-col gap-5 lg:order-1">
        {((notes ?? []) as unknown as Note[]).map((n) => (
          <Card key={n.id}>
            <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
              <p className="text-xs text-ink-faint">
                <span className="text-sm font-semibold text-ink">Consultation</span> · {n.author?.full_name} · {titleCase(n.author_designation)} · {fmtDateTime(n.created_at)}
              </p>
              {n.status === "signed" ? <Badge tone="positive"><Lock className="h-3 w-3" aria-hidden="true" /> Signed {fmtDateTime(n.signed_at)}</Badge> : <Badge tone="attention">Draft</Badge>}
            </header>
            <CardBody className="flex flex-col gap-2 text-sm">
              {([["Presenting complaint", n.presenting_complaint], ["History", n.history], ["Examination", n.examination], ["Assessment", n.assessment], ["Plan", n.plan]] as const).map(
                ([l, t]) =>
                  t && (
                    <div key={l}>
                      <p className="text-[11px] font-medium tracking-wide text-ink-faint uppercase">{l}</p>
                      <p className="whitespace-pre-wrap">{t}</p>
                    </div>
                  ),
              )}
              {n.edoshmis_consultation_addenda.map((a) => (
                <p key={a.id} className="rounded-lg bg-attention-soft/50 px-3 py-2 text-sm">
                  <span className="block text-xs font-medium text-attention-ink">Addendum · {a.author?.full_name} · {fmtDateTime(a.created_at)}</span>
                  {a.body}
                </p>
              ))}
              {consult && (
                <div className="flex gap-2">
                  {n.status === "draft" && n.author_id === s.staff.id && (
                    <ActionButton action={signConsultation.bind(null, n.id)} variant="primary" confirm="Sign? It cannot be edited afterwards.">
                      <FileSignature className="h-3.5 w-3.5" aria-hidden="true" /> Sign
                    </ActionButton>
                  )}
                  {n.status === "signed" && (
                    <Disclosure label="Addendum" icon={PenLine} variant="ghost">
                      <ActionForm action={addConsultationAddendum.bind(null, n.id, v.facility_id)} submitLabel="Add addendum">
                        <Field label="Addendum" required>
                          <Textarea name="body" required />
                        </Field>
                      </ActionForm>
                    </Disclosure>
                  )}
                </div>
              )}
            </CardBody>
          </Card>
        ))}
        {!notes?.length && (
          <Card>
            <EmptyState icon={NotebookPen} title="No consultation yet" />
          </Card>
        )}

        <Card>
          <CardHeader
            title="Diagnoses"
            icon={Stethoscope}
            actions={
              consult &&
              open && (
                <Disclosure label="Add">
                  <ActionForm action={addVisitDiagnosis.bind(null, v.id, v.facility_id, patientId)} submitLabel="Add diagnosis">
                    <div className="grid grid-cols-[1fr_96px] gap-3">
                      <Field label="Diagnosis" required>
                        <Input name="description" required />
                      </Field>
                      <Field label="ICD-10">
                        <Input name="icd10_code" className="uppercase" pattern="[A-Za-z][0-9]{2}(\.[0-9A-Za-z]{1,4})?" />
                      </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Rank">
                        <Select name="rank" defaultValue={dx?.length ? "secondary" : "primary"}>
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
                </Disclosure>
              )
            }
          />
          {dx?.length ? (
            <ul className="divide-y divide-line">
              {dx.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm">
                  <span>
                    {d.description} {d.icd10_code && <span className="tnum text-xs text-ink-faint">{d.icd10_code}</span>}
                  </span>
                  <span className="flex gap-1">
                    <Badge tone={d.rank === "primary" ? "brand" : "neutral"}>{d.rank}</Badge>
                    <Badge>{d.kind}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <CardBody className="text-sm text-ink-faint">None yet.</CardBody>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Prescriptions"
            icon={Pill}
            actions={
              drugs.data && (
                <Disclosure label="Prescribe" variant="primary">
                  <ActionForm action={prescribeOutpatient.bind(null, v.id)} submitLabel="Prescribe">
                    <Field label="Drug (catalogue)">
                      <Select name="drug_id" defaultValue="">
                        <option value="">— Not in catalogue —</option>
                        {drugs.data.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.generic_name} {d.strength ?? ""} · {d.form}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="…or drug name">
                      <Input name="drug_name" />
                    </Field>
                    <div className="grid grid-cols-3 gap-3">
                      <Field label="Dose" required>
                        <Input name="dose" inputMode="decimal" required />
                      </Field>
                      <Field label="Unit">
                        <Select name="dose_unit" defaultValue="mg">
                          {["mg", "g", "mcg", "ml", "units", "tablet", "capsule", "puff", "drop", "sachet"].map((u) => (
                            <option key={u}>{u}</option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Route">
                        <Select name="route" defaultValue="oral">
                          {["oral", "topical", "inhaled", "im", "iv", "sc", "pr", "pv", "ophthalmic", "otic", "nasal"].map((r) => (
                            <option key={r} value={r}>
                              {r.toUpperCase()}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Frequency">
                        <Select name="frequency" defaultValue="bd">
                          {["od", "bd", "tds", "qds", "nocte", "stat", "prn", "weekly"].map((f) => (
                            <option key={f} value={f}>
                              {f.toUpperCase()}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Days">
                        <Input name="duration_days" inputMode="numeric" />
                      </Field>
                      <Field label="Quantity" required>
                        <Input name="quantity" inputMode="decimal" required />
                      </Field>
                    </div>
                    <Field label="Instructions">
                      <Input name="instructions" />
                    </Field>
                    <Field label="Allergy override reason" hint="Only if warned">
                      <Input name="allergy_override_reason" />
                    </Field>
                  </ActionForm>
                </Disclosure>
              )
            }
          />
          {rx?.length ? (
            <ul className="divide-y divide-line">
              {rx.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm">
                  <span>
                    <span className="font-medium">{r.drug_name}</span>{" "}
                    <span className="text-ink-soft">
                      {Number(r.dose)} {r.dose_unit} {r.route.toUpperCase()} {r.frequency.toUpperCase()}
                      {r.duration_days ? ` × ${r.duration_days} d` : ""} · qty {Number(r.quantity)}
                    </span>
                    {r.instructions && <span className="block text-xs text-ink-faint">{r.instructions}</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone={r.status === "dispensed" ? "positive" : r.status === "cancelled" ? "neutral" : "attention"}>{r.status === "prescribed" ? "At pharmacy" : titleCase(r.status)}</Badge>
                    {consult && r.status === "prescribed" && (
                      <Disclosure label="Cancel" variant="ghost">
                        <ActionForm action={cancelOutpatientRx.bind(null, r.id)} submitLabel="Cancel" submitVariant="danger">
                          <Field label="Reason" required>
                            <Input name="reason" required />
                          </Field>
                        </ActionForm>
                      </Disclosure>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <CardBody className="text-sm text-ink-faint">None.</CardBody>
          )}
        </Card>
      </div>

      <div className="order-1 flex min-w-0 flex-col gap-5 lg:order-2 lg:sticky lg:top-20 lg:self-start">
        {consult && open && (
          <Card>
            <CardHeader title="Consultation" icon={NotebookPen} description={`As ${s.staff.fullName}`} />
            <CardBody>
              <ActionForm
                action={writeConsultation.bind(null, v.id, v.facility_id)}
                submitLabel="Sign"
                footer={
                  <button type="submit" name="intent" value="draft" className="text-sm text-ink-soft hover:text-ink">
                    Save draft
                  </button>
                }
              >
                <Field label="Presenting complaint">
                  <Textarea name="presenting_complaint" className="min-h-14" defaultValue={(v.chief_complaint as string) ?? ""} />
                </Field>
                <Field label="History">
                  <Textarea name="history" className="min-h-16" />
                </Field>
                <Field label="Examination" required>
                  <Textarea name="examination" required />
                </Field>
                <Field label="Assessment">
                  <Textarea name="assessment" className="min-h-14" />
                </Field>
                <Field label="Plan">
                  <Textarea name="plan" className="min-h-16" />
                </Field>
              </ActionForm>
            </CardBody>
          </Card>
        )}

        {open && (consult || can(s, "opd.register")) && (
          <Card>
            <CardHeader title="Next step" icon={DoorOpen} />
            <CardBody className="flex flex-col gap-3">
              {consult && (
                <div className="flex flex-wrap gap-2">
                  {(["investigations", "pharmacy", "billing"] as const)
                    .filter((st) => st !== v.stage)
                    .map((st) => (
                      <ActionButton key={st} action={setStage.bind(null, v.id, st, false)}>
                        To {st}
                      </ActionButton>
                    ))}
                </div>
              )}
              {can(s, "ipd.request_admission") && !req && (
                <Disclosure label="Request admission" icon={BedDouble}>
                  <ActionForm action={requestAdmissionFromVisit.bind(null, v.id, patientId, v.kind)} submitLabel="Request admission">
                    <Field label="Provisional diagnosis" required>
                      <Input name="provisional_diagnosis" required />
                    </Field>
                    <Field label="Why admit" required>
                      <Textarea name="indication" required className="min-h-16" />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Priority">
                        <Select name="priority" defaultValue={v.kind === "emergency" ? "emergency" : "urgent"}>
                          <option value="emergency">Emergency</option>
                          <option value="urgent">Urgent</option>
                          <option value="elective">Elective</option>
                        </Select>
                      </Field>
                      <Field label="Ward">
                        <Select name="preferred_ward_id" defaultValue="">
                          <option value="">Any</option>
                          {wards.data?.map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>
                    <Field label="Consultant">
                      <Select name="responsible_consultant_id" defaultValue="">
                        <option value="">To be assigned</option>
                        {consultants.data?.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.full_name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </ActionForm>
                </Disclosure>
              )}
              {req && <p className="text-sm text-ink-soft">Admission {req.status === "admitted" ? "done" : `requested (${req.status})`}.</p>}
              <Disclosure label="Close the visit" variant="secondary">
                <ActionForm action={closeVisit.bind(null, v.id)} submitLabel="Close visit">
                  <Field label="Outcome">
                    <Select name="outcome" defaultValue={req ? "admitted" : "home"}>
                      {consult && <option value="home">Home</option>}
                      {consult && <option value="follow_up">Home, with follow-up</option>}
                      {consult && <option value="referred">Referred</option>}
                      {consult && req && <option value="admitted">Admitted</option>}
                      {consult && <option value="left_against_advice">Left against advice</option>}
                      {consult && <option value="died">Died</option>}
                      <option value="left_without_being_seen">Left without being seen</option>
                    </Select>
                  </Field>
                  <Field label="Follow-up date">
                    <Input name="follow_up_date" type="date" />
                  </Field>
                  <Field label="Note" hint="Required when referred, left or died">
                    <Input name="note" />
                  </Field>
                </ActionForm>
              </Disclosure>
            </CardBody>
          </Card>
        )}
        {!open && (
          <Card>
            <CardBody className="text-sm text-ink-soft">
              Closed {fmtDateTime(v.ended_at as string)} — {titleCase(v.outcome as string)}
              {v.outcome_note ? `: ${v.outcome_note as string}` : ""}.
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}

async function TriageSection({ s, visit: v, open }: { s: Awaited<ReturnType<typeof requireStaff>>; visit: V; open: boolean }) {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("edoshmis_triage_records")
    .select("*, recorder:edoshmis_staff!edoshmis_triage_records_recorded_by_fkey(full_name)")
    .eq("encounter_id", v.id)
    .order("recorded_at", { ascending: false });
  const triage = can(s, "opd.triage") && open;
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <Card className="order-2 lg:order-1">
        <CardHeader title="Triage records" icon={Activity} />
        {rows?.length ? (
          <ul className="divide-y divide-line">
            {(rows as unknown as (Record<string, number | string | null> & { recorder: { full_name: string } | null })[]).map((r) => {
              const tc = TRIAGE[r.triage_category as string];
              return (
                <li key={r.id as string} className="px-5 py-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn("rounded-md px-1.5 py-0.5 text-xs font-semibold", tc?.tone)}>{tc?.label}</span>
                    <span className="text-xs text-ink-faint">
                      {r.recorder?.full_name} · {fmtDateTime(r.recorded_at as string)}
                    </span>
                  </div>
                  <p className="mt-1">{r.chief_complaint}</p>
                  <p className="tnum mt-1 text-xs text-ink-soft">
                    {[
                      r.temperature != null && `T ${r.temperature} °C`,
                      r.pulse != null && `P ${r.pulse}`,
                      r.respiratory_rate != null && `RR ${r.respiratory_rate}`,
                      r.systolic_bp != null && `BP ${r.systolic_bp}/${r.diastolic_bp ?? "–"}`,
                      r.spo2 != null && `SpO₂ ${r.spo2}%`,
                      r.weight_kg != null && `Wt ${r.weight_kg} kg`,
                      r.muac_cm != null && `MUAC ${r.muac_cm} cm`,
                      r.pain_score != null && `Pain ${r.pain_score}/10`,
                      r.blood_glucose_mmol != null && `Glucose ${r.blood_glucose_mmol}`,
                      r.consciousness && `AVPU ${titleCase(r.consciousness as string)}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {r.notes && <p className="text-xs text-ink-faint">{r.notes}</p>}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState icon={Activity} title="Not triaged yet" />
        )}
      </Card>
      {triage && (
        <Card className="order-1 lg:order-2 lg:sticky lg:top-20 lg:self-start">
          <CardHeader title="Triage" description="Category per your hospital's triage protocol" />
          <CardBody>
            <ActionForm action={recordTriage.bind(null, v.id, v.facility_id)} submitLabel="Save triage">
              <input type="hidden" name="client_id" value={randomUUID()} />
              <Field label="Category" required>
                <Select name="triage_category" required defaultValue={(v.triage_category as string) ?? ""}>
                  <option value="" disabled>
                    Choose
                  </option>
                  {Object.entries(TRIAGE).map(([k, t]) => (
                    <option key={k} value={k}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Chief complaint" required>
                <Input name="chief_complaint" required defaultValue={(v.chief_complaint as string) ?? ""} />
              </Field>
              <div className="grid grid-cols-3 gap-2.5">
                {([["temperature", "Temp °C", "0.1"], ["pulse", "Pulse"], ["respiratory_rate", "Resp rate"], ["systolic_bp", "Systolic"], ["diastolic_bp", "Diastolic"], ["spo2", "SpO₂ %"], ["weight_kg", "Weight kg", "0.1"], ["height_cm", "Height cm", "0.5"], ["muac_cm", "MUAC cm", "0.1"], ["pain_score", "Pain 0–10"], ["blood_glucose_mmol", "Glucose", "0.1"]] as const).map(
                  ([n, l, st]) => (
                    <Field key={n} label={l}>
                      <Input name={n} type="number" inputMode="decimal" step={(st as string | undefined) ?? "1"} className="tnum h-11 text-base" />
                    </Field>
                  ),
                )}
                <Field label="AVPU">
                  <Select name="consciousness" defaultValue="">
                    <option value="">—</option>
                    <option value="alert">Alert</option>
                    <option value="new_confusion">Confused</option>
                    <option value="voice">Voice</option>
                    <option value="pain">Pain</option>
                    <option value="unresponsive">Unresponsive</option>
                  </Select>
                </Field>
              </div>
              <Field label="Pregnant">
                <Select name="pregnant" defaultValue="">
                  <option value="">Not asked / N/A</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </Select>
              </Field>
              <Field label="Notes">
                <Input name="notes" />
              </Field>
            </ActionForm>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
