import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Perm } from "@/lib/perms";

export const FACILITY_COOKIE = "edoshmis_facility";

export interface Facility {
  id: string;
  name: string;
  code: string;
}

export interface Session {
  userId: string;
  email: string;
  isPlatformAdmin: boolean;
  staff: { id: string; fullName: string; designation: string; organizationId: string; organizationName: string } | null;
  facilities: Facility[];
  facility: Facility | null;
  /** Held at the active facility. A UI hint only — the database decides. */
  perms: Set<Perm>;
  wardIds: string[];
}

/**
 * Who is signed in, which hospital and facility they are working in, and
 * what their roles allow there. Read once per request.
 *
 * The permissions here only decide what to show. Every read is filtered by
 * RLS and every change is re-checked inside the database function that makes
 * it, so a hidden button that is called anyway still fails.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: pa }, { data: staffRows }] = await Promise.all([
    supabase.from("edoshmis_platform_admins").select("user_id").eq("user_id", user.id).maybeSingle(),
    supabase
      .from("edoshmis_staff")
      .select("id, full_name, designation, organization_id, edoshmis_organizations(name)")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at")
      .limit(1),
  ]);

  const row = staffRows?.[0] as unknown as
    | { id: string; full_name: string; designation: string; organization_id: string; edoshmis_organizations: { name: string } | null }
    | undefined;
  const base: Session = {
    userId: user.id,
    email: user.email ?? "",
    isPlatformAdmin: Boolean(pa),
    staff: null,
    facilities: [],
    facility: null,
    perms: new Set(),
    wardIds: [],
  };
  if (!row) return base;

  const { data: facilities } = await supabase
    .from("edoshmis_facilities")
    .select("id, name, code")
    .eq("organization_id", row.organization_id)
    .eq("is_active", true)
    .order("name");
  const list = (facilities ?? []) as Facility[];
  const wanted = (await cookies()).get(FACILITY_COOKIE)?.value;
  const facility = list.find((f) => f.id === wanted) ?? list[0] ?? null;

  const [{ data: roles }, { data: wards }] = await Promise.all([
    supabase.from("edoshmis_staff_roles").select("facility_id, edoshmis_roles(permissions)").eq("staff_id", row.id),
    supabase.from("edoshmis_staff_wards").select("ward_id").eq("staff_id", row.id),
  ]);
  const perms = new Set<Perm>();
  for (const r of (roles ?? []) as unknown as { facility_id: string | null; edoshmis_roles: { permissions: string[] } | null }[]) {
    if (r.facility_id && r.facility_id !== facility?.id) continue;
    for (const p of r.edoshmis_roles?.permissions ?? []) perms.add(p as Perm);
  }

  return {
    ...base,
    staff: {
      id: row.id,
      fullName: row.full_name,
      designation: row.designation,
      organizationId: row.organization_id,
      organizationName: row.edoshmis_organizations?.name ?? "",
    },
    facilities: list,
    facility,
    perms,
    wardIds: (wards ?? []).map((w) => w.ward_id as string),
  };
});

export type StaffSession = Session & { staff: NonNullable<Session["staff"]>; facility: Facility };

/** For pages inside the app: signed in, staff of a hospital, at a facility. */
export async function requireStaff(): Promise<StaffSession> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.staff || !s.facility) redirect(s.isPlatformAdmin ? "/platform" : "/no-access");
  return s as StaffSession;
}

export function can(s: Session, ...any: Perm[]) {
  return any.some((p) => s.perms.has(p));
}
