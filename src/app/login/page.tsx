import type { Metadata } from "next";
import Image from "next/image";
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
        <Image src="/login-doctor.jpg" alt="" fill priority sizes="55vw" className="object-cover object-[50%_25%]" />
        {/* Navy wash: the photo sets the scene, the words stay readable. */}
        <div className="absolute inset-0 bg-gradient-to-t from-shell via-shell/80 to-shell/40" aria-hidden="true" />
        <div className="relative">
          <Wordmark tone="light" />
        </div>
        <div className="relative max-w-md">
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
        <div className="relative flex items-end justify-between gap-4">
          <p className="flex items-center gap-2 text-xs text-shell-ink">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Every record you open or change is logged, as the Data Protection Act requires.
          </p>
          <a href="https://unsplash.com/photos/Z7TAIOQgjWA" className="shrink-0 text-[10px] text-shell-ink-faint hover:text-white" target="_blank" rel="noreferrer">
            Photo: Eben Kassaye / Unsplash
          </a>
        </div>
      </section>

      <section className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-6 lg:hidden">
            <Wordmark />
            <div className="relative mt-5 h-44 overflow-hidden rounded-2xl bg-shell">
              <Image src="/login-doctor.jpg" alt="" fill priority sizes="100vw" className="object-cover object-[50%_22%]" />
              <div className="absolute inset-0 bg-gradient-to-t from-shell/70 to-transparent" aria-hidden="true" />
              <p className="absolute bottom-3 left-4 text-sm font-semibold text-white">Better patient care.</p>
            </div>
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
