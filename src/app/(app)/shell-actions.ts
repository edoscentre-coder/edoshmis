"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { FACILITY_COOKIE, getSession } from "@/lib/session";

/** Switch the facility you are working at — only to one of your own organisation's. */
export async function switchFacility(fd: FormData) {
  const s = await getSession();
  const id = String(fd.get("facility") ?? "");
  if (!s?.facilities.some((f) => f.id === id)) return;
  (await cookies()).set(FACILITY_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  redirect("/dashboard");
}
