"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BedDouble,
  Bell,
  Boxes,
  Scissors,
  CalendarDays,
  FlaskConical,
  ScanLine,
  Siren,
  Stethoscope as StethoscopeIcon,
  Building2,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  FileClock,
  LayoutDashboard,
  LogOut,
  Menu,
  Pill,
  ReceiptText,
  Search,
  Settings2,
  Stethoscope,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { LogoMark, Wordmark } from "@/components/brand/logo";
import type { NavGroup, NavIcon } from "@/components/shell/nav";
import { cn } from "@/lib/utils";

const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  patients: Users,
  census: Activity,
  admissions: ClipboardList,
  beds: BedDouble,
  pharmacy: Pill,
  billing: Wallet,
  facility: Building2,
  staff: Stethoscope,
  tariffs: ReceiptText,
  clinical: Settings2,
  audit: FileClock,
  opd: StethoscopeIcon,
  emergency: Siren,
  lab: FlaskConical,
  imaging: ScanLine,
  calendar: CalendarDays,
  stores: Boxes,
  theatre: Scissors,
};

export interface Alert {
  id: string;
  tone: "critical" | "attention" | "info";
  title: string;
  detail: string;
  href: string;
}

const COLLAPSE_KEY = "edoshmis.sidebar.collapsed";
const listeners = new Set<() => void>();
function subscribeCollapse(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function readCollapse() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false; // storage blocked — stay expanded
  }
}
function writeCollapse(v: boolean) {
  try {
    localStorage.setItem(COLLAPSE_KEY, v ? "1" : "0");
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => fn());
}

export function AppShell({
  nav,
  user,
  organization,
  facility,
  facilities,
  alerts,
  switchFacility,
  children,
}: {
  nav: NavGroup[];
  user: { name: string; designation: string };
  organization: string;
  facility: { id: string; name: string };
  facilities: { id: string; name: string }[];
  alerts: Alert[];
  switchFacility: (formData: FormData) => Promise<void>;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // The sidebar's collapsed state is remembered per device; read as an
  // external store so the server render (expanded) and the client agree.
  const collapsed = useSyncExternalStore(subscribeCollapse, readCollapse, () => false);
  const [drawer, setDrawer] = useState(false);
  const toggle = () => writeCollapse(!collapsed);

  const active = (href: string) => (href === "/dashboard" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));
  // The most specific match wins, so /ipd/beds does not also light /ipd.
  const all = nav.flatMap((g) => g.items.map((i) => i.href));
  const current = all.filter(active).sort((a, b) => b.length - a.length)[0];

  const links = (compact: boolean) => (
    <nav className="flex flex-col gap-5 px-3 py-4" aria-label="Main">
      {nav.map((g) => (
        <div key={g.title}>
          {!compact && <div className="mb-1.5 px-2 text-[10.5px] font-semibold tracking-wider text-shell-ink-faint uppercase">{g.title}</div>}
          <ul className="flex flex-col gap-0.5">
            {g.items.map((i) => {
              const Icon = ICONS[i.icon];
              const on = i.href === current;
              return (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    onClick={() => setDrawer(false)}
                    title={compact ? i.label : undefined}
                    aria-current={on ? "page" : undefined}
                    className={cn(
                      "relative flex h-10 items-center gap-3 rounded-lg px-2.5 text-sm transition-colors",
                      on ? "bg-shell-raised font-medium text-white" : "text-shell-ink hover:bg-shell-raised/60 hover:text-white",
                      compact && "justify-center px-0",
                    )}
                  >
                    {on && <span className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-[#5eead4]" aria-hidden="true" />}
                    <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                    {!compact && <span className="min-w-0 flex-1 truncate">{i.label}</span>}
                    {!!i.badge && (
                      <span
                        className={cn(
                          "tnum rounded-full bg-attention px-1.5 text-[10.5px] leading-[18px] font-semibold text-white",
                          compact && "absolute top-1 right-1",
                        )}
                      >
                        {i.badge}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "no-print sticky top-0 hidden h-dvh shrink-0 flex-col bg-shell transition-[width] duration-200 lg:flex",
          collapsed ? "w-[68px]" : "w-64",
        )}
      >
        <div className={cn("flex h-16 items-center border-b border-white/5", collapsed ? "justify-center" : "px-5")}>
          <Link href="/dashboard" aria-label="EDOSHMIS home">
            {collapsed ? <LogoMark /> : <Wordmark tone="light" />}
          </Link>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{links(collapsed)}</div>
        <button
          type="button"
          onClick={toggle}
          className="flex h-11 items-center gap-2 border-t border-white/5 px-5 text-xs text-shell-ink-faint hover:text-white"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronsRight className="mx-auto h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          {!collapsed && "Collapse"}
        </button>
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="no-print fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="absolute inset-0 bg-ink/50" aria-label="Close menu" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[min(20rem,86vw)] flex-col bg-shell shadow-raised">
            <div className="flex h-16 items-center justify-between border-b border-white/5 px-5">
              <Wordmark tone="light" />
              <button onClick={() => setDrawer(false)} className="rounded-lg p-2 text-shell-ink hover:bg-shell-raised" aria-label="Close menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{links(false)}</div>
            <div className="border-t border-white/5 px-5 py-3 text-xs text-shell-ink-faint">
              {organization} · {facility.name}
            </div>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-40 flex h-16 items-center gap-2 border-b border-line bg-surface/95 px-3 backdrop-blur sm:gap-3 sm:px-5">
          <button onClick={() => setDrawer(true)} className="rounded-lg p-2 text-ink-soft hover:bg-surface-sunk lg:hidden" aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>

          <form action="/patients" className="relative min-w-0 flex-1 sm:max-w-md" role="search">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
            <input
              name="q"
              placeholder="Find a patient — name, hospital no., ID, phone"
              aria-label="Find a patient"
              className="h-10 w-full rounded-lg border border-line bg-surface-sunk pr-3 pl-9 text-sm placeholder:text-ink-faint focus:border-brand focus:bg-surface focus:ring-3 focus:ring-brand/15 focus:outline-none"
            />
          </form>

          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            {facilities.length > 1 ? (
              <form action={switchFacility} className="hidden md:block">
                <select
                  name="facility"
                  defaultValue={facility.id}
                  onChange={(e) => e.currentTarget.form?.requestSubmit()}
                  aria-label="Facility"
                  className="h-9 max-w-[14rem] rounded-lg border border-line bg-surface px-2 text-sm text-ink focus:border-brand focus:outline-none"
                >
                  {facilities.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </form>
            ) : (
              <span className="hidden items-center gap-1.5 rounded-lg px-2 text-sm text-ink-soft md:flex">
                <Building2 className="h-4 w-4 text-ink-faint" aria-hidden="true" />
                {facility.name}
              </span>
            )}

            <Notifications alerts={alerts} />

            <details className="relative">
              <summary className="flex h-10 cursor-pointer items-center gap-2 rounded-lg px-1.5 hover:bg-surface-sunk sm:px-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand-darker">
                  {initials(user.name)}
                </span>
                <span className="hidden text-left leading-tight sm:block">
                  <span className="block max-w-[10rem] truncate text-sm font-medium text-ink">{user.name}</span>
                  <span className="block text-[11px] text-ink-faint capitalize">{user.designation.replace(/_/g, " ")}</span>
                </span>
              </summary>
              <div className="absolute right-0 mt-2 w-64 rounded-xl border border-line bg-surface p-2 shadow-raised">
                <div className="px-2 py-1.5 text-xs text-ink-faint">
                  {organization}
                  <br />
                  {facility.name}
                </div>
                {facilities.length > 1 && (
                  <form action={switchFacility} className="px-2 pb-2 md:hidden">
                    <select
                      name="facility"
                      defaultValue={facility.id}
                      onChange={(e) => e.currentTarget.form?.requestSubmit()}
                      aria-label="Facility"
                      className="h-9 w-full rounded-lg border border-line bg-surface px-2 text-sm"
                    >
                      {facilities.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </form>
                )}
                <form action="/auth/signout" method="post">
                  <button className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-ink hover:bg-surface-sunk">
                    <LogOut className="h-4 w-4 text-ink-faint" aria-hidden="true" />
                    Sign out
                  </button>
                </form>
              </div>
            </details>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-5 sm:px-6 sm:py-6">{children}</main>
      </div>
    </div>
  );
}

function Notifications({ alerts }: { alerts: Alert[] }) {
  const critical = alerts.some((a) => a.tone === "critical");
  return (
    <details className="relative">
      <summary className="relative flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-ink-soft hover:bg-surface-sunk" aria-label={`Notifications (${alerts.length})`}>
        <Bell className="h-5 w-5" aria-hidden="true" />
        {alerts.length > 0 && (
          <span
            className={cn(
              "tnum absolute top-1.5 right-1.5 min-w-4 rounded-full px-1 text-center text-[10px] leading-4 font-semibold text-white",
              critical ? "bg-critical" : "bg-attention",
            )}
          >
            {alerts.length > 99 ? "99+" : alerts.length}
          </span>
        )}
      </summary>
      <div className="absolute right-0 mt-2 w-[min(22rem,calc(100vw-1.5rem))] rounded-xl border border-line bg-surface shadow-raised">
        <div className="border-b border-line px-4 py-2.5 text-sm font-semibold text-ink">Needs attention</div>
        {alerts.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-ink-faint">Nothing waiting on you.</p>
        ) : (
          <ul className="max-h-[60vh] overflow-y-auto py-1">
            {alerts.map((a) => (
              <li key={a.id}>
                <Link href={a.href} className="flex gap-3 px-4 py-2.5 hover:bg-surface-sunk">
                  <span
                    className={cn(
                      "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                      a.tone === "critical" ? "bg-critical" : a.tone === "attention" ? "bg-attention" : "bg-info",
                    )}
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm text-ink">{a.title}</span>
                    <span className="block truncate text-xs text-ink-faint">{a.detail}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

const initials = (name: string) =>
  name
    .replace(/^(dr|nurse|mr|mrs|ms)\.?\s+/i, "")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
