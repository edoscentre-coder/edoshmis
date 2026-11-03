import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Wordmark } from "@/components/brand/logo";
import { getSession } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await getSession()) redirect(next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-shell p-12 text-white lg:flex">
        <Wordmark tone="light" />
        <div className="max-w-md">
          <h1 className="text-3xl leading-tight font-semibold tracking-tight">
            Smarter hospital operations.
            <br />
            <span className="text-[#5eead4]">Better patient care.</span>
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-shell-ink">
            Admissions, beds, ward rounds, observations, the medication chart, billing and discharge — one record for every
            patient, kept by everyone who cares for them.
          </p>
        </div>
        <p className="flex items-center gap-2 text-xs text-shell-ink-faint">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          Every record you open or change is logged, as the Data Protection Act requires.
        </p>
        <svg className="pointer-events-none absolute -right-24 -bottom-24 h-96 w-96 opacity-[0.07]" viewBox="0 0 100 100" aria-hidden="true">
          <path d="M5 55h18l6-16 10 34 9-26 6 8h41" fill="none" stroke="#5eead4" strokeWidth="3" strokeLinejoin="round" />
        </svg>
      </section>

      <section className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Wordmark />
          </div>
          <h2 className="text-xl font-semibold tracking-tight text-ink">Sign in</h2>
          <p className="mt-1 text-sm text-ink-soft">Use the email and password your hospital administrator gave you.</p>
          <LoginForm next={next ?? ""} />
          <p className="mt-8 text-xs text-ink-faint">EDOSHMIS by EDOS Centre Ltd.</p>
        </div>
      </section>
    </div>
  );
}
