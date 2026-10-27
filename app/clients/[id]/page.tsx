import Link from "next/link";
import { notFound } from "next/navigation";
import { ClientForm } from "@/components/ClientForm";
import { Header } from "@/components/Header";
import { parseFilters } from "@/lib/doc-list";
import { statusLabel, dict } from "@/lib/i18n";
import { formatMoney, todayIso } from "@/lib/money";
import { moneySummary, percentDone } from "@/lib/projects";
import { clientProjects, getClient } from "@/lib/projects-store";
import { headerUser, pageCtx } from "@/lib/session";
import { getSettings, searchDocuments } from "@/lib/store";

export const dynamic = "force-dynamic";

/** One client: their record, their projects, and every estimate and invoice. */
export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await pageCtx();
  const [settings, client] = await Promise.all([getSettings(ctx.accountId), getClient(ctx.accountId, id)]);
  if (!client) notFound();
  const lang = settings.lang;
  const es = lang === "es";
  const t = dict(lang);
  const [projects, docs] = await Promise.all([clientProjects(ctx.accountId, client.id), searchDocuments(ctx.accountId, parseFilters({ q: client.name }), todayIso(), { limit: 50, offset: 0 })]);
  const theirs = docs.docs.filter((d) => d.customer.name.toLowerCase() === client.name.toLowerCase());
  return (
    <main className="wrap">
      <Header lang={lang} user={headerUser(ctx)} />
      <p className="small" style={{ margin: "0 0 6px" }}><Link href="/clients">← {es ? "Clientes" : "Clients"}</Link></p>
      <h1 style={{ marginTop: 0 }} data-testid="client-name">{client.name}</h1>
      <ClientForm lang={lang} client={client} />
      <section className="card">
        <div className="row" style={{ alignItems: "baseline" }}>
          <h3 className="grow" style={{ margin: 0 }}>{es ? "Proyectos" : "Projects"}</h3>
          <Link className="btn small primary" href="/projects/new">{es ? "Nuevo proyecto" : "New project"}</Link>
        </div>
        <ul className="list" style={{ marginTop: 8 }} data-testid="client-projects">
          {projects.map((p) => {
            const pct = percentDone(p.milestones, p.items);
            const mo = moneySummary(p.milestones);
            return (
              <li key={p.id}><Link href={`/projects/${p.id}`}><span className="grow"><strong>{p.name}</strong><br /><span className="muted small">{formatMoney(p.totalCents, lang)} · {es ? "cobrado" : "received"} {formatMoney(mo.paid, lang)}</span></span><span className="pill">{pct}%</span></Link></li>
            );
          })}
          {projects.length === 0 && <li className="muted small">{es ? "Sin proyectos todavía." : "No projects yet."}</li>}
        </ul>
      </section>
      <section className="card">
        <h3 style={{ marginTop: 0 }}>{es ? "Estimados y facturas" : "Estimates and invoices"}</h3>
        <ul className="list" data-testid="client-docs">
          {theirs.map((d) => (
            <li key={d.id}><Link href={`/documents/${d.id}`}><span className="grow"><strong>{d.kind === "invoice" ? t.invoice : t.estimate} {d.number}</strong><br /><span className="muted small">{d.issueDate} · {formatMoney(d.totalCents, lang)}</span></span><span className="badge">{statusLabel(t, d.status)}</span></Link></li>
          ))}
          {theirs.length === 0 && <li className="muted small">{es ? "Nada todavía." : "Nothing yet."}</li>}
        </ul>
      </section>
    </main>
  );
}
