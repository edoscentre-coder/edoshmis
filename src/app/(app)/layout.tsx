import { AppShell, type Alert } from "@/components/shell/app-shell";
import { navFor } from "@/components/shell/nav";
import { can, requireStaff } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fullName } from "@/lib/format";
import { switchFacility } from "./shell-actions";

export const dynamic = "force-dynamic";

/**
 * The working shell. The alert list is what is waiting on this person, read
 * through their own permissions — a nurse sees escalations on her wards, a
 * pharmacist the orders to verify, a consultant the admissions to approve.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireStaff();
  const supabase = await createClient();
  const fac = s.facility.id;
  const alerts: Alert[] = [];
  const badges: Record<string, number> = {};

  const [esc, pending, approved, toVerify] = await Promise.all([
    can(s, "ipd.read")
      ? supabase
          .from("edoshmis_escalations")
          .select("id, level, reason, admission_id, created_at, edoshmis_patients(first_name, middle_name, last_name)")
          .eq("facility_id", fac)
          .neq("status", "resolved")
          .order("created_at", { ascending: false })
          .limit(15)
      : null,
    can(s, "ipd.approve_admission")
      ? supabase.from("edoshmis_admission_requests").select("id", { count: "exact", head: true }).eq("facility_id", fac).eq("status", "pending")
      : null,
    can(s, "ipd.allocate_bed")
      ? supabase.from("edoshmis_admission_requests").select("id", { count: "exact", head: true }).eq("facility_id", fac).eq("status", "approved")
      : null,
    can(s, "meds.verify")
      ? supabase.from("edoshmis_medication_orders").select("id", { count: "exact", head: true }).eq("facility_id", fac).eq("status", "prescribed")
      : null,
  ]);

  for (const e of (esc?.data ?? []) as unknown as {
    id: string;
    level: string;
    reason: string;
    admission_id: string;
    edoshmis_patients: { first_name: string; middle_name: string | null; last_name: string } | null;
  }[]) {
    alerts.push({
      id: `esc-${e.id}`,
      tone: e.level === "high" ? "critical" : e.level === "medium" ? "attention" : "info",
      title: `${e.edoshmis_patients ? fullName(e.edoshmis_patients) : "Patient"} — ${e.reason}`,
      detail: `${e.level} escalation, not yet resolved`,
      href: `/ipd/admissions/${e.admission_id}?tab=vitals`,
    });
  }
  if (pending?.count) {
    alerts.push({ id: "req", tone: "attention", title: `${pending.count} admission request(s) to decide`, detail: "Approve or reject", href: "/ipd/admissions" });
  }
  if (approved?.count) {
    alerts.push({ id: "bed", tone: "attention", title: `${approved.count} approved admission(s) waiting for a bed`, detail: "Allocate a bed", href: "/ipd/admissions" });
  }
  if (toVerify?.count) {
    alerts.push({ id: "rx", tone: "info", title: `${toVerify.count} prescription(s) to verify`, detail: "Pharmacy queue", href: "/pharmacy" });
    badges["/pharmacy"] = toVerify.count;
  }
  const queue = (pending?.count ?? 0) + (approved?.count ?? 0);
  if (queue) badges["/ipd/admissions"] = queue;
  const escCount = esc?.data?.length ?? 0;
  if (escCount) badges["/ipd"] = escCount;
  alerts.sort((a, b) => rank(a.tone) - rank(b.tone));

  return (
    <AppShell
      nav={navFor(s.perms, badges)}
      user={{ name: s.staff.fullName, designation: s.staff.designation }}
      organization={s.staff.organizationName}
      facility={s.facility}
      facilities={s.facilities}
      alerts={alerts}
      switchFacility={switchFacility}
    >
      {children}
    </AppShell>
  );
}

const rank = (t: Alert["tone"]) => (t === "critical" ? 0 : t === "attention" ? 1 : 2);
