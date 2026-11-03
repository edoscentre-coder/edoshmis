"use server";

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/session";
import { bool, dbError, num, opt, rpc, str } from "@/lib/actions";
import { normalisePhone } from "@/lib/format";
import { ensureAuthUser } from "@/lib/staff-auth";
import { PERMS } from "@/lib/perms";
import type { ActionState } from "@/lib/action-state";

/*
 * Administration. Each write goes through the signed-in admin's session;
 * the admin.* policies on every table decide whether it lands.
 */

async function write(op: (sb: Awaited<ReturnType<typeof createClient>>) => PromiseLike<{ error: { message: string; code?: string } | null; data?: unknown }>, message?: string): Promise<ActionState> {
  await requireStaff();
  const supabase = await createClient();
  const { error, data } = await op(supabase);
  if (error) return { ok: false, error: dbError(error) };
  if (Array.isArray(data) && data.length === 0) return { ok: false, error: "You do not have permission to change this." };
  refresh();
  return { ok: true, message };
}

/* ---------------------------------------------------------------- organisation & facilities */

export async function saveOrganization(_: ActionState, fd: FormData) {
  const s = await requireStaff();
  return write(
    (sb) => sb.from("edoshmis_organizations").update({ name: str(fd, "name"), legal_name: opt(fd, "legal_name"), kra_pin: opt(fd, "kra_pin")?.toUpperCase(), email: opt(fd, "email"), phone: opt(fd, "phone") }).eq("id", s.staff.organizationId).select("id"),
    "Saved.",
  );
}

export async function saveFacility(facilityId: string | null, _: ActionState, fd: FormData) {
  const s = await requireStaff();
  const row = {
    name: str(fd, "name"),
    code: str(fd, "code").toUpperCase(),
    level: str(fd, "level") || "other",
    mfl_code: opt(fd, "mfl_code"),
    sha_facility_code: opt(fd, "sha_facility_code"),
    county: opt(fd, "county"),
    sub_county: opt(fd, "sub_county"),
    address: opt(fd, "address"),
    phone: opt(fd, "phone"),
    email: opt(fd, "email"),
  };
  if (!row.name || !/^[A-Z0-9]{2,8}$/.test(row.code)) return { ok: false, error: "Give a name and a 2–8 character code (letters and digits)." };
  return write(
    (sb) => (facilityId ? sb.from("edoshmis_facilities").update(row).eq("id", facilityId).select("id") : sb.from("edoshmis_facilities").insert({ ...row, organization_id: s.staff.organizationId }).select("id")),
    facilityId ? "Saved." : "Facility added.",
  );
}

export async function addDepartment(_: ActionState, fd: FormData) {
  const s = await requireStaff();
  return write((sb) => sb.from("edoshmis_departments").insert({ facility_id: s.facility.id, name: str(fd, "name"), code: str(fd, "code").toUpperCase(), kind: str(fd, "kind") || "clinical" }).select("id"), "Department added.");
}

/* ---------------------------------------------------------------- wards & beds */

export async function saveWard(wardId: string | null, _: ActionState, fd: FormData) {
  const s = await requireStaff();
  const row = {
    name: str(fd, "name"),
    code: str(fd, "code").toUpperCase(),
    ward_type: str(fd, "ward_type"),
    sex_restriction: str(fd, "sex_restriction") || "any",
    isolation_capacity: num(fd, "isolation_capacity") ?? 0,
    department_id: opt(fd, "department_id"),
    ward_manager_id: opt(fd, "ward_manager_id"),
    responsible_nurse_id: opt(fd, "responsible_nurse_id"),
    responsible_consultant_id: opt(fd, "responsible_consultant_id"),
    daily_tariff_id: opt(fd, "daily_tariff_id"),
    status: str(fd, "status") || "open",
    sort_order: num(fd, "sort_order") ?? 0,
  };
  if (!row.name || !row.code || !row.ward_type) return { ok: false, error: "Give the ward a name, code and type." };
  return write(
    (sb) => (wardId ? sb.from("edoshmis_wards").update(row).eq("id", wardId).select("id") : sb.from("edoshmis_wards").insert({ ...row, facility_id: s.facility.id }).select("id")),
    wardId ? "Ward saved." : "Ward added — now add its beds.",
  );
}

/** Add beds A1…A12 in one go: a prefix and a number range. */
export async function addBeds(wardId: string, _: ActionState, fd: FormData) {
  const s = await requireStaff();
  const prefix = str(fd, "prefix");
  const from = num(fd, "from");
  const to = num(fd, "to");
  if (!from || !to || Number.isNaN(from) || Number.isNaN(to) || from < 0 || to < from || to - from > 99) return { ok: false, error: "Give a range of up to 100 beds, e.g. 1 to 12." };
  const rows = Array.from({ length: to - from + 1 }, (_, i) => ({
    facility_id: s.facility.id,
    ward_id: wardId,
    bed_number: `${prefix}${from + i}`,
    room: opt(fd, "room"),
    category: str(fd, "category") || "standard",
    is_isolation: bool(fd, "is_isolation"),
    daily_tariff_id: opt(fd, "daily_tariff_id"),
  }));
  return write((sb) => sb.from("edoshmis_beds").insert(rows).select("id"), `${rows.length} bed(s) added.`);
}

export async function saveBed(bedId: string, _: ActionState, fd: FormData) {
  return write(
    (sb) =>
      sb
        .from("edoshmis_beds")
        .update({ bed_number: str(fd, "bed_number"), room: opt(fd, "room"), category: str(fd, "category"), sex_restriction: str(fd, "sex_restriction") || "any", is_isolation: bool(fd, "is_isolation"), daily_tariff_id: opt(fd, "daily_tariff_id"), is_active: !bool(fd, "retire") })
        .eq("id", bedId)
        .select("id"),
    "Bed saved.",
  );
}

/* ---------------------------------------------------------------- tariffs */

export async function saveTariff(tariffId: string | null, _: ActionState, fd: FormData) {
  const s = await requireStaff();
  const price = num(fd, "price");
  const sha = num(fd, "sha_price");
  if (price === null || Number.isNaN(price) || price < 0) return { ok: false, error: "Enter the price." };
  const row = {
    code: str(fd, "code").toUpperCase(),
    name: str(fd, "name"),
    category: str(fd, "category"),
    unit: str(fd, "unit") || "each",
    price,
    sha_price: sha === null || Number.isNaN(sha) ? null : sha,
    sha_service_code: opt(fd, "sha_service_code"),
    is_active: !bool(fd, "inactive"),
  };
  return write(
    (sb) => (tariffId ? sb.from("edoshmis_tariffs").update(row).eq("id", tariffId).select("id") : sb.from("edoshmis_tariffs").insert({ ...row, facility_id: s.facility.id }).select("id")),
    tariffId ? "Saved." : "Price added.",
  );
}

/* ---------------------------------------------------------------- staff & roles */

export async function addStaff(_: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireStaff();
  const email = str(fd, "email").toLowerCase();
  const name = str(fd, "full_name");
  const roles = fd.getAll("roles").map(String).filter(Boolean);
  if (!email || !name || !str(fd, "designation")) return { ok: false, error: "Give the name, email and designation." };
  if (!roles.length) return { ok: false, error: "Give at least one role." };
  const phone = normalisePhone(str(fd, "phone"));
  if (phone === undefined) return { ok: false, error: "The phone is not a Kenyan mobile number." };

  const user = await ensureAuthUser(email, String(fd.get("temp_password") ?? ""), name);
  if (user.error || !user.id) return { ok: false, error: user.error };

  const r = await rpc("edoshmis_add_staff", {
    p_org: s.staff.organizationId,
    p_user: user.id,
    s: {
      full_name: name,
      designation: str(fd, "designation"),
      staff_number: opt(fd, "staff_number"),
      regulator: opt(fd, "regulator"),
      registration_number: opt(fd, "registration_number"),
      registration_expiry: opt(fd, "registration_expiry"),
      phone,
      email,
    },
    p_roles: roles,
    p_facility: str(fd, "scope") === "facility" ? s.facility.id : null,
    p_wards: fd.getAll("wards").map(String).filter(Boolean),
  });
  if (!r.ok) return r;
  return { ok: true, message: user.created ? `${name} added. They sign in with ${email} and the temporary password you set.` : `${name} added. They sign in with their existing EDOS login (${email}).` };
}

export async function setStaffStatus(staffId: string, status: "active" | "suspended" | "left") {
  return write((sb) => sb.from("edoshmis_staff").update({ status }).eq("id", staffId).select("id"), status === "active" ? "Reactivated." : "Access removed.");
}

export async function grantRole(staffId: string, _: ActionState, fd: FormData) {
  const s = await requireStaff();
  return write((sb) => sb.from("edoshmis_staff_roles").insert({ staff_id: staffId, role_id: str(fd, "role_id"), facility_id: str(fd, "scope") === "facility" ? s.facility.id : null, granted_by: s.staff.id }).select("id"), "Role granted.");
}

export async function revokeRole(staffRoleId: string) {
  return write((sb) => sb.from("edoshmis_staff_roles").delete().eq("id", staffRoleId).select("id"), "Role removed.");
}

export async function setWards(staffId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireStaff();
  const wanted = new Set(fd.getAll("wards").map(String));
  const supabase = await createClient();
  const { data: wards } = await supabase.from("edoshmis_wards").select("id").eq("facility_id", s.facility.id);
  const here = (wards ?? []).map((w) => w.id as string);
  const remove = here.filter((w) => !wanted.has(w));
  if (remove.length) {
    const { error } = await supabase.from("edoshmis_staff_wards").delete().eq("staff_id", staffId).in("ward_id", remove);
    if (error) return { ok: false, error: dbError(error) };
  }
  const add = [...wanted].filter((w) => here.includes(w)).map((ward_id) => ({ staff_id: staffId, ward_id }));
  if (add.length) {
    const { error } = await supabase.from("edoshmis_staff_wards").upsert(add, { onConflict: "staff_id,ward_id", ignoreDuplicates: true });
    if (error) return { ok: false, error: dbError(error) };
  }
  refresh();
  return { ok: true, message: "Ward assignments saved." };
}

export async function saveRole(roleId: string | null, _: ActionState, fd: FormData) {
  const s = await requireStaff();
  const perms = fd.getAll("perms").map(String).filter((p) => (PERMS as readonly string[]).includes(p));
  const row = { name: str(fd, "name"), description: opt(fd, "description"), permissions: perms };
  if (!row.name) return { ok: false, error: "Name the role." };
  if (roleId) return write((sb) => sb.from("edoshmis_roles").update(row).eq("id", roleId).select("id"), "Role saved.");
  const code = row.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "custom";
  return write((sb) => sb.from("edoshmis_roles").insert({ ...row, code: /^[a-z]/.test(code) ? code : `r_${code}`, organization_id: s.staff.organizationId }).select("id"), "Role created.");
}

/* ---------------------------------------------------------------- clinical configuration */

export async function addBand(_: ActionState, fd: FormData) {
  const s = await requireStaff();
  const min = num(fd, "min_value");
  const max = num(fd, "max_value");
  const score = num(fd, "score");
  if (score === null || Number.isNaN(score)) return { ok: false, error: "Give the score for this band." };
  if (!str(fd, "approved_by")) return { ok: false, error: "Name the clinician who approved these bands." };
  return write(
    (sb) =>
      sb
        .from("edoshmis_observation_bands")
        .insert({
          facility_id: s.facility.id,
          scheme: str(fd, "scheme") || "adult",
          parameter: str(fd, "parameter"),
          min_value: Number.isNaN(min) ? null : min,
          max_value: Number.isNaN(max) ? null : max,
          match_value: opt(fd, "match_value"),
          score,
          approved_by: str(fd, "approved_by"),
          approved_at: str(fd, "approved_at") || new Date().toISOString().slice(0, 10),
        })
        .select("id"),
    "Band added.",
  );
}

export async function deleteBand(bandId: string) {
  return write((sb) => sb.from("edoshmis_observation_bands").delete().eq("id", bandId).select("id"), "Band removed.");
}

export async function addEscalationRule(_: ActionState, fd: FormData) {
  const s = await requireStaff();
  const total = num(fd, "min_total");
  const single = num(fd, "single_parameter");
  if (!str(fd, "approved_by")) return { ok: false, error: "Name the clinician who approved this rule." };
  return write(
    (sb) =>
      sb
        .from("edoshmis_escalation_rules")
        .insert({
          facility_id: s.facility.id,
          scheme: str(fd, "scheme") || "adult",
          min_total: Number.isNaN(total) ? null : total,
          single_parameter: Number.isNaN(single) ? null : single,
          level: str(fd, "level"),
          response: str(fd, "response"),
          repeat_minutes: num(fd, "repeat_minutes"),
          approved_by: str(fd, "approved_by"),
          approved_at: str(fd, "approved_at") || new Date().toISOString().slice(0, 10),
        })
        .select("id"),
    "Rule added.",
  );
}

export async function deleteEscalationRule(ruleId: string) {
  return write((sb) => sb.from("edoshmis_escalation_rules").delete().eq("id", ruleId).select("id"), "Rule removed.");
}

export async function saveDrug(drugId: string | null, _: ActionState, fd: FormData) {
  const s = await requireStaff();
  const row = {
    generic_name: str(fd, "generic_name"),
    brand_name: opt(fd, "brand_name"),
    drug_class: opt(fd, "drug_class"),
    form: str(fd, "form"),
    strength: opt(fd, "strength"),
    default_route: opt(fd, "default_route"),
    is_controlled: bool(fd, "is_controlled"),
    tariff_id: opt(fd, "tariff_id"),
    is_active: !bool(fd, "inactive"),
  };
  if (!row.generic_name || !row.form) return { ok: false, error: "Give the generic name and form." };
  return write(
    (sb) => (drugId ? sb.from("edoshmis_drugs").update(row).eq("id", drugId).select("id") : sb.from("edoshmis_drugs").insert({ ...row, organization_id: s.staff.organizationId }).select("id")),
    drugId ? "Saved." : "Drug added.",
  );
}

export async function addInteraction(_: ActionState, fd: FormData) {
  const s = await requireStaff();
  const [a, b] = [str(fd, "drug_a"), str(fd, "drug_b")].sort();
  if (!a || !b || a === b) return { ok: false, error: "Choose two different drugs." };
  if (!str(fd, "source")) return { ok: false, error: "Cite the reference this comes from." };
  return write(
    (sb) =>
      sb
        .from("edoshmis_drug_interactions")
        .insert({ organization_id: s.staff.organizationId, drug_a: a, drug_b: b, severity: str(fd, "severity"), description: str(fd, "description"), source: str(fd, "source") })
        .select("id"),
    "Interaction added.",
  );
}

export async function deleteInteraction(id: string) {
  return write((sb) => sb.from("edoshmis_drug_interactions").delete().eq("id", id).select("id"), "Removed.");
}
