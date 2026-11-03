import type { Perm } from "@/lib/perms";

/** Icon names resolved in the client shell (lucide components cannot cross to the client as props). */
export type NavIcon =
  | "dashboard" | "patients" | "census" | "admissions" | "beds" | "pharmacy" | "billing"
  | "facility" | "staff" | "tariffs" | "clinical" | "audit" | "opd" | "emergency" | "lab" | "imaging" | "calendar" | "stores";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  badge?: number;
}
export interface NavGroup {
  title: string;
  items: NavItem[];
}

interface Def extends NavItem {
  any: Perm[] | "all";
}

const GROUPS: { title: string; items: Def[] }[] = [
  {
    title: "Overview",
    items: [{ href: "/dashboard", label: "Dashboard", icon: "dashboard", any: "all" }],
  },
  {
    title: "Patients",
    items: [{ href: "/patients", label: "Patient register", icon: "patients", any: ["patients.read"] }],
  },
  {
    title: "Outpatients",
    items: [
      { href: "/opd", label: "Outpatient queue", icon: "opd", any: ["opd.read"] },
      { href: "/emergency", label: "Emergency", icon: "emergency", any: ["opd.read"] },
      { href: "/opd/appointments", label: "Appointments", icon: "calendar", any: ["opd.read"] },
    ],
  },
  {
    title: "Inpatients",
    items: [
      { href: "/ipd", label: "Inpatient census", icon: "census", any: ["ipd.read"] },
      { href: "/ipd/admissions", label: "Admissions", icon: "admissions", any: ["ipd.read", "ipd.request_admission"] },
      { href: "/ipd/beds", label: "Bed board", icon: "beds", any: ["ipd.read", "admin.wards"] },
    ],
  },
  {
    title: "Departments",
    items: [
      { href: "/lab", label: "Laboratory", icon: "lab", any: ["lab.process", "lab.validate", "lab.collect"] },
      { href: "/imaging", label: "Imaging", icon: "imaging", any: ["imaging.perform", "imaging.report"] },
      { href: "/pharmacy", label: "Pharmacy", icon: "pharmacy", any: ["meds.verify"] },
      { href: "/stores", label: "Stores", icon: "stores", any: ["stores.read", "procurement.order", "stores.requisition"] },
      { href: "/billing", label: "Billing", icon: "billing", any: ["billing.read"] },
    ],
  },
  {
    title: "Administration",
    items: [
      { href: "/admin/facility", label: "Facility & wards", icon: "facility", any: ["admin.facility", "admin.wards"] },
      { href: "/admin/staff", label: "Staff & roles", icon: "staff", any: ["admin.staff", "admin.roles"] },
      { href: "/admin/tariffs", label: "Tariffs", icon: "tariffs", any: ["admin.tariffs"] },
      { href: "/admin/clinical", label: "Clinical settings", icon: "clinical", any: ["admin.clinical_config", "meds.verify"] },
      { href: "/admin/lab", label: "Lab catalogue", icon: "lab", any: ["lab.configure"] },
      { href: "/admin/imaging", label: "Imaging catalogue", icon: "imaging", any: ["imaging.configure"] },
      { href: "/admin/audit", label: "Audit log", icon: "audit", any: ["audit.read"] },
    ],
  },
];

export function navFor(perms: Set<Perm>, badges: Partial<Record<string, number>> = {}): NavGroup[] {
  return GROUPS.map((g) => ({
    title: g.title,
    items: g.items
      .filter((i) => i.any === "all" || i.any.some((p) => perms.has(p)))
      .map(({ href, label, icon }) => ({ href, label, icon, badge: badges[href] })),
  })).filter((g) => g.items.length > 0);
}
