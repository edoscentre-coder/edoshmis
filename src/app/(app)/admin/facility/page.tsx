import type { Metadata } from "next";
import { BedDouble, Building2, Layers, Plus } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, Disclosure, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
import { ActionForm } from "@/components/ui/action-form";
import { can, requireStaff } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { KENYA_COUNTIES } from "@/lib/kenya";
import { ksh, titleCase } from "@/lib/format";
import { addBeds, addDepartment, saveBed, saveFacility, saveOrganization, saveWard } from "../actions";

export const metadata: Metadata = { title: "Facility & wards" };

const WARD_TYPES = [
  "general_medical", "surgical", "paediatric", "maternity", "neonatal", "icu", "hdu", "isolation", "orthopaedic", "oncology", "psychiatric", "private", "vip", "emergency_observation", "other",
] as const;
const LEVELS = ["level_2", "level_3", "level_4", "level_5", "level_6", "nursing_home", "medical_centre", "specialist_clinic", "other"] as const;
const BED_CATS = ["standard", "private", "semi_private", "icu", "hdu", "cot", "incubator", "labour", "other"] as const;

export default async function FacilityAdmin() {
  const s = await requireStaff();
  if (!can(s, "admin.facility", "admin.wards")) return <EmptyState icon={Building2} title="Your role does not include facility settings." />;
  const supabase = await createClient();
  const [{ data: org }, { data: fac }, { data: depts }, { data: wards }, { data: beds }, { data: staff }, { data: tariffs }] = await Promise.all([
    supabase.from("edoshmis_organizations").select("*").eq("id", s.staff.organizationId).single(),
    supabase.from("edoshmis_facilities").select("*").eq("id", s.facility.id).single(),
    supabase.from("edoshmis_departments").select("id, name, code, kind").eq("facility_id", s.facility.id).order("name"),
    supabase.from("edoshmis_wards").select("*").eq("facility_id", s.facility.id).order("sort_order").order("name"),
    supabase.from("edoshmis_beds").select("id, ward_id, bed_number, room, category, sex_restriction, is_isolation, status, is_active, daily_tariff_id").eq("facility_id", s.facility.id).order("bed_number"),
    supabase.from("edoshmis_staff").select("id, full_name, designation").eq("organization_id", s.staff.organizationId).eq("status", "active").order("full_name"),
    supabase.from("edoshmis_tariffs").select("id, name, price, category").eq("facility_id", s.facility.id).eq("is_active", true).in("category", ["bed", "ward", "icu", "hdu"]).order("name"),
  ]);
  const adminFacility = can(s, "admin.facility");
  const adminWards = can(s, "admin.wards");
  const nurses = (staff ?? []).filter((m) => ["nurse", "nursing_officer", "ward_manager", "midwife"].includes(m.designation));
  const consultants = (staff ?? []).filter((m) => ["consultant", "paediatrician", "medical_superintendent"].includes(m.designation));

  const wardForm = (w?: Record<string, unknown>) => (
    <ActionForm action={saveWard.bind(null, (w?.id as string) ?? null)} submitLabel={w ? "Save ward" : "Add ward"} resetOnSuccess={!w}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name" required>
          <Input name="name" required defaultValue={(w?.name as string) ?? ""} placeholder="Medical Ward A" />
        </Field>
        <Field label="Code" required>
          <Input name="code" required defaultValue={(w?.code as string) ?? ""} className="uppercase" placeholder="MWA" />
        </Field>
        <Field label="Type" required>
          <Select name="ward_type" defaultValue={(w?.ward_type as string) ?? "general_medical"}>
            {WARD_TYPES.map((t) => (
              <option key={t} value={t}>
                {titleCase(t)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Admits">
          <Select name="sex_restriction" defaultValue={(w?.sex_restriction as string) ?? "any"}>
            <option value="any">Any patient</option>
            <option value="female">Female only</option>
            <option value="male">Male only</option>
          </Select>
        </Field>
        <Field label="Isolation capacity">
          <Input name="isolation_capacity" type="number" min={0} defaultValue={String(w?.isolation_capacity ?? 0)} />
        </Field>
        <Field label="Status">
          <Select name="status" defaultValue={(w?.status as string) ?? "open"}>
            <option value="open">Open</option>
            <option value="restricted">Restricted</option>
            <option value="closed">Closed</option>
          </Select>
        </Field>
        <Field label="Ward manager">
          <Select name="ward_manager_id" defaultValue={(w?.ward_manager_id as string) ?? ""}>
            <option value="">—</option>
            {nurses.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Responsible nurse">
          <Select name="responsible_nurse_id" defaultValue={(w?.responsible_nurse_id as string) ?? ""}>
            <option value="">—</option>
            {nurses.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Responsible consultant">
          <Select name="responsible_consultant_id" defaultValue={(w?.responsible_consultant_id as string) ?? ""}>
            <option value="">—</option>
            {consultants.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Daily bed charge" hint={tariffs?.length ? "Beds can override it" : "Add a bed-day price under Tariffs first"}>
          <Select name="daily_tariff_id" defaultValue={(w?.daily_tariff_id as string) ?? ""}>
            <option value="">No charge</option>
            {tariffs?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {ksh(t.price)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Department">
          <Select name="department_id" defaultValue={(w?.department_id as string) ?? ""}>
            <option value="">—</option>
            {depts?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Order on lists">
          <Input name="sort_order" type="number" defaultValue={String(w?.sort_order ?? 0)} />
        </Field>
      </div>
    </ActionForm>
  );

  return (
    <>
      <PageHeader title="Facility & wards" description={`${s.staff.organizationName} · ${s.facility.name}`} />
      <div className="flex flex-col gap-5">
        {adminFacility && (
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="Organisation" icon={Building2} />
              <CardBody>
                <ActionForm action={saveOrganization} submitLabel="Save" resetOnSuccess={false}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Name" required>
                      <Input name="name" required defaultValue={org?.name ?? ""} />
                    </Field>
                    <Field label="Legal name">
                      <Input name="legal_name" defaultValue={org?.legal_name ?? ""} />
                    </Field>
                    <Field label="KRA PIN">
                      <Input name="kra_pin" defaultValue={org?.kra_pin ?? ""} className="uppercase" />
                    </Field>
                    <Field label="Phone">
                      <Input name="phone" defaultValue={org?.phone ?? ""} />
                    </Field>
                    <Field label="Email" className="sm:col-span-2">
                      <Input name="email" type="email" defaultValue={org?.email ?? ""} />
                    </Field>
                  </div>
                </ActionForm>
              </CardBody>
            </Card>
            <Card>
              <CardHeader
                title="This facility"
                actions={
                  <Disclosure label="Add facility" icon={Plus}>
                    <FacilityForm id={null} />
                  </Disclosure>
                }
              />
              <CardBody>
                <FacilityForm id={s.facility.id} f={fac ?? undefined} />
              </CardBody>
            </Card>
          </div>
        )}

        {adminFacility && (
          <Card>
            <CardHeader
              title={`Departments · ${depts?.length ?? 0}`}
              icon={Layers}
              actions={
                <Disclosure label="Add" icon={Plus}>
                  <ActionForm action={addDepartment} submitLabel="Add department">
                    <div className="grid grid-cols-[1fr_96px] gap-3">
                      <Field label="Name" required>
                        <Input name="name" required />
                      </Field>
                      <Field label="Code" required>
                        <Input name="code" required className="uppercase" />
                      </Field>
                    </div>
                    <Field label="Kind">
                      <Select name="kind" defaultValue="clinical">
                        {["clinical", "nursing", "diagnostic", "pharmacy", "finance", "administration", "support"].map((k) => (
                          <option key={k} value={k}>
                            {titleCase(k)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </ActionForm>
                </Disclosure>
              }
            />
            <CardBody className="flex flex-wrap gap-2">
              {depts?.length ? depts.map((d) => <Badge key={d.id}>{d.name} · {d.code}</Badge>) : <span className="text-sm text-ink-faint">None yet.</span>}
            </CardBody>
          </Card>
        )}

        {adminWards && (
          <>
            <Disclosure label="Add a ward" icon={Plus} variant="primary" size="md">
              {wardForm()}
            </Disclosure>
            {!wards?.length && (
              <Card>
                <EmptyState icon={BedDouble} title="No wards yet">
                  Add a ward, then its beds. The bed board, admissions and bed-day charges all work from these.
                </EmptyState>
              </Card>
            )}
            {wards?.map((w) => {
              const wb = (beds ?? []).filter((b) => b.ward_id === w.id);
              return (
                <Card key={w.id}>
                  <CardHeader
                    title={`${w.name} · ${w.code}`}
                    icon={BedDouble}
                    description={`${titleCase(w.ward_type)} · ${wb.filter((b) => b.is_active).length} beds${w.sex_restriction !== "any" ? ` · ${w.sex_restriction} only` : ""} · ${w.status}`}
                    actions={
                      <>
                        <Disclosure label="Add beds" icon={Plus}>
                          <ActionForm action={addBeds.bind(null, w.id)} submitLabel="Add beds">
                            <div className="grid grid-cols-3 gap-3">
                              <Field label="Prefix" hint="e.g. A → A1, A2…">
                                <Input name="prefix" defaultValue={w.code.slice(0, 1)} />
                              </Field>
                              <Field label="From">
                                <Input name="from" type="number" min={1} defaultValue={String(wb.length + 1)} />
                              </Field>
                              <Field label="To">
                                <Input name="to" type="number" min={1} defaultValue={String(wb.length + 10)} />
                              </Field>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <Field label="Category">
                                <Select name="category" defaultValue="standard">
                                  {BED_CATS.map((c) => (
                                    <option key={c} value={c}>
                                      {titleCase(c)}
                                    </option>
                                  ))}
                                </Select>
                              </Field>
                              <Field label="Room">
                                <Input name="room" />
                              </Field>
                            </div>
                            <label className="flex items-center gap-2 text-sm">
                              <input type="checkbox" name="is_isolation" className="h-4 w-4 accent-brand" /> Isolation beds
                            </label>
                          </ActionForm>
                        </Disclosure>
                        <Disclosure label="Edit ward">{wardForm(w)}</Disclosure>
                      </>
                    }
                  />
                  {wb.length > 0 && (
                    <ul className="flex flex-wrap gap-2 p-4">
                      {wb.map((b) => (
                        <li key={b.id}>
                          <details className="group">
                            <summary className={`flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-sm ${b.is_active ? "border-line-strong bg-surface" : "border-line bg-surface-sunk text-ink-faint line-through"}`}>
                              <span className="tnum font-medium">{b.bed_number}</span>
                              {b.is_isolation && <span className="text-[10px] text-attention-ink">ISO</span>}
                              <span className="text-[10px] text-ink-faint">{titleCase(b.status)}</span>
                            </summary>
                            <div className="mt-2 w-[280px] rounded-xl border border-line bg-surface p-3 shadow-raised">
                              <ActionForm action={saveBed.bind(null, b.id)} submitLabel="Save bed" resetOnSuccess={false}>
                                <div className="grid grid-cols-2 gap-2">
                                  <Field label="Number">
                                    <Input name="bed_number" defaultValue={b.bed_number} />
                                  </Field>
                                  <Field label="Room">
                                    <Input name="room" defaultValue={b.room ?? ""} />
                                  </Field>
                                </div>
                                <Field label="Category">
                                  <Select name="category" defaultValue={b.category}>
                                    {BED_CATS.map((c) => (
                                      <option key={c} value={c}>
                                        {titleCase(c)}
                                      </option>
                                    ))}
                                  </Select>
                                </Field>
                                <Field label="For">
                                  <Select name="sex_restriction" defaultValue={b.sex_restriction}>
                                    <option value="any">Any</option>
                                    <option value="female">Female</option>
                                    <option value="male">Male</option>
                                  </Select>
                                </Field>
                                <Field label="Own daily charge">
                                  <Select name="daily_tariff_id" defaultValue={b.daily_tariff_id ?? ""}>
                                    <option value="">Ward&apos;s charge</option>
                                    {tariffs?.map((t) => (
                                      <option key={t.id} value={t.id}>
                                        {t.name} · {ksh(t.price)}
                                      </option>
                                    ))}
                                  </Select>
                                </Field>
                                <label className="flex items-center gap-2 text-sm">
                                  <input type="checkbox" name="is_isolation" defaultChecked={b.is_isolation} className="h-4 w-4 accent-brand" /> Isolation
                                </label>
                                <label className="flex items-center gap-2 text-sm">
                                  <input type="checkbox" name="retire" defaultChecked={!b.is_active} className="h-4 w-4 accent-brand" /> Retired (not in use)
                                </label>
                              </ActionForm>
                            </div>
                          </details>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              );
            })}
          </>
        )}
      </div>
    </>
  );
}

function FacilityForm({ id, f }: { id: string | null; f?: Record<string, string | null> }) {
  return (
    <ActionForm action={saveFacility.bind(null, id)} submitLabel={id ? "Save" : "Add facility"} resetOnSuccess={!id}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required>
          <Input name="name" required defaultValue={f?.name ?? ""} />
        </Field>
        <Field label="Code" required hint="Prefix of hospital and admission numbers">
          <Input name="code" required defaultValue={f?.code ?? ""} className="uppercase" />
        </Field>
        <Field label="Level">
          <Select name="level" defaultValue={f?.level ?? "other"}>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {titleCase(l)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="MFL code">
          <Input name="mfl_code" defaultValue={f?.mfl_code ?? ""} />
        </Field>
        <Field label="SHA facility code">
          <Input name="sha_facility_code" defaultValue={f?.sha_facility_code ?? ""} />
        </Field>
        <Field label="County">
          <Select name="county" defaultValue={f?.county ?? ""}>
            <option value="">—</option>
            {KENYA_COUNTIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Sub-county">
          <Input name="sub_county" defaultValue={f?.sub_county ?? ""} />
        </Field>
        <Field label="Phone">
          <Input name="phone" defaultValue={f?.phone ?? ""} />
        </Field>
        <Field label="Address" className="sm:col-span-2">
          <Input name="address" defaultValue={f?.address ?? ""} />
        </Field>
        <Field label="Email" className="sm:col-span-2">
          <Input name="email" type="email" defaultValue={f?.email ?? ""} />
        </Field>
      </div>
    </ActionForm>
  );
}
