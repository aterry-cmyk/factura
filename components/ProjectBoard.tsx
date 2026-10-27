"use client";

import { useState } from "react";
import { shrinkPhoto } from "@/components/shrinkPhoto";
import { formatMoney } from "@/lib/money";
import { canInvoice, currentMilestone, moneySummary, percentDone, progressMessage, type ChecklistItem, type Milestone, type Project } from "@/lib/projects";
import type { Lang } from "@/lib/types";
import { blockMessage } from "@/lib/plans";

const L = (lang: Lang, es: string, en: string) => (lang === "es" ? es : en);

/**
 * The owner's view of one project: the money strip, the milestones with their checklist steps,
 * a photo per step, "invoice this milestone" when its steps are done, and the customer's link
 * with a ready-to-send update written from the numbers.
 */
export function ProjectBoard(props: { lang: Lang; project: Project; milestones: Milestone[]; items: ChecklistItem[]; publicLink: string; invoiceBase: string; businessName: string }) {
  const { lang, project, milestones, publicLink, invoiceBase, businessName } = props;
  const es = lang === "es";
  const [items, setItems] = useState(props.items);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: "ok" | "bad" | "warn"; text: string } | null>(null);
  const [justDone, setJustDone] = useState<string[]>([]);

  const percent = percentDone(milestones, items);
  const money = moneySummary(milestones);
  const current = currentMilestone(milestones);
  const nextPayment = milestones.find((m) => m.status === "invoiced");

  async function toggle(item: ChecklistItem) {
    const done = !item.doneAt;
    setBusy(item.id);
    const res = await fetch(`/api/projects/${project.id}/items/${item.id}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ done }),
    }).catch(() => null);
    setBusy(null);
    if (!res?.ok) return setNote({ kind: "bad", text: L(lang, "No se pudo guardar. Intenta de nuevo.", "Couldn't save. Try again.") });
    const { doneAt } = (await res.json()) as { doneAt: string | null };
    setItems((list) => list.map((i) => (i.id === item.id ? { ...i, doneAt } : i)));
    setJustDone((d) => (done ? [...d, item.text] : d.filter((t) => t !== item.text)));
  }

  async function photo(item: ChecklistItem, file: File) {
    setBusy(`photo-${item.id}`);
    const body = new FormData();
    body.append("photo", await shrinkPhoto(file, 1400), "foto.jpg");
    body.append("itemId", item.id);
    const res = await fetch(`/api/projects/${project.id}/photos`, { method: "POST", body }).catch(() => null);
    setBusy(null);
    if (!res?.ok) return setNote({ kind: "bad", text: L(lang, "La foto no se pudo subir. Prueba con una foto JPG o PNG de menos de 2 MB.", "The photo couldn't be uploaded. Try a JPG or PNG under 2 MB.") });
    const { id } = (await res.json()) as { id: string };
    setItems((list) => list.map((i) => (i.id === item.id ? { ...i, photoIds: [...i.photoIds, id] } : i)));
    setNote({ kind: "ok", text: L(lang, "Foto guardada. El cliente la ve en su enlace.", "Photo saved. The customer sees it on their link.") });
  }

  async function invoice(m: Milestone) {
    setBusy(`inv-${m.id}`);
    setNote(null);
    const res = await fetch(`/api/projects/${project.id}/milestones/${m.id}/invoice`, { method: "POST" }).catch(() => null);
    const json = res ? ((await res.json().catch(() => ({}))) as { id?: string; number?: string; error?: string }) : {};
    if (res?.ok && json.id) {
      window.location.href = `/documents/${json.id}`;
      return;
    }
    setBusy(null);
    setNote({
      kind: res?.status === 402 ? "warn" : "bad",
      text: res?.status === 402 ? (blockMessage(json.error, lang) ?? "")
        : json.error === "steps_open" ? L(lang, "Marca todos los pasos de este hito antes de cobrarlo.", "Tick every step of this milestone before invoicing it.")
        : L(lang, "No se pudo crear la factura.", "The invoice couldn't be created."),
    });
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNote({ kind: "ok", text: `${label} ✓` });
    } catch {
      setNote({ kind: "warn", text });
    }
  }

  async function finish() {
    if (!confirm(L(lang, "¿Marcar el proyecto como terminado?", "Mark the project as done?"))) return;
    const res = await fetch(`/api/projects/${project.id}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "done" }) }).catch(() => null);
    if (res?.ok) window.location.reload();
  }

  const message = progressMessage({
    lang, businessName, customerName: project.customer.name, projectName: project.name, percent, justDone, current,
    nextPayment: nextPayment && nextPayment.invoiceToken ? { name: nextPayment.name, amountText: formatMoney(nextPayment.amountCents, lang), link: `${invoiceBase}/i/${nextPayment.invoiceToken}` } : null,
    link: publicLink,
  });
  const wa = project.customer.phone ? `https://wa.me/${project.customer.phone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}` : `https://wa.me/?text=${encodeURIComponent(message)}`;

  return (
    <div className="stack" data-testid="project-board">
      <section className="tiles" style={{ marginBottom: 0 }}>
        <div className="tile"><span className="kpi-label">{L(lang, "Total", "Total")}</span><span className="tile-value">{formatMoney(money.total, lang)}</span></div>
        <div className="tile good"><span className="kpi-label">{L(lang, "Pagado", "Paid")}</span><span className="tile-value" data-testid="paid">{formatMoney(money.paid, lang)}</span></div>
        <div className="tile"><span className="kpi-label">{L(lang, "Facturado, por cobrar", "Invoiced, unpaid")}</span><span className="tile-value" data-testid="invoiced">{formatMoney(money.invoiced, lang)}</span></div>
        <div className="tile"><span className="kpi-label">{L(lang, "Por facturar", "Still to invoice")}</span><span className="tile-value" data-testid="remaining">{formatMoney(money.remaining, lang)}</span></div>
      </section>

      <section className="card">
        <div className="row" style={{ alignItems: "baseline" }}>
          <strong className="grow">{L(lang, "Avance", "Progress")}</strong>
          <span className="pill" data-testid="percent">{percent}%</span>
        </div>
        <div className="progress" style={{ marginBottom: 8 }}><span style={{ width: `${percent}%` }} /></div>
        <p className="muted small" style={{ margin: 0 }}>
          {current ? L(lang, `Ahora: ${current.name}`, `Now: ${current.name}`) : L(lang, "Todos los hitos están pagados.", "Every milestone is paid.")}
        </p>
      </section>

      {note && <p className={`note ${note.kind}`} role="status">{note.text}</p>}

      {milestones.map((m) => {
        const steps = items.filter((i) => i.milestoneId === m.id);
        const ready = canInvoice(m, steps);
        return (
          <section className="card ms" key={m.id} data-testid="milestone" data-status={m.status}>
            <div className="row" style={{ alignItems: "baseline", flexWrap: "wrap" }}>
              <span className="pill">{m.position + 1}</span>
              <h3 className="grow" style={{ margin: 0 }}>{m.name}</h3>
              <strong className="amount">{formatMoney(m.amountCents, lang)}</strong>
              <span className={`badge ${m.status === "paid" ? "" : m.status === "invoiced" ? "warn" : "grey"}`}>
                {m.status === "paid" ? L(lang, "Pagado", "Paid") : m.status === "invoiced" ? L(lang, "Facturado", "Invoiced") : L(lang, "Pendiente", "Pending")}
              </span>
            </div>
            <ul className="list" style={{ margin: "10px 0" }}>
              {steps.map((i) => (
                <li key={i.id} className="step">
                  <label className="check">
                    <input type="checkbox" checked={Boolean(i.doneAt)} onChange={() => toggle(i)} disabled={busy === i.id || m.status === "paid"} />
                    <span className={i.doneAt ? "muted" : ""} style={i.doneAt ? { textDecoration: "line-through" } : undefined}>{i.text}</span>
                  </label>
                  <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                    {i.photoIds.map((pid) => (
                      <a key={pid} href={`/api/projects/${project.id}/photos/${pid}`} target="_blank" rel="noreferrer">
                        <img src={`/api/projects/${project.id}/photos/${pid}`} alt="" width={56} height={56} style={{ objectFit: "cover", borderRadius: 8 }} />
                      </a>
                    ))}
                    <label className="btn small photo-btn">
                      {busy === `photo-${i.id}` ? L(lang, "Subiendo…", "Uploading…") : L(lang, "📷 Foto", "📷 Photo")}
                      <input type="file" accept="image/*" capture="environment" className="sr" data-testid="step-photo" onChange={(e) => { const f = e.target.files?.[0]; if (f) void photo(i, f); e.target.value = ""; }} disabled={busy !== null} />
                    </label>
                  </div>
                </li>
              ))}
              {steps.length === 0 && <li className="muted small">{L(lang, "Sin pasos.", "No steps.")}</li>}
            </ul>
            <div className="row" style={{ flexWrap: "wrap" }}>
              {m.status === "pending" && (
                <button className="btn primary" onClick={() => invoice(m)} disabled={!ready || busy !== null} data-testid="invoice-milestone" title={ready ? "" : L(lang, "Marca todos los pasos primero", "Tick every step first")}>
                  {busy === `inv-${m.id}` ? L(lang, "Creando factura…", "Creating invoice…") : L(lang, `Cobrar este hito · ${formatMoney(m.amountCents, lang)}`, `Invoice this milestone · ${formatMoney(m.amountCents, lang)}`)}
                </button>
              )}
              {m.invoiceId && <a className="btn" href={`/documents/${m.invoiceId}`}>{L(lang, `Ver factura ${m.invoiceNumber}`, `View invoice ${m.invoiceNumber}`)}</a>}
              {m.status === "pending" && !ready && <span className="muted small">{L(lang, "Se puede cobrar cuando todos los pasos estén marcados.", "Can be invoiced once every step is ticked.")}</span>}
            </div>
          </section>
        );
      })}

      <section className="card">
        <h3 style={{ marginTop: 0 }}>{L(lang, "Lo que ve el cliente", "What the customer sees")}</h3>
        <p className="small muted">{L(lang, "Su enlace muestra el avance, las fotos, lo pagado y el siguiente pago. Mándaselo cuando termines algo.", "Their link shows the progress, the photos, what's paid and the next payment. Send it when you finish something.")}</p>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <a className="btn" href={publicLink} target="_blank" rel="noreferrer" data-testid="public-link">{L(lang, "Ver como lo ve el cliente", "See it as the customer")}</a>
          <button className="btn" onClick={() => copy(publicLink, L(lang, "Enlace copiado", "Link copied"))}>{L(lang, "Copiar enlace", "Copy link")}</button>
          <button className="btn" onClick={() => copy(message, L(lang, "Mensaje copiado", "Message copied"))} data-testid="copy-update">{L(lang, "Copiar mensaje de avance", "Copy progress update")}</button>
          <a className="btn" href={wa} target="_blank" rel="noreferrer">WhatsApp</a>
        </div>
        <pre className="small muted" style={{ whiteSpace: "pre-wrap", marginBottom: 0 }} data-testid="update-text">{message}</pre>
      </section>

      {project.status === "active" && (
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn small" onClick={finish}>{L(lang, "Marcar proyecto terminado", "Mark project done")}</button>
        </div>
      )}
    </div>
  );
}
