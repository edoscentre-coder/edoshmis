"use server";

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/session";
import { dbError, num, opt, rpc, str } from "@/lib/actions";
import { fromNairobiLocal } from "@/lib/format";
import { WHO_CHECKLIST, type ChecklistPhase } from "@/lib/who-checklist";
import type { ActionState } from "@/lib/action-state";

export async function requestSurgery(target: { admissionId?: string; encounterId?: string }, _: ActionState, fd: FormData) {
  const s = await requireStaff();
  return rpc(
    "edoshmis_request_surgery",
    {
      p_facility: s.facility.id,
      r: {
        admission_id: target.admissionId ?? null,
        encounter_id: target.encounterId ?? null,
        procedure_name: str(fd, "procedure_name"),
        procedure_code: opt(fd, "procedure_code"),
        laterality: opt(fd, "laterality"),
        urgency: str(fd, "urgency") || "elective",
        indication: opt(fd, "indication"),
        surgeon_id: opt(fd, "surgeon_id"),
      },
    },
    "Surgery requested — schedule it on the theatre list.",
  );
}

export async function scheduleSurgery(id: string, _: ActionState, fd: FormData) {
  return rpc(
    "edoshmis_schedule_surgery",
    {
      p_surgery: id,
      d: {
        theatre_id: str(fd, "theatre_id"),
        scheduled_start: fromNairobiLocal(str(fd, "scheduled_start")),
        duration_minutes: num(fd, "duration_minutes"),
        surgeon_id: opt(fd, "surgeon_id"),
        assistant_id: opt(fd, "assistant_id"),
        anaesthetist_id: opt(fd, "anaesthetist_id"),
        scrub_nurse_id: opt(fd, "scrub_nurse_id"),
      },
    },
    "Scheduled.",
  );
}

export async function surgeryStep(id: string, step: string, _: ActionState, fd: FormData) {
  const d: Record<string, unknown> = {};
  if (step in WHO_CHECKLIST) {
    // yes / na → true, no → false (and the database refuses the phase).
    const answers: Record<string, boolean> = {};
    for (const [k] of WHO_CHECKLIST[step as ChecklistPhase].items) {
      const v = str(fd, k);
      if (!v) return { ok: false, error: "Answer every item." };
      answers[k] = v !== "no";
    }
    d.answers = answers;
  }
  for (const k of ["consent_by", "pre_op_assessment", "asa_class", "anaesthesia_type", "anaesthesia_record", "findings", "procedure_details", "specimens", "complications", "post_op_instructions", "recovery_notes", "destination", "reason"]) {
    const v = opt(fd, k);
    if (v) d[k] = v;
  }
  if (fd.get("fasting_confirmed")) d.fasting_confirmed = fd.get("fasting_confirmed") === "yes";
  const bl = num(fd, "blood_loss_ml");
  if (bl !== null && !Number.isNaN(bl)) d.blood_loss_ml = bl;
  return rpc("edoshmis_surgery_step", { p_surgery: id, p_step: step, d }, "Saved.");
}

export async function addConsumable(id: string, _: ActionState, fd: FormData) {
  return rpc("edoshmis_surgery_consumable", { p_surgery: id, p_item: str(fd, "item_id"), p_qty: num(fd, "quantity") }, "Recorded and taken from the theatre store.");
}

export async function addImplant(id: string, _: ActionState, fd: FormData) {
  return rpc(
    "edoshmis_surgery_implant",
    { p_surgery: id, d: { description: str(fd, "description"), manufacturer: opt(fd, "manufacturer"), lot_number: opt(fd, "lot_number"), serial_number: opt(fd, "serial_number"), site: opt(fd, "site") } },
    "Implant recorded.",
  );
}

export async function saveTheatre(_: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase
    .from("edoshmis_theatres")
    .insert({ facility_id: s.facility.id, name: str(fd, "name"), code: str(fd, "code").toUpperCase(), store_id: opt(fd, "store_id"), tariff_id: opt(fd, "tariff_id") });
  if (error) return { ok: false, error: dbError(error) };
  refresh();
  return { ok: true, message: "Theatre added." };
}
