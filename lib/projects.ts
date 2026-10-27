import type { Customer, Lang } from "./types";

// Projects: the job between the estimate and the invoices. Pure logic only (no database): how a
// total is split into milestone amounts, what "percent done" means, the checks on what the owner
// or the model proposes, and the words the customer reads. Every amount is whole cents.

export type MilestoneStatus = "pending" | "invoiced" | "paid";
export type ProjectStatus = "active" | "done" | "cancelled";
export type PlanSource = "ai" | "template" | "owner";

export interface Milestone {
  id: string;
  position: number;
  name: string;
  amountCents: number;
  status: MilestoneStatus;
  invoiceId: string | null;
  /** The invoice's public token, when the milestone has been invoiced: the customer's Pagar link. */
  invoiceToken: string | null;
  invoiceNumber: string;
  doneAt: string | null;
  days: number | null;
  startsOn: string | null;
  endsOn: string | null;
}

export interface ChecklistItem {
  id: string;
  milestoneId: string | null;
  position: number;
  text: string;
  doneAt: string | null;
  note: string;
  photoIds: string[];
}

export interface Project {
  id: string;
  accountId: string;
  customerId: string | null;
  customer: Customer;
  name: string;
  description: string;
  status: ProjectStatus;
  totalCents: number;
  lang: Lang;
  estimateId: string | null;
  publicToken: string;
  planSource: PlanSource;
  startsOn: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A milestone as the owner (or the planner) proposes it, before amounts are fixed. */
export interface PlanMilestone {
  name: string;
  sharePercent: number;
  steps: string[];
  /** Calendar days the stage usually takes; the schedule lays milestones end to end from it. */
  days?: number;
}

export const MAX_MILESTONES = 8;
export const MIN_MILESTONES = 2;
export const MAX_STEPS_PER_MILESTONE = 15;
export const MAX_PROJECT_CENTS = 100_000_000_000; // $1,000,000,000
export const MAX_PHOTO_BYTES = 2_500_000;

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN);

/**
 * Splits a total into whole-cent amounts by percentage. Rounding goes to the last milestone, so
 * the amounts always add up to the total exactly: a customer is never asked for a cent more or less
 * than the contract.
 */
export function splitAmounts(totalCents: number, shares: number[]): number[] {
  if (!shares.length) return [];
  const out = shares.map((p) => Math.round((totalCents * p) / 100));
  const sum = out.reduce((a, b) => a + b, 0);
  out[out.length - 1] += totalCents - sum;
  return out;
}

/**
 * Percent done, weighted by money: each milestone counts for its share of the total, and inside a
 * milestone each step counts equally. A milestone with no steps counts when it is paid or marked done.
 */
export function percentDone(
  milestones: Pick<Milestone, "id" | "amountCents" | "status" | "doneAt">[],
  items: Pick<ChecklistItem, "milestoneId" | "doneAt">[],
): number {
  const total = milestones.reduce((a, m) => a + m.amountCents, 0);
  if (!milestones.length) return 0;
  let done = 0;
  for (const m of milestones) {
    const weight = total > 0 ? m.amountCents / total : 1 / milestones.length;
    const steps = items.filter((i) => i.milestoneId === m.id);
    const fraction = steps.length ? steps.filter((i) => i.doneAt).length / steps.length : m.doneAt || m.status === "paid" ? 1 : 0;
    done += weight * fraction;
  }
  return Math.round(Math.min(1, Math.max(0, done)) * 100);
}

/** The money side at a glance: paid, invoiced and not yet paid, and still to invoice. */
export function moneySummary(milestones: Pick<Milestone, "amountCents" | "status">[]): { paid: number; invoiced: number; remaining: number; total: number } {
  const total = milestones.reduce((a, m) => a + m.amountCents, 0);
  const paid = milestones.filter((m) => m.status === "paid").reduce((a, m) => a + m.amountCents, 0);
  const invoiced = milestones.filter((m) => m.status === "invoiced").reduce((a, m) => a + m.amountCents, 0);
  return { paid, invoiced, remaining: total - paid - invoiced, total };
}

/** The milestone the work is on: the first one not paid, in order. */
export function currentMilestone<M extends Pick<Milestone, "status" | "position">>(milestones: M[]): M | null {
  return [...milestones].sort((a, b) => a.position - b.position).find((m) => m.status !== "paid") ?? null;
}

/** A milestone can be invoiced once, when every one of its steps is done (or it has none). */
export function canInvoice(m: Pick<Milestone, "status">, steps: Pick<ChecklistItem, "doneAt">[]): boolean {
  return m.status === "pending" && steps.every((s) => Boolean(s.doneAt));
}

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/**
 * Checks a proposed plan, from the owner's form or the model: 2 to 8 milestones with names, shares
 * that add up to 100 (small rounding is absorbed by the last one), and up to 15 named steps each.
 */
export function validatePlan(raw: unknown): Result<PlanMilestone[]> {
  const errors: string[] = [];
  const list = Array.isArray(raw) ? raw : [];
  if (list.length < MIN_MILESTONES) errors.push(`milestones: At least ${MIN_MILESTONES} milestones.`);
  if (list.length > MAX_MILESTONES) errors.push(`milestones: ${MAX_MILESTONES} milestones at most.`);
  const value: PlanMilestone[] = list.slice(0, MAX_MILESTONES).map((v, i) => {
    const r = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
    const name = str(r.name, 160);
    if (!name) errors.push(`milestones.${i}: Every milestone needs a name.`);
    const share = num(r.sharePercent ?? r.share_percent);
    if (!(share >= 0 && share <= 100)) errors.push(`milestones.${i}: The share must be between 0 and 100.`);
    const stepsRaw = Array.isArray(r.steps) ? r.steps : [];
    if (stepsRaw.length > MAX_STEPS_PER_MILESTONE) errors.push(`milestones.${i}: ${MAX_STEPS_PER_MILESTONE} steps at most.`);
    const steps = stepsRaw.slice(0, MAX_STEPS_PER_MILESTONE).map((s) => str(s, 200)).filter(Boolean);
    const days = num(r.days);
    return { name, sharePercent: Number.isFinite(share) ? Math.round(share * 100) / 100 : 0, steps, ...(Number.isInteger(days) && days >= 1 && days <= 365 ? { days } : {}) };
  });
  const sum = value.reduce((a, m) => a + m.sharePercent, 0);
  if (value.length && Math.abs(sum - 100) > 1) errors.push(`milestones: The shares add up to ${Math.round(sum)}%, not 100%.`);
  else if (value.length) value[value.length - 1].sharePercent = Math.round((value[value.length - 1].sharePercent + (100 - sum)) * 100) / 100;
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

export interface ProjectInput {
  name: string;
  description: string;
  customer: Customer;
  totalCents: number;
  lang: Lang;
  estimateId: string | null;
  plan: PlanMilestone[];
  planSource: PlanSource;
}

/** The owner's project as it comes from the browser. The customer is checked like a document's. */
export function validateProjectInput(raw: unknown, checkCustomer: (c: unknown, errors: string[]) => Customer): Result<ProjectInput> {
  const errors: string[] = [];
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const name = str(r.name, 160);
  if (!name) errors.push("name: The project needs a name.");
  const totalCents = num(r.totalCents);
  if (!(Number.isInteger(totalCents) && totalCents >= 0 && totalCents <= MAX_PROJECT_CENTS)) errors.push("totalCents: The total must be a whole number of cents.");
  const customer = checkCustomer(r.customer, errors);
  const plan = validatePlan(r.plan);
  if (!plan.ok) errors.push(...plan.errors);
  const estimateId = typeof r.estimateId === "string" && /^[0-9a-f-]{36}$/i.test(r.estimateId) ? r.estimateId : null;
  const planSource: PlanSource = r.planSource === "ai" ? "ai" : r.planSource === "owner" ? "owner" : "template";
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name, description: str(r.description, 4000), customer, totalCents, lang: r.lang === "en" ? "en" : "es",
      estimateId, plan: (plan as { ok: true; value: PlanMilestone[] }).value, planSource,
    },
  };
}

/**
 * The plan a project starts from when the planner isn't available: a deposit and four stages, the
 * way most contracts are paid. Labelled as a template so the owner knows nobody tailored it.
 */
export function templatePlan(lang: Lang): PlanMilestone[] {
  const es = lang === "es";
  return [
    { name: es ? "Anticipo" : "Deposit", sharePercent: 10, days: 1, steps: [es ? "Estimado aceptado y fecha de inicio acordada" : "Estimate accepted and start date agreed"] },
    { name: es ? "Inicio y preparación" : "Start and preparation", sharePercent: 20, days: 3, steps: [es ? "Proteger el área de trabajo" : "Protect the work area", es ? "Materiales en sitio" : "Materials on site", es ? "Demolición o preparación terminada" : "Demolition or preparation done"] },
    { name: es ? "Trabajo principal" : "Main work", sharePercent: 40, days: 10, steps: [es ? "Primera mitad del trabajo terminada" : "First half of the work done", es ? "Segunda mitad del trabajo terminada" : "Second half of the work done"] },
    { name: es ? "Acabados" : "Finishes", sharePercent: 20, days: 4, steps: [es ? "Acabados y detalles" : "Finishes and details", es ? "Limpieza final" : "Final clean-up"] },
    { name: es ? "Entrega final" : "Final walkthrough", sharePercent: 10, days: 1, steps: [es ? "Recorrido final con el cliente" : "Final walkthrough with the customer"] },
  ];
}

/**
 * The update the customer gets, written from the numbers (never by the model): what was finished,
 * how far along the job is, and what the next payment is. Short enough for a text message.
 */
export function progressMessage(p: {
  lang: Lang; businessName: string; customerName: string; projectName: string; percent: number;
  justDone: string[]; current: Pick<Milestone, "name"> | null; nextPayment: { name: string; amountText: string; link: string } | null; link: string;
}): string {
  const es = p.lang === "es";
  const first = p.customerName.split(" ")[0];
  const lines: string[] = [];
  lines.push(es ? `Hola ${first}, le escribe ${p.businessName} sobre "${p.projectName}".` : `Hi ${first}, this is ${p.businessName} about "${p.projectName}".`);
  if (p.justDone.length) lines.push((es ? "Terminado hoy: " : "Finished today: ") + p.justDone.join(", ") + ".");
  lines.push(es ? `El proyecto va al ${p.percent}%.` : `The project is ${p.percent}% done.`);
  if (p.current) lines.push(es ? `Ahora estamos en: ${p.current.name}.` : `We are now on: ${p.current.name}.`);
  if (p.nextPayment) lines.push(es ? `Siguiente pago: ${p.nextPayment.name}, ${p.nextPayment.amountText}: ${p.nextPayment.link}` : `Next payment: ${p.nextPayment.name}, ${p.nextPayment.amountText}: ${p.nextPayment.link}`);
  lines.push(es ? `Fotos y avance: ${p.link}` : `Photos and progress: ${p.link}`);
  return lines.join("\n");
}

export const projectUrl = (p: Pick<Project, "publicToken">, base: string): string => `${base.replace(/\/$/, "")}/p/${p.publicToken}`;

/** The invoice line for a milestone, the way it reads on the customer's invoice. */
export const milestoneLine = (projectName: string, m: Pick<Milestone, "name" | "position">, lang: Lang): string =>
  lang === "es" ? `${projectName} — hito ${m.position + 1}: ${m.name}` : `${projectName} — milestone ${m.position + 1}: ${m.name}`;
