"use client";

import { useState } from "react";
import { burdenPercent, burdenedHourlyCents, manDayCents, roleLabel, WORKER_ROLES, type LaborBurden, type Worker, type WorkerRole } from "@/lib/costs";
import { formatMoney, parseMoney } from "@/lib/money";
import type { Lang } from "@/lib/types";

const L = (lang: Lang, es: string, en: string) => (lang === "es" ? es : en);

/** The crew and what an hour of each worker really costs: wage plus the owner's burden. */
export function CrewSettings(props: { lang: Lang; workers: Worker[]; burden: LaborBurden }) {
  const { lang } = props;
  const [workers, setWorkers] = useState(props.workers);
  const [burden, setBurden] = useState({ workersComp: String(props.burden.workersComp || ""), liability: String(props.burden.liability || ""), payrollTax: String(props.burden.payrollTax || "") });
  const [saved, setSaved] = useState<LaborBurden>(props.burden);
  const [name, setName] = useState("");
  const [role, setRole] = useState<WorkerRole>("journeyman");
  const [wage, setWage] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);

  async function saveBurden(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body = { workersComp: Number(burden.workersComp || 0), liability: Number(burden.liability || 0), payrollTax: Number(burden.payrollTax || 0) };
    const res = await fetch("/api/settings/burden", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setSaved(body);
      setNote({ kind: "ok", text: L(lang, "Cargas guardadas.", "Burden saved.") });
    } else setNote({ kind: "bad", text: L(lang, "Usa porcentajes entre 0 y 100.", "Use percentages between 0 and 100.") });
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const cents = parseMoney(wage);
    if (!name.trim() || cents == null) return setNote({ kind: "bad", text: L(lang, "Nombre y salario por hora, por ejemplo 28.", "Name and hourly wage, for example 28.") });
    setBusy(true);
    const res = await fetch("/api/workers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, role, hourlyCents: cents }) }).catch(() => null);
    const json = res ? ((await res.json().catch(() => ({}))) as { worker?: Worker; errors?: string[] }) : {};
    setBusy(false);
    if (res?.ok && json.worker) {
      setWorkers((w) => [...w, json.worker!]);
      setName("");
      setWage("");
      setNote(null);
    } else setNote({ kind: "bad", text: json.errors?.join(" ") ?? L(lang, "No se pudo agregar.", "Couldn't add them.") });
  }

  async function remove(w: Worker) {
    if (!confirm(L(lang, `¿Quitar a ${w.name}?`, `Remove ${w.name}?`))) return;
    const res = await fetch(`/api/workers/${w.id}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) setWorkers((list) => list.filter((x) => x.id !== w.id));
  }

  return (
    <div className="stack">
      <form className="card" onSubmit={saveBurden} data-testid="burden">
        <h3 style={{ marginTop: 0 }}>{L(lang, "Cargas sobre el salario", "Burden on wages")}</h3>
        <p className="muted small">{L(lang, "Lo que te cuesta cada hora además del salario, en porcentaje. Tus números; Loro no los adivina.", "What each hour costs you on top of the wage, in percent. Your numbers; Loro doesn't guess them.")}</p>
        <div className="grid2">
          <label className="field"><span className="field-label">{L(lang, "Seguro de compensación (workers' comp) %", "Workers' compensation %")}</span><input inputMode="decimal" value={burden.workersComp} onChange={(e) => setBurden({ ...burden, workersComp: e.target.value })} placeholder="9.58" data-testid="burden-wc" /></label>
          <label className="field"><span className="field-label">{L(lang, "Responsabilidad civil %", "General liability %")}</span><input inputMode="decimal" value={burden.liability} onChange={(e) => setBurden({ ...burden, liability: e.target.value })} placeholder="2.5" data-testid="burden-gl" /></label>
          <label className="field"><span className="field-label">{L(lang, "Impuestos de nómina %", "Payroll taxes %")}</span><input inputMode="decimal" value={burden.payrollTax} onChange={(e) => setBurden({ ...burden, payrollTax: e.target.value })} placeholder="14" data-testid="burden-tax" /></label>
          <div className="field"><span className="field-label">{L(lang, "Carga total", "Total burden")}</span><strong style={{ fontSize: 22 }} data-testid="burden-total">{burdenPercent(saved).toFixed(2)}%</strong></div>
        </div>
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
          <button className="btn primary" disabled={busy} data-testid="save-burden">{L(lang, "Guardar cargas", "Save burden")}</button>
        </div>
      </form>

      <section className="card" data-testid="crew">
        <h3 style={{ marginTop: 0 }}>{L(lang, "Cuadrilla", "Crew")}</h3>
        <table className="doc" style={{ width: "100%" }}>
          <thead><tr><th style={{ textAlign: "left" }}>{L(lang, "Nombre", "Name")}</th><th style={{ textAlign: "left" }}>{L(lang, "Puesto", "Role")}</th><th style={{ textAlign: "right" }}>{L(lang, "Salario / h", "Wage / h")}</th><th style={{ textAlign: "right" }}>{L(lang, "Costo real / h", "True cost / h")}</th><th style={{ textAlign: "right" }}>{L(lang, "Por día (8 h)", "Per day (8 h)")}</th><th /></tr></thead>
          <tbody>
            {workers.map((w) => (
              <tr key={w.id} data-testid="worker" style={{ opacity: w.active ? 1 : 0.5 }}>
                <td>{w.name}</td>
                <td>{roleLabel(w.role, lang)}</td>
                <td style={{ textAlign: "right" }}>{formatMoney(w.hourlyCents, lang)}</td>
                <td style={{ textAlign: "right" }}>{formatMoney(burdenedHourlyCents(w, saved), lang)}</td>
                <td style={{ textAlign: "right" }}>{formatMoney(manDayCents(w, saved), lang)}</td>
                <td style={{ textAlign: "right" }}><button type="button" className="btn small" onClick={() => remove(w)} aria-label={L(lang, `Quitar a ${w.name}`, `Remove ${w.name}`)}>×</button></td>
              </tr>
            ))}
            {workers.length === 0 && <tr><td colSpan={6} className="muted">{L(lang, "Todavía no hay nadie. Agrega a tu gente para anotar horas por nombre.", "Nobody yet. Add your people to log hours by name.")}</td></tr>}
          </tbody>
        </table>
        <form className="row" onSubmit={add} style={{ marginTop: 12, flexWrap: "wrap" }}>
          <input className="grow" value={name} onChange={(e) => setName(e.target.value)} placeholder={L(lang, "Nombre", "Name")} maxLength={80} aria-label={L(lang, "Nombre del trabajador", "Worker name")} data-testid="worker-name" />
          <select value={role} onChange={(e) => setRole(e.target.value as WorkerRole)} aria-label={L(lang, "Puesto", "Role")}>
            {WORKER_ROLES.map((r) => <option key={r} value={r}>{roleLabel(r, lang)}</option>)}
          </select>
          <input value={wage} onChange={(e) => setWage(e.target.value)} inputMode="decimal" placeholder={L(lang, "$ por hora", "$ per hour")} style={{ width: 120 }} aria-label={L(lang, "Salario por hora", "Hourly wage")} data-testid="worker-wage" />
          <button className="btn primary" disabled={busy} data-testid="add-worker">{L(lang, "Agregar", "Add")}</button>
        </form>
        {note && <p className={`note ${note.kind}`} role="status" style={{ marginTop: 8 }}>{note.text}</p>}
      </section>
    </div>
  );
}
