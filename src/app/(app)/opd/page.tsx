import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Stethoscope } from "lucide-react";
import { EmptyState, PageHeader, buttonClass } from "@/components/ui/primitives";
import { QueueBoard } from "@/components/opd/queue-board";
import { can, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Outpatients" };

export default async function OpdPage() {
  const s = await requireStaff();
  if (!can(s, "opd.read")) return <EmptyState icon={Stethoscope} title="Your role does not include outpatients." />;
  return (
    <>
      <PageHeader
        title="Outpatient queue"
        description="Today's open visits, from check-in to the pharmacy and the cash office."
        actions={
          <Link href="/opd/appointments" className={buttonClass("secondary")}>
            <CalendarDays className="h-4 w-4" aria-hidden="true" /> Appointments
          </Link>
        }
      />
      <QueueBoard s={s} kind="opd" />
    </>
  );
}
