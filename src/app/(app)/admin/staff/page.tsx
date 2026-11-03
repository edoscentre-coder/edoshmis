import type { Metadata } from "next";
import { KeyRound, Plus, ShieldCheck, Stethoscope, UserPlus, X } from "lucide-react";
import { Badge, Card, CardHeader, Disclosure, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
import { ActionButton, ActionForm } from "@/components/ui/action-form";
import { can, requireStaff } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { dateInDays, fmtDate, titleCase } from "@/lib/format";
import { addStaff, grantRole, revokeRole, saveRole, setStaffStatus, setWards } from "../actions";

export const metadata: Metadata = { title: "Staff & roles" };

const DESIGNATIONS = [
  "consultant", "medical_officer", "clinical_officer", "intern", "medical_superintendent", "hospital_director", "nursing_officer", "ward_manager", "nurse", "midwife",
  "pharmacist", "pharmaceutical_technologist", "lab_technologist", "radiologist", "radiographer", "anaesthetist", "theatre_staff", "paediatrician", "receptionist",
  "triage_officer", "cashier", "accountant", "claims_officer", "procurement_officer", "storekeeper", "hr_officer", "records_officer", "ambulance_staff", "mortuary_staff",
  "it_admin", "administrator", "other",
] as const;

interface StaffRow {
  id: string;
  full_name: string;
  designation: string;
  email: string | null;
  phone: string | null;
  regulator: string | null;
  registration_number: string | null;
  registration_expiry: string | null;
  status: string;
  edoshmis_staff_roles: { id: string; facility_id: string | null; edoshmis_roles: { id: string; name: string } | null }[];
  edoshmis_staff_wards: { ward_id: string }[];
}

export default async function StaffAdmin() {
  const s = await requireStaff();
  if (!can(s, "admin.staff", "admin.roles")) return <EmptyState icon={Stethoscope} title="Your role does not include staff administration." />;
  const supabase = await createClient();
  const [{ data: staff }, { data: roles }, { data: wards }, { data: catalog }] = await Promise.all([
    supabase
      .from("edoshmis_staff")
      .select("id, full_name, designation, email, phone, regulator, registration_number, registration_expiry, status, edoshmis_staff_roles!edoshmis_staff_roles_staff_id_fkey(id, facility_id, edoshmis_roles(id, name)), edoshmis_staff_wards(ward_id)")
      .eq("organization_id", s.staff.organizationId)
      .order("status")
      .order("full_name"),
    supabase.from("edoshmis_roles").select("id, code, name, description, permissions, is_system").eq("organization_id", s.staff.organizationId).order("is_system", { ascending: false }).order("name"),
    supabase.from("edoshmis_wards").select("id, name").eq("facility_id", s.facility.id).order("sort_order").order("name"),
    supabase.from("edoshmis_permission_catalog").select("key, area, label").order("area").order("key"),
  ]);
  const list = (staff ?? []) as unknown as StaffRow[];
  const areas = [...new Set((catalog ?? []).map((c) => c.area))];
  const soon = dateInDays(60);
  const wardName = new Map((wards ?? []).map((w) => [w.id, w.name]));

  return (
    <>
      <PageHeader title="Staff & roles" description="Who can sign in, what each role allows, and which wards nurses see." />
      <div className="flex flex-col gap-5">
        {can(s, "admin.staff") && (
          <Disclosure label="Add staff member" icon={UserPlus} variant="primary" size="md">
            <ActionForm action={addStaff} submitLabel="Add staff member">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Full name" required>
                  <Input name="full_name" required placeholder="As on their licence" />
                </Field>
                <Field label="Designation" required>
                  <Select name="designation" required defaultValue="">
                    <option value="" disabled>
                      Choose
                    </option>
                    {DESIGNATIONS.map((d) => (
                      <option key={d} value={d}>
                        {titleCase(d)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Staff number">
                  <Input name="staff_number" />
                </Field>
                <Field label="Email (sign-in)" required hint="An existing EDOS login is reused">
                  <Input name="email" type="email" required />
                </Field>
                <Field label="Temporary password" hint="Only for a new login, 10+ characters">
                  <Input name="temp_password" autoComplete="off" />
                </Field>
                <Field label="Phone">
                  <Input name="phone" type="tel" />
                </Field>
                <Field label="Regulator">
                  <Select name="regulator" defaultValue="">
                    <option value="">—</option>
                    <option>KMPDC</option>
                    <option>NCK</option>
                    <option>PPB</option>
                    <option>Clinical Officers Council</option>
                    <option>KMLTTB</option>
                    <option>Other</option>
                  </Select>
                </Field>
                <Field label="Registration no.">
                  <Input name="registration_number" />
                </Field>
                <Field label="Licence expires">
                  <Input name="registration_expiry" type="date" />
                </Field>
              </div>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-xs font-medium text-ink-soft">Roles</legend>
                <div className="grid gap-1.5 sm:grid-cols-3">
                  {roles?.map((r) => (
                    <label key={r.id} className="flex items-start gap-2 text-sm">
                      <input type="checkbox" name="roles" value={r.code} className="mt-0.5 h-4 w-4 accent-brand" />
                      <span>
                        {r.name}
                        {r.description && <span className="block text-xs text-ink-faint">{r.description}</span>}
                      </span>
                    </label>
                  ))}
                </div>
                <Field label="Roles apply at" className="max-w-xs">
                  <Select name="scope" defaultValue="org">
                    <option value="org">Every facility</option>
                    <option value="facility">Only {s.facility.name}</option>
                  </Select>
                </Field>
              </fieldset>
              {!!wards?.length && (
                <fieldset>
                  <legend className="mb-1 text-xs font-medium text-ink-soft">Wards (nurses see only these unless their role sees all)</legend>
                  <div className="flex flex-wrap gap-3">
                    {wards.map((w) => (
                      <label key={w.id} className="flex items-center gap-1.5 text-sm">
                        <input type="checkbox" name="wards" value={w.id} className="h-4 w-4 accent-brand" /> {w.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
            </ActionForm>
          </Disclosure>
        )}

        <Card>
          <CardHeader title={`Staff · ${list.filter((m) => m.status === "active").length} active`} icon={Stethoscope} />
          <ul className="divide-y divide-line">
            {list.map((m) => {
              const expiring = m.registration_expiry && m.registration_expiry <= soon;
              return (
                <li key={m.id} className={`px-4 py-3 sm:px-5 ${m.status !== "active" ? "opacity-60" : ""}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {m.full_name} {m.status !== "active" && <Badge tone="critical">{titleCase(m.status)}</Badge>}
                      </p>
                      <p className="text-xs text-ink-faint">
                        {titleCase(m.designation)}
                        {m.email ? ` · ${m.email}` : ""}
                        {m.phone ? ` · ${m.phone}` : ""}
                      </p>
                      {m.registration_number && (
                        <p className={`text-xs ${expiring ? "text-attention-ink" : "text-ink-faint"}`}>
                          {m.regulator} {m.registration_number}
                          {m.registration_expiry ? ` · licence to ${fmtDate(m.registration_expiry)}${expiring ? " — renew soon" : ""}` : ""}
                        </p>
                      )}
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {m.edoshmis_staff_roles.map((r) => (
                          <span key={r.id} className="inline-flex items-center gap-1 rounded-md bg-brand-soft py-0.5 pr-1 pl-1.5 text-[11px] font-medium text-brand-darker">
                            {r.edoshmis_roles?.name}
                            {r.facility_id ? " (this facility)" : ""}
                            {can(s, "admin.staff") && (
                              <ActionButton action={revokeRole.bind(null, r.id)} variant="ghost" confirm={`Remove ${r.edoshmis_roles?.name} from ${m.full_name}?`}>
                                <X className="h-3 w-3" aria-label="Remove role" />
                              </ActionButton>
                            )}
                          </span>
                        ))}
                        {m.edoshmis_staff_wards.map((w) => wardName.get(w.ward_id) && <Badge key={w.ward_id}>{wardName.get(w.ward_id)}</Badge>)}
                      </div>
                    </div>
                    {can(s, "admin.staff") && m.id !== s.staff.id && (
                      <div className="flex flex-wrap items-start gap-2">
                        <Disclosure label="Role" icon={Plus} variant="ghost">
                          <ActionForm action={grantRole.bind(null, m.id)} submitLabel="Grant">
                            <Field label="Role">
                              <Select name="role_id" required>
                                {roles?.map((r) => (
                                  <option key={r.id} value={r.id}>
                                    {r.name}
                                  </option>
                                ))}
                              </Select>
                            </Field>
                            <Field label="At">
                              <Select name="scope" defaultValue="org">
                                <option value="org">Every facility</option>
                                <option value="facility">Only {s.facility.name}</option>
                              </Select>
                            </Field>
                          </ActionForm>
                        </Disclosure>
                        {!!wards?.length && (
                          <Disclosure label="Wards" variant="ghost">
                            <ActionForm action={setWards.bind(null, m.id)} submitLabel="Save wards" resetOnSuccess={false}>
                              <div className="flex flex-col gap-1.5">
                                {wards.map((w) => (
                                  <label key={w.id} className="flex items-center gap-2 text-sm">
                                    <input type="checkbox" name="wards" value={w.id} defaultChecked={m.edoshmis_staff_wards.some((x) => x.ward_id === w.id)} className="h-4 w-4 accent-brand" />
                                    {w.name}
                                  </label>
                                ))}
                              </div>
                            </ActionForm>
                          </Disclosure>
                        )}
                        {m.status === "active" ? (
                          <ActionButton action={setStaffStatus.bind(null, m.id, "suspended")} variant="danger" confirm={`Suspend ${m.full_name}? They lose access immediately.`}>
                            Suspend
                          </ActionButton>
                        ) : (
                          <ActionButton action={setStaffStatus.bind(null, m.id, "active")}>Reactivate</ActionButton>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        {can(s, "admin.roles") && (
          <Card>
            <CardHeader
              title="Roles"
              icon={ShieldCheck}
              description="What each role may do. Changes apply at once to everyone holding it."
              actions={
                <Disclosure label="New role" icon={Plus}>
                  <RoleForm id={null} areas={areas} catalog={catalog ?? []} />
                </Disclosure>
              }
            />
            <ul className="divide-y divide-line">
              {roles?.map((r) => (
                <li key={r.id} className="px-5 py-3">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                      <span>
                        <span className="font-medium">{r.name}</span>
                        {r.is_system && <span className="ml-1.5 text-xs text-ink-faint">standard</span>}
                        {r.description && <span className="block text-xs text-ink-faint">{r.description}</span>}
                      </span>
                      <Badge>
                        <KeyRound className="h-3 w-3" aria-hidden="true" /> {r.permissions.length} permissions
                      </Badge>
                    </summary>
                    <div className="mt-3">
                      <RoleForm id={r.id} role={r} areas={areas} catalog={catalog ?? []} />
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}

function RoleForm({
  id,
  role,
  areas,
  catalog,
}: {
  id: string | null;
  role?: { name: string; description: string | null; permissions: string[] };
  areas: string[];
  catalog: { key: string; area: string; label: string }[];
}) {
  return (
    <ActionForm action={saveRole.bind(null, id)} submitLabel={id ? "Save role" : "Create role"} resetOnSuccess={!id}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required>
          <Input name="name" required defaultValue={role?.name ?? ""} />
        </Field>
        <Field label="Description">
          <Input name="description" defaultValue={role?.description ?? ""} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {areas.map((area) => (
          <fieldset key={area} className="rounded-lg border border-line p-3">
            <legend className="px-1 text-xs font-semibold text-ink-soft">{area}</legend>
            <div className="flex flex-col gap-1.5">
              {catalog
                .filter((c) => c.area === area)
                .map((c) => (
                  <label key={c.key} className="flex items-start gap-2 text-sm">
                    <input type="checkbox" name="perms" value={c.key} defaultChecked={role?.permissions.includes(c.key)} className="mt-0.5 h-4 w-4 accent-brand" />
                    <span>
                      {c.label}
                      <span className="block font-mono text-[10.5px] text-ink-faint">{c.key}</span>
                    </span>
                  </label>
                ))}
            </div>
          </fieldset>
        ))}
      </div>
    </ActionForm>
  );
}
