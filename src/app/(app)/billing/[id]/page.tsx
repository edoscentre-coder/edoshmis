import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Wallet } from "lucide-react";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { EmptyState, PageHeader } from "@/components/ui/primitives";
import { AccountView } from "@/components/billing/account-view";
import { PrintButton } from "@/components/ui/print-button";
import { can, requireStaff } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fullName } from "@/lib/format";

export const metadata: Metadata = { title: "Bill" };

export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireStaff();
  if (!can(s, "billing.read")) return <EmptyState icon={Wallet} title="Your role does not include billing." />;
  const { id } = await params;
  const supabase = await createClient();
  const { data: a } = await supabase
    .from("edoshmis_billing_accounts")
    .select("id, admission_id, patient_id, edoshmis_patients(first_name, middle_name, last_name, hospital_number)")
    .eq("id", id)
    .maybeSingle();
  if (!a) notFound();
  const p = a.edoshmis_patients as unknown as { first_name: string; middle_name: string | null; last_name: string; hospital_number: string };
  await supabase.rpc("edoshmis_log_access", { p_patient: a.patient_id, p_facility: s.facility.id, p_context: "bill" });

  return (
    <>
      <Breadcrumbs trail={[{ label: "Billing", href: "/billing" }, { label: fullName(p) }]} />
      <PageHeader
        title={fullName(p)}
        eyebrow={<span className="tnum">{p.hospital_number}</span>}
        actions={
          <>
            <PrintButton label="Print statement" />
            {a.admission_id && can(s, "ipd.read") && (
              <Link href={`/ipd/admissions/${a.admission_id}`} className="text-sm font-medium text-brand hover:underline">
                Inpatient record
              </Link>
            )}
          </>
        }
      />
      <AccountView s={s} accountId={a.id} admissionId={a.admission_id} />
    </>
  );
}
