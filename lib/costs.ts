import type { Lang } from "./types";
import type { Milestone } from "./projects";

// The money side of a project: cost codes, the crew's burdened wages, the P&L (estimate against
// actual by code, income, margin so far and projected) and the daily / weekly / monthly rollups.
// Pure logic; every amount is whole cents, and nothing here is written by the model.

export const COST_CODES = ["labor", "materials", "subs", "other"] as const;
export type CostCode = (typeof COST_CODES)[number];
export const isCostCode = (v: unknown): v is CostCode => (COST_CODES as readonly string[]).includes(v as string);

export const codeLabel = (code: CostCode, lang: Lang): string =>
  ({ labor: ["Mano de obra", "Labor"], materials: ["Materiales", "Materials"], subs: ["Subcontratistas", "Subcontractors"], other: ["Permisos, equipo y otros", "Permits, equipment, other"] })[code][lang === "es" ? 0 : 1];

export const WORKER_ROLES = ["foreman", "journeyman", "laborer", "other"] as const;
export type WorkerRole = (typeof WORKER_ROLES)[number];
export const roleLabel = (role: WorkerRole, lang: Lang): string =>
  ({ foreman: ["Encargado", "Foreman"], journeyman: ["Oficial", "Journeyman"], laborer: ["Ayudante", "Laborer"], other: ["Otro", "Other"] })[role][lang === "es" ? 0 : 1];

export interface Worker {
  id: string;
  name: string;
  role: WorkerRole;
  hourlyCents: number;
  active: boolean;
}

/** The owner's burden on wages, in percent. Franklin's sheet: 9.58 + 2.5 + 14 ≈ 26%. */
export interface LaborBurden {
  workersComp: number;
  liability: number;
  payrollTax: number;
}
export const NO_BURDEN: LaborBurden = { workersComp: 0, liability: 0, payrollTax: 0 };
export const burdenPercent = (b: LaborBurden): number => b.workersComp + b.liability + b.payrollTax;
/** What an hour of this worker really costs, wage plus burden, in whole cents. */
export const burdenedHourlyCents = (w: Pick<Worker, "hourlyCents">, b: LaborBurden): number =>
  Math.round(w.hourlyCents * (1 + burdenPercent(b) / 100));
export const manDayCents = (w: Pick<Worker, "hourlyCents">, b: LaborBurden, hours = 8): number => burdenedHourlyCents(w, b) * hours;

export type CostSource = "typed" | "voice" | "receipt";

export interface Cost {
  id: string;
  code: CostCode;
  amountCents: number;
  description: string;
  vendor: string;
  spentOn: string;
  source: CostSource;
  receiptPhotoId: string | null;
  workerId: string | null;
  hours: number | null;
  createdAt: string;
}

export type Budgets = Record<CostCode, number>;
export const NO_BUDGETS: Budgets = { labor: 0, materials: 0, subs: 0, other: 0 };

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export interface CostInput {
  code: CostCode;
  amountCents: number;
  description: string;
  vendor: string;
  spentOn: string;
  source: CostSource;
  workerId: string | null;
  hours: number | null;
}

/** A cost as the owner confirms it. Amounts are whole cents the owner saw on screen. */
export function validateCost(raw: unknown, today: string): Result<CostInput> {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const errors: string[] = [];
  const code = isCostCode(r.code) ? r.code : null;
  if (!code) errors.push("code: Pick what kind of cost it is.");
  const amountCents = num(r.amountCents);
  if (!(Number.isInteger(amountCents) && amountCents >= 0 && amountCents <= 100_000_000_000)) errors.push("amountCents: The amount must be a whole number of cents.");
  const spentOn = typeof r.spentOn === "string" && DAY.test(r.spentOn) ? r.spentOn : today;
  const source: CostSource = r.source === "voice" ? "voice" : r.source === "receipt" ? "receipt" : "typed";
  const hours = r.hours == null || r.hours === "" ? null : num(r.hours);
  if (hours !== null && !(hours >= 0 && hours <= 1000)) errors.push("hours: Hours must be between 0 and 1000.");
  const workerId = typeof r.workerId === "string" && /^[0-9a-f-]{36}$/i.test(r.workerId) ? r.workerId : null;
  if (errors.length || !code) return { ok: false, errors };
  return { ok: true, value: { code, amountCents, description: str(r.description, 300), vendor: str(r.vendor, 120), spentOn, source, workerId, hours } };
}

export function validateWorker(raw: unknown): Result<Omit<Worker, "id">> {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const errors: string[] = [];
  const name = str(r.name, 80);
  if (!name) errors.push("name: The worker needs a name.");
  const role: WorkerRole = (WORKER_ROLES as readonly string[]).includes(String(r.role)) ? (r.role as WorkerRole) : "other";
  const hourlyCents = num(r.hourlyCents);
  if (!(Number.isInteger(hourlyCents) && hourlyCents >= 0 && hourlyCents <= 100_000)) errors.push("hourlyCents: The hourly wage must be between $0 and $1,000.");
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { name, role, hourlyCents, active: r.active !== false } };
}

export function validateBurden(raw: unknown): Result<LaborBurden> {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = { ...NO_BURDEN };
  const errors: string[] = [];
  for (const k of ["workersComp", "liability", "payrollTax"] as const) {
    const v = r[k] === undefined || r[k] === "" ? 0 : num(r[k]);
    if (!(v >= 0 && v <= 100)) errors.push(`${k}: A percent between 0 and 100.`);
    else out[k] = Math.round(v * 100) / 100;
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

export function validateBudgets(raw: unknown): Result<Budgets> {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = { ...NO_BUDGETS };
  const errors: string[] = [];
  for (const code of COST_CODES) {
    const v = r[code] === undefined || r[code] === "" ? 0 : num(r[code]);
    if (!(Number.isInteger(v) && v >= 0 && v <= 100_000_000_000)) errors.push(`${code}: A whole number of cents.`);
    else out[code] = v;
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

export interface PnlRow {
  code: CostCode;
  estimatedCents: number;
  spentCents: number;
  remainingCents: number;
  /** Spent as a share of the estimate: 112 means 12% over. Null with no estimate. */
  percentOfEstimate: number | null;
}

export interface Pnl {
  rows: PnlRow[];
  spentCents: number;
  budgetCents: number;
  income: { contractCents: number; paidCents: number; invoicedCents: number; remainingCents: number };
  margin: { estimatedCents: number; soFarCents: number; projectedCents: number; projectedPercent: number | null };
  /** The one thing to look at, or null when every code is at or under its estimate. */
  signal: { code: CostCode; overCents: number } | null;
}

/**
 * The project's P&L. Margin so far = paid − spent. Projected margin = contract − projected spend,
 * where projected spend scales what was spent by how much of the job is done (percentDone);
 * with nothing done yet it is the budget, and a code with no budget projects its own spend.
 */
export function projectPnl(opts: { contractCents: number; budgets: Budgets; costs: Pick<Cost, "code" | "amountCents">[]; milestones: Pick<Milestone, "amountCents" | "status">[]; percentDone: number }): Pnl {
  const rows: PnlRow[] = COST_CODES.map((code) => {
    const estimatedCents = opts.budgets[code];
    const spentCents = opts.costs.filter((c) => c.code === code).reduce((a, c) => a + c.amountCents, 0);
    return { code, estimatedCents, spentCents, remainingCents: estimatedCents - spentCents, percentOfEstimate: estimatedCents > 0 ? Math.round((spentCents / estimatedCents) * 100) : null };
  });
  const spentCents = rows.reduce((a, r) => a + r.spentCents, 0);
  const budgetCents = rows.reduce((a, r) => a + r.estimatedCents, 0);
  const paidCents = opts.milestones.filter((m) => m.status === "paid").reduce((a, m) => a + m.amountCents, 0);
  const invoicedCents = opts.milestones.filter((m) => m.status === "invoiced").reduce((a, m) => a + m.amountCents, 0);
  const contractCents = opts.contractCents;
  const done = Math.min(100, Math.max(0, opts.percentDone));
  const projectedSpend = done > 0 ? Math.max(spentCents, Math.round((spentCents * 100) / done)) : Math.max(budgetCents, spentCents);
  const projectedCents = contractCents - projectedSpend;
  const over = rows.filter((r) => r.estimatedCents > 0 && r.spentCents > r.estimatedCents).sort((a, b) => b.spentCents - b.estimatedCents - (a.spentCents - a.estimatedCents));
  return {
    rows,
    spentCents,
    budgetCents,
    income: { contractCents, paidCents, invoicedCents, remainingCents: contractCents - paidCents - invoicedCents },
    margin: {
      estimatedCents: contractCents - budgetCents,
      soFarCents: paidCents - spentCents,
      projectedCents,
      projectedPercent: contractCents > 0 ? Math.round((projectedCents / contractCents) * 100) : null,
    },
    signal: over.length ? { code: over[0].code, overCents: over[0].spentCents - over[0].estimatedCents } : null,
  };
}

export type Period = "day" | "week" | "month";
export const PERIODS: Period[] = ["day", "week", "month"];
export const isPeriod = (v: unknown): v is Period => v === "day" || v === "week" || v === "month";

/** The bucket a date falls in: the day, the Monday of its week, or the month. */
export function periodKey(day: string, period: Period): string {
  if (period === "day") return day;
  if (period === "month") return day.slice(0, 7);
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export function periodLabel(key: string, period: Period, lang: Lang): string {
  const locale = lang === "es" ? "es-US" : "en-US";
  if (period === "month") return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}-01T00:00:00Z`));
  const d = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${key}T00:00:00Z`));
  return period === "week" ? (lang === "es" ? `Semana del ${d}` : `Week of ${d}`) : d;
}

export interface RollupRow {
  key: string;
  spent: Record<CostCode, number>;
  spentCents: number;
  receivedCents: number;
}

/** Spend by code and money received, per day, week or month, newest first. */
export function rollup(costs: Pick<Cost, "code" | "amountCents" | "spentOn">[], payments: { day: string; amountCents: number }[], period: Period): RollupRow[] {
  const map = new Map<string, RollupRow>();
  const row = (key: string) => {
    let r = map.get(key);
    if (!r) {
      r = { key, spent: { ...NO_BUDGETS }, spentCents: 0, receivedCents: 0 };
      map.set(key, r);
    }
    return r;
  };
  for (const c of costs) {
    const r = row(periodKey(c.spentOn, period));
    r.spent[c.code] += c.amountCents;
    r.spentCents += c.amountCents;
  }
  for (const p of payments) row(periodKey(p.day, period)).receivedCents += p.amountCents;
  return [...map.values()].sort((a, b) => (a.key < b.key ? 1 : -1));
}

/** Plain-language signal line for the owner, from the P&L. Null when nothing is over. */
export function signalText(pnl: Pnl, lang: Lang, money: (c: number) => string): string | null {
  if (!pnl.signal) return null;
  const label = codeLabel(pnl.signal.code, lang).toLowerCase();
  return lang === "es"
    ? `${label.charAt(0).toUpperCase() + label.slice(1)} va ${money(pnl.signal.overCents)} por encima de lo estimado.`
    : `${label.charAt(0).toUpperCase() + label.slice(1)} is ${money(pnl.signal.overCents)} over the estimate.`;
}
