import type { Metadata } from "next";
import Link from "next/link";
import { Wallet } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui/primitives";
import { can, requireStaff } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, fullName, ksh, titleCase } from "@/lib/format";

export const metadata: Metadata = { title: "Billing" };

/** Open inpatient bills with what each owes, largest first. */
export default async function BillingPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const s = await requireStaff();
  if (!can(s, "billing.read")) return <EmptyState icon={Wallet} title="Your role does not include billing." />;
  const { show } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase
    .from("edoshmis_account_balances")
    .select("account_id, admission_id, status, charges, paid, balance, patient_id")
    .eq("facility_id", s.facility.id)
    .eq("status", show === "closed" ? "closed" : "open")
    .order("balance", { ascending: false })
    .limit(200);
  const rows = data ?? [];
  const ids = rows.map((r) => r.account_id);
  const { data: accts } = ids.length
    ? await supabase
        .from("edoshmis_billing_accounts")
        .select("id, account_number, payer_category, opened_at, edoshmis_patients(first_name, middle_name, last_name, hospital_number), edoshmis_admissions(status, admission_number)")
        .in("id", ids)
    : { data: [] };
  const byId = new Map((accts ?? []).map((a) => [a.id as string, a as unknown as { account_number: string; payer_category: string; opened_at: string; edoshmis_patients: { first_name: string; middle_name: string | null; last_name: string; hospital_number: string }; edoshmis_admissions: { status: string; admission_number: string } | null }]));
  const owed = rows.reduce((n, r) => n + Math.max(0, Number(r.balance)), 0);

  return (
    <>
      <PageHeader title="Billing" description="Running inpatient bills." />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={show === "closed" ? "Closed bills" : "Open bills"} value={rows.length} />
        <Stat label="Owed on these" value={ksh(owed)} tone={owed > 0 ? "attention" : "neutral"} />
      </div>
      <div className="mb-3 flex gap-2 text-sm">
        <Link href="/billing" className={!show ? "font-semibold text-brand" : "text-ink-soft"}>
          Open
        </Link>
        <span className="text-ink-faint">·</span>
        <Link href="/billing?show=closed" className={show === "closed" ? "font-semibold text-brand" : "text-ink-soft"}>
          Closed
        </Link>
      </div>
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={Wallet} title="No bills" />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => {
              const a = byId.get(r.account_id);
              return (
                <li key={r.account_id}>
                  <Link href={`/billing/${r.account_id}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-surface-sunk sm:px-5">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{a ? fullName(a.edoshmis_patients) : "—"}</span>
                      <span className="tnum block text-xs text-ink-faint">
                        {a?.account_number} · {a?.edoshmis_patients.hospital_number} · opened {fmtDate(a?.opened_at)} · {titleCase(a?.payer_category)}
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      {a?.edoshmis_admissions && <Badge tone={a.edoshmis_admissions.status === "active" ? "brand" : a.edoshmis_admissions.status === "discharge_in_progress" ? "info" : "neutral"}>{titleCase(a.edoshmis_admissions.status)}</Badge>}
                      <span className="tnum text-right text-sm">
                        <span className={Number(r.balance) > 0 ? "font-semibold text-attention-ink" : "text-positive-ink"}>{ksh(r.balance)}</span>
                        <span className="block text-xs text-ink-faint">of {ksh(r.charges)}</span>
                      </span>
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
