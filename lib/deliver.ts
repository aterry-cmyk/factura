import { dict } from "./i18n";
import { amountDueCents, formatMoney, todayIso } from "./money";
import { renderPdf } from "./pdf";
import { docTitle, formatDate, publicUrl, smsBody } from "./document-text";
import { emailConfigured, sendEmail, sendSms, smsConfigured } from "./send";
import { getLogo, markReminded, markSent, recordEvent } from "./store";
import type { Doc } from "./types";

export type Channel = "email" | "sms";
export type DeliverResult = { ok: true } | { ok: false; reason: "setup" | "no_recipient" | "closed" | "failed" };

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function emailContent(doc: Doc, base: string, opts: { reminder?: boolean; today: string }) {
  const t = dict(doc.lang);
  const es = doc.lang === "es";
  const due = amountDueCents(doc, opts.today);
  const amount = formatMoney(opts.reminder ? due : doc.totalCents, doc.lang);
  const link = publicUrl(doc, base);
  const title = `${docTitle(doc)} ${doc.number}`;
  const subject = opts.reminder
    ? es
      ? `Recordatorio: ${title} de ${doc.business.name}`
      : `Reminder: ${title} from ${doc.business.name}`
    : `${title} — ${doc.business.name}`;
  const intro = opts.reminder
    ? es
      ? `Le recordamos que la ${title.toLowerCase()} por ${amount} venció el ${formatDate(doc.dueDate, "es")}.`
      : `This is a reminder that ${title.toLowerCase()} for ${amount} was due on ${formatDate(doc.dueDate, "en")}.`
    : doc.kind === "estimate"
      ? es
        ? `Adjuntamos el presupuesto ${doc.number} por ${amount}.`
        : `Attached is estimate ${doc.number} for ${amount}.`
      : es
        ? `Adjuntamos la factura ${doc.number} por ${amount}, con vencimiento el ${formatDate(doc.dueDate, "es")}.`
        : `Attached is invoice ${doc.number} for ${amount}, due ${formatDate(doc.dueDate, "en")}.`;
  const greeting = es ? `Hola ${doc.customer.name},` : `Hi ${doc.customer.name},`;
  const cta = es ? "Ver en línea" : "View online";
  const text = [greeting, "", intro, "", `${cta}: ${link}`, "", t.thankYou, doc.business.name].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1f2128;max-width:520px">
<p>${esc(greeting)}</p><p>${esc(intro)}</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#176654;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">${esc(cta)}</a></p>
<p>${esc(t.thankYou)}<br>${esc(doc.business.name)}</p></div>`;
  return { subject, text, html };
}

/**
 * Sends a document (or a reminder) by email or text. On success the document becomes "sent";
 * every attempt, good or bad, is written to its history with the provider's real answer.
 */
export async function deliver(
  doc: Doc,
  channel: Channel,
  base: string,
  opts: { reminder?: boolean; today?: string } = {},
): Promise<DeliverResult> {
  if (doc.status === "void" || doc.status === "paid") return { ok: false, reason: "closed" };
  const today = opts.today ?? todayIso();
  const kind = `${opts.reminder ? "reminder" : "sent"}_${channel}`;
  let outcome;
  if (channel === "email") {
    if (!emailConfigured()) return { ok: false, reason: "setup" };
    if (!doc.customer.email) return { ok: false, reason: "no_recipient" };
    const content = emailContent(doc, base, { reminder: opts.reminder, today });
    const pdf = await renderPdf(doc, { logo: await getLogo(), today });
    outcome = await sendEmail({
      to: doc.customer.email,
      replyTo: doc.business.email,
      fromName: doc.business.name,
      ...content,
      attachment: { filename: `${doc.number}.pdf`, content: pdf },
    });
    if (outcome.ok) await recordEvent(doc.id, kind, doc.customer.email);
  } else {
    if (!smsConfigured()) return { ok: false, reason: "setup" };
    if (!doc.customer.phone) return { ok: false, reason: "no_recipient" };
    const body = smsBody(doc, base, { reminder: opts.reminder, dueCents: amountDueCents(doc, today) });
    outcome = await sendSms(doc.customer.phone, body);
    if (outcome.ok) await recordEvent(doc.id, kind, doc.customer.phone);
  }
  if (!outcome.ok) {
    await recordEvent(doc.id, `${kind}_failed`, outcome.detail);
    return { ok: false, reason: "failed" };
  }
  if (opts.reminder) await markReminded(doc.id);
  else await markSent(doc.id);
  return { ok: true };
}

/** The address printed in links: APP_URL, else Vercel's production address, else this request. */
export function appBase(requestUrl?: string): string {
  if (process.env.APP_URL) return process.env.APP_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return requestUrl ? new URL(requestUrl).origin : "http://localhost:3000";
}
