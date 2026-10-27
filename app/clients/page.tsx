import Link from "next/link";
import { Header } from "@/components/Header";
import { formatMoney } from "@/lib/money";
import { listClients } from "@/lib/projects-store";
import { headerUser, pageCtx } from "@/lib/session";
import { getSettings } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Every client, with their projects, documents, what they owe and what they've paid. */
export default async function ClientsPage() {
  const ctx = await pageCtx();
  const [settings, clients] = await Promise.all([getSettings(ctx.accountId), listClients(ctx.accountId)]);
  const lang = settings.lang;
  const es = lang === "es";
  return (
    <main className="wrap">
      <Header lang={lang} user={headerUser(ctx)} />
      <div className="row" style={{ marginBottom: 12 }}>
        <h1 className="grow" style={{ margin: 0 }}>{es ? "Clientes" : "Clients"}</h1>
        <Link className="btn primary" href="/projects/new">{es ? "Nuevo proyecto" : "New project"}</Link>
      </div>
      {clients.length === 0 ? (
        <section className="card"><p style={{ margin: 0 }}>{es ? "Los clientes aparecen aquí en cuanto haces una factura, un estimado o un proyecto para alguien." : "Clients appear here as soon as you make an invoice, an estimate or a project for someone."}</p></section>
      ) : (
        <ul className="list" data-testid="client-list">
          {clients.map((c) => (
            <li key={c.id}>
              <Link href={`/clients/${c.id}`}>
                <span className="grow">
                  <strong>{c.name}</strong>{c.company ? <span className="muted"> · {c.company}</span> : null}
                  <br />
                  <span className="muted small">{[c.phone, c.email, c.address].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="small muted" style={{ textAlign: "right" }}>
                  {c.projects} {es ? "proyecto(s)" : "project(s)"} · {c.documents} {es ? "documento(s)" : "document(s)"}
                  <br />
                  {c.owedCents > 0 ? <span className="badge warn">{es ? "Debe" : "Owes"} {formatMoney(c.owedCents, lang)}</span> : <span className="badge">{es ? "Pagado" : "Paid"} {formatMoney(c.paidCents, lang)}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
