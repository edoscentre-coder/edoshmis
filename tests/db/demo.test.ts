import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { addUser, asUser, freshDb } from "./harness";

const DEMO = join(__dirname, "..", "..", "supabase", "demo");

async function counts(db: Awaited<ReturnType<typeof freshDb>>) {
  const { rows } = await db.query<{ t: string }>("select tablename t from pg_tables where schemaname = 'public' and tablename like 'edoshmis\\_%' and tablename not in ('edoshmis_counters', 'edoshmis_demo_registry') order by 1");
  const out: Record<string, number> = {};
  for (const { t } of rows) out[t] = (await db.query<{ n: number }>(`select count(*)::int n from public.${t}`)).rows[0].n;
  return out;
}

describe("demo data", () => {
  it("loads three journeys as Val, then removes exactly what it added", async () => {
    const db = await freshDb();
    const platform = await addUser(db, "platform@test.invalid");
    await db.query("insert into edoshmis_platform_admins (user_id) values ($1)", [platform]);
    const val = await addUser(db, "edoscentre@gmail.com");
    await asUser(db, platform, () => db.query("select edoshmis_create_organization('Edoscentre', 'Edoscentre', 'EDO', $1, 'Val')", [val]));
    // A real patient that must survive removal.
    const fac = (await db.query<{ id: string }>("select id from edoshmis_facilities where code = 'EDO'")).rows[0].id;
    await db.query("update edoshmis_roles set permissions = permissions || array['patients.register'] where code = 'hospital_admin'");
    await asUser(db, val, () => db.query("select edoshmis_register_patient($1, $2)", [fac, JSON.stringify({ first_name: "Real", last_name: "Person", sex: "male", consent_data_processing: true })]));
    await db.query("update edoshmis_roles set permissions = array_remove(permissions, 'patients.register') where code = 'hospital_admin'");
    const before = await counts(db);
    const valRolesBefore = (await db.query("select count(*)::int n from edoshmis_staff_roles")).rows[0];

    await db.exec(readFileSync(join(DEMO, "01_load_demo.sql"), "utf8"));
    const pats = (await db.query<{ first_name: string; hospital_number: string }>("select first_name, hospital_number from edoshmis_patients p join edoshmis_patient_identifiers i on i.patient_id = p.id where i.value like 'EDOSHMIS-DEMO-%' order by first_name")).rows;
    expect(pats.map((p) => p.first_name)).toEqual(["Amina", "Brian", "Grace"]);
    expect(pats[0].hospital_number).toMatch(/^EDO-\d{6}$/);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const state = async (sql: string) => (await db.query<Record<string, any>>(sql)).rows;
    // Amina: outpatient, closed with follow-up, lab validated, both prescriptions dispensed, bill paid.
    expect(await state("select e.status, e.outcome from edoshmis_encounters e join edoshmis_patients p on p.id = e.patient_id where p.first_name = 'Amina'")).toEqual([{ status: "closed", outcome: "follow_up" }]);
    expect(await state("select b.balance::text from edoshmis_account_balances b join edoshmis_patients p on p.id = b.patient_id where p.first_name = 'Amina'")).toEqual([{ balance: "0.00" }]);
    // Brian: admitted in DEMO-1, critical lab communicated, CXR validated, an escalation resolved, a dose given.
    expect(await state("select a.status, b.bed_number from edoshmis_admissions a join edoshmis_beds b on b.id = a.current_bed_id join edoshmis_patients p on p.id = a.patient_id where p.first_name = 'Brian'")).toEqual([{ status: "active", bed_number: "DEMO-1" }]);
    expect((await state("select count(*)::int n from edoshmis_lab_critical_calls"))[0]).toEqual({ n: 1 });
    expect(await state("select status from edoshmis_imaging_orders")).toEqual([{ status: "validated" }]);
    expect(await state("select status from edoshmis_escalations")).toEqual([{ status: "resolved" }]);
    expect((await state("select count(*)::int n from edoshmis_medication_administrations where status = 'administered'"))[0].n).toBeGreaterThanOrEqual(1);
    // Grace: discharged, bed DEMO-2 released for cleaning, bill closed.
    expect(await state("select a.status from edoshmis_admissions a join edoshmis_patients p on p.id = a.patient_id where p.first_name = 'Grace'")).toEqual([{ status: "discharged" }]);
    expect(await state("select status from edoshmis_beds where bed_number = 'DEMO-2'")).toEqual([{ status: "cleaning" }]);
    // Stock was drawn FEFO from the demo pharmacy.
    expect((await state("select count(*)::int n from edoshmis_stock_movements where kind = 'dispense'"))[0].n).toBeGreaterThan(0);
    // Everything is authored by Val.
    const valStaff = (await state("select id from edoshmis_staff where full_name = 'Val'"))[0].id;
    expect(await state("select distinct author_id from edoshmis_clinical_notes")).toEqual([{ author_id: valStaff }]);

    await expect(db.exec(readFileSync(join(DEMO, "01_load_demo.sql"), "utf8"))).rejects.toThrow(/already loaded/);
    await db.exec("rollback"); // as the SQL editor does after an error

    await db.exec(readFileSync(join(DEMO, "02_remove_demo.sql"), "utf8"));
    const after = await counts(db);
    expect(after).toEqual(before);
    expect((await db.query("select count(*)::int n from edoshmis_staff_roles")).rows[0]).toEqual(valRolesBefore);
    expect((await db.query("select first_name from edoshmis_patients")).rows).toEqual([{ first_name: "Real" }]);
    // Guards are back on.
    await expect(db.query("delete from edoshmis_audit_logs")).rejects.toThrow(/append-only/);
    // And it can be loaded again after removal.
    await db.exec(readFileSync(join(DEMO, "01_load_demo.sql"), "utf8"));
  });
});
