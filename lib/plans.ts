import type { Lang } from "./types";

// What each plan allows per calendar month (UTC). Card billing isn't connected: an admin sets the
// plan, the trial's end and the monthly fee in /admin, and the app enforces the limits here.

export type PlanId = "trial" | "pro" | "comped";
export type AccountStatus = "active" | "suspended";
export const PLAN_IDS: PlanId[] = ["trial", "pro", "comped"];

export interface Plan {
  /** null = no limit. */
  documentsPerMonth: number | null;
  aiPerMonth: number | null;
  name: Record<Lang, string>;
}

export const PLANS: Record<PlanId, Plan> = {
  trial: { documentsPerMonth: 20, aiPerMonth: 60, name: { es: "Prueba gratis", en: "Free trial" } },
  // A fair-use ceiling, high enough that a busy contractor never meets it.
  pro: { documentsPerMonth: 500, aiPerMonth: 1500, name: { es: "Pro", en: "Pro" } },
  comped: { documentsPerMonth: null, aiPerMonth: null, name: { es: "Cortesía", en: "Courtesy" } },
};

export const isPlan = (v: unknown): v is PlanId => typeof v === "string" && (PLAN_IDS as string[]).includes(v);
export const isStatus = (v: unknown): v is AccountStatus => v === "active" || v === "suspended";

export interface MonthUsage {
  documents: number;
  ai: number;
  voiceChars: number;
  email: number;
  sms: number;
  inputTokens: number;
  outputTokens: number;
}
export const NO_USAGE: MonthUsage = { documents: 0, ai: 0, voiceChars: 0, email: 0, sms: 0, inputTokens: 0, outputTokens: 0 };

export type Block = "suspended" | "trial_over" | "limit_documents" | "limit_ai";

/** Whether the account may do one more of this; null = go ahead. */
export function blockFor(
  account: { plan: PlanId; status: AccountStatus; trialEndsAt: string },
  usage: MonthUsage,
  what: "document" | "ai",
  now = Date.now(),
): Block | null {
  if (account.status === "suspended") return "suspended";
  if (account.plan === "trial" && Date.parse(account.trialEndsAt) < now) return "trial_over";
  const plan = PLANS[account.plan];
  if (what === "document" && plan.documentsPerMonth !== null && usage.documents >= plan.documentsPerMonth) return "limit_documents";
  if (what === "ai" && plan.aiPerMonth !== null && usage.ai >= plan.aiPerMonth) return "limit_ai";
  return null;
}

/** Whole days left in the trial, never negative. */
export function trialDaysLeft(trialEndsAt: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((Date.parse(trialEndsAt) - now) / 86_400_000));
}

/** The first day of this month and of the next, in UTC, as ISO strings. */
export function monthRange(now = new Date()): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

/** What the person sees when their plan stops them, or null if the error isn't a plan limit. */
export function blockMessage(code: string | undefined, lang: Lang): string | null {
  const es = lang === "es";
  switch (code) {
    case "suspended":
      return es ? "Tu cuenta está pausada. Puedes ver y descargar tus facturas, pero no crear nuevas." : "Your account is paused. You can see and download your invoices, but not make new ones.";
    case "trial_over":
      return es ? "Tu prueba gratis terminó. Para seguir creando facturas, tu plan tiene que pasar a Pro (mira Mi cuenta)." : "Your free trial ended. To keep making invoices, your plan needs to move to Pro (see My account).";
    case "limit_documents":
      return es ? "Llegaste al límite de facturas de tu plan este mes. Mira tu uso en Mi cuenta." : "You've reached your plan's invoice limit this month. See your use in My account.";
    case "limit_ai":
      return es ? "Llegaste al límite de pedidos al asistente de tu plan este mes. Puedes escribir la factura a mano." : "You've reached your plan's assistant limit this month. You can still type the invoice yourself.";
    default:
      return null;
  }
}
