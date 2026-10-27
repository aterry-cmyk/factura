"use client";

import { useState } from "react";
import { shrinkPhoto } from "@/components/shrinkPhoto";
import type { CostDraft, ReceiptReading } from "@/lib/ai/costs";
import { COST_CODES, codeLabel, type Budgets, type Cost, type CostCode, type Pnl, type Worker } from "@/lib/costs";
import { formatMoney, parseMoney } from "@/lib/money";
import type { Lang } from "@/lib/types";
import { blockMessage } from "@/lib/plans";

const L = (lang: Lang, es: string, en: string) => (lang === "es" ? es : en);

interface Pending extends CostDraft { key: number; amountText: string; confirmed: boolean }
let nextKey = 1;

/**
 * The project's money, on the project page: the budget per cost code, what was spent (said,
 * typed, or from a receipt photo; every entry confirmed by the owner before it is saved), and the
 * P&L at a glance. Nothing the model proposes is saved until the owner taps "Guardar".
 */
export function ProjectMoney(props: { lang: Lang; projectId: string; budgets: Budgets; costs: Cost[]; pnl: Pnl; signal: string | null; workers: Worker[]; aiReady: boolean; today: string }) {
  const { lang, projectId, workers, aiReady, today } = props;
  const [budgets, setBudgets] = useState<Record<CostCode, string>>(Object.fromEntries(COST_CODES.map((c) => [c, props.budgets[c] ? (props.budgets[c] / 100).toFixed(2) : ""])) as Record<CostCode, string>);
  const [budgetsDirty, setBudgetsDirty] = useState(false);
  const [costs, setCosts] = useState(props.costs);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [receiptPhotoId, setReceiptPhotoId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: "ok" | "bad" | "warn"; text: string } | null>(null);
  const money = (c: number) => formatMoney(c, lang);
  const errorText = (res: Response | null, json: { error?: string; errors?: string[] }, fallback: string) =>
    res?.status === 402 ? (blockMessage(json.error, lang) ?? fallback)
    : json.error === "ai_setup" ? L(lang, "Loro no está conectado todavía (falta la clave de IA). Escribe el gasto a mano.", "Loro isn't connected yet (the AI key is missing). Type the cost yourself.")
    : json.errors?.length ? json.errors.join(" ") : fallback;

  async function saveBudgets(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, number> = {};
    for (const c of COST_CODES) {
      const cents = budgets[c].trim() ? parseMoney(budgets[c]) : 0;
      if (cents == null) return setNote({ kind: "bad", text: L(lang, `${codeLabel(c, lang)}: escribe un monto como 4500.`, `${codeLabel(c, lang)}: enter an amount like 4500.`) });
      body[c] = cents;
    }
    setBusy("budgets");
    const res = await fetch(`/api/projects/${projectId}/budgets`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    setBusy(null);
    if (res?.ok) {
      setBudgetsDirty(false);
      window.location.reload();
    } else setNote({ kind: "bad", text: L(lang, "No se pudo guardar el presupuesto.", "The budget couldn't be saved.") });
  }

  function addPending(list: CostDraft[]) {
    setPending((p) => [...p, ...list.map((d) => ({ ...d, key: nextKey++, amountText: (d.amountCents / 100).toFixed(2), confirmed: !d.needsConfirm }))]);
  }

  async function parse() {
    if (!text.trim()) return;
    setBusy("parse");
    setNote(null);
    const res = await fetch(`/api/projects/${projectId}/costs/parse`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }).catch(() => null);
    const json = res ? ((await res.json().catch(() => ({}))) as { entries?: CostDraft[]; error?: string }) : {};
    setBusy(null);
    if (res?.ok && json.entries) {
      addPending(json.entries);
      setText("");
      return;
    }
    setNote({ kind: json.error === "nothing_found" ? "warn" : "bad", text: json.error === "nothing_found" ? L(lang, "No encontré un gasto en eso. Di qué compraste o quién trabajó y cuántas horas.", "I didn't find a cost in that. Say what you bought, or who worked and how many hours.") : errorText(res, json, L(lang, "No se pudo leer. Intenta otra vez o escribe el gasto a mano.", "Couldn't read that. Try again or type the cost yourself.")) });
  }

  function manual() {
    addPending([{ code: "materials", amountCents: 0, description: "", vendor: "", spentOn: today, workerId: null, workerName: "", hours: null, needsConfirm: true, basis: "typed" }]);
  }

  async function receipt(file: File) {
    setBusy("receipt");
    setNote(null);
    const body = new FormData();
    body.append("photo", await shrinkPhoto(file, 1600), "recibo.jpg");
    const res = await fetch(`/api/projects/${projectId}/costs/receipt`, { method: "POST", body }).catch(() => null);
    const json = res ? ((await res.json().catch(() => ({}))) as { reading?: ReceiptReading; photoId?: string; error?: string }) : {};
    setBusy(null);
    if (res?.ok && json.reading) {
      const r = json.reading;
      setReceiptPhotoId(json.photoId ?? null);
      addPending([{ code: "materials", amountCents: r.totalCents, description: r.lines.map((l) => l.description).slice(0, 6).join(", ") || L(lang, "Recibo", "Receipt"), vendor: r.vendor, spentOn: r.date && r.date <= today ? r.date : today, workerId: null, workerName: "", hours: null, needsConfirm: true, basis: "receipt" }]);
      setNote({ kind: "ok", text: L(lang, `Leí el recibo: ${r.vendor || "sin nombre"}, ${money(r.totalCents)}. Revisa y guarda.`, `I read the receipt: ${r.vendor || "no name"}, ${money(r.totalCents)}. Check it and save.`) });
      return;
    }
    setNote({ kind: json.error === "unreadable" ? "warn" : "bad", text: json.error === "unreadable" ? L(lang, "No pude leer un total en esa foto. Toma la foto del recibo completo, con buena luz.", "I couldn't read a total on that photo. Photograph the whole receipt in good light.") : errorText(res, json, L(lang, "No se pudo leer el recibo.", "The receipt couldn't be read.")) });
  }

  function edit(key: number, patch: Partial<Pending>) {
    setPending((p) => p.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  }

  async function saveAll() {
    setNote(null);
    const rows = pending.map((p) => ({ p, cents: parseMoney(p.amountText) }));
    const bad = rows.find((r) => r.cents == null || (r.p.needsConfirm && !r.p.confirmed));
    if (bad) return setNote({ kind: "warn", text: L(lang, "Confirma cada monto (marca la casilla) y escribe montos como 340 o 42.50.", "Confirm every amount (tick the box) and write amounts like 340 or 42.50.") });
    setBusy("save");
    const saved: Cost[] = [];
    for (const { p, cents } of rows) {
      const res = await fetch(`/api/projects/${projectId}/costs`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: p.code, amountCents: cents, description: p.description, vendor: p.vendor, spentOn: p.spentOn, source: p.basis === "receipt" ? "receipt" : p.basis === "typed" ? "typed" : "voice", workerId: p.workerId, hours: p.hours, receiptPhotoId: p.basis === "receipt" ? receiptPhotoId : null }),
      }).catch(() => null);
      const json = res ? ((await res.json().catch(() => ({}))) as { cost?: Cost; errors?: string[] }) : {};
      if (!res?.ok || !json.cost) {
        setBusy(null);
        return setNote({ kind: "bad", text: json.errors?.join(" ") ?? L(lang, "No se pudo guardar un gasto.", "A cost couldn't be saved.") });
      }
      saved.push(json.cost);
    }
    setCosts((c) => [...saved, ...c]);
    setPending([]);
    setReceiptPhotoId(null);
    setBusy(null);
    setNote({ kind: "ok", text: L(lang, `Guardado: ${saved.length} gasto${saved.length === 1 ? "" : "s"}. El P&L se actualiza al recargar.`, `Saved ${saved.length} cost${saved.length === 1 ? "" : "s"}. The P&L updates on reload.`) });
    setTimeout(() => window.location.reload(), 900);
  }

  async function remove(c: Cost) {
    if (!confirm(L(lang, "¿Quitar este gasto?", "Remove this cost?"))) return;
    const res = await fetch(`/api/projects/${projectId}/costs/${c.id}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) setCosts((list) => list.filter((x) => x.id !== c.id));
  }

  const { pnl } = props;
  return (
    <div className="stack">
      <section className="card" data-testid="pnl-card">
        <div className="row" style={{ alignItems: "baseline" }}>
          <h3 className="grow" style={{ margin: 0 }}>{L(lang, "Ganancia o pérdida", "Profit and loss")}</h3>
          <a className="btn small" href={`/projects/${projectId}/pnl`}>{L(lang, "Por día, semana y mes", "By day, week and month")}</a>
        </div>
        <div className="tiles" style={{ margin: "10px 0 0" }}>
          <div className="tile"><span className="kpi-label">{L(lang, "Gastado", "Spent")}</span><span className="tile-value" data-testid="spent">{money(pnl.spentCents)}</span></div>
          <div className="tile"><span className="kpi-label">{L(lang, "Presupuesto", "Budget")}</span><span className="tile-value">{money(pnl.budgetCents)}</span></div>
          <div className={`tile ${pnl.margin.soFarCents < 0 ? "bad" : "good"}`}><span className="kpi-label">{L(lang, "Margen hasta hoy", "Margin so far")}</span><span className="tile-value" data-testid="margin-so-far">{money(pnl.margin.soFarCents)}</span></div>
          <div className={`tile ${pnl.margin.projectedCents < 0 ? "bad" : ""}`}><span className="kpi-label">{L(lang, "Margen proyectado", "Projected margin")}</span><span className="tile-value" data-testid="margin-projected">{money(pnl.margin.projectedCents)}{pnl.margin.projectedPercent != null ? ` · ${pnl.margin.projectedPercent}%` : ""}</span></div>
        </div>
        {props.signal && <p className="note warn" style={{ marginTop: 10 }} data-testid="pnl-signal">{props.signal}</p>}
        <table className="doc" style={{ width: "100%", marginTop: 10 }}>
          <thead><tr><th style={{ textAlign: "left" }}>{L(lang, "Tipo", "Code")}</th><th style={{ textAlign: "right" }}>{L(lang, "Estimado", "Estimated")}</th><th style={{ textAlign: "right" }}>{L(lang, "Gastado", "Spent")}</th><th style={{ textAlign: "right" }}>{L(lang, "Queda", "Remaining")}</th></tr></thead>
          <tbody>
            {pnl.rows.map((r) => (
              <tr key={r.code} data-testid={`pnl-${r.code}`}>
                <td>{codeLabel(r.code, lang)}</td>
                <td style={{ textAlign: "right" }}>{money(r.estimatedCents)}</td>
                <td style={{ textAlign: "right", color: r.percentOfEstimate != null && r.percentOfEstimate > 100 ? "var(--bad)" : undefined }}>{money(r.spentCents)}{r.percentOfEstimate != null ? ` (${r.percentOfEstimate}%)` : ""}</td>
                <td style={{ textAlign: "right" }}>{money(r.remainingCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <form className="card" onSubmit={saveBudgets} data-testid="budgets">
        <h3 style={{ marginTop: 0 }}>{L(lang, "Presupuesto por tipo de costo", "Budget by cost code")}</h3>
        <p className="muted small">{L(lang, "Lo que esperas gastar. Los números son tuyos; Loro solo los compara con lo gastado.", "What you expect to spend. The numbers are yours; Loro only compares them with what was spent.")}</p>
        <div className="grid2">
          {COST_CODES.map((c) => (
            <label key={c} className="field">
              <span className="field-label">{codeLabel(c, lang)} (USD)</span>
              <input inputMode="decimal" value={budgets[c]} onChange={(e) => { setBudgets({ ...budgets, [c]: e.target.value }); setBudgetsDirty(true); }} placeholder="0" data-testid={`budget-${c}`} />
            </label>
          ))}
        </div>
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
          <button className="btn primary" disabled={!budgetsDirty || busy !== null} data-testid="save-budgets">{busy === "budgets" ? L(lang, "Guardando…", "Saving…") : L(lang, "Guardar presupuesto", "Save budget")}</button>
        </div>
      </form>

      <section className="card" data-testid="costs">
        <h3 style={{ marginTop: 0 }}>{L(lang, "Gastos", "Costs")}</h3>
        <label className="field">
          <span className="field-label">{L(lang, "Dime qué gastaste", "Tell me what you spent")}</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} placeholder={L(lang, "Hoy trabajaron Pedro y Luis 8 horas, y $340 de pintura en Home Depot", "Pedro and Luis worked 8 hours today, and $340 of paint at Home Depot")} data-testid="cost-text" />
        </label>
        <div className="row" style={{ flexWrap: "wrap", marginTop: 8 }}>
          <button type="button" className="btn primary" onClick={parse} disabled={busy !== null || !aiReady || !text.trim()} data-testid="parse-costs">{busy === "parse" ? L(lang, "Leyendo…", "Reading…") : L(lang, "Anotar", "Log it")}</button>
          <label className="btn photo-btn">
            {busy === "receipt" ? L(lang, "Leyendo recibo…", "Reading receipt…") : L(lang, "📷 Foto del recibo", "📷 Receipt photo")}
            <input type="file" accept="image/*" capture="environment" className="sr" data-testid="receipt-photo" disabled={busy !== null || !aiReady} onChange={(e) => { const f = e.target.files?.[0]; if (f) void receipt(f); e.target.value = ""; }} />
          </label>
          <button type="button" className="btn" onClick={manual} disabled={busy !== null} data-testid="manual-cost">{L(lang, "Escribirlo a mano", "Type it")}</button>
        </div>
        {!aiReady && <p className="note small" style={{ marginTop: 8 }}>{L(lang, "Loro no está conectado: escribe los gastos a mano.", "Loro isn't connected: type the costs yourself.")}</p>}
        {workers.length === 0 && aiReady && <p className="muted small">{L(lang, "Para anotar horas por nombre, agrega tu cuadrilla y sus salarios en Ajustes → Cuadrilla.", "To log hours by name, add your crew and their wages in Settings → Crew.")}</p>}
        {note && <p className={`note ${note.kind}`} role="status" style={{ marginTop: 8 }} data-testid="cost-note">{note.text}</p>}

        {pending.length > 0 && (
          <div className="stack" style={{ marginTop: 12 }} data-testid="pending-costs">
            <p className="small muted" style={{ margin: 0 }}>{L(lang, "Revisa cada gasto. Un monto que no dijiste tú está marcado: confírmalo o cámbialo.", "Check each cost. An amount you didn't say is flagged: confirm or change it.")}</p>
            {pending.map((p) => (
              <div key={p.key} className="ms" style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 10 }} data-testid="pending-cost">
                <div className="row" style={{ flexWrap: "wrap" }}>
                  <select value={p.code} onChange={(e) => edit(p.key, { code: e.target.value as CostCode })} aria-label={L(lang, "Tipo", "Code")}>
                    {COST_CODES.map((c) => <option key={c} value={c}>{codeLabel(c, lang)}</option>)}
                  </select>
                  <input className="grow" value={p.description} onChange={(e) => edit(p.key, { description: e.target.value })} placeholder={L(lang, "Qué fue", "What it was")} maxLength={300} aria-label={L(lang, "Descripción", "Description")} />
                  <input value={p.vendor} onChange={(e) => edit(p.key, { vendor: e.target.value })} placeholder={L(lang, "Tienda", "Vendor")} maxLength={120} style={{ width: 130 }} aria-label={L(lang, "Tienda", "Vendor")} />
                  <input type="date" value={p.spentOn} max={today} onChange={(e) => edit(p.key, { spentOn: e.target.value })} aria-label={L(lang, "Fecha", "Date")} />
                  <input inputMode="decimal" value={p.amountText} onChange={(e) => edit(p.key, { amountText: e.target.value })} style={{ width: 110 }} aria-label={L(lang, "Monto", "Amount")} data-testid="pending-amount" />
                  <button type="button" className="btn small" onClick={() => setPending((l) => l.filter((x) => x.key !== p.key))} aria-label={L(lang, "Quitar", "Remove")}>×</button>
                </div>
                <div className="row small" style={{ marginTop: 6, flexWrap: "wrap" }}>
                  {p.workerName && <span className="muted">{p.workerName}{p.hours ? ` · ${p.hours} h` : ""}{p.basis.includes("×") ? ` · ${L(lang, "calculado con su salario", "from their wage")}` : ""}</span>}
                  {p.basis === "said" && <span className="badge">{L(lang, "Monto dicho por ti", "Amount you said")}</span>}
                  {p.needsConfirm && (
                    <label className="check"><input type="checkbox" checked={p.confirmed} onChange={(e) => edit(p.key, { confirmed: e.target.checked })} data-testid="confirm-cost" /> {p.basis === "receipt" ? L(lang, "El recibo dice esto", "The receipt says this") : L(lang, "Confirmo este monto", "I confirm this amount")}</label>
                  )}
                </div>
              </div>
            ))}
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn primary" onClick={saveAll} disabled={busy !== null} data-testid="save-costs">{busy === "save" ? L(lang, "Guardando…", "Saving…") : L(lang, "Guardar gastos", "Save costs")}</button>
            </div>
          </div>
        )}

        <ul className="list small" style={{ marginTop: 12 }} data-testid="cost-list">
          {costs.map((c) => (
            <li key={c.id} className="row" style={{ padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
              <span className="muted" style={{ width: 86 }}>{c.spentOn}</span>
              <span className="badge grey">{codeLabel(c.code, lang)}</span>
              <span className="grow">{c.description}{c.vendor ? ` · ${c.vendor}` : ""}{c.hours ? ` · ${c.hours} h` : ""}</span>
              <strong className="amount">{money(c.amountCents)}</strong>
              {c.receiptPhotoId && <a href={`/api/projects/${projectId}/photos/${c.receiptPhotoId}`} target="_blank" rel="noreferrer" title={L(lang, "Ver recibo", "View receipt")}>🧾</a>}
              <button type="button" className="btn small" onClick={() => remove(c)} aria-label={L(lang, "Quitar gasto", "Remove cost")}>×</button>
            </li>
          ))}
          {costs.length === 0 && <li className="muted">{L(lang, "Todavía no hay gastos.", "No costs yet.")}</li>}
        </ul>
      </section>
    </div>
  );
}
