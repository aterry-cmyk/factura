/**
 * A ring chart drawn on the server: one arc per part, a 2px gap between parts, the total in the
 * middle, and a legend that carries every value as text (colour is never the only cue).
 */
export function Donut({
  parts, center, sub, title, money,
}: {
  parts: { label: string; value: number; color: string }[];
  center: string;
  sub: string;
  title: string;
  money: (v: number) => string;
}) {
  const total = parts.reduce((t, p) => t + p.value, 0);
  const r = 46, c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <figure className="donut">
      <figcaption className="donut-title">{title}</figcaption>
      <div className="donut-ring">
        <svg viewBox="0 0 120 120" role="img" aria-label={`${title}: ${parts.map((p) => `${p.label} ${money(p.value)}`).join(", ")}`}>
          <circle cx="60" cy="60" r={r} fill="none" stroke="var(--line)" strokeWidth="14" />
          {total > 0 && parts.filter((p) => p.value > 0).map((p) => {
            const len = (p.value / total) * c;
            const gap = parts.filter((x) => x.value > 0).length > 1 ? 2 : 0;
            const el = (
              <circle key={p.label} cx="60" cy="60" r={r} fill="none" stroke={p.color} strokeWidth="14"
                strokeDasharray={`${Math.max(0, len - gap)} ${c}`} strokeDashoffset={-offset} transform="rotate(-90 60 60)">
                <title>{`${p.label}: ${money(p.value)}`}</title>
              </circle>
            );
            offset += len;
            return el;
          })}
        </svg>
        <div className="donut-center"><b>{center}</b><span>{sub}</span></div>
      </div>
      <ul className="donut-legend">
        {parts.map((p) => (
          <li key={p.label}><i style={{ background: p.color }} /><span>{p.label}</span><b>{money(p.value)}</b></li>
        ))}
      </ul>
    </figure>
  );
}
