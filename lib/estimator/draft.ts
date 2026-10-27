// The estimator's answers → the lines of a Loro estimate. Every line is a *suggested* price (the
// middle of the price book's range, rounded to $50), with the range as its reason, so the owner
// confirms or changes each one before the estimate can be saved, like any other suggestion.
import { formatMoney } from "@/lib/money";
import type { Lang, LineItem } from "@/lib/types";
import { TRADES, priceTrade, weeksFor, weeksText, type Answers, type Home, type PricedTrade, type Range } from "./pricebook";

export interface EstimatorProduct { category: string; name: string; details: string; url: string }

const cents = (dollars: number) => Math.round(dollars * 100);
const mid = ([lo, hi]: Range) => Math.round((lo + hi) / 2 / 50) * 50;

export function rangeText(r: Range, lang: Lang): string {
  const m = (d: number) => formatMoney(cents(d), lang).replace(/[.,]00(?=\D*$)/, "");
  return `${m(r[0])}–${m(r[1])}`;
}

export function pricedAll(trades: string[], answers: Record<string, Answers>, home: Home, state: string): PricedTrade[] {
  return trades.filter((t) => TRADES[t]).map((t) => priceTrade(t, answers[t] ?? {}, home, state));
}

export function totalRange(priced: PricedTrade[]): Range {
  return priced.reduce<Range>((s, p) => [s[0] + p.total[0], s[1] + p.total[1]], [0, 0]);
}

export function draftItems(priced: PricedTrade[], lang: Lang): (LineItem & { needsConfirm: true })[] {
  const basis = (r: Range) => (lang === "es" ? `Rango típico ${rangeText(r, lang)} (estimador)` : `Typical range ${rangeText(r, lang)} (estimator)`);
  return priced.flatMap((p) => p.lines.map((line) => ({
    description: `${TRADES[p.id].label[lang]}: ${line.label[lang]}${line.note ? ` (${line.note[lang]})` : ""}`.slice(0, 200),
    quantity: 1,
    unitPriceCents: cents(Math.max(50, mid(line.range))),
    source: "suggested" as const,
    basis: basis(line.range),
    needsConfirm: true as const,
  })));
}

/** Notes for the estimate: time on site, products to look at, and the walkthrough caution. */
export function draftNotes(trades: string[], lang: Lang, products: EstimatorProduct[], siteNotes: string[]): string {
  const es = lang === "es";
  const parts = [
    `${es ? "Tiempo de trabajo estimado" : "Estimated time on site"}: ${weeksText(weeksFor(trades), lang)}.`,
    es ? "Precio final después de la visita y las medidas." : "Final price after the walkthrough and measurements.",
  ];
  if (products.length) parts.push(`${es ? "Productos de referencia (Home Depot)" : "Reference products (Home Depot)"}: ${products.map((p) => `${p.name}${p.details ? ` (${p.details})` : ""}`).join("; ")}.`);
  if (siteNotes.length) parts.push(`${es ? "Confirmar en la visita" : "To confirm on site"}: ${siteNotes.join(" ")}`);
  return parts.join("\n").slice(0, 1000); // the estimate's notes hold 1,000 characters
}
