import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { templatePlan } from "@/lib/projects";

// Costs, budgets, the crew and price lookups against a real Postgres (TEST_DATABASE_URL; wiped).
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("costs", () => {
  let store: typeof import("@/lib/store");
  let projects: typeof import("@/lib/projects-store");
  let costs: typeof import("@/lib/costs-store");
  const db = url ? postgres(url, { max: 1, onnotice: () => {} }) : null!;
  let A = "";
  let B = "";
  let P = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    await db.unsafe(readFileSync("db/schema.sql", "utf8"));
    store = await import("@/lib/store");
    projects = await import("@/lib/projects-store");
    costs = await import("@/lib/costs-store");
  });
  beforeEach(async () => {
    await db`truncate price_lookups, project_costs, project_budgets, workers, project_events, project_photos, checklist_items, milestones, projects, events, documents, customers, usage_events, sessions, memberships, users, accounts restart identity cascade`;
    await db`delete from settings`;
    A = await newAccount("Pintura Hernández");
    B = await newAccount("Techos López");
    P = (await projects.createProject(A, {
      name: "Cocina de Ana", description: "", lang: "es", customer: { name: "Ana López", company: "", email: "", phone: "" },
      totalCents: 2_500_000, estimateId: null, plan: templatePlan("es"), planSource: "template",
    })).id;
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

  it("keeps the crew and the burden per business", async () => {
    const pedro = await costs.addWorker(A, { name: "Pedro", role: "journeyman", hourlyCents: 2800, active: true });
    await costs.addWorker(B, { name: "Otro", role: "laborer", hourlyCents: 1000, active: true });
    expect((await costs.listWorkers(A)).map((w) => w.name)).toEqual(["Pedro"]);
    expect(await costs.updateWorker(B, pedro.id, { name: "X", role: "other", hourlyCents: 1, active: true })).toBeNull();
    expect((await costs.updateWorker(A, pedro.id, { name: "Pedro R.", role: "foreman", hourlyCents: 3200, active: true }))?.hourlyCents).toBe(3200);
    expect(await costs.getBurden(A)).toEqual({ workersComp: 0, liability: 0, payrollTax: 0 });
    await costs.setBurden(A, { workersComp: 9.58, liability: 2.5, payrollTax: 14 });
    expect(await costs.getBurden(A)).toEqual({ workersComp: 9.58, liability: 2.5, payrollTax: 14 });
    expect(await costs.getBurden(B)).toEqual({ workersComp: 0, liability: 0, payrollTax: 0 });
    // A worker with logged hours is kept inactive; one without is removed.
    await costs.addCost(A, P, { code: "labor", amountCents: 28240, description: "Jornada", vendor: "", spentOn: "2026-10-27", source: "voice", workerId: pedro.id, hours: 8 });
    expect(await costs.removeWorker(A, pedro.id)).toBe(true);
    expect((await costs.listWorkers(A))[0]).toMatchObject({ name: "Pedro R.", active: false });
    expect(await costs.listWorkers(A, true)).toEqual([]);
    const luis = await costs.addWorker(A, { name: "Luis", role: "laborer", hourlyCents: 1800, active: true });
    expect(await costs.removeWorker(A, luis.id)).toBe(true);
    expect((await costs.listWorkers(A)).map((w) => w.name)).toEqual(["Pedro R."]);
  });

  it("budgets and costs belong to the project's business; money received comes from paid milestones", async () => {
    expect(await costs.setBudgets(B, P, { labor: 1, materials: 0, subs: 0, other: 0 })).toBe(false);
    expect(await costs.setBudgets(A, P, { labor: 900000, materials: 400000, subs: 0, other: 50000 })).toBe(true);
    expect(await costs.getBudgets(P)).toEqual({ labor: 900000, materials: 400000, subs: 0, other: 50000 });
    await costs.setBudgets(A, P, { labor: 950000, materials: 400000, subs: 0, other: 50000 });
    expect((await costs.getBudgets(P)).labor).toBe(950000);

    expect(await costs.addCost(B, P, { code: "materials", amountCents: 1, description: "", vendor: "", spentOn: "2026-10-27", source: "typed", workerId: null, hours: null })).toBeNull();
    const c1 = (await costs.addCost(A, P, { code: "materials", amountCents: 34000, description: "Pintura interior", vendor: "Home Depot", spentOn: "2026-10-20", source: "receipt", workerId: null, hours: null }))!;
    const c2 = (await costs.addCost(A, P, { code: "labor", amountCents: 50000, description: "Jornada", vendor: "", spentOn: "2026-10-27", source: "voice", workerId: "33333333-3333-3333-3333-333333333333", hours: 8 }))!;
    expect(c2.workerId).toBeNull(); // an unknown worker id is dropped, not trusted
    expect((await costs.listCosts(P)).map((c) => c.id)).toEqual([c2.id, c1.id]);
    expect(await costs.ownPrices(A, "pintura")).toMatchObject([{ description: "Pintura interior", vendor: "Home Depot", amountCents: 34000, project: "Cocina de Ana" }]);
    expect(await costs.ownPrices(B, "pintura")).toEqual([]);
    expect(await costs.removeCost(B, P, c1.id)).toBe(false);
    expect(await costs.removeCost(A, P, c1.id)).toBe(true);
    expect(await costs.listCosts(P)).toHaveLength(1);

    const view = (await projects.getProject(A, P))!;
    const settings = await store.getSettings(A);
    const doc = (await projects.invoiceMilestone(A, view, view.milestones[0].id, settings, "2026-10-27"))!;
    await store.setStatus(A, doc.id, "paid");
    const pay = await costs.paymentsOf(P);
    expect(pay).toHaveLength(1);
    expect(pay[0]).toMatchObject({ amountCents: 250000, name: "Anticipo" });
    expect(pay[0].day).toBe(new Date().toISOString().slice(0, 10));
    const months = await costs.businessMonths(A, "2026-01-01");
    const thisMonth = months.find((m) => m.month === new Date().toISOString().slice(0, 7))!;
    expect(thisMonth).toMatchObject({ receivedCents: 250000 });
    expect(months.reduce((a, m) => a + m.spentCents, 0)).toBe(50000);
    expect(await costs.businessMonths(B, "2026-01-01")).toEqual([]);
  });

  it("remembers price lookups per business", async () => {
    const opt = { vendor: "Home Depot", product: "Drywall", priceCents: 1598, unit: "per sheet", url: "https://www.homedepot.com/p/1", where: "" };
    await costs.saveLookup(A, "drywall 1/2", [opt]);
    expect(await costs.recentLookups(A)).toMatchObject([{ query: "drywall 1/2", results: [opt] }]);
    expect(await costs.recentLookups(B)).toEqual([]);
  });
});
