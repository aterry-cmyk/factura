import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { ProjectBoard } from "@/components/ProjectBoard";
import { ProjectMoney } from "@/components/ProjectMoney";
import { ProposalBuilder } from "@/components/ProposalBuilder";
import { Schedule } from "@/components/Schedule";
import { aiConfigured } from "@/lib/ai/config";
import { projectPnl, signalText } from "@/lib/costs";
import { getBudgets, listCosts, listWorkers } from "@/lib/costs-store";
import { appBase } from "@/lib/deliver";
import { formatMoney, todayIso } from "@/lib/money";
import { currentMilestone, moneySummary, percentDone, projectUrl } from "@/lib/projects";
import { getProject, getProposal, listPhotos, listProjectEvents } from "@/lib/projects-store";
import { proposalTotals } from "@/lib/proposal";
import { scheduleSpan, scheduleStatus } from "@/lib/schedule";
import { headerUser, pageCtx } from "@/lib/session";
import { getDocument, getSettings } from "@/lib/store";

export const dynamic = "force-dynamic";

const EVENTS: Record<string, [string, string]> = {
  created: ["Proyecto creado", "Project created"],
  step_done: ["Paso terminado:", "Step done:"],
  step_undone: ["Paso reabierto:", "Step reopened:"],
  photo: ["Foto agregada", "Photo added"],
  milestone_invoiced: ["Hito facturado:", "Milestone invoiced:"],
  done: ["Proyecto terminado", "Project done"],
  cancelled: ["Proyecto cancelado", "Project cancelled"],
  active: ["Proyecto reabierto", "Project reopened"],
  cost: ["Gasto anotado", "Cost logged"],
  scheduled: ["Cronograma guardado, empieza el", "Schedule saved, starts on"],
  proposal_sent: ["Estimado creado desde la propuesta", "Estimate created from the proposal"],
};

const TABS = ["resumen", "propuesta", "cronograma", "avance", "dinero", "fotos"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, [string, string]> = {
  resumen: ["Resumen", "Overview"], propuesta: ["Propuesta", "Proposal"], cronograma: ["Cronograma", "Timeline"],
  avance: ["Avance", "Progress"], dinero: ["Dinero", "Money"], fotos: ["Fotos", "Photos"],
};

/** The project's control center: one page, six tabs, every number from the same records. */
export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab: t } = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(t ?? "") ? (t as Tab) : "resumen";
  const ctx = await pageCtx();
  const [settings, view] = await Promise.all([getSettings(ctx.accountId), getProject(ctx.accountId, id)]);
  if (!view) notFound();
  const { project, milestones, items } = view;
  const lang = settings.lang;
  const es = lang === "es";
  const today = todayIso();
  const [events, budgets, costs, workers, photos, proposal, estimate] = await Promise.all([
    listProjectEvents(project.id), getBudgets(project.id), listCosts(project.id), listWorkers(ctx.accountId, true), listPhotos(project.id),
    getProposal(ctx.accountId, project.id), project.estimateId ? getDocument(ctx.accountId, project.estimateId) : null,
  ]);
  const h = await headers();
  const host = h.get("host");
  const base = appBase(host ? `${h.get("x-forwarded-proto") ?? "http"}://${host}` : undefined);
  const percent = percentDone(milestones, items);
  const money = moneySummary(milestones);
  const pnl = projectPnl({ contractCents: project.totalCents, budgets, costs, milestones, percentDone: percent });
  const current = currentMilestone(milestones);
  const span = scheduleSpan(milestones);
  const sched = span ? scheduleStatus(span, today, percent) : null;
  const fmt = (d: string) => new Intl.DateTimeFormat(es ? "es-US" : "en-US", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
  const m = (c: number) => formatMoney(c, lang);
  const itemText = new Map(items.map((i) => [i.id, i.text]));

  return (
    <main className="wrap" style={{ maxWidth: 880 }}>
      <Header lang={lang} user={headerUser(ctx)} />
      <p className="small" style={{ margin: "0 0 6px" }}><Link href="/projects">← {es ? "Proyectos" : "Projects"}</Link></p>
      <div className="row" style={{ marginBottom: 4, alignItems: "baseline", flexWrap: "wrap" }}>
        <h1 className="grow" style={{ margin: 0 }} data-testid="project-name">{project.name}</h1>
        {project.status !== "active" && <span className="badge grey">{project.status === "done" ? (es ? "Terminado" : "Done") : es ? "Cancelado" : "Cancelled"}</span>}
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        {project.customerId ? <Link href={`/clients/${project.customerId}`}>{project.customer.name}</Link> : project.customer.name}
        {estimate && <> · <Link href={`/documents/${estimate.id}`}>{es ? "Estimado" : "Estimate"} {estimate.number}</Link> {estimate.status === "accepted" ? "✓" : ""}</>}
        {span && <> · {fmt(span.startsOn)} – {fmt(span.endsOn)}</>}
      </p>

      <nav className="tabs" role="tablist" style={{ marginBottom: 14 }} data-testid="project-tabs">
        {TABS.map((x) => (
          <Link key={x} role="tab" aria-selected={x === tab} aria-pressed={x === tab} className="chip" href={`/projects/${project.id}?tab=${x}`}>{TAB_LABEL[x][es ? 0 : 1]}</Link>
        ))}
      </nav>

      {tab === "resumen" && (
        <div className="stack" data-testid="overview">
          <section className="tiles" style={{ marginBottom: 0 }}>
            <Link className="tile" href={`/projects/${project.id}?tab=propuesta`}><span className="kpi-label">{es ? "Contrato" : "Contract"}</span><span className="tile-value">{m(project.totalCents)}</span><span className="kpi-sub muted small">{estimate ? `${estimate.number} · ${estimate.status === "accepted" ? (es ? "aceptado" : "accepted") : es ? "enviado" : "sent"}` : es ? "sin estimado" : "no estimate yet"}</span></Link>
            <Link className="tile good" href={`/projects/${project.id}?tab=avance`}><span className="kpi-label">{es ? "Cobrado" : "Received"}</span><span className="tile-value">{m(money.paid)}</span><span className="kpi-sub muted small">{es ? "facturado por cobrar" : "invoiced, unpaid"} {m(money.invoiced)}</span></Link>
            <Link className="tile" href={`/projects/${project.id}?tab=dinero`}><span className="kpi-label">{es ? "Gastado" : "Spent"}</span><span className="tile-value">{m(pnl.spentCents)}</span><span className="kpi-sub muted small">{es ? "presupuesto" : "budget"} {m(pnl.budgetCents)}</span></Link>
            <Link className={`tile ${pnl.margin.projectedCents < 0 ? "bad" : ""}`} href={`/projects/${project.id}/pnl`}><span className="kpi-label">{es ? "Margen proyectado" : "Projected margin"}</span><span className="tile-value">{m(pnl.margin.projectedCents)}</span><span className="kpi-sub muted small">{pnl.margin.projectedPercent != null ? `${pnl.margin.projectedPercent}%` : ""}</span></Link>
          </section>

          <section className="card">
            <div className="row" style={{ alignItems: "baseline" }}>
              <strong className="grow">{es ? "Avance" : "Progress"}</strong>
              <span className="pill" data-testid="percent">{percent}%</span>
            </div>
            <div className="progress" style={{ marginBottom: 8 }}><span style={{ width: `${percent}%` }} /></div>
            <p className="muted small" style={{ margin: 0 }}>
              {current ? (es ? `Ahora: ${current.name}` : `Now: ${current.name}`) : es ? "Todos los hitos están pagados." : "Every milestone is paid."}
              {sched && (sched.behind ? (es ? ` · Atrasado: el calendario pide ${sched.expectedPercent}%.` : ` · Behind: the calendar asks for ${sched.expectedPercent}%.`) : es ? ` · Al día. Quedan ${sched.daysLeft} días.` : ` · On track. ${sched.daysLeft} days left.`)}
            </p>
            {signalText(pnl, lang, m) && <p className="note warn" style={{ marginTop: 10 }}>{signalText(pnl, lang, m)}</p>}
          </section>

          <div className="grid2">
            <section className="card" style={{ marginBottom: 0 }}>
              <h3 style={{ marginTop: 0 }}>{es ? "Cliente" : "Client"}</h3>
              <p style={{ margin: 0 }}><strong>{project.customer.name}</strong>{project.customer.company ? ` · ${project.customer.company}` : ""}</p>
              <p className="muted small" style={{ margin: "4px 0 8px" }}>{[project.customer.phone, project.customer.email].filter(Boolean).join(" · ") || (es ? "Sin contacto todavía" : "No contact yet")}</p>
              <div className="row" style={{ flexWrap: "wrap" }}>
                {project.customerId && <Link className="btn small" href={`/clients/${project.customerId}`}>{es ? "Ficha del cliente" : "Client record"}</Link>}
                <a className="btn small" href={projectUrl(project, base)} target="_blank" rel="noreferrer" data-testid="public-link">{es ? "Su enlace de avance" : "Their progress link"}</a>
              </div>
            </section>
            <section className="card" style={{ marginBottom: 0 }}>
              <h3 style={{ marginTop: 0 }}>{es ? "Qué sigue" : "What's next"}</h3>
              <ul className="list small" data-testid="next-steps">
                {!estimate && <li>→ <Link href={`/projects/${project.id}?tab=propuesta`}>{es ? "Armar la propuesta con Loro" : "Build the proposal with Loro"}</Link>{proposal ? ` (${es ? "borrador" : "draft"}: ${m(proposalTotals(proposal).totalCents)})` : ""}</li>}
                {estimate && estimate.status !== "accepted" && <li>→ {es ? `Esperando que ${project.customer.name} acepte el estimado ${estimate.number}.` : `Waiting for ${project.customer.name} to accept estimate ${estimate.number}.`}</li>}
                {!span && <li>→ <Link href={`/projects/${project.id}?tab=cronograma`}>{es ? "Poner fechas al cronograma" : "Put dates on the timeline"}</Link></li>}
                {pnl.budgetCents === 0 && <li>→ <Link href={`/projects/${project.id}?tab=dinero`}>{es ? "Poner el presupuesto por tipo de costo" : "Set the budget by cost code"}</Link></li>}
                {current && <li>→ <Link href={`/projects/${project.id}?tab=avance`}>{es ? `Marcar pasos de «${current.name}»` : `Tick steps of “${current.name}”`}</Link>{current.status === "invoiced" ? (es ? ` · factura ${current.invoiceNumber} por cobrar` : ` · invoice ${current.invoiceNumber} unpaid`) : ""}</li>}
              </ul>
            </section>
          </div>

          <section className="card">
            <h3 style={{ marginTop: 0 }}>{es ? "Hitos" : "Milestones"}</h3>
            <table className="doc" style={{ width: "100%" }}>
              <tbody>
                {milestones.map((ms) => {
                  const steps = items.filter((i) => i.milestoneId === ms.id);
                  const done = steps.filter((i) => i.doneAt).length;
                  return (
                    <tr key={ms.id}>
                      <td>{ms.position + 1}. {ms.name}</td>
                      <td className="muted small">{ms.startsOn && ms.endsOn ? `${fmt(ms.startsOn)} – ${fmt(ms.endsOn)}` : "—"}</td>
                      <td className="muted small">{steps.length ? `${done}/${steps.length}` : ""}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{m(ms.amountCents)}</td>
                      <td style={{ textAlign: "right" }}><span className={`badge ${ms.status === "paid" ? "" : ms.status === "invoiced" ? "warn" : "grey"}`}>{ms.status === "paid" ? (es ? "Pagado" : "Paid") : ms.status === "invoiced" ? (es ? "Facturado" : "Invoiced") : es ? "Pendiente" : "Pending"}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <section className="card">
            <h3>{es ? "Historial" : "History"}</h3>
            <ul className="list small">
              {events.slice(0, 12).map((e, i) => (
                <li key={i} style={{ padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
                  <span className="muted">{new Date(e.at).toLocaleString(es ? "es-US" : "en-US")}</span> · {(EVENTS[e.kind] ?? [e.kind, e.kind])[es ? 0 : 1]} {["created", "cost", "proposal_sent"].includes(e.kind) ? "" : e.detail}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {tab === "propuesta" && (
        <ProposalBuilder lang={lang} projectId={project.id} description={project.description} proposal={proposal} aiReady={aiConfigured()} estimateId={estimate?.id ?? null} estimateNumber={estimate?.number ?? ""} markupPercent={settings.markupPercent} contingencyPercent={settings.contingencyPercent} />
      )}

      {tab === "cronograma" && <Schedule lang={lang} projectId={project.id} startsOn={project.startsOn} milestones={milestones} percentDone={percent} today={today} />}

      {tab === "avance" && (
        <ProjectBoard lang={lang} project={project} milestones={milestones} items={items} publicLink={projectUrl(project, base)} invoiceBase={base.replace(/\/$/, "")} businessName={settings.name} />
      )}

      {tab === "dinero" && (
        <ProjectMoney lang={lang} projectId={project.id} budgets={budgets} costs={costs} pnl={pnl} signal={signalText(pnl, lang, m)} workers={workers} aiReady={aiConfigured()} today={today} />
      )}

      {tab === "fotos" && (
        <section className="card" data-testid="photos">
          <h3 style={{ marginTop: 0 }}>{es ? "Fotos del proyecto" : "Project photos"}</h3>
          {photos.length === 0 && <p className="muted small">{es ? "Todavía no hay fotos. Se agregan desde Avance (pasos) y desde Dinero (recibos)." : "No photos yet. They are added from Progress (steps) and Money (receipts)."}</p>}
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            {photos.map((p) => (
              <a key={p.id} href={`/api/projects/${project.id}/photos/${p.id}`} target="_blank" rel="noreferrer" title={p.itemId ? itemText.get(p.itemId) : es ? "Recibo o foto del proyecto" : "Receipt or project photo"}>
                <img src={`/api/projects/${project.id}/photos/${p.id}`} alt={p.itemId ? itemText.get(p.itemId) ?? "" : ""} width={140} height={140} style={{ objectFit: "cover", borderRadius: 10 }} />
              </a>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
