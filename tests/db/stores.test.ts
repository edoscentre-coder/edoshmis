import { beforeAll, describe, expect, it } from "vitest";
import { hospital } from "./fixture";

let h: Awaited<ReturnType<typeof hospital>>;
beforeAll(async () => {
  h = await hospital();
  await h.hire("store", "storekeeper", "storekeeper");
  await h.hire("buyer", "procurement_officer", "procurement_officer");
  await h.hire("accounts", "accountant", "accountant");
});

describe("stores and pharmacy stock", () => {
  it("receives against an approved PO, issues FEFO, never issues expired stock, and dispensing draws it down", async () => {
    const pharmacy = (await h.as1<{ id: string }>("pharm", "insert into edoshmis_stores (facility_id, name, code, kind, is_dispensing) values ($1, 'Main pharmacy', 'PHARM', 'pharmacy', true) returning id", [h.fac])).id;
    const main = (await h.as1<{ id: string }>("store", "insert into edoshmis_stores (facility_id, name, code, kind) values ($1, 'Main store', 'MAIN', 'main_store') returning id", [h.fac])).id;
    const drug = (await h.as1<{ id: string }>("pharm", "insert into edoshmis_drugs (organization_id, generic_name, form, strength) values ($1, 'Paracetamol', 'tablet', '500 mg') returning id", [h.org])).id;
    const item = (await h.as1<{ id: string }>("pharm", "insert into edoshmis_stock_items (organization_id, code, name, category, unit, drug_id) values ($1, 'PCM500', 'Paracetamol 500 mg tab', 'drug', 'tablet', $2) returning id", [h.org, drug])).id;
    const sup = (await h.as1<{ id: string }>("buyer", "insert into edoshmis_suppliers (organization_id, name) values ($1, 'Test Pharma Ltd') returning id", [h.org])).id;

    const po = (await h.as1<{ id: string }>("buyer", "select edoshmis_create_po($1, $2) as id", [h.fac, JSON.stringify({ supplier_id: sup, store_id: main, lines: [{ item_id: item, quantity: 300, unit_cost: 2 }] })])).id;
    expect(await h.fails("store", "select edoshmis_receive_goods($1, '[]')", [po])).toMatch(/approved/);
    await h.as("accounts", "select edoshmis_decide_po($1, true)", [po]);
    const line = (await h.as1<{ id: string }>("store", "select id from edoshmis_purchase_order_lines where po_id = $1", [po])).id;
    const later = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);
    const sooner = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
    await h.as("store", "select edoshmis_receive_goods($1, $2)", [po, JSON.stringify([{ line_id: line, quantity: 200, batch_number: "LATE", expiry_date: later }])]);
    await h.as("store", "select edoshmis_receive_goods($1, $2)", [po, JSON.stringify([{ line_id: line, quantity: 100, batch_number: "SOON", expiry_date: sooner }])]);
    expect(await h.fails("store", "select edoshmis_receive_goods($1, $2)", [po, JSON.stringify([{ line_id: line, quantity: 1, batch_number: "X", expiry_date: later }])])).toMatch(/already (received|%)|More received than ordered|Only an approved/);

    // An expired batch counted into the pharmacy (opening balance) is never issued.
    await h.as("pharm", "select edoshmis_opening_stock($1, $2, 'OLD', (current_date - 1), 50, 1)", [pharmacy, item]);
    const req = (await h.as1<{ id: string }>("wardmgr", "select edoshmis_requisition($1, $2) as id", [h.fac, JSON.stringify({ from_store_id: main, to_store_id: pharmacy, lines: [{ item_id: item, quantity: 150 }] })])).id;
    await h.as("store", "select edoshmis_fulfil_requisition($1)", [req]);
    const moved = await h.as<{ batch_number: string; quantity: string }>("store", "select batch_number, quantity::text from edoshmis_stock_batches where store_id = $1 and quantity > 0 order by batch_number", [pharmacy]);
    // FEFO: all 100 of SOON went first, then 50 of LATE; OLD (expired) still sits there.
    expect(moved).toEqual([{ batch_number: "LATE", quantity: "50.00" }, { batch_number: "OLD", quantity: "50.00" }, { batch_number: "SOON", quantity: "100.00" }]);

    // Outpatient dispense of 120 takes SOON (100) then LATE (20), never OLD.
    const patient = await h.patient("Stock");
    const visit = (await h.as1<{ id: string }>("clerk", "select edoshmis_check_in($1, $2) as id", [h.fac, JSON.stringify({ patient_id: patient })])).id;
    const rx = (await h.as1<{ id: string }>("mo", "select edoshmis_prescribe_outpatient($1, $2) as id", [visit, JSON.stringify({ drug_id: drug, dose: 1, dose_unit: "g", route: "oral", frequency: "tds", quantity: 120 })])).id;
    await h.as("pharm", "select edoshmis_dispense_outpatient($1, '{}')", [rx]);
    const after = await h.as<{ batch_number: string; quantity: string }>("pharm", "select batch_number, quantity::text from edoshmis_stock_batches where store_id = $1 order by batch_number", [pharmacy]);
    expect(after).toEqual([{ batch_number: "LATE", quantity: "30.00" }, { batch_number: "OLD", quantity: "50.00" }, { batch_number: "SOON", quantity: "0.00" }]);
    expect((await h.as1<{ batch_number: string }>("pharm", "select batch_number from edoshmis_outpatient_prescriptions where id = $1", [rx])).batch_number).toBe("SOON, LATE");

    // Not enough unexpired stock stops the dispense (the expired 50 does not count).
    const rx2 = (await h.as1<{ id: string }>("mo", "select edoshmis_prescribe_outpatient($1, $2) as id", [visit, JSON.stringify({ drug_id: drug, dose: 1, dose_unit: "g", route: "oral", frequency: "tds", quantity: 60 })])).id;
    expect(await h.fails("pharm", "select edoshmis_dispense_outpatient($1, '{}')", [rx2])).toMatch(/Only 30\.00 in stock/);

    // Stock cannot be edited directly; the ledger is append-only.
    expect(await h.as("pharm", "update edoshmis_stock_batches set quantity = 999 where store_id = $1 returning id", [pharmacy])).toHaveLength(0);
    expect((await h.as1<{ q: string }>("pharm", "select sum(quantity)::text q from edoshmis_stock_batches where store_id = $1", [pharmacy])).q).toBe("80.00");
    await expect(h.db.query("delete from edoshmis_stock_movements")).rejects.toThrow(/append-only/);
  });

  it("will not let the person who raised a PO approve it", async () => {
    await h.hire("buyer2", "procurement_officer", "procurement_officer");
    await h.db.query("update edoshmis_roles set permissions = permissions || array['procurement.approve'] where organization_id = $1 and code = 'procurement_officer'", [h.org]);
    const sup = (await h.as1<{ id: string }>("buyer2", "select id from edoshmis_suppliers limit 1")).id;
    const store = (await h.as1<{ id: string }>("buyer2", "select id from edoshmis_stores where code = 'MAIN'")).id;
    const item = (await h.as1<{ id: string }>("buyer2", "select id from edoshmis_stock_items limit 1")).id;
    const po = (await h.as1<{ id: string }>("buyer2", "select edoshmis_create_po($1, $2) as id", [h.fac, JSON.stringify({ supplier_id: sup, store_id: store, lines: [{ item_id: item, quantity: 1, unit_cost: 1 }] })])).id;
    expect(await h.fails("buyer2", "select edoshmis_decide_po($1, true)", [po])).toMatch(/Someone other than/);
  });
});
