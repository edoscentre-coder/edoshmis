import type { PGlite } from "@electric-sql/pglite";
import { addUser, asUser, freshDb, one } from "./harness";

/**
 * A synthetic hospital: one organisation and facility, two wards, a bed
 * tariff, and staff in the standard roles. Everything is made up.
 */
export async function hospital() {
  const db = await freshDb();
  const u: Record<string, string> = {};
  const staff: Record<string, string> = {};
  u.platform = await addUser(db, "platform@test.invalid");
  await db.query("insert into edoshmis_platform_admins (user_id) values ($1)", [u.platform]);
  u.admin = await addUser(db, "admin@test.invalid");
  const as = <T,>(who: string | null, sql: string, params: unknown[] = []) =>
    asUser(db, who ? u[who] : null, async () => (await db.query<T>(sql, params)).rows);
  const as1 = async <T,>(who: string | null, sql: string, params: unknown[] = []) => (await as<T>(who, sql, params))[0];
  const fails = async (who: string | null, sql: string, params: unknown[] = []) => {
    try {
      await as(who, sql, params);
    } catch (e) {
      return (e as Error).message;
    }
    throw new Error(`expected failure: ${sql}`);
  };

  const org = (await as1<{ id: string }>("platform", "select edoshmis_create_organization('Mfano Hospital', 'Mfano Main', 'MFH', $1, 'Asha Admin') as id", [u.admin])).id;
  const fac = (await one<{ id: string }>(db, "select id from edoshmis_facilities where organization_id = $1", [org])).id;
  const ward = (await as1<{ id: string }>("admin", "insert into edoshmis_wards (facility_id, name, code, ward_type) values ($1, 'Ward A', 'WA', 'general_medical') returning id", [fac])).id;
  const bed = (await as1<{ id: string }>("admin", "insert into edoshmis_beds (facility_id, ward_id, bed_number) values ($1, $2, 'A1') returning id", [fac, ward])).id;

  async function hire(key: string, designation: string, role: string, wards: string[] = []) {
    u[key] = await addUser(db, `${key}@test.invalid`);
    const s = await one<{ id: string }>(db, "insert into edoshmis_staff (organization_id, user_id, full_name, designation) values ($1, $2, $3, $4) returning id", [org, u[key], key, designation]);
    staff[key] = s.id;
    await db.query("insert into edoshmis_staff_roles (staff_id, role_id) select $1, id from edoshmis_roles where organization_id = $2 and code = $3", [s.id, org, role]);
    for (const w of wards) await db.query("insert into edoshmis_staff_wards (staff_id, ward_id) values ($1, $2)", [s.id, w]);
  }
  await hire("clerk", "receptionist", "receptionist");
  await hire("triage", "triage_officer", "triage_officer");
  await hire("mo", "medical_officer", "medical_officer");
  await hire("consultant", "consultant", "consultant");
  await hire("nurse", "nurse", "nurse", [ward]);
  await hire("wardmgr", "ward_manager", "ward_manager", [ward]);
  await hire("pharm", "pharmacist", "pharmacist");
  await hire("cashier", "cashier", "cashier");
  await hire("labtech", "lab_technologist", "lab_technologist");
  await hire("radiographer", "radiographer", "radiographer");
  await hire("radiologist", "radiologist", "radiologist");

  async function patient(first: string, sex = "female", dob = "1990-01-01") {
    return (await as1<{ id: string }>("clerk", "select edoshmis_register_patient($1, $2) as id", [fac, JSON.stringify({ first_name: first, last_name: "Testcase", sex, date_of_birth: dob, consent_data_processing: true })])).id;
  }
  return { db: db as PGlite, u, staff, org, fac, ward, bed, as, as1, fails, patient, hire };
}
