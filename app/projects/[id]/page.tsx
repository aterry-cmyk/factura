import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { ProjectBoard } from "@/components/ProjectBoard";
import { ProjectMoney } from "@/components/ProjectMoney";
import { aiConfigured } from "@/lib/ai/config";
import { projectPnl, signalText } from "@/lib/costs";
import { getBudgets, listCosts, listWorkers } from "@/lib/costs-store";
import { formatMoney, todayIso } from "@/lib/money";
import { percentDone } from "@/lib/projects";
import { appBase } from "@/lib/deliver";
import { projectUrl } from "@/lib/projects";
import { getProject, listProjectEvents } from "@/lib/projects-store";
import { headerUser, pageCtx } from "@/lib/session";
import { getSettings } from "@/lib/store";

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
};

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await pageCtx();
  const [settings, view] = await Promise.all([getSettings(ctx.accountId), getProject(ctx.accountId, id)]);
  if (!view) notFound();
  const lang = settings.lang;
  const es = lang === "es";
  const [events, budgets, costs, workers] = await Promise.all([listProjectEvents(view.project.id), getBudgets(view.project.id), listCosts(view.project.id), listWorkers(ctx.accountId, true)]);
  const pnl = projectPnl({ contractCents: view.project.totalCents, budgets, costs, milestones: view.milestones, percentDone: percentDone(view.milestones, view.items) });
  const h = await headers();
  const host = h.get("host");
  const base = appBase(host ? `${h.get("x-forwarded-proto") ?? "http"}://${host}` : undefined);
  return (
    <main className="wrap">
      <Header lang={lang} user={headerUser(ctx)} />
      <p className="small" style={{ margin: "0 0 6px" }}><Link href="/projects">← {es ? "Proyectos" : "Projects"}</Link></p>
      <div className="row" style={{ marginBottom: 12, alignItems: "baseline" }}>
        <h1 className="grow" style={{ margin: 0 }} data-testid="project-name">{view.project.name}</h1>
        {view.project.status !== "active" && <span className="badge grey">{view.project.status === "done" ? (es ? "Terminado" : "Done") : es ? "Cancelado" : "Cancelled"}</span>}
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        {view.project.customer.name}
        {view.project.estimateId && <> · <Link href={`/documents/${view.project.estimateId}`}>{es ? "Ver el estimado" : "View the estimate"}</Link></>}
      </p>
      <ProjectBoard
        lang={lang} project={view.project} milestones={view.milestones} items={view.items}
        publicLink={projectUrl(view.project, base)} invoiceBase={base.replace(/\/$/, "")} businessName={settings.name}
      />
      <div style={{ marginTop: 14 }}>
        <ProjectMoney lang={lang} projectId={view.project.id} budgets={budgets} costs={costs} pnl={pnl} signal={signalText(pnl, lang, (c) => formatMoney(c, lang))} workers={workers} aiReady={aiConfigured()} today={todayIso()} />
      </div>
      <section className="card" style={{ marginTop: 14 }}>
        <h3>{es ? "Historial" : "History"}</h3>
        <ul className="list small">
          {events.map((e, i) => (
            <li key={i} style={{ padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
              <span className="muted">{new Date(e.at).toLocaleString(es ? "es-US" : "en-US")}</span> · {(EVENTS[e.kind] ?? [e.kind, e.kind])[es ? 0 : 1]} {e.kind === "created" || e.kind === "cost" ? "" : e.detail}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
