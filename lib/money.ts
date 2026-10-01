import type { Doc, LateFee, LineItem } from "./types";

/** Every amount is whole cents. Rounding happens once per line and once for tax. */
export const lineTotalCents = (item: Pick<LineItem, "quantity" | "unitPriceCents">): number =>
  Math.round(item.quantity * item.unitPriceCents);

export interface Totals {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

export function totals(items: LineItem[], taxRate: number): Totals {
  const subtotalCents = items.reduce((sum, i) => sum + lineTotalCents(i), 0);
  const taxCents = Math.round((subtotalCents * taxRate) / 100);
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

export function formatMoney(cents: number, lang: "es" | "en" = "en"): string {
  return new Intl.NumberFormat(lang === "es" ? "es-US" : "en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

/** "2,200.50" / "$2200" / "2200" → cents. Returns null for anything that isn't a plain amount. */
export function parseMoney(text: string): number | null {
  const cleaned = text.trim().replace(/[$\s]/g, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

const DAY = 86_400_000;

/** Calendar days from a to b (dates as YYYY-MM-DD, compared at UTC midnight). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/** At most a year of monthly late charges, so a forgotten invoice can't grow without limit. */
export const MAX_LATE_PERIODS = 12;

/**
 * The late charge owed on `today`. Nothing until the grace days after the due date have passed.
 * A flat fee is charged once. A percentage is charged on the invoice total for each started
 * 30-day period after the grace days (simple, not compounding).
 */
export function lateFeeCents(
  doc: Pick<Doc, "totalCents" | "dueDate" | "lateFee">,
  today: string,
): number {
  const fee: LateFee = doc.lateFee;
  if (fee.type === "none") return 0;
  const late = daysBetween(addDays(doc.dueDate, fee.graceDays), today);
  if (late <= 0) return 0;
  if (fee.type === "flat") return fee.amountCents;
  const periods = Math.min(MAX_LATE_PERIODS, Math.ceil(late / 30));
  return Math.round((doc.totalCents * fee.percent * periods) / 100);
}

export function amountDueCents(
  doc: Pick<Doc, "totalCents" | "dueDate" | "lateFee" | "status">,
  today: string,
): number {
  if (doc.status === "paid" || doc.status === "void") return 0;
  return doc.totalCents + lateFeeCents(doc, today);
}

export const todayIso = (): string => new Date().toISOString().slice(0, 10);
