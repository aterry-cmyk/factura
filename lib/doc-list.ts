// The owner's list of every invoice and estimate: filters from the address bar, the CSV for his
// accountant, and which bulk actions apply to which documents. No database here, so it's all testable.
import { amountDueCents, lateFeeCents } from "./money";
import type { Doc, DocKind, DocStatus, Lang } from "./types";

export type StatusFilter = "all" | "draft" | "sent" | "overdue" | "paid" | "void" | "accepted";
export const STATUS_FILTERS: StatusFilter[] = ["all", "draft", "sent", "overdue", "paid", "void", "accepted"];

export interface DocFilters {
  q: string;
  status: StatusFilter;
  kind: "all" | DocKind;
  from: string | null;
  to: string | null;
  page: number;
}

export const PAGE_SIZE = 50;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] ?? "" : v ?? "");

/** Whatever is in the address bar becomes a safe set of filters; anything unknown is ignored. */
export function parseFilters(params: Record<string, string | string[] | undefined>): DocFilters {
  const status = one(params.status) as StatusFilter;
  const kind = one(params.kind);
  const from = one(params.from);
  const to = one(params.to);
  const page = Number.parseInt(one(params.page), 10);
  return {
    q: one(params.q).trim().slice(0, 100),
    status: STATUS_FILTERS.includes(status) ? status : "all",
    kind: kind === "invoice" || kind === "estimate" ? kind : "all",
    from: DATE.test(from) ? from : null,
    to: DATE.test(to) ? to : null,
    page: Number.isFinite(page) && page > 1 ? Math.min(page, 1000) : 1,
  };
}

/** The same filters back into an address, leaving out defaults so links stay short. */
export function filtersQuery(f: DocFilters, change: Partial<DocFilters> = {}): string {
  const next = { ...f, page: 1, ...change };
  const p = new URLSearchParams();
  if (next.q) p.set("q", next.q);
  if (next.status !== "all") p.set("status", next.status);
  if (next.kind !== "all") p.set("kind", next.kind);
  if (next.from) p.set("from", next.from);
  if (next.to) p.set("to", next.to);
  if (next.page > 1) p.set("page", String(next.page));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const isOverdue = (d: Pick<Doc, "kind" | "status" | "dueDate">, today: string): boolean =>
  d.kind === "invoice" && d.status === "sent" && d.dueDate < today;

// ---------- CSV ----------

/** A cell a spreadsheet can't mistake for a formula: =, +, -, @ at the start are quoted away. */
export function csvCell(value: string | number): string {
  let v = String(value);
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\n\r;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

const money = (cents: number) => (cents / 100).toFixed(2);

const HEADERS: Record<Lang, string[]> = {
  es: ["Número", "Tipo", "Estado", "Cliente", "Empresa", "Correo", "Teléfono", "Fecha", "Vence", "Conceptos", "Subtotal", "Impuesto", "Total", "Recargo hoy", "Saldo hoy", "Pagada el"],
  en: ["Number", "Type", "Status", "Customer", "Company", "Email", "Phone", "Date", "Due", "Items", "Subtotal", "Tax", "Total", "Late fee today", "Balance today", "Paid on"],
};

/** The list as a spreadsheet: one row per document, money as plain numbers, UTF-8 with a BOM for Excel. */
export function documentsCsv(docs: Doc[], lang: Lang, today: string, statusName: (d: Doc) => string): string {
  const rows = docs.map((d) => [
    d.number,
    d.kind === "invoice" ? (lang === "es" ? "Factura" : "Invoice") : lang === "es" ? "Presupuesto" : "Estimate",
    statusName(d),
    d.customer.name,
    d.customer.company,
    d.customer.email,
    d.customer.phone,
    d.issueDate,
    d.dueDate,
    d.items.map((i) => `${i.quantity} × ${i.description} ($${money(i.unitPriceCents)})`).join(" | "),
    money(d.subtotalCents),
    money(d.taxCents),
    money(d.totalCents),
    money(d.kind === "invoice" && d.status === "sent" ? lateFeeCents(d, today) : 0),
    money(d.kind === "invoice" ? amountDueCents(d, today) : 0),
    d.paidAt ? d.paidAt.slice(0, 10) : "",
  ]);
  return "﻿" + [HEADERS[lang], ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

// ---------- status changes, one at a time or in bulk ----------

/** Which status changes make sense from where. Paid can be undone (a bounced check); void can't. */
export const ALLOWED: Record<DocStatus, { invoice: DocStatus[]; estimate: DocStatus[] }> = {
  draft: { invoice: ["sent", "paid", "void"], estimate: ["sent", "accepted", "void"] },
  sent: { invoice: ["paid", "void"], estimate: ["accepted", "void"] },
  paid: { invoice: ["sent"], estimate: [] },
  accepted: { invoice: [], estimate: ["sent", "void"] },
  void: { invoice: [], estimate: [] },
};

export const canMove = (d: Pick<Doc, "kind" | "status">, next: DocStatus): boolean =>
  ALLOWED[d.status]?.[d.kind].includes(next) ?? false;

export type BulkAction = "paid" | "void" | "remind";
export const BULK_ACTIONS: BulkAction[] = ["paid", "void", "remind"];
export const MAX_BULK = 100;

export type SkipReason = "not_invoice" | "already" | "closed" | "not_sent";

/** Which of the chosen documents the action applies to, and why the others are left alone. */
export function bulkPlan(docs: Pick<Doc, "id" | "kind" | "status">[], action: BulkAction): { apply: string[]; skip: { id: string; reason: SkipReason }[] } {
  const apply: string[] = [];
  const skip: { id: string; reason: SkipReason }[] = [];
  for (const d of docs) {
    if (action === "remind") {
      if (d.kind !== "invoice") skip.push({ id: d.id, reason: "not_invoice" });
      else if (d.status !== "sent") skip.push({ id: d.id, reason: d.status === "draft" ? "not_sent" : "closed" });
      else apply.push(d.id);
      continue;
    }
    if (action === "paid" && d.kind !== "invoice") skip.push({ id: d.id, reason: "not_invoice" });
    else if (d.status === action) skip.push({ id: d.id, reason: "already" });
    else if (!canMove(d, action)) skip.push({ id: d.id, reason: "closed" });
    else apply.push(d.id);
  }
  return { apply, skip };
}
