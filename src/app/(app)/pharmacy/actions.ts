"use server";

import { num, opt, rpc } from "@/lib/actions";
import type { ActionState } from "@/lib/action-state";

export async function verifyOrder(orderId: string, approve: boolean, _: ActionState, fd: FormData) {
  return rpc("edoshmis_verify_order", { p_order: orderId, p_approve: approve, p_note: opt(fd, "note") }, approve ? "Verified — the ward can now give it." : "Returned to the prescriber.");
}

export async function dispense(orderId: string, _: ActionState, fd: FormData) {
  const quantity = num(fd, "quantity");
  if (!quantity || Number.isNaN(quantity)) return { ok: false, error: "Enter the quantity issued." };
  return rpc(
    "edoshmis_dispense",
    { p_order: orderId, d: { quantity, unit: opt(fd, "unit"), batch_number: opt(fd, "batch_number"), expiry_date: opt(fd, "expiry_date"), note: opt(fd, "note") } },
    "Dispensed.",
  );
}
