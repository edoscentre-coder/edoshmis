import type { Metadata } from "next";
import Link from "next/link";
import { Search, UserPlus, Users } from "lucide-react";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, buttonClass, control } from "@/components/ui/primitives";
import { can, requireStaff } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { ageOf, fmtDate, fullName, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Patients" };

interface Row {
  id: string;
  hospital_number: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  sex: string;
  date_of_birth: string | null;
  dob_estimated: boolean;
  phone: string | null;
  county: string | null;
  is_deceased: boolean;
  created_at: string;
}

/** Characters PostgREST's filter grammar treats as syntax; stripped from search words. */
const clean = (w: string) => w.replace(/[,()*:%\\"']/g, "").trim();

export default async function PatientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const s = await requireStaff();
  const { q = "" } = await searchParams;
  const supabase = await createClient();

  if (!can(s, "patients.read")) {
    return <EmptyState icon={Users} title="Your role does not include the patient register." />;
  }

  const words = q.split(/\s+/).map(clean).filter((w) => w.length > 0).slice(0, 4);
  let rows: Row[] = [];
  const cols = "id, hospital_number, first_name, middle_name, last_name, sex, date_of_birth, dob_estimated, phone, county, is_deceased, created_at";

  if (words.length) {
    // Every word must match some part of the name, the hospital number or the
    // phone; an identifier (ID, passport, SHA number) matches on its own.
    let query = supabase.from("edoshmis_patients").select(cols).eq("organization_id", s.staff.organizationId).is("merged_into", null);
    for (const w of words) {
      const digits = w.replace(/\D/g, "");
      const phoneTerm = digits.length >= 6 ? `,phone.ilike.*${digits.replace(/^0/, "")}*` : "";
      query = query.or(`first_name.ilike.*${w}*,middle_name.ilike.*${w}*,last_name.ilike.*${w}*,hospital_number.ilike.*${w}*${phoneTerm}`);
    }
    const [{ data: byName }, { data: byId }] = await Promise.all([
      query.order("last_name").limit(50),
      supabase
        .from("edoshmis_patient_identifiers")
        .select(`edoshmis_patients!inner(${cols})`)
        .eq("organization_id", s.staff.organizationId)
        .ilike("value", `%${words.join("")}%`)
        .limit(20),
    ]);
    const seen = new Set<string>();
    for (const r of [...((byId ?? []) as unknown as { edoshmis_patients: Row }[]).map((x) => x.edoshmis_patients), ...((byName ?? []) as Row[])]) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        rows.push(r);
      }
    }
  } else {
    const { data } = await supabase.from("edoshmis_patients").select(cols).eq("organization_id", s.staff.organizationId).is("merged_into", null).order("created_at", { ascending: false }).limit(25);
    rows = (data ?? []) as Row[];
  }

  // Who is in hospital now, to show it on the row.
  const ids = rows.map((r) => r.id);
  const { data: inpatients } = ids.length
    ? await supabase.from("edoshmis_admissions").select("id, patient_id").in("patient_id", ids).in("status", ["active", "discharge_in_progress"])
    : { data: [] };
  const admitted = new Map((inpatients ?? []).map((a) => [a.patient_id as string, a.id as string]));

  return (
    <>
      <PageHeader
        title="Patient register"
        description="One record per person, shared by every department and facility of the hospital."
        actions={
          can(s, "patients.register") && (
            <ButtonLink href="/patients/new">
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Register patient
            </ButtonLink>
          )
        }
      />

      <form className="mb-4 flex gap-2" role="search">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
          <input name="q" defaultValue={q} placeholder="Name, hospital number, national ID, passport or phone" className={cn(control, "h-11 pl-9")} autoFocus={!q} />
        </div>
        <button className={buttonClass("secondary", "md", "h-11")}>Search</button>
      </form>

      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={Users} title={q ? `No patient matches “${q}”` : "No patients registered yet"}>
            {q ? "Check the spelling, try the phone number or ID, or register them." : null}
            {can(s, "patients.register") && (
              <div className="mt-3">
                <ButtonLink href="/patients/new" size="sm">
                  Register a patient
                </ButtonLink>
              </div>
            )}
          </EmptyState>
        ) : (
          <>
            <div className="border-b border-line px-5 py-2.5 text-xs text-ink-faint">{q ? `${rows.length} match${rows.length === 1 ? "" : "es"}` : "Most recently registered"}</div>
            {/* Desktop: a table. Phone: a card per patient. */}
            <table className="hidden w-full text-sm md:table">
              <thead>
                <tr className="text-left text-xs text-ink-faint">
                  <th className="px-5 py-2 font-medium">Patient</th>
                  <th className="px-3 py-2 font-medium">Hospital no.</th>
                  <th className="px-3 py-2 font-medium">Age · sex</th>
                  <th className="px-3 py-2 font-medium">Phone</th>
                  <th className="px-3 py-2 font-medium">Registered</th>
                  <th className="px-5 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-line hover:bg-surface-sunk/60">
                    <td className="px-5 py-2.5">
                      <Link href={`/patients/${r.id}`} className="font-medium text-ink hover:text-brand">
                        {fullName(r)}
                      </Link>
                    </td>
                    <td className="tnum px-3 py-2.5 text-ink-soft">{r.hospital_number}</td>
                    <td className="px-3 py-2.5 text-ink-soft">
                      {ageOf(r.date_of_birth, r.dob_estimated)} · {titleCase(r.sex)}
                    </td>
                    <td className="tnum px-3 py-2.5 text-ink-soft">{r.phone ?? "—"}</td>
                    <td className="px-3 py-2.5 text-ink-soft">{fmtDate(r.created_at)}</td>
                    <td className="px-5 py-2.5 text-right">
                      <Flags admissionId={admitted.get(r.id)} deceased={r.is_deceased} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-line md:hidden">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link href={`/patients/${r.id}`} className="flex items-center justify-between gap-3 px-4 py-3 active:bg-surface-sunk">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{fullName(r)}</span>
                      <span className="tnum block text-xs text-ink-faint">
                        {r.hospital_number} · {ageOf(r.date_of_birth, r.dob_estimated)} · {titleCase(r.sex)}
                        {r.phone ? ` · ${r.phone}` : ""}
                      </span>
                    </span>
                    <Flags admissionId={admitted.get(r.id)} deceased={r.is_deceased} />
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </>
  );
}

function Flags({ admissionId, deceased }: { admissionId?: string; deceased: boolean }) {
  return (
    <span className="flex shrink-0 justify-end gap-1">
      {admissionId && <Badge tone="brand">Inpatient</Badge>}
      {deceased && <Badge tone="neutral">Deceased</Badge>}
    </span>
  );
}
