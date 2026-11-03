import { beforeAll, describe, expect, it } from "vitest";
import { hospital } from "./fixture";

/** Outpatients, emergency, laboratory and imaging — synthetic data, RLS on. */

let h: Awaited<ReturnType<typeof hospital>>;
beforeAll(async () => {
  h = await hospital();
});

describe("role defaults", () => {
  it("gives new standard roles to every organisation, and extra permissions to existing ones", async () => {
    const roles = await h.as<{ code: string; permissions: string[] }>("admin", "select code, permissions from edoshmis_roles where organization_id = $1", [h.org]);
    const by = Object.fromEntries(roles.map((r) => [r.code, r.permissions]));
    expect(by.triage_officer).toContain("opd.triage");
    expect(by.lab_technologist).toContain("lab.validate");
    expect(by.receptionist).toEqual(expect.arrayContaining(["patients.register", "opd.register"])); // base + added
    expect(by.medical_officer).toEqual(expect.arrayContaining(["clinical.notes", "opd.consult", "lab.order", "imaging.order"]));
    expect(by.cashier).not.toContain("patients.clinical");
  });
});

describe("outpatient visit", () => {
  let patient: string, visit: string;

  it("checks in with a queue number and an open bill; one open visit per patient", async () => {
    patient = await h.patient("Neema");
    visit = (await h.as1<{ id: string }>("clerk", "select edoshmis_check_in($1, $2) as id", [h.fac, JSON.stringify({ patient_id: patient, kind: "opd", chief_complaint: "Cough" })])).id;
    const e = await h.as1<{ queue_number: number; stage: string; encounter_number: string }>("clerk", "select queue_number, stage, encounter_number from edoshmis_encounters where id = $1", [visit]);
    expect(e).toMatchObject({ queue_number: 1, stage: "waiting_triage" });
    expect(e.encounter_number).toMatch(/^OP\d{4}-000001$/);
    expect(await h.fails("clerk", "select edoshmis_check_in($1, $2)", [h.fac, JSON.stringify({ patient_id: patient })])).toMatch(/already has an open visit/);
    expect(await h.as("cashier", "select * from edoshmis_billing_accounts where encounter_id = $1", [visit])).toHaveLength(1);
  });

  it("triages (moving the queue), then consults; the front desk sees neither", async () => {
    await h.as("triage", "insert into edoshmis_triage_records (facility_id, encounter_id, patient_id, recorded_by, triage_category, chief_complaint, temperature, pulse) values ($1, $2, $3, $4, 'urgent', 'Cough, fever', 38.4, 104)",
      [h.fac, visit, patient, h.staff.triage]);
    expect((await h.as1<{ stage: string; triage_category: string }>("clerk", "select stage, triage_category from edoshmis_encounters where id = $1", [visit]))).toEqual({ stage: "waiting_doctor", triage_category: "urgent" });
    await h.as("mo", "insert into edoshmis_consultations (facility_id, encounter_id, patient_id, author_id, author_designation, examination, assessment, plan, status) values ($1, $2, $3, $4, '', 'Crackles L base', 'LRTI', 'Amoxicillin, CXR', 'signed')",
      [h.fac, visit, patient, h.staff.mo]);
    expect(await h.as("clerk", "select * from edoshmis_consultations where encounter_id = $1", [visit])).toHaveLength(0);
    expect(await h.as("clerk", "select * from edoshmis_triage_records where encounter_id = $1", [visit])).toHaveLength(0);
    const c = (await h.as1<{ id: string }>("mo", "select id from edoshmis_consultations where encounter_id = $1", [visit])).id;
    expect(await h.fails("mo", "update edoshmis_consultations set plan = 'x' where id = $1", [c])).toMatch(/signed consultation/);
    await h.as("mo", "insert into edoshmis_consultation_addenda (facility_id, consultation_id, author_id, author_designation, body) values ($1, $2, $3, '', 'Also: smoker')", [h.fac, c, h.staff.mo]);
    expect((await h.as1<{ stage: string }>("mo", "select stage from edoshmis_encounters where id = $1", [visit])).stage).toBe("with_doctor");
  });

  it("prescribes for the pharmacy to dispense, charging once", async () => {
    const tariff = (await h.as1<{ id: string }>("admin", "insert into edoshmis_tariffs (facility_id, code, name, category, price) values ($1, 'AMOX500', 'Amoxicillin 500 mg cap', 'medication', 10) returning id", [h.fac])).id;
    const drug = (await h.as1<{ id: string }>("pharm", "insert into edoshmis_drugs (organization_id, generic_name, form, strength, tariff_id) values ($1, 'Amoxicillin', 'capsule', '500 mg', $2) returning id", [h.org, tariff])).id;
    const rx = (await h.as1<{ id: string }>("mo", "select edoshmis_prescribe_outpatient($1, $2) as id", [visit, JSON.stringify({ drug_id: drug, dose: 500, dose_unit: "mg", route: "oral", frequency: "tds", duration_days: 5, quantity: 15 })])).id;
    expect(await h.fails("mo", "select edoshmis_dispense_outpatient($1, '{}')", [rx])).toMatch(/permission/);
    await h.as("pharm", "select edoshmis_dispense_outpatient($1, '{}')", [rx]);
    expect(await h.fails("pharm", "select edoshmis_dispense_outpatient($1, '{}')", [rx])).toMatch(/already dispensed/);
    const bal = await h.as1<{ charges: string }>("cashier", "select b.charges from edoshmis_account_balances b join edoshmis_billing_accounts a on a.id = b.account_id where a.encounter_id = $1", [visit]);
    expect(Number(bal.charges)).toBe(150);
  });

  it("closes as admitted only through an admission request, which then closes the visit on admit", async () => {
    expect(await h.fails("mo", "select edoshmis_close_visit($1, 'admitted')", [visit])).toMatch(/Request the admission first/);
    const req = (await h.as1<{ id: string }>("mo", "select edoshmis_request_admission($1, $2) as id", [h.fac, JSON.stringify({ patient_id: patient, source: "opd", source_encounter_id: visit, provisional_diagnosis: "Pneumonia", indication: "Hypoxic" })])).id;
    await h.as("mo", "select edoshmis_close_visit($1, 'admitted')", [visit]);
    await h.as("consultant", "select edoshmis_decide_admission_request($1, true)", [req]);
    await h.as("wardmgr", "select edoshmis_admit($1, $2)", [req, h.bed]);
    expect((await h.as1<{ status: string }>("clerk", "select status from edoshmis_encounters where id = $1", [visit])).status).toBe("closed");
  });
});

describe("laboratory", () => {
  let patient: string, visit: string, test: string, hb: string, order: string;

  it("orders from an open visit and charges each test once", async () => {
    patient = await h.patient("Imani");
    visit = (await h.as1<{ id: string }>("clerk", "select edoshmis_check_in($1, $2) as id", [h.fac, JSON.stringify({ patient_id: patient })])).id;
    const tariff = (await h.as1<{ id: string }>("admin", "insert into edoshmis_tariffs (facility_id, code, name, category, price) values ($1, 'FBC', 'Full blood count', 'laboratory', 800) returning id", [h.fac])).id;
    test = (await h.as1<{ id: string }>("labtech", "insert into edoshmis_lab_tests (facility_id, code, name, discipline, specimen_type, tariff_id) values ($1, 'FBC', 'Full blood count', 'haematology', 'EDTA blood', $2) returning id", [h.fac, tariff])).id;
    // Test-only range and critical limit, entered as the lab would.
    hb = (await h.as1<{ id: string }>("labtech", "insert into edoshmis_lab_parameters (test_id, name, unit, ref_low, ref_high, critical_low) values ($1, 'Haemoglobin', 'g/dL', 12, 16, 7) returning id", [test])).id;
    expect(await h.fails("clerk", "select edoshmis_order_lab($1, $2)", [h.fac, JSON.stringify({ encounter_id: visit, test_ids: [test] })])).toMatch(/permission/);
    order = (await h.as1<{ id: string }>("mo", "select edoshmis_order_lab($1, $2) as id", [h.fac, JSON.stringify({ encounter_id: visit, test_ids: [test], priority: "urgent" })])).id;
    const bal = await h.as1<{ charges: string }>("cashier", "select b.charges from edoshmis_account_balances b join edoshmis_billing_accounts a on a.id = b.account_id where a.encounter_id = $1", [visit]);
    expect(Number(bal.charges)).toBe(800);
  });

  it("runs collect → receive → result, flags against the lab's own range, and holds validation for an uncommunicated critical", async () => {
    expect(await h.fails("labtech", "select edoshmis_enter_lab_results((select id from edoshmis_lab_order_items where order_id = $1), $2)", [order, JSON.stringify([{ parameter_id: hb, value: "6.1" }])])).toMatch(/Receive the specimen/);
    const acc = (await h.as1<{ a: string }>("nurse", "select edoshmis_lab_step($1, 'collect') as a", [order])).a;
    expect(acc).toMatch(/^MFH\d{6}0001$/);
    await h.as("labtech", "select edoshmis_lab_step($1, 'receive')", [order]);
    const item = (await h.as1<{ id: string }>("labtech", "select id from edoshmis_lab_order_items where order_id = $1", [order])).id;
    await h.as("labtech", "select edoshmis_enter_lab_results($1, $2)", [item, JSON.stringify([{ parameter_id: hb, value: "6.1" }])]);
    const r = await h.as1<{ id: string; flag: string; ref_display: string }>("labtech", "select id, flag, ref_display from edoshmis_lab_results where item_id = $1 and is_current", [item]);
    expect(r.flag).toBe("critical_low");
    expect(r.ref_display).toContain("12");
    expect(await h.fails("labtech", "select edoshmis_validate_lab($1)", [order])).toMatch(/critical value/);
    expect(await h.fails("labtech", "select edoshmis_record_critical_call($1, 'Dr Otieno', false)", [r.id])).toMatch(/read back/);
    await h.as("labtech", "select edoshmis_record_critical_call($1, 'Dr Otieno', true)", [r.id]);
    await h.as("labtech", "select edoshmis_validate_lab($1)", [order]);
    // The clinician sees it; the cashier does not.
    expect(await h.as("mo", "select * from edoshmis_lab_results where order_id = $1", [order])).toHaveLength(1);
    expect(await h.as("cashier", "select * from edoshmis_lab_results where order_id = $1", [order])).toHaveLength(0);
  });

  it("amends a validated result only with a reason, keeping the old version", async () => {
    const item = (await h.as1<{ id: string }>("labtech", "select id from edoshmis_lab_order_items where order_id = $1", [order])).id;
    expect(await h.fails("labtech", "select edoshmis_enter_lab_results($1, $2)", [item, JSON.stringify([{ parameter_id: hb, value: "6.4" }])])).toMatch(/reason to amend/);
    await h.as("labtech", "select edoshmis_enter_lab_results($1, $2, 'Transcription error')", [item, JSON.stringify([{ parameter_id: hb, value: "6.4" }])]);
    const all = await h.as<{ value_text: string; is_current: boolean; version: number }>("labtech", "select value_text, is_current, version from edoshmis_lab_results where item_id = $1 order by version", [item]);
    expect(all).toEqual([{ value_text: "6.1", is_current: false, version: 1 }, { value_text: "6.4", is_current: true, version: 2 }]);
    await expect(h.db.query("delete from edoshmis_lab_results")).rejects.toThrow(/never deleted/);
  });
});

describe("imaging", () => {
  it("needs pregnancy status for ionising exams on women, then runs perform → report → validate", async () => {
    const patient = await h.patient("Wanjiku");
    const visit = (await h.as1<{ id: string }>("clerk", "select edoshmis_check_in($1, $2) as id", [h.fac, JSON.stringify({ patient_id: patient })])).id;
    const exam = (await h.as1<{ id: string }>("radiologist", "insert into edoshmis_imaging_exams (facility_id, code, name, modality, body_part) values ($1, 'CXR-PA', 'Chest X-ray PA', 'xray', 'Chest') returning id", [h.fac])).id;
    const ord = (o: object) => JSON.stringify({ encounter_id: visit, exam_id: exam, clinical_indication: "Cough 3 weeks", ...o });
    expect(await h.fails("mo", "select edoshmis_order_imaging($1, $2)", [h.fac, ord({})])).toMatch(/pregnancy status/);
    const id = (await h.as1<{ id: string }>("mo", "select edoshmis_order_imaging($1, $2) as id", [h.fac, ord({ pregnancy_status: "not_pregnant" })])).id;
    expect(await h.fails("radiologist", "select edoshmis_imaging_step($1, 'report', $2)", [id, JSON.stringify({ findings: "x", impression: "y" })])).toMatch(/performed before/);
    await h.as("radiographer", "select edoshmis_imaging_step($1, 'perform', '{}')", [id]);
    expect(await h.fails("radiographer", "select edoshmis_imaging_step($1, 'report', $2)", [id, JSON.stringify({ findings: "x", impression: "y" })])).toMatch(/permission/);
    await h.as("radiologist", "select edoshmis_imaging_step($1, 'report', $2)", [id, JSON.stringify({ findings: "Clear lung fields", impression: "Normal chest" })]);
    await h.as("radiologist", "select edoshmis_imaging_step($1, 'validate', '{}')", [id]);
    expect((await h.as1<{ status: string }>("mo", "select status from edoshmis_imaging_orders where id = $1", [id])).status).toBe("validated");
    expect(await h.as("cashier", "select * from edoshmis_imaging_orders where id = $1", [id])).toHaveLength(0);
  });
});
