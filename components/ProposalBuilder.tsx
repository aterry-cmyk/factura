"use client";

import { useState } from "react";
import type { PriceOption } from "@/lib/ai/costs";
import type { ScopeQuestion } from "@/lib/ai/proposal";
import type { RateOption } from "@/lib/prices/onebuild";
import { formatMoney, parseMoney } from "@/lib/money";
import { proposalProblems, proposalTotals, UNITS, unitLabel, type CostSource, type Proposal, type ProposalLine, type ProposalSection, type Unit } from "@/lib/proposal";
import type { Lang } from "@/lib/types";
import { blockMessage } from "@/lib/plans";

const L = (lang: Lang, es: string, en: string) => (lang === "es" ? es : en);
type Answer = { question: string; answer: string };
type Phase = "start" | "asking" | "editing";
let nextKey = 1000;

const SOURCE_LABEL: Record<CostSource, [string, string]> = {
  history: ["Tu precio anterior", "Your past price"],
  price: ["Precio buscado", "Looked-up price"],
  suggested: ["Sugerido por Loro", "Suggested by Loro"],
  typed: ["Escrito por ti", "Typed by you"],
  none: ["Sin precio", "No price"],
};

/**
 * Loro builds the proposal with the owner: it asks what an estimator asks, writes the scope as
 * sections of lines, and the owner prices each line from his own history, a looked-up price (the
 * feed or the web, with its source) or Loro's suggestion, confirming every one. Then it becomes
 * the project's estimate for the customer to accept.
 */
export function ProposalBuilder(props: { lang: Lang; projectId: string; description: string; proposal: Proposal | null; aiReady: boolean; estimateId: string | null; estimateNumber: string; markupPercent: number; contingencyPercent: number }) {
  const { lang, projectId, aiReady } = props;
  const es = lang === "es";
  const [phase, setPhase] = useState<Phase>(props.proposal ? "editing" : "start");
  const [description, setDescription] = useState(props.description);
  const [answers, setAnswers] = useState<Answer[]>(props.proposal?.answers ?? []);
  const [questions, setQuestions] = useState<ScopeQuestion[]>([]);
  const [free, setFree] = useState<Record<number, string>>({});
  const [summary, setSummary] = useState(props.proposal?.summary ?? "");
  const [sections, setSections] = useState<ProposalSection[]>(props.proposal?.sections ?? []);
  const [markup, setMarkup] = useState(String(props.proposal?.markupPercent ?? props.markupPercent));
  const [contingency, setContingency] = useState(String(props.proposal?.contingencyPercent ?? props.contingencyPercent));
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: "ok" | "bad" | "warn"; text: string } | null>(null);
  const [lookup, setLookup] = useState<{ key: string; own: { description: string; vendor: string; amountCents: number; spentOn: string }[]; rates: RateOption[]; options: PriceOption[]; feed: string; search: string } | null>(null);
  const money = (c: number) => formatMoney(c, lang);

  const proposal: Proposal = { summary, sections, markupPercent: Number(markup) || 0, contingencyPercent: Number(contingency) || 0, answers, updatedAt: "" };
  const totals = proposalTotals(proposal);
  const problems = proposalProblems(proposal, lang);
  const fail = (res: Response | null, json: { error?: string; errors?: string[] }, fallback: string) =>
    setNote({ kind: "bad", text: res?.status === 402 ? (blockMessage(json.error, lang) ?? fallback) : json.error === "ai_setup" ? L(lang, "Loro no está conectado todavía (falta la clave de IA).", "Loro isn't connected yet (the AI key is missing).") : json.errors?.join(" ") ?? fallback });

  async function ask(current: Answer[]) {
    setBusy("ask");
    setNote(null);
    const res = await fetch(`/api/projects/${projectId}/proposal/questions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers: current, description }) }).catch(() => null);
    const json = res ? ((await res.json().catch(() => ({}))) as { ready?: boolean; questions?: ScopeQuestion[]; error?: string }) : {};
    setBusy(null);
    if (!res?.ok) return fail(res, json, L(lang, "Loro no pudo preguntar. Intenta de nuevo.", "Loro couldn't ask. Try again."));
    if (json.ready || !json.questions?.length) return build(current);
    setQuestions(json.questions);
    setFree({});
    setPhase("asking");
  }

  async function answerAll() {
    const given: Answer[] = questions.flatMap((q, i) => (free[i]?.trim() ? [{ question: q.question, answer: free[i].trim() }] : []));
    const next = [...answers, ...given];
    setAnswers(next);
    await ask(next);
  }

  async function build(current: Answer[]) {
    setBusy("build");
    setNote(null);
    const res = await fetch(`/api/projects/${projectId}/proposal/build`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers: current, description }) }).catch(() => null);
    const json = res ? ((await res.json().catch(() => ({}))) as { summary?: string; sections?: ProposalSection[]; markupPercent?: number; contingencyPercent?: number; error?: string }) : {};
    setBusy(null);
    if (!res?.ok || !json.sections) return fail(res, json, L(lang, "Loro no pudo armar la propuesta. Intenta de nuevo.", "Loro couldn't build the proposal. Try again."));
    setSummary(json.summary ?? "");
    setSections(json.sections);
    setPhase("editing");
    setNote({ kind: "ok", text: L(lang, "Propuesta armada. Cada línea dice de dónde sale su costo: confírmalas o búscales precio.", "Proposal built. Each line says where its cost comes from: confirm them or look up a price.") });
  }

  function editLine(key: string, patch: Partial<ProposalLine>) {
    setSections((ss) => ss.map((s) => ({ ...s, lines: s.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) })));
  }
  function removeLine(key: string) {
    setSections((ss) => ss.map((s) => ({ ...s, lines: s.lines.filter((l) => l.key !== key) })).filter((s) => s.lines.length));
  }
  function addLine(si: number) {
    setSections((ss) => ss.map((s, i) => (i === si ? { ...s, lines: [...s.lines, { key: `n${nextKey++}`, description: "", quantity: 1, unit: "EA", unitCostCents: 0, source: "none", basis: "", confirmed: false, quantityGiven: true }] } : s)));
  }
  function addSection() {
    setSections((ss) => [...ss, { title: L(lang, "Nueva sección", "New section"), lines: [{ key: `n${nextKey++}`, description: "", quantity: 1, unit: "EA", unitCostCents: 0, source: "none", basis: "", confirmed: false, quantityGiven: true }] }]);
  }
  function setCost(key: string, text: string) {
    const cents = parseMoney(text);
    editLine(key, { unitCostCents: cents ?? 0, source: cents ? "typed" : "none", confirmed: false, basis: cents ? L(lang, "Escrito por ti", "Typed by you") : "" });
  }

  async function findPrice(line: ProposalLine) {
    setBusy(`price-${line.key}`);
    const res = await fetch("/api/prices/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: line.description }) }).catch(() => null);
    const json = res ? ((await res.json().catch(() => ({}))) as { own?: { description: string; vendor: string; amountCents: number; spentOn: string }[]; rates?: RateOption[]; options?: PriceOption[]; feed?: string; search?: string; error?: string }) : {};
    setBusy(null);
    if (!res?.ok) return fail(res, json, L(lang, "No se pudo buscar el precio.", "The price lookup failed."));
    setLookup({ key: line.key, own: json.own ?? [], rates: json.rates ?? [], options: json.options ?? [], feed: json.feed ?? "setup", search: json.search ?? "failed" });
  }
  function pick(key: string, cents: number, basis: string) {
    editLine(key, { unitCostCents: cents, source: "price", basis, confirmed: true });
    setLookup(null);
  }

  async function save(): Promise<Proposal | null> {
    setBusy("save");
    const res = await fetch(`/api/projects/${projectId}/proposal`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(proposal) }).catch(() => null);
    const json = res ? ((await res.json().catch(() => ({}))) as { proposal?: Proposal; errors?: string[] }) : {};
    setBusy(null);
    if (!res?.ok || !json.proposal) { fail(res, json, L(lang, "No se pudo guardar.", "Couldn't save.")); return null; }
    setNote({ kind: "ok", text: L(lang, "Borrador guardado.", "Draft saved.") });
    return json.proposal;
  }

  async function makeEstimate() {
    if (problems.length) return setNote({ kind: "warn", text: problems.join(" ") });
    if (!confirm(L(lang, `¿Crear el estimado por ${money(totals.totalCents)} y mandarlo al enlace del cliente?`, `Create the estimate for ${money(totals.totalCents)} and send it to the customer's link?`))) return;
    setBusy("estimate");
    const res = await fetch(`/api/projects/${projectId}/proposal/estimate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(proposal) }).catch(() => null);
    const json = res ? ((await res.json().catch(() => ({}))) as { id?: string; error?: string; errors?: string[] }) : {};
    if (res?.ok && json.id) { window.location.href = `/documents/${json.id}`; return; }
    setBusy(null);
    fail(res, json, L(lang, "No se pudo crear el estimado.", "The estimate couldn't be created."));
  }

  return (
    <div className="stack" data-testid="proposal">
      {phase !== "editing" && (
        <section className="card">
          <h3 style={{ marginTop: 0 }}>{L(lang, "Armar la propuesta con Loro", "Build the proposal with Loro")}</h3>
          <label className="field">
            <span className="field-label">{L(lang, "El trabajo, en tus palabras", "The job, in your words")}</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={4000} placeholder={L(lang, "Remodelar la cocina: quitar gabinetes viejos, poner gabinetes nuevos, encimera de cuarzo, piso de porcelanato, pintar…", "Remodel the kitchen: remove old cabinets, new cabinets, quartz counter, porcelain floor, paint…")} data-testid="proposal-description" />
          </label>
          {phase === "asking" && (
            <div className="stack" style={{ marginTop: 12 }} data-testid="scope-questions">
              <p className="small muted" style={{ margin: 0 }}>{L(lang, "Loro pregunta lo que un buen estimador preguntaría. Toca una opción o escribe; deja en blanco lo que no sepas.", "Loro asks what a good estimator would ask. Tap an option or type; leave blank what you don't know.")}</p>
              {questions.map((q, i) => (
                <div key={i} className="field" data-testid="scope-question">
                  <span className="field-label">{q.question}</span>
                  <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                    {q.options.map((o) => (
                      <button key={o} type="button" className="chip" aria-pressed={free[i] === o} onClick={() => setFree({ ...free, [i]: o })}>{o}</button>
                    ))}
                  </div>
                  <input value={free[i] ?? ""} onChange={(e) => setFree({ ...free, [i]: e.target.value })} placeholder={L(lang, "O escribe la respuesta", "Or type the answer")} maxLength={300} aria-label={q.question} />
                </div>
              ))}
              {answers.length > 0 && <p className="muted small">{L(lang, `Ya respondiste ${answers.length}.`, `${answers.length} answered so far.`)}</p>}
            </div>
          )}
          <div className="row" style={{ marginTop: 12, flexWrap: "wrap" }}>
            {phase === "start" && <button type="button" className="btn primary" onClick={() => ask(answers)} disabled={busy !== null || !aiReady || !description.trim()} data-testid="start-proposal">{busy === "ask" ? L(lang, "Loro está pensando…", "Loro is thinking…") : L(lang, "Que Loro pregunte y arme la propuesta", "Have Loro ask and build the proposal")}</button>}
            {phase === "asking" && <button type="button" className="btn primary" onClick={answerAll} disabled={busy !== null} data-testid="answer-questions">{busy ? L(lang, "Loro está pensando…", "Loro is thinking…") : L(lang, "Siguiente", "Next")}</button>}
            {phase === "asking" && <button type="button" className="btn" onClick={() => build([...answers, ...questions.flatMap((q, i) => (free[i]?.trim() ? [{ question: q.question, answer: free[i].trim() }] : []))])} disabled={busy !== null} data-testid="build-now">{L(lang, "Armar la propuesta ya", "Build the proposal now")}</button>}
            {!aiReady && <span className="note small">{L(lang, "Loro no está conectado: agrega las secciones a mano.", "Loro isn't connected: add the sections yourself.")}</span>}
            {phase === "start" && <button type="button" className="btn" onClick={() => { setPhase("editing"); if (!sections.length) addSection(); }} disabled={busy !== null}>{L(lang, "Escribirla a mano", "Write it myself")}</button>}
          </div>
        </section>
      )}

      {note && <p className={`note ${note.kind}`} role="status" data-testid="proposal-note">{note.text}</p>}

      {phase === "editing" && (
        <>
          <section className="card">
            <label className="field">
              <span className="field-label">{L(lang, "Resumen para el cliente", "Summary for the customer")}</span>
              <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} maxLength={600} data-testid="proposal-summary" />
            </label>
            {answers.length > 0 && (
              <details style={{ marginTop: 8 }}>
                <summary className="small muted">{L(lang, `Lo que Loro preguntó (${answers.length})`, `What Loro asked (${answers.length})`)}</summary>
                <ul className="list small">{answers.map((a, i) => <li key={i} style={{ padding: "3px 0" }}><span className="muted">{a.question}</span> → {a.answer}</li>)}</ul>
              </details>
            )}
          </section>

          {sections.map((s, si) => (
            <section className="card" key={si} data-testid="proposal-section">
              <div className="row">
                <input className="grow" value={s.title} onChange={(e) => setSections((ss) => ss.map((x, i) => (i === si ? { ...x, title: e.target.value } : x)))} maxLength={120} style={{ fontWeight: 700 }} aria-label={L(lang, "Sección", "Section")} />
                <strong className="amount">{money(s.lines.reduce((a, l) => a + Math.round(l.quantity * l.unitCostCents), 0))}</strong>
              </div>
              <ul className="list" style={{ marginTop: 8 }}>
                {s.lines.map((l) => (
                  <li key={l.key} className="step" data-testid="proposal-line" data-source={l.source}>
                    <div className="row" style={{ flexWrap: "wrap" }}>
                      <input className="grow" value={l.description} onChange={(e) => editLine(l.key, { description: e.target.value })} maxLength={200} aria-label={L(lang, "Descripción", "Description")} />
                      <input inputMode="decimal" value={l.quantity} onChange={(e) => editLine(l.key, { quantity: Number(e.target.value) || 0, quantityGiven: true })} style={{ width: 80 }} aria-label={L(lang, "Cantidad", "Quantity")} />
                      <select value={l.unit} onChange={(e) => editLine(l.key, { unit: e.target.value as Unit })} aria-label={L(lang, "Unidad", "Unit")}>
                        {UNITS.map((u) => <option key={u} value={u}>{unitLabel(u, lang)}</option>)}
                      </select>
                      <input inputMode="decimal" defaultValue={l.unitCostCents ? (l.unitCostCents / 100).toFixed(2) : ""} key={`${l.key}-${l.unitCostCents}-${l.source}`} onBlur={(e) => { if (parseMoney(e.target.value) !== l.unitCostCents) setCost(l.key, e.target.value); }} placeholder={L(lang, "costo/u", "cost/unit")} style={{ width: 100 }} aria-label={L(lang, "Costo por unidad", "Unit cost")} data-testid="line-cost" />
                      <strong className="amount" style={{ minWidth: 90, textAlign: "right" }}>{money(Math.round(l.quantity * l.unitCostCents))}</strong>
                      <button type="button" className="btn small" onClick={() => removeLine(l.key)} aria-label={L(lang, "Quitar línea", "Remove line")}>×</button>
                    </div>
                    <div className="row small" style={{ flexWrap: "wrap" }}>
                      <span className={`badge ${l.source === "history" || l.source === "price" ? "" : l.source === "none" ? "bad" : "warn"}`}>{SOURCE_LABEL[l.source][es ? 0 : 1]}</span>
                      {l.basis && <span className="muted">{l.basis}</span>}
                      {!l.quantityGiven && <span className="badge warn">{L(lang, "Cantidad leída por Loro, revísala", "Quantity read by Loro, check it")}</span>}
                      <button type="button" className="btn small" onClick={() => findPrice(l)} disabled={busy !== null || !l.description.trim()} data-testid="find-price">{busy === `price-${l.key}` ? L(lang, "Buscando…", "Searching…") : L(lang, "Buscar precio", "Find a price")}</button>
                      {l.unitCostCents > 0 && (
                        <label className="check"><input type="checkbox" checked={l.confirmed} onChange={(e) => editLine(l.key, { confirmed: e.target.checked })} data-testid="confirm-line" /> {L(lang, "Confirmo este costo", "I confirm this cost")}</label>
                      )}
                    </div>
                    {lookup?.key === l.key && (
                      <div className="card" style={{ margin: "6px 0 0", padding: 10 }} data-testid="price-lookup">
                        {lookup.own.length > 0 && <div className="small"><strong>{L(lang, "Lo que tú pagaste", "What you paid")}</strong>{lookup.own.map((o, i) => <div key={i} className="row"><span className="grow">{o.description}{o.vendor ? ` · ${o.vendor}` : ""} <span className="muted">{o.spentOn}</span></span><button type="button" className="btn small" onClick={() => pick(l.key, o.amountCents, `${L(lang, "Tu recibo", "Your receipt")}: ${o.vendor || o.description}, ${o.spentOn}`)}>{money(o.amountCents)}</button></div>)}</div>}
                        {lookup.rates.length > 0 && <div className="small" style={{ marginTop: 6 }}><strong>{L(lang, "Tarifas por condado (1build)", "County rates (1build)")}</strong>{lookup.rates.map((r) => <div key={r.id} className="row"><span className="grow">{r.name} <span className="muted">/ {r.unit}{r.county ? ` · ${r.county}` : ""}</span>{r.laborCents ? <span className="muted"> · {L(lang, "mano de obra", "labor")} {money(r.burdenedLaborCents || r.laborCents)}/h</span> : null}</span><button type="button" className="btn small" onClick={() => pick(l.key, r.unitRateCents, `1build, ${r.county || r.state}: ${r.name} (${r.unit})`)} data-testid="pick-rate">{money(r.unitRateCents)}</button></div>)}</div>}
                        {lookup.options.length > 0 && <div className="small" style={{ marginTop: 6 }}><strong>{L(lang, "En línea hoy", "Online today")}</strong>{lookup.options.map((o, i) => <div key={i} className="row"><span className="grow">{o.vendor}: {o.product} <span className="muted">{o.unit}</span> <a href={o.url} target="_blank" rel="noreferrer">{L(lang, "página", "page")}</a></span><button type="button" className="btn small" onClick={() => pick(l.key, o.priceCents, `${o.vendor}: ${o.product} (${o.unit}), ${o.url}`)} data-testid="pick-price">{money(o.priceCents)}</button></div>)}</div>}
                        {!lookup.own.length && !lookup.rates.length && !lookup.options.length && <p className="muted small" style={{ margin: 0 }}>{lookup.search === "ai_setup" ? L(lang, "Loro no está conectado: escribe el costo.", "Loro isn't connected: type the cost.") : lookup.search === "no_search" ? L(lang, "La búsqueda web no está habilitada en la cuenta de IA.", "Web search isn't enabled on the AI account.") : L(lang, "No encontré un precio con fuente. Escribe el costo o prueba otras palabras.", "No sourced price found. Type the cost or try other words.")}{lookup.feed === "setup" ? L(lang, " (Tarifas por condado: falta la clave de 1build.)", " (County rates: the 1build key isn't set.)") : ""}</p>}
                        <div className="row" style={{ justifyContent: "flex-end", marginTop: 6 }}><button type="button" className="btn small" onClick={() => setLookup(null)}>{L(lang, "Cerrar", "Close")}</button></div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              <button type="button" className="btn small" onClick={() => addLine(si)}>{L(lang, "+ Línea", "+ Line")}</button>
            </section>
          ))}
          <button type="button" className="btn small" onClick={addSection}>{L(lang, "+ Sección", "+ Section")}</button>

          <section className="card" data-testid="proposal-totals">
            <div className="grid2">
              <label className="field"><span className="field-label">{L(lang, "Margen sobre el costo %", "Markup on cost %")}</span><input inputMode="decimal" value={markup} onChange={(e) => setMarkup(e.target.value)} data-testid="markup" /></label>
              <label className="field"><span className="field-label">{L(lang, "Contingencia %", "Contingency %")}</span><input inputMode="decimal" value={contingency} onChange={(e) => setContingency(e.target.value)} data-testid="contingency" /></label>
            </div>
            <table className="doc" style={{ width: "100%", marginTop: 10 }}>
              <tbody>
                <tr><td>{L(lang, "Costo", "Cost")}</td><td style={{ textAlign: "right" }}>{money(totals.costCents)}</td></tr>
                <tr><td>{L(lang, "Margen", "Markup")}</td><td style={{ textAlign: "right" }}>{money(totals.markupCents)}</td></tr>
                <tr><td>{L(lang, "Contingencia", "Contingency")}</td><td style={{ textAlign: "right" }}>{money(totals.contingencyCents)}</td></tr>
                <tr><td><strong>{L(lang, "Precio al cliente", "Price to the customer")}</strong></td><td style={{ textAlign: "right" }}><strong data-testid="proposal-total">{money(totals.totalCents)}</strong></td></tr>
              </tbody>
            </table>
            {problems.length > 0 && <p className="note warn" style={{ marginTop: 8 }} data-testid="proposal-problems">{problems.join(" ")}</p>}
            {props.estimateId && <p className="note small" style={{ marginTop: 8 }}>{L(lang, `Este proyecto ya tiene el estimado ${props.estimateNumber}. Crear otro lo reemplaza como estimado del proyecto.`, `This project already has estimate ${props.estimateNumber}. Creating another replaces it as the project's estimate.`)} <a href={`/documents/${props.estimateId}`}>{L(lang, "Verlo", "View it")}</a></p>}
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 10, flexWrap: "wrap" }}>
              <button type="button" className="btn" onClick={() => setPhase("start")} disabled={busy !== null}>{L(lang, "Volver a preguntar", "Ask again")}</button>
              <button type="button" className="btn" onClick={save} disabled={busy !== null} data-testid="save-proposal">{busy === "save" ? L(lang, "Guardando…", "Saving…") : L(lang, "Guardar borrador", "Save draft")}</button>
              <button type="button" className="btn primary" onClick={makeEstimate} disabled={busy !== null || problems.length > 0} data-testid="make-estimate">{busy === "estimate" ? L(lang, "Creando…", "Creating…") : L(lang, "Crear el estimado para el cliente", "Create the estimate for the customer")}</button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
