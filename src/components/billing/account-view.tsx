import { Banknote, Plus, ReceiptText, Wallet } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, Disclosure, EmptyState, Fact, Field, Input, Select } from "@/components/ui/primitives";
import { ActionButton, ActionForm } from "@/components/ui/action-form";
import { can, type StaffSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, fmtDateTime, ksh, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { adjustCharge, postBedCharges, postCharge, receivePayment, voidPayment } from "@/app/(app)/billing/actions";

interface Charge {
  id: string;
  category: string;
  description: string;
  service_date: string;
  quantity: number;
  unit_price: number;
  amount: number;
  charge_key: string | null;
  reverses_id: string | null;
  reason: string | null;
  posted_at: string;
  poster: { full_name: string } | null;
}
interface Payment {
  id: string;
  receipt_number: string;
  kind: string;
  method: string;
  amount: number;
  reference: string | null;
  payer_name: string | null;
  note: string | null;
  received_at: string;
  voided_at: string | null;
  void_reason: string | null;
  receiver: { full_name: string } | null;
}

/**
 * A running bill: what has been charged, what has been paid, what is owed.
 * Used by the inpatient Billing tab and the Billing department alike. No
 * line is ever edited or deleted — corrections are reversals and discounts
 * with a reason, payments are voided with a reason.
 */
export async function AccountView({ s, accountId, admissionId }: { s: StaffSession; accountId: string; admissionId: string | null }) {
  const supabase = await createClient();
  const [{ data: acct }, { data: bal }, { data: charges }, { data: payments }, { data: tariffs }] = await Promise.all([
    supabase.from("edoshmis_billing_accounts").select("id, account_number, payer_category, status, opened_at, closed_at, facility_id").eq("id", accountId).maybeSingle(),
    supabase.from("edoshmis_account_balances").select("charges, paid, deposits, refunds, balance").eq("account_id", accountId).maybeSingle(),
    supabase.from("edoshmis_charges").select("*, poster:edoshmis_staff!edoshmis_charges_posted_by_fkey(full_name)").eq("account_id", accountId).order("service_date").order("posted_at"),
    supabase.from("edoshmis_payments").select("*, receiver:edoshmis_staff!edoshmis_payments_received_by_fkey(full_name)").eq("account_id", accountId).order("received_at"),
    can(s, "billing.charge") ? supabase.from("edoshmis_tariffs").select("id, code, name, category, price, sha_price").eq("facility_id", s.facility.id).eq("is_active", true).order("category").order("name") : Promise.resolve({ data: null }),
  ]);
  if (!acct) return <EmptyState icon={Wallet} title="No bill for this admission yet" />;

  const lines = (charges ?? []) as unknown as Charge[];
  const reversed = new Set(lines.filter((c) => c.reverses_id).map((c) => c.reverses_id));
  const pays = (payments ?? []) as unknown as Payment[];
  const open = acct.status === "open";
  const owed = Number(bal?.balance ?? 0);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <div className="flex min-w-0 flex-col gap-5">
        <Card>
          <CardHeader
            title={<span className="tnum">Bill {acct.account_number}</span>}
            icon={ReceiptText}
            description={`${titleCase(acct.payer_category)} · opened ${fmtDate(acct.opened_at)}${acct.closed_at ? ` · closed ${fmtDate(acct.closed_at)}` : ""}`}
            actions={
              open &&
              admissionId &&
              can(s, "billing.charge") && (
                <ActionButton action={postBedCharges.bind(null, admissionId)} variant="secondary">
                  Post bed-days to date
                </ActionButton>
              )
            }
          />
          <CardBody>
            <dl className="tnum grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Fact label="Charges">{ksh(bal?.charges)}</Fact>
              <Fact label="Paid">{ksh(bal?.paid)}</Fact>
              <Fact label="Of which deposits">{ksh(bal?.deposits)}</Fact>
              <Fact label="Balance">
                <span className={cn("text-base font-semibold", owed > 0 ? "text-attention-ink" : "text-positive-ink")}>{ksh(owed)}</span>
              </Fact>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={`Charges · ${lines.length}`} />
          {lines.length === 0 ? (
            <CardBody className="text-sm text-ink-faint">Nothing charged yet.</CardBody>
          ) : (
            <div className="overflow-x-auto">
              <table className="tnum w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-faint">
                    <th className="px-5 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Item</th>
                    <th className="px-3 py-2 text-right font-medium">Qty × price</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                    <th className="px-5 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((c) => (
                    <tr key={c.id} className={cn("border-t border-line align-top", c.reverses_id && "text-attention-ink", reversed.has(c.id) && "text-ink-faint")}>
                      <td className="px-5 py-2 whitespace-nowrap">{fmtDate(c.service_date)}</td>
                      <td className="px-3 py-2">
                        {c.description}
                        <span className="block text-xs text-ink-faint">
                          {titleCase(c.category)} · {c.poster?.full_name ?? "System"}
                          {c.reason ? ` · ${c.reason}` : ""}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {Number(c.quantity)} × {ksh(c.unit_price)}
                      </td>
                      <td className="px-3 py-2 text-right font-medium whitespace-nowrap">{ksh(c.amount)}</td>
                      <td className="px-5 py-2 text-right">
                        {open && !c.reverses_id && !reversed.has(c.id) && can(s, "billing.adjust") && (
                          <Disclosure label="Adjust" variant="ghost">
                            <ActionForm action={adjustCharge.bind(null, c.id)} submitLabel="Apply" className="text-left">
                              <Field label="Amount off (KSh)" hint={`Full ${ksh(c.amount)} reverses the charge`}>
                                <Input name="amount" inputMode="decimal" defaultValue={String(c.amount)} required />
                              </Field>
                              <Field label="Reason" required>
                                <Input name="reason" required placeholder="e.g. Charged in error / approved discount" />
                              </Field>
                            </ActionForm>
                          </Disclosure>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title={`Payments · ${pays.length}`} icon={Banknote} />
          {pays.length === 0 ? (
            <CardBody className="text-sm text-ink-faint">No payments.</CardBody>
          ) : (
            <ul className="divide-y divide-line">
              {pays.map((p) => (
                <li key={p.id} className={cn("flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm", p.voided_at && "text-ink-faint line-through")}>
                  <span className="tnum">
                    <span className="font-medium">{ksh(p.amount)}</span> · {titleCase(p.kind)} · {titleCase(p.method)}
                    {p.reference ? ` · ${p.reference}` : ""}
                    <span className="block text-xs text-ink-faint">
                      {p.receipt_number} · {fmtDateTime(p.received_at)} · {p.receiver?.full_name}
                      {p.note ? ` · ${p.note}` : ""}
                      {p.voided_at ? ` · voided: ${p.void_reason}` : ""}
                    </span>
                  </span>
                  {!p.voided_at && can(s, "billing.adjust") && (
                    <Disclosure label="Void" variant="ghost">
                      <ActionForm action={voidPayment.bind(null, p.id)} submitLabel="Void payment" submitVariant="danger">
                        <Field label="Reason" required>
                          <Input name="reason" required />
                        </Field>
                      </ActionForm>
                    </Disclosure>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="flex min-w-0 flex-col gap-5 lg:sticky lg:top-20 lg:self-start">
        {open && can(s, "billing.payment") && (
          <Card>
            <CardHeader title="Receive payment" icon={Banknote} />
            <CardBody>
              <ActionForm action={receivePayment.bind(null, accountId)} submitLabel="Record payment">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Type">
                    <Select name="kind" defaultValue="payment">
                      <option value="payment">Payment</option>
                      <option value="deposit">Deposit</option>
                      <option value="payer_settlement">Insurer / SHA settlement</option>
                      {can(s, "billing.adjust") && <option value="waiver">Waiver</option>}
                      {can(s, "billing.adjust") && <option value="refund">Refund</option>}
                    </Select>
                  </Field>
                  <Field label="Method">
                    <Select name="method" defaultValue="mpesa">
                      <option value="mpesa">M-Pesa</option>
                      <option value="cash">Cash</option>
                      <option value="card">Card</option>
                      <option value="bank_transfer">Bank transfer</option>
                      <option value="cheque">Cheque</option>
                      <option value="sha">SHA</option>
                      <option value="insurance">Insurance</option>
                      <option value="corporate">Corporate</option>
                      <option value="waiver">Waiver</option>
                    </Select>
                  </Field>
                </div>
                <Field label="Amount (KSh)" required hint={owed > 0 ? `Balance ${ksh(owed)}` : undefined}>
                  <Input name="amount" inputMode="decimal" required className="tnum h-11 text-base" />
                </Field>
                <Field label="Reference" hint="M-Pesa code from the SMS (e.g. SGH7XK2LMN), card or bank reference">
                  <Input name="reference" className="uppercase" autoComplete="off" />
                </Field>
                <Field label="Paid by">
                  <Input name="payer_name" />
                </Field>
                <Field label="Note" hint="Required for waivers and refunds">
                  <Input name="note" />
                </Field>
              </ActionForm>
            </CardBody>
          </Card>
        )}

        {open && can(s, "billing.charge") && (
          <Card>
            <CardHeader title="Add charge" icon={Plus} />
            <CardBody>
              <ActionForm action={postCharge.bind(null, accountId)} submitLabel="Charge">
                <Field label="Item" hint={tariffs?.length ? undefined : "No tariffs yet — an administrator sets prices under Tariffs"}>
                  <Select name="tariff_id" defaultValue="">
                    <option value="">— Other (enter description and price) —</option>
                    {tariffs?.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} · {ksh(acct.payer_category === "sha" && t.sha_price != null ? t.sha_price : t.price)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Description" hint="For an item not on the list">
                  <Input name="description" />
                </Field>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Qty">
                    <Input name="quantity" inputMode="decimal" defaultValue="1" />
                  </Field>
                  <Field label="Price" hint="Blank = list price" className="col-span-2">
                    <Input name="unit_price" inputMode="decimal" />
                  </Field>
                </div>
                <Field label="Service date">
                  <Input name="service_date" type="date" />
                </Field>
              </ActionForm>
            </CardBody>
          </Card>
        )}
        {!open && (
          <Card>
            <CardBody className="text-sm text-ink-soft">
              <Badge>Closed</Badge> This bill was closed at discharge.
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
