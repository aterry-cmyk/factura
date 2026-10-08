import { US_STATES } from "./i18n";
import type { Business, Lang, PaymentMethods } from "./types";
import { REMINDER_CHOICES } from "./types";
import { validateBusiness, validatePayment } from "./validate";
import { isCountry, isGender } from "./voice";
import { isTrade, type Trade } from "./waitlist";

// The setup questions a new account answers once (app/welcome). Everything is checked with the
// same rules invoices use, so what they type here is exactly what prints on their first invoice.

export const DUE_CHOICES = [0, 7, 15, 30] as const;

export interface Setup {
  business: Business;
  trade: Trade | "";
  state: string;
  taxRate: number;
  dueDays: number;
  reminderDays: number;
  paymentMethods: PaymentMethods;
  country: string;
  voiceGender: "female" | "male";
  lang: Lang;
}

export function validateSetup(raw: unknown): { ok: true; value: Setup } | { ok: false; errors: string[] } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const errors: string[] = [];
  const business = validateBusiness(r.business, errors);
  const trade = r.trade === "" || r.trade === undefined ? "" : isTrade(r.trade) ? r.trade : null;
  if (trade === null) errors.push("trade: Pick your trade from the list.");
  const state = typeof r.state === "string" ? r.state : "";
  if (!US_STATES.some(([code]) => code === state)) errors.push("state: Pick the state where you work.");
  const taxRate = typeof r.taxRate === "number" ? r.taxRate : NaN;
  if (!(taxRate >= 0 && taxRate <= 30)) errors.push("taxRate: The tax rate must be between 0 and 30%.");
  const dueDays = typeof r.dueDays === "number" ? r.dueDays : NaN;
  if (!(DUE_CHOICES as readonly number[]).includes(dueDays)) errors.push("dueDays: Pick when invoices are due.");
  const reminderDays = typeof r.reminderDays === "number" ? r.reminderDays : NaN;
  if (!(REMINDER_CHOICES as readonly number[]).includes(reminderDays)) errors.push("reminderDays: Pick how often to remind.");
  const paymentMethods = validatePayment(r.paymentMethods, errors);
  if (!isCountry(r.country)) errors.push("country: Pick your country.");
  if (!isGender(r.voiceGender)) errors.push("voiceGender: Pick a voice.");
  const lang = r.lang === "en" ? "en" : r.lang === "es" ? "es" : null;
  if (!lang) errors.push("lang: Pick a language.");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      business, trade: trade as Trade | "", state, taxRate: Math.round(taxRate * 1000) / 1000, dueDays, reminderDays,
      paymentMethods, country: r.country as string, voiceGender: r.voiceGender as "female" | "male", lang: lang as Lang,
    },
  };
}

/** Which step a field error belongs to, so the form can send them back to the right screen. */
export function stepOfError(error: string): number {
  const field = error.split(":")[0];
  if (field.startsWith("business.name") || field === "trade") return 1;
  if (field.startsWith("business.")) return 2;
  if (field === "state" || field === "taxRate") return 3;
  if (field.startsWith("payment") || field === "dueDays" || field === "reminderDays") return 4;
  return 5;
}
