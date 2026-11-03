/**
 * Admissions and discharges per day, last 14 days — paired columns.
 *
 * Two series, so a legend; colours are the validated pair (brand blue,
 * clinical teal — dataviz validator: all checks pass, CVD ΔE 20.9). Columns
 * are thin with a 4px rounded top on a single baseline; every column carries
 * a native hover tooltip with its exact value, and the same numbers are in a
 * table below for screen readers and anyone who prefers rows.
 */
export function AdmissionsTrend({ days }: { days: { day: string; admitted: number; discharged: number }[] }) {
  const W = 640;
  const H = 180;
  const pad = { top: 12, right: 8, bottom: 22, left: 26 };
  const max = Math.max(1, ...days.flatMap((d) => [d.admitted, d.discharged]));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const band = (W - pad.left - pad.right) / Math.max(1, days.length);
  const bar = Math.min(12, Math.max(4, band / 2 - 3));
  const y = (v: number) => pad.top + (H - pad.top - pad.bottom) * (1 - v / top);
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  const label = (iso: string) => new Date(`${iso}T12:00:00+03:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Nairobi" });
  const total = days.reduce((a, d) => a + d.admitted + d.discharged, 0);

  return (
    <figure>
      <div className="mb-2 flex items-center gap-4 text-xs text-ink-soft">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-[#1a5fb4]" aria-hidden="true" />
          Admitted
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-[#0f9d8a]" aria-hidden="true" />
          Discharged
        </span>
      </div>
      {total === 0 ? (
        <p className="py-8 text-center text-sm text-ink-faint">No admissions or discharges in the last 14 days.</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Admissions and discharges per day, last 14 days">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} stroke="#e3e8ef" strokeWidth={1} />
              <text x={pad.left - 6} y={y(t) + 3.5} textAnchor="end" className="fill-ink-faint text-[10px]">
                {t}
              </text>
            </g>
          ))}
          {days.map((d, i) => {
            const cx = pad.left + band * i + band / 2;
            return (
              <g key={d.day}>
                <Column x={cx - bar - 1} w={bar} v={d.admitted} y={y} base={y(0)} fill="#1a5fb4" tip={`${label(d.day)}: ${d.admitted} admitted`} />
                <Column x={cx + 1} w={bar} v={d.discharged} y={y} base={y(0)} fill="#0f9d8a" tip={`${label(d.day)}: ${d.discharged} discharged`} />
                {(i % 2 === days.length % 2 || days.length <= 7) && (
                  <text x={cx} y={H - 6} textAnchor="middle" className="fill-ink-faint text-[10px]">
                    {label(d.day)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      <details className="mt-2 text-xs text-ink-soft">
        <summary className="cursor-pointer text-ink-faint hover:text-ink">Show as table</summary>
        <table className="tnum mt-2 w-full">
          <thead>
            <tr className="text-left text-ink-faint">
              <th className="py-1 font-medium">Day</th>
              <th className="py-1 text-right font-medium">Admitted</th>
              <th className="py-1 text-right font-medium">Discharged</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.day} className="border-t border-line">
                <td className="py-1">{label(d.day)}</td>
                <td className="py-1 text-right">{d.admitted}</td>
                <td className="py-1 text-right">{d.discharged}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

function Column({ x, w, v, y, base, fill, tip }: { x: number; w: number; v: number; y: (v: number) => number; base: number; fill: string; tip: string }) {
  const h = base - y(v);
  const r = Math.min(4, h, w / 2);
  return (
    <g>
      <title>{tip}</title>
      {/* Hit target wider and taller than the mark. */}
      <rect x={x - 2} y={y(v) - 6} width={w + 4} height={h + 6} fill="transparent" />
      {v > 0 && <path d={`M${x},${base} V${base - h + r} Q${x},${base - h} ${x + r},${base - h} H${x + w - r} Q${x + w},${base - h} ${x + w},${base - h + r} V${base} Z`} fill={fill} />}
    </g>
  );
}

function niceStep(max: number) {
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / mag;
  return Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag);
}
