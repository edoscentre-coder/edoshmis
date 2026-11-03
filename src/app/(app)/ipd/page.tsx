import type { Metadata } from "next";
import Link from "next/link";
import { Activity, AlertTriangle, BedDouble } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireStaff } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { ageOf, fmtDate, fullName, lengthOfStay, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Inpatients" };

interface Row {
  id: string;
  admission_number: string;
  admitted_at: string;
  status: string;
  condition: string | null;
  expected_discharge_date: string | null;
  current_ward_id: string | null;
  edoshmis_patients: { id: string; first_name: string; middle_name: string | null; last_name: string; sex: string; date_of_birth: string | null; dob_estimated: boolean; hospital_number: string };
  edoshmis_beds: { bed_number: string } | null;
  edoshmis_wards: { name: string } | null;
  consultant: { full_name: string } | null;
  edoshmis_diagnoses: { description: string; rank: string; status: string }[];
}

/**
 * Everyone in a bed right now, by ward. A nurse sees the wards she is
 * assigned to (unless her role sees all), and the list itself comes through
 * the census policy — this page adds no filter of its own beyond the choice.
 */
export default async function CensusPage({ searchParams }: { searchParams: Promise<{ ward?: string; filter?: string }> }) {
  const s = await requireStaff();
  if (!can(s, "ipd.read")) return <EmptyState icon={Activity} title="Your role does not include the inpatient census." />;
  const { ward, filter } = await searchParams;
  const supabase = await createClient();
  const allWards = can(s, "ipd.all_patients");

  const { data: wards } = await supabase.from("edoshmis_wards").select("id, name").eq("facility_id", s.facility.id).order("sort_order").order("name");
  const visibleWards = (wards ?? []).filter((w) => allWards || s.wardIds.includes(w.id));

  let q = supabase
    .from("edoshmis_admissions")
    .select(
      "id, admission_number, admitted_at, status, condition:clinical_condition, expected_discharge_date, current_ward_id, edoshmis_patients(id, first_name, middle_name, last_name, sex, date_of_birth, dob_estimated, hospital_number), edoshmis_beds!edoshmis_admissions_current_bed_id_fkey(bed_number), edoshmis_wards!edoshmis_admissions_current_ward_id_fkey(name), consultant:edoshmis_staff!edoshmis_admissions_responsible_consultant_id_fkey(full_name), edoshmis_diagnoses(description, rank, status)",
    )
    .eq("facility_id", s.facility.id)
    .in("status", filter === "discharging" ? ["discharge_in_progress"] : ["active", "discharge_in_progress"])
    .order("admitted_at");
  if (ward) q = q.eq("current_ward_id", ward);
  else if (!allWards) q = q.in("current_ward_id", s.wardIds.length ? s.wardIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data } = await q;
  let rows = (data ?? []) as unknown as Row[];

  // Open escalations per admission, for the flag on the row.
  const ids = rows.map((r) => r.id);
  const { data: esc } = ids.length
    ? await supabase.from("edoshmis_escalations").select("admission_id, level").in("admission_id", ids).neq("status", "resolved")
    : { data: [] };
  const escBy = new Map<string, string>();
  for (const e of esc ?? []) {
    const prev = escBy.get(e.admission_id);
    if (!prev || (e.level === "high" && prev !== "high")) escBy.set(e.admission_id, e.level);
  }
  if (filter === "escalations") rows = rows.filter((r) => escBy.has(r.id));

  const primary = (r: Row) => r.edoshmis_diagnoses.find((d) => d.rank === "primary" && d.status === "active")?.description ?? "—";

  return (
    <>
      <PageHeader title="Inpatient census" description={`${rows.length} patient${rows.length === 1 ? "" : "s"}${ward ? " on this ward" : allWards ? " in the facility" : " on your wards"}`} />

      <div className="mb-4 flex flex-wrap gap-2">
        <Chip href="/ipd" on={!ward && !filter}>
          {allWards ? "All wards" : "My wards"}
        </Chip>
        {visibleWards.map((w) => (
          <Chip key={w.id} href={`/ipd?ward=${w.id}`} on={ward === w.id}>
            {w.name}
          </Chip>
        ))}
        <Chip href="/ipd?filter=escalations" on={filter === "escalations"}>
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Escalations
        </Chip>
        <Chip href="/ipd?filter=discharging" on={filter === "discharging"}>
          Discharging
        </Chip>
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={BedDouble} title="No inpatients here">
            {!allWards && s.wardIds.length === 0 ? "You are not assigned to any ward yet. Ask your ward manager or administrator." : null}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => {
              const p = r.edoshmis_patients;
              const e = escBy.get(r.id);
              const overdue = r.expected_discharge_date && r.expected_discharge_date < new Date().toISOString().slice(0, 10);
              return (
                <li key={r.id}>
                  <Link href={`/ipd/admissions/${r.id}`} className="grid grid-cols-[56px_1fr] items-center gap-3 px-4 py-3 hover:bg-surface-sunk/70 sm:grid-cols-[64px_1.4fr_1.2fr_1fr_auto] sm:px-5">
                    <span className="tnum flex h-12 flex-col items-center justify-center rounded-lg bg-brand-tint text-brand-darker">
                      <span className="text-base leading-none font-semibold">{r.edoshmis_beds?.bed_number ?? "—"}</span>
                      <span className="mt-1 max-w-[56px] truncate text-[10px] text-ink-faint">{r.edoshmis_wards?.name}</span>
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{fullName(p)}</span>
                      <span className="tnum block text-xs text-ink-faint">
                        {p.hospital_number} · {ageOf(p.date_of_birth, p.dob_estimated)} · {titleCase(p.sex)}
                      </span>
                      <span className="mt-1 block truncate text-xs text-ink-soft sm:hidden">{primary(r)}</span>
                    </span>
                    <span className="hidden min-w-0 text-sm text-ink-soft sm:block">
                      <span className="block truncate">{primary(r)}</span>
                      <span className="block truncate text-xs text-ink-faint">{r.consultant?.full_name ?? "No consultant set"}</span>
                    </span>
                    <span className="tnum hidden text-xs text-ink-soft sm:block">
                      Day {lengthOfStay(r.admitted_at)} · since {fmtDate(r.admitted_at)}
                      {r.expected_discharge_date && <span className={cn("block", overdue ? "text-attention-ink" : "text-ink-faint")}>EDD {fmtDate(r.expected_discharge_date)}</span>}
                    </span>
                    <span className="col-span-2 flex flex-wrap justify-start gap-1 sm:col-span-1 sm:justify-end">
                      {e && (
                        <Badge tone={e === "high" ? "critical" : "attention"}>
                          <AlertTriangle className="h-3 w-3" aria-hidden="true" /> EWS {e}
                        </Badge>
                      )}
                      {r.status === "discharge_in_progress" && <Badge tone="info">Discharging</Badge>}
                      {r.condition && <Badge tone={["critical", "deteriorating"].includes(r.condition) ? "critical" : r.condition === "serious" ? "attention" : "neutral"}>{r.condition}</Badge>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}

function Chip({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex h-8 items-center gap-1 rounded-full border px-3 text-xs font-medium transition-colors",
        on ? "border-brand bg-brand text-white" : "border-line-strong bg-surface text-ink-soft hover:border-brand/50 hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}
