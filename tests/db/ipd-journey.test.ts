import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { addUser, asUser, freshDb, one } from "./harness";

/**
 * One synthetic patient's whole inpatient journey, run against the real
 * migrations with RLS on: register → request → approve → admit → transfer
 * → observations → notes → medication → billing → discharge. Every name and
 * number here is made up.
 */

let db: PGlite;
const u: Record<string, string> = {};
const staff: Record<string, string> = {};
let org: string, fac: string, wardA: string, wardB: string, bedA1: string, bedA2: string, bedB1: string, tariffBed: string;

async function q<T = Record<string, unknown>>(who: string | null, sql: string, params: unknown[] = []) {
  return asUser(db, who ? u[who] : null, async () => (await db.query<T>(sql, params)).rows);
}
async function q1<T = Record<string, unknown>>(who: string | null, sql: string, params: unknown[] = []) {
  return (await q<T>(who, sql, params))[0];
}
async function fails(who: string | null, sql: string, params: unknown[] = []) {
  try {
    await q(who, sql, params);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error(`expected failure: ${sql}`);
}

async function hire(key: string, name: string, designation: string, roleCode: string, wards: string[] = []) {
  u[key] = await addUser(db, `${key}@test.invalid`);
  const s = await one<{ id: string }>(db,
    "insert into edoshmis_staff (organization_id, user_id, full_name, designation) values ($1, $2, $3, $4) returning id",
    [org, u[key], name, designation]);
  staff[key] = s.id;
  await db.query("insert into edoshmis_staff_roles (staff_id, role_id) select $1, id from edoshmis_roles where organization_id = $2 and code = $3",
    [s.id, org, roleCode]);
  for (const w of wards) await db.query("insert into edoshmis_staff_wards (staff_id, ward_id) values ($1, $2)", [s.id, w]);
}

beforeAll(async () => {
  db = await freshDb();
  u.platform = await addUser(db, "platform@test.invalid");
  await db.query("insert into edoshmis_platform_admins (user_id) values ($1)", [u.platform]);
  u.admin = await addUser(db, "admin@test.invalid");

  org = (await q1<{ id: string }>("platform",
    "select edoshmis_create_organization('Mfano General Hospital', 'Mfano Main', 'MGH', $1, 'Asha Admin', 'level_4', 'Nakuru') as id", [u.admin])).id;
  fac = (await one<{ id: string }>(db, "select id from edoshmis_facilities where organization_id = $1", [org])).id;

  // The administrator sets up wards, beds and a bed tariff — through RLS.
  tariffBed = (await q1<{ id: string }>("admin",
    "insert into edoshmis_tariffs (facility_id, code, name, category, unit, price) values ($1, 'BED-GEN', 'General ward bed-day', 'bed', 'day', 1500) returning id", [fac])).id;
  wardA = (await q1<{ id: string }>("admin",
    "insert into edoshmis_wards (facility_id, name, code, ward_type, daily_tariff_id) values ($1, 'Medical Ward A', 'MWA', 'general_medical', $2) returning id", [fac, tariffBed])).id;
  wardB = (await q1<{ id: string }>("admin",
    "insert into edoshmis_wards (facility_id, name, code, ward_type, sex_restriction, daily_tariff_id) values ($1, 'Female Surgical', 'FSW', 'surgical', 'female', $2) returning id", [fac, tariffBed])).id;
  bedA1 = (await q1<{ id: string }>("admin", "insert into edoshmis_beds (facility_id, ward_id, bed_number) values ($1, $2, 'A1') returning id", [fac, wardA])).id;
  bedA2 = (await q1<{ id: string }>("admin", "insert into edoshmis_beds (facility_id, ward_id, bed_number) values ($1, $2, 'A2') returning id", [fac, wardA])).id;
  bedB1 = (await q1<{ id: string }>("admin", "insert into edoshmis_beds (facility_id, ward_id, bed_number) values ($1, $2, 'B1') returning id", [fac, wardB])).id;

  await hire("clerk", "Brian Clerk", "receptionist", "receptionist");
  await hire("consultant", "Dr Wanjiru Consultant", "consultant", "consultant");
  await hire("mo", "Dr Otieno MO", "medical_officer", "medical_officer");
  await hire("nurseA", "Nurse Achieng", "nurse", "nurse", [wardA]);
  await hire("nurseB", "Nurse Kamau", "nurse", "nurse", [wardB]);
  await hire("wardmgr", "Ward Manager Njeri", "ward_manager", "ward_manager", [wardA, wardB]);
  await hire("pharm", "Pharm Mutua", "pharmacist", "pharmacist");
  await hire("cashier", "Cashier Wafula", "cashier", "cashier");
});

describe("inpatient journey", () => {
  let patient: string, request: string, admission: string;

  it("registers a patient and catches a duplicate", async () => {
    const p = {
      first_name: "Zawadi", last_name: "Testpatient", sex: "female", date_of_birth: "1990-04-12", phone: "+254712000001",
      consent_data_processing: true, identifiers: [{ id_type: "national_id", value: "12345678" }],
      contacts: [{ kind: "next_of_kin", full_name: "Juma Testpatient", relationship: "Brother", phone: "+254712000002" }],
    };
    patient = (await q1<{ id: string }>("clerk", "select edoshmis_register_patient($1, $2) as id", [fac, JSON.stringify(p)])).id;
    const row = await q1<{ hospital_number: string }>("clerk", "select hospital_number from edoshmis_patients where id = $1", [patient]);
    expect(row.hospital_number).toBe("MGH-000001");

    const again = { ...p, first_name: "Zawadi", identifiers: [{ id_type: "national_id", value: "1234 5678" }] };
    expect(await fails("clerk", "select edoshmis_register_patient($1, $2)", [fac, JSON.stringify(again)])).toMatch(/Possible duplicate/);
    // Without consent nothing is registered.
    expect(await fails("clerk", "select edoshmis_register_patient($1, $2)", [fac, JSON.stringify({ ...p, first_name: "Other", identifiers: [], phone: null, consent_data_processing: false })]))
      .toMatch(/consent/);
  });

  it("keeps clinical history from the front desk", async () => {
    await q("consultant", "insert into edoshmis_patient_allergies (organization_id, patient_id, substance, severity, reaction) values ($1, $2, 'Penicillin', 'severe', 'Anaphylaxis')", [org, patient]);
    expect(await q("clerk", "select * from edoshmis_patient_allergies where patient_id = $1", [patient])).toHaveLength(0);
    expect(await q("consultant", "select * from edoshmis_patient_allergies where patient_id = $1", [patient])).toHaveLength(1);
    expect(await fails("clerk", "insert into edoshmis_patient_allergies (organization_id, patient_id, substance) values ($1, $2, 'Sulfa')", [org, patient])).toMatch(/row-level security/);
  });

  it("requests, approves and admits — and never double-books a bed", async () => {
    request = (await q1<{ id: string }>("mo", "select edoshmis_request_admission($1, $2) as id", [fac, JSON.stringify({
      patient_id: patient, source: "opd", priority: "urgent", provisional_diagnosis: "Community-acquired pneumonia", provisional_icd10: "J18.9",
      indication: "Hypoxic on room air, needs IV antibiotics", responsible_consultant_id: staff.consultant,
    })])).id;
    // A nurse cannot approve; admitting an unapproved request is refused.
    expect(await fails("nurseA", "select edoshmis_decide_admission_request($1, true)", [request])).toMatch(/permission/);
    expect(await fails("wardmgr", "select edoshmis_admit($1, $2)", [request, bedA1])).toMatch(/approved/);
    await q("consultant", "select edoshmis_decide_admission_request($1, true, 'Agree')", [request]);

    // A female-only ward refuses nobody here; a male patient would be refused — checked below with a second patient.
    admission = (await q1<{ id: string }>("wardmgr", "select edoshmis_admit($1, $2, $3) as id", [request, bedA1, JSON.stringify({ consent_obtained: true, consent_by: "Patient" })])).id;
    const ad = await q1<{ admission_number: string; status: string }>("wardmgr", "select admission_number, status from edoshmis_admissions where id = $1", [admission]);
    expect(ad.admission_number).toMatch(/^MGH\/ADM\/\d{4}\/00001$/);
    expect((await q1<{ status: string }>("wardmgr", "select status from edoshmis_beds where id = $1", [bedA1])).status).toBe("occupied");

    // Second patient, male: cannot take the occupied bed, nor the female ward.
    const p2 = (await q1<{ id: string }>("clerk", "select edoshmis_register_patient($1, $2) as id", [fac, JSON.stringify({
      first_name: "Baraka", last_name: "Secondtest", sex: "male", date_of_birth: "1985-01-01", consent_data_processing: true })])).id;
    const r2 = (await q1<{ id: string }>("mo", "select edoshmis_request_admission($1, $2) as id", [fac, JSON.stringify({
      patient_id: p2, source: "emergency", provisional_diagnosis: "Cellulitis", indication: "IV antibiotics" })])).id;
    await q("consultant", "select edoshmis_decide_admission_request($1, true)", [r2]);
    expect(await fails("wardmgr", "select edoshmis_admit($1, $2)", [r2, bedA1])).toMatch(/occupied/);
    expect(await fails("wardmgr", "select edoshmis_admit($1, $2)", [r2, bedB1])).toMatch(/female/);
    // No one can write an allocation directly, even an admin.
    expect(await fails("admin", "insert into edoshmis_bed_allocations (facility_id, admission_id, patient_id, ward_id, bed_id) values ($1, $2, $3, $4, $5)",
      [fac, admission, patient, wardA, bedA2])).toMatch(/row-level security/);
    // Nor flip a bed's status by hand.
    expect(await fails("admin", "update edoshmis_beds set status = 'available' where id = $1", [bedA1])).toMatch(/bed board/);
    // And the database itself refuses a second open allocation on one bed,
    // even from a superuser who skips every function and policy.
    await expect(db.query("insert into edoshmis_bed_allocations (facility_id, admission_id, patient_id, ward_id, bed_id) select facility_id, id, patient_id, current_ward_id, $1 from edoshmis_admissions where id = $2",
      [bedA1, admission])).rejects.toThrow(/duplicate key/);
  });

  it("limits the record to the right people", async () => {
    await q("mo", "insert into edoshmis_clinical_notes (facility_id, admission_id, note_type, findings, assessment, plan, status, author_id, author_designation, patient_id) values ($1, $2, 'admission', 'Crackles right base', 'CAP', 'IV ceftriaxone', 'signed', $3, '', $4)",
      [fac, admission, staff.mo, patient]);
    expect(await q("nurseA", "select * from edoshmis_clinical_notes where admission_id = $1", [admission])).toHaveLength(1); // assigned to the ward
    expect(await q("nurseB", "select * from edoshmis_clinical_notes where admission_id = $1", [admission])).toHaveLength(0); // other ward
    expect(await q("cashier", "select * from edoshmis_clinical_notes where admission_id = $1", [admission])).toHaveLength(0);
    expect(await q("admin", "select * from edoshmis_clinical_notes where admission_id = $1", [admission])).toHaveLength(0);
    // The author recorded is the signed-in doctor, whatever the client sent.
    const n = await q1<{ author_id: string; author_designation: string; signed_at: string }>("mo", "select author_id, author_designation, signed_at from edoshmis_clinical_notes where admission_id = $1", [admission]);
    expect(n.author_id).toBe(staff.mo);
    expect(n.author_designation).toBe("medical_officer");
    expect(n.signed_at).toBeTruthy();
  });

  it("freezes signed notes; corrections are addenda", async () => {
    const note = (await q1<{ id: string }>("mo", "select id from edoshmis_clinical_notes where admission_id = $1", [admission])).id;
    expect(await fails("mo", "update edoshmis_clinical_notes set plan = 'changed' where id = $1", [note])).toMatch(/signed note/);
    await q("mo", "select edoshmis_add_addendum('clinical', $1, 'Correction: ceftriaxone 1 g, not 2 g')", [note]);
    expect(await q("mo", "select * from edoshmis_note_addenda where clinical_note_id = $1", [note])).toHaveLength(1);
  });

  it("transfers beds, keeping the history", async () => {
    expect(await fails("wardmgr", "select edoshmis_transfer_bed($1, $2, '')", [admission, bedA2])).toMatch(/reason/);
    await q("wardmgr", "select edoshmis_transfer_bed($1, $2, 'Closer to nursing station')", [admission, bedA2]);
    const allocs = await q<{ bed_id: string; ended_at: string | null }>("wardmgr", "select bed_id, ended_at from edoshmis_bed_allocations where admission_id = $1 order by started_at", [admission]);
    expect(allocs.map((a) => [a.bed_id, a.ended_at === null])).toEqual([[bedA1, false], [bedA2, true]]);
    expect((await q1<{ status: string }>("wardmgr", "select status from edoshmis_beds where id = $1", [bedA1])).status).toBe("cleaning");
    await q("nurseA", "select edoshmis_set_bed_status($1, 'available', 'Cleaned')", [bedA1]);
    expect(await fails("nurseA", "select edoshmis_set_bed_status($1, 'available')", [bedA2])).toMatch(/occupied/);
  });

  it("scores observations only against configured bands", async () => {
    await q("nurseA", "insert into edoshmis_observations (facility_id, admission_id, recorded_by, patient_id, respiratory_rate, spo2, pulse) values ($1, $2, $3, $4, 26, 89, 118)",
      [fac, admission, staff.nurseA, patient]);
    let o = await q1<{ ews_score: number | null }>("nurseA", "select ews_score from edoshmis_observations where admission_id = $1 order by created_at desc limit 1", [admission]);
    expect(o.ews_score).toBeNull(); // nothing configured → no score, no invented threshold

    // The facility configures (test-only) bands and one escalation rule.
    for (const [param, min, max, score] of [["respiratory_rate", 25, null, 3], ["spo2", null, 91, 3], ["pulse", 111, 130, 2]] as const) {
      await q("admin", "insert into edoshmis_observation_bands (facility_id, parameter, min_value, max_value, score, approved_by, approved_at) values ($1, $2, $3, $4, $5, 'Test only', current_date)",
        [fac, param, min, max, score]);
    }
    await q("admin", "insert into edoshmis_escalation_rules (facility_id, min_total, level, response, approved_by, approved_at) values ($1, 7, 'high', 'Call the doctor now', 'Test only', current_date)", [fac]);
    await q("nurseA", "insert into edoshmis_observations (facility_id, admission_id, recorded_by, patient_id, respiratory_rate, spo2, pulse, client_id) values ($1, $2, $3, $4, 26, 89, 118, gen_random_uuid())",
      [fac, admission, staff.nurseA, patient]);
    o = await q1<{ ews_score: number | null; ews_level: string }>("nurseA", "select ews_score, ews_level from edoshmis_observations where admission_id = $1 and ews_score is not null", [admission]);
    expect(o).toMatchObject({ ews_score: 8, ews_level: "high" });
    const esc = await q1<{ id: string; status: string }>("nurseA", "select id, status from edoshmis_escalations where admission_id = $1", [admission]);
    expect(esc.status).toBe("open");
    await q("nurseA", "select edoshmis_update_escalation($1, 'resolve', 'Dr Otieno reviewed, O2 started')", [esc.id]);
    expect(await fails("nurseA", "update edoshmis_observations set pulse = 80 where admission_id = $1", [admission])).toMatch(/never edited/);
  });

  it("separates prescribing, verifying and giving; checks allergies", async () => {
    const pen = (await q1<{ id: string }>("pharm", "insert into edoshmis_drugs (organization_id, generic_name, drug_class, form, strength) values ($1, 'Amoxicillin', 'Penicillin', 'capsule', '500 mg') returning id", [org])).id;
    const mor = (await q1<{ id: string }>("pharm", "insert into edoshmis_drugs (organization_id, generic_name, form, strength, is_controlled) values ($1, 'Morphine', 'injection', '10 mg/ml', true) returning id", [org])).id;
    const order = (dr: string, extra: object = {}) => JSON.stringify({ drug_id: dr, dose: 500, dose_unit: "mg", route: "oral", frequency: "tds", schedule_times: ["06:00", "14:00", "22:00"], ...extra });

    expect(await fails("mo", "select edoshmis_prescribe($1, $2)", [admission, order(pen)])).toMatch(/Allergy warning: Penicillin/);
    expect(await fails("nurseA", "select edoshmis_prescribe($1, $2)", [admission, order(mor)])).toMatch(/permission/);
    const m = (await q1<{ id: string }>("mo", "select edoshmis_prescribe($1, $2) as id", [admission, JSON.stringify({ drug_id: mor, dose: 5, dose_unit: "mg", route: "iv", frequency: "prn", prn_indication: "Severe pain", prn_max_doses_per_day: 4 })])).id;

    expect(await fails("nurseA", "select edoshmis_record_administration(null, $1, 'administered')", [m])).toMatch(/pharmacy-verified/);
    await q("pharm", "select edoshmis_verify_order($1, true)", [m]);
    expect(await fails("nurseA", "select edoshmis_record_administration(null, $1, 'administered')", [m])).toMatch(/witness/);
    await q("nurseA", "select edoshmis_record_administration(null, $1, 'administered', $2)", [m, JSON.stringify({ witness_id: staff.wardmgr })]);
    expect(await fails("nurseA", "select edoshmis_record_administration(null, $1, 'refused')", [m])).toMatch(/reason/);

    // A scheduled order lays out its doses, idempotently.
    const tds = (await q1<{ id: string }>("mo", "select edoshmis_prescribe($1, $2) as id", [admission, JSON.stringify({ drug_name: "Paracetamol 1 g", dose: 1, dose_unit: "g", route: "oral", frequency: "tds", schedule_times: ["06:00", "14:00", "22:00"], start_at: new Date(Date.now() - 86_400_000 * 2).toISOString() })])).id;
    await q("pharm", "select edoshmis_verify_order($1, true)", [tds]);
    const n1 = (await q1<{ n: number }>("nurseA", "select edoshmis_generate_mar($1, 24) as n", [admission])).n;
    const n2 = (await q1<{ n: number }>("nurseA", "select edoshmis_generate_mar($1, 24) as n", [admission])).n;
    expect(n1).toBeGreaterThan(3);
    expect(n2).toBe(0);
    const slot = (await q1<{ id: string }>("nurseA", "select id from edoshmis_medication_administrations where order_id = $1 and scheduled_for < now() order by scheduled_for limit 1", [tds])).id;
    await q("nurseA", "select edoshmis_record_administration($1, null, 'missed', $2)", [slot, JSON.stringify({ reason: "Patient in X-ray" })]);
    expect(await fails("nurseA", "select edoshmis_record_administration($1, null, 'administered')", [slot])).toMatch(/already recorded/);
    // Cashier sees no orders.
    expect(await q("cashier", "select * from edoshmis_medication_orders where admission_id = $1", [admission])).toHaveLength(0);
  });

  it("charges bed-days once, and an M-Pesa code once", async () => {
    // Backdate the admission two days (test only) to give it bed-days.
    await db.query("update edoshmis_admissions set admitted_at = now() - interval '2 days' where id = $1", [admission]);
    await db.query("update edoshmis_bed_allocations set started_at = now() - interval '2 days' where admission_id = $1 and ended_at is not null", [admission]);
    await db.query("update edoshmis_bed_allocations set started_at = now() - interval '1 day', ended_at = null where admission_id = $1 and ended_at is null", [admission]);
    const a = await q<{ n: number }>("cashier", "select edoshmis_post_bed_charges($1) as n", [admission]);
    const b = await q<{ n: number }>("cashier", "select edoshmis_post_bed_charges($1) as n", [admission]);
    expect(a[0].n).toBe(3); // day before yesterday, yesterday, today
    expect(b[0].n).toBe(0);
    const bal = await q1<{ balance: string; account_id: string }>("cashier", "select account_id, balance from edoshmis_account_balances where admission_id = $1", [admission]);
    expect(Number(bal.balance)).toBe(4500);
    await q("cashier", "select edoshmis_receive_payment($1, $2)", [bal.account_id, JSON.stringify({ kind: "deposit", method: "mpesa", amount: 2000, reference: "SGH7XK2LMN" })]);
    expect(await fails("cashier", "select edoshmis_receive_payment($1, $2)", [bal.account_id, JSON.stringify({ method: "mpesa", amount: 100, reference: "sgh7xk2lmn" })])).toMatch(/already been recorded/);
    // A cashier's direct edit touches nothing (no policy); even a superuser's is refused.
    expect(await q("cashier", "update edoshmis_charges set unit_price = 0 where account_id = $1 returning id", [bal.account_id])).toHaveLength(0);
    await expect(db.query("update edoshmis_charges set unit_price = 0 where account_id = $1", [bal.account_id])).rejects.toThrow(/append-only/);
  });

  it("will not discharge until every step is done, then releases the bed", async () => {
    const d = (await q1<{ id: string }>("mo", "select edoshmis_initiate_discharge($1, 'routine') as id", [admission])).id;
    expect(await fails("consultant", "select edoshmis_authorise_discharge($1)", [d])).toMatch(/Still to do: discharge summary, medication reconciliation, investigations review, billing clearance, nursing clearance, pharmacy clearance/);

    await q("mo", "insert into edoshmis_diagnoses (facility_id, patient_id, admission_id, rank, kind, description, icd10_code) values ($1, $2, $3, 'primary', 'final', 'Lobar pneumonia', 'J18.1')", [fac, patient, admission]);
    await q("mo", "select edoshmis_save_discharge_summary($1, $2, true)", [d, JSON.stringify({ hospital_course: "Improved on IV antibiotics", condition_at_discharge: "Stable", discharge_medications: "Amoxicillin-free regimen: azithromycin 500 mg OD x3 days" })]);
    await q("mo", "select edoshmis_discharge_step($1, 'meds_reconciled')", [d]);
    await q("mo", "select edoshmis_discharge_step($1, 'investigations_reviewed', 'CXR improving')", [d]);
    await q("pharm", "select edoshmis_clear_discharge($1, 'pharmacy', 'cleared')", [d]);
    await q("wardmgr", "select edoshmis_clear_discharge($1, 'nursing', 'cleared')", [d]);
    // Billing cannot clear with KSh 2,500 owing; the cashier takes it, then clears.
    expect(await fails("cashier", "select edoshmis_clear_discharge($1, 'billing', 'cleared')", [d])).toMatch(/still owed/);
    const acct = (await q1<{ account_id: string; balance: string }>("cashier", "select account_id, balance from edoshmis_account_balances where admission_id = $1", [admission]));
    await q("cashier", "select edoshmis_receive_payment($1, $2)", [acct.account_id, JSON.stringify({ method: "cash", amount: Number(acct.balance) })]);
    await q("cashier", "select edoshmis_clear_discharge($1, 'billing', 'cleared')", [d]);
    // A medical officer cannot authorise; the consultant can.
    expect(await fails("mo", "select edoshmis_authorise_discharge($1)", [d])).toMatch(/permission/);
    await q("consultant", "select edoshmis_authorise_discharge($1)", [d]);

    const ad = await q1<{ status: string; current_bed_id: string | null }>("consultant", "select status, current_bed_id from edoshmis_admissions where id = $1", [admission]);
    expect(ad).toEqual({ status: "discharged", current_bed_id: null });
    expect((await q1<{ status: string }>("consultant", "select status from edoshmis_beds where id = $1", [bedA2])).status).toBe("cleaning");
    expect(await fails("nurseA", "insert into edoshmis_nursing_notes (facility_id, admission_id, category, shift, body, author_id, author_designation, patient_id) values ($1, $2, 'general', 'night', 'late note', $3, '', $4)",
      [fac, admission, staff.nurseA, patient])).toMatch(/closed|row-level/);
  });

  it("audits the journey and keeps the log append-only", async () => {
    const actions = (await q<{ action: string }>("admin", "select action from edoshmis_audit_logs where patient_id = $1 order by id", [patient])).map((r) => r.action);
    for (const a of ["patient.registered", "admission.requested", "admission.approved", "admission.admitted", "admission.transferred", "medication.prescribed", "discharge.authorised"]) {
      expect(actions).toContain(a);
    }
    await expect(db.query("delete from edoshmis_audit_logs")).rejects.toThrow(/append-only/);
  });
});

describe("dashboard and staff onboarding", () => {
  it("counts only what the caller may see", async () => {
    const nurse = (await q1<{ d: Record<string, unknown> }>("nurseA", "select edoshmis_dashboard($1) as d", [fac])).d;
    const cashier = (await q1<{ d: Record<string, unknown> }>("cashier", "select edoshmis_dashboard($1) as d", [fac])).d;
    expect(nurse.beds).toBeTruthy();
    expect(nurse.billing).toBeUndefined();
    expect(cashier.billing).toBeTruthy();
    expect(cashier.beds).toBeUndefined();
    expect((nurse.beds as { total: number }).total).toBe(3);
  });

  it("adds staff with roles and wards in one step, admins only", async () => {
    const newUser = await addUser(db, "newnurse@test.invalid");
    expect(await fails("nurseA", "select edoshmis_add_staff($1, $2, $3, array['nurse'])", [org, newUser, JSON.stringify({ full_name: "Nurse New", designation: "nurse" })])).toMatch(/permission/);
    const id = (await q1<{ id: string }>("admin", "select edoshmis_add_staff($1, $2, $3, array['nurse'], null, array[$4]::uuid[]) as id",
      [org, newUser, JSON.stringify({ full_name: "Nurse New", designation: "nurse" }), wardA])).id;
    expect(await q("admin", "select * from edoshmis_staff_wards where staff_id = $1", [id])).toHaveLength(1);
    expect((await q1<{ id: string }>("admin", "select edoshmis_auth_user_by_email('NEWNURSE@test.invalid') as id")).id).toBe(newUser);
    expect(await fails("nurseA", "select edoshmis_auth_user_by_email('admin@test.invalid')")).toMatch(/permission/);
  });
});

describe("signed-out access", () => {
  it("gives anon nothing — no rows, no functions", async () => {
    await db.exec("set role anon");
    try {
      await expect(db.query("select * from edoshmis_patients")).rejects.toThrow(/permission denied/);
      await expect(db.query("select edoshmis_dashboard($1)", [fac])).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("reset role");
    }
  });
});
