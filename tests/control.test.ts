import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import type { AiClient } from "@/lib/ai/parse";
import { buildProposal, checkProposal, numbersIn, scopeQuestions } from "@/lib/ai/proposal";
import { proposalSystemPrompt, questionsSystemPrompt } from "@/lib/ai/prompts/proposal";
import { searchOnebuild } from "@/lib/prices/onebuild";
import { proposalItems, proposalProblems, proposalTotals, scopeText, validateProposal, type Proposal } from "@/lib/proposal";
import { templatePlan, validatePlan } from "@/lib/projects";
import { layoutSchedule, scheduleSpan, scheduleStatus, validateSchedule } from "@/lib/schedule";

const msg = (name: string, input: unknown) =>
  ({ id: "m", type: "message", role: "assistant", model: "claude-test", stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "tool_use", id: "t", name, input }] }) as unknown as Anthropic.Message;
const script = (...answers: Anthropic.Message[]) => {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: AiClient = { create: async (p) => { calls.push(p); return answers.shift()!; } };
  return { client, calls };
};

const line = (over: Record<string, unknown> = {}) => ({ key: "a", description: "Quitar gabinetes viejos", quantity: 1, unit: "LS", unitCostCents: 40000, source: "suggested", basis: "x", confirmed: true, quantityGiven: true, ...over });
const sample = (): Proposal => ({
  summary: "Cocina nueva.", answers: [{ question: "¿Cuántos pies?", answer: "120" }], updatedAt: "",
  markupPercent: 25, contingencyPercent: 10,
  sections: [
    { title: "Demolición", lines: [line() as never] },
    { title: "Piso", lines: [line({ key: "b", description: "Porcelanato instalado", quantity: 120, unit: "SF", unitCostCents: 1250, source: "price" }) as never] },
  ],
});

describe("the proposal", () => {
  it("totals cost, markup on cost, contingency on the price, and says what still needs the owner", () => {
    const t = proposalTotals(sample());
    expect(t).toEqual({ costCents: 190000, markupCents: 47500, contingencyCents: 23750, totalCents: 261250, unpriced: 0, unconfirmed: 0 });
    const p = sample();
    p.sections[0].lines[0].confirmed = false;
    p.sections[1].lines[0].unitCostCents = 0;
    expect(proposalTotals(p)).toMatchObject({ unpriced: 1, unconfirmed: 1 });
    expect(proposalProblems(p, "es")).toEqual(["1 línea(s) sin precio.", "1 línea(s) sin confirmar."]);
    expect(proposalProblems(sample(), "en")).toEqual([]);
  });

  it("becomes estimate lines with the markup folded in and one contingency line; the scope goes to the notes", () => {
    const items = proposalItems(sample(), "es");
    expect(items).toEqual([
      { description: "Demolición: Quitar gabinetes viejos (1 global)", quantity: 1, unitPriceCents: 50000, source: "typed" },
      { description: "Piso: Porcelanato instalado (120 pie²)", quantity: 1, unitPriceCents: 187500, source: "typed" },
      { description: "Contingencia (10%)", quantity: 1, unitPriceCents: 23750, source: "typed" },
    ]);
    expect(items.reduce((a, i) => a + i.unitPriceCents, 0)).toBe(261250);
    expect(scopeText(sample(), "en")).toBe("Scope of work\nCocina nueva.\nDemolición: Quitar gabinetes viejos\nPiso: Porcelanato instalado");
  });

  it("checks what the screen sends back: a confirmed line needs a price, unknown units and sources are normalised", () => {
    const v = validateProposal({ summary: " x ", sections: [{ title: "A", lines: [{ description: "d", quantity: "2", unit: "ZZ", unitCostCents: "", source: "price", confirmed: true }] }], markupPercent: "20", contingencyPercent: "", answers: [{ question: "q", answer: "a" }, { question: "", answer: "b" }] }, "2026-10-27T00:00:00Z");
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.value.sections[0].lines[0]).toMatchObject({ quantity: 2, unit: "EA", unitCostCents: 0, source: "none", confirmed: false });
      expect(v.value.markupPercent).toBe(20);
      expect(v.value.answers).toEqual([{ question: "q", answer: "a" }]);
    }
    const bad = validateProposal({ sections: [{ title: "", lines: [{ description: "", quantity: 0, unitCostCents: 1.5 }] }], markupPercent: 500 }, "x");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors).toHaveLength(5);
  });
});

describe("the proposal builder", () => {
  const catalog = [{ description: "Pintar cocina", unitPriceCents: 220000 }];
  it("keeps a history cost only when it matches the owner's catalog exactly, and marks quantities Loro read", () => {
    const r = checkProposal({ summary: "ok", sections: [{ title: "Pintura", lines: [
      { description: "Pintar cocina", quantity: 1, unit: "LS", unit_cost: 2200, cost_source: "history", basis: "igual que antes" },
      { description: "Pintar cocina", quantity: 1, unit: "LS", unit_cost: 1900, cost_source: "history", basis: "igual que antes" },
      { description: "Pintar sala", quantity: 320, unit: "SF", unit_cost: 2.5, cost_source: "suggested", basis: "típico" },
      { description: "Sin precio", quantity: 2, unit: "EA", unit_cost: 0, cost_source: "suggested", basis: "" },
    ] }] }, "pintar la cocina y la sala de 320 pies", catalog);
    expect(r.errors).toEqual([]);
    const lines = r.value!.sections[0].lines;
    expect(lines[0]).toMatchObject({ source: "history", unitCostCents: 220000, confirmed: true });
    expect(lines[1]).toMatchObject({ source: "suggested", unitCostCents: 190000, confirmed: false });
    expect(lines[1].basis).toMatch(/no coincide/);
    expect(lines[2]).toMatchObject({ source: "suggested", unitCostCents: 250, quantityGiven: true });
    expect(lines[3]).toMatchObject({ source: "none", quantityGiven: false });
    expect(numbersIn("2,200 y 3.5 pies")).toEqual(new Set([2200, 3.5]));
    expect(checkProposal({ sections: [] }, "", []).errors).toContain("no sections with lines");
  });

  it("asks only new questions, says when it is ready, and builds with one retry", async () => {
    const q = script(msg("ask_scope", { ready: false, questions: [{ question: "¿Cuántos pies cuadrados?", options: ["100", "200", "300"] }, { question: "¿Incluye demolición?", options: ["Sí", "No"] }, { question: "¿Qué?", options: ["x"] }] }));
    const r = await scopeQuestions({ name: "Cocina", description: "remodelar", trade: "remodeling", answers: [{ question: "¿Incluye demolición?", answer: "Sí" }], lang: "es", client: q.client });
    expect(r).toMatchObject({ ok: true, ready: false });
    if (r.ok) expect(r.questions).toEqual([{ question: "¿Cuántos pies cuadrados?", options: ["100", "200", "300"] }]);
    expect(String(q.calls[0].system)).toContain("Never ask about the price");
    expect(questionsSystemPrompt("en")).toContain("at most 5 questions");
    const ready = await scopeQuestions({ name: "C", description: "d", trade: "", answers: [], lang: "es", client: script(msg("ask_scope", { ready: true, questions: [] })).client });
    expect(ready).toMatchObject({ ok: true, ready: true, questions: [] });

    let n = 0;
    const b = script(msg("record_proposal", { summary: "", sections: [] }), msg("record_proposal", { summary: "Listo", sections: [{ title: "A", lines: [{ description: "d", quantity: 1, unit: "LS", unit_cost: 100, cost_source: "suggested", basis: "b" }] }] }));
    const built = await buildProposal({ name: "C", description: "d", trade: "", answers: [], lang: "es", catalog, client: { create: async (p) => { n++; return b.client.create(p); } } });
    expect(built.ok).toBe(true);
    expect(n).toBe(2);
    if (built.ok) expect(built.value.sections[0].lines[0].unitCostCents).toBe(10000);
    expect(proposalSystemPrompt("es")).toContain("No tax, no markup, no contingency lines");
  });
});

describe("the schedule", () => {
  it("lays milestones end to end from the start, keeps each one's days, and reads the calendar against the work", () => {
    const laid = layoutSchedule([{ id: "b", position: 1, days: 3 }, { id: "a", position: 0, days: null }], "2026-11-02");
    expect(laid.map((m) => [m.id, m.startsOn, m.endsOn, m.days])).toEqual([["a", "2026-11-02", "2026-11-06", 5], ["b", "2026-11-07", "2026-11-09", 3]]);
    const span = scheduleSpan(laid)!;
    expect(span).toEqual({ startsOn: "2026-11-02", endsOn: "2026-11-09", days: 8 });
    expect(scheduleStatus(span, "2026-11-05", 10)).toEqual({ expectedPercent: 50, behind: true, daysLeft: 4 });
    expect(scheduleStatus(span, "2026-11-05", 45)).toMatchObject({ behind: false });
    expect(scheduleSpan([{ startsOn: null, endsOn: null }])).toBeNull();
    expect(validateSchedule({ startsOn: "2026-11-02", milestones: [{ id: "11111111-1111-1111-1111-111111111111", days: 4 }, { id: "x", days: 2 }] })).toEqual({ ok: true, value: { startsOn: "2026-11-02", milestones: [{ id: "11111111-1111-1111-1111-111111111111", days: 4 }] } });
    expect(validateSchedule({ startsOn: "bad", milestones: [{ id: "11111111-1111-1111-1111-111111111111", days: 0 }] }).ok).toBe(false);
  });

  it("the planner's days ride along on the plan", () => {
    const v = validatePlan([{ name: "A", share_percent: 50, steps: [], days: 4 }, { name: "B", share_percent: 50, steps: [], days: 999 }]);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.value.map((m) => m.days)).toEqual([4, undefined]);
    expect(templatePlan("en").map((m) => m.days)).toEqual([1, 3, 10, 4, 1]);
  });
});

describe("1build", () => {
  it("asks the gateway by zip with the key in the header, and keeps rates with a unit price", async () => {
    process.env.ONEBUILD_API_KEY = "1build_ext.test";
    const f = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("1build-api-key")).toBe("1build_ext.test");
      const body = JSON.parse(String(init?.body));
      expect(body.variables.input).toMatchObject({ sourceType: "MATERIAL", zipcode: "20705", searchTerm: "drywall", page: { limit: 5 } });
      return new Response(JSON.stringify({ data: { sources: { nodes: [
        { id: "1", name: "Drywall 1/2 4x8", uom: "EA", materialRateUsdCents: 1598, laborRateUsdCents: 2121, burdenedLaborRateUsdCents: 3147, calculatedUnitRateUsdCents: 1733, externalProductUrl: "https://www.homedepot.com/p/x" },
        { id: "2", name: "No rate", uom: "EA", calculatedUnitRateUsdCents: 0 },
      ], dataLocation: { countyName: "Prince George's County", stateName: "Maryland" } } } }), { status: 200 });
    });
    const r = await searchOnebuild({ query: "drywall", zip: "20705", state: "MD" }, f as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, options: [{ id: "1", name: "Drywall 1/2 4x8", unit: "EA", materialCents: 1598, laborCents: 2121, burdenedLaborCents: 3147, unitRateCents: 1733, url: "https://www.homedepot.com/p/x", county: "Prince George's County", state: "Maryland" }] });
    const bad = await searchOnebuild({ query: "x", zip: "", state: "MD" }, (async () => new Response(JSON.stringify({ errors: [{ message: "unauthorized" }] }), { status: 401 })) as unknown as typeof fetch);
    expect(bad).toMatchObject({ ok: false, error: "failed", detail: "1build 401: unauthorized" });
    delete process.env.ONEBUILD_API_KEY;
    expect(await searchOnebuild({ query: "x", zip: "", state: "" })).toEqual({ ok: false, error: "setup" });
  });
});
