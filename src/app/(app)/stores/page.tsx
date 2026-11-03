import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Boxes, ClipboardList, PackagePlus, ScrollText, Settings2, Truck } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, Disclosure, EmptyState, Field, Input, PageHeader, Select, buttonClass } from "@/components/ui/primitives";
import { ActionButton, ActionForm } from "@/components/ui/action-form";
import { can, requireStaff } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { dateInDays, fmtDate, fmtDateTime, ksh, titleCase, todayNairobi } from "@/lib/format";
import { cn } from "@/lib/utils";
import { adjustStock, createPo, decidePo, fulfilRequisition, openingStock, receiveGoods, requisition, saveItem, saveStore, saveSupplier } from "./actions";

export const metadata: Metadata = { title: "Stores" };

const TABS = [
  ["stock", "Stock", Boxes],
  ["orders", "Purchase orders", Truck],
  ["requisitions", "Requisitions", ClipboardList],
  ["ledger", "Ledger", ScrollText],
  ["setup", "Setup", Settings2],
] as const;
const CATEGORIES = ["drug", "consumable", "reagent", "surgical", "linen", "equipment", "stationery", "other"] as const;

type Item = { id: string; code: string; name: string; unit: string; category: string; is_controlled: boolean };
type Store = { id: string; name: string; code: string; kind: string; is_dispensing: boolean };

/**
 * Stores and pharmacy stock. Everything that changes a quantity — receipts,
 * issues, transfers, dispensing, adjustments — is a row in one append-only
 * ledger; nothing is typed over. Issues are first-expiry-first-out and an
 * expired batch never leaves except as a write-off.
 */
export default async function StoresPage({ searchParams }: { searchParams: Promise<{ tab?: string; store?: string }> }) {
  const s = await requireStaff();
  if (!can(s, "stores.read", "procurement.order", "stores.requisition")) return <EmptyState icon={Boxes} title="Your role does not include stores." />;
  const { tab: t, store: storeParam } = await searchParams;
  const tab = TABS.find(([k]) => k === t)?.[0] ?? "stock";
  const supabase = await createClient();
  const [{ data: storesData }, { data: itemsData }, { data: suppliers }, { data: staff }] = await Promise.all([
    supabase.from("edoshmis_stores").select("id, name, code, kind, is_dispensing").eq("facility_id", s.facility.id).eq("is_active", true).order("name"),
    supabase.from("edoshmis_stock_items").select("id, code, name, unit, category, is_controlled").eq("is_active", true).order("name"),
    supabase.from("edoshmis_suppliers").select("id, name").eq("is_active", true).order("name"),
    supabase.from("edoshmis_staff").select("id, full_name").eq("organization_id", s.staff.organizationId).eq("status", "active").neq("id", s.staff.id).order("full_name"),
  ]);
  const stores = (storesData ?? []) as Store[];
  const items = (itemsData ?? []) as Item[];
  const store = stores.find((x) => x.id === storeParam) ?? stores.find((x) => x.is_dispensing) ?? stores[0];

  const itemRows = (n: number, withCost: boolean) => (
    <div className="flex flex-col gap-2">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className={cn("grid gap-2", withCost ? "grid-cols-[1fr_88px_88px]" : "grid-cols-[1fr_96px]")}>
          <select name={`item_${i}`} defaultValue="" className="h-10 rounded-lg border border-line-strong bg-surface px-2 text-sm" aria-label={`Item ${i + 1}`}>
            <option value="">— item —</option>
            {items.map((it) => (
              <option key={it.id} value={it.id}>
                {it.name} ({it.unit})
              </option>
            ))}
          </select>
          <input name={`qty_${i}`} inputMode="decimal" placeholder="Qty" className="h-10 rounded-lg border border-line-strong bg-surface px-2 text-sm" />
          {withCost && <input name={`cost_${i}`} inputMode="decimal" placeholder="Unit cost" className="h-10 rounded-lg border border-line-strong bg-surface px-2 text-sm" />}
        </div>
      ))}
    </div>
  );

  return (
    <>
      <PageHeader title="Stores" description="Stock, purchasing and issues — first expiry, first out." />
      <nav className="mb-5 flex flex-wrap gap-2">
        {TABS.map(([k, label, Icon]) => (
          <Link key={k} href={`/stores?tab=${k}${store ? `&store=${store.id}` : ""}`} className={buttonClass(k === tab ? "primary" : "secondary", "sm")}>
            <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {label}
          </Link>
        ))}
      </nav>

      {stores.length === 0 && tab !== "setup" ? (
        <Card>
          <EmptyState icon={Boxes} title="No stores set up yet">
            {can(s, "stores.configure") ? <Link href="/stores?tab=setup" className="text-brand hover:underline">Add your stores and items</Link> : "Your storekeeper or pharmacist sets these up."}
          </EmptyState>
        </Card>
      ) : tab === "stock" && store ? (
        <StockTab storeId={store.id} stores={stores} items={items} staff={staff ?? []} canAdjust={can(s, "stores.adjust")} />
      ) : tab === "orders" ? (
        <OrdersTab s={s} stores={stores} suppliers={suppliers ?? []} itemRows={itemRows(6, true)} />
      ) : tab === "requisitions" ? (
        <RequisitionsTab s={s} stores={stores} itemRows={itemRows(6, false)} />
      ) : tab === "ledger" && store ? (
        <LedgerTab storeId={store.id} stores={stores} />
      ) : (
        <SetupTab s={s} stores={stores} items={items} />
      )}
    </>
  );
}

function StorePicker({ stores, current, tab }: { stores: Store[]; current: string; tab: string }) {
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {stores.map((x) => (
        <Link key={x.id} href={`/stores?tab=${tab}&store=${x.id}`} className={cn("rounded-full border px-3 py-1 text-xs font-medium", x.id === current ? "border-brand bg-brand text-white" : "border-line-strong bg-surface text-ink-soft")}>
          {x.name}
          {x.is_dispensing ? " · dispensing" : ""}
        </Link>
      ))}
    </div>
  );
}

async function StockTab({ storeId, stores, items, staff, canAdjust }: { storeId: string; stores: Store[]; items: Item[]; staff: { id: string; full_name: string }[]; canAdjust: boolean }) {
  const supabase = await createClient();
  const [{ data: levels }, { data: batches }] = await Promise.all([
    supabase.from("edoshmis_stock_levels").select("*").eq("store_id", storeId).order("item_name"),
    supabase.from("edoshmis_stock_batches").select("id, item_id, batch_number, expiry_date, quantity, unit_cost").eq("store_id", storeId).gt("quantity", 0).order("expiry_date", { nullsFirst: false }),
  ]);
  const today = todayNairobi();
  const soon = dateInDays(90);
  const lv = (levels ?? []) as { item_id: string; item_name: string; unit: string; is_controlled: boolean; reorder_level: number; on_hand: number; expired: number | null; next_expiry: string | null; value: number }[];
  return (
    <>
      <StorePicker stores={stores} current={storeId} tab="stock" />
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader title={`On hand · ${lv.length} item(s)`} icon={Boxes} />
          {lv.length === 0 ? (
            <EmptyState icon={Boxes} title="Nothing in this store yet" />
          ) : (
            <ul className="divide-y divide-line">
              {lv.map((l) => {
                const bs = (batches ?? []).filter((b) => b.item_id === l.item_id);
                const low = Number(l.on_hand) - Number(l.expired ?? 0) <= Number(l.reorder_level);
                return (
                  <li key={l.item_id} className="px-4 py-3 sm:px-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        {l.item_name} {l.is_controlled && <Badge tone="attention">Controlled</Badge>}
                      </span>
                      <span className="tnum flex items-center gap-2 text-sm">
                        {low && <Badge tone="attention">Reorder</Badge>}
                        {Number(l.expired ?? 0) > 0 && <Badge tone="critical">{Number(l.expired)} expired</Badge>}
                        <strong>
                          {Number(l.on_hand)} {l.unit}
                        </strong>
                        <span className="text-xs text-ink-faint">{ksh(l.value)}</span>
                      </span>
                    </div>
                    <ul className="mt-1.5 flex flex-wrap gap-1.5">
                      {bs.map((b) => {
                        const expired = b.expiry_date && b.expiry_date < today;
                        const expiring = !expired && b.expiry_date && b.expiry_date <= soon;
                        return (
                          <li key={b.id} className={cn("tnum rounded-lg border px-2 py-1 text-xs", expired ? "border-critical/40 bg-critical-soft text-critical-ink" : expiring ? "border-attention/40 bg-attention-soft text-attention-ink" : "border-line bg-surface-sunk")}>
                            {b.batch_number} · {Number(b.quantity)} · exp {fmtDate(b.expiry_date)}
                            {canAdjust && (
                              <Disclosure label="Adjust" variant="ghost" className="mt-1">
                                <ActionForm action={adjustStock.bind(null, b.id)} submitLabel="Apply">
                                  <Field label="Kind">
                                    <Select name="kind" defaultValue={expired ? "write_off" : "adjustment"}>
                                      <option value="adjustment">Count correction (±)</option>
                                      <option value="write_off">Write off (expired / damaged)</option>
                                      <option value="return">Return to supplier</option>
                                    </Select>
                                  </Field>
                                  <Field label="Change" hint="Negative takes stock out, e.g. -5">
                                    <Input name="quantity" inputMode="decimal" required defaultValue={expired ? String(-Number(b.quantity)) : ""} />
                                  </Field>
                                  <Field label="Reason" required>
                                    <Input name="reason" required />
                                  </Field>
                                  {l.is_controlled && (
                                    <Field label="Witness" required>
                                      <Select name="witness_id" defaultValue="">
                                        <option value="">Choose</option>
                                        {staff.map((m) => (
                                          <option key={m.id} value={m.id}>
                                            {m.full_name}
                                          </option>
                                        ))}
                                      </Select>
                                    </Field>
                                  )}
                                </ActionForm>
                              </Disclosure>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        {canAdjust && (
          <Card className="lg:sticky lg:top-20 lg:self-start">
            <CardHeader title="Count in stock" icon={PackagePlus} description="Opening balance, when a store starts on EDOSHMIS" />
            <CardBody>
              <ActionForm action={openingStock} submitLabel="Add to stock">
                <input type="hidden" name="store_id" value={storeId} />
                <Field label="Item" required>
                  <Select name="item_id" required defaultValue="">
                    <option value="" disabled>
                      Choose
                    </option>
                    {items.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Batch" required>
                    <Input name="batch_number" required />
                  </Field>
                  <Field label="Expiry">
                    <Input name="expiry_date" type="date" />
                  </Field>
                  <Field label="Quantity" required>
                    <Input name="quantity" inputMode="decimal" required />
                  </Field>
                  <Field label="Unit cost">
                    <Input name="unit_cost" inputMode="decimal" />
                  </Field>
                </div>
              </ActionForm>
            </CardBody>
          </Card>
        )}
      </div>
    </>
  );
}

async function OrdersTab({ s, stores, suppliers, itemRows }: { s: Awaited<ReturnType<typeof requireStaff>>; stores: Store[]; suppliers: { id: string; name: string }[]; itemRows: React.ReactNode }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("edoshmis_purchase_orders")
    .select("id, po_number, status, raised_at, notes, cancel_reason, edoshmis_suppliers(name), edoshmis_stores(name), raiser:edoshmis_staff!edoshmis_purchase_orders_raised_by_fkey(full_name), approver:edoshmis_staff!edoshmis_purchase_orders_approved_by_fkey(full_name), edoshmis_purchase_order_lines(id, quantity, unit_cost, received_quantity, edoshmis_stock_items(name, unit))")
    .eq("facility_id", s.facility.id)
    .order("raised_at", { ascending: false })
    .limit(50);
  const pos = (data ?? []) as unknown as {
    id: string; po_number: string; status: string; raised_at: string; notes: string | null; cancel_reason: string | null;
    edoshmis_suppliers: { name: string }; edoshmis_stores: { name: string }; raiser: { full_name: string } | null; approver: { full_name: string } | null;
    edoshmis_purchase_order_lines: { id: string; quantity: number; unit_cost: number; received_quantity: number; edoshmis_stock_items: { name: string; unit: string } }[];
  }[];
  return (
    <div className="flex flex-col gap-5">
      {can(s, "procurement.order") && (
        <Disclosure label="New purchase order" icon={Truck} variant="primary" size="md">
          {suppliers.length === 0 ? (
            <p className="text-sm text-ink-soft">Add a supplier under Setup first.</p>
          ) : (
            <ActionForm action={createPo} submitLabel="Raise order">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Supplier" required>
                  <Select name="supplier_id" required defaultValue="">
                    <option value="" disabled>
                      Choose
                    </option>
                    {suppliers.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Deliver to" required>
                  <Select name="store_id" required defaultValue={stores[0]?.id}>
                    {stores.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              {itemRows}
              <Field label="Notes">
                <Input name="notes" />
              </Field>
            </ActionForm>
          )}
        </Disclosure>
      )}
      <Card>
        <CardHeader title="Purchase orders" icon={Truck} />
        {pos.length === 0 ? (
          <EmptyState icon={Truck} title="No purchase orders" />
        ) : (
          <ul className="divide-y divide-line">
            {pos.map((po) => {
              const total = po.edoshmis_purchase_order_lines.reduce((n, l) => n + Number(l.quantity) * Number(l.unit_cost), 0);
              return (
                <li key={po.id} className="px-4 py-3 text-sm sm:px-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <span className="tnum font-medium">{po.po_number}</span> · {po.edoshmis_suppliers.name} → {po.edoshmis_stores.name}
                      <span className="block text-xs text-ink-faint">
                        Raised by {po.raiser?.full_name} {fmtDateTime(po.raised_at)}
                        {po.approver ? ` · approved by ${po.approver.full_name}` : ""}
                        {po.cancel_reason ? ` · ${po.cancel_reason}` : ""}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="tnum text-xs text-ink-soft">{ksh(total)}</span>
                      <Badge tone={po.status === "received" ? "positive" : po.status === "cancelled" ? "neutral" : po.status === "submitted" ? "attention" : "info"}>{titleCase(po.status)}</Badge>
                    </span>
                  </div>
                  <ul className="mt-1 text-xs text-ink-soft">
                    {po.edoshmis_purchase_order_lines.map((l) => (
                      <li key={l.id} className="tnum">
                        {l.edoshmis_stock_items.name}: {Number(l.received_quantity)}/{Number(l.quantity)} {l.edoshmis_stock_items.unit} @ {ksh(l.unit_cost)}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {po.status === "submitted" && can(s, "procurement.approve") && (
                      <>
                        <ActionButton action={decidePo.bind(null, po.id, true)} variant="primary">
                          Approve
                        </ActionButton>
                        <Disclosure label="Reject" variant="ghost">
                          <ActionForm action={decidePo.bind(null, po.id, false)} submitLabel="Reject" submitVariant="danger">
                            <Field label="Reason" required>
                              <Input name="reason" required />
                            </Field>
                          </ActionForm>
                        </Disclosure>
                      </>
                    )}
                    {["approved", "partially_received"].includes(po.status) && can(s, "stores.receive") && (
                      <Disclosure label="Receive goods" variant="primary">
                        <ActionForm action={receiveGoods.bind(null, po.id)} submitLabel="Receive">
                          {po.edoshmis_purchase_order_lines
                            .filter((l) => Number(l.received_quantity) < Number(l.quantity))
                            .map((l) => (
                              <fieldset key={l.id} className="rounded-lg border border-line p-2">
                                <legend className="px-1 text-xs font-medium">
                                  {l.edoshmis_stock_items.name} — {Number(l.quantity) - Number(l.received_quantity)} outstanding
                                </legend>
                                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                  <Input name={`recv_${l.id}`} inputMode="decimal" placeholder="Qty" />
                                  <Input name={`batch_${l.id}`} placeholder="Batch" />
                                  <Input name={`expiry_${l.id}`} type="date" aria-label="Expiry" />
                                  <Input name={`cost_${l.id}`} inputMode="decimal" placeholder={`Cost ${Number(l.unit_cost)}`} />
                                </div>
                              </fieldset>
                            ))}
                        </ActionForm>
                      </Disclosure>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

async function RequisitionsTab({ s, stores, itemRows }: { s: Awaited<ReturnType<typeof requireStaff>>; stores: Store[]; itemRows: React.ReactNode }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("edoshmis_requisitions")
    .select("id, requisition_number, status, requested_at, note, from:edoshmis_stores!edoshmis_requisitions_from_store_id_fkey(name), to:edoshmis_stores!edoshmis_requisitions_to_store_id_fkey(name), requester:edoshmis_staff!edoshmis_requisitions_requested_by_fkey(full_name), edoshmis_requisition_lines(id, quantity, issued_quantity, edoshmis_stock_items(name, unit))")
    .eq("facility_id", s.facility.id)
    .order("requested_at", { ascending: false })
    .limit(50);
  const reqs = (data ?? []) as unknown as {
    id: string; requisition_number: string; status: string; requested_at: string; note: string | null; from: { name: string }; to: { name: string }; requester: { full_name: string } | null;
    edoshmis_requisition_lines: { id: string; quantity: number; issued_quantity: number; edoshmis_stock_items: { name: string; unit: string } }[];
  }[];
  return (
    <div className="flex flex-col gap-5">
      {can(s, "stores.requisition") && stores.length > 1 && (
        <Disclosure label="New requisition" icon={ClipboardList} variant="primary" size="md">
          <ActionForm action={requisition} submitLabel="Send requisition">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="From (issuing store)" required>
                <Select name="from_store_id" required defaultValue={stores.find((x) => x.kind === "main_store")?.id ?? stores[0].id}>
                  {stores.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="To (your store)" required>
                <Select name="to_store_id" required defaultValue={stores.find((x) => x.kind !== "main_store")?.id ?? stores[1].id}>
                  {stores.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {itemRows}
            <Field label="Note">
              <Input name="note" />
            </Field>
          </ActionForm>
        </Disclosure>
      )}
      <Card>
        <CardHeader title="Requisitions" icon={ClipboardList} />
        {reqs.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No requisitions" />
        ) : (
          <ul className="divide-y divide-line">
            {reqs.map((r) => (
              <li key={r.id} className="px-4 py-3 text-sm sm:px-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <span className="tnum font-medium">{r.requisition_number}</span> · {r.from.name} → {r.to.name}
                    <span className="block text-xs text-ink-faint">
                      {r.requester?.full_name} · {fmtDateTime(r.requested_at)}
                      {r.note ? ` · ${r.note}` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone={r.status === "fulfilled" ? "positive" : "attention"}>{titleCase(r.status)}</Badge>
                    {["requested", "partially_fulfilled"].includes(r.status) && can(s, "stores.issue") && (
                      <ActionButton action={fulfilRequisition.bind(null, r.id)} variant="primary" confirm="Issue these items now?">
                        Issue
                      </ActionButton>
                    )}
                  </span>
                </div>
                <ul className="mt-1 text-xs text-ink-soft">
                  {r.edoshmis_requisition_lines.map((l) => (
                    <li key={l.id} className="tnum">
                      {l.edoshmis_stock_items.name}: {Number(l.issued_quantity)}/{Number(l.quantity)} {l.edoshmis_stock_items.unit}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

async function LedgerTab({ storeId, stores }: { storeId: string; stores: Store[] }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("edoshmis_stock_movements")
    .select("id, created_at, kind, quantity, balance_after, reason, reference_type, edoshmis_stock_items(name, unit, is_controlled), edoshmis_stock_batches(batch_number), staff:edoshmis_staff!edoshmis_stock_movements_staff_id_fkey(full_name), witness:edoshmis_staff!edoshmis_stock_movements_witness_id_fkey(full_name)")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(300);
  const rows = (data ?? []) as unknown as {
    id: number; created_at: string; kind: string; quantity: number; balance_after: number; reason: string | null; reference_type: string | null;
    edoshmis_stock_items: { name: string; unit: string; is_controlled: boolean }; edoshmis_stock_batches: { batch_number: string }; staff: { full_name: string } | null; witness: { full_name: string } | null;
  }[];
  return (
    <>
      <StorePicker stores={stores} current={storeId} tab="ledger" />
      <Card>
        <CardHeader title="Stock ledger" icon={ScrollText} description="Every movement, newest first. Controlled items are flagged — this is the controlled-drug register." />
        {rows.length === 0 ? (
          <EmptyState icon={ScrollText} title="No movements yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="tnum w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-faint">
                  <th className="px-5 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Item · batch</th>
                  <th className="px-3 py-2 font-medium">Movement</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 text-right font-medium">Batch balance</th>
                  <th className="px-5 py-2 font-medium">By</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id} className={cn("border-t border-line", m.edoshmis_stock_items.is_controlled && "bg-attention-soft/30")}>
                    <td className="px-5 py-2 whitespace-nowrap">{fmtDateTime(m.created_at)}</td>
                    <td className="px-3 py-2">
                      {m.edoshmis_stock_items.name} <span className="text-xs text-ink-faint">· {m.edoshmis_stock_batches.batch_number}</span>
                    </td>
                    <td className="px-3 py-2">
                      {titleCase(m.kind)}
                      {m.reason ? <span className="block text-xs text-ink-faint">{m.reason}</span> : null}
                    </td>
                    <td className={cn("px-3 py-2 text-right font-medium", Number(m.quantity) < 0 ? "text-attention-ink" : "text-positive-ink")}>
                      {Number(m.quantity) > 0 ? "+" : ""}
                      {Number(m.quantity)}
                    </td>
                    <td className="px-3 py-2 text-right">{Number(m.balance_after)}</td>
                    <td className="px-5 py-2 text-xs text-ink-soft">
                      {m.staff?.full_name}
                      {m.witness ? ` · witness ${m.witness.full_name}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

async function SetupTab({ s, stores, items }: { s: Awaited<ReturnType<typeof requireStaff>>; stores: Store[]; items: Item[] }) {
  const supabase = await createClient();
  const [{ data: drugs }, { data: wards }, { data: suppliers }] = await Promise.all([
    supabase.from("edoshmis_drugs").select("id, generic_name, strength").eq("is_active", true).order("generic_name"),
    supabase.from("edoshmis_wards").select("id, name").eq("facility_id", s.facility.id).order("name"),
    supabase.from("edoshmis_suppliers").select("id, name, phone, kra_pin").order("name"),
  ]);
  const config = can(s, "stores.configure");
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card>
        <CardHeader
          title={`Stores · ${stores.length}`}
          actions={
            config && (
              <Disclosure label="Add" variant="secondary">
                <ActionForm action={saveStore} submitLabel="Add store">
                  <Field label="Name" required>
                    <Input name="name" required />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Code" required>
                      <Input name="code" required className="uppercase" />
                    </Field>
                    <Field label="Kind">
                      <Select name="kind" defaultValue="main_store">
                        {["main_store", "pharmacy", "ward", "theatre", "laboratory", "other"].map((k) => (
                          <option key={k} value={k}>
                            {titleCase(k)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <Field label="Ward" hint="For a ward store">
                    <Select name="ward_id" defaultValue="">
                      <option value="">—</option>
                      {wards?.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="is_dispensing" className="h-4 w-4 accent-brand" /> Dispensing draws from this store (one per facility)
                  </label>
                </ActionForm>
              </Disclosure>
            )
          }
        />
        <ul className="divide-y divide-line">
          {stores.map((x) => (
            <li key={x.id} className="px-5 py-2.5 text-sm">
              {x.name} <span className="text-xs text-ink-faint">· {x.code} · {titleCase(x.kind)}</span> {x.is_dispensing && <Badge tone="brand">Dispensing</Badge>}
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader
          title={`Items · ${items.length}`}
          actions={
            config && (
              <Disclosure label="Add" variant="secondary">
                <ActionForm action={saveItem} submitLabel="Add item">
                  <Field label="Name" required>
                    <Input name="name" required />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Code" required>
                      <Input name="code" required className="uppercase" />
                    </Field>
                    <Field label="Unit" required>
                      <Input name="unit" required placeholder="tablet, vial, box" />
                    </Field>
                    <Field label="Category">
                      <Select name="category" defaultValue="drug">
                        {CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {titleCase(c)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Reorder at">
                      <Input name="reorder_level" inputMode="decimal" />
                    </Field>
                  </div>
                  <Field label="Linked drug" hint="Dispensing this drug takes it from stock">
                    <Select name="drug_id" defaultValue="">
                      <option value="">—</option>
                      {drugs?.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.generic_name} {d.strength ?? ""}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="is_controlled" className="h-4 w-4 accent-brand" /> Controlled (witnessed adjustments)
                  </label>
                </ActionForm>
              </Disclosure>
            )
          }
        />
        <ul className="max-h-96 divide-y divide-line overflow-y-auto">
          {items.map((it) => (
            <li key={it.id} className="px-5 py-2 text-sm">
              {it.name} <span className="text-xs text-ink-faint">· {it.code} · {it.unit}</span> {it.is_controlled && <AlertTriangle className="inline h-3 w-3 text-attention-ink" aria-label="Controlled" />}
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader
          title={`Suppliers · ${suppliers?.length ?? 0}`}
          actions={
            can(s, "procurement.order") && (
              <Disclosure label="Add" variant="secondary">
                <ActionForm action={saveSupplier} submitLabel="Add supplier">
                  <Field label="Name" required>
                    <Input name="name" required />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="KRA PIN">
                      <Input name="kra_pin" className="uppercase" />
                    </Field>
                    <Field label="Phone">
                      <Input name="phone" />
                    </Field>
                  </div>
                  <Field label="Email">
                    <Input name="email" type="email" />
                  </Field>
                  <Field label="Payment terms">
                    <Input name="payment_terms" placeholder="e.g. 30 days" />
                  </Field>
                </ActionForm>
              </Disclosure>
            )
          }
        />
        <ul className="divide-y divide-line">
          {suppliers?.map((x) => (
            <li key={x.id} className="px-5 py-2 text-sm">
              {x.name} <span className="text-xs text-ink-faint">{[x.kra_pin, x.phone].filter(Boolean).join(" · ")}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
