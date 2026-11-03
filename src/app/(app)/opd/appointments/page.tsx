import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { Badge, Card, CardHeader, Disclosure, EmptyState, Field, Input, PageHeader, buttonClass, control } from "@/components/ui/primitives";
import { ActionButton, ActionForm } from "@/components/ui/action-form";
import { can, requireStaff } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, fmtTime, fullName, titleCase, todayNairobi } from "@/lib/format";
import { cn } from "@/lib/utils";
import { cancelAppointment, checkIn } from "../actions";

export const metadata: Metadata = { title: "Appointments" };

/** One day's appointments. Booking is done from the patient's record. */
export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const s = await requireStaff();
  if (!can(s, "opd.read")) return <EmptyState icon={CalendarDays} title="Your role does not include appointments." />;
  const { day = todayNairobi() } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase
    .from("edoshmis_appointments")
    .select("id, patient_id, scheduled_at, duration_minutes, reason, status, cancel_reason, encounter_id, edoshmis_patients(first_name, middle_name, last_name, hospital_number, phone), clinician:edoshmis_staff!edoshmis_appointments_clinician_id_fkey(full_name), edoshmis_departments(name)")
    .eq("facility_id", s.facility.id)
    .gte("scheduled_at", `${day}T00:00:00+03:00`)
    .lte("scheduled_at", `${day}T23:59:59+03:00`)
    .order("scheduled_at");
  const rows = (data ?? []) as unknown as {
    id: string; patient_id: string; scheduled_at: string; duration_minutes: number; reason: string | null; status: string; cancel_reason: string | null; encounter_id: string | null;
    edoshmis_patients: { first_name: string; middle_name: string | null; last_name: string; hospital_number: string; phone: string | null };
    clinician: { full_name: string } | null; edoshmis_departments: { name: string } | null;
  }[];
  const register = can(s, "opd.register");
  const shift = (d: number) => new Date(new Date(`${day}T12:00:00+03:00`).getTime() + d * 86_400_000).toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title="Appointments" description={fmtDate(`${day}T12:00:00+03:00`)} />
      <form className="mb-4 flex flex-wrap items-center gap-2">
        <Link href={`/opd/appointments?day=${shift(-1)}`} className={buttonClass("secondary", "sm")}>
          ← Previous
        </Link>
        <input name="day" type="date" defaultValue={day} className={cn(control, "h-8 w-auto")} aria-label="Day" />
        <button className={buttonClass("secondary", "sm")}>Go</button>
        <Link href={`/opd/appointments?day=${shift(1)}`} className={buttonClass("secondary", "sm")}>
          Next →
        </Link>
      </form>
      <Card>
        <CardHeader title={`${rows.filter((r) => r.status !== "cancelled").length} booked`} icon={CalendarDays} />
        {rows.length === 0 ? (
          <EmptyState icon={CalendarDays} title="No appointments this day">
            Book from a patient&apos;s record.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
                <span className="flex min-w-0 items-center gap-3">
                  <span className="tnum w-12 shrink-0 text-sm font-semibold">{fmtTime(a.scheduled_at)}</span>
                  <span className="min-w-0">
                    <Link href={`/patients/${a.patient_id}`} className="block truncate font-medium hover:text-brand">
                      {fullName(a.edoshmis_patients)}
                    </Link>
                    <span className="block text-xs text-ink-faint">
                      {a.edoshmis_patients.hospital_number} · {[a.edoshmis_departments?.name, a.clinician?.full_name, a.reason].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={a.status === "booked" ? "brand" : a.status === "checked_in" || a.status === "completed" ? "positive" : "neutral"}>{titleCase(a.status)}</Badge>
                  {a.encounter_id && (
                    <Link href={`/visits/${a.encounter_id}`} className="text-xs font-medium text-brand hover:underline">
                      Visit
                    </Link>
                  )}
                  {register && a.status === "booked" && (
                    <>
                      <ActionButton action={checkIn.bind(null, a.patient_id)} hidden={{ appointment_id: a.id, kind: "opd", chief_complaint: a.reason ?? "" }} variant="primary">
                        Check in
                      </ActionButton>
                      <ActionButton action={cancelAppointment.bind(null, a.id, "no_show")} variant="ghost" confirm="Mark as no-show?">
                        No-show
                      </ActionButton>
                      <Disclosure label="Cancel" variant="ghost">
                        <ActionForm action={cancelAppointment.bind(null, a.id, "cancelled")} submitLabel="Cancel appointment" submitVariant="danger">
                          <Field label="Reason" required>
                            <Input name="reason" required />
                          </Field>
                        </ActionForm>
                      </Disclosure>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
