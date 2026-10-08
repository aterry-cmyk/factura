import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";

// Accounts against a real Postgres (TEST_DATABASE_URL; wiped). The most important test here is the
// first one: one business can never read or change another's documents, customers or prices.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("accounts", () => {
  let store: typeof import("@/lib/store");
  let accounts: typeof import("@/lib/accounts");
  let session: typeof import("@/lib/session");
  let admin: typeof import("@/lib/admin");
  const db = url ? postgres(url, { max: 1, onnotice: () => {} }) : null!;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    await db.unsafe(readFileSync("db/schema.sql", "utf8"));
    store = await import("@/lib/store");
    accounts = await import("@/lib/accounts");
    session = await import("@/lib/session");
    admin = await import("@/lib/admin");
  });
  beforeEach(async () => {
    await db`truncate events, documents, customers, usage_events, sessions, auth_tokens, auth_attempts, memberships, users, accounts restart identity cascade`;
    await db`delete from settings`;
    await db`update platform set signups_open = false`;
    delete process.env.OWNER_PASSWORD;
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
  const draft = (name: string, description: string, cents: number) => ({
    kind: "invoice" as const, lang: "es" as const,
    customer: { name, company: "", email: "", phone: "" },
    business: { name: "B", ownerName: "", address: "", phone: "", email: "", website: "" },
    items: [{ description, quantity: 1, unitPriceCents: cents, source: "said" as const }],
    state: "MD", taxRate: 0, dueDays: 15, reminderDays: 7, lateFee: { type: "none" as const },
    paymentMethods: {}, notes: "", transcript: "",
  });
  async function signUpOpen(email: string, password = "Pintura2026", name = "Juan") {
    await accounts.setSignupsOpen(true);
    const r = await accounts.signUp({ name, email, password, ip: "1.1.1.1" });
    await accounts.setSignupsOpen(false);
    if (!r.ok) throw new Error(r.error);
    return r;
  }

  it("keeps every account's documents, customers and prices to itself", async () => {
    const A = await newAccount("Pintura Hernández");
    const B = await newAccount("Techos López");
    const a = await store.createDocument(A, draft("Juan Pérez", "Pintar cocina", 220000), { today: "2026-10-01" });
    const b = await store.createDocument(B, draft("Ana López", "Cambiar techo", 900000), { today: "2026-10-01" });
    // Both businesses start at F-0001.
    expect([a.number, b.number]).toEqual(["F-0001", "F-0001"]);

    expect(await store.getDocument(B, a.id)).toBeNull();
    expect((await store.getDocument(A, a.id))?.id).toBe(a.id);
    expect((await store.listDocuments(A)).map((d) => d.id)).toEqual([a.id]);
    expect(await store.getDocuments(B, [a.id, b.id])).toHaveLength(1);
    expect((await store.searchDocuments(B, { q: "juan", status: "all", kind: "all", from: null, to: null, page: 1 }, "2026-10-01", null)).total).toBe(0);
    expect(await store.catalog(B)).toEqual([{ description: "Cambiar techo", unitPriceCents: 900000 }]);
    expect(await store.findCustomers(B, "juan")).toEqual([]);
    expect((await store.documentTotals(B, "2026-10-01")).drafts).toBe(1);

    // Changing someone else's document does nothing.
    expect(await store.setStatus(B, a.id, "void")).toBeNull();
    await store.updateDraft(B, a.id, draft("X", "robado", 1), "2026-10-02");
    const still = (await store.getDocument(A, a.id))!;
    expect([still.status, still.totalCents, still.customer.name]).toEqual(["draft", 220000, "Juan Pérez"]);

    // Settings and logos are per account too.
    await store.setLang(B, "en");
    expect((await store.getSettings(A)).lang).toBe("es");
    await store.setLogo(B, { bytes: Buffer.from("x"), type: "image/png" });
    expect(await store.getLogo(A)).toBeNull();
  });

  it("is invitation-only until an admin opens sign-ups; an invitation works once, for its email", async () => {
    const base = { name: "Rosa", password: "Techos2026", ip: "2.2.2.2" };
    expect(await accounts.signUp({ ...base, email: "rosa@example.com" })).toEqual({ ok: false, error: "invite_needed" });

    const [owner] = await db`insert into users (email, password_hash) values ('admin@example.com', 'x') returning id`;
    const inv = (await accounts.createInvite("Rosa@Example.com", String(owner.id)))!;
    expect(await accounts.inviteEmail(inv.token)).toBe("rosa@example.com");
    expect(await accounts.signUp({ ...base, email: "otra@example.com", invite: inv.token })).toEqual({ ok: false, error: "invite_needed" });

    const r = await accounts.signUp({ ...base, email: "rosa@example.com", invite: inv.token });
    expect(r.ok).toBe(true);
    expect(await accounts.inviteEmail(inv.token)).toBeNull();
    // The new business has its own settings and starts on a 14-day trial.
    const acctId = r.ok ? r.accountId : "";
    expect((await store.getSettings(acctId)).ownerName).toBe("Rosa");
    const [a] = await db`select plan, trial_ends_at > now() + interval '13 days' as long_enough from accounts where id = ${acctId}`;
    expect([a.plan, a.long_enough]).toEqual(["trial", true]);

    expect(await accounts.signUp({ ...base, email: "rosa@example.com", invite: inv.token })).toEqual({ ok: false, error: "invite_needed" });
    await accounts.setSignupsOpen(true);
    expect(await accounts.signUp({ ...base, email: "ROSA@example.com" })).toEqual({ ok: false, error: "email_taken" });
    expect(await accounts.signUp({ ...base, email: "bad", ip: "3.3.3.3" })).toEqual({ ok: false, error: "invalid_email" });
    expect(await accounts.signUp({ ...base, email: "x@example.com", password: "corta1" })).toEqual({ ok: false, error: "password_short" });
  });

  it("signs in with the right password only, and slows down guessing", async () => {
    const r = await signUpOpen("juan@example.com");
    expect(await accounts.signIn("JUAN@example.com", "Pintura2026", "4.4.4.4")).toEqual({ ok: true, userId: r.userId, accountId: r.accountId });
    expect(await accounts.signIn("juan@example.com", "Pintura2025", "4.4.4.4")).toEqual({ ok: false, error: "wrong_login" });
    expect(await accounts.signIn("nadie@example.com", "Pintura2026", "4.4.4.4")).toEqual({ ok: false, error: "wrong_login" });
    for (let i = 0; i < 7; i++) await accounts.signIn("juan@example.com", "mala", "5.5.5.5");
    // Eight failures for this email: even the right password waits.
    expect(await accounts.signIn("juan@example.com", "Pintura2026", "6.6.6.6")).toEqual({ ok: false, error: "too_many" });
  });

  it("sessions belong to one person and account, expire, and can be ended", async () => {
    const r = await signUpOpen("juan@example.com");
    const t1 = await session.startSession(r.userId, r.accountId);
    const t2 = await session.startSession(r.userId, r.accountId);
    const ctx = (await session.lookupSession(t1))!;
    expect([ctx.email, ctx.accountId, ctx.role, ctx.plan, ctx.isAdmin]).toEqual(["juan@example.com", r.accountId, "owner", "trial", false]);
    expect(await session.lookupSession("x".repeat(43))).toBeNull();
    expect(await session.lookupSession(undefined)).toBeNull();

    expect(await session.endOtherSessions(r.userId, ctx.sessionId)).toBe(1);
    expect(await session.lookupSession(t2)).toBeNull();
    expect(await session.lookupSession(t1)).not.toBeNull();

    await db`update sessions set expires_at = now() - interval '1 minute'`;
    expect(await session.lookupSession(t1)).toBeNull();
  });

  it("changes a password only with the current one", async () => {
    const r = await signUpOpen("juan@example.com");
    expect(await accounts.changePassword(r.userId, "Equivocada1", "Nueva2026x")).toEqual({ ok: false, error: "wrong_password" });
    expect(await accounts.changePassword(r.userId, "Pintura2026", "corta")).toEqual({ ok: false, error: "password_short" });
    expect(await accounts.changePassword(r.userId, "Pintura2026", "Nueva2026x")).toEqual({ ok: true });
    expect((await accounts.signIn("juan@example.com", "Pintura2026", "7.7.7.7")).ok).toBe(false);
    expect((await accounts.signIn("juan@example.com", "Nueva2026x", "7.7.7.7")).ok).toBe(true);
  });

  it("a reset link works once, within 48 hours, and signs the person out everywhere", async () => {
    const r = await signUpOpen("juan@example.com");
    const old = await session.startSession(r.userId, r.accountId);
    const link = await accounts.createResetLink(r.userId, r.userId);
    expect(await accounts.resetTarget(link)).toEqual({ userId: r.userId, email: "juan@example.com" });
    expect(await accounts.redeemResetLink(link, "abc")).toEqual({ ok: false, error: "password_short" });
    expect((await accounts.redeemResetLink(link, "Olvide2026")).ok).toBe(true);
    expect(await session.lookupSession(old)).toBeNull();
    expect((await accounts.signIn("juan@example.com", "Olvide2026", "8.8.8.8")).ok).toBe(true);
    expect(await accounts.redeemResetLink(link, "Otra2026x")).toEqual({ ok: false, error: "link_invalid" });

    const late = await accounts.createResetLink(r.userId, r.userId);
    await db`update auth_tokens set expires_at = now() - interval '1 minute' where purpose = 'reset' and used_at is null`;
    expect(await accounts.resetTarget(late)).toBeNull();
    // A newer link cancels the older one.
    const first = await accounts.createResetLink(r.userId, r.userId);
    await accounts.createResetLink(r.userId, r.userId);
    expect(await accounts.resetTarget(first)).toBeNull();
  });

  it("the original owner claims the data from before accounts once, and becomes the admin", async () => {
    const legacy = await newAccount("Pintura Hernández");
    await store.createDocument(legacy, draft("Juan", "Pintar", 100), { today: "2026-10-01" });
    const input = { name: "Álvaro", email: "dueno@example.com", password: "Dueno2026", ip: "9.9.9.9" };
    expect(await accounts.claim({ ...input, ownerPassword: "x" })).toEqual({ ok: false, error: "nothing_to_claim" });
    process.env.OWNER_PASSWORD = "la-de-antes";
    expect(await accounts.claim({ ...input, ownerPassword: "otra" })).toEqual({ ok: false, error: "wrong_password" });
    const r = await accounts.claim({ ...input, ownerPassword: "la-de-antes" });
    expect(r).toEqual({ ok: true, userId: expect.any(String), accountId: legacy });
    const ctx = (await session.lookupSession(await session.startSession(r.ok ? r.userId : "", legacy)))!;
    expect([ctx.isAdmin, ctx.accountName, (await store.listDocuments(legacy)).length]).toEqual([true, "Pintura Hernández", 1]);
    expect(await accounts.claim({ ...input, email: "otro@example.com", ownerPassword: "la-de-antes" })).toEqual({ ok: false, error: "nothing_to_claim" });
  });

  it("counts usage per account and month, and stops a trial at its limit", async () => {
    const r = await signUpOpen("juan@example.com");
    const other = await newAccount("Otro");
    await accounts.recordUsage(r.accountId, "ai_request", 1, { input: 1200, output: 300 });
    await accounts.recordUsage(r.accountId, "ai_request", 1, { input: 800, output: 200 });
    await accounts.recordUsage(r.accountId, "voice_chars", 140);
    await accounts.recordUsage(other, "document", 5);
    await db`insert into usage_events (account_id, kind, quantity, created_at) values (${r.accountId}, 'document', 7, now() - interval '40 days')`;
    expect(await accounts.monthUsage(r.accountId)).toEqual({ documents: 0, ai: 2, voiceChars: 140, email: 0, sms: 0, inputTokens: 2000, outputTokens: 500 });

    const ctx = { accountId: r.accountId, plan: "trial" as const, status: "active" as const, trialEndsAt: new Date(Date.now() + 86_400_000).toISOString() };
    expect(await accounts.blockForCtx(ctx, "document")).toBeNull();
    await accounts.recordUsage(r.accountId, "document", 20);
    expect(await accounts.blockForCtx(ctx, "document")).toBe("limit_documents");
  });

  it("shows the admin every account with its owner, plan and this month's use", async () => {
    const r = await signUpOpen("juan@example.com");
    await store.saveBusiness(r.accountId, { name: "Pintura Juan", ownerName: "Juan", address: "", phone: "", email: "", website: "" });
    await newAccount("Sin dueño");
    await accounts.recordUsage(r.accountId, "document", 3);
    const rows = await admin.listAccounts();
    const juan = rows.find((x) => x.id === r.accountId)!;
    expect([juan.name, juan.ownerEmail, juan.plan, juan.documentsThisMonth, juan.claimed]).toEqual(["Pintura Juan", "juan@example.com", "trial", 3, true]);
    expect(rows.find((x) => x.name === "Sin dueño")?.claimed).toBe(false);

    const change = admin.validateAccountChange({ plan: "pro", status: "active", trialEndsAt: "2026-12-31", monthlyFeeCents: 2900, billingEmail: "", billingNotes: "Zelle" });
    expect(change.ok && (await admin.updateAccount(r.accountId, change.value))).toBe(true);
    const detail = (await admin.getAccount(r.accountId))!;
    expect([detail.plan, detail.monthlyFeeCents, detail.billingNotes, detail.people[0].email, detail.usage[0].documents]).toEqual(["pro", 2900, "Zelle", "juan@example.com", 3]);
    expect(await admin.getAccount("not-an-id")).toBeNull();
  });
});
