"use client";

import { useState } from "react";
import { addDays, daysBetween } from "@/lib/money";
import type { Milestone } from "@/lib/projects";
import { DEFAULT_DAYS, layoutSchedule, scheduleSpan, scheduleStatus } from "@/lib/schedule";
import type { Lang } from "@/lib/types";

const L = (lang: Lang, es: string, en: string) => (lang === "es" ? es : en);

/**
 * The project's timeline: a Gantt of the milestones laid end to end from the start date, with
 * today's line and whether the work is ahead or behind the calendar. The owner sets the start
 * and each stage's days; the planner's days are the starting point.
 */
export function Schedule(props: { lang: Lang; projectId: string; startsOn: string | null; milestones: Milestone[]; percentDone: number; today: string }) {
  const { lang, projectId, today } = props;
  const [startsOn, setStartsOn] = useState(props.startsOn ?? today);
  const [days, setDays] = useState<Record<string, string>>(Object.fromEntries(props.milestones.map((m) => [m.id, String(m.days ?? DEFAULT_DAYS)])));
  const [saved, setSaved] = useState(Boolean(props.startsOn));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);

  const laid = layoutSchedule(props.milestones.map((m) => ({ ...m, days: Number(days[m.id]) || DEFAULT_DAYS })), startsOn);
  const span = scheduleSpan(laid)!;
  const status = scheduleStatus(span, today, props.percentDone);
  const fmt = (d: string) => new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

  async function save() {
    setBusy(true);
    setNote(null);
    const res = await fetch(`/api/projects/${projectId}/schedule`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startsOn, milestones: props.milestones.map((m) => ({ id: m.id, days: Number(days[m.id]) || DEFAULT_DAYS })) }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) { setSaved(true); setNote({ kind: "ok", text: L(lang, "Cronograma guardado. El cliente lo ve en su enlace.", "Schedule saved. The customer sees it on their link.") }); }
    else setNote({ kind: "bad", text: L(lang, "No se pudo guardar. Los días van de 1 a 365.", "Couldn't save. Days go from 1 to 365.") });
  }

  // The chart: one row per milestone, a week grid, today's line.
  const W = 760, left = 190, right = 24, rowH = 34, top = 48;
  const totalDays = Math.max(7, daysBetween(span.startsOn, span.endsOn) + 1);
  const x = (d: string) => left + ((daysBetween(span.startsOn, d)) / totalDays) * (W - left - right);
  const H = top + rowH * laid.length + 20;
  const weeks: string[] = [];
  for (let d = span.startsOn; d <= span.endsOn; d = addDays(d, 7)) weeks.push(d);
  const todayX = today >= span.startsOn && today <= span.endsOn ? x(today) : null;

  return (
    <div className="stack" data-testid="schedule">
      <section className="card">
        <div className="row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
          <label className="field">
            <span className="field-label">{L(lang, "Empieza el", "Starts on")}</span>
            <input type="date" value={startsOn} onChange={(e) => { setStartsOn(e.target.value || today); setSaved(false); }} data-testid="starts-on" />
          </label>
          <div className="field"><span className="field-label">{L(lang, "Termina el", "Ends on")}</span><strong data-testid="ends-on">{fmt(span.endsOn)}</strong></div>
          <div className="field"><span className="field-label">{L(lang, "Duración", "Duration")}</span><strong>{span.days} {L(lang, "días", "days")}</strong></div>
          <div className="grow" />
          <button type="button" className="btn primary" onClick={save} disabled={busy || saved} data-testid="save-schedule">{busy ? L(lang, "Guardando…", "Saving…") : saved ? L(lang, "Guardado", "Saved") : L(lang, "Guardar cronograma", "Save schedule")}</button>
        </div>
        {saved && todayX !== null && (
          <p className={`note ${status.behind ? "warn" : ""}`} style={{ marginTop: 10 }} data-testid="schedule-status">
            {status.behind
              ? L(lang, `Según el calendario el trabajo debería ir al ${status.expectedPercent}% y va al ${props.percentDone}%. Quedan ${status.daysLeft} días.`, `By the calendar the work should be ${status.expectedPercent}% done and it is ${props.percentDone}%. ${status.daysLeft} days left.`)
              : L(lang, `Al día: el calendario pide ${status.expectedPercent}% y el trabajo va al ${props.percentDone}%. Quedan ${status.daysLeft} días.`, `On track: the calendar asks for ${status.expectedPercent}% and the work is at ${props.percentDone}%. ${status.daysLeft} days left.`)}
          </p>
        )}
        {note && <p className={`note ${note.kind}`} role="status" style={{ marginTop: 10 }}>{note.text}</p>}
      </section>

      <section className="card" style={{ overflowX: "auto" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={L(lang, "Cronograma del proyecto", "Project timeline")} style={{ minWidth: 560, fontSize: 12 }}>
          {weeks.map((d) => (
            <g key={d}>
              <line x1={x(d)} x2={x(d)} y1={top - 8} y2={H - 16} stroke="var(--line)" />
              <text x={x(d) + 3} y={top - 14} fill="var(--muted)" fontSize="11">{fmt(d)}</text>
            </g>
          ))}
          {laid.map((m, i) => {
            const y = top + i * rowH;
            const w = Math.max(6, x(addDays(m.endsOn, 1)) - x(m.startsOn));
            const fill = m.status === "paid" ? "var(--accent)" : m.status === "invoiced" ? "var(--sun)" : "var(--line)";
            return (
              <g key={m.id} data-testid="gantt-row">
                <text x={8} y={y + 20} fill="var(--ink)" fontWeight="600" fontSize="12">{`${m.position + 1}. ${m.name}`.slice(0, 28)}</text>
                <rect x={x(m.startsOn)} y={y + 7} width={w} height={rowH - 14} rx="7" fill={fill} stroke="var(--ink)" strokeOpacity="0.25" />
                <text x={x(m.startsOn) + 6} y={y + 20} fill="var(--ink)" fontSize="11">{`${fmt(m.startsOn)} – ${fmt(m.endsOn)} · ${m.days}d`}</text>
              </g>
            );
          })}
          {todayX !== null && (
            <g>
              <line x1={todayX} x2={todayX} y1={top - 8} y2={H - 16} stroke="var(--crest)" strokeWidth="2" strokeDasharray="4 3" />
              <text x={todayX + 4} y={H - 4} fill="var(--crest)" fontSize="11" fontWeight="600">{L(lang, "Hoy", "Today")}</text>
            </g>
          )}
        </svg>
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>{L(lang, "Días por hito", "Days per milestone")}</h3>
        <p className="muted small">{L(lang, "Loro propuso estos días por el ritmo normal del oficio; cámbialos a los tuyos. Las fechas van una tras otra.", "Loro proposed these days from the trade's usual pace; change them to yours. The dates run one after another.")}</p>
        <table className="doc" style={{ width: "100%" }}>
          <tbody>
            {laid.map((m) => (
              <tr key={m.id}>
                <td>{m.position + 1}. {m.name}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <input type="number" min={1} max={365} value={days[m.id] ?? ""} onChange={(e) => { setDays({ ...days, [m.id]: e.target.value }); setSaved(false); }} style={{ width: 70 }} aria-label={L(lang, `Días de ${m.name}`, `Days for ${m.name}`)} data-testid="milestone-days" /> {L(lang, "días", "days")}
                </td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }} className="muted">{fmt(m.startsOn)} – {fmt(m.endsOn)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
