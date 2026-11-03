import type { Metadata } from "next";
import { Siren } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui/primitives";
import { QueueBoard, TRIAGE } from "@/components/opd/queue-board";
import { can, requireStaff } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Emergency" };

export default async function EmergencyPage() {
  const s = await requireStaff();
  if (!can(s, "opd.read")) return <EmptyState icon={Siren} title="Your role does not include the emergency department." />;
  return (
    <>
      <PageHeader title="Emergency department" description="Arrivals by triage category. Check a patient in as Emergency from their record." />
      <div className="mb-4 flex flex-wrap gap-2">
        {Object.values(TRIAGE).map((t) => (
          <span key={t.label} className={cn("rounded-md px-2 py-0.5 text-xs font-medium", t.tone)}>
            {t.label}
          </span>
        ))}
      </div>
      <QueueBoard s={s} kind="emergency" />
    </>
  );
}
