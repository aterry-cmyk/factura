import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";

// Runs against a real Postgres when TEST_DATABASE_URL is set (see README). Wipes that database's tables.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("database", () => {
  let store: typeof import("@/lib/store");
  let deliverMod: typeof import("@/lib/deliver");
  const admin = url ? postgres(url, { max: 1, onnotice: () => {} }) : null!;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    await admin.unsafe(readFileSync("db/schema.sql", "utf8"));
    store = await import("@/lib/store");
    deliverMod = await import("@/lib/deliver");
  });
  beforeEach(async () => {
    await admin`truncate events, documents, customers restart identity cascade`;
    await admin`update settings set next_invoice_no = 1, next_estimate_no = 1, onboarded = false, business_name = ''`;
    vi.unstubAllGlobals();
    for (const k of ["RESEND_API_KEY", "EMAIL_FROM", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"]) delete process.env[k];
  });
  afterAll(async () => {
    await admin.end();
    const { sql } = await import("@/lib/db");
    await sql().end();
  });

  const draft = (over: Record<string, unknown> = {}) => ({
    kind: "invoice" as const,
    lang: "es" as const,
    customer: { name: "Juan Pérez", company: "", email: "juan@example.com", phone: "+13015550100" },
    business: { name: "Pintura Hernández", ownerName: "José", address: "", phone: "+13015550199", email: "jose@example.com", website: "" },
    items: [
      { description: "Pintar cocina", quantity: 1, unitPriceCents: 220000, source: "said" as const },
      { description: "Ventanas (estimado)", quantity: 1, unitPriceCents: 145000, source: "suggested" as const },
    ],
    state: "MD",
    taxRate: 6,
    dueDays: 15,
    reminderDays: 7,
    lateFee: { type: "flat" as const, amountCents: 2500, graceDays: 5 },
    paymentMethods: { zelle: { enabled: true, handle: "3015550199" } },
    notes: "",
    transcript: "factura para Juan pintar cocina 2200",
    ...over,
  });

  it("numbers invoices and estimates separately, reuses customers, totals on the server", async () => {
    const a = await store.createDocument(draft(), { today: "2026-10-01", model: "m", promptVersion: "p" });
    const b = await store.createDocument(draft({ customer: { name: "juan pérez", company: "", email: "", phone: "" } }), { today: "2026-10-01" });
    const e = await store.createDocument(draft({ kind: "estimate" }), { today: "2026-10-01" });
    expect([a.number, b.number, e.number]).toEqual(["F-0001", "F-0002", "P-0001"]);
    expect(a.totalCents).toBe(Math.round(365000 * 1.06));
    expect(a.dueDate).toBe("2026-10-16");
    expect(a.status).toBe("draft");
    const [{ count }] = await admin`select count(*)::int as count from customers`;
    expect(count).toBe(1);
    // An empty email on the second draft doesn't erase the saved one.
    const [c] = await admin`select email from customers`;
    expect(c.email).toBe("juan@example.com");
  });

  it("finds documents by customer, number or item, by status (overdue too), kind and date", async () => {
    const a = await store.createDocument(draft(), { today: "2026-09-01" });
    const b = await store.createDocument(draft({ customer: { name: "Ana López", company: "Café Luna", email: "", phone: "" }, items: [{ description: "Reparación de techo 50%_off", quantity: 1, unitPriceCents: 90000, source: "said" }] }), { today: "2026-09-20" });
    const e = await store.createDocument(draft({ kind: "estimate" }), { today: "2026-09-25" });
    await store.markSent(a.id);
    await store.markSent(b.id);
    const today = "2026-09-26";
    const { parseFilters } = await import("@/lib/doc-list");
    const find = async (p: Record<string, string>) => (await store.searchDocuments(parseFilters(p), today, null)).docs.map((d) => d.number).sort();
    expect(await find({})).toEqual(["F-0001", "F-0002", "P-0001"]);
    expect(await find({ q: "café" })).toEqual(["F-0002"]);
    expect(await find({ q: "techo" })).toEqual(["F-0002"]);
    expect(await find({ q: "f-0001" })).toEqual(["F-0001"]);
    expect(await find({ q: "50%_" })).toEqual(["F-0002"]);
    expect(await find({ q: "%" })).toEqual(["F-0002"]);
    expect(await find({ status: "overdue" })).toEqual(["F-0001"]);
    expect(await find({ status: "sent" })).toEqual(["F-0001", "F-0002"]);
    expect(await find({ status: "draft" })).toEqual(["P-0001"]);
    expect(await find({ kind: "estimate" })).toEqual(["P-0001"]);
    expect(await find({ from: "2026-09-15", to: "2026-09-21" })).toEqual(["F-0002"]);
    const page = await store.searchDocuments(parseFilters({}), today, { limit: 2, offset: 2 });
    expect([page.total, page.docs.length]).toEqual([3, 1]);
    expect(e.number).toBe("P-0001");
  });

  it("totals what's owed with today's late fees, what's overdue, and what was paid this month", async () => {
    const a = await store.createDocument(draft(), { today: "2026-09-01" });
    const b = await store.createDocument(draft(), { today: "2026-09-20" });
    const c = await store.createDocument(draft(), { today: "2026-09-20" });
    await store.createDocument(draft(), { today: "2026-09-20" });
    await store.markSent(a.id);
    await store.markSent(b.id);
    await store.setStatus(c.id, "paid");
    const today = new Date().toISOString().slice(0, 10);
    const t = await store.documentTotals(today);
    const total = Math.round(365000 * 1.06);
    const { amountDueCents } = await import("@/lib/money");
    const docA = (await store.getDocument(a.id))!;
    const docB = (await store.getDocument(b.id))!;
    expect(t.owed).toEqual({ count: 2, cents: amountDueCents(docA, today) + amountDueCents(docB, today) });
    expect(t.overdue.count).toBe([docA, docB].filter((d) => d.dueDate < today).length);
    expect(t.paidThisMonth).toEqual({ count: 1, cents: total });
    expect(t.drafts).toBe(1);
  });

  it("learns prices, but never from unconfirmed suggestions or void documents", async () => {
    const d = await store.createDocument(draft(), { today: "2026-10-01" });
    expect(await store.catalog()).toEqual([{ description: "Pintar cocina", unitPriceCents: 220000 }]);
    await store.setStatus(d.id, "void");
    expect(await store.catalog()).toEqual([]);
  });

  it("remembers the wizard's answers", async () => {
    const { validateDraft } = await import("@/lib/validate");
    const v = validateDraft({ ...draft(), taxEnabled: true, items: [{ description: "x", quantity: 1, unitPriceCents: 100, source: "typed" }] });
    if (!v.ok) throw new Error(v.errors.join());
    await store.saveDefaults(v.value);
    const s = await store.getSettings();
    expect(s).toMatchObject({ name: "Pintura Hernández", state: "MD", taxEnabled: true, taxRate: 6, reminderDays: 7, onboarded: true });
    expect(s.lateFee).toEqual({ type: "flat", amountCents: 2500, graceDays: 5 });
  });

  it("only edits drafts, and the public link only opens once it's out", async () => {
    const d = await store.createDocument(draft(), { today: "2026-10-01" });
    expect(await store.getByToken(d.publicToken)).toBeNull();
    await store.updateDraft(d.id, { ...draft(), items: [{ description: "Otra cosa", quantity: 2, unitPriceCents: 5000, source: "typed" }], taxRate: 0 }, "2026-10-02");
    const edited = (await store.getDocument(d.id))!;
    expect(edited.totalCents).toBe(10000);
    expect(edited.number).toBe("F-0001");
    await store.markSent(d.id);
    expect((await store.getByToken(d.publicToken))?.id).toBe(d.id);
    await store.updateDraft(d.id, draft(), "2026-10-03");
    expect((await store.getDocument(d.id))!.totalCents).toBe(10000);
  });

  it("says 'setup needed' without keys and never marks it sent", async () => {
    const d = await store.createDocument(draft(), { today: "2026-10-01" });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await deliverMod.deliver(d, "email", "https://x.test")).toEqual({ ok: false, reason: "setup" });
    expect(await deliverMod.deliver(d, "sms", "https://x.test")).toEqual({ ok: false, reason: "setup" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await store.getDocument(d.id))!.status).toBe("draft");
  });

  it("emails the PDF through Resend and texts the link through Twilio", async () => {
    Object.assign(process.env, { RESEND_API_KEY: "re_x", EMAIL_FROM: "Facturas <f@example.com>", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "tok", TWILIO_FROM: "+15555550123" });
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string, init: RequestInit) => {
      calls.push({ url: String(u), init });
      return new Response(JSON.stringify({ id: "e1", sid: "SM1" }), { status: 200 });
    }));
    const d = await store.createDocument(draft(), { today: "2026-10-01" });
    expect(await deliverMod.deliver(d, "email", "https://x.test")).toEqual({ ok: true });
    const email = JSON.parse(String(calls[0].init.body));
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(email.from).toBe("Pintura Hernández <f@example.com>");
    expect(email.to).toEqual(["juan@example.com"]);
    expect(email.reply_to).toBe("jose@example.com");
    expect(email.attachments[0].filename).toBe("F-0001.pdf");
    expect(Buffer.from(email.attachments[0].content, "base64").subarray(0, 5).toString()).toBe("%PDF-");
    expect(email.text).toContain(`https://x.test/i/${d.publicToken}`);
    expect((await store.getDocument(d.id))!.status).toBe("sent");

    expect(await deliverMod.deliver((await store.getDocument(d.id))!, "sms", "https://x.test")).toEqual({ ok: true });
    expect(calls[1].url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json");
    const form = new URLSearchParams(String(calls[1].init.body));
    expect(form.get("To")).toBe("+13015550100");
    expect(form.get("Body")).toMatch(/Pintura Hernández le envió la factura F-0001 por \$3[,.]869[.,]00/);
    const events = (await store.listEvents(d.id)).map((e) => e.kind);
    expect(events).toEqual(expect.arrayContaining(["sent_email", "sent_sms", "created"]));
  });

  it("records a provider's refusal and leaves the draft alone", async () => {
    Object.assign(process.env, { RESEND_API_KEY: "re_x", EMAIL_FROM: "f@example.com" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "domain not verified" }), { status: 403 })));
    const d = await store.createDocument(draft(), { today: "2026-10-01" });
    expect(await deliverMod.deliver(d, "email", "https://x.test")).toEqual({ ok: false, reason: "failed" });
    expect((await store.getDocument(d.id))!.status).toBe("draft");
    const [ev] = await store.listEvents(d.id);
    expect(ev).toMatchObject({ kind: "sent_email_failed", detail: "Resend 403: domain not verified" });
  });

  it("sends reminders with the late fee included, and counts them", async () => {
    Object.assign(process.env, { TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "tok", TWILIO_FROM: "+15555550123" });
    const bodies: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      bodies.push(String(new URLSearchParams(String(init.body)).get("Body")));
      return new Response("{}", { status: 201 });
    }));
    const d = await store.createDocument(draft({ customer: { name: "Ana", company: "", email: "", phone: "+13015550111" }, taxRate: 0, items: [{ description: "x", quantity: 1, unitPriceCents: 100000, source: "said" }] }), { today: "2026-10-01" });
    await store.markSent(d.id);
    const doc = (await store.getDocument(d.id))!;
    expect(await deliverMod.deliver(doc, "sms", "https://x.test", { reminder: true, today: "2026-10-30" })).toEqual({ ok: true });
    expect(bodies[0]).toMatch(/recordatorio, la factura F-0001 por \$1[,.]025[.,]00/);
    const after = (await store.getDocument(d.id))!;
    expect(after.reminderCount).toBe(1);
    expect(after.lastReminderAt).not.toBeNull();
  });
});
