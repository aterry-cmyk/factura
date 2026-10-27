import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { templatePlan } from "@/lib/projects";
import { layoutSchedule } from "@/lib/schedule";

// Clients, the schedule, the proposal and the estimate it becomes, against a real Postgres.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("control center", () => {
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
    await db`truncate price_lookups, project_costs, project_budgets, workers, project_events, project_photos, checklist_items, milestones, projects, events, documents, customers, usage_events, sessions, memberships, users, accounts restart identity cascade`;
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
    await db`insert into settings (account_id, business_name, markup_percent) values (${a.id}, ${name}, 25)`;
    return String(a.id);
  }
  const input = (over: Record<string, unknown> = {}) => ({
    name: "Cocina de Ana", description: "Remodelar la cocina", lang: "es" as const,
    customer: { name: "Ana López", company: "", email: "ana@example.com", phone: "+13015550100" },
    totalCents: 1_000_000, estimateId: null, plan: templatePlan("es"), planSource: "template" as const, ...over,
  });

  it("lists clients with their counts and money, and an edit follows through to the project", async () => {
    const p = await projects.createProject(A, input());
    await projects.createProject(B, input({ customer: { name: "Otro", company: "", email: "", phone: "" } }));
    const list = await projects.listClients(A);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Ana López", projects: 1, documents: 0, owedCents: 0, paidCents: 0 });
    const client = (await projects.getClient(A, list[0].id))!;
    expect(await projects.getClient(B, client.id)).toBeNull();
    expect(await projects.updateClient(B, client.id, { name: "X", company: "", email: "", phone: "", address: "", notes: "" })).toBeNull();
    const updated = await projects.updateClient(A, client.id, { name: "Ana López", company: "Casa Ana", email: "ana@example.com", phone: "+13015550100", address: "12 Elm St", notes: "Llegó por Marco" });
    expect(updated).toMatchObject({ address: "12 Elm St", notes: "Llegó por Marco", company: "Casa Ana" });
    expect((await projects.getProject(A, p.id))!.project.customer.company).toBe("Casa Ana");
    expect((await projects.clientProjects(A, client.id)).map((x) => x.id)).toEqual([p.id]);
    expect(await store.getSettings(A)).toMatchObject({ markupPercent: 25, contingencyPercent: 0 });
    await store.setPricing(A, { markupPercent: 30, contingencyPercent: 5 });
    expect(await store.getSettings(A)).toMatchObject({ markupPercent: 30, contingencyPercent: 5 });
  });

  it("keeps the schedule's dates per milestone and the start on the project", async () => {
    const p = await projects.createProject(A, input());
    let view = (await projects.getProject(A, p.id))!;
    expect(view.milestones.map((m) => m.days)).toEqual([1, 3, 10, 4, 1]);
    const dated = layoutSchedule(view.milestones.map((m) => ({ id: m.id, position: m.position, days: m.position === 2 ? 7 : m.days })), "2026-11-02");
    expect(await projects.saveSchedule(B, p.id, "2026-11-02", dated)).toBe(false);
    expect(await projects.saveSchedule(A, p.id, "2026-11-02", dated)).toBe(true);
    view = (await projects.getProject(A, p.id))!;
    expect(view.project.startsOn).toBe("2026-11-02");
    expect(view.milestones.map((m) => [m.days, m.startsOn, m.endsOn])).toEqual([[1, "2026-11-02", "2026-11-02"], [3, "2026-11-03", "2026-11-05"], [7, "2026-11-06", "2026-11-12"], [4, "2026-11-13", "2026-11-16"], [1, "2026-11-17", "2026-11-17"]]);
    expect((await projects.listProjectEvents(p.id))[0]).toMatchObject({ kind: "scheduled", detail: "2026-11-02" });
  });

  it("saves the proposal, and the estimate made from it re-splits the milestones while nothing is invoiced", async () => {
    const p = await projects.createProject(A, input());
    const proposal = { summary: "s", sections: [{ title: "A", lines: [{ key: "a", description: "d", quantity: 1, unit: "LS" as const, unitCostCents: 100000, source: "typed" as const, basis: "", confirmed: true, quantityGiven: true }] }], markupPercent: 25, contingencyPercent: 0, answers: [], updatedAt: "now" };
    expect(await projects.saveProposal(B, p.id, proposal)).toBe(false);
    expect(await projects.saveProposal(A, p.id, proposal)).toBe(true);
    expect(await projects.getProposal(A, p.id)).toEqual(proposal);
    expect(await projects.getProposal(B, p.id)).toBeNull();

    const est = await store.createDocument(A, {
      kind: "estimate", lang: "es", customer: input().customer, business: { name: "Pintura Hernández", ownerName: "", address: "", phone: "", email: "", website: "" },
      items: [{ description: "A: d", quantity: 1, unitPriceCents: 125000, source: "typed" }], state: "", taxRate: 0, dueDays: 15, reminderDays: 0, lateFee: { type: "none" }, paymentMethods: {}, notes: "", transcript: "",
    }, { today: "2026-10-27" });
    expect(await projects.adoptEstimate(A, p.id, est.id, est.totalCents)).toEqual({ resplit: true });
    let view = (await projects.getProject(A, p.id))!;
    expect(view.project).toMatchObject({ estimateId: est.id, totalCents: 125000 });
    expect(view.milestones.map((m) => m.amountCents)).toEqual([12500, 25000, 50000, 25000, 12500]);

    // Once a milestone is invoiced the amounts stay; only the total and the estimate change.
    await projects.invoiceMilestone(A, view, view.milestones[0].id, await store.getSettings(A), "2026-10-27");
    expect(await projects.adoptEstimate(A, p.id, est.id, 200000)).toEqual({ resplit: false });
    view = (await projects.getProject(A, p.id))!;
    expect(view.project.totalCents).toBe(200000);
    expect(view.milestones.map((m) => m.amountCents)).toEqual([12500, 25000, 50000, 25000, 12500]);
  });
});
