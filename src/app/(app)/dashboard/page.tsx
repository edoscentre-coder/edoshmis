import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  BedDouble,
  ClipboardList,
  LogOut as Discharge,
  Pill,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { Badge, ButtonLink, Card, CardBody, CardHeader, PageHeader, Stat } from "@/components/ui/primitives";
import { AdmissionsTrend } from "@/components/charts/admissions-trend";
import { can, requireStaff } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, fullName, ksh, lengthOfStay, titleCase } from "@/lib/format";

export const metadata: Metadata = { title: "Dashboard" };

interface Dash {
  beds?: { total: number; available: number; occupied: number; reserved: number; cleaning: number; out_of_service: number };
  census?: number;
  admitted_today?: number;
  discharged_today?: number;
  pending_requests?: number;
  awaiting_bed?: number;
  discharges_in_progress?: number;
  expected_discharge_today?: number;
  open_escalations?: { high: number; medium: number; low: number };
  wards?: { id: string; name: string; code: string; type: string; total: number; occupied: number; available: number }[];
  alos_30d?: number | null;
  admissions_14d?: { day: string; admitted: number; discharged: number }[];
  orders_to_verify?: number;
  doses_overdue?: number;
  billing?: { open_accounts: number; outstanding: number; collected_today: number };
  patients_total?: number;
  registered_today?: number;
}

/**
 * The dashboard is the person's workspace, not one screen for everyone:
 * each block appears when their role covers it, and every number is a live
 * count from edoshmis_dashboard() that links to the list behind it.
 */
export default async function Dashboard() {
  const s = await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("edoshmis_dashboard", { p_facility: s.facility.id });
  const d = (data ?? {}) as Dash;

  // "My patients": admissions where I am on the care team.
  const { data: mine } = can(s, "ipd.read")
    ? await supabase
        .from("edoshmis_care_team")
        .select(
          "role, edoshmis_admissions!inner(id, admission_number, admitted_at, status, condition:clinical_condition, edoshmis_patients(first_name, middle_name, last_name), edoshmis_beds!edoshmis_admissions_current_bed_id_fkey(bed_number), edoshmis_wards!edoshmis_admissions_current_ward_id_fkey(name))",
        )
        .eq("staff_id", s.staff.id)
        .is("ended_at", null)
        .in("edoshmis_admissions.status", ["active", "discharge_in_progress"])
        .limit(12)
    : { data: null };

  const occ = d.beds && d.beds.total ? Math.round((d.beds.occupied / d.beds.total) * 100) : null;
  const esc = d.open_escalations;
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Africa/Nairobi" }).format(new Date()));
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <>
      <PageHeader
        eyebrow={`${s.facility.name} · ${fmtDate(new Date())}`}
        title={`${greet}, ${firstName(s.staff.fullName)}`}
        description={`${titleCase(s.staff.designation)} workspace`}
        actions={
          <>
            {can(s, "patients.register") && (
              <ButtonLink href="/patients/new">
                <UserPlus className="h-4 w-4" aria-hidden="true" />
                Register patient
              </ButtonLink>
            )}
            {can(s, "ipd.read", "admin.wards") && (
              <ButtonLink href="/ipd/beds" variant="secondary">
                <BedDouble className="h-4 w-4" aria-hidden="true" />
                Bed board
              </ButtonLink>
            )}
          </>
        }
      />

      {error && <p className="mb-4 rounded-lg bg-critical-soft px-3 py-2 text-sm text-critical-ink">The dashboard could not load: {error.message}</p>}

      {esc && esc.high + esc.medium > 0 && (
        <Link
          href="/ipd?filter=escalations"
          className="mb-5 flex items-center gap-3 rounded-xl border border-critical/30 bg-critical-soft px-4 py-3 text-sm text-critical-ink"
        >
          <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span>
            <strong>{esc.high + esc.medium} open early-warning escalation{esc.high + esc.medium === 1 ? "" : "s"}</strong>
            {esc.high > 0 && ` — ${esc.high} high`}. Review now.
          </span>
        </Link>
      )}

      {d.beds && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          <Stat label="Inpatients" value={d.census ?? 0} hint={`${d.admitted_today ?? 0} admitted today`} href="/ipd" icon={Activity} />
          <Stat
            label="Beds available"
            value={d.beds.available}
            hint={`of ${d.beds.total} · ${d.beds.cleaning} cleaning`}
            href="/ipd/beds"
            icon={BedDouble}
            tone={d.beds.total > 0 && d.beds.available === 0 ? "critical" : d.beds.available <= 2 && d.beds.total > 0 ? "attention" : "neutral"}
          />
          <Stat label="Occupancy" value={occ === null ? "—" : `${occ}%`} hint={`${d.beds.occupied} occupied · ${d.beds.out_of_service} out of service`} href="/ipd/beds" />
          <Stat
            label="Admission requests"
            value={(d.pending_requests ?? 0) + (d.awaiting_bed ?? 0)}
            hint={`${d.pending_requests ?? 0} to decide · ${d.awaiting_bed ?? 0} need a bed`}
            href="/ipd/admissions"
            icon={ClipboardList}
            tone={(d.awaiting_bed ?? 0) > 0 ? "attention" : "neutral"}
          />
          <Stat
            label="Discharges"
            value={d.discharges_in_progress ?? 0}
            hint={`in progress · ${d.discharged_today ?? 0} done today · ${d.expected_discharge_today ?? 0} expected`}
            href="/ipd?filter=discharging"
            icon={Discharge}
          />
          <Stat label="Average stay" value={d.alos_30d == null ? "—" : `${d.alos_30d} d`} hint="Discharges, last 30 days" />
        </div>
      )}

      {(d.orders_to_verify !== undefined || d.billing || d.patients_total !== undefined) && (
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          {d.orders_to_verify !== undefined && can(s, "meds.verify") && (
            <Stat label="Prescriptions to verify" value={d.orders_to_verify} href="/pharmacy" icon={Pill} tone={d.orders_to_verify > 0 ? "attention" : "neutral"} />
          )}
          {d.doses_overdue !== undefined && (
            <Stat
              label="Doses overdue"
              value={d.doses_overdue}
              hint="Scheduled more than an hour ago"
              href="/ipd"
              tone={d.doses_overdue > 0 ? "attention" : "neutral"}
              icon={Pill}
            />
          )}
          {d.billing && (
            <>
              <Stat label="Outstanding bills" value={ksh(d.billing.outstanding)} hint={`${d.billing.open_accounts} open accounts`} href="/billing" icon={Wallet} />
              <Stat label="Collected today" value={ksh(d.billing.collected_today)} href="/billing" />
            </>
          )}
          {d.patients_total !== undefined && (
            <Stat label="Patients registered" value={d.patients_total.toLocaleString("en-KE")} hint={`${d.registered_today ?? 0} today`} href="/patients" icon={Users} />
          )}
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        {d.admissions_14d && (
          <Card>
            <CardHeader title="Admissions and discharges" description="Per day, last 14 days" />
            <CardBody>
              <AdmissionsTrend days={d.admissions_14d} />
            </CardBody>
          </Card>
        )}

        {d.wards && (
          <Card>
            <CardHeader title="Ward occupancy" actions={<Link href="/ipd/beds" className="text-xs font-medium text-brand hover:underline">Bed board</Link>} />
            <CardBody>
              {d.wards.length === 0 ? (
                <p className="py-6 text-center text-sm text-ink-faint">
                  No wards yet.{" "}
                  {can(s, "admin.wards") && (
                    <Link href="/admin/facility" className="text-brand hover:underline">
                      Set them up
                    </Link>
                  )}
                </p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {d.wards.map((w) => {
                    const pct = w.total ? Math.round((w.occupied / w.total) * 100) : 0;
                    return (
                      <li key={w.id}>
                        <Link href={`/ipd/beds?ward=${w.id}`} className="block rounded-lg px-1 py-0.5 hover:bg-surface-sunk">
                          <div className="flex items-baseline justify-between gap-2 text-sm">
                            <span className="truncate font-medium text-ink">{w.name}</span>
                            <span className="tnum shrink-0 text-xs text-ink-soft">
                              {w.occupied}/{w.total} · {w.available} free
                            </span>
                          </div>
                          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-sunk" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${w.name} occupancy`}>
                            <div
                              className={pct >= 95 ? "h-full rounded-full bg-critical" : pct >= 85 ? "h-full rounded-full bg-attention" : "h-full rounded-full bg-brand"}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
          </Card>
        )}
      </div>

      {mine && mine.length > 0 && (
        <Card className="mt-6">
          <CardHeader title={`My patients · ${mine.length}`} description="Admissions where you are on the care team" />
          <ul className="divide-y divide-line">
            {(mine as unknown as MyRow[]).map((m) => {
              const a = m.edoshmis_admissions;
              return (
                <li key={a.id}>
                  <Link href={`/ipd/admissions/${a.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 hover:bg-surface-sunk">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{a.edoshmis_patients ? fullName(a.edoshmis_patients) : "—"}</span>
                      <span className="block text-xs text-ink-faint">
                        {a.edoshmis_wards?.name ?? "—"} · bed {a.edoshmis_beds?.bed_number ?? "—"} · day {lengthOfStay(a.admitted_at)}
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      {a.status === "discharge_in_progress" && <Badge tone="info">Discharging</Badge>}
                      {a.condition && <Badge tone={a.condition === "critical" || a.condition === "deteriorating" ? "critical" : a.condition === "serious" ? "attention" : "neutral"}>{a.condition}</Badge>}
                      <Badge>{titleCase(m.role)}</Badge>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}

/** "Dr Wanjiru Kamau" → "Wanjiru": the title is dropped, the first name kept. */
const firstName = (n: string) => n.replace(/^(dr|nurse|mr|mrs|ms|prof)\.?\s+/i, "").split(/\s+/)[0] ?? n;

interface MyRow {
  role: string;
  edoshmis_admissions: {
    id: string;
    admission_number: string;
    admitted_at: string;
    status: string;
    condition: string | null;
    edoshmis_patients: { first_name: string; middle_name: string | null; last_name: string } | null;
    edoshmis_beds: { bed_number: string } | null;
    edoshmis_wards: { name: string } | null;
  };
}
