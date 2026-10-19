import { createHmac, timingSafeEqual } from "node:crypto";

// Online payments with Stripe Connect (Express accounts, destination charges). Each business
// connects its own Stripe account; the customer pays on Stripe's page; the money goes to the
// business, minus Stripe's fee and Loro's fee. Stripe's REST API directly, no SDK, like email
// and SMS. Without STRIPE_SECRET_KEY nothing here runs and the app says "setup needed".

export const stripeConfigured = (): boolean => Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);

/** Loro's cut of each online payment, in percent (LORO_FEE_PERCENT, default 1). */
export function feePercent(): number {
  const v = Number(process.env.LORO_FEE_PERCENT ?? "1");
  return Number.isFinite(v) && v >= 0 && v <= 10 ? v : 1;
}

export const feeCents = (amountCents: number, percent = feePercent()): number => Math.round((amountCents * percent) / 100);

/** Stripe's smallest charge in USD is $0.50. */
export const MIN_ONLINE_CENTS = 50;

const base = () => process.env.STRIPE_API_URL || "https://api.stripe.com";

/** Stripe's form encoding, with nested keys like metadata[doc]=…. */
export function formEncode(obj: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => {
      if (item && typeof item === "object") out.push(...formEncode(item as Record<string, unknown>, `${key}[${i}]`));
      else out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
    });
    else if (typeof v === "object") out.push(...formEncode(v as Record<string, unknown>, key));
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out;
}

export type StripeResult<T> = { ok: true; data: T } | { ok: false; status: number; detail: string };

async function stripe<T>(method: "GET" | "POST", path: string, params?: Record<string, unknown>, idempotencyKey?: string): Promise<StripeResult<T>> {
  try {
    const res = await fetch(`${base()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Stripe-Version": "2024-06-20",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: params ? formEncode(params).join("&") : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!res.ok) return { ok: false, status: res.status, detail: `Stripe ${res.status}: ${json.error?.message ?? "error"}` };
    return { ok: true, data: json };
  } catch (err) {
    return { ok: false, status: 0, detail: `Stripe unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export interface StripeAccount {
  id: string;
  charges_enabled: boolean;
  details_submitted: boolean;
}

/** A new Express account for this business, ready for Stripe's own sign-up pages. */
export function createAccount(input: { email: string; businessName: string; accountId: string }) {
  return stripe<StripeAccount>("POST", "/v1/accounts", {
    type: "express",
    country: "US",
    email: input.email || undefined,
    business_profile: { name: input.businessName || undefined, mcc: "1520", product_description: "Contractor services billed by invoice" },
    capabilities: { card_payments: { requested: true }, transfers: { requested: true }, us_bank_account_ach_payments: { requested: true } },
    metadata: { loro_account: input.accountId },
  }, `acct-${input.accountId}`);
}

export const getAccount = (id: string) => stripe<StripeAccount>("GET", `/v1/accounts/${encodeURIComponent(id)}`);

/** A one-time link to Stripe's sign-up (or the rest of it), returning to Settings. */
export function onboardingLink(stripeAccountId: string, appUrl: string) {
  return stripe<{ url: string }>("POST", "/v1/account_links", {
    account: stripeAccountId,
    type: "account_onboarding",
    refresh_url: `${appUrl}/settings?stripe=refresh#pagos`,
    return_url: `${appUrl}/settings?stripe=return#pagos`,
  });
}

/** A one-time link into the business's own Stripe dashboard (payouts, bank account). */
export const dashboardLink = (stripeAccountId: string) =>
  stripe<{ url: string }>("POST", `/v1/accounts/${encodeURIComponent(stripeAccountId)}/login_links`);

export interface CheckoutSession {
  id: string;
  url: string;
  payment_status: "paid" | "unpaid" | "no_payment_required";
  payment_intent: string | null;
  amount_total: number;
  metadata: Record<string, string>;
}

/**
 * Stripe's payment page for one invoice. Destination charge: the business is the merchant of
 * record (their name on the customer's statement) and Loro's fee comes off before it's paid out.
 */
export function createCheckout(input: {
  stripeAccountId: string; docId: string; accountId: string; token: string; number: string; businessName: string;
  amountCents: number; customerEmail: string; appUrl: string; lang: "es" | "en";
}) {
  const fee = feeCents(input.amountCents);
  return stripe<CheckoutSession>("POST", "/v1/checkout/sessions", {
    mode: "payment",
    locale: input.lang,
    customer_email: input.customerEmail || undefined,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: input.amountCents,
        product_data: { name: `${input.lang === "es" ? "Factura" : "Invoice"} ${input.number} · ${input.businessName}`.slice(0, 250) },
      },
    }],
    payment_method_types: ["card", "us_bank_account"],
    payment_intent_data: {
      application_fee_amount: fee > 0 ? fee : undefined,
      on_behalf_of: input.stripeAccountId,
      transfer_data: { destination: input.stripeAccountId },
      metadata: { loro_doc: input.docId, loro_account: input.accountId },
    },
    metadata: { loro_doc: input.docId, loro_account: input.accountId, loro_token: input.token },
    success_url: `${input.appUrl}/i/${input.token}?pago=ok`,
    cancel_url: `${input.appUrl}/i/${input.token}`,
  }, `checkout-${input.docId}-${input.amountCents}-${Math.floor(Date.now() / 600_000)}`);
}

/**
 * Checks Stripe's signature on a webhook (header "t=…,v1=…", HMAC-SHA256 of "t.body") and that
 * it's less than 5 minutes old. Returns the event, or null if anything is off.
 */
export function verifyWebhook(body: string, header: string | null, secret: string, now = Date.now()): { id: string; type: string; data: { object: Record<string, unknown> } } | null {
  if (!header || !secret) return null;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]));
  const t = Number(parts.t);
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!Number.isFinite(t) || !sigs.length || Math.abs(now / 1000 - t) > 300) return null;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest();
  const good = sigs.some((s) => {
    const got = Buffer.from(s, "hex");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
  if (!good) return null;
  try {
    const event = JSON.parse(body);
    return event && typeof event.id === "string" && typeof event.type === "string" && event.data?.object ? event : null;
  } catch {
    return null;
  }
}

/** For tests and the local stand-in: a header Stripe would send for this body. */
export function signWebhook(body: string, secret: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}
