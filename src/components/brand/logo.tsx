import { cn } from "@/lib/utils";

/**
 * The EDOSHMIS mark: a rounded square holding a cross whose right arm is a
 * pulse line — care and monitoring in one shape. Drawn in currentColor
 * around a fixed blue so it sits on the navy shell and on white alike.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("h-8 w-8 shrink-0", className)} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#1a5fb4" />
      <path d="M13 7h6v6h6v6h-2.6l-1.9-3.4-2.6 6.4-1.6-3H19v6h-6v-6H7v-6h6z" fill="#ffffff" opacity="0.18" />
      <path
        d="M13 7.5h6v5.5M13 7.5v5.5H7.5v6H13v5.5h6V19"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M19 19h1.2l1.6-3.6 2.2 6.1 1.6-2.5h1.4" fill="none" stroke="#5eead4" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ className, tone = "dark" }: { className?: string; tone?: "dark" | "light" }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="leading-none">
        <span className={cn("block text-[15px] font-semibold tracking-tight", tone === "light" ? "text-white" : "text-ink")}>
          EDOS<span className="text-[#5eead4]">HMIS</span>
        </span>
        <span className={cn("mt-0.5 block text-[10.5px] tracking-wide", tone === "light" ? "text-shell-ink-faint" : "text-ink-faint")}>
          Hospital management
        </span>
      </span>
    </span>
  );
}
