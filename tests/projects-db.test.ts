import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { templatePlan } from "@/lib/projects";

// Projects against a real Postgres (TEST_DATABASE_URL; wiped): creating one from a plan,
// ticking steps, photos, invoicing a milestone and the invoice's status flowing back.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("projects", () => {
  let store: typeof import("@/lib/store");
  let projects: typeof import("@/lib/projects-store");
  const db = url ? postgres(url, { max: 1, onnotice: () => {} }) : null!;
  let A = "";
  let B = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    await db.unsafe(readFileSync("db/schema.sql", "utf8"));
    store = await import("@/lib/store");
    projects = await import("@/lib/projects-store");
  });
  beforeEach(async () => {
    await db`truncate project_events, project_photos, checklist_items, milestones, projects, events, documents, customers, usage_events, sessions, memberships, users, accounts restart identity cascade`;
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
    await db`insert into settings (account_id, business_name, due_days) values (${a.id}, ${name}, 10)`;
    return String(a.id);
  }
  const input = (over: Record<string, unknown> = {}) => ({
    name: "Cocina de Ana", description: "Remodelar la cocina", lang: "es" as const,
    customer: { name: "Ana López", company: "", email: "ana@example.com", phone: "+13015550100" },
    totalCents: 2_500_001, estimateId: null, plan: templatePlan("es"), planSource: "template" as const, ...over,
  });

  it("creates the project with milestone amounts that add up to the total, and the customer once", async () => {
    const p = await projects.createProject(A, input(), { model: "m", promptVersion: "v" });
    const view = (await projects.getProject(A, p.id))!;
    expect(view.milestones.map((m) => m.amountCents)).toEqual([250_000, 500_000, 1_000_000, 500_000, 250_001]);
    expect(view.items).toHaveLength(9);
    expect(view.items.filter((i) => i.milestoneId === view.milestones[1].id).map((i) => i.text)).toEqual(["Proteger el área de trabajo", "Materiales en sitio", "Demolición o preparación terminada"]);
    expect(await projects.getProject(B, p.id)).toBeNull();
    const [{ count }] = await db`select count(*)::int as count from customers`;
    expect(count).toBe(1);
    const byToken = await projects.getProjectByToken(p.publicToken);
    expect(byToken?.project.id).toBe(p.id);
    expect(await projects.getProjectByToken("nope")).toBeNull();
    const list = await projects.listProjects(A);
    expect(list).toHaveLength(1);
    expect(list[0].milestones).toHaveLength(5);
  });

  it("ticks steps only for its own business, and stores photos the customer's link can read", async () => {
    const p = await projects.createProject(A, input());
    const view = (await projects.getProject(A, p.id))!;
    const first = view.items[0];
    expect(await projects.setItemDone(B, p.id, first.id, true)).toBeNull();
    const done = await projects.setItemDone(A, p.id, first.id, true, "Hecho temprano");
    expect(done?.doneAt).toBeTruthy();
    expect(done?.note).toBe("Hecho temprano");
    const undone = await projects.setItemDone(A, p.id, first.id, false);
    expect(undone?.doneAt).toBeNull();
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    expect(await projects.addPhoto(B, p.id, first.id, { bytes: jpeg, type: "image/jpeg" })).toBeNull();
    const photoId = (await projects.addPhoto(A, p.id, first.id, { bytes: jpeg, type: "image/jpeg" }))!;
    expect(photoId).toBeTruthy();
    const got = await projects.getPhoto(p.id, photoId);
    expect(got?.type).toBe("image/jpeg");
    expect(Buffer.compare(got!.bytes, jpeg)).toBe(0);
    expect((await projects.getProject(A, p.id))!.items[0].photoIds).toEqual([photoId]);
    expect(await projects.listPhotos(p.id)).toMatchObject([{ id: photoId, itemId: first.id }]);
    const events = await projects.listProjectEvents(p.id);
    expect(events.map((e) => e.kind)).toEqual(["photo", "step_undone", "step_done", "created"]);
  });

  it("invoices a milestone as a sent invoice, and the invoice's status flows back to the milestone", async () => {
    const p = await projects.createProject(A, input());
    const settings = await store.getSettings(A);
    let view = (await projects.getProject(A, p.id))!;
    const m0 = view.milestones[0];
    const doc = (await projects.invoiceMilestone(A, view, m0.id, settings, "2026-10-27"))!;
    expect(doc.number).toBe("F-0001");
    expect(doc.items).toEqual([{ description: "Cocina de Ana — hito 1: Anticipo", quantity: 1, unitPriceCents: 250_000, source: "typed" }]);
    expect(doc.totalCents).toBe(250_000);
    expect(doc.dueDate).toBe("2026-11-06");
    expect(doc.customer.name).toBe("Ana López");
    expect((await store.getDocument(A, doc.id))!.status).toBe("sent");
    view = (await projects.getProject(A, p.id))!;
    expect(view.milestones[0]).toMatchObject({ status: "invoiced", invoiceId: doc.id, invoiceToken: doc.publicToken, invoiceNumber: "F-0001" });
    // Only once.
    expect(await projects.invoiceMilestone(A, view, m0.id, settings, "2026-10-27")).toBeNull();

    await store.setStatus(A, doc.id, "paid");
    expect((await projects.getProject(A, p.id))!.milestones[0].status).toBe("paid");
    await store.setStatus(A, doc.id, "sent");
    expect((await projects.getProject(A, p.id))!.milestones[0].status).toBe("invoiced");
    await store.setStatus(A, doc.id, "void");
    view = (await projects.getProject(A, p.id))!;
    expect(view.milestones[0]).toMatchObject({ status: "pending", invoiceId: null });

    // Paid online through Stripe too.
    const doc2 = (await projects.invoiceMilestone(A, view, m0.id, settings, "2026-10-27"))!;
    expect(doc2.number).toBe("F-0002");
    await store.markPaidOnline({ docId: doc2.id, accountId: A, sessionId: "cs_1", paymentIntent: "pi_1", amountCents: 250_000, feeCents: 2500 });
    expect((await projects.getProject(A, p.id))!.milestones[0].status).toBe("paid");
    expect(await projects.projectForEstimate(A, doc2.id)).toBeNull();
  });

  it("remembers the estimate it came from, and the project's status", async () => {
    const est = await store.createDocument(A, {
      kind: "estimate", lang: "es", customer: { name: "Ana López", company: "", email: "", phone: "" },
      business: { name: "Pintura Hernández", ownerName: "", address: "", phone: "", email: "", website: "" },
      items: [{ description: "Cocina", quantity: 1, unitPriceCents: 100, source: "said" }], state: "", taxRate: 0, dueDays: 15, reminderDays: 0,
      lateFee: { type: "none" }, paymentMethods: {}, notes: "", transcript: "",
    }, { today: "2026-10-27" });
    const p = await projects.createProject(A, input({ estimateId: est.id }));
    expect(await projects.projectForEstimate(A, est.id)).toBe(p.id);
    expect(await projects.projectForEstimate(B, est.id)).toBeNull();
    expect(await projects.setProjectStatus(B, p.id, "done")).toBe(false);
    expect(await projects.setProjectStatus(A, p.id, "done")).toBe(true);
    expect((await projects.getProject(A, p.id))!.project.status).toBe("done");
  });
});
