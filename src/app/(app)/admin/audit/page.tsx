import type { Metadata } from "next";
import Link from "next/link";
import { Eye, FileClock, LogIn } from "lucide-react";
import { Card, CardHeader, EmptyState, PageHeader, buttonClass, control } from "@/components/ui/primitives";
import { can, requireStaff } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Audit log" };

const PAGE = 100;

/**
 * Three logs, all append-only: every change (who, what, before and after),
 * every time a patient's record was opened (Data Protection Act), and every
 * sign-in. The administrator reads them; nobody edits them.
 */
export default async function AuditPage({ searchParams }: { searchParams: Promise<{ log?: string; q?: string; from?: string; to?: string; page?: string }> }) {
  const s = await requireStaff();
  if (!can(s, "audit.read")) return <EmptyState icon={FileClock} title="Your role does not include the audit log." />;
  const { log = "changes", q = "", from = "", to = "", page = "1" } = await searchParams;
  const p = Math.max(1, Number(page) || 1);
  const supabase = await createClient();
  const range = [(p - 1) * PAGE, p * PAGE - 1] as const;
  const org = s.staff.organizationId;

  let rows: { id: number; at: string; who: string | null; what: string; detail: string }[] = [];
  let total = 0;
  if (log === "access") {
    let qq = supabase.from("edoshmis_access_logs").select("id, created_at, staff_id, patient_id, context", { count: "exact" }).eq("organization_id", org);
    if (from) qq = qq.gte("created_at", `${from}T00:00:00+03:00`);
    if (to) qq = qq.lte("created_at", `${to}T23:59:59+03:00`);
    const { data, count } = await qq.order("created_at", { ascending: false }).range(...range);
    total = count ?? 0;
    const ids = [...new Set((data ?? []).map((r) => r.patient_id))];
    const { data: pts } = ids.length ? await supabase.from("edoshmis_patients").select("id, hospital_number, first_name, last_name").in("id", ids) : { data: [] };
    const pn = new Map((pts ?? []).map((x) => [x.id, `${x.first_name} ${x.last_name} (${x.hospital_number})`]));
    rows = (data ?? []).map((r) => ({ id: r.id, at: r.created_at, who: r.staff_id, what: `Opened ${titleCase(r.context)}`, detail: pn.get(r.patient_id) ?? r.patient_id }));
  } else if (log === "logins") {
    const { data, count } = await supabase.from("edoshmis_login_events").select("id, created_at, user_id, user_agent", { count: "exact" }).eq("organization_id", org).order("created_at", { ascending: false }).range(...range);
    total = count ?? 0;
    const ids = [...new Set((data ?? []).map((r) => r.user_id))];
    const { data: st } = ids.length ? await supabase.from("edoshmis_staff").select("id, user_id").eq("organization_id", org).in("user_id", ids) : { data: [] };
    const byUser = new Map((st ?? []).map((x) => [x.user_id, x.id]));
    rows = (data ?? []).map((r) => ({ id: r.id, at: r.created_at, who: byUser.get(r.user_id) ?? null, what: "Signed in", detail: (r.user_agent ?? "").slice(0, 90) }));
  } else {
    let qq = supabase.from("edoshmis_audit_logs").select("id, created_at, actor_staff_id, action, entity_type, entity_id, reason", { count: "exact" }).eq("organization_id", org);
    if (q) qq = qq.ilike("action", `%${q.replace(/[%,()]/g, "")}%`);
    if (from) qq = qq.gte("created_at", `${from}T00:00:00+03:00`);
    if (to) qq = qq.lte("created_at", `${to}T23:59:59+03:00`);
    const { data, count } = await qq.order("created_at", { ascending: false }).range(...range);
    total = count ?? 0;
    rows = (data ?? []).map((r) => ({ id: r.id, at: r.created_at, who: r.actor_staff_id, what: r.action, detail: `${titleCase(r.entity_type)}${r.reason ? ` — ${r.reason}` : ""}` }));
  }
  const staffIds = [...new Set(rows.map((r) => r.who).filter(Boolean))] as string[];
  const { data: names } = staffIds.length ? await supabase.from("edoshmis_staff").select("id, full_name").in("id", staffIds) : { data: [] };
  const nameOf = new Map((names ?? []).map((n) => [n.id, n.full_name]));
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const link = (o: Record<string, string>) => `/admin/audit?${new URLSearchParams({ log, ...(q && { q }), ...(from && { from }), ...(to && { to }), ...o })}`;

  return (
    <>
      <PageHeader title="Audit log" description="Append-only records of changes, record access and sign-ins." />
      <div className="mb-4 flex flex-wrap gap-2">
        {[
          ["changes", "Changes", FileClock],
          ["access", "Record access", Eye],
          ["logins", "Sign-ins", LogIn],
        ].map(([k, l, I]) => {
          const Icon = I as typeof FileClock;
          return (
            <Link key={k as string} href={`/admin/audit?log=${k}`} className={buttonClass(log === k ? "primary" : "secondary", "sm")}>
              <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {l as string}
            </Link>
          );
        })}
      </div>
      <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_160px_160px_auto]">
        <input type="hidden" name="log" value={log} />
        <input name="q" defaultValue={q} placeholder={log === "changes" ? "Action contains… e.g. discharge, billing, medication" : "—"} disabled={log !== "changes"} className={cn(control, "h-10")} />
        <input name="from" type="date" defaultValue={from} className={cn(control, "h-10")} aria-label="From" />
        <input name="to" type="date" defaultValue={to} className={cn(control, "h-10")} aria-label="To" />
        <button className={buttonClass("secondary")}>Filter</button>
      </form>
      <Card>
        <CardHeader title={`${total.toLocaleString("en-KE")} entries`} description={`Page ${p} of ${pages}`} />
        {rows.length === 0 ? (
          <EmptyState icon={FileClock} title="Nothing for these filters" />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 px-5 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{r.what}</span>
                  <span className="block truncate text-xs text-ink-faint">{r.detail}</span>
                </span>
                <span className="text-right text-xs text-ink-soft">
                  {(r.who && nameOf.get(r.who)) || "System"}
                  <span className="tnum block text-ink-faint">{fmtDateTime(r.at)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {pages > 1 && (
          <div className="flex justify-between border-t border-line px-5 py-3 text-sm">
            {p > 1 ? <Link href={link({ page: String(p - 1) })} className="text-brand">Newer</Link> : <span />}
            {p < pages ? <Link href={link({ page: String(p + 1) })} className="text-brand">Older</Link> : <span />}
          </div>
        )}
      </Card>
    </>
  );
}
