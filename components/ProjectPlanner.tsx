"use client";

import { useState } from "react";
import { formatMoney, parseMoney } from "@/lib/money";
import { MAX_MILESTONES, MIN_MILESTONES, splitAmounts, templatePlan, type PlanMilestone, type PlanSource } from "@/lib/projects";
import type { Customer, Lang } from "@/lib/types";
import { blockMessage } from "@/lib/plans";

const L = (lang: Lang, es: string, en: string) => (lang === "es" ? es : en);

export interface PlannerEstimate {
  id: string;
  number: string;
  customer: Customer;
  totalCents: number;
  summary: string;
}

/**
 * A new project: name, customer and total (filled from an accepted estimate when there is one),
 * then the plan. Loro proposes milestones and steps; the owner edits every line and the shares
 * before anything is saved. Amounts are only ever computed from the total and the shares.
 */
export function ProjectPlanner({ lang, estimate, aiReady, defaultCustomer }: { lang: Lang; estimate: PlannerEstimate | null; aiReady: boolean; defaultCustomer?: Customer }) {
  const es = lang === "es";
  const [name, setName] = useState(estimate ? estimate.summary : "");
  const [description, setDescription] = useState("");
  const [customer, setCustomer] = useState<Customer>(estimate?.customer ?? defaultCustomer ?? { name: "", company: "", email: "", phone: "" });
  const [totalText, setTotalText] = useState(estimate ? (estimate.totalCents / 100).toFixed(2) : "");
  const [plan, setPlan] = useState<PlanMilestone[]>([]);
  const [planSource, setPlanSource] = useState<PlanSource>("template");
  const [ai, setAi] = useState<{ model: string; promptVersion: string } | null>(null);
  const [busy, setBusy] = useState<"plan" | "save" | null>(null);
  const [error, setError] = useState("");

  const totalCents = parseMoney(totalText);
  const shares = plan.map((m) => m.sharePercent);
  const amounts = totalCents != null ? splitAmounts(totalCents, shares) : [];
  const shareSum = Math.round(shares.reduce((a, b) => a + b, 0) * 100) / 100;

  async function propose() {
    setBusy("plan");
    setError("");
    const res = await fetch("/api/projects/plan", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description, estimateId: estimate?.id ?? null }),
    }).catch(() => null);
    setBusy(null);
    const json = res ? ((await res.json().catch(() => ({}))) as { plan?: PlanMilestone[]; ai?: { model: string; promptVersion: string }; error?: string }) : {};
    if (res?.ok && json.plan) {
      setPlan(json.plan);
      setPlanSource("ai");
      setAi(json.ai ?? null);
      return;
    }
    const code = json.error ?? "";
    setError(
      res?.status === 402 ? (blockMessage(code, lang) ?? "")
      : code === "ai_setup" ? L(lang, "Loro no está conectado todavía (falta la clave de IA). Usa el plan estándar y edítalo.", "Loro isn't connected yet (the AI key is missing). Use the standard plan and edit it.")
      : code === "empty" ? L(lang, "Escribe el nombre o una descripción del trabajo primero.", "Write the job's name or a description first.")
      : L(lang, "Loro no pudo proponer un plan. Intenta de nuevo o usa el plan estándar.", "Loro couldn't propose a plan. Try again or use the standard plan."),
    );
  }

  function useTemplate() {
    setPlan(templatePlan(lang));
    setPlanSource("template");
    setAi(null);
    setError("");
  }

  function edit(i: number, patch: Partial<PlanMilestone>) {
    setPlan((p) => p.map((m, j) => (j === i ? { ...m, ...patch } : m)));
    if (planSource !== "owner") setPlanSource("owner");
  }
  function removeMilestone(i: number) {
    setPlan((p) => p.filter((_, j) => j !== i));
    setPlanSource("owner");
  }
  function addMilestone() {
    setPlan((p) => [...p, { name: "", sharePercent: 0, steps: [] }]);
    setPlanSource("owner");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (totalCents == null) return setError(L(lang, "Escribe el total del proyecto, por ejemplo 25000.", "Enter the project total, for example 25000."));
    if (plan.length < MIN_MILESTONES) return setError(L(lang, "El proyecto necesita al menos dos hitos. Pide un plan o usa el estándar.", "The project needs at least two milestones. Ask for a plan or use the standard one."));
    if (Math.abs(shareSum - 100) > 1) return setError(L(lang, `Los porcentajes suman ${shareSum}%; deben sumar 100%.`, `The shares add up to ${shareSum}%; they must add up to 100%.`));
    setBusy("save");
    const res = await fetch("/api/projects", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description, customer, totalCents, lang, estimateId: estimate?.id ?? null, plan, planSource, ai }),
    }).catch(() => null);
    const json = res ? ((await res.json().catch(() => ({}))) as { id?: string; error?: string; errors?: string[] }) : {};
    if (res?.ok && json.id) {
      window.location.href = `/projects/${json.id}`;
      return;
    }
    setBusy(null);
    setError(
      res?.status === 402 ? (blockMessage(json.error, lang) ?? "")
      : json.errors?.length ? json.errors.join(" ")
      : L(lang, "No se pudo guardar el proyecto.", "The project couldn't be saved."),
    );
  }

  return (
    <form className="stack" onSubmit={save} data-testid="project-planner">
      <section className="card">
        <h2 style={{ marginTop: 0 }}>{L(lang, "El trabajo", "The job")}</h2>
        {estimate && (
          <p className="note" data-testid="from-estimate">
            {L(lang, `Del estimado ${estimate.number} aceptado por ${estimate.customer.name}: ${formatMoney(estimate.totalCents, lang)}.`, `From estimate ${estimate.number}, accepted by ${estimate.customer.name}: ${formatMoney(estimate.totalCents, lang)}.`)}
          </p>
        )}
        <label className="field">
          <span className="field-label">{L(lang, "Nombre del proyecto", "Project name")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={160} required placeholder={L(lang, "Remodelación de cocina, casa de Ana", "Kitchen remodel, Ana's house")} />
        </label>
        <label className="field">
          <span className="field-label">{L(lang, "Qué incluye (opcional)", "What it includes (optional)")}</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={4000} placeholder={L(lang, "Lo que acordaste con el cliente, en tus palabras.", "What you agreed with the customer, in your words.")} />
        </label>
        <div className="grid2">
          <label className="field">
            <span className="field-label">{L(lang, "Cliente", "Customer")}</span>
            <input value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} maxLength={120} required />
          </label>
          <label className="field">
            <span className="field-label">{L(lang, "Total del proyecto (USD)", "Project total (USD)")}</span>
            <input inputMode="decimal" value={totalText} onChange={(e) => setTotalText(e.target.value)} placeholder="25000" required data-testid="project-total" />
          </label>
          <label className="field">
            <span className="field-label">{L(lang, "Teléfono del cliente", "Customer phone")}</span>
            <input value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} inputMode="tel" maxLength={40} />
          </label>
          <label className="field">
            <span className="field-label">{L(lang, "Correo del cliente", "Customer email")}</span>
            <input value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} inputMode="email" maxLength={200} />
          </label>
        </div>
      </section>

      <section className="card">
        <div className="row" style={{ alignItems: "baseline" }}>
          <h2 className="grow" style={{ margin: 0 }}>{L(lang, "Hitos y pagos", "Milestones and payments")}</h2>
          {plan.length > 0 && (
            <span className="badge grey" data-testid="plan-source">
              {planSource === "ai" ? L(lang, "Propuesto por Loro", "Proposed by Loro") : planSource === "template" ? L(lang, "Plan estándar", "Standard plan") : L(lang, "Editado por ti", "Edited by you")}
            </span>
          )}
        </div>
        <p className="muted small">
          {L(lang, "Cada hito es un pago del cliente cuando ese trabajo está hecho. Loro propone el orden, los porcentajes y la lista de pasos; tú decides.", "Each milestone is a payment the customer makes when that work is done. Loro proposes the order, the shares and the steps; you decide.")}
        </p>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <button type="button" className="btn primary" onClick={propose} disabled={busy !== null || !aiReady} data-testid="propose-plan">
            {busy === "plan" ? L(lang, "Loro está planeando…", "Loro is planning…") : L(lang, "Que Loro proponga el plan", "Have Loro propose the plan")}
          </button>
          <button type="button" className="btn" onClick={useTemplate} disabled={busy !== null} data-testid="template-plan">
            {L(lang, "Usar el plan estándar", "Use the standard plan")}
          </button>
        </div>
        {!aiReady && <p className="note small">{L(lang, "Loro no está conectado todavía: usa el plan estándar y edítalo.", "Loro isn't connected yet: use the standard plan and edit it.")}</p>}

        {plan.length > 0 && (
          <ol className="stack" style={{ listStyle: "none", padding: 0, marginTop: 14 }} data-testid="plan">
            {plan.map((m, i) => (
              <li key={i} className="ms">
                <div className="row">
                  <span className="pill">{i + 1}</span>
                  <input className="grow" value={m.name} onChange={(e) => edit(i, { name: e.target.value })} maxLength={160} placeholder={L(lang, "Nombre del hito", "Milestone name")} aria-label={L(lang, `Hito ${i + 1}`, `Milestone ${i + 1}`)} />
                  <label className="row" style={{ gap: 4 }}>
                    <input type="number" min={0} max={100} step={1} value={m.sharePercent} onChange={(e) => edit(i, { sharePercent: Number(e.target.value) })} style={{ width: 70 }} aria-label={L(lang, `Porcentaje del hito ${i + 1}`, `Share of milestone ${i + 1}`)} />
                    <span>%</span>
                  </label>
                  <label className="row" style={{ gap: 4 }}>
                    <input type="number" min={1} max={365} value={m.days ?? ""} onChange={(e) => edit(i, { days: Number(e.target.value) || undefined })} style={{ width: 64 }} placeholder="5" aria-label={L(lang, `Días del hito ${i + 1}`, `Days of milestone ${i + 1}`)} />
                    <span className="small muted">{L(lang, "días", "days")}</span>
                  </label>
                  <strong className="amount" data-testid="ms-amount">{amounts[i] != null ? formatMoney(amounts[i], lang) : "—"}</strong>
                  {plan.length > MIN_MILESTONES && (
                    <button type="button" className="btn small" onClick={() => removeMilestone(i)} aria-label={L(lang, `Quitar hito ${i + 1}`, `Remove milestone ${i + 1}`)}>×</button>
                  )}
                </div>
                <textarea
                  value={m.steps.join("\n")}
                  onChange={(e) => edit(i, { steps: e.target.value.split("\n").slice(0, 15) })}
                  rows={Math.max(2, Math.min(8, m.steps.length + 1))}
                  placeholder={L(lang, "Un paso por línea", "One step per line")}
                  aria-label={L(lang, `Pasos del hito ${i + 1}`, `Steps of milestone ${i + 1}`)}
                />
              </li>
            ))}
          </ol>
        )}
        {plan.length > 0 && (
          <div className="row" style={{ marginTop: 10 }}>
            {plan.length < MAX_MILESTONES && <button type="button" className="btn small" onClick={addMilestone}>{L(lang, "+ Agregar hito", "+ Add milestone")}</button>}
            <span className={`grow small ${Math.abs(shareSum - 100) > 1 ? "bad" : "muted"}`} style={{ textAlign: "right" }} data-testid="share-sum">
              {L(lang, `Suma: ${shareSum}%`, `Total: ${shareSum}%`)}{totalCents != null ? ` · ${formatMoney(totalCents, lang)}` : ""}
            </span>
          </div>
        )}
      </section>

      {error && <p className="note bad" role="alert">{error}</p>}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn primary" disabled={busy !== null || plan.length === 0} data-testid="create-project">
          {busy === "save" ? L(lang, "Guardando…", "Saving…") : L(lang, "Crear proyecto", "Create project")}
        </button>
      </div>
    </form>
  );
}
