import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dbError } from "@/lib/actions";

/**
 * The sign-in for a staff member: the existing one for this email (edos_db's
 * logins are shared across EDOS products), or a new one with the temporary
 * password the administrator chose.
 *
 * The lookup runs as the caller, so the database's own permission check
 * (admin.staff, or EDOS Centre) decides whether they may do this at all —
 * the service-role client is only reached after that has passed.
 */
export async function ensureAuthUser(email: string, tempPassword: string, name: string): Promise<{ id?: string; created?: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: existing, error } = await supabase.rpc("edoshmis_auth_user_by_email", { p_email: email });
  if (error) return { error: dbError(error) };
  if (existing) return { id: existing as string, created: false };

  if (tempPassword.length < 10) return { error: "Set a temporary password of at least 10 characters." };
  const admin = createAdminClient();
  const { data, error: createError } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: name, product: "edoshmis" },
  });
  if (createError || !data.user) return { error: createError?.message ?? "Could not create the sign-in." };
  return { id: data.user.id, created: true };
}
