"use server";

import { num, opt, rpc, str } from "@/lib/actions";
import type { ActionState } from "@/lib/action-state";

/* Billing actions, shared by the inpatient Billing tab and the Billing department. */

export async function postBedCharges(admissionId: string) {
  const r = await rpc("edoshmis_post_bed_charges", { p_admission: admissionId });
  if (r.ok) r.message = `${r.data?.result ?? 0} new bed-day charge(s) posted.`;
  return r;
}

export async function postCharge(accountId: string, _: ActionState, fd: FormData) {
  const qty = num(fd, "quantity");
  const price = num(fd, "unit_price");
  if (Number.isNaN(qty) || Number.isNaN(price)) return { ok: false, error: "Quantity and price must be numbers." };
  return rpc(
    "edoshmis_post_charge",
    {
      p_account: accountId,
      c: { tariff_id: opt(fd, "tariff_id"), description: opt(fd, "description"), quantity: qty ?? 1, unit_price: price, service_date: opt(fd, "service_date") },
    },
    "Charged.",
  );
}

export async function adjustCharge(chargeId: string, _: ActionState, fd: FormData) {
  return rpc("edoshmis_adjust_charge", { p_charge: chargeId, p_amount: num(fd, "amount"), p_reason: str(fd, "reason") }, "Adjusted.");
}

export async function receivePayment(accountId: string, _: ActionState, fd: FormData) {
  const amount = num(fd, "amount");
  if (!amount || Number.isNaN(amount) || amount <= 0) return { ok: false, error: "Enter the amount." };
  return rpc(
    "edoshmis_receive_payment",
    {
      p_account: accountId,
      p: { kind: str(fd, "kind") || "payment", method: str(fd, "method"), amount, reference: opt(fd, "reference"), payer_name: opt(fd, "payer_name"), note: opt(fd, "note") },
    },
    "Payment recorded.",
  );
}

export async function voidPayment(paymentId: string, _: ActionState, fd: FormData) {
  return rpc("edoshmis_void_payment", { p_payment: paymentId, p_reason: str(fd, "reason") }, "Voided.");
}
