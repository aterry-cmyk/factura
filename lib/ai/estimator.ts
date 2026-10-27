import type Anthropic from "@anthropic-ai/sdk";
import { SPACES, spaceIds } from "@/lib/estimator/catalog";
import type { Space } from "@/lib/estimator/pricebook";
import type { Lang } from "@/lib/types";
import { MODEL } from "./config";
import { anthropicClient, type AiClient, type TokenUsage } from "./parse";
import { PRODUCTS_TOOL, SPACE_TOOL, productsSystemPrompt, spaceSystemPrompt } from "./prompts/estimator";
import type { PhotoType } from "./read-photo";

// The estimator's two Claude calls. Reading the photo: which space, what shape it's in, and which
// projects fit (only from the price book's list for that space). The product list: what to look
// for at Home Depot to build the preview. Neither ever writes a price; both answer with a tool,
// get checked, get one retry with the problems, then fail clearly.

export interface SpaceReading {
  space: Space;
  summary: string;
  condition: "good" | "fair" | "worn";
  observations: string[];
  suggestions: { trade: string; reason: string; priority: "high" | "medium" | "low" }[];
}
export interface Product { category: string; name: string; details: string; search: string; url: string }

const clip = (v: unknown, n: number): string =>
  typeof v === "string" ? v.replace(/<[^>]*>/g, "").replace(/[\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim().slice(0, n) : "";
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Checks the model's reading; anything outside the fixed lists is dropped. */
export function checkSpace(raw: unknown, hint?: Space): { value?: SpaceReading; notHome?: boolean; errors: string[] } {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.is_home === false) return { notHome: true, errors: [] };
  const space = (spaceIds as string[]).includes(String(r.space)) ? (r.space as Space) : hint;
  const errors: string[] = [];
  if (!space) errors.push(`space must be one of ${spaceIds.join(", ")}`);
  const summary = clip(r.summary, 220);
  if (!summary) errors.push("summary is missing");
  if (errors.length || !space) return { errors };
  const allowed = SPACES[space].trades, seen = new Set<string>();
  const suggestions = list(r.suggestions).flatMap((x) => {
    const s = (x ?? {}) as Record<string, unknown>, trade = String(s.trade);
    if (!allowed.includes(trade) || seen.has(trade)) return [];
    seen.add(trade);
    const priority: "high" | "medium" | "low" = s.priority === "high" || s.priority === "low" ? s.priority : "medium";
    return [{ trade, reason: clip(s.reason, 160), priority }];
  }).slice(0, 4);
  const condition = r.condition === "good" || r.condition === "worn" ? r.condition : "fair";
  const observations = list(r.observations).map((x) => clip(x, 140)).filter(Boolean).slice(0, 4);
  return { value: { space, summary, condition, observations, suggestions }, errors: [] };
}

/** Checks the product list and turns each search into a Home Depot search link. */
export function checkProducts(raw: unknown): { products: Product[]; notes: string[]; errors: string[] } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const products = list(r.products).flatMap((x) => {
    const p = (x ?? {}) as Record<string, unknown>;
    const search = clip(p.search, 60), name = clip(p.name, 80);
    if (!search || !name) return [];
    return [{ category: clip(p.category, 40) || "—", name, details: clip(p.details, 110), search, url: `https://www.homedepot.com/s/${encodeURIComponent(search)}` }];
  }).slice(0, 8);
  const notes = list(r.notes).map((x) => clip(x, 200)).filter(Boolean).slice(0, 3);
  return { products, notes, errors: products.length >= 3 ? [] : ["Give 3 to 8 products, each with a name and search words."] };
}

async function withTool<T>(opts: {
  client: AiClient;
  system: string;
  content: Anthropic.ContentBlockParam[];
  tool: Anthropic.Tool;
  check: (input: unknown) => { errors: string[] } & T;
  usage: TokenUsage;
}): Promise<(T & { errors: string[] }) | null> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: opts.content }];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await opts.client.create({ model: MODEL, max_tokens: 2000, system: opts.system, messages, tools: [opts.tool], tool_choice: { type: "tool", name: opts.tool.name } });
    opts.usage.input += res.usage?.input_tokens ?? 0;
    opts.usage.output += res.usage?.output_tokens ?? 0;
    const call = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const checked = opts.check(call?.input);
    if (call && !checked.errors.length) return checked;
    messages.push({ role: "assistant", content: res.content.length ? res.content : "(no answer)" });
    messages.push(call
      ? { role: "user", content: [{ type: "tool_result", tool_use_id: call.id, is_error: true, content: `Fix these and answer again: ${checked.errors.join("; ")}` }] }
      : { role: "user", content: `Answer with the ${opts.tool.name} tool.` });
  }
  return null;
}

export type SpaceResult =
  | { ok: true; value: SpaceReading; usage: TokenUsage }
  | { ok: false; error: "not_home" | "failed"; usage: TokenUsage };

export async function readSpace(opts: { photo: { type: PhotoType; base64: string }; lang: Lang; hint?: Space; client?: AiClient }): Promise<SpaceResult> {
  const usage: TokenUsage = { input: 0, output: 0 };
  let notHome = false;
  const out = await withTool({
    client: opts.client ?? anthropicClient(),
    system: spaceSystemPrompt(opts.lang, opts.hint ? SPACES[opts.hint].label.en : ""),
    content: [
      { type: "image", source: { type: "base64", media_type: opts.photo.type, data: opts.photo.base64 } },
      { type: "text", text: "What does this photo show, and which projects could make sense?" },
    ],
    tool: SPACE_TOOL,
    check: (input) => { const c = checkSpace(input, opts.hint); if (c.notHome) notHome = true; return c.notHome ? { ...c, errors: [] } : c; },
    usage,
  });
  if (notHome) return { ok: false, error: "not_home", usage };
  if (!out?.value) return { ok: false, error: "failed", usage };
  return { ok: true, value: out.value, usage };
}

export type ProductsResult =
  | { ok: true; products: Product[]; notes: string[]; usage: TokenUsage }
  | { ok: false; usage: TokenUsage };

export async function listProducts(opts: { previewUrl: string; space: Space; chosen: string[]; lang: Lang; client?: AiClient }): Promise<ProductsResult> {
  const usage: TokenUsage = { input: 0, output: 0 };
  const name = opts.space === "exterior" ? "house front" : SPACES[opts.space].label.en.toLowerCase();
  const out = await withTool({
    client: opts.client ?? anthropicClient(),
    system: productsSystemPrompt(opts.lang, name, opts.chosen),
    content: [
      { type: "image", source: { type: "url", url: opts.previewUrl } },
      { type: "text", text: "List the products to build this remodel." },
    ],
    tool: PRODUCTS_TOOL,
    check: checkProducts,
    usage,
  });
  if (!out) return { ok: false, usage };
  return { ok: true, products: out.products, notes: out.notes, usage };
}
