import { beforeAll, describe, expect, it } from "vitest";
import { hospital } from "./fixture";

let h: Awaited<ReturnType<typeof hospital>>;
beforeAll(async () => {
  h = await hospital();
  await h.hire("surgeon", "consultant", "consultant");
  await h.hire("anaes", "anaesthetist", "anaesthetist");
  await h.hire("scrub", "theatre_staff", "theatre_staff");
});

describe("theatre", () => {
  it("books without overlaps and enforces consent and the three checklist phases in order", async () => {
    const tariff = (await h.as1<{ id: string }>("admin", "insert into edoshmis_tariffs (facility_id, code, name, category, price) values ($1, 'OT-MAJ', 'Major theatre', 'theatre', 15000) returning id", [h.fac])).id;
    const store = (await h.as1<{ id: string }>("pharm", "insert into edoshmis_stores (facility_id, name, code, kind) values ($1, 'Theatre store', 'OTS', 'theatre') returning id", [h.fac])).id;
    await h.db.query("update edoshmis_roles set permissions = permissions || array['theatre.configure'] where organization_id = $1 and code = 'hospital_admin'", [h.org]);
    const ot = (await h.as1<{ id: string }>("admin", "insert into edoshmis_theatres (facility_id, name, code, store_id, tariff_id) values ($1, 'Theatre 1', 'OT1', $2, $3) returning id", [h.fac, store, tariff])).id;
    const item = (await h.as1<{ id: string }>("pharm", "insert into edoshmis_stock_items (organization_id, code, name, category, unit) values ($1, 'SUT-VIC', 'Vicryl 2/0', 'surgical', 'pack') returning id", [h.org])).id;
    await h.as("pharm", "select edoshmis_opening_stock($1, $2, 'V1', current_date + 200, 10, 300)", [store, item]);

    // An inpatient to operate on.
    const p = await h.patient("Surgical", "male");
    const req = (await h.as1<{ id: string }>("mo", "select edoshmis_request_admission($1, $2) as id", [h.fac, JSON.stringify({ patient_id: p, source: "direct", provisional_diagnosis: "Inguinal hernia", indication: "Elective repair" })])).id;
    await h.as("consultant", "select edoshmis_decide_admission_request($1, true)", [req]);
    const adm = (await h.as1<{ id: string }>("wardmgr", "select edoshmis_admit($1, $2) as id", [req, h.bed])).id;

    const su = (await h.as1<{ id: string }>("surgeon", "select edoshmis_request_surgery($1, $2) as id", [h.fac, JSON.stringify({ admission_id: adm, procedure_name: "Open inguinal hernia repair", laterality: "right" })])).id;
    const start = new Date(Date.now() + 3600_000).toISOString();
    await h.as("surgeon", "select edoshmis_schedule_surgery($1, $2)", [su, JSON.stringify({ theatre_id: ot, scheduled_start: start, duration_minutes: 90, anaesthetist_id: h.staff.anaes })]);

    // A second case overlapping the same theatre is refused.
    const su2 = (await h.as1<{ id: string }>("surgeon", "select edoshmis_request_surgery($1, $2) as id", [h.fac, JSON.stringify({ admission_id: adm, procedure_name: "Excision of lipoma" })])).id;
    expect(await h.fails("surgeon", "select edoshmis_schedule_surgery($1, $2)", [su2, JSON.stringify({ theatre_id: ot, scheduled_start: new Date(Date.now() + 5400_000).toISOString(), duration_minutes: 30 })])).toMatch(/already booked/);

    const step = (who: string, s: string, d: object = {}) => h.as(who, "select edoshmis_surgery_step($1, $2, $3)", [su, s, JSON.stringify(d)]);
    const stepFails = (who: string, s: string, d: object = {}) => h.fails(who, "select edoshmis_surgery_step($1, $2, $3)", [su, s, JSON.stringify(d)]);

    expect(await stepFails("scrub", "sign_in", { answers: { identity: true } })).toMatch(/Consent/);
    await step("scrub", "consent", { consent_by: "Patient (signed form)" });
    await step("anaes", "pre_op", { asa_class: "II", anaesthesia_type: "spinal", fasting_confirmed: true });
    expect(await stepFails("scrub", "sign_in", { answers: { identity: true, site_marked: false } })).toMatch(/must be confirmed/);
    expect(await stepFails("scrub", "note", { procedure_details: "x" })).toMatch(/time out/);
    await step("scrub", "sign_in", { answers: { identity: true, site_marked: true, consent: true } });
    await step("surgeon", "time_out", { answers: { team_introduced: true, antibiotic_given: true } });
    await h.as("scrub", "select edoshmis_surgery_consumable($1, $2, 2)", [su, item]);
    await h.as("scrub", "select edoshmis_surgery_implant($1, $2)", [su, JSON.stringify({ description: "Polypropylene mesh 6×11 cm", lot_number: "M123" })]);
    expect(await stepFails("scrub", "sign_out", { answers: { counts_correct: true } })).toMatch(/operation note/);
    await step("surgeon", "note", { findings: "Indirect hernia", procedure_details: "Lichtenstein mesh repair", blood_loss_ml: 50 });
    await step("scrub", "sign_out", { answers: { counts_correct: true, specimens_labelled: true } });
    await step("scrub", "recovery_out", { destination: "Ward A" });

    const r = await h.as1<{ status: string; sign_in_by: string; time_out_by: string }>("surgeon", "select status, sign_in_by, time_out_by from edoshmis_surgeries where id = $1", [su]);
    expect(r).toEqual({ status: "completed", sign_in_by: h.staff.scrub, time_out_by: h.staff.surgeon });
    expect((await h.as1<{ q: string }>("pharm", "select sum(quantity)::text q from edoshmis_stock_batches where store_id = $1", [store])).q).toBe("8.00");
    const charges = await h.as<{ n: number }>("cashier", "select count(*)::int n from edoshmis_charges c join edoshmis_billing_accounts a on a.id = c.account_id where a.admission_id = $1 and c.source_type = 'surgery'", [adm]);
    expect(charges[0].n).toBe(1);
    // Front desk and cashier do not see the surgical record.
    expect(await h.as("clerk", "select * from edoshmis_surgeries where id = $1", [su])).toHaveLength(0);
  });
});
