// The numbers on the Facturas page: months for the charts, how late open invoices are, who owes
// the most, and how estimates are doing. Pure functions over documents; the queries are in store.
import { amountDueCents } from "./money";
import type { Doc } from "./types";

/** The last `n` months, oldest first, as "YYYY-MM", ending with today's month. */
export function monthKeys(today: string, n = 6): string[] {
  const [y, m] = today.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
}

export interface Bucket { count: number; cents: number }
export interface Aging { current: Bucket; d1_30: Bucket; d31_60: Bucket; d61: Bucket }

const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/** Open invoices by how late they are, with what's owed today (late fees included). */
export function aging(open: Doc[], today: string): Aging {
  const out: Aging = { current: { count: 0, cents: 0 }, d1_30: { count: 0, cents: 0 }, d31_60: { count: 0, cents: 0 }, d61: { count: 0, cents: 0 } };
  for (const d of open) {
    if (d.kind !== "invoice" || d.status !== "sent") continue;
    const late = days(d.dueDate, today);
    const b = late <= 0 ? out.current : late <= 30 ? out.d1_30 : late <= 60 ? out.d31_60 : out.d61;
    b.count++;
    b.cents += amountDueCents(d, today);
  }
  return out;
}

/** Who owes the most right now, by customer name, biggest first. */
export function topOwing(open: Doc[], today: string, n = 5): { name: string; cents: number; count: number }[] {
  const by = new Map<string, { name: string; cents: number; count: number }>();
  for (const d of open) {
    if (d.kind !== "invoice" || d.status !== "sent") continue;
    const key = d.customer.name.trim().toLowerCase();
    const row = by.get(key) ?? { name: d.customer.name.trim(), cents: 0, count: 0 };
    row.cents += amountDueCents(d, today);
    row.count++;
    by.set(key, row);
  }
  return [...by.values()].sort((a, b) => b.cents - a.cents).slice(0, n);
}

/** Share of decided estimates that were accepted (void = turned down); null when none decided. */
export function acceptanceRate(accepted: number, declined: number): number | null {
  const decided = accepted + declined;
  return decided ? Math.round((accepted / decided) * 100) : null;
}

/** Fills months the query didn't return with zeros, in the order of `keys`. */
export function byMonth<T extends { month: string }>(keys: string[], rows: T[], empty: Omit<T, "month">): T[] {
  return keys.map((month) => rows.find((r) => r.month === month) ?? ({ month, ...empty } as T));
}

export type Period = "month" | "30" | "90" | "year";
export const PERIODS: Period[] = ["month", "30", "90", "year"];
export const isPeriod = (v: unknown): v is Period => typeof v === "string" && (PERIODS as string[]).includes(v);

/** The days a period covers, as [from, to) "YYYY-MM-DD", ending tomorrow so today counts. */
export function periodRange(period: Period, today: string): { from: string; to: string } {
  const [y, m, d] = today.split("-").map(Number);
  const day = (dt: Date) => dt.toISOString().slice(0, 10);
  const to = day(new Date(Date.UTC(y, m - 1, d + 1)));
  if (period === "month") return { from: `${today.slice(0, 7)}-01`, to };
  if (period === "year") return { from: `${y}-01-01`, to };
  return { from: day(new Date(Date.UTC(y, m - 1, d - Number(period) + 1))), to };
}
