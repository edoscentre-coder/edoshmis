import "server-only";
import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import type { ActionState } from "@/lib/action-state";

/** Database errors are written for people (see the migrations); pass them through, minus Postgres noise. */
export function dbError(e: { message?: string; hint?: string; code?: string } | null): string {
  if (!e) return "Something went wrong.";
  const m = (e.message ?? "").trim();
  if (e.code === "PGRST301" || /JWT/.test(m)) return "Your session has expired. Sign in again.";
  if (/row-level security/.test(m)) return "You do not have permission to do this.";
  if (/duplicate key/.test(m)) return "That already exists.";
  return m || "Something went wrong.";
}

/** Call an edoshmis_ function as the signed-in user and refresh the page on success. */
export async function rpc(fn: string, args: Record<string, unknown>, message?: string): Promise<ActionState> {
  if (!(await getSession())) return { ok: false, error: "Sign in first." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, error: dbError(error), data: error.hint ? { hint: error.hint } : undefined };
  refresh();
  return { ok: true, message, data: { result: data } };
}

export const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};
export const opt = (fd: FormData, k: string) => str(fd, k) || null;
export const num = (fd: FormData, k: string) => {
  const v = str(fd, k);
  if (!v) return null;
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN;
};
export const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";
