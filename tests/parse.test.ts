import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { amountsHeard, checkParsed, parseRequest, type AiClient } from "@/lib/ai/parse";

const tool = (input: unknown, id = "t1"): Anthropic.Message =>
  ({ id: "m", type: "message", role: "assistant", model: "x", stop_reason: "tool_use", stop_sequence: null,
     usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", id, name: "record_request", input }] }) as unknown as Anthropic.Message;

function scripted(...answers: Anthropic.Message[]): AiClient & { calls: Anthropic.MessageCreateParamsNonStreaming[] } {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  return {
    calls,
    async create(p) {
      calls.push(structuredClone(p));
      const next = answers.shift();
      if (!next) throw new Error("no more answers");
      return next;
    },
  };
}

describe("amountsHeard", () => {
  it("understands how dictation writes amounts", () => {
    const h = amountsHeard("factura para Juan 1. $2,200 pintura 2. 350 materiales, 2.200 otra, 1.5 horas, 3 mil, 4k, dos mil, $99.99");
    for (const c of [220000, 35000, 150, 300000, 400000, 200000, 9999, 100, 200]) expect(h.has(c), String(c)).toBe(true);
  });
});

describe("checkParsed", () => {
  const transcript = "Necesito una factura para Juan por pintar la cocina 2200 y 3 ventanas a 400 cada una";
  it("keeps prices that were said", () => {
    const r = checkParsed(
      { kind: "invoice", customer_name: "Juan", items: [
        { description: "Pintar cocina", quantity: 1, unit_price: 2200, price_source: "said" },
        { description: "Ventanas", quantity: 3, unit_price: 400, price_source: "said" },
      ], notes: "", questions: [] },
      transcript, [], "es",
    );
    expect(r.problems).toEqual([]);
    expect(r.value!.items.map((i) => [i.unitPriceCents, i.source, i.needsConfirm])).toEqual([
      [220000, "said", false],
      [40000, "said", false],
    ]);
  });

  it("turns a 'said' price that wasn't said into a suggestion to confirm", () => {
    const r = checkParsed(
      { kind: "invoice", customer_name: "Juan", items: [{ description: "Pintar cocina", quantity: 1, unit_price: 2300, price_source: "said" }], notes: "", questions: [] },
      transcript, [], "es",
    );
    expect(r.value!.items[0]).toMatchObject({ source: "suggested", needsConfirm: true, unitPriceCents: 230000 });
    expect(r.value!.items[0].basis).toMatch(/confírmalo/);
  });

  it("only trusts catalog prices that are in the catalog", () => {
    const catalog = [{ description: "Pintar baño", unitPriceCents: 90000 }];
    const ok = checkParsed({ kind: "invoice", customer_name: "", items: [{ description: "Pintar baño", quantity: 1, unit_price: 900, price_source: "catalog" }], notes: "", questions: [] }, "pintar el baño", catalog, "es");
    expect(ok.value!.items[0].source).toBe("catalog");
    const bad = checkParsed({ kind: "invoice", customer_name: "", items: [{ description: "Pintar baño", quantity: 1, unit_price: 950, price_source: "catalog" }], notes: "", questions: [] }, "pintar el baño", catalog, "es");
    expect(bad.value!.items[0].source).toBe("suggested");
  });

  it("asks to check a quantity that wasn't heard", () => {
    const r = checkParsed({ kind: "invoice", customer_name: "", items: [{ description: "Ventanas", quantity: 5, unit_price: 400, price_source: "said" }], notes: "", questions: [] }, transcript, [], "en");
    expect(r.value!.items[0]).toMatchObject({ source: "suggested", basis: "Check the quantity." });
  });

  it("reports what makes an answer unusable", () => {
    const r = checkParsed({ kind: "invoice", items: [{ description: "", quantity: -1, unit_price: "lots" }] }, transcript, [], "es");
    expect(r.value).toBeUndefined();
    expect(r.problems.length).toBe(3);
  });
});

describe("parseRequest", () => {
  const good = { kind: "estimate", customer_name: "Juan", items: [{ description: "Reemplazar 3 ventanas", quantity: 1, unit_price: 1450, price_source: "suggested", basis: "Típico para 3 ventanas de vinilo estándar, instaladas" }], notes: "", questions: [] };

  it("uses the tool, fences the data, and records the model and prompt version", async () => {
    const client = scripted(tool(good));
    const r = await parseRequest({ transcript: "presupuesto para Juan, cambiar 3 ventanas", lang: "es", catalog: [{ description: "Pintar <b>baño</b>", unitPriceCents: 90000 }], today: "2026-10-01", client });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ kind: "estimate", customerName: "Juan", promptVersion: "parse-request@1" });
    expect(r.value.items[0].needsConfirm).toBe(true);
    const p = client.calls[0];
    expect(p.tool_choice).toEqual({ type: "tool", name: "record_request" });
    const msg = String(p.messages[0].content);
    expect(msg).toContain("<request>");
    expect(msg).toContain("Pintar bbaño/b: $900.00");
  });

  it("retries once with the exact problems, then succeeds", async () => {
    const client = scripted(tool({ kind: "invoice", customer_name: "", items: [] }), tool(good, "t2"));
    const r = await parseRequest({ transcript: "presupuesto para Juan", lang: "es", catalog: [], today: "2026-10-01", client });
    expect(r.ok).toBe(true);
    const retry = client.calls[1].messages.at(-1)!;
    expect(JSON.stringify(retry.content)).toContain("return at least one item");
  });

  it("fails clearly after two bad answers", async () => {
    const empty = { ...tool({}), content: [{ type: "text", text: "Hola" }] } as unknown as Anthropic.Message;
    const client = scripted(empty, empty);
    const r = await parseRequest({ transcript: "hola que tal", lang: "es", catalog: [], today: "2026-10-01", client });
    expect(r).toEqual({ ok: false, error: "You didn't call record_request." });
    expect(client.calls.length).toBe(2);
  });

  it("doesn't call the model for an empty request", async () => {
    const client = scripted();
    expect(await parseRequest({ transcript: " ", lang: "es", catalog: [], today: "2026-10-01", client })).toEqual({ ok: false, error: "empty" });
    expect(client.calls.length).toBe(0);
  });
});
