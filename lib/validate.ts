import { US_STATES } from "./i18n";
import type {
  Business,
  Customer,
  DocKind,
  Lang,
  LateFee,
  LineItem,
  PaymentMethods,
  PriceSource,
} from "./types";
import { REMINDER_CHOICES } from "./types";

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** US numbers only for now: 10 digits, or 11 starting with 1. Returns +1XXXXXXXXXX, "" for empty, null if invalid. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export const displayPhone = (e164: string): string => {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
};

export function validateCustomer(raw: unknown, errors: string[]): Customer {
  const r = obj(raw);
  const name = str(r.name, 120);
  if (!name) errors.push("customer.name: The customer needs a name.");
  const email = str(r.email, 200).toLowerCase();
  if (email && !EMAIL.test(email)) errors.push("customer.email: That email doesn't look right.");
  const phone = normalizePhone(str(r.phone, 40));
  if (phone === null) errors.push("customer.phone: Use a 10-digit US cell number.");
  return { name, company: str(r.company, 120), email, phone: phone ?? "" };
}

export function validateBusiness(raw: unknown, errors: string[]): Business {
  const r = obj(raw);
  const name = str(r.name, 120);
  if (!name) errors.push("business.name: Your business needs a name.");
  const email = str(r.email, 200).toLowerCase();
  if (email && !EMAIL.test(email)) errors.push("business.email: That email doesn't look right.");
  const phone = normalizePhone(str(r.phone, 40));
  if (phone === null) errors.push("business.phone: Use a 10-digit US phone number.");
  return {
    name,
    ownerName: str(r.ownerName, 120),
    address: str(r.address, 300),
    phone: phone ?? "",
    email,
    website: str(r.website, 200),
  };
}

const SOURCES: PriceSource[] = ["said", "catalog", "suggested", "typed"];
export const MAX_ITEMS = 50;
export const MAX_PRICE_CENTS = 100_000_000; // $1,000,000 per unit

export function validateItems(raw: unknown, errors: string[]): LineItem[] {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length === 0) errors.push("items: Add at least one item.");
  if (list.length > MAX_ITEMS) errors.push(`items: ${MAX_ITEMS} items at most.`);
  return list.slice(0, MAX_ITEMS).map((v, i) => {
    const r = obj(v);
    const description = str(r.description, 200);
    if (!description) errors.push(`items.${i}: Every item needs a description.`);
    const quantity = num(r.quantity);
    if (!(quantity > 0 && quantity <= 100_000)) errors.push(`items.${i}: Quantity must be more than 0.`);
    const unitPriceCents = num(r.unitPriceCents);
    if (!Number.isInteger(unitPriceCents) || unitPriceCents < 0 || unitPriceCents > MAX_PRICE_CENTS)
      errors.push(`items.${i}: The price isn't a valid amount.`);
    const source = SOURCES.includes(r.source as PriceSource) ? (r.source as PriceSource) : "typed";
    // A price the estimator guessed is never used until the owner confirms it.
    if (source === "suggested" && r.confirmed !== true)
      errors.push(`items.${i}: Confirm the suggested price for "${description}".`);
    const item: LineItem = { description, quantity, unitPriceCents, source };
    const basis = str(r.basis, 200);
    if (source === "suggested" && basis) item.basis = basis;
    return item;
  });
}

export function validateLateFee(raw: unknown, errors: string[]): LateFee {
  const r = obj(raw);
  const graceDays = Math.trunc(num(r.graceDays ?? 0));
  const graceOk = Number.isInteger(graceDays) && graceDays >= 0 && graceDays <= 90;
  if (r.type === "flat") {
    const amountCents = num(r.amountCents);
    if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > 1_000_000)
      errors.push("lateFee: Enter the late fee amount.");
    if (!graceOk) errors.push("lateFee: Grace days must be 0 to 90.");
    return { type: "flat", amountCents, graceDays };
  }
  if (r.type === "percent") {
    const percent = num(r.percent);
    if (!(percent > 0 && percent <= 10)) errors.push("lateFee: The monthly percent must be between 0 and 10.");
    if (!graceOk) errors.push("lateFee: Grace days must be 0 to 90.");
    return { type: "percent", percent, graceDays };
  }
  return { type: "none" };
}

export function validatePayment(raw: unknown, errors: string[]): PaymentMethods {
  const r = obj(raw);
  const out: PaymentMethods = {};
  const on = (k: string) => obj(r[k]).enabled === true;
  const need = (k: string, field: string, max: number, label: string): string => {
    const v = str(obj(r[k])[field], max);
    if (!v) errors.push(`payment.${k}: Fill in ${label}.`);
    return v;
  };
  if (on("check")) out.check = { enabled: true, payableTo: need("check", "payableTo", 120, "who checks are payable to") };
  if (on("zelle")) out.zelle = { enabled: true, handle: need("zelle", "handle", 120, "your Zelle email or phone") };
  if (on("bank")) out.bank = { enabled: true, details: need("bank", "details", 400, "your bank details") };
  if (on("cash")) out.cash = { enabled: true };
  if (on("card")) {
    const link = need("card", "link", 300, "your payment link");
    if (link && !/^https:\/\/\S+$/.test(link)) errors.push("payment.card: The payment link must start with https://");
    out.card = { enabled: true, link };
  }
  if (on("other")) out.other = { enabled: true, text: need("other", "text", 300, "the payment instructions") };
  if (Object.keys(out).length === 0) errors.push("payment: Choose at least one way to get paid.");
  return out;
}

export interface DraftInput {
  kind: DocKind;
  lang: Lang;
  customer: Customer;
  business: Business;
  items: LineItem[];
  state: string;
  taxRate: number;
  dueDays: number;
  reminderDays: number;
  lateFee: LateFee;
  paymentMethods: PaymentMethods;
  notes: string;
  transcript: string;
}

/** Everything the wizard sends, checked on the server. Nothing is saved unless all of it passes. */
export function validateDraft(raw: unknown): Result<DraftInput> {
  const r = obj(raw);
  const errors: string[] = [];
  const kind: DocKind = r.kind === "estimate" ? "estimate" : "invoice";
  const lang: Lang = r.lang === "en" ? "en" : "es";
  const customer = validateCustomer(r.customer, errors);
  const business = validateBusiness(r.business, errors);
  const items = validateItems(r.items, errors);
  const state = str(r.state, 2).toUpperCase();
  if (state && !US_STATES.some(([code]) => code === state)) errors.push("state: Pick a state from the list.");
  const taxEnabled = r.taxEnabled === true;
  const taxRate = taxEnabled ? num(r.taxRate) : 0;
  if (taxEnabled && !(taxRate > 0 && taxRate <= 30)) errors.push("taxRate: Enter a tax rate between 0 and 30%.");
  const dueDays = Math.trunc(num(r.dueDays));
  if (!(dueDays >= 0 && dueDays <= 120)) errors.push("dueDays: Choose when it's due.");
  const reminderDays = num(r.reminderDays);
  if (!(REMINDER_CHOICES as readonly number[]).includes(reminderDays))
    errors.push("reminderDays: Choose how often to remind.");
  // An estimate isn't owed yet, so it carries no late fee and no reminders.
  const lateFee = kind === "estimate" ? ({ type: "none" } as LateFee) : validateLateFee(r.lateFee, errors);
  const paymentMethods = validatePayment(r.paymentMethods, errors);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      kind,
      lang,
      customer,
      business,
      items,
      state,
      taxRate: Math.round(taxRate * 1000) / 1000,
      dueDays,
      reminderDays: kind === "estimate" ? 0 : reminderDays,
      lateFee,
      paymentMethods,
      notes: str(r.notes, 1000),
      transcript: str(r.transcript, 5000),
    },
  };
}
