"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { str } from "@/lib/actions";
import type { ActionState } from "@/lib/action-state";

export async function signIn(_: ActionState, fd: FormData): Promise<ActionState> {
  const email = str(fd, "email");
  const password = String(fd.get("password") ?? "");
  if (!email || !password) return { ok: false, error: "Enter your email and password." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  // One message for both cases, so the form does not reveal which emails have accounts.
  if (error) return { ok: false, error: "That email and password do not match. Check them, or ask your administrator to reset your password." };

  await supabase.rpc("edoshmis_record_login", { p_user_agent: (await headers()).get("user-agent") });
  const next = str(fd, "next");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}
