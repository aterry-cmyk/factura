import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { codeLabel, COST_CODES, isPeriod, PERIODS, periodLabel, projectPnl, rollup, signalText, type Period } from "@/lib/costs";
import { getBudgets, listCosts, paymentsOf } from "@/lib/costs-store";
import { formatMoney } from "@/lib/money";
import { percentDone } from "@/lib/projects";
import { getProject } from "@/lib/projects-store";
import { headerUser, pageCtx } from "@/lib/session";
import { getSettings } from "@/lib/store";

export const dynamic = "force-dynamic";

/** The project's P&L by day, week or month: what went in and what went out, with the running picture. */
export default async function PnlPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ period?: string }> }) {
  const { id } = await params;
  const { period: p } = await searchParams;
  const period: Period = isPeriod(p) ? p : "week";
  const ctx = await pageCtx();
  const [settings, view] = await Promise.all([getSettings(ctx.accountId), getProject(ctx.accountId, id)]);
  if (!view) notFound();
  const lang = settings.lang;
  const es = lang === "es";
  const [budgets, costs, payments] = await Promise.all([getBudgets(view.project.id), listCosts(view.project.id), paymentsOf(view.project.id)]);
  const money = (c: number) => formatMoney(c, lang);
  const pnl = projectPnl({ contractCents: view.project.totalCents, budgets, costs, milestones: view.milestones, percentDone: percentDone(view.milestones, view.items) });
  const rows = rollup(costs, payments, period);
  const labels: Record<Period, [string, string]> = { day: ["Por día", "By day"], week: ["Por semana", "By week"], month: ["Por mes", "By month"] };
  return (
    <main className="wrap">
      <Header lang={lang} user={headerUser(ctx)} />
      <p className="small" style={{ margin: "0 0 6px" }}><Link href={`/projects/${view.project.id}`}>← {view.project.name}</Link></p>
      <h1 style={{ marginTop: 0 }}>{es ? "Ganancia o pérdida" : "Profit and loss"}</h1>
      <section className="tiles">
        <div className="tile"><span className="kpi-label">{es ? "Contrato" : "Contract"}</span><span className="tile-value">{money(pnl.income.contractCents)}</span></div>
        <div className="tile good"><span className="kpi-label">{es ? "Cobrado" : "Received"}</span><span className="tile-value">{money(pnl.income.paidCents)}</span></div>
        <div className="tile"><span className="kpi-label">{es ? "Gastado" : "Spent"}</span><span className="tile-value">{money(pnl.spentCents)}</span></div>
        <div className={`tile ${pnl.margin.projectedCents < 0 ? "bad" : "good"}`}><span className="kpi-label">{es ? "Margen proyectado" : "Projected margin"}</span><span className="tile-value">{money(pnl.margin.projectedCents)}</span></div>
      </section>
      {signalText(pnl, lang, money) && <p className="note warn">{signalText(pnl, lang, money)}</p>}
      <div className="tabs" role="tablist" style={{ marginBottom: 12 }}>
        {PERIODS.map((x) => (
          <Link key={x} role="tab" aria-selected={x === period} className={`chip${x === period ? " on" : ""}`} aria-pressed={x === period} href={`?period=${x}`}>{labels[x][es ? 0 : 1]}</Link>
        ))}
      </div>
      <section className="card" data-testid="rollup">
        <table className="doc" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>{labels[period][es ? 0 : 1]}</th>
              {COST_CODES.map((c) => <th key={c} style={{ textAlign: "right" }}>{codeLabel(c, lang)}</th>)}
              <th style={{ textAlign: "right" }}>{es ? "Gastado" : "Spent"}</th>
              <th style={{ textAlign: "right" }}>{es ? "Cobrado" : "Received"}</th>
              <th style={{ textAlign: "right" }}>{es ? "Neto" : "Net"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} data-testid="rollup-row">
                <td>{periodLabel(r.key, period, lang)}</td>
                {COST_CODES.map((c) => <td key={c} style={{ textAlign: "right" }}>{r.spent[c] ? money(r.spent[c]) : "—"}</td>)}
                <td style={{ textAlign: "right" }}>{money(r.spentCents)}</td>
                <td style={{ textAlign: "right" }}>{r.receivedCents ? money(r.receivedCents) : "—"}</td>
                <td style={{ textAlign: "right", color: r.receivedCents - r.spentCents < 0 ? "var(--bad)" : undefined }}>{money(r.receivedCents - r.spentCents)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="muted">{es ? "Todavía no hay gastos ni cobros en este proyecto." : "No costs or payments on this project yet."}</td></tr>}
          </tbody>
        </table>
      </section>
      <section className="card">
        <h3 style={{ marginTop: 0 }}>{es ? "Estimado contra real" : "Estimate against actual"}</h3>
        <table className="doc" style={{ width: "100%" }}>
          <tbody>
            {pnl.rows.map((r) => (
              <tr key={r.code}><td>{codeLabel(r.code, lang)}</td><td style={{ textAlign: "right" }}>{money(r.estimatedCents)}</td><td style={{ textAlign: "right" }}>{money(r.spentCents)}</td><td style={{ textAlign: "right" }}>{r.percentOfEstimate != null ? `${r.percentOfEstimate}%` : "—"}</td></tr>
            ))}
            <tr><td><strong>{es ? "Margen estimado" : "Estimated margin"}</strong></td><td colSpan={3} style={{ textAlign: "right" }}><strong>{money(pnl.margin.estimatedCents)}</strong></td></tr>
            <tr><td><strong>{es ? "Margen hasta hoy (cobrado − gastado)" : "Margin so far (received − spent)"}</strong></td><td colSpan={3} style={{ textAlign: "right" }}><strong>{money(pnl.margin.soFarCents)}</strong></td></tr>
            <tr><td><strong>{es ? "Margen proyectado al terminar" : "Projected margin at the end"}</strong></td><td colSpan={3} style={{ textAlign: "right" }}><strong>{money(pnl.margin.projectedCents)}{pnl.margin.projectedPercent != null ? ` (${pnl.margin.projectedPercent}%)` : ""}</strong></td></tr>
          </tbody>
        </table>
        <p className="muted small" style={{ marginBottom: 0 }}>{es ? "La proyección escala lo gastado según el avance del proyecto; con 0% de avance usa el presupuesto." : "The projection scales what was spent by how far along the project is; at 0% it uses the budget."}</p>
      </section>
    </main>
  );
}
