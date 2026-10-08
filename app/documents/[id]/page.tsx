import { notFound } from "next/navigation";
import { DocActions } from "@/components/DocActions";
import { DocView } from "@/components/DocView";
import { Header } from "@/components/Header";
import { appBase } from "@/lib/deliver";
import { publicUrl } from "@/lib/document-text";
import { dict, statusLabel } from "@/lib/i18n";
import { todayIso } from "@/lib/money";
import { emailConfigured, smsConfigured } from "@/lib/send";
import { getDocument, getSettings, listEvents } from "@/lib/store";
import { headers } from "next/headers";
import { headerUser, pageCtx } from "@/lib/session";

export const dynamic = "force-dynamic";

const EVENT_LABELS: Record<string, [string, string]> = {
  created: ["Creada", "Created"],
  edited: ["Editada", "Edited"],
  sent_email: ["Enviada por correo a", "Emailed to"],
  sent_sms: ["Enviada por SMS a", "Texted to"],
  reminder_email: ["Recordatorio por correo a", "Reminder emailed to"],
  reminder_sms: ["Recordatorio por SMS a", "Reminder texted to"],
  sent_email_failed: ["Falló el correo", "Email failed"],
  sent_sms_failed: ["Falló el SMS", "Text failed"],
  reminder_email_failed: ["Falló el recordatorio por correo", "Reminder email failed"],
  reminder_sms_failed: ["Falló el recordatorio por SMS", "Reminder text failed"],
  paid: ["Marcada pagada", "Marked paid"],
  unpaid: ["Marcada no pagada / enviada", "Marked unpaid / sent"],
  void: ["Anulada", "Voided"],
  accepted: ["Aceptado", "Accepted"],
};

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await pageCtx();
  const [doc, settings] = await Promise.all([getDocument(ctx.accountId, id), getSettings(ctx.accountId)]);
  if (!doc) notFound();
  const t = dict(settings.lang);
  const events = await listEvents(doc.id);
  const h = await headers();
  const host = h.get("host");
  const base = appBase(host ? `${h.get("x-forwarded-proto") ?? "http"}://${host}` : undefined);
  const es = settings.lang === "es";

  return (
    <main className="wrap">
      <Header lang={settings.lang} user={headerUser(ctx)} />
      <div className="row" style={{ marginBottom: 12 }}>
        <h1 className="grow" style={{ margin: 0 }}>
          {doc.kind === "invoice" ? t.invoice : t.estimate} {doc.number}
        </h1>
        <span className="badge" data-testid="status">{statusLabel(t, doc.status)}</span>
      </div>
      <DocActions
        doc={{ id: doc.id, kind: doc.kind, status: doc.status, customer: doc.customer, publicToken: doc.publicToken }}
        lang={settings.lang}
        emailReady={emailConfigured()}
        smsReady={smsConfigured()}
        publicLink={publicUrl(doc, base)}
      />
      <div style={{ marginTop: 14 }}>
        <DocView doc={doc} logoSrc={settings.hasLogo ? "/api/settings/logo" : null} today={todayIso()} />
      </div>
      <section className="card" style={{ marginTop: 14 }}>
        <h3>{t.history}</h3>
        <ul className="list small">
          {events.map((e, i) => (
            <li key={i} style={{ padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
              <span className="muted">{new Date(e.at).toLocaleString(es ? "es-US" : "en-US")}</span> ·{" "}
              {(EVENT_LABELS[e.kind] ?? [e.kind, e.kind])[es ? 0 : 1]} {e.kind.endsWith("failed") ? "" : e.detail}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
