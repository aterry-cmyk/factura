import type { Lang, LineItem } from "./types";

// The proposal Loro builds with the owner: sections of priced lines, the owner's markup and
// contingency, and the estimate it becomes. Pure logic; every amount is whole cents and every
// price has a source the owner can see.

/** Where a line's unit cost came from. "history": the owner's own past price or receipt, used exactly.
 * "price": looked up (1build or a web page), with the source. "suggested": Loro's guess, to confirm.
 * "typed": the owner typed it. "none": not priced yet. */
export type CostSource = "history" | "price" | "suggested" | "typed" | "none";
export const UNITS = ["EA", "SF", "LF", "SY", "CY", "HR", "DAY", "LS"] as const;
export type Unit = (typeof UNITS)[number];

export interface ProposalLine {
  key: string;
  description: string;
  quantity: number;
  unit: Unit;
  unitCostCents: number;
  source: CostSource;
  /** Why this cost: the catalog match, the page or county it came from, or the reasoning. */
  basis: string;
  /** The owner has looked at this line and accepts it as priced. */
  confirmed: boolean;
  /** The quantity was given by the owner (in the description or the answers); otherwise it is Loro's reading. */
  quantityGiven: boolean;
}

export interface ProposalSection {
  title: string;
  lines: ProposalLine[];
}

export interface Proposal {
  summary: string;
  sections: ProposalSection[];
  markupPercent: number;
  contingencyPercent: number;
  /** The questions Loro asked and what the owner answered, kept so the scope can be explained. */
  answers: { question: string; answer: string }[];
  updatedAt: string;
}

export const MAX_SECTIONS = 12;
export const MAX_LINES = 80;
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN);
export const isUnit = (v: unknown): v is Unit => (UNITS as readonly string[]).includes(v as string);
export const lineTotalCents = (l: Pick<ProposalLine, "quantity" | "unitCostCents">): number => Math.round(l.quantity * l.unitCostCents);

export interface ProposalTotals {
  costCents: number;
  markupCents: number;
  contingencyCents: number;
  totalCents: number;
  unpriced: number;
  unconfirmed: number;
}

/** Cost, markup on the cost, contingency on cost plus markup, and what still needs the owner. */
export function proposalTotals(p: Pick<Proposal, "sections" | "markupPercent" | "contingencyPercent">): ProposalTotals {
  const lines = p.sections.flatMap((s) => s.lines);
  const costCents = lines.reduce((a, l) => a + lineTotalCents(l), 0);
  const markupCents = Math.round((costCents * p.markupPercent) / 100);
  const contingencyCents = Math.round(((costCents + markupCents) * p.contingencyPercent) / 100);
  return {
    costCents, markupCents, contingencyCents, totalCents: costCents + markupCents + contingencyCents,
    unpriced: lines.filter((l) => l.source === "none" || l.unitCostCents <= 0).length,
    unconfirmed: lines.filter((l) => !l.confirmed).length,
  };
}

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/** The proposal as the owner's screen sends it back: every line checked, nothing invented on the way. */
export function validateProposal(raw: unknown, now: string): Result<Proposal> {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const errors: string[] = [];
  const sectionsRaw = Array.isArray(r.sections) ? r.sections : [];
  if (sectionsRaw.length > MAX_SECTIONS) errors.push(`sections: ${MAX_SECTIONS} sections at most.`);
  let count = 0;
  const sections: ProposalSection[] = sectionsRaw.slice(0, MAX_SECTIONS).map((sv, si) => {
    const s = sv && typeof sv === "object" ? (sv as Record<string, unknown>) : {};
    const title = str(s.title, 120);
    if (!title) errors.push(`sections.${si}: Every section needs a title.`);
    const lines = (Array.isArray(s.lines) ? s.lines : []).map((lv, li) => {
      count++;
      const l = lv && typeof lv === "object" ? (lv as Record<string, unknown>) : {};
      const description = str(l.description, 200);
      if (!description) errors.push(`sections.${si}.lines.${li}: Every line needs a description.`);
      const quantity = num(l.quantity);
      if (!(quantity > 0 && quantity <= 1_000_000)) errors.push(`sections.${si}.lines.${li}: Quantity must be more than 0.`);
      const unitCostCents = l.unitCostCents === "" || l.unitCostCents == null ? 0 : num(l.unitCostCents);
      if (!(Number.isInteger(unitCostCents) && unitCostCents >= 0 && unitCostCents <= 100_000_000)) errors.push(`sections.${si}.lines.${li}: The unit cost must be a whole number of cents.`);
      const source: CostSource = ["history", "price", "suggested", "typed", "none"].includes(String(l.source)) ? (l.source as CostSource) : unitCostCents > 0 ? "typed" : "none";
      return {
        key: str(l.key, 40) || `${si}-${li}`, description, quantity: Math.round(quantity * 100) / 100, unit: isUnit(l.unit) ? l.unit : "EA",
        unitCostCents, source: unitCostCents > 0 ? source : "none", basis: str(l.basis, 300), confirmed: l.confirmed === true && unitCostCents > 0, quantityGiven: l.quantityGiven === true,
      };
    });
    return { title, lines };
  });
  if (count > MAX_LINES) errors.push(`lines: ${MAX_LINES} lines at most.`);
  const markupPercent = r.markupPercent == null || r.markupPercent === "" ? 0 : num(r.markupPercent);
  if (!(markupPercent >= 0 && markupPercent <= 300)) errors.push("markupPercent: Between 0 and 300.");
  const contingencyPercent = r.contingencyPercent == null || r.contingencyPercent === "" ? 0 : num(r.contingencyPercent);
  if (!(contingencyPercent >= 0 && contingencyPercent <= 100)) errors.push("contingencyPercent: Between 0 and 100.");
  const answers = (Array.isArray(r.answers) ? r.answers : []).slice(0, 12).map((a) => {
    const x = a && typeof a === "object" ? (a as Record<string, unknown>) : {};
    return { question: str(x.question, 200), answer: str(x.answer, 300) };
  }).filter((a) => a.question && a.answer);
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { summary: str(r.summary, 600), sections, markupPercent: Math.round(markupPercent * 100) / 100, contingencyPercent: Math.round(contingencyPercent * 100) / 100, answers, updatedAt: now } };
}

/** Why a proposal can't become an estimate yet, in the owner's language; empty when it can. */
export function proposalProblems(p: Proposal, lang: Lang): string[] {
  const t = proposalTotals(p);
  const es = lang === "es";
  const out: string[] = [];
  if (!p.sections.some((s) => s.lines.length)) out.push(es ? "La propuesta no tiene líneas." : "The proposal has no lines.");
  if (t.unpriced) out.push(es ? `${t.unpriced} línea(s) sin precio.` : `${t.unpriced} line(s) without a price.`);
  if (t.unconfirmed) out.push(es ? `${t.unconfirmed} línea(s) sin confirmar.` : `${t.unconfirmed} line(s) not confirmed.`);
  return out;
}

export const unitLabel = (u: Unit, lang: Lang): string =>
  ({ EA: ["c/u", "ea"], SF: ["pie²", "sq ft"], LF: ["pie lineal", "lin ft"], SY: ["yd²", "sq yd"], CY: ["yd³", "cu yd"], HR: ["hora", "hr"], DAY: ["día", "day"], LS: ["global", "lump sum"] })[u][lang === "es" ? 0 : 1];

/**
 * The estimate's lines: each proposal line with the markup folded into its price (so the customer
 * sees prices, not costs), one contingency line when the owner set one. All "typed": the owner
 * confirmed every one of them on the proposal screen.
 */
export function proposalItems(p: Proposal, lang: Lang): LineItem[] {
  const factor = 1 + p.markupPercent / 100;
  const items: LineItem[] = p.sections.flatMap((s) => s.lines.map((l) => ({
    description: `${s.title}: ${l.description}${l.quantity !== 1 || l.unit !== "EA" ? ` (${l.quantity} ${unitLabel(l.unit, lang)})` : ""}`.slice(0, 200),
    quantity: 1,
    unitPriceCents: Math.round(lineTotalCents(l) * factor),
    source: "typed" as const,
  })));
  const t = proposalTotals(p);
  if (t.contingencyCents > 0) items.push({ description: lang === "es" ? `Contingencia (${p.contingencyPercent}%)` : `Contingency (${p.contingencyPercent}%)`, quantity: 1, unitPriceCents: t.contingencyCents, source: "typed" });
  return items;
}

/** The scope of work as text for the estimate's notes and the customer: sections and what's in them. */
export function scopeText(p: Proposal, lang: Lang): string {
  const head = lang === "es" ? "Alcance del trabajo" : "Scope of work";
  const body = p.sections.map((s) => `${s.title}: ${s.lines.map((l) => l.description).join("; ")}`).join("\n");
  return `${head}\n${p.summary ? `${p.summary}\n` : ""}${body}`.slice(0, 1000);
}
