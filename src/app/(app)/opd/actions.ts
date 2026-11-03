"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/session";
import { dbError, num, opt, rpc, str } from "@/lib/actions";
import { fromNairobiLocal } from "@/lib/format";
import type { ActionState } from "@/lib/action-state";

/* Outpatient & emergency actions. The database decides; these pass the form on. */

export async function checkIn(patientId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireStaff();
  const r = await rpc("edoshmis_check_in", {
    p_facility: s.facility.id,
    c: {
      patient_id: patientId,
      kind: str(fd, "kind") || "opd",
      department_id: opt(fd, "department_id"),
      appointment_id: opt(fd, "appointment_id"),
      chief_complaint: opt(fd, "chief_complaint"),
      triage_category: opt(fd, "triage_category"),
      arrival_mode: opt(fd, "arrival_mode"),
      payment_category: str(fd, "payment_category") || "cash",
      clinician_id: opt(fd, "clinician_id"),
    },
  });
  if (!r.ok) return r;
  redirect(`/visits/${r.data?.result as string}`);
}

export async function bookAppointment(patientId: string, _: ActionState, fd: FormData) {
  const s = await requireStaff();
  return rpc(
    "edoshmis_book_appointment",
    {
      p_facility: s.facility.id,
      a: {
        patient_id: patientId,
        scheduled_at: fromNairobiLocal(str(fd, "scheduled_at")),
        department_id: opt(fd, "department_id"),
        clinician_id: opt(fd, "clinician_id"),
        duration_minutes: num(fd, "duration_minutes"),
        reason: opt(fd, "reason"),
        rescheduled_from: opt(fd, "rescheduled_from"),
      },
    },
    "Appointment booked.",
  );
}

export async function cancelAppointment(id: string, status: "cancelled" | "no_show", _: ActionState, fd: FormData) {
  return rpc("edoshmis_cancel_appointment", { p_appointment: id, p_status: status, p_reason: opt(fd, "reason") });
}

export async function setStage(encounterId: string, stage: string, assignMe: boolean) {
  const s = await requireStaff();
  return rpc("edoshmis_set_visit_stage", { p_encounter: encounterId, p_stage: stage, p_clinician: assignMe ? s.staff.id : null });
}

export async function recordTriage(encounterId: string, facilityId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff();
  const row: Record<string, unknown> = {};
  for (const f of ["temperature", "pulse", "respiratory_rate", "systolic_bp", "diastolic_bp", "spo2", "weight_kg", "height_cm", "muac_cm", "pain_score", "blood_glucose_mmol"]) {
    const v = num(fd, f);
    if (Number.isNaN(v)) return { ok: false, error: `${f.replace(/_/g, " ")} is not a number.` };
    if (v !== null) row[f] = v;
  }
  if (!str(fd, "triage_category")) return { ok: false, error: "Choose the triage category." };
  const supabase = await createClient();
  const { error } = await supabase.from("edoshmis_triage_records").insert({
    ...row,
    facility_id: facilityId,
    encounter_id: encounterId,
    patient_id: "00000000-0000-0000-0000-000000000000",
    recorded_by: "00000000-0000-0000-0000-000000000000",
    triage_category: str(fd, "triage_category"),
    chief_complaint: str(fd, "chief_complaint"),
    consciousness: opt(fd, "consciousness"),
    pregnant: str(fd, "pregnant") ? str(fd, "pregnant") === "yes" : null,
    notes: opt(fd, "notes"),
    client_id: opt(fd, "client_id"),
  });
  if (error) return { ok: false, error: dbError(error) };
  refresh();
  return { ok: true, message: "Triage recorded. The patient is waiting for the doctor." };
}

export async function writeConsultation(encounterId: string, facilityId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff();
  const examination = str(fd, "examination");
  if (examination.length < 2) return { ok: false, error: "Write the examination findings." };
  const supabase = await createClient();
  const { error } = await supabase.from("edoshmis_consultations").insert({
    facility_id: facilityId,
    encounter_id: encounterId,
    patient_id: "00000000-0000-0000-0000-000000000000",
    author_id: "00000000-0000-0000-0000-000000000000",
    author_designation: "",
    presenting_complaint: opt(fd, "presenting_complaint"),
    history: opt(fd, "history"),
    examination,
    assessment: opt(fd, "assessment"),
    plan: opt(fd, "plan"),
    status: str(fd, "intent") === "draft" ? "draft" : "signed",
  });
  if (error) return { ok: false, error: dbError(error) };
  refresh();
  return { ok: true, message: str(fd, "intent") === "draft" ? "Draft saved." : "Consultation signed." };
}

export async function signConsultation(id: string): Promise<ActionState> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.from("edoshmis_consultations").update({ status: "signed" }).eq("id", id).select("id");
  if (error) return { ok: false, error: dbError(error) };
  if (!data?.length) return { ok: false, error: "You can only sign your own draft." };
  refresh();
  return { ok: true };
}

export async function addConsultationAddendum(consultationId: string, facilityId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase.from("edoshmis_consultation_addenda").insert({
    facility_id: facilityId,
    consultation_id: consultationId,
    author_id: "00000000-0000-0000-0000-000000000000",
    author_designation: "",
    body: str(fd, "body"),
  });
  if (error) return { ok: false, error: dbError(error) };
  refresh();
  return { ok: true, message: "Addendum added." };
}

export async function addVisitDiagnosis(encounterId: string, facilityId: string, patientId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase.from("edoshmis_diagnoses").insert({
    facility_id: facilityId,
    encounter_id: encounterId,
    patient_id: patientId,
    rank: str(fd, "rank") || "primary",
    kind: str(fd, "kind") || "working",
    description: str(fd, "description"),
    icd10_code: opt(fd, "icd10_code")?.toUpperCase() ?? null,
  });
  if (error) return { ok: false, error: dbError(error) };
  refresh();
  return { ok: true, message: "Diagnosis recorded." };
}

export async function prescribeOutpatient(encounterId: string, _: ActionState, fd: FormData) {
  return rpc(
    "edoshmis_prescribe_outpatient",
    {
      p_encounter: encounterId,
      o: {
        drug_id: opt(fd, "drug_id"),
        drug_name: opt(fd, "drug_name"),
        dose: num(fd, "dose"),
        dose_unit: str(fd, "dose_unit"),
        route: str(fd, "route"),
        frequency: str(fd, "frequency"),
        duration_days: opt(fd, "duration_days"),
        quantity: num(fd, "quantity"),
        instructions: opt(fd, "instructions"),
        allergy_override_reason: opt(fd, "allergy_override_reason"),
      },
    },
    "Prescribed — it is in the pharmacy queue.",
  );
}

export async function cancelOutpatientRx(id: string, _: ActionState, fd: FormData) {
  return rpc("edoshmis_cancel_outpatient_rx", { p_rx: id, p_reason: str(fd, "reason") }, "Cancelled.");
}

export async function dispenseOutpatient(id: string, _: ActionState, fd: FormData) {
  return rpc("edoshmis_dispense_outpatient", { p_rx: id, d: { quantity: opt(fd, "quantity"), batch_number: opt(fd, "batch_number"), expiry_date: opt(fd, "expiry_date") } }, "Dispensed.");
}

export async function closeVisit(encounterId: string, _: ActionState, fd: FormData) {
  return rpc(
    "edoshmis_close_visit",
    { p_encounter: encounterId, p_outcome: str(fd, "outcome"), p_note: opt(fd, "note"), p_follow_up: opt(fd, "follow_up_date") },
    "Visit closed.",
  );
}

export async function requestAdmissionFromVisit(encounterId: string, patientId: string, kind: string, _: ActionState, fd: FormData) {
  const s = await requireStaff();
  return rpc(
    "edoshmis_request_admission",
    {
      p_facility: s.facility.id,
      r: {
        patient_id: patientId,
        source: kind === "emergency" ? "emergency" : "opd",
        source_encounter_id: encounterId,
        priority: str(fd, "priority") || "urgent",
        provisional_diagnosis: str(fd, "provisional_diagnosis"),
        provisional_icd10: opt(fd, "provisional_icd10"),
        indication: str(fd, "indication"),
        preferred_ward_id: opt(fd, "preferred_ward_id"),
        responsible_consultant_id: opt(fd, "responsible_consultant_id"),
      },
    },
    "Admission requested — close the visit as “admitted”.",
  );
}
