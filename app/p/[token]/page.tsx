import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatMoney } from "@/lib/money";
import { currentMilestone, moneySummary, percentDone } from "@/lib/projects";
import { getProjectByToken, listPhotos } from "@/lib/projects-store";
import { getSettings } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The customer's progress page: how far along the job is, the current milestone, what's paid,
 * the next payment (a link to its invoice, with the Pagar button), and the photos by date.
 * No sign-in; the link is the key, like an invoice's.
 */
export default async function PublicProject({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await getProjectByToken(token);
  if (!view) notFound();
  const { project, milestones, items } = view;
  const [settings, photos] = await Promise.all([getSettings(project.accountId), listPhotos(project.id)]);
  const lang = project.lang;
  const es = lang === "es";
  const percent = percentDone(milestones, items);
  const money = moneySummary(milestones);
  const current = currentMilestone(milestones);
  const next = milestones.find((m) => m.status === "invoiced");
  const itemText = new Map(items.map((i) => [i.id, i.text]));
  const byDay = new Map<string, typeof photos>();
  for (const p of photos) {
    const day = new Date(p.at).toLocaleDateString(es ? "es-US" : "en-US", { day: "numeric", month: "long", year: "numeric" });
    byDay.set(day, [...(byDay.get(day) ?? []), p]);
  }
  return (
    <main className="wrap">
      <div className="row" style={{ gap: 12, marginBottom: 12 }}>
        {settings.hasLogo && <img src={`/p/${token}/logo`} alt="" style={{ maxHeight: 44, borderRadius: 8 }} />}
        <div className="grow">
          <strong>{settings.name}</strong>
          <br />
          <span className="muted small">{es ? "Avance del proyecto para" : "Project progress for"} {project.customer.name}</span>
        </div>
      </div>
      <h1 style={{ marginTop: 0 }} data-testid="project-name">{project.name}</h1>

      <section className="cust ok" data-testid="progress-box">
        <strong>{percent}% {es ? "terminado" : "done"}</strong>
        <div className="progress" style={{ margin: "4px 0" }}><span style={{ width: `${percent}%` }} /></div>
        <span>{current ? (es ? `Ahora: ${current.name}` : `Now: ${current.name}`) : es ? "Proyecto terminado y pagado." : "Project finished and paid."}</span>
      </section>

      {next && next.invoiceToken && (
        <section className="cust pay" data-testid="next-payment">
          <strong>{es ? "Siguiente pago" : "Next payment"}: {next.name}</strong>
          <span className="tile-value">{formatMoney(next.amountCents, lang)}</span>
          <a className="btn primary" href={`/i/${next.invoiceToken}`}>{es ? `Ver factura ${next.invoiceNumber} y pagar` : `View invoice ${next.invoiceNumber} and pay`}</a>
        </section>
      )}

      <section className="card">
        <h3 style={{ marginTop: 0 }}>{es ? "Pagos" : "Payments"}</h3>
        <table className="doc" style={{ width: "100%" }}>
          <tbody>
            {milestones.map((m) => (
              <tr key={m.id}>
                <td>{m.position + 1}. {m.name}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{formatMoney(m.amountCents, lang)}</td>
                <td style={{ textAlign: "right" }}>
                  <span className={`badge ${m.status === "paid" ? "" : m.status === "invoiced" ? "warn" : "grey"}`}>
                    {m.status === "paid" ? (es ? "Pagado" : "Paid") : m.status === "invoiced" ? (es ? "Por pagar" : "Due") : es ? "Pendiente" : "Upcoming"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={2}>{es ? "Pagado" : "Paid"}</td><td style={{ textAlign: "right" }}>{formatMoney(money.paid, lang)}</td></tr>
            <tr><td colSpan={2}>{es ? "Por pagar" : "Remaining"}</td><td style={{ textAlign: "right" }}>{formatMoney(money.total - money.paid, lang)}</td></tr>
          </tfoot>
        </table>
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>{es ? "Trabajo" : "Work"}</h3>
        {milestones.map((m) => (
          <div key={m.id} style={{ marginBottom: 10 }}>
            <strong>{m.position + 1}. {m.name}</strong>
            <ul className="list small">
              {items.filter((i) => i.milestoneId === m.id).map((i) => (
                <li key={i.id} style={{ padding: "3px 0" }}>{i.doneAt ? "✅" : "⬜"} {i.text}</li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {photos.length > 0 && (
        <section className="card" data-testid="photos">
          <h3 style={{ marginTop: 0 }}>{es ? "Fotos del avance" : "Progress photos"}</h3>
          {[...byDay.entries()].map(([day, list]) => (
            <div key={day} style={{ marginBottom: 12 }}>
              <div className="muted small">{day}</div>
              <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                {list.map((p) => (
                  <a key={p.id} href={`/p/${token}/photo/${p.id}`} target="_blank" rel="noreferrer" title={p.itemId ? itemText.get(p.itemId) : ""}>
                    <img src={`/p/${token}/photo/${p.id}`} alt={p.itemId ? itemText.get(p.itemId) ?? "" : ""} width={120} height={120} style={{ objectFit: "cover", borderRadius: 10 }} />
                  </a>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
      <p className="made-with">{es ? "Hecho con" : "Made with"} <img src="/brand/loro-icon.svg" alt="" width={18} height={18} /> Loro AI</p>
    </main>
  );
}
