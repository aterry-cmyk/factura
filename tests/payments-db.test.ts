import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";

// Customers accepting estimates, online payments and the dashboard numbers, against a real
// Postgres (TEST_DATABASE_URL; wiped).
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("payments and estimates", () => {
  let store: typeof import("@/lib/store");
  const db = url ? postgres(url, { max: 1, onnotice: () => {} }) : null!;
  let A = "";
  let B = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    await db.unsafe(readFileSync("db/schema.sql", "utf8"));
    store = await import("@/lib/store");
  });
  beforeEach(async () => {
    await db`truncate events, documents, customers, usage_events, sessions, auth_tokens, auth_attempts, memberships, users, accounts, stripe_events restart identity cascade`;
    await db`delete from settings`;
    A = await newAccount("Pintura Hernández");
    B = await newAccount("Techos López");
  });
  afterAll(async () => {
    await db.end();
    const { sql } = await import("@/lib/db");
    await sql().end();
  });

  async function newAccount(name: string): Promise<string> {
    const [a] = await db`insert into accounts (name) values (${name}) returning id`;
    await db`insert into settings (account_id, business_name) values (${a.id}, ${name})`;
    return String(a.id);
  }
  const draft = (kind: "invoice" | "estimate", cents: number) => ({
    kind, lang: "es" as const,
    customer: { name: "Juan Pérez", company: "", email: "", phone: "" },
    business: { name: "B", ownerName: "", address: "", phone: "", email: "", website: "" },
    items: [{ description: "Pintar cocina", quantity: 1, unitPriceCents: cents, source: "said" as const }],
    state: "MD", taxRate: 0, dueDays: 15, reminderDays: 7, lateFee: { type: "none" as const }, paymentMethods: {}, notes: "", transcript: "",
  });
  const sent = async (acct: string, kind: "invoice" | "estimate", cents: number, today = "2026-10-01") => {
    const d = await store.createDocument(acct, draft(kind, cents), { today });
    await store.markSent(d.id);
    return d;
  };

  it("a customer accepts a sent estimate once, from its link, and nothing else", async () => {
    const est = await sent(A, "estimate", 540000);
    const inv = await sent(A, "invoice", 1000);
    const draftEst = await store.createDocument(A, draft("estimate", 1000), { today: "2026-10-01" });
    expect(await store.acceptByToken(inv.publicToken, "Juan")).toBeNull();
    expect(await store.acceptByToken(draftEst.publicToken, "Juan")).toBeNull();
    const ok = (await store.acceptByToken(est.publicToken, "Juan Pérez"))!;
    expect([ok.status, ok.acceptedBy, Boolean(ok.acceptedAt)]).toEqual(["accepted", "Juan Pérez", true]);
    expect(await store.acceptByToken(est.publicToken, "Otra persona")).toBeNull();
    expect((await store.listEvents(est.id)).map((e) => [e.kind, e.detail])).toContainEqual(["accepted_by_customer", "Juan Pérez"]);
  });

  it("an online payment marks only that business's sent invoice paid, once, and counts it", async () => {
    const inv = await sent(A, "invoice", 220000);
    const p = { docId: inv.id, sessionId: "cs_1", paymentIntent: "pi_1", amountCents: 220000, feeCents: 2200 };
    // The payment says it's for another business: refused.
    expect(await store.markPaidOnline({ ...p, accountId: B })).toBeNull();
    const paid = (await store.markPaidOnline({ ...p, accountId: A }))!;
    expect([paid.status, paid.paidVia, paid.paidAmountCents]).toEqual(["paid", "online", 220000]);
    expect(await store.markPaidOnline({ ...p, accountId: A })).toBeNull();
    const [u] = await db`select kind, amount_cents::int as amt, fee_cents::int as fee from usage_events where account_id = ${A}`;
    expect(u).toEqual({ kind: "payment", amt: 220000, fee: 2200 });
    // Marked paid by hand, it says so; marked unpaid again, it forgets how.
    const other = await sent(A, "invoice", 1000);
    expect((await store.setStatus(A, other.id, "paid"))?.paidVia).toBe("manual");
    expect((await store.setStatus(A, other.id, "sent"))?.paidVia).toBeNull();
  });

  it("handles each Stripe event once, and can forget one that failed", async () => {
    expect(await store.firstTimeEvent("evt_1", "checkout.session.completed")).toBe(true);
    expect(await store.firstTimeEvent("evt_1", "checkout.session.completed")).toBe(false);
    await store.forgetEvent("evt_1");
    expect(await store.firstTimeEvent("evt_1", "checkout.session.completed")).toBe(true);
  });

  it("remembers each business's Stripe account and whether it can take payments", async () => {
    await store.setStripeAccount(A, "acct_123");
    await store.setStripeStatus(A, { chargesEnabled: true, detailsSubmitted: true });
    const s = await store.getSettings(A);
    expect([s.stripeAccountId, s.stripeReady, s.stripeDetailsSubmitted]).toEqual(["acct_123", true, true]);
    expect((await store.getSettings(B)).stripeReady).toBe(false);
  });

  it("adds up the months, the open invoices and the estimates for the dashboard, per business", async () => {
    const i1 = await sent(A, "invoice", 100000, "2026-09-10");
    await sent(A, "invoice", 50000, "2026-10-05");
    await store.markPaidOnline({ docId: i1.id, accountId: A, sessionId: "s", paymentIntent: null, amountCents: 100000, feeCents: 1000 });
    await db`update documents set paid_at = '2026-10-02' where id = ${i1.id}`;
    await sent(B, "invoice", 999999, "2026-10-05");
    const months = await store.invoiceMonths(A, "2026-05-01");
    expect(months.sort((a, b) => a.month.localeCompare(b.month))).toEqual([
      { month: "2026-09", billed: 100000, collected: 0, online: 0 },
      { month: "2026-10", billed: 50000, collected: 100000, online: 100000 },
    ]);
    expect((await store.openInvoices(A)).map((d) => d.totalCents)).toEqual([50000]);

    const e1 = await sent(A, "estimate", 300000, "2026-10-01");
    const e2 = await sent(A, "estimate", 200000, "2026-10-01");
    await sent(A, "estimate", 100000, "2026-10-01");
    await store.acceptByToken(e1.publicToken, "Juan");
    await store.setStatus(A, e2.id, "void");
    const t = await store.estimateTotals(A, "2026-10-19");
    expect(t).toMatchObject({ open: { count: 1, cents: 100000 }, accepted90: 1, declined90: 1 });
    expect(t.acceptedThisMonth.count).toBe(1);
    expect(await store.estimateMonths(A, "2026-05-01")).toEqual([{ month: "2026-10", sent: 600000, accepted: 300000 }]);
  });
});
