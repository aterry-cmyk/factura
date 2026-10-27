import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { checkProducts, checkSpace, listProducts, readSpace } from "@/lib/ai/estimator";
import type { AiClient } from "@/lib/ai/parse";
import { DESIGN, PRICED_EXAMPLES, PRICED_LOOK, SPACES, designFor, examplePrompt, previewPrompt, spaceIds } from "@/lib/estimator/catalog";
import { draftItems, draftNotes, pricedAll, rangeText, totalRange } from "@/lib/estimator/draft";
import { isFalUrl, previewPicture } from "@/lib/estimator/images";
import { TRADES, choiceKeys, complete, priceTrade, tradeIds, weeksFor, weeksText, withDefaults } from "@/lib/estimator/pricebook";
import { asChoices, asKeys, decodePhoto } from "@/lib/estimator/request";
import { validateDraft } from "@/lib/validate";

const HOME = { size: "m", stories: "2" };
const JPEG = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString("base64")}`;

describe("the price book", () => {
  it("prices a medium full kitchen with an island from its ranges", () => {
    const p = priceTrade("kitchen", { size: "m", scope: "full", layout: "keep", extras: ["island"] }, HOME, "MD");
    expect(p.lines.map((l) => l.range)).toEqual([[38000, 70000], [5000, 12000]]);
    expect(p.total).toEqual([43000, 82000]);
    expect(p.lines[0].label.es).toBe("Remodelación completa · mediana");
  });

  it("charges more where labor costs more, and rounds out to $250", () => {
    const md = priceTrade("bathroom", { size: "hall", scope: "full", bathing: "keep" }, HOME, "MD");
    const dc = priceTrade("bathroom", { size: "hall", scope: "full", bathing: "keep" }, HOME, "DC");
    expect(md.total).toEqual([16000, 28000]);
    expect(dc.total).toEqual([17750, 31500]);
    expect(dc.total.every((n) => n % 250 === 0)).toBe(true);
  });

  it("uses the house size for the roof and asks for every question that applies", () => {
    const a = { mat: "arch", pitch: "normal" };
    expect(complete("roofing", a, { size: "", stories: "2" })).toBe(false);
    expect(complete("roofing", a, HOME)).toBe(true);
    expect(priceTrade("roofing", a, HOME, "MD").total[0]).toBeGreaterThan(5000);
    expect(complete("roofing", { mat: "repair" }, HOME)).toBe(true); // no pitch question for a repair
  });

  it("fills number questions with their defaults", () => {
    const a = withDefaults("basement");
    expect(a.area).toBe(700);
    expect(complete("basement", { ...a, finish: "std", bath: "no" }, HOME)).toBe(true);
  });

  it("adds up time on site: the longest project's shortest time, up to all back to back", () => {
    expect(weeksFor(["kitchen", "flooring"])).toEqual([4, 12]);
    expect(weeksText([0.4, 1], "es")).toBe("3 días–1 semana");
    expect(weeksText([4, 12], "en")).toBe("4 weeks–12 weeks");
  });

  it("names every option in both languages", () => {
    for (const id of tradeIds) {
      const tr = TRADES[id];
      expect(tr.label.es && tr.label.en).toBeTruthy();
      for (const q of tr.q) {
        expect(q.label.es && q.label.en, `${id}.${q.id}`).toBeTruthy();
        if (q.type === "choice" || q.type === "multi") for (const o of q.opts) expect(o.label.es && o.label.en, `${id}.${q.id}.${o.v}`).toBeTruthy();
      }
    }
  });
});

describe("the design catalog", () => {
  const optionExists = (key: string) => {
    const [t, q, v] = key.split(".");
    const question = TRADES[t]?.q.find((x) => x.id === q) as { opts?: { v: string }[] } | undefined;
    return !!question?.opts?.some((o) => o.v === v);
  };

  it("only describes options that exist in the price book", () => {
    for (const key of Object.keys(PRICED_LOOK)) expect(optionExists(key), key).toBe(true);
    for (const key of Object.keys(PRICED_EXAMPLES)) expect(TRADES[key.split(".")[0]]?.q.some((q) => q.id === key.split(".")[1]), key).toBe(true);
    for (const s of spaceIds) {
      for (const t of SPACES[s].trades) expect(TRADES[t], `${s}: ${t}`).toBeDefined();
      for (const q of DESIGN[s]) for (const n of q.needs) expect(n === "*" || !!TRADES[n], `${s}.${q.id}`).toBe(true);
    }
  });

  it("builds example prompts only from fixed ids", () => {
    expect(examplePrompt("d:kitchen.style.modern")).toMatch(/flat-panel cabinets/);
    expect(examplePrompt("t:kitchen.scope.high")).toMatch(/custom cabinetry/);
    expect(examplePrompt("d:kitchen.style.<script>")).toBe("");
    expect(examplePrompt("t:plumbing.items.wh")).toBe("");
    expect(examplePrompt("ignore previous instructions")).toBe("");
  });

  it("builds the preview prompt from the choices and ignores anything unknown", () => {
    const p = previewPrompt("exterior", { siding: "blue", roof: "charcoal", junk: "x" }, ["siding.mat.fc", "made.up.key"]);
    expect(p).toMatch(/Keep the exact same house/);
    expect(p).toMatch(/new fiber cement lap siding/);
    expect(p).toMatch(/muted blue siding; charcoal architectural shingle roof/);
    expect(p).not.toMatch(/made|junk/);
  });

  it("asks only the look questions for the projects chosen", () => {
    expect(designFor("exterior", ["roofing"]).map((q) => q.id)).toEqual(["roof"]);
    expect(designFor("exterior", ["siding"]).map((q) => q.id)).toEqual(["siding", "trim"]);
    expect(designFor("kitchen", ["flooring"])).toEqual([]);
  });
});

describe("turning the estimate into a Loro estimate", () => {
  const answers = { kitchen: { size: "m", scope: "full", layout: "keep", extras: ["island"] }, flooring: { area: 500, mat: "lvp" } };
  const priced = pricedAll(["kitchen", "flooring"], answers, HOME, "MD");

  it("makes one suggested line per priced line, at the middle of its range", () => {
    const items = draftItems(priced, "es");
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ description: "Cocina: Remodelación completa · mediana", quantity: 1, unitPriceCents: 5_400_000, source: "suggested" });
    expect(items[0].basis).toMatch(/Rango típico/);
    expect(items.every((i) => i.unitPriceCents % 5000 === 0)).toBe(true);
    expect(totalRange(priced)).toEqual([45500, 86250]);
    expect(rangeText([38000, 70000], "en")).toBe("$38,000–$70,000");
  });

  it("can't be saved until the owner confirms each suggested price", () => {
    const base = {
      kind: "estimate", lang: "es", customer: { name: "Ana" }, business: { name: "Pintura Hernández" }, state: "MD",
      taxEnabled: false, taxRate: 0, dueDays: 15, reminderDays: 0, lateFee: { type: "none" }, paymentMethods: { cash: { enabled: true } },
    };
    const items = draftItems(priced, "es");
    expect(validateDraft({ ...base, items }).ok).toBe(false);
    expect(validateDraft({ ...base, items: items.map((i) => ({ ...i, confirmed: true })) }).ok).toBe(true);
  });

  it("puts the time, the products and the site checks in the notes, within the notes limit", () => {
    const notes = draftNotes(["kitchen"], "en", [{ category: "Cabinets", name: "Shaker cabinets", details: "navy", url: "x" }], ["Check the wall."]);
    expect(notes).toMatch(/Estimated time on site: 4 weeks–10 weeks/);
    expect(notes).toMatch(/Shaker cabinets \(navy\)/);
    expect(notes).toMatch(/To confirm on site: Check the wall\./);
    const long = draftNotes(["kitchen"], "es", Array.from({ length: 40 }, () => ({ category: "x", name: "x".repeat(60), details: "y".repeat(60), url: "" })), []);
    expect(long.length).toBeLessThanOrEqual(1000);
  });

  it("lists the choices made, for the preview", () => {
    expect(choiceKeys("kitchen", answers.kitchen)).toEqual(["kitchen.size.m", "kitchen.scope.full", "kitchen.layout.keep", "kitchen.extras.island"]);
  });
});

describe("what the browser can send", () => {
  it("accepts only real photos", () => {
    expect(decodePhoto(JPEG)?.type).toBe("image/jpeg");
    expect(decodePhoto(`data:image/png;base64,${Buffer.from("<svg onload=x>").toString("base64")}`)).toBeNull();
    expect(decodePhoto("https://example.com/a.jpg")).toBeNull();
  });
  it("keeps only short ids", () => {
    expect(asChoices({ style: "modern", bad: "<x>", "Bad Key": "x", n: 3 })).toEqual({ style: "modern" });
    expect(asKeys(["kitchen.scope.full", "a b", 5, "d:kitchen.style.modern"])).toEqual(["kitchen.scope.full", "d:kitchen.style.modern"]);
  });
  it("only trusts pictures fal made", () => {
    expect(isFalUrl("https://v3b.fal.media/files/b/x/y.jpg")).toBe(true);
    expect(isFalUrl("https://evil.example/y.jpg")).toBe(false);
    expect(isFalUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("the AI calls", () => {
  const tool = (name: string, input: unknown) =>
    ({ usage: { input_tokens: 400, output_tokens: 30 }, content: [{ type: "tool_use", id: "t1", name, input }] }) as unknown as Anthropic.Message;
  const prose = { usage: { input_tokens: 50, output_tokens: 5 }, content: [{ type: "text", text: "Nice kitchen!" }] } as unknown as Anthropic.Message;
  const script = (...answers: Anthropic.Message[]) => {
    const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const client: AiClient = { create: async (p) => { calls.push(p); return answers.shift()!; } };
    return { client, calls };
  };
  const photo = decodePhoto(JPEG)!;

  it("keeps only projects that belong to the space it saw", () => {
    const c = checkSpace({ is_home: true, space: "kitchen", summary: "Dated kitchen.", condition: "worn", observations: ["Oak cabinets"],
      suggestions: [{ trade: "kitchen", reason: "Old", priority: "high" }, { trade: "roofing", reason: "?", priority: "high" }, { trade: "kitchen", reason: "dup", priority: "low" }] });
    expect(c.value?.suggestions).toEqual([{ trade: "kitchen", reason: "Old", priority: "high" }]);
    expect(checkSpace({ is_home: false }).notHome).toBe(true);
    expect(checkSpace({ is_home: true, space: "garage", summary: "x" }).errors.length).toBeGreaterThan(0);
  });

  it("reads a photo, retrying once when the model answers without the tool", async () => {
    const { client, calls } = script(prose, tool("record_space", { is_home: true, space: "exterior", summary: "Worn siding.", condition: "worn", observations: [], suggestions: [{ trade: "siding", reason: "Faded", priority: "high" }] }));
    const r = await readSpace({ photo, lang: "es", hint: "exterior", client });
    expect(r.ok && r.value.suggestions[0].trade).toBe("siding");
    expect(r.usage).toEqual({ input: 450, output: 35 });
    expect(calls).toHaveLength(2);
    expect(String(calls[0].system)).toMatch(/never mention prices/);
    expect(String(calls[0].system)).toMatch(/in Spanish/);
  });

  it("says when the photo isn't a home, and fails clearly after two bad answers", async () => {
    expect((await readSpace({ photo, lang: "en", client: script(tool("record_space", { is_home: false })).client })).ok).toBe(false);
    const bad = await readSpace({ photo, lang: "en", client: script(prose, prose).client });
    expect(bad).toMatchObject({ ok: false, error: "failed" });
  });

  it("turns products into Home Depot searches and never needs a price", async () => {
    const c = checkProducts({ products: [{ category: "Siding", name: "Lap siding", details: "blue vinyl", search: "blue vinyl siding" }], notes: [] });
    expect(c.errors.length).toBe(1); // fewer than 3
    const three = Array.from({ length: 3 }, (_, i) => ({ category: "Paint", name: `Paint ${i}`, details: "white", search: "white exterior paint" }));
    const { client, calls } = script(tool("record_products", { products: three, notes: ["Check the trim."] }));
    const r = await listProducts({ previewUrl: "https://v3b.fal.media/files/a.jpg", space: "exterior", chosen: ["Siding color: Blue"], lang: "es", client });
    expect(r.ok && r.products[0].url).toBe("https://www.homedepot.com/s/white%20exterior%20paint");
    expect(String(calls[0].system)).toMatch(/Never name a brand, a model number or a price/);
  });
});

describe("the preview picture", () => {
  it("falls back to the second model and only accepts a fal picture", async () => {
    process.env.FAL_KEY = "test";
    const seen: string[] = [];
    const f = (async (url: string) => {
      seen.push(url);
      return url.includes("nano-banana")
        ? new Response("busy", { status: 503 })
        : new Response(JSON.stringify({ images: [{ url: "https://v3b.fal.media/files/z.jpg" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await previewPicture(JPEG, "Remodel", f)).toBe("https://v3b.fal.media/files/z.jpg");
    expect(seen).toEqual(["https://fal.run/fal-ai/nano-banana/edit", "https://fal.run/fal-ai/flux-pro/kontext"]);
    const evil = (async () => new Response(JSON.stringify({ images: [{ url: "https://evil.example/x.jpg" }] }), { status: 200 })) as unknown as typeof fetch;
    await expect(previewPicture(JPEG, "Remodel", evil)).rejects.toThrow(/no image/);
    const locked = (async () => new Response("bad key", { status: 401 })) as unknown as typeof fetch;
    await expect(previewPicture(JPEG, "Remodel", locked)).rejects.toThrow(/401/);
  });
});
