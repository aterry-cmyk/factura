import type { Lang } from "@/lib/types";

/**
 * Grouped bars, one group per month, drawn as SVG on the server. Two series at most, colours from
 * --chart-1/--chart-2 (checked for colour-blind readers in both themes). Each bar has a hover
 * label; the latest month is labelled directly; a hidden table carries the same numbers.
 */
export function MonthBars({
  lang, months, series, money, title,
}: {
  lang: Lang;
  months: string[];
  series: { name: string; values: number[]; color: "1" | "2" }[];
  money: (cents: number) => string;
  title: string;
}) {
  const W = 640, H = 220, left = 56, right = 8, top = 12, bottom = 28;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const step = niceStep(max / 3);
  const yMax = Math.ceil(max / step) * step;
  const plotW = W - left - right, plotH = H - top - bottom;
  const groupW = plotW / months.length;
  const barW = Math.min(28, (groupW - 16 - 2 * (series.length - 1)) / series.length);
  const y = (v: number) => top + plotH - (v / yMax) * plotH;
  const label = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString(lang === "es" ? "es-US" : "en-US", { month: "short", timeZone: "UTC" });
  const short = (cents: number) => {
    const d = cents / 100;
    return d >= 1000 ? `$${(d / 1000).toFixed(d >= 10000 ? 0 : 1).replace(/\.0$/, "")}k` : `$${Math.round(d)}`;
  };
  const ticks = Array.from({ length: Math.round(yMax / step) + 1 }, (_, i) => i * step);

  return (
    <figure className="chart">
      <figcaption className="chart-head">
        <span className="chart-title">{title}</span>
        <span className="legend">
          {series.map((s) => <span key={s.name}><i className={`sw sw${s.color}`} />{s.name}</span>)}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="chart-svg">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={W - right} y1={y(t)} y2={y(t)} className={t === 0 ? "axis" : "grid"} />
            <text x={left - 8} y={y(t) + 4} textAnchor="end" className="tick">{short(t)}</text>
          </g>
        ))}
        {months.map((m, i) => {
          const gx = left + i * groupW + (groupW - (barW * series.length + 2 * (series.length - 1))) / 2;
          return (
            <g key={m}>
              {series.map((s, j) => {
                const v = s.values[i];
                const h = Math.max(0, y(0) - y(v));
                const x = gx + j * (barW + 2);
                const r = Math.min(4, h, barW / 2);
                return (
                  <g key={s.name}>
                    <title>{`${label(m)} · ${s.name}: ${money(v)}`}</title>
                    {/* A taller invisible target so small bars are easy to hover. */}
                    <rect x={x} y={top} width={barW} height={plotH} fill="transparent" />
                    {h > 0 && (
                      <path className={`bar bar${s.color}`} d={`M${x},${y(0)} v${-(h - r)} q0,${-r} ${r},${-r} h${barW - 2 * r} q${r},0 ${r},${r} v${h - r} z`} />
                    )}
                    {i === months.length - 1 && v > 0 && (
                      <text x={x + barW / 2} y={y(v) - 5} textAnchor="middle" className="val">{short(v)}</text>
                    )}
                  </g>
                );
              })}
              <text x={left + i * groupW + groupW / 2} y={H - 8} textAnchor="middle" className="tick">{label(m)}</text>
            </g>
          );
        })}
      </svg>
      <table className="sr">
        <caption>{title}</caption>
        <thead><tr><th>{lang === "es" ? "Mes" : "Month"}</th>{series.map((s) => <th key={s.name}>{s.name}</th>)}</tr></thead>
        <tbody>{months.map((m, i) => <tr key={m}><td>{label(m)}</td>{series.map((s) => <td key={s.name}>{money(s.values[i])}</td>)}</tr>)}</tbody>
      </table>
    </figure>
  );
}

/** 1, 2 or 5 times a power of ten, so the axis reads $500, $1k, $2k… */
function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}
