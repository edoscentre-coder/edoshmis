import { fmtDateTime } from "@/lib/format";

/**
 * One observation over time — a small multiple. Each vital gets its own
 * panel and its own scale (never two on one axis); a single series, so the
 * panel title names it and there is no legend. 2px line, 8px points with a
 * 2px surface ring, a native tooltip per point, and the last value labelled.
 * The readings table on the same tab is the table view.
 */
export function ObsTrend({ title, unit, points }: { title: string; unit?: string; points: { at: string; v: number }[] }) {
  const W = 300;
  const H = 96;
  const pad = { t: 10, r: 34, b: 14, l: 6 };
  const last = points[points.length - 1];
  if (!points.length) {
    return (
      <div className="rounded-xl border border-line bg-surface p-3">
        <p className="text-xs font-medium text-ink-soft">{title}</p>
        <p className="py-6 text-center text-xs text-ink-faint">No readings</p>
      </div>
    );
  }
  const vs = points.map((p) => p.v);
  let lo = Math.min(...vs);
  let hi = Math.max(...vs);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const t0 = new Date(points[0].at).getTime();
  const t1 = Math.max(t0 + 1, new Date(last.at).getTime());
  const x = (at: string) => pad.l + ((new Date(at).getTime() - t0) / (t1 - t0)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const d = points.map((p, i) => `${i ? "L" : "M"}${points.length === 1 ? W / 2 : x(p.at)},${y(p.v)}`).join(" ");

  return (
    <figure className="rounded-xl border border-line bg-surface p-3">
      <figcaption className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-ink-soft">{title}</span>
        <span className="tnum text-ink-faint">
          {Math.min(...vs)}–{Math.max(...vs)}
          {unit ? ` ${unit}` : ""}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 h-auto w-full" role="img" aria-label={`${title}: latest ${last.v}${unit ? ` ${unit}` : ""}`}>
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="#e3e8ef" strokeWidth={1} />
        <path d={d} fill="none" stroke="#1a5fb4" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => {
          const cx = points.length === 1 ? W / 2 : x(p.at);
          return (
            <g key={i}>
              <title>{`${fmtDateTime(p.at)}: ${p.v}${unit ? ` ${unit}` : ""}`}</title>
              <circle cx={cx} cy={y(p.v)} r={10} fill="transparent" />
              <circle cx={cx} cy={y(p.v)} r={4} fill="#1a5fb4" stroke="#ffffff" strokeWidth={2} />
            </g>
          );
        })}
        <text x={W - pad.r + 6} y={y(last.v) + 4} className="fill-ink text-[11px] font-semibold">
          {last.v}
        </text>
      </svg>
    </figure>
  );
}
