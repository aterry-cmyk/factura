import Link from "next/link";
import { Header } from "@/components/Header";
import { formatMoney } from "@/lib/money";
import { moneySummary, percentDone } from "@/lib/projects";
import { listProjects } from "@/lib/projects-store";
import { businessMonths } from "@/lib/costs-store";
import { todayIso } from "@/lib/money";
import { headerUser, pageCtx } from "@/lib/session";
import { getSettings } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Every project: name, customer, how far along, and the money. */
export default async function ProjectsPage() {
  const ctx = await pageCtx();
  const today = todayIso();
  const since = `${today.slice(0, 4)}-01-01`;
  const [settings, projects, months] = await Promise.all([getSettings(ctx.accountId), listProjects(ctx.accountId), businessMonths(ctx.accountId, since)]);
  const thisMonth = months.find((m) => m.month === today.slice(0, 7)) ?? { month: today.slice(0, 7), receivedCents: 0, spentCents: 0 };
  const lang = settings.lang;
  const es = lang === "es";
  return (
    <main className="wrap">
      <Header lang={lang} user={headerUser(ctx)} />
      <div className="row" style={{ marginBottom: 12 }}>
        <h1 className="grow" style={{ margin: 0 }}>{es ? "Proyectos" : "Projects"}</h1>
        <Link className="btn primary" href="/projects/new">{es ? "Nuevo proyecto" : "New project"}</Link>
      </div>
      {projects.length > 0 && (
        <section className="tiles" data-testid="business-month">
          <div className="tile good"><span className="kpi-label">{es ? "Cobrado este mes" : "Received this month"}</span><span className="tile-value">{formatMoney(thisMonth.receivedCents, lang)}</span></div>
          <div className="tile"><span className="kpi-label">{es ? "Gastado este mes" : "Spent this month"}</span><span className="tile-value">{formatMoney(thisMonth.spentCents, lang)}</span></div>
          <div className={`tile ${thisMonth.receivedCents - thisMonth.spentCents < 0 ? "bad" : ""}`}><span className="kpi-label">{es ? "Neto este mes" : "Net this month"}</span><span className="tile-value">{formatMoney(thisMonth.receivedCents - thisMonth.spentCents, lang)}</span></div>
          <div className="tile"><span className="kpi-label">{es ? "Neto este año" : "Net this year"}</span><span className="tile-value">{formatMoney(months.reduce((a, m) => a + m.receivedCents - m.spentCents, 0), lang)}</span></div>
        </section>
      )}
      {projects.length === 0 ? (
        <section className="card">
          <p style={{ marginTop: 0 }}>{es ? "Un proyecto es un trabajo grande que se cobra por hitos: el cliente paga a medida que avanzas y ve las fotos en su enlace." : "A project is a big job paid in milestones: the customer pays as you go and sees the photos on their link."}</p>
          <p className="muted small">{es ? "Empieza desde un estimado aceptado (botón «Crear proyecto» en el estimado) o desde cero." : "Start from an accepted estimate (the “Create project” button on it) or from scratch."}</p>
          <Link className="btn primary" href="/projects/new">{es ? "Crear el primero" : "Create the first one"}</Link>
        </section>
      ) : (
        <ul className="list" data-testid="project-list">
          {projects.map((p) => {
            const pct = percentDone(p.milestones, p.items);
            const m = moneySummary(p.milestones);
            return (
              <li key={p.id}>
                <Link href={`/projects/${p.id}`}>
                  <span className="grow">
                    <strong>{p.name}</strong>
                    <br />
                    <span className="muted small">{p.customer.name} · {formatMoney(p.totalCents, lang)} · {es ? "pagado" : "paid"} {formatMoney(m.paid, lang)}</span>
                    <span className="progress" style={{ margin: "6px 0 0", maxWidth: 240 }}><span style={{ width: `${pct}%` }} /></span>
                  </span>
                  <span className="pill">{pct}%</span>
                  {p.status !== "active" && <span className="badge grey">{p.status === "done" ? (es ? "Terminado" : "Done") : es ? "Cancelado" : "Cancelled"}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
