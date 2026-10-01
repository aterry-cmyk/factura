import { dict } from "./i18n";
import { formatMoney } from "./money";
import type { Doc } from "./types";
import { displayPhone } from "./validate";

/** The wording shared by the PDF, the customer's page, the email and the text message. */

export const docTitle = (doc: Pick<Doc, "kind" | "lang">): string => {
  const t = dict(doc.lang);
  return doc.kind === "invoice" ? t.invoice : t.estimate;
};

export function paymentLines(doc: Pick<Doc, "paymentMethods" | "lang">): string[] {
  const t = dict(doc.lang);
  const p = doc.paymentMethods;
  const lines: string[] = [];
  if (p.zelle?.enabled) lines.push(`${t.payZelle}: ${p.zelle.handle}`);
  if (p.check?.enabled) lines.push(`${t.payCheck} — ${t.payableTo.toLowerCase()}: ${p.check.payableTo}`);
  if (p.bank?.enabled) lines.push(`${t.payBank}: ${p.bank.details}`);
  if (p.card?.enabled) lines.push(`${t.payCard}: ${p.card.link}`);
  if (p.cash?.enabled) lines.push(t.payCash);
  if (p.other?.enabled) lines.push(p.other.text);
  return lines;
}

export function lateFeeTerms(doc: Pick<Doc, "lateFee" | "lang" | "kind">): string {
  const t = dict(doc.lang);
  const f = doc.lateFee;
  if (doc.kind !== "invoice" || f.type === "none") return "";
  if (f.type === "flat") return t.lateFeeLine(formatMoney(f.amountCents, doc.lang), f.graceDays);
  return t.lateFeePercentLine(String(f.percent), f.graceDays);
}

export function businessLines(doc: Pick<Doc, "business">): string[] {
  const b = doc.business;
  return [b.address, b.phone ? displayPhone(b.phone) : "", b.email, b.website].filter(Boolean);
}

export function formatDate(iso: string, lang: Doc["lang"]): string {
  return new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}

export function publicUrl(doc: Pick<Doc, "publicToken">, base: string): string {
  return `${base.replace(/\/$/, "")}/i/${doc.publicToken}`;
}

/** The text message: short, one link. */
export function smsBody(doc: Doc, base: string, opts: { reminder?: boolean; dueCents?: number } = {}): string {
  const es = doc.lang === "es";
  const amount = formatMoney(opts.dueCents ?? doc.totalCents, doc.lang);
  const from = doc.business.name;
  const link = publicUrl(doc, base);
  if (opts.reminder)
    return es
      ? `${from}: recordatorio, la factura ${doc.number} por ${amount} está pendiente. ${link}`
      : `${from}: reminder, invoice ${doc.number} for ${amount} is unpaid. ${link}`;
  if (doc.kind === "estimate")
    return es ? `${from} le envió el presupuesto ${doc.number} por ${amount}: ${link}` : `${from} sent you estimate ${doc.number} for ${amount}: ${link}`;
  return es
    ? `${from} le envió la factura ${doc.number} por ${amount}, vence el ${formatDate(doc.dueDate, "es")}: ${link}`
    : `${from} sent you invoice ${doc.number} for ${amount}, due ${formatDate(doc.dueDate, "en")}: ${link}`;
}
