"use client";

import { useState } from "react";
import { dict } from "@/lib/i18n";
import type { Doc, Lang } from "@/lib/types";
import { blockMessage } from "@/lib/plans";

type Doc4Actions = Pick<Doc, "id" | "kind" | "status" | "customer" | "publicToken">;

export function DocActions({
  doc,
  lang,
  emailReady,
  smsReady,
  publicLink,
}: {
  doc: Doc4Actions;
  lang: Lang;
  emailReady: boolean;
  smsReady: boolean;
  publicLink: string;
}) {
  const t = dict(lang);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "warn" | "bad"; text: string } | null>(null);

  async function post(url: string, body?: unknown): Promise<Response | null> {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => null);
  }

  async function send(channel: "email" | "sms") {
    setBusy(channel);
    setMessage(null);
    const res = await post(`/api/documents/${doc.id}/send`, { channel });
    setBusy(null);
    if (res?.ok) {
      setMessage({ kind: "ok", text: `${t.sent} ✓` });
      setTimeout(() => window.location.reload(), 900);
      return;
    }
    const code = res ? ((await res.json().catch(() => ({}))) as { error?: string }).error : "";
    const text =
      code === "setup" ? (channel === "email" ? t.emailSetup : t.smsSetup)
      : code === "no_recipient" ? (channel === "email" ? t.noEmail : t.noPhone)
      : lang === "es" ? "No se pudo enviar. El detalle quedó en el historial." : "It couldn't be sent. The details are in the history.";
    setMessage({ kind: code === "setup" || code === "no_recipient" ? "warn" : "bad", text });
  }

  async function copyLink() {
    // Sharing the link means it's out: a draft becomes "sent" so the customer's page opens.
    if (doc.status === "draft") await post(`/api/documents/${doc.id}/status`, { status: "sent" });
    try {
      await navigator.clipboard.writeText(publicLink);
      setMessage({ kind: "ok", text: `${t.copied}: ${publicLink}` });
    } catch {
      setMessage({ kind: "warn", text: publicLink });
    }
    if (doc.status === "draft") setTimeout(() => window.location.reload(), 1200);
  }

  async function status(next: string) {
    setBusy(next);
    const res = await post(`/api/documents/${doc.id}/status`, { status: next });
    if (res?.ok) window.location.reload();
    else {
      setBusy(null);
      const code = res ? ((await res.json().catch(() => ({}))) as { error?: string }).error : undefined;
      setMessage({ kind: "bad", text: blockMessage(code, lang) ?? t.errorGeneric });
    }
  }

  async function convert() {
    setBusy("convert");
    const res = await post(`/api/documents/${doc.id}/convert`);
    if (res?.ok) {
      const { id } = (await res.json()) as { id: string };
      window.location.href = `/documents/${id}`;
    } else {
      setBusy(null);
      setMessage({ kind: "bad", text: t.errorGeneric });
    }
  }

  const open = doc.status === "draft" || doc.status === "sent" || doc.status === "accepted";

  return (
    <div className="stack">
      {open && (
        <section className="card stack">
          <h2>{t.readyToSend}</h2>
          <div className="row">
            <button className="btn primary grow" onClick={() => send("email")} disabled={busy !== null} data-testid="send-email">
              {busy === "email" ? t.sending : t.sendEmail}
            </button>
            <button className="btn primary grow" onClick={() => send("sms")} disabled={busy !== null} data-testid="send-sms">
              {busy === "sms" ? t.sending : t.sendSms}
            </button>
          </div>
          {(!emailReady || !smsReady) && (
            <p className="muted small" style={{ margin: 0 }}>
              {t.setupNeeded}: {[!emailReady && "Email", !smsReady && "SMS"].filter(Boolean).join(", ")}
            </p>
          )}
          <div className="row">
            <button className="btn grow" onClick={copyLink}>{t.copyLink}</button>
            <a className="btn grow" href={`/api/documents/${doc.id}/pdf`} target="_blank" rel="noreferrer">{t.downloadPdf}</a>
          </div>
          {message && <p className={`note ${message.kind === "ok" ? "" : message.kind}`} role="status" style={{ wordBreak: "break-all" }}>{message.text}</p>}
        </section>
      )}
      <section className="row">
        {doc.status === "draft" && <a className="btn" href={`/?edit=${doc.id}`}>{t.edit}</a>}
        {doc.kind === "invoice" && (doc.status === "sent" || doc.status === "draft") && (
          <button className="btn primary" onClick={() => status("paid")} disabled={busy !== null}>{t.markPaid}</button>
        )}
        {doc.kind === "invoice" && doc.status === "paid" && (
          <button className="btn" onClick={() => status("sent")} disabled={busy !== null}>{t.markUnpaid}</button>
        )}
        {doc.kind === "estimate" && doc.status !== "void" && (
          <button className="btn primary" onClick={convert} disabled={busy !== null}>{t.toInvoice}</button>
        )}
        {doc.kind === "estimate" && (doc.status === "sent" || doc.status === "draft") && (
          <button className="btn" onClick={() => status("accepted")} disabled={busy !== null}>{t.markAccepted}</button>
        )}
        {doc.status !== "void" && doc.status !== "paid" && (
          <button className="btn danger" onClick={() => { if (confirm(t.voidDoc + "?")) status("void"); }} disabled={busy !== null}>{t.voidDoc}</button>
        )}
        {!open && <a className="btn" href={`/api/documents/${doc.id}/pdf`} target="_blank" rel="noreferrer">{t.downloadPdf}</a>}
      </section>
      {!open && message && <p className={`note ${message.kind}`}>{message.text}</p>}
    </div>
  );
}
