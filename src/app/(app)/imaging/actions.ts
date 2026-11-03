"use server";

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/session";
import { dbError, opt, rpc, str } from "@/lib/actions";
import { fromNairobiLocal } from "@/lib/format";
import type { ActionState } from "@/lib/action-state";

export async function orderImaging(target: { admissionId?: string; encounterId?: string }, _: ActionState, fd: FormData) {
  const s = await requireStaff();
  return rpc(
    "edoshmis_order_imaging",
    {
      p_facility: s.facility.id,
      o: {
        admission_id: target.admissionId ?? null,
        encounter_id: target.encounterId ?? null,
        exam_id: str(fd, "exam_id"),
        priority: str(fd, "priority") || "routine",
        clinical_indication: str(fd, "clinical_indication"),
        pregnancy_status: opt(fd, "pregnancy_status"),
      },
    },
    "Ordered — it is on the imaging worklist.",
  );
}

export async function imagingStep(orderId: string, step: string, _: ActionState, fd: FormData) {
  const d: Record<string, unknown> = {};
  for (const k of ["technique", "contrast_given", "pacs_study_uid", "findings", "impression", "reason", "body"]) {
    const v = opt(fd, k);
    if (v) d[k] = v;
  }
  const when = fromNairobiLocal(str(fd, "scheduled_for"));
  if (when) d.scheduled_for = when;
  const done = fromNairobiLocal(str(fd, "performed_at"));
  if (done) d.performed_at = done;
  return rpc("edoshmis_imaging_step", { p_order: orderId, p_step: step, d }, step === "validate" ? "Validated and released." : "Saved.");
}

export async function saveExam(id: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireStaff();
  const row = {
    code: str(fd, "code").toUpperCase(),
    name: str(fd, "name"),
    modality: str(fd, "modality"),
    body_part: opt(fd, "body_part"),
    uses_contrast: fd.get("uses_contrast") === "on",
    ionising: fd.get("ionising") === "on",
    preparation: opt(fd, "preparation"),
    tariff_id: opt(fd, "tariff_id"),
    is_active: fd.get("inactive") !== "on",
  };
  const supabase = await createClient();
  const { error } = id ? await supabase.from("edoshmis_imaging_exams").update(row).eq("id", id) : await supabase.from("edoshmis_imaging_exams").insert({ ...row, facility_id: s.facility.id });
  if (error) return { ok: false, error: dbError(error) };
  refresh();
  return { ok: true, message: id ? "Saved." : "Examination added." };
}
