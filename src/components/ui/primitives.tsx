import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------- buttons */

const BUTTON = {
  primary: "bg-brand text-white hover:bg-brand-dark shadow-card",
  secondary: "border border-line-strong bg-surface text-ink hover:bg-surface-sunk",
  ghost: "text-ink-soft hover:bg-surface-sunk hover:text-ink",
  danger: "border border-critical/30 bg-surface text-critical-ink hover:bg-critical-soft",
} as const;
const SIZE = { sm: "h-8 px-3 text-xs", md: "h-10 px-4 text-sm", lg: "h-12 px-5 text-base" } as const;

export type ButtonVariant = keyof typeof BUTTON;

export function buttonClass(variant: ButtonVariant = "primary", size: keyof typeof SIZE = "md", className?: string) {
  return cn(
    "inline-flex select-none items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors",
    "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand/25 disabled:pointer-events-none disabled:opacity-50",
    BUTTON[variant],
    SIZE[size],
    className,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: keyof typeof SIZE }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  className,
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: keyof typeof SIZE;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  );
}

/* ---------------------------------------------------------------- fields */

export const control =
  "w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:ring-3 focus:ring-brand/15 focus:outline-none disabled:bg-surface-sunk disabled:text-ink-faint";

export function Field({
  label,
  hint,
  required,
  className,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-ink-soft">
        {label}
        {required && <span className="text-critical"> *</span>}
      </span>
      {children}
      {hint && <span className="text-xs text-ink-faint">{hint}</span>}
    </label>
  );
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, "h-10", className)} {...props} />;
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(control, "h-10 pr-8", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, "min-h-24 py-2 leading-relaxed", className)} {...props} />;
}

export function Check({ label, hint, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink">
      <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 rounded border-line-strong accent-brand" {...props} />
      <span>
        {label}
        {hint && <span className="block text-xs text-ink-faint">{hint}</span>}
      </span>
    </label>
  );
}

/* ---------------------------------------------------------------- badges */

const TONE = {
  neutral: "bg-surface-sunk text-ink-soft",
  brand: "bg-brand-soft text-brand-darker",
  positive: "bg-positive-soft text-positive-ink",
  attention: "bg-attention-soft text-attention-ink",
  critical: "bg-critical-soft text-critical-ink",
  info: "bg-info-soft text-info-ink",
} as const;
export type Tone = keyof typeof TONE;

export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap", TONE[tone], className)}>
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------- cards */

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <section className={cn("rounded-xl border border-line bg-surface shadow-card", className)}>{children}</section>;
}

export function CardHeader({
  title,
  description,
  actions,
  icon: Icon,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
      <div className="flex min-w-0 items-start gap-2.5">
        {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-ink-faint">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function CardBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("px-4 py-4 sm:px-5", className)}>{children}</div>;
}

/* ---------------------------------------------------------------- page chrome */

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-medium text-ink-faint">{eyebrow}</div>}
        <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-soft">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-sunk">
        <Icon className="h-5 w-5 text-ink-faint" aria-hidden="true" />
      </span>
      <p className="text-sm font-medium text-ink">{title}</p>
      {children && <div className="max-w-md text-sm text-ink-soft">{children}</div>}
    </div>
  );
}

/** One number, what it counts, and where it leads. */
export function Stat({
  label,
  value,
  hint,
  href,
  tone = "neutral",
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  href?: string;
  tone?: "neutral" | "positive" | "attention" | "critical";
  icon?: LucideIcon;
}) {
  const ring = { neutral: "", positive: "", attention: "border-attention/40", critical: "border-critical/40 bg-critical-soft/40" }[tone];
  const valueTone = { neutral: "text-ink", positive: "text-positive-ink", attention: "text-attention-ink", critical: "text-critical-ink" }[tone];
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-ink-soft">{label}</span>
        {Icon && <Icon className="h-4 w-4 text-ink-faint" aria-hidden="true" />}
      </div>
      <div className={cn("tnum mt-2 text-2xl font-semibold tracking-tight", valueTone)}>{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-faint">{hint}</div>}
    </>
  );
  const cls = cn("block rounded-xl border border-line bg-surface p-4 shadow-card", ring, href && "transition-colors hover:border-brand/50");
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** A label/value pair in a definition grid. */
export function Fact({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[11px] font-medium tracking-wide text-ink-faint uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm break-words text-ink">{children || "—"}</dd>
    </div>
  );
}

/** An inline form that opens in place — touch-friendly, no modal stack. */
export function Disclosure({
  label,
  icon: Icon,
  variant = "secondary",
  size = "sm",
  open,
  className,
  children,
}: {
  label: React.ReactNode;
  icon?: LucideIcon;
  variant?: ButtonVariant;
  size?: keyof typeof SIZE;
  open?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <details className={cn("group", className)} open={open}>
      <summary className={buttonClass(variant, size, "cursor-pointer")}>
        {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
        {label}
      </summary>
      <div className="mt-3 rounded-xl border border-line bg-surface-sunk/60 p-4">{children}</div>
    </details>
  );
}
