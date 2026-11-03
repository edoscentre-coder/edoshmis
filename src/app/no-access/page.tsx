import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { Wordmark } from "@/components/brand/logo";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "No access" };

export default async function NoAccess() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.staff) redirect("/dashboard");
  if (s.isPlatformAdmin) redirect("/platform");

  return (
    <div className="flex min-h-dvh items-center justify-center px-5">
      <div className="w-full max-w-md text-center">
        <div className="mb-8 flex justify-center">
          <Wordmark />
        </div>
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-sunk">
          <LockKeyhole className="h-5 w-5 text-ink-faint" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-lg font-semibold text-ink">You are signed in, but not on a hospital&apos;s staff list</h1>
        <p className="mt-2 text-sm text-ink-soft">
          {s.email} has no active staff record in EDOSHMIS. Ask your hospital administrator to add you, or to reactivate your account.
        </p>
        <form action="/auth/signout" method="post" className="mt-6">
          <button className="text-sm font-medium text-brand hover:underline">Sign in as someone else</button>
        </form>
      </div>
    </div>
  );
}
