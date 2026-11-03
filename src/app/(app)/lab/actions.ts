"use server";

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/session";
import { dbError, num, opt, rpc, str } from "@/lib/actions";
import type { ActionState } from "@/lib/action-state";

export async function orderLab(target: { admissionId?: string; encounterId?: string }, _: ActionState, fd: FormData) {
  const s = await requireStaff();
  const tests = fd.getAll("test_ids").map(String).filter(Boolean);
  if (!tests.length) return { ok: false, error: "Choose at least one test." };
  return rpc(
    "edoshmis_order_lab",
    { p_facility: s.facility.id, o: { admission_id: target.admissionId ?? null, encounter_id: target.encounterId ?? null, test_ids: tests, priority: str(fd, "priority") || "routine", clinical_info: opt(fd, "clinical_info") } },
    "Ordered — the specimen is now on the collection list.",
  );
}

export async function labStep(orderId: string, step: "collect" | "receive" | "reject" | "cancel", _: ActionState, fd: FormData) {
  const r = await rpc("edoshmis_lab_step", { p_order: orderId, p_step: step, p_note: opt(fd, "note") });
  if (r.ok && step === "collect") r.message = `Collected. Label the tube ${r.data?.result as string}.`;
  return r;
}

export async function enterResults(itemId: string, _: ActionState, fd: FormData) {
  const values = [...fd.entries()].filter(([k]) => k.startsWith("p:")).map(([k, v]) => ({ parameter_id: k.slice(2), value: String(v).trim() }));
  return rpc("edoshmis_enter_lab_results", { p_item: itemId, r: values, p_amend_reason: opt(fd, "amend_reason") }, "Results saved.");
}

export async function validateLab(orderId: string) {
  return rpc("edoshmis_validate_lab", { p_order: orderId }, "Validated and released.");
}

export async function criticalCall(resultId: string, _: ActionState, fd: FormData) {
  return rpc("edoshmis_record_critical_call", { p_result: resultId, p_to: str(fd, "to"), p_read_back: fd.get("read_back") === "on", p_note: opt(fd, "note") }, "Recorded.");
}

/* ---------------------------------------------------------------- catalogue */

export async function saveLabTest(id: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireStaff();
  const row = {
    code: str(fd, "code").toUpperCase(),
    name: str(fd, "name"),
    discipline: str(fd, "discipline"),
    specimen_type: str(fd, "specimen_type"),
    container: opt(fd, "container"),
    turnaround_hours: num(fd, "turnaround_hours"),
    tariff_id: opt(fd, "tariff_id"),
    instructions: opt(fd, "instructions"),
    is_active: fd.get("inactive") !== "on",
  };
  const supabase = await createClient();
  const { error } = id ? await supabase.from("edoshmis_lab_tests").update(row).eq("id", id) : await supabase.from("edoshmis_lab_tests").insert({ ...row, facility_id: s.facility.id });
  if (error) return { ok: false, error: dbError(error) };
  refresh();
  return { ok: true, message: id ? "Saved." : "Test added — now add its parameters and ranges." };
}

export async function addLabParameter(testId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff();
  const n = (k: string) => {
    const v = num(fd, k);
    return v === null || Number.isNaN(v) ? null : v;
  };
  const choices = str(fd, "choices").split(",").map((c) => c.trim()).filter(Boolean);
  const abnormal = str(fd, "abnormal_choices").split(",").map((c) => c.trim()).filter(Boolean);
  const supabase = await createClient();
  const { error } = await supabase.from("edoshmis_lab_parameters").insert({
    test_id: testId,
    name: str(fd, "name"),
    unit: opt(fd, "unit"),
    value_type: str(fd, "value_type") || "numeric",
    choices: choices.length ? choices : null,
    abnormal_choices: abnormal.length ? abnormal : null,
    sex: opt(fd, "sex"),
    age_min_years: n("age_min_years"),
    age_max_years: n("age_max_years"),
    ref_low: n("ref_low"),
    ref_high: n("ref_high"),
    ref_text: opt(fd, "ref_text"),
    critical_low: n("critical_low"),
    critical_high: n("critical_high"),
    sort_order: n("sort_order") ?? 0,
  });
  if (error) return { ok: false, error: dbError(error) };
  refresh();
  return { ok: true, message: "Parameter added." };
}

export async function deleteLabParameter(id: string): Promise<ActionState> {
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase.from("edoshmis_lab_parameters").delete().eq("id", id);
  if (error) return { ok: false, error: /foreign key/.test(error.message) ? "This parameter has results recorded against it; it cannot be removed." : dbError(error) };
  refresh();
  return { ok: true };
}
