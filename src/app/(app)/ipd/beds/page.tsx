import type { Metadata } from "next";
import Link from "next/link";
import { BedDouble, ShieldAlert, Sparkles, Wrench } from "lucide-react";
import { Card, CardHeader, Disclosure, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
import { ActionButton, ActionForm } from "@/components/ui/action-form";
import { can, requireStaff } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, fmtDateTime, fullName, lengthOfStay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { releaseReservation, reserveBed, setBedStatus } from "../actions";

export const metadata: Metadata = { title: "Bed board" };

const STATE: Record<string, { label: string; tile: string; dot: string }> = {
  available: { label: "Available", tile: "border-positive/40 bg-positive-soft/50", dot: "bg-positive" },
  occupied: { label: "Occupied", tile: "border-brand/30 bg-brand-tint", dot: "bg-brand" },
  reserved: { label: "Reserved", tile: "border-info/40 bg-info-soft/60", dot: "bg-info" },
  cleaning: { label: "Cleaning", tile: "border-attention/40 bg-attention-soft/60", dot: "bg-attention" },
  maintenance: { label: "Maintenance", tile: "border-line-strong bg-surface-sunk", dot: "bg-ink-faint" },
  blocked: { label: "Blocked", tile: "border-line-strong bg-surface-sunk", dot: "bg-ink-soft" },
};

interface Bed {
  id: string;
  bed_number: string;
  room: string | null;
  category: string;
  sex_restriction: string;
  is_isolation: boolean;
  status: string;
  status_note: string | null;
  status_changed_at: string;
  ward_id: string;
  current: {
    id: string;
    admitted_at: string;
    expected_discharge_date: string | null;
    status: string;
    edoshmis_patients: { first_name: string; middle_name: string | null; last_name: string; sex: string } | null;
  } | null;
  edoshmis_bed_reservations: { id: string; status: string; reserved_until: string; note: string | null }[];
}

/**
 * Every bed, by ward, in its live state. Available → occupied happens only
 * through admit or transfer; occupied → cleaning only through transfer or
 * discharge. From here staff move beds between cleaning, available,
 * maintenance and blocked, and hold a free bed for an incoming patient.
 */
export default async function BedBoard({ searchParams }: { searchParams: Promise<{ ward?: string }> }) {
  const s = await requireStaff();
  if (!can(s, "ipd.read", "admin.wards")) return <EmptyState icon={BedDouble} title="Your role does not include the bed board." />;
  const { ward } = await searchParams;
  const supabase = await createClient();
  await supabase.rpc("edoshmis_expire_reservations", { p_facility: s.facility.id });

  const { data: wards } = await supabase
    .from("edoshmis_wards")
    .select("id, name, code, ward_type, status, sex_restriction")
    .eq("facility_id", s.facility.id)
    .order("sort_order")
    .order("name");
  let bq = supabase
    .from("edoshmis_beds")
    .select(
      "id, bed_number, room, category, sex_restriction, is_isolation, status, status_note, status_changed_at, ward_id, current:edoshmis_admissions!edoshmis_beds_current_admission_fk(id, admitted_at, expected_discharge_date, status, edoshmis_patients(first_name, middle_name, last_name, sex)), edoshmis_bed_reservations(id, status, reserved_until, note)",
    )
    .eq("facility_id", s.facility.id)
    .eq("is_active", true)
    .order("bed_number");
  if (ward) bq = bq.eq("ward_id", ward);
  const { data: beds } = await bq;
  const all = (beds ?? []) as unknown as Bed[];
  const shown = (wards ?? []).filter((w) => !ward || w.id === ward);
  const counts = Object.fromEntries(Object.keys(STATE).map((k) => [k, all.filter((b) => b.status === k).length]));
  const manage = can(s, "ipd.manage_beds");
  const allocate = can(s, "ipd.allocate_bed");

  return (
    <>
      <PageHeader
        title="Bed board"
        description="Live bed state across the facility."
        actions={
          can(s, "admin.wards") && (
            <Link href="/admin/facility" className="text-sm font-medium text-brand hover:underline">
              Set up wards and beds
            </Link>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-soft">
        {Object.entries(STATE).map(([k, v]) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className={cn("h-2.5 w-2.5 rounded-full", v.dot)} aria-hidden="true" />
            {v.label} <span className="tnum font-semibold text-ink">{counts[k]}</span>
          </span>
        ))}
        {(wards?.length ?? 0) > 1 && (
          <form className="ml-auto">
            <select name="ward" defaultValue={ward ?? ""} className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-sm" aria-label="Ward">
              <option value="">All wards</option>
              {wards!.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <button className="ml-1 h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm">Show</button>
          </form>
        )}
      </div>

      {shown.length === 0 ? (
        <Card>
          <EmptyState icon={BedDouble} title="No wards set up yet">
            {can(s, "admin.wards") ? (
              <Link href="/admin/facility" className="text-brand hover:underline">
                Add your wards and beds
              </Link>
            ) : (
              "Your administrator sets up wards and beds."
            )}
          </EmptyState>
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          {shown.map((w) => {
            const wb = all.filter((b) => b.ward_id === w.id);
            const occ = wb.filter((b) => b.status === "occupied").length;
            return (
              <Card key={w.id}>
                <CardHeader
                  title={
                    <span className="flex items-center gap-2">
                      {w.name}
                      <span className="tnum text-xs font-normal text-ink-faint">
                        {w.code} · {occ}/{wb.length} occupied
                        {w.sex_restriction !== "any" ? ` · ${w.sex_restriction} only` : ""}
                        {w.status !== "open" ? ` · ${w.status}` : ""}
                      </span>
                    </span>
                  }
                />
                {wb.length === 0 ? (
                  <p className="px-5 py-4 text-sm text-ink-faint">No beds on this ward.</p>
                ) : (
                  <ul className="grid grid-cols-2 gap-2.5 p-3 sm:grid-cols-3 sm:p-4 md:grid-cols-4 xl:grid-cols-6">
                    {wb.map((b) => {
                      const st = STATE[b.status];
                      const res = b.edoshmis_bed_reservations.find((r) => r.status === "held");
                      const p = b.current?.edoshmis_patients;
                      return (
                        <li key={b.id} className={cn("flex min-h-[112px] flex-col rounded-xl border p-3", st.tile)}>
                          <div className="flex items-center justify-between gap-1">
                            <span className="tnum text-base font-semibold text-ink">{b.bed_number}</span>
                            <span className="flex items-center gap-1">
                              {b.is_isolation && <ShieldAlert className="h-3.5 w-3.5 text-attention-ink" aria-label="Isolation bed" />}
                              <span className={cn("h-2.5 w-2.5 rounded-full", st.dot)} title={st.label} />
                            </span>
                          </div>
                          <span className="text-[11px] text-ink-faint">
                            {st.label}
                            {b.room ? ` · room ${b.room}` : ""}
                          </span>
                          <div className="mt-2 min-h-0 flex-1 text-xs">
                            {b.status === "occupied" && b.current && p ? (
                              <Link href={`/ipd/admissions/${b.current.id}`} className="block hover:underline">
                                <span className="block truncate font-medium text-ink">{fullName(p)}</span>
                                <span className="block text-ink-faint">
                                  Day {lengthOfStay(b.current.admitted_at)}
                                  {b.current.expected_discharge_date ? ` · EDD ${fmtDate(b.current.expected_discharge_date)}` : ""}
                                </span>
                              </Link>
                            ) : b.status === "reserved" && res ? (
                              <span className="text-info-ink">
                                Until {fmtDateTime(res.reserved_until)}
                                {res.note ? ` · ${res.note}` : ""}
                              </span>
                            ) : b.status_note ? (
                              <span className="text-ink-soft">{b.status_note}</span>
                            ) : null}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {manage && b.status === "cleaning" && (
                              <ActionButton action={setBedStatus.bind(null, b.id)} hidden={{ status: "available", note: "Cleaned" }}>
                                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Cleaned
                              </ActionButton>
                            )}
                            {manage && ["maintenance", "blocked"].includes(b.status) && (
                              <ActionButton action={setBedStatus.bind(null, b.id)} hidden={{ status: "available", note: "Back in service" }}>
                                Back in service
                              </ActionButton>
                            )}
                            {allocate && b.status === "reserved" && res && (
                              <ActionButton action={releaseReservation.bind(null, res.id)}>Release</ActionButton>
                            )}
                            {b.status === "available" && (manage || allocate) && (
                              <Disclosure label="More" variant="ghost">
                                {allocate && (
                                  <ActionForm action={reserveBed.bind(null, null)} submitLabel="Reserve" className="mb-3">
                                    <input type="hidden" name="bed_id" value={b.id} />
                                    <Field label="Hold for (hours)">
                                      <Input name="hours" type="number" min={1} max={72} defaultValue={4} />
                                    </Field>
                                    <Field label="For whom / why">
                                      <Input name="note" placeholder="e.g. From theatre, 3 pm" />
                                    </Field>
                                  </ActionForm>
                                )}
                                {manage && (
                                  <ActionForm action={setBedStatus.bind(null, b.id)} submitLabel="Take out of service" submitVariant="secondary">
                                    <Field label="Status">
                                      <Select name="status" defaultValue="maintenance">
                                        <option value="maintenance">Maintenance</option>
                                        <option value="blocked">Blocked</option>
                                        <option value="cleaning">Needs cleaning</option>
                                      </Select>
                                    </Field>
                                    <Field label="Reason" hint="Required for maintenance and blocked">
                                      <Input name="note" placeholder="e.g. Broken side rail" />
                                    </Field>
                                  </ActionForm>
                                )}
                              </Disclosure>
                            )}
                            {manage && b.status === "cleaning" && (
                              <ActionButton action={setBedStatus.bind(null, b.id)} hidden={{ status: "maintenance", note: "Fault found when cleaning" }} variant="ghost">
                                <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
                              </ActionButton>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
