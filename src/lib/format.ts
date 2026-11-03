/** Kenyan conventions: Nairobi time, day-month-year, KSh. */
const TZ = "Africa/Nairobi";

export const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric" }).format(new Date(d)) : "—";

export const fmtDateTime = (d: string | Date | null | undefined) =>
  d
    ? new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(
        new Date(d),
      )
    : "—";

export const fmtTime = (d: string | Date | null | undefined) =>
  d ? new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(d)) : "—";

export const ksh = (n: number | string | null | undefined) =>
  `KSh ${Number(n ?? 0).toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** Nairobi calendar date, YYYY-MM-DD. */
export const todayNairobi = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());

/** A datetime-local value ("2026-11-03T14:05") in Nairobi time, for form defaults. */
export function nairobiLocalInput(d: Date = new Date()) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(d)
    .reduce<Record<string, string>>((a, x) => ((a[x.type] = x.value), a), {});
  return `${p.year}-${p.month}-${p.day}T${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
}

/** A datetime-local value typed in Nairobi time → ISO instant. Kenya has no DST. */
export const fromNairobiLocal = (v: string) => (v ? new Date(`${v}:00+03:00`).toISOString() : null);

/** An instant `h` hours before now, as ISO — for "since" filters. */
export const hoursAgoIso = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
/** The Nairobi date `d` days from today, YYYY-MM-DD. */
export const dateInDays = (d: number) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(Date.now() + d * 86_400_000));
/** Now, in epoch ms — kept here so render code stays free of direct clock reads. */
export const nowMs = () => Date.now();

export function ageOf(dob: string | null | undefined, estimated = false) {
  if (!dob) return "Age unknown";
  const b = new Date(dob);
  const now = new Date();
  let years = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) years--;
  const pre = estimated ? "~" : "";
  if (years >= 2) return `${pre}${years} y`;
  const months = Math.max(0, years * 12 + m - (now.getDate() < b.getDate() ? 1 : 0));
  if (months >= 1) return `${pre}${months} mo`;
  return `${Math.max(0, Math.floor((now.getTime() - b.getTime()) / 86_400_000))} d`;
}

/** Days in hospital, the admission day counting as day 1. */
export function lengthOfStay(admittedAt: string, until?: string | null) {
  const a = new Date(admittedAt).getTime();
  const b = until ? new Date(until).getTime() : Date.now();
  return Math.max(1, Math.ceil((b - a) / 86_400_000));
}

export const fullName = (p: { first_name: string; middle_name?: string | null; last_name: string }) =>
  [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(" ");

export const titleCase = (s: string | null | undefined) => (s ?? "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** "0712 345 678", "712345678", "+254 712…" → "+254712345678"; blank → null; not a Kenyan mobile → undefined. */
export function normalisePhone(raw: string | null | undefined) {
  const d = (raw ?? "").replace(/[^\d+]/g, "");
  if (!d) return null;
  const m = d.match(/^(?:\+?254|0)?([17]\d{8})$/);
  return m ? `+254${m[1]}` : undefined;
}
