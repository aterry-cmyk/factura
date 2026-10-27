import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { planProject } from "@/lib/ai/plan-project";
import type { AiClient } from "@/lib/ai/parse";
import { PLAN_TOOL, planSystemPrompt, planUserMessage } from "@/lib/ai/prompts/plan-project";
import {
  canInvoice, currentMilestone, milestoneLine, moneySummary, percentDone, progressMessage, splitAmounts, templatePlan,
  validatePlan, validateProjectInput, type ChecklistItem, type Milestone,
} from "@/lib/projects";
import { validateCustomer } from "@/lib/validate";

const ms = (over: Partial<Milestone> & { id: string; position: number; amountCents: number }): Milestone => ({
  name: `M${over.position}`, status: "pending", invoiceId: null, invoiceToken: null, invoiceNumber: "", doneAt: null, ...over,
});
const item = (milestoneId: string, done: boolean, id = Math.random().toString()): ChecklistItem =>
  ({ id, milestoneId, position: 0, text: "step", doneAt: done ? "2026-10-27T00:00:00Z" : null, note: "", photoIds: [] });

describe("milestone amounts", () => {
  it("splits a total by percent into whole cents that add up exactly", () => {
    expect(splitAmounts(25_000_000, [10, 20, 40, 20, 10])).toEqual([2_500_000, 5_000_000, 10_000_000, 5_000_000, 2_500_000]);
    const odd = splitAmounts(100_001, [33, 33, 34]);
    expect(odd.reduce((a, b) => a + b, 0)).toBe(100_001);
    expect(odd).toEqual([33_000, 33_000, 34_001]);
    expect(splitAmounts(1, [50, 50])).toEqual([1, 0]);
    expect(splitAmounts(500, [])).toEqual([]);
  });
});

describe("progress and money", () => {
  const a = ms({ id: "a", position: 0, amountCents: 1000, status: "paid" });
  const b = ms({ id: "b", position: 1, amountCents: 3000, status: "invoiced" });
  const c = ms({ id: "c", position: 2, amountCents: 6000 });

  it("weights percent done by each milestone's share of the money, and steps equally inside it", () => {
    const items = [item("a", true), item("b", true), item("b", true), item("c", true), item("c", false), item("c", false), item("c", false)];
    // a: 10% × 1, b: 30% × 1, c: 60% × 1/4 = 10 + 30 + 15 = 55
    expect(percentDone([a, b, c], items)).toBe(55);
    expect(percentDone([a, b, c], [])).toBe(10); // only the paid milestone counts without steps
    expect(percentDone([], [])).toBe(0);
    const free = [ms({ id: "x", position: 0, amountCents: 0, status: "paid" }), ms({ id: "y", position: 1, amountCents: 0 })];
    expect(percentDone(free, [])).toBe(50);
  });

  it("sums paid, invoiced and still-to-invoice", () => {
    expect(moneySummary([a, b, c])).toEqual({ paid: 1000, invoiced: 3000, remaining: 6000, total: 10000 });
  });

  it("the current milestone is the first unpaid one; a milestone is invoiced once all its steps are done", () => {
    expect(currentMilestone([c, a, b])?.id).toBe("b");
    expect(currentMilestone([a])).toBeNull();
    expect(canInvoice(c, [item("c", true), item("c", true)])).toBe(true);
    expect(canInvoice(c, [item("c", true), item("c", false)])).toBe(false);
    expect(canInvoice(c, [])).toBe(true);
    expect(canInvoice(b, [])).toBe(false);
    expect(milestoneLine("Cocina de Ana", c, "es")).toBe("Cocina de Ana — hito 3: M2");
  });
});

describe("plans", () => {
  it("accepts 2 to 8 named milestones whose shares add up to 100, absorbing rounding in the last one", () => {
    const ok = validatePlan([
      { name: " Anticipo ", share_percent: 33.3, steps: ["uno", " dos "] },
      { name: "Fin", sharePercent: 66.6, steps: [] },
    ]);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value).toEqual([{ name: "Anticipo", sharePercent: 33.3, steps: ["uno", "dos"] }, { name: "Fin", sharePercent: 66.7, steps: [] }]);
  });

  it("refuses too few, unnamed, over-100 and short plans with plain reasons", () => {
    const one = validatePlan([{ name: "Solo", share_percent: 100, steps: [] }]);
    expect(one.ok).toBe(false);
    if (!one.ok) expect(one.errors[0]).toMatch(/At least 2/);
    const bad = validatePlan([{ name: "", share_percent: 60, steps: [] }, { name: "B", share_percent: 60, steps: [] }]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join(" ")).toMatch(/needs a name.*120%/);
    expect(validatePlan("nope").ok).toBe(false);
    expect(validatePlan(Array.from({ length: 9 }, (_, i) => ({ name: `M${i}`, share_percent: 11, steps: [] }))).ok).toBe(false);
  });

  it("the template adds up to 100 in both languages", () => {
    for (const lang of ["es", "en"] as const) {
      const plan = templatePlan(lang);
      expect(plan.reduce((a, m) => a + m.sharePercent, 0)).toBe(100);
      expect(plan.length).toBe(5);
    }
    expect(templatePlan("es")[0].name).toBe("Anticipo");
  });

  it("checks a whole project input: name, total in cents, customer, plan, a real estimate id", () => {
    const v = validateProjectInput({
      name: "Cocina", totalCents: 250000, customer: { name: "Ana", phone: "3015550100" }, lang: "en",
      plan: templatePlan("en"), planSource: "ai", estimateId: "not-an-id",
    }, validateCustomer);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.value).toMatchObject({ name: "Cocina", totalCents: 250000, lang: "en", planSource: "ai", estimateId: null, customer: { phone: "+13015550100" } });
    const bad = validateProjectInput({ name: "", totalCents: 12.5, customer: {}, plan: [] }, validateCustomer);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.length).toBeGreaterThanOrEqual(4);
  });
});

describe("the customer's update", () => {
  it("is written from the numbers, in the customer's language, with the next payment and the link", () => {
    const text = progressMessage({
      lang: "es", businessName: "Pintura Hernández", customerName: "Ana López", projectName: "Cocina", percent: 55,
      justDone: ["Demolición", "Plomería"], current: { name: "Acabados" },
      nextPayment: { name: "Inicio", amountText: "$5,000.00", link: "https://loro.test/i/tok" }, link: "https://loro.test/p/ptok",
    });
    expect(text).toBe([
      'Hola Ana, le escribe Pintura Hernández sobre "Cocina".',
      "Terminado hoy: Demolición, Plomería.",
      "El proyecto va al 55%.",
      "Ahora estamos en: Acabados.",
      "Siguiente pago: Inicio, $5,000.00: https://loro.test/i/tok",
      "Fotos y avance: https://loro.test/p/ptok",
    ].join("\n"));
    const en = progressMessage({ lang: "en", businessName: "B", customerName: "Ann", projectName: "P", percent: 100, justDone: [], current: null, nextPayment: null, link: "L" });
    expect(en).toBe('Hi Ann, this is B about "P".\nThe project is 100% done.\nPhotos and progress: L');
  });
});

describe("the planner", () => {
  const reply = (input: unknown, model = "claude-test"): Anthropic.Message => ({
    id: "m", type: "message", role: "assistant", model, stop_reason: "tool_use", stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 50 },
    content: [{ type: "tool_use", id: "t", name: "plan_project", input }],
  }) as unknown as Anthropic.Message;
  const good = { milestones: [
    { name: "Anticipo", share_percent: 20, steps: ["Fecha acordada"] },
    { name: "Demolición", share_percent: 30, steps: ["Proteger pisos", "Demoler", "Inspección"] },
    { name: "Entrega", share_percent: 50, steps: ["Recorrido final"] },
  ] };

  it("returns a checked plan with the model and prompt version, and records usage", async () => {
    const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const client: AiClient = { create: async (p) => { calls.push(p); return reply(good); } };
    const r = await planProject({ name: "Cocina", description: "Remodelar la cocina <script>", items: [{ description: "Gabinetes", quantity: 2 }], trade: "remodeling", lang: "es", client });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.map((m) => m.sharePercent)).toEqual([20, 30, 50]);
      expect(r.model).toBe("claude-test");
      expect(r.promptVersion).toMatch(/^plan-project@1/);
      expect(r.usage).toEqual({ input: 100, output: 50 });
    }
    expect(calls).toHaveLength(1);
    expect(calls[0].tool_choice).toEqual({ type: "tool", name: "plan_project" });
    const user = String(calls[0].messages[0].content);
    expect(user).toContain("- Gabinetes (x2)");
    expect(user).not.toContain("<script>");
    expect(String(calls[0].system)).toContain("Never write a dollar amount");
  });

  it("sends the problems back once, then gives up clearly", async () => {
    const bad = { milestones: [{ name: "Todo", share_percent: 100, steps: [] }] };
    let n = 0;
    const retry: AiClient = { create: async () => reply(n++ === 0 ? bad : good) };
    const r = await planProject({ name: "Cocina", description: "", items: [], trade: "", lang: "en", client: retry });
    expect(r.ok).toBe(true);
    expect(n).toBe(2);
    let m = 0;
    const never: AiClient = { create: async () => { m++; return reply(bad); } };
    const f = await planProject({ name: "Cocina", description: "", items: [], trade: "", lang: "en", client: never });
    expect(f.ok).toBe(false);
    if (!f.ok) expect(f.error).toMatch(/At least 2/);
    expect(m).toBe(2);
  });

  it("the prompt and tool speak the same language and never ask for amounts", () => {
    expect(planSystemPrompt("es")).toContain("Spanish");
    expect(PLAN_TOOL.input_schema.properties.milestones.items.properties.share_percent.type).toBe("integer");
    expect(JSON.stringify(PLAN_TOOL)).not.toMatch(/amount|dollar|price/i);
    expect(planUserMessage({ name: "A", description: "", items: [], trade: "" })).toContain("(none)");
  });
});
