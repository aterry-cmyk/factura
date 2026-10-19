import { afterEach, describe, expect, it, vi } from "vitest";
import { createCheckout, feeCents, formEncode, signWebhook, verifyWebhook } from "@/lib/payments";

afterEach(() => { vi.unstubAllGlobals(); delete process.env.LORO_FEE_PERCENT; });

describe("Stripe requests", () => {
  it("encodes nested params the way Stripe reads them", () => {
    expect(formEncode({ a: 1, b: { c: "x y", d: undefined }, e: ["card", "us_bank_account"], f: [{ g: 2 }] })).toEqual([
      "a=1", "b%5Bc%5D=x%20y", "e%5B0%5D=card", "e%5B1%5D=us_bank_account", "f%5B0%5D%5Bg%5D=2",
    ]);
  });

  it("takes Loro's fee as a percent, 1% unless set, never more than 10%", () => {
    expect(feeCents(220000)).toBe(2200);
    process.env.LORO_FEE_PERCENT = "2.5";
    expect(feeCents(220000)).toBe(5500);
    process.env.LORO_FEE_PERCENT = "50";
    expect(feeCents(10000)).toBe(100);
    expect(feeCents(33, 1)).toBe(0);
  });

  it("asks Stripe for a payment page that pays the business, minus the fee, and returns to the link", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "cs_1", url: "https://checkout.test/cs_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await createCheckout({
      stripeAccountId: "acct_9", docId: "doc-1", accountId: "acc-1", token: "tok", number: "F-0004", businessName: "Pintura Hernández",
      amountCents: 220000, customerEmail: "juan@example.com", appUrl: "https://app.test", lang: "es",
    });
    expect(r).toEqual({ ok: true, data: { id: "cs_1", url: "https://checkout.test/cs_1" } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk_test_x");
    const p = new URLSearchParams(init.body as string);
    expect(p.get("line_items[0][price_data][unit_amount]")).toBe("220000");
    expect(p.get("line_items[0][price_data][product_data][name]")).toBe("Factura F-0004 · Pintura Hernández");
    expect(p.get("payment_intent_data[application_fee_amount]")).toBe("2200");
    expect(p.get("payment_intent_data[transfer_data][destination]")).toBe("acct_9");
    expect(p.get("payment_intent_data[on_behalf_of]")).toBe("acct_9");
    expect(p.getAll("payment_method_types[0]").concat(p.getAll("payment_method_types[1]"))).toEqual(["card", "us_bank_account"]);
    expect(p.get("metadata[loro_doc]")).toBe("doc-1");
    expect(p.get("metadata[loro_account]")).toBe("acc-1");
    expect(p.get("success_url")).toBe("https://app.test/i/tok?pago=ok");
    expect(p.get("cancel_url")).toBe("https://app.test/i/tok");
  });

  it("reports Stripe's own error message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "No such account" } }), { status: 400 })));
    const r = await createCheckout({
      stripeAccountId: "acct_x", docId: "d", accountId: "a", token: "t", number: "F-1", businessName: "B", amountCents: 100, customerEmail: "", appUrl: "https://a", lang: "en",
    });
    expect(r).toEqual({ ok: false, status: 400, detail: "Stripe 400: No such account" });
  });
});

describe("Stripe's webhook signature", () => {
  const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_1" } } });
  it("accepts a fresh, correctly signed event", () => {
    expect(verifyWebhook(body, signWebhook(body, "whsec_a"), "whsec_a")?.id).toBe("evt_1");
  });
  it("refuses a wrong secret, a changed body, an old timestamp or no header", () => {
    expect(verifyWebhook(body, signWebhook(body, "whsec_b"), "whsec_a")).toBeNull();
    expect(verifyWebhook(body.replace("cs_1", "cs_2"), signWebhook(body, "whsec_a"), "whsec_a")).toBeNull();
    expect(verifyWebhook(body, signWebhook(body, "whsec_a", Math.floor(Date.now() / 1000) - 600), "whsec_a")).toBeNull();
    expect(verifyWebhook(body, null, "whsec_a")).toBeNull();
    expect(verifyWebhook("not json", signWebhook("not json", "whsec_a"), "whsec_a")).toBeNull();
  });
});
