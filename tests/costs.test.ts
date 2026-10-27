import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { checkCosts, checkPrices, isPdf, readPlans, readReceipt, recordCosts, searchedUrls, searchPrices, takeoffText } from "@/lib/ai/costs";
import type { AiClient } from "@/lib/ai/parse";
import { costSystemPrompt, plansSystemPrompt, pricesSystemPrompt } from "@/lib/ai/prompts/costs";
import {
  burdenedHourlyCents, burdenPercent, manDayCents, periodKey, periodLabel, projectPnl, rollup, signalText, validateBudgets, validateBurden, validateCost,
  validateWorker, type Worker,
} from "@/lib/costs";
import { formatMoney } from "@/lib/money";

const pedro: Worker = { id: "11111111-1111-1111-1111-111111111111", name: "Pedro", role: "journeyman", hourlyCents: 2800, active: true };
const luis: Worker = { id: "22222222-2222-2222-2222-222222222222", name: "Luis", role: "laborer", hourlyCents: 1800, active: true };
const burden = { workersComp: 9.58, liability: 2.5, payrollTax: 14 };
const TODAY = "2026-10-27";

const msg = (content: unknown[], model = "claude-test") =>
  ({ id: "m", type: "message", role: "assistant", model, stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 }, content }) as unknown as Anthropic.Message;
const tool = (name: string, input: unknown) => msg([{ type: "tool_use", id: "t", name, input }]);
const script = (...answers: Anthropic.Message[]) => {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: AiClient = { create: async (p) => { calls.push(p); return answers.shift()!; } };
  return { client, calls };
};

describe("wages and burden", () => {
  it("adds the owner's burden to the wage, like Franklin's sheet", () => {
    expect(burdenPercent(burden)).toBeCloseTo(26.08);
    expect(burdenedHourlyCents(pedro, burden)).toBe(3530); // $28 × 1.2608 = $35.30
    expect(manDayCents(pedro, burden)).toBe(28240);
    expect(burdenedHourlyCents(pedro, { workersComp: 0, liability: 0, payrollTax: 0 })).toBe(2800);
  });

  it("checks workers, burden and budgets", () => {
    expect(validateWorker({ name: " Pedro ", role: "journeyman", hourlyCents: 2800 })).toEqual({ ok: true, value: { name: "Pedro", role: "journeyman", hourlyCents: 2800, active: true } });
    expect(validateWorker({ name: "", hourlyCents: -1 }).ok).toBe(false);
    expect(validateWorker({ name: "X", role: "boss", hourlyCents: 100 })).toMatchObject({ ok: true, value: { role: "other" } });
    expect(validateBurden({ workersComp: "9.58", liability: 2.5 })).toEqual({ ok: true, value: { workersComp: 9.58, liability: 2.5, payrollTax: 0 } });
    expect(validateBurden({ payrollTax: 120 }).ok).toBe(false);
    expect(validateBudgets({ labor: 900000, materials: "40000" })).toEqual({ ok: true, value: { labor: 900000, materials: 40000, subs: 0, other: 0 } });
    expect(validateBudgets({ labor: 12.5 }).ok).toBe(false);
    const c = validateCost({ code: "materials", amountCents: 34000, description: "Pintura", vendor: "Home Depot", spentOn: "2026-10-20", source: "voice", hours: "" }, TODAY);
    expect(c).toMatchObject({ ok: true, value: { code: "materials", amountCents: 34000, spentOn: "2026-10-20", source: "voice", hours: null, workerId: null } });
    expect(validateCost({ code: "food", amountCents: 1 }, TODAY).ok).toBe(false);
    expect(validateCost({ code: "labor", amountCents: 100, spentOn: "bad" }, TODAY)).toMatchObject({ ok: true, value: { spentOn: TODAY } });
  });
});

describe("the P&L", () => {
  const budgets = { labor: 900000, materials: 400000, subs: 0, other: 50000 };
  const costs = [
    { code: "labor" as const, amountCents: 500000, spentOn: "2026-10-05" },
    { code: "labor" as const, amountCents: 520000, spentOn: "2026-10-12" },
    { code: "materials" as const, amountCents: 150000, spentOn: "2026-10-12" },
  ];
  const milestones = [{ amountCents: 250000, status: "paid" as const }, { amountCents: 500000, status: "invoiced" as const }, { amountCents: 1750000, status: "pending" as const }];

  it("compares estimate with actual, projects the margin from the progress, and names the one thing to look at", () => {
    const pnl = projectPnl({ contractCents: 2500000, budgets, costs, milestones, percentDone: 50 });
    expect(pnl.rows.find((r) => r.code === "labor")).toEqual({ code: "labor", estimatedCents: 900000, spentCents: 1020000, remainingCents: -120000, percentOfEstimate: 113 });
    expect(pnl.rows.find((r) => r.code === "subs")?.percentOfEstimate).toBeNull();
    expect(pnl.spentCents).toBe(1170000);
    expect(pnl.income).toEqual({ contractCents: 2500000, paidCents: 250000, invoicedCents: 500000, remainingCents: 1750000 });
    expect(pnl.margin.estimatedCents).toBe(2500000 - 1350000);
    expect(pnl.margin.soFarCents).toBe(250000 - 1170000);
    // Half done and $11,700 spent → $23,400 projected spend → $1,600 margin.
    expect(pnl.margin.projectedCents).toBe(2500000 - 2340000);
    expect(pnl.margin.projectedPercent).toBe(6);
    expect(pnl.signal).toEqual({ code: "labor", overCents: 120000 });
    expect(signalText(pnl, "es", (c) => formatMoney(c, "es"))).toBe("Mano de obra va $1,200.00 por encima de lo estimado.");
    expect(signalText(pnl, "en", (c) => formatMoney(c, "en"))).toBe("Labor is $1,200.00 over the estimate.");
  });

  it("with nothing done yet the projection is the budget; with nothing over there is no signal", () => {
    const pnl = projectPnl({ contractCents: 1000000, budgets: { labor: 300000, materials: 200000, subs: 0, other: 0 }, costs: [], milestones: [], percentDone: 0 });
    expect(pnl.margin.projectedCents).toBe(500000);
    expect(pnl.signal).toBeNull();
    expect(signalText(pnl, "es", String)).toBeNull();
  });

  it("rolls spend and payments up by day, week (Monday) and month, newest first", () => {
    expect(periodKey("2026-10-27", "day")).toBe("2026-10-27");
    expect(periodKey("2026-10-27", "week")).toBe("2026-10-26");
    expect(periodKey("2026-10-26", "week")).toBe("2026-10-26");
    expect(periodKey("2026-10-25", "week")).toBe("2026-10-19");
    expect(periodKey("2026-10-27", "month")).toBe("2026-10");
    const rows = rollup(costs, [{ day: "2026-10-06", amountCents: 250000 }], "week");
    expect(rows.map((r) => r.key)).toEqual(["2026-10-12", "2026-10-05"]);
    expect(rows[1]).toMatchObject({ spentCents: 500000, receivedCents: 250000, spent: { labor: 500000, materials: 0 } });
    expect(rows[0]).toMatchObject({ spentCents: 670000, receivedCents: 0 });
    expect(rollup(costs, [], "month")).toHaveLength(1);
    expect(periodLabel("2026-10", "month", "en")).toBe("October 2026");
    expect(periodLabel("2026-10-26", "week", "es")).toMatch(/^Semana del 26/);
  });
});

describe("what he said he spent", () => {
  it("trusts an amount only when it was said, computes labor from said hours and the crew's wage, and flags the rest", () => {
    const text = "Hoy trabajaron Pedro y Luis 8 horas, y 340 de pintura en Home Depot, y el plomero cobró como 600";
    const entries = checkCosts({ entries: [
      { code: "labor", amount: 0, description: "Jornada", vendor: "", worker: "pedro", hours: 8, spent_on: TODAY },
      { code: "labor", amount: 0, description: "Jornada", vendor: "", worker: "Luis", hours: 8, spent_on: TODAY },
      { code: "materials", amount: 340, description: "Pintura", vendor: "Home Depot", worker: "", hours: 0, spent_on: "2026-10-26" },
      { code: "subs", amount: 650, description: "Plomero", vendor: "", worker: "", hours: 0, spent_on: "2030-01-01" },
      { code: "labor", amount: 0, description: "Ayudante", vendor: "", worker: "Mario", hours: 8, spent_on: TODAY },
    ] }, text, [pedro, luis], burden, TODAY);
    expect(entries).toHaveLength(5);
    expect(entries[0]).toMatchObject({ code: "labor", amountCents: 28240, workerId: pedro.id, workerName: "Pedro", hours: 8, needsConfirm: false, basis: "8 h × Pedro" });
    expect(entries[1]).toMatchObject({ amountCents: Math.round(burdenedHourlyCents(luis, burden) * 8), needsConfirm: false });
    expect(entries[2]).toMatchObject({ code: "materials", amountCents: 34000, vendor: "Home Depot", spentOn: "2026-10-26", needsConfirm: false, basis: "said" });
    // 650 was never said → kept, flagged; a future date → today.
    expect(entries[3]).toMatchObject({ code: "subs", amountCents: 65000, needsConfirm: true, basis: "unverified", spentOn: TODAY });
    // Mario isn't on the crew: no wage to compute from → flagged with no amount.
    expect(entries[4]).toMatchObject({ amountCents: 0, workerId: null, workerName: "Mario", needsConfirm: true });
  });

  it("asks the model with the crew's names and returns the entries; nothing found is a clear answer", async () => {
    const { client, calls } = script(tool("record_costs", { entries: [{ code: "materials", amount: 42.5, description: "Tornillos", vendor: "Lowe's", worker: "", hours: 0, spent_on: TODAY }] }));
    const r = await recordCosts({ text: "42.50 de tornillos en Lowe's", workers: [pedro], burden, lang: "es", today: TODAY, client });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entries[0]).toMatchObject({ amountCents: 4250, needsConfirm: false });
    expect(String(calls[0].system)).toContain("Pedro");
    expect(String(calls[0].system)).toContain("Never add, total, round or guess an amount");
    expect(costSystemPrompt("en", [], TODAY)).toContain("(no crew yet)");
    const none = await recordCosts({ text: "hola", workers: [], burden, lang: "es", today: TODAY, client: script(tool("record_costs", { entries: [] })).client });
    expect(none).toMatchObject({ ok: false, error: "nothing_found" });
    expect(await recordCosts({ text: "  ", workers: [], burden, lang: "es", today: TODAY, client })).toMatchObject({ ok: false, error: "empty" });
  });
});

describe("receipts and plans", () => {
  const photo = { type: "image/jpeg" as const, base64: "abc" };

  it("reads a receipt's vendor, date, total and lines; a photo with no total is unreadable", async () => {
    const { client } = script(tool("record_receipt", { readable: true, vendor: "Home Depot", date: "2026-10-20", total: 184.32, lines: [{ description: "Drywall 1/2", amount: 120 }, { description: "", amount: 5 }] }));
    const r = await readReceipt({ photo, lang: "es", client });
    expect(r).toMatchObject({ ok: true, value: { vendor: "Home Depot", date: "2026-10-20", totalCents: 18432, lines: [{ description: "Drywall 1/2", amountCents: 12000 }] } });
    const bad = await readReceipt({ photo, lang: "es", client: script(tool("record_receipt", { readable: false, vendor: "", date: "", total: 0, lines: [] })).client });
    expect(bad).toMatchObject({ ok: false, error: "unreadable" });
  });

  it("takes quantities off a PDF, with units it knows, and turns them into lines for the estimate", async () => {
    expect(isPdf(new TextEncoder().encode("%PDF-1.7 x"))).toBe(true);
    expect(isPdf(new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0]))).toBe(false);
    const { client, calls } = script(tool("record_takeoff", { readable: true, summary: "Planos de una casa de dos pisos", lines: [
      { item: "Piso de madera", quantity: 320, unit: "SF", where: "A-2, sala 16×20" },
      { item: "Zoclo", quantity: 72, unit: "LF", where: "A-2" },
      { item: "Puertas interiores", quantity: 6, unit: "EA", where: "Tabla de puertas" },
      { item: "Algo", quantity: 10, unit: "KG", where: "" },
    ] }));
    const r = await readPlans({ pdfBase64: "JVBERi0=", lang: "es", client });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lines).toHaveLength(3);
      expect(takeoffText(r.lines)).toBe("Piso de madera — 320 SF (A-2, sala 16×20)\nZoclo — 72 LF (A-2)\nPuertas interiores — 6 EA (Tabla de puertas)");
    }
    const content = calls[0].messages[0].content as Anthropic.ContentBlockParam[];
    expect(content[0]).toMatchObject({ type: "document", source: { type: "base64", media_type: "application/pdf" } });
    expect(plansSystemPrompt("es")).toContain("Never guess a quantity");
    const none = await readPlans({ pdfBase64: "x", lang: "es", client: script(tool("record_takeoff", { readable: false, summary: "", lines: [] })).client });
    expect(none).toMatchObject({ ok: false, error: "unreadable" });
  });
});

describe("prices on the web", () => {
  const searched = msg([
    { type: "server_tool_use", id: "s", name: "web_search", input: { query: "drywall" } },
    { type: "web_search_tool_result", tool_use_id: "s", content: [
      { type: "web_search_result", url: "https://www.homedepot.com/p/drywall-123", title: "Drywall", encrypted_content: "x", page_age: null },
      { type: "web_search_result", url: "https://www.lowes.com/pd/drywall-456", title: "Drywall", encrypted_content: "x", page_age: null },
    ] },
    { type: "tool_use", id: "t", name: "record_prices", input: { options: [
      { vendor: "Home Depot", product: "1/2 in. x 4 ft. x 8 ft. Drywall", price: 15.98, unit: "per sheet", url: "https://www.homedepot.com/p/drywall-123", where: "Beltsville" },
      { vendor: "Lowe's", product: "Drywall 1/2", price: 14.5, unit: "per sheet", url: "https://www.lowes.com/pd/drywall-789", where: "online" },
      { vendor: "Somewhere", product: "Drywall", price: 9, unit: "each", url: "https://made-up.example/drywall", where: "" },
    ] } },
  ]);

  it("keeps only prices from pages the search actually returned (or their site)", () => {
    const seen = searchedUrls(searched);
    expect([...seen]).toHaveLength(2);
    const call = searched.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")!;
    const options = checkPrices(call.input, seen);
    expect(options.map((o) => o.vendor)).toEqual(["Home Depot", "Lowe's"]);
    expect(options[0]).toMatchObject({ priceCents: 1598, unit: "per sheet", url: "https://www.homedepot.com/p/drywall-123" });
  });

  it("sends the web search tool and the recorder, and says so when search isn't enabled", async () => {
    const { client, calls } = script(searched);
    const r = await searchPrices({ query: "drywall 1/2 <b>", zip: "20705", lang: "es", client });
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.options).toHaveLength(2);
    expect((calls[0].tools ?? []).map((t) => (t as { name: string }).name)).toEqual(["web_search", "record_prices"]);
    expect(String(calls[0].messages[0].content)).not.toContain("<b>");
    expect(pricesSystemPrompt("es", "20705")).toContain("Only prices you actually saw on a page");
    const off: AiClient = { create: async () => { throw new Error("web_search_20250305 is not enabled for this organization"); } };
    expect(await searchPrices({ query: "drywall", zip: "", lang: "es", client: off })).toMatchObject({ ok: false, error: "no_search" });
    const nothing = await searchPrices({ query: "drywall", zip: "", lang: "es", client: script(msg([{ type: "text", text: "no idea" }])).client });
    expect(nothing).toMatchObject({ ok: false, error: "failed" });
  });
});
