import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, Hospital } from "lucide-react";
import { Wordmark } from "@/components/brand/logo";
import { Card, CardBody, CardHeader, EmptyState, Field, Input, Select } from "@/components/ui/primitives";
import { ActionForm } from "@/components/ui/action-form";
import { NameAndCode } from "@/components/forms/name-and-code";
import { KENYA_COUNTIES } from "@/lib/kenya";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fmtDate } from "@/lib/format";
import { createOrganization } from "./actions";

export const metadata: Metadata = { title: "EDOS Centre platform" };

const LEVELS = [
  ["level_2", "Level 2 — dispensary"],
  ["level_3", "Level 3 — health centre"],
  ["level_4", "Level 4 — sub-county hospital"],
  ["level_5", "Level 5 — county referral hospital"],
  ["level_6", "Level 6 — national referral hospital"],
  ["nursing_home", "Nursing home"],
  ["medical_centre", "Medical centre"],
  ["specialist_clinic", "Specialist clinic"],
  ["other", "Other"],
] as const;

export default async function PlatformPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.isPlatformAdmin) redirect(s.staff ? "/dashboard" : "/no-access");

  const supabase = await createClient();
  const { data: orgs } = await supabase
    .from("edoshmis_organizations")
    .select("id, name, status, created_at, edoshmis_facilities(name, code, county)")
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-8 flex items-center justify-between">
        <Wordmark />
        {s.staff && (
          <Link href="/dashboard" className="text-sm font-medium text-brand hover:underline">
            Go to your hospital
          </Link>
        )}
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">EDOS Centre platform</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Create a hospital organisation and its first administrator. Platform access gives no sight of any hospital&apos;s patients.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader title={`Hospitals · ${orgs?.length ?? 0}`} icon={Hospital} />
          {!orgs?.length ? (
            <EmptyState icon={Building2} title="No hospitals yet">
              Create the first one with the form.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {orgs.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{o.name}</p>
                    <p className="text-xs text-ink-faint">
                      {(o.edoshmis_facilities as { name: string; code: string; county: string | null }[]).map((f) => `${f.name} (${f.code})`).join(", ")}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-ink-faint">{fmtDate(o.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="New hospital" />
          <CardBody>
            <ActionForm action={createOrganization} submitLabel="Create hospital">
              <Field label="Organisation name" required>
                <Input name="name" required placeholder="e.g. Mfano Hospital Group" />
              </Field>
              <NameAndCode nameField="facility_name" codeField="facility_code" nameLabel="First facility" placeholder="Mfano Main Hospital" codeHint="Starts every hospital and admission number" />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Level">
                  <Select name="level" defaultValue="other">
                    {LEVELS.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="MFL code">
                  <Input name="mfl_code" inputMode="numeric" />
                </Field>
              </div>
              <Field label="County">
                <Select name="county" defaultValue="">
                  <option value="">Choose county</option>
                  {KENYA_COUNTIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              </Field>
              <hr className="border-line" />
              <Field label="Administrator's name" required>
                <Input name="admin_name" required />
              </Field>
              <Field label="Administrator's email" required hint="If this email already signs in to an EDOS product, that login is reused.">
                <Input name="admin_email" type="email" required />
              </Field>
              <Field label="Temporary password" hint="Only used for a new login. At least 10 characters; give it to them privately.">
                <Input name="temp_password" type="text" autoComplete="off" minLength={10} />
              </Field>
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
