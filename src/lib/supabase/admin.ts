import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client. Bypasses RLS, so it is used for exactly one thing:
 * the Supabase Auth Admin API (creating a staff member's sign-in), which has
 * no SQL equivalent — and only after the caller's admin.staff permission has
 * been checked through their own session. Never imported by client code.
 */
export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
