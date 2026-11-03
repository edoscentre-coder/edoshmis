import { Wallet } from "lucide-react";
import { EmptyState } from "@/components/ui/primitives";
import { AccountView } from "@/components/billing/account-view";
import { createClient } from "@/lib/supabase/server";
import type { Ctx } from "../context";

export async function BillingTab({ ctx }: { ctx: Ctx }) {
  const supabase = await createClient();
  const { data } = await supabase.from("edoshmis_billing_accounts").select("id").eq("admission_id", ctx.admission.id).maybeSingle();
  if (!data) return <EmptyState icon={Wallet} title="No bill for this admission" />;
  return <AccountView s={ctx.s} accountId={data.id} admissionId={ctx.admission.id} />;
}
