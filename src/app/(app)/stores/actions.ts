"use server";

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/session";
import { dbError, num, opt, rpc, str } from "@/lib/actions";
import type { ActionState } from "@/lib/action-state";

async function write(op: (sb: Awaited<ReturnType<typeof createClient>>) => PromiseLike<{ error: { message: string; code?: string } | null }>, message: string): Promise<ActionState> {
  await requireStaff();
  const supabase = await createClient();
  const { error } = await op(supabase);
  if (error) return { ok: false, error: dbError(error) };
  refresh();
  return { ok: true, message };
}

/** Lines from a form: item_<n>, qty_<n>, cost_<n>. */
function lines(fd: FormData) {
  const out: { item_id: string; quantity: number; unit_cost: number }[] = [];
  for (const [k, v] of fd.entries()) {
    const m = k.match(/^item_(\d+)$/);
    if (!m || !v) continue;
    const q = Number(fd.get(`qty_${m[1]}`));
    if (q > 0) out.push({ item_id: String(v), quantity: q, unit_cost: Number(fd.get(`cost_${m[1]}`) || 0) });
  }
  return out;
}

export async function saveStore(_: ActionState, fd: FormData) {
  const s = await requireStaff();
  return write((sb) => sb.from("edoshmis_stores").insert({ facility_id: s.facility.id, name: str(fd, "name"), code: str(fd, "code").toUpperCase(), kind: str(fd, "kind"), ward_id: opt(fd, "ward_id"), is_dispensing: fd.get("is_dispensing") === "on" }), "Store added.");
}

export async function saveItem(_: ActionState, fd: FormData) {
  const s = await requireStaff();
  return write(
    (sb) =>
      sb.from("edoshmis_stock_items").insert({
        organization_id: s.staff.organizationId,
        code: str(fd, "code").toUpperCase(),
        name: str(fd, "name"),
        category: str(fd, "category"),
        unit: str(fd, "unit"),
        drug_id: opt(fd, "drug_id"),
        is_controlled: fd.get("is_controlled") === "on",
        reorder_level: num(fd, "reorder_level") ?? 0,
      }),
    "Item added.",
  );
}

export async function saveSupplier(_: ActionState, fd: FormData) {
  const s = await requireStaff();
  return write(
    (sb) => sb.from("edoshmis_suppliers").insert({ organization_id: s.staff.organizationId, name: str(fd, "name"), kra_pin: opt(fd, "kra_pin"), phone: opt(fd, "phone"), email: opt(fd, "email"), payment_terms: opt(fd, "payment_terms") }),
    "Supplier added.",
  );
}

export async function openingStock(_: ActionState, fd: FormData) {
  return rpc(
    "edoshmis_opening_stock",
    { p_store: str(fd, "store_id"), p_item: str(fd, "item_id"), p_batch: str(fd, "batch_number"), p_expiry: opt(fd, "expiry_date"), p_qty: num(fd, "quantity"), p_cost: num(fd, "unit_cost") ?? 0 },
    "Counted into stock.",
  );
}

export async function adjustStock(batchId: string, _: ActionState, fd: FormData) {
  const q = num(fd, "quantity");
  if (!q || Number.isNaN(q)) return { ok: false, error: "Enter the change, e.g. -5 or 10." };
  return rpc("edoshmis_adjust_stock", { p_batch: batchId, p_qty: q, p_kind: str(fd, "kind") || "adjustment", p_reason: str(fd, "reason"), p_witness: opt(fd, "witness_id") }, "Adjusted.");
}

export async function createPo(_: ActionState, fd: FormData) {
  const s = await requireStaff();
  return rpc("edoshmis_create_po", { p_facility: s.facility.id, p: { supplier_id: str(fd, "supplier_id"), store_id: str(fd, "store_id"), notes: opt(fd, "notes"), lines: lines(fd) } }, "Purchase order raised — it now needs approval.");
}

export async function decidePo(poId: string, approve: boolean, _: ActionState, fd: FormData) {
  return rpc("edoshmis_decide_po", { p_po: poId, p_approve: approve, p_reason: opt(fd, "reason") }, approve ? "Approved." : "Rejected.");
}

export async function receiveGoods(poId: string, _: ActionState, fd: FormData) {
  const r: Record<string, unknown>[] = [];
  for (const [k, v] of fd.entries()) {
    const m = k.match(/^recv_(.+)$/);
    if (!m || !Number(v)) continue;
    r.push({ line_id: m[1], quantity: Number(v), batch_number: str(fd, `batch_${m[1]}`), expiry_date: opt(fd, `expiry_${m[1]}`), unit_cost: num(fd, `cost_${m[1]}`) });
  }
  if (!r.length) return { ok: false, error: "Enter the quantity received on at least one line." };
  return rpc("edoshmis_receive_goods", { p_po: poId, r }, "Received into stock.");
}

export async function requisition(_: ActionState, fd: FormData) {
  const s = await requireStaff();
  return rpc(
    "edoshmis_requisition",
    { p_facility: s.facility.id, r: { from_store_id: str(fd, "from_store_id"), to_store_id: str(fd, "to_store_id"), note: opt(fd, "note"), lines: lines(fd).map(({ item_id, quantity }) => ({ item_id, quantity })) } },
    "Requisition sent.",
  );
}

export async function fulfilRequisition(reqId: string) {
  return rpc("edoshmis_fulfil_requisition", { p_req: reqId, p_lines: null }, "Issued — first expiry first out.");
}
