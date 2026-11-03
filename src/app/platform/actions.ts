"use server";

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { dbError, opt, str } from "@/lib/actions";
import { ensureAuthUser } from "@/lib/staff-auth";
import type { ActionState } from "@/lib/action-state";

export async function createOrganization(_: ActionState, fd: FormData): Promise<ActionState> {
  const s = await getSession();
  if (!s?.isPlatformAdmin) return { ok: false, error: "Only EDOS Centre can create a hospital." };

  const email = str(fd, "admin_email").toLowerCase();
  const adminName = str(fd, "admin_name");
  if (!str(fd, "name") || !str(fd, "facility_name") || !email || !adminName) return { ok: false, error: "Fill in the required fields." };

  const user = await ensureAuthUser(email, String(fd.get("temp_password") ?? ""), adminName);
  if (user.error || !user.id) return { ok: false, error: user.error };

  const supabase = await createClient();
  const { error } = await supabase.rpc("edoshmis_create_organization", {
    p_name: str(fd, "name"),
    p_facility_name: str(fd, "facility_name"),
    p_facility_code: str(fd, "facility_code").toUpperCase(),
    p_admin_user: user.id,
    p_admin_name: adminName,
    p_level: str(fd, "level") || "other",
    p_county: opt(fd, "county"),
    p_mfl_code: opt(fd, "mfl_code"),
  });
  if (error) return { ok: false, error: dbError(error) };
  refresh();
  return {
    ok: true,
    message: user.created
      ? `Created. ${adminName} signs in with ${email} and the temporary password you set.`
      : `Created. ${adminName} signs in with their existing EDOS login (${email}).`,
  };
}
