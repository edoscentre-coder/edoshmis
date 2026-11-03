import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Scissors } from "lucide-react";
import { Badge, Card, CardHeader, Disclosure, EmptyState, Field, Input, PageHeader, Select, buttonClass, control } from "@/components/ui/primitives";
import { ActionForm } from "@/components/ui/action-form";
import { can, requireStaff } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, fmtTime, fullName, ksh, titleCase, todayNairobi } from "@/lib/format";
import { cn } from "@/lib/utils";
import { saveTheatre, scheduleSurgery } from "./actions";

export const metadata: Metadata = { title: "Theatre" };

const TONE: Record<string, "attention" | "info" | "brand" | "positive" | "neutral"> = {
  requested: "attention",
  scheduled: "info",
  in_theatre: "brand",
  recovery: "brand",
  completed: "positive",
  cancelled: "neutral",
};

interface Row {
  id: string;
  surgery_number: string;
  procedure_name: string;
  laterality: string | null;
  urgency: string;
  status: string;
  scheduled_start: string | null;
  duration_minutes: number | null;
  theatre_id: string | null;
  edoshmis_patients: { first_name: string; middle_name: string | null; last_name: string; hospital_number: string };
  surgeon: { full_name: string } | null;
}

/** The day's theatre list by theatre, and the cases still waiting for a slot. */
export default async function TheatreList({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const s = await requireStaff();
  if (!can(s, "theatre.read", "theatre.schedule", "theatre.configure")) return <EmptyState icon={Scissors} title="Your role does not include theatre." />;
  const { day = todayNairobi() } = await searchParams;
  const supabase = await createClient();
  const cols = "id, surgery_number, procedure_name, laterality, urgency, status, scheduled_start, duration_minutes, theatre_id, edoshmis_patients(first_name, middle_name, last_name, hospital_number), surgeon:edoshmis_staff!edoshmis_surgeries_surgeon_id_fkey(full_name)";
  const [{ data: theatres }, { data: booked }, { data: waiting }, { data: staff }, { data: stores }, { data: tariffs }] = await Promise.all([
    supabase.from("edoshmis_theatres").select("id, name, code, store_id, tariff_id").eq("facility_id", s.facility.id).eq("is_active", true).order("code"),
    supabase.from("edoshmis_surgeries").select(cols).eq("facility_id", s.facility.id).gte("scheduled_start", `${day}T00:00:00+03:00`).lte("scheduled_start", `${day}T23:59:59+03:00`).order("scheduled_start"),
    supabase.from("edoshmis_surgeries").select(cols).eq("facility_id", s.facility.id).eq("status", "requested").order("requested_at"),
    supabase.from("edoshmis_staff").select("id, full_name, designation").eq("organization_id", s.staff.organizationId).eq("status", "active").order("full_name"),
    can(s, "theatre.configure") ? supabase.from("edoshmis_stores").select("id, name").eq("facility_id", s.facility.id).order("name") : Promise.resolve({ data: null }),
    can(s, "theatre.configure") ? supabase.from("edoshmis_tariffs").select("id, name, price").eq("facility_id", s.facility.id).eq("category", "theatre").eq("is_active", true) : Promise.resolve({ data: null }),
  ]);
  const list = (booked ?? []) as unknown as Row[];
  const queue = (waiting ?? []) as unknown as Row[];
  const byDesignation = (d: string[]) => (staff ?? []).filter((m) => d.includes(m.designation));

  const caseRow = (r: Row) => (
    <li key={r.id}>
      <Link href={`/theatre/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-surface-sunk sm:px-5">
        <span className="min-w-0">
          <span className="block font-medium">
            {r.scheduled_start && <span className="tnum mr-2 text-ink-soft">{fmtTime(r.scheduled_start)}</span>}
            {r.procedure_name}
            {r.laterality && r.laterality !== "not_applicable" ? ` (${r.laterality})` : ""}
          </span>
          <span className="block text-xs text-ink-faint">
            {fullName(r.edoshmis_patients)} · {r.edoshmis_patients.hospital_number} · {r.surgeon?.full_name ?? "Surgeon not set"}
            {r.duration_minutes ? ` · ${r.duration_minutes} min` : ""}
          </span>
        </span>
        <span className="flex gap-1">
          {r.urgency !== "elective" && <Badge tone="critical">{titleCase(r.urgency)}</Badge>}
          <Badge tone={TONE[r.status]}>{titleCase(r.status)}</Badge>
        </span>
      </Link>
    </li>
  );

  return (
    <>
      <PageHeader
        title="Theatre"
        description={`Theatre list for ${fmtDate(`${day}T12:00:00+03:00`)}`}
        actions={
          <form className="flex gap-2">
            <input name="day" type="date" defaultValue={day} className={cn(control, "h-9 w-auto")} aria-label="Day" />
            <button className={buttonClass("secondary", "sm", "h-9")}>Show</button>
          </form>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[1fr_400px]">
        <div className="flex flex-col gap-5">
          {(theatres ?? []).length === 0 && (
            <Card>
              <EmptyState icon={Scissors} title="No theatres set up">
                {can(s, "theatre.configure") ? "Add one with the form." : "Your administrator sets up theatres."}
              </EmptyState>
            </Card>
          )}
          {(theatres ?? []).map((t) => {
            const rows = list.filter((r) => r.theatre_id === t.id);
            return (
              <Card key={t.id}>
                <CardHeader title={`${t.name} · ${t.code}`} icon={Scissors} description={`${rows.filter((r) => r.status !== "cancelled").length} case(s)`} />
                {rows.length ? <ul className="divide-y divide-line">{rows.map(caseRow)}</ul> : <p className="px-5 py-4 text-sm text-ink-faint">Nothing booked.</p>}
              </Card>
            );
          })}
        </div>
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title={`Waiting for a slot · ${queue.length}`} description="Requested from the wards and clinics" />
            {queue.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-faint">None.</p>
            ) : (
              <ul className="divide-y divide-line">
                {queue.map((r) => (
                  <li key={r.id} className="px-4 py-3 sm:px-5">
                    <ul>{caseRow(r)}</ul>
                    {can(s, "theatre.schedule") && (theatres ?? []).length > 0 && (
                      <Disclosure label="Schedule" variant="primary" className="mt-1">
                        <ActionForm action={scheduleSurgery.bind(null, r.id)} submitLabel="Book">
                          <div className="grid grid-cols-2 gap-3">
                            <Field label="Theatre" required>
                              <Select name="theatre_id" required defaultValue={theatres![0].id}>
                                {theatres!.map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.name}
                                  </option>
                                ))}
                              </Select>
                            </Field>
                            <Field label="Minutes">
                              <Input name="duration_minutes" type="number" min={10} defaultValue={60} />
                            </Field>
                          </div>
                          <Field label="Start" required>
                            <Input name="scheduled_start" type="datetime-local" required defaultValue={`${day}T08:00`} />
                          </Field>
                          <div className="grid grid-cols-2 gap-3">
                            {([["surgeon_id", "Surgeon", ["consultant", "medical_officer"]], ["assistant_id", "Assistant", ["consultant", "medical_officer", "clinical_officer", "intern"]], ["anaesthetist_id", "Anaesthetist", ["anaesthetist", "consultant", "clinical_officer"]], ["scrub_nurse_id", "Scrub nurse", ["theatre_staff", "nurse", "nursing_officer"]]] as const).map(([n, l, d]) => (
                              <Field key={n} label={l}>
                                <Select name={n} defaultValue="">
                                  <option value="">—</option>
                                  {byDesignation([...d]).map((m) => (
                                    <option key={m.id} value={m.id}>
                                      {m.full_name}
                                    </option>
                                  ))}
                                </Select>
                              </Field>
                            ))}
                          </div>
                        </ActionForm>
                      </Disclosure>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {can(s, "theatre.configure") && (
            <Disclosure label="Add a theatre" icon={Plus}>
              <ActionForm action={saveTheatre} submitLabel="Add theatre">
                <div className="grid grid-cols-[1fr_96px] gap-3">
                  <Field label="Name" required>
                    <Input name="name" required placeholder="Main theatre 1" />
                  </Field>
                  <Field label="Code" required>
                    <Input name="code" required className="uppercase" placeholder="OT1" />
                  </Field>
                </div>
                <Field label="Store for consumables" hint="Set up under Stores">
                  <Select name="store_id" defaultValue="">
                    <option value="">—</option>
                    {stores?.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Theatre fee" hint="Charged once at sign-out">
                  <Select name="tariff_id" defaultValue="">
                    <option value="">Not charged</option>
                    {tariffs?.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name} · {ksh(x.price)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </ActionForm>
            </Disclosure>
          )}
        </div>
      </div>
    </>
  );
}
