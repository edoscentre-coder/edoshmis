"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/session";
import { bool, dbError, num, opt, rpc, str } from "@/lib/actions";
import { fromNairobiLocal } from "@/lib/format";
import type { ActionState } from "@/lib/action-state";

/*
 * Inpatient actions. Each is a thin wrapper: the form becomes arguments to
 * an edoshmis_ function (or an RLS-checked insert), and the database decides
 * — permission, ward, bed state, allergies, workflow order. What it says
 * when it refuses is shown to the user as written.
 */

async function insert(table: string, row: Record<string, unknown>, message?: string): Promise<ActionState> {
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase.from(table).insert(row);
  if (error) return { ok: false, error: dbError(error) };
  refresh();
  return { ok: true, message };
}

async function update(table: string, id: string, patch: Record<string, unknown>, message?: string): Promise<ActionState> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.from(table).update(patch).eq("id", id).select("id");
  if (error) return { ok: false, error: dbError(error) };
  if (!data?.length) return { ok: false, error: "You do not have permission to change this." };
  refresh();
  return { ok: true, message };
}

/* ---------------------------------------------------------------- requests & admission */

export async function decideRequest(requestId: string, approve: boolean, _: ActionState, fd: FormData) {
  return rpc("edoshmis_decide_admission_request", { p_request: requestId, p_approve: approve, p_note: opt(fd, "note") }, approve ? "Approved." : "Rejected.");
}

export async function cancelRequest(requestId: string, _: ActionState, fd: FormData) {
  return rpc("edoshmis_cancel_admission_request", { p_request: requestId, p_note: str(fd, "note") }, "Request cancelled.");
}

export async function admit(requestId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const bed = str(fd, "bed_id");
  if (!bed) return { ok: false, error: "Choose a bed." };
  const r = await rpc("edoshmis_admit", {
    p_request: requestId,
    p_bed: bed,
    a: {
      consent_obtained: bool(fd, "consent_obtained"),
      consent_by: opt(fd, "consent_by"),
      patient_category: str(fd, "patient_category") || "general",
      expected_discharge_date: opt(fd, "expected_discharge_date"),
      notes: opt(fd, "notes"),
    },
  });
  if (!r.ok) return r;
  redirect(`/ipd/admissions/${r.data?.result as string}?admitted=1`);
}

export async function reserveBed(requestId: string | null, _: ActionState, fd: FormData) {
  return rpc("edoshmis_reserve_bed", { p_bed: str(fd, "bed_id"), p_request: requestId, p_hours: num(fd, "hours") ?? 4, p_note: opt(fd, "note") }, "Bed reserved.");
}

export async function releaseReservation(reservationId: string) {
  return rpc("edoshmis_release_reservation", { p_reservation: reservationId, p_status: "released" });
}

export async function setBedStatus(bedId: string, _: ActionState, fd: FormData) {
  return rpc("edoshmis_set_bed_status", { p_bed: bedId, p_status: str(fd, "status"), p_note: opt(fd, "note") });
}

export async function transferBed(admissionId: string, _: ActionState, fd: FormData) {
  return rpc("edoshmis_transfer_bed", { p_admission: admissionId, p_bed: str(fd, "bed_id"), p_reason: str(fd, "reason") }, "Transferred. The old bed is marked for cleaning.");
}

export async function updateAdmission(admissionId: string, _: ActionState, fd: FormData) {
  return rpc("edoshmis_update_admission", { p_admission: admissionId, a: { condition: str(fd, "condition"), expected_discharge_date: str(fd, "expected_discharge_date") } }, "Saved.");
}

export async function setCareTeam(admissionId: string, add: boolean, _: ActionState, fd: FormData) {
  return rpc("edoshmis_set_care_team", { p_admission: admissionId, p_staff: str(fd, "staff_id"), p_role: str(fd, "role"), p_add: add });
}

/* ---------------------------------------------------------------- notes */

export async function writeClinicalNote(admissionId: string, facilityId: string, _: ActionState, fd: FormData) {
  const findings = str(fd, "findings");
  if (findings.length < 2) return { ok: false, error: "Write the findings." };
  const sign = str(fd, "intent") !== "draft";
  return insert(
    "edoshmis_clinical_notes",
    {
      facility_id: facilityId,
      admission_id: admissionId,
      // Author, designation and patient are set by the database from the session.
      patient_id: "00000000-0000-0000-0000-000000000000",
      author_id: "00000000-0000-0000-0000-000000000000",
      author_designation: "",
      note_type: str(fd, "note_type") || "ward_round",
      subjective: opt(fd, "subjective"),
      findings,
      assessment: opt(fd, "assessment"),
      plan: opt(fd, "plan"),
      discharge_ready: fd.get("discharge_ready") ? bool(fd, "discharge_ready") : null,
      specialist_requested: opt(fd, "specialist_requested"),
      status: sign ? "signed" : "draft",
    },
    sign ? "Note signed." : "Draft saved — sign it when complete.",
  );
}

export async function signNote(noteId: string) {
  return update("edoshmis_clinical_notes", noteId, { status: "signed" }, "Signed.");
}

export async function addAddendum(kind: "clinical" | "nursing", noteId: string, _: ActionState, fd: FormData) {
  return rpc("edoshmis_add_addendum", { p_note_kind: kind, p_note: noteId, p_body: str(fd, "body") }, "Addendum added.");
}

export async function writeNursingNote(admissionId: string, facilityId: string, _: ActionState, fd: FormData) {
  const body = str(fd, "body");
  if (body.length < 2) return { ok: false, error: "Write the note." };
  const score = num(fd, "score");
  return insert(
    "edoshmis_nursing_notes",
    {
      facility_id: facilityId,
      admission_id: admissionId,
      patient_id: "00000000-0000-0000-0000-000000000000",
      author_id: "00000000-0000-0000-0000-000000000000",
      author_designation: "",
      category: str(fd, "category") || "general",
      shift: str(fd, "shift") || currentShift(),
      body,
      score_tool: opt(fd, "score_tool"),
      score: Number.isNaN(score) ? null : score,
      client_id: opt(fd, "client_id"),
    },
    "Nursing note saved.",
  );
}

export async function addCarePlan(admissionId: string, facilityId: string, _: ActionState, fd: FormData) {
  return insert(
    "edoshmis_nursing_care_plans",
    {
      facility_id: facilityId,
      admission_id: admissionId,
      patient_id: "00000000-0000-0000-0000-000000000000",
      author_id: "00000000-0000-0000-0000-000000000000",
      nursing_diagnosis: str(fd, "nursing_diagnosis"),
      goal: str(fd, "goal"),
      interventions: str(fd, "interventions"),
    },
    "Care plan added.",
  );
}

export async function closeCarePlan(planId: string, _: ActionState, fd: FormData) {
  const s = await requireStaff();
  return update("edoshmis_nursing_care_plans", planId, {
    status: str(fd, "status") || "achieved",
    evaluation: opt(fd, "evaluation"),
    closed_by: s.staff.id,
    closed_at: new Date().toISOString(),
  });
}

/* ---------------------------------------------------------------- observations, fluids */

export async function recordObservation(admissionId: string, facilityId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const fields = ["temperature", "pulse", "respiratory_rate", "systolic_bp", "diastolic_bp", "spo2", "weight_kg", "height_cm", "pain_score", "blood_glucose_mmol", "o2_flow_l_min"] as const;
  const row: Record<string, unknown> = {};
  for (const f of fields) {
    const v = num(fd, f);
    if (Number.isNaN(v)) return { ok: false, error: `${f.replace(/_/g, " ")} is not a number.` };
    if (v !== null) row[f] = v;
  }
  const consciousness = str(fd, "consciousness");
  if (consciousness) row.consciousness = consciousness;
  if (Object.keys(row).length === 0) return { ok: false, error: "Enter at least one observation." };
  // Room air / oxygen belongs with a saturation reading, or stands alone when on oxygen.
  if (row.spo2 !== undefined || str(fd, "supplemental_o2") === "yes") row.supplemental_o2 = str(fd, "supplemental_o2") === "yes";
  return insert(
    "edoshmis_observations",
    {
      ...row,
      facility_id: facilityId,
      admission_id: admissionId,
      patient_id: "00000000-0000-0000-0000-000000000000",
      recorded_by: "00000000-0000-0000-0000-000000000000",
      scheme: str(fd, "scheme") || "adult",
      observed_at: fromNairobiLocal(str(fd, "observed_at")) ?? new Date().toISOString(),
      notes: opt(fd, "notes"),
      client_id: opt(fd, "client_id"),
    },
    "Observations recorded.",
  );
}

export async function markObservationError(id: string, _: ActionState, fd: FormData) {
  const reason = str(fd, "reason");
  if (!reason) return { ok: false, error: "Give the reason." };
  return update("edoshmis_observations", id, { entered_in_error: true, error_reason: reason });
}

export async function escalation(id: string, action: "acknowledge" | "resolve", _: ActionState, fd: FormData) {
  return rpc("edoshmis_update_escalation", { p_escalation: id, p_action: action, p_outcome: opt(fd, "outcome") });
}

export async function recordFluid(admissionId: string, facilityId: string, _: ActionState, fd: FormData) {
  const volume = num(fd, "volume_ml");
  if (!volume || Number.isNaN(volume)) return { ok: false, error: "Enter the volume in ml." };
  const [direction, category] = str(fd, "kind").split(":");
  return insert(
    "edoshmis_fluid_entries",
    {
      facility_id: facilityId,
      admission_id: admissionId,
      patient_id: "00000000-0000-0000-0000-000000000000",
      recorded_by: "00000000-0000-0000-0000-000000000000",
      direction,
      category,
      volume_ml: Math.round(volume),
      description: opt(fd, "description"),
      recorded_at: fromNairobiLocal(str(fd, "recorded_at")) ?? new Date().toISOString(),
      client_id: opt(fd, "client_id"),
    },
    "Recorded.",
  );
}

export async function markFluidError(id: string, _: ActionState, fd: FormData) {
  const reason = str(fd, "reason");
  if (!reason) return { ok: false, error: "Give the reason." };
  return update("edoshmis_fluid_entries", id, { entered_in_error: true, error_reason: reason });
}

/* ---------------------------------------------------------------- diagnoses, procedures */

export async function addDiagnosis(admissionId: string, facilityId: string, patientId: string, _: ActionState, fd: FormData) {
  const description = str(fd, "description");
  if (description.length < 2) return { ok: false, error: "Describe the diagnosis." };
  return insert(
    "edoshmis_diagnoses",
    {
      facility_id: facilityId,
      admission_id: admissionId,
      patient_id: patientId,
      rank: str(fd, "rank") || "secondary",
      kind: str(fd, "kind") || "working",
      description,
      icd10_code: opt(fd, "icd10_code")?.toUpperCase() ?? null,
    },
    "Diagnosis recorded.",
  );
}

export async function setDiagnosisStatus(id: string, _: ActionState, fd: FormData) {
  return update("edoshmis_diagnoses", id, { status: str(fd, "status"), status_reason: opt(fd, "reason") });
}

export async function requestProcedure(admissionId: string, facilityId: string, _: ActionState, fd: FormData) {
  return insert(
    "edoshmis_procedures",
    {
      facility_id: facilityId,
      admission_id: admissionId,
      patient_id: "00000000-0000-0000-0000-000000000000",
      requested_by: "00000000-0000-0000-0000-000000000000",
      name: str(fd, "name"),
      code: opt(fd, "code"),
      indication: opt(fd, "indication"),
      urgency: str(fd, "urgency") || "elective",
    },
    "Procedure requested.",
  );
}

export async function procedureAction(id: string, action: string, _: ActionState, fd: FormData) {
  const d: Record<string, unknown> = {};
  for (const k of ["procedure_note", "outcome", "complications", "post_procedure_monitoring", "follow_up", "reason", "consent_by", "responsible_clinician_id"]) {
    const v = opt(fd, k);
    if (v) d[k] = v;
  }
  if (fd.get("consent_obtained")) d.consent_obtained = bool(fd, "consent_obtained");
  const when = fromNairobiLocal(str(fd, "scheduled_for"));
  if (when) d.scheduled_for = when;
  const done = fromNairobiLocal(str(fd, "performed_at"));
  if (done) d.performed_at = done;
  return rpc("edoshmis_update_procedure", { p_procedure: id, p_action: action, d });
}

/* ---------------------------------------------------------------- medication */

export async function prescribe(admissionId: string, _: ActionState, fd: FormData) {
  const times = String(fd.get("schedule_times") ?? "")
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter((t) => /^\d{1,2}:\d{2}$/.test(t));
  const r = await rpc(
    "edoshmis_prescribe",
    {
      p_admission: admissionId,
      o: {
        drug_id: opt(fd, "drug_id"),
        drug_name: opt(fd, "drug_name"),
        dose: num(fd, "dose"),
        dose_unit: str(fd, "dose_unit"),
        route: str(fd, "route"),
        frequency: str(fd, "frequency"),
        schedule_times: times,
        is_prn: str(fd, "frequency") === "prn",
        prn_indication: opt(fd, "prn_indication"),
        prn_max_doses_per_day: opt(fd, "prn_max_doses_per_day"),
        start_at: fromNairobiLocal(str(fd, "start_at")),
        end_at: fromNairobiLocal(str(fd, "end_at")),
        instructions: opt(fd, "instructions"),
        reconciliation: str(fd, "reconciliation") || "new",
        allergy_override_reason: opt(fd, "allergy_override_reason"),
        interaction_override_reason: opt(fd, "interaction_override_reason"),
      },
    },
    "Prescribed. It goes to pharmacy for verification before it can be given.",
  );
  return r;
}

export async function discontinueOrder(orderId: string, _: ActionState, fd: FormData) {
  return rpc("edoshmis_discontinue_order", { p_order: orderId, p_reason: str(fd, "reason") }, "Stopped.");
}

export async function recordDose(slotId: string | null, orderId: string | null, _: ActionState, fd: FormData) {
  return rpc("edoshmis_record_administration", {
    p_slot: slotId,
    p_order: orderId,
    p_status: str(fd, "status") || "administered",
    d: {
      reason: opt(fd, "reason"),
      dose_given: opt(fd, "dose_given"),
      witness_id: opt(fd, "witness_id"),
      administered_at: fromNairobiLocal(str(fd, "administered_at")),
      client_id: opt(fd, "client_id"),
    },
  });
}

export async function markDoseError(id: string, _: ActionState, fd: FormData) {
  const reason = str(fd, "reason");
  if (!reason) return { ok: false, error: "Give the reason." };
  return update("edoshmis_medication_administrations", id, { entered_in_error: true, error_reason: reason });
}

/* ---------------------------------------------------------------- discharge */

export async function initiateDischarge(admissionId: string, _: ActionState, fd: FormData) {
  return rpc(
    "edoshmis_initiate_discharge",
    {
      p_admission: admissionId,
      p_type: str(fd, "discharge_type") || "routine",
      d: { time_of_death: fromNairobiLocal(str(fd, "time_of_death")), cause_of_death: opt(fd, "cause_of_death"), destination: opt(fd, "destination") },
    },
    "Discharge started. Complete each step below.",
  );
}

export async function saveDischargeSummary(dischargeId: string, _: ActionState, fd: FormData) {
  const d: Record<string, unknown> = {};
  for (const k of [
    "hospital_course", "treatment_received", "investigation_summary", "procedures_performed", "condition_at_discharge",
    "discharge_medications", "patient_instructions", "follow_up_date", "follow_up_with", "referral_to", "referral_reason", "destination", "cause_of_death",
  ]) {
    d[k] = str(fd, k);
  }
  // The main button completes; "Save draft" sends intent=save.
  const complete = str(fd, "intent") !== "save";
  return rpc("edoshmis_save_discharge_summary", { p_discharge: dischargeId, d, p_complete: complete }, complete ? "Summary complete." : "Saved.");
}

export async function dischargeStep(dischargeId: string, step: string, _: ActionState, fd: FormData) {
  return rpc("edoshmis_discharge_step", { p_discharge: dischargeId, p_step: step, p_note: opt(fd, "note") });
}

export async function clearDischarge(dischargeId: string, kind: string, _: ActionState, fd: FormData) {
  return rpc("edoshmis_clear_discharge", { p_discharge: dischargeId, p_kind: kind, p_status: str(fd, "status") || "cleared", p_note: opt(fd, "note") });
}

export async function authoriseDischarge(dischargeId: string, _: ActionState, fd: FormData) {
  return rpc(
    "edoshmis_authorise_discharge",
    { p_discharge: dischargeId, p_discharged_at: fromNairobiLocal(str(fd, "discharged_at")) },
    "Discharged. The bed has been released for cleaning.",
  );
}

export async function cancelDischarge(dischargeId: string, _: ActionState, fd: FormData) {
  return rpc("edoshmis_cancel_discharge", { p_discharge: dischargeId, p_reason: str(fd, "reason") }, "Discharge cancelled; the patient stays admitted.");
}

function currentShift() {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Africa/Nairobi" }).format(new Date()));
  return h >= 7 && h < 14 ? "morning" : h >= 14 && h < 21 ? "afternoon" : "night";
}
