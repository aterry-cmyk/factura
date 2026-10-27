import type Anthropic from "@anthropic-ai/sdk";
import { burdenedHourlyCents, isCostCode, type CostCode, type LaborBurden, type Worker } from "@/lib/costs";
import type { Lang } from "@/lib/types";
import { MODEL } from "./config";
import { amountsHeard, anthropicClient, type AiClient, type TokenUsage } from "./parse";
import {
  COSTS_PROMPT_VERSION, COSTS_TOOL, PRICES_TOOL, RECEIPT_TOOL, TAKEOFF_TOOL, costSystemPrompt, plansSystemPrompt, pricesSystemPrompt, receiptSystemPrompt,
} from "./prompts/costs";
import type { PhotoType } from "./read-photo";

// The P&L's four model calls. The rule everywhere: the model copies and sorts; the owner sees
// every number and confirms it; a number that can't be traced to what he said, photographed or
// uploaded is marked as needing confirmation rather than trusted.

const clip = (v: unknown, n: number): string =>
  typeof v === "string" ? v.replace(/<[^>]*>/g, "").replace(/[\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim().slice(0, n) : "";
const dollars = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : null);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function toolCall(res: Anthropic.Message, name: string): Record<string, unknown> | null {
  const call = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === name);
  return call ? ((call.input ?? {}) as Record<string, unknown>) : null;
}

/**
 * The production model doesn't accept a forced tool choice, so the tool is "auto" and a reply in
 * prose gets one nudge ("Answer with the X tool") before the call counts as failed.
 */
export async function withTool(client: AiClient, params: Anthropic.MessageCreateParamsNonStreaming, name: string, usage: TokenUsage): Promise<{ res: Anthropic.Message; input: Record<string, unknown> | null }> {
  let res = await client.create(params);
  addUsage(usage, res);
  let input = toolCall(res, name);
  if (!input) {
    res = await client.create({ ...params, messages: [...params.messages, { role: "assistant", content: res.content.length ? res.content : "(no answer)" }, { role: "user", content: `Answer with the ${name} tool.` }] });
    addUsage(usage, res);
    input = toolCall(res, name);
  }
  return { res, input };
}
const addUsage = (u: TokenUsage, res: Anthropic.Message) => {
  u.input += res.usage?.input_tokens ?? 0;
  u.output += res.usage?.output_tokens ?? 0;
};

// ---- What he said he spent ----

export interface CostDraft {
  code: CostCode;
  amountCents: number;
  description: string;
  vendor: string;
  spentOn: string;
  workerId: string | null;
  workerName: string;
  hours: number | null;
  /** The amount was said, or computed from said hours and the crew's wage. Otherwise the owner must confirm it. */
  needsConfirm: boolean;
  basis: string;
}

export type CostsResult = { ok: true; entries: CostDraft[]; usage: TokenUsage; promptVersion: string } | { ok: false; error: string; usage: TokenUsage };

/**
 * Checks the model's entries against the words: an amount counts only if it was said; hours count
 * only if said and the worker is on the crew (then the amount is hours × burdened wage, computed
 * here, never by the model). Anything else is kept but flagged for the owner.
 */
export function checkCosts(raw: unknown, text: string, workers: Worker[], burden: LaborBurden, today: string): CostDraft[] {
  const heard = amountsHeard(text);
  const list = Array.isArray((raw as { entries?: unknown })?.entries) ? ((raw as { entries: unknown[] }).entries as unknown[]) : [];
  return list.slice(0, 20).flatMap((e) => {
    const r = (e ?? {}) as Record<string, unknown>;
    const code = isCostCode(r.code) ? r.code : "other";
    const description = clip(r.description, 300);
    const workerName = clip(r.worker, 80);
    const worker = workerName ? workers.find((w) => w.active && w.name.toLowerCase() === workerName.toLowerCase()) ?? null : null;
    const hours = typeof r.hours === "number" && r.hours > 0 && r.hours <= 1000 ? Math.round(r.hours * 100) / 100 : null;
    const hoursSaid = hours !== null && heard.has(Math.round(hours * 100));
    const said = dollars(r.amount);
    let amountCents = 0;
    let needsConfirm = true;
    let basis = "";
    if (said && heard.has(said)) {
      amountCents = said;
      needsConfirm = false;
      basis = "said";
    } else if (code === "labor" && worker && hours !== null && hoursSaid) {
      amountCents = Math.round(burdenedHourlyCents(worker, burden) * hours);
      needsConfirm = false;
      basis = `${hours} h × ${worker.name}`;
    } else if (said) {
      amountCents = said;
      basis = "unverified";
    } else if (!description) {
      return [];
    }
    const spentOn = typeof r.spent_on === "string" && DAY.test(r.spent_on) && r.spent_on <= today ? r.spent_on : today;
    return [{ code, amountCents, description: description || workerName, vendor: clip(r.vendor, 120), spentOn, workerId: worker?.id ?? null, workerName: worker?.name ?? workerName, hours, needsConfirm, basis }];
  });
}

export async function recordCosts(opts: { text: string; workers: Worker[]; burden: LaborBurden; lang: Lang; today: string; client?: AiClient }): Promise<CostsResult> {
  const usage: TokenUsage = { input: 0, output: 0 };
  const text = opts.text.trim().slice(0, 2000);
  if (!text) return { ok: false, error: "empty", usage };
  const client = opts.client ?? anthropicClient();
  const { input } = await withTool(client, {
    model: MODEL, max_tokens: 1500,
    system: costSystemPrompt(opts.lang, opts.workers.filter((w) => w.active).map((w) => w.name), opts.today),
    messages: [{ role: "user", content: `<spent>\n${text.replace(/[<>]/g, "")}\n</spent>` }],
    tools: [COSTS_TOOL as Anthropic.Tool], tool_choice: { type: "auto" },
  }, COSTS_TOOL.name, usage);
  if (!input) return { ok: false, error: "no_answer", usage };
  const entries = checkCosts(input, text, opts.workers, opts.burden, opts.today);
  if (!entries.length) return { ok: false, error: "nothing_found", usage };
  return { ok: true, entries, usage, promptVersion: COSTS_PROMPT_VERSION };
}

// ---- A receipt ----

export interface ReceiptReading {
  vendor: string;
  date: string;
  totalCents: number;
  lines: { description: string; amountCents: number }[];
}
export type ReceiptResult = { ok: true; value: ReceiptReading; usage: TokenUsage } | { ok: false; error: "unreadable" | "failed"; usage: TokenUsage };

export async function readReceipt(opts: { photo: { type: PhotoType; base64: string }; lang: Lang; client?: AiClient }): Promise<ReceiptResult> {
  const usage: TokenUsage = { input: 0, output: 0 };
  const client = opts.client ?? anthropicClient();
  const { input: r } = await withTool(client, {
    model: MODEL, max_tokens: 2000, system: receiptSystemPrompt(opts.lang),
    messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: opts.photo.type, data: opts.photo.base64 } },
      { type: "text", text: "Copy what is printed on this receipt." },
    ] }],
    tools: [RECEIPT_TOOL as Anthropic.Tool], tool_choice: { type: "auto" },
  }, RECEIPT_TOOL.name, usage);
  if (!r) return { ok: false, error: "failed", usage };
  const totalCents = dollars(r.total);
  if (r.readable !== true || totalCents === null || totalCents === 0) return { ok: false, error: "unreadable", usage };
  const lines = (Array.isArray(r.lines) ? r.lines : []).slice(0, 40).flatMap((l) => {
    const x = (l ?? {}) as Record<string, unknown>;
    const amountCents = dollars(x.amount);
    const description = clip(x.description, 200);
    return description && amountCents !== null ? [{ description, amountCents }] : [];
  });
  return { ok: true, value: { vendor: clip(r.vendor, 120), date: typeof r.date === "string" && DAY.test(r.date) ? r.date : "", totalCents, lines }, usage };
}

// ---- Plans (PDF) ----

export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const UNITS = ["SF", "LF", "EA", "SY", "CY"] as const;
export interface TakeoffLine { item: string; quantity: number; unit: (typeof UNITS)[number]; where: string }
export type TakeoffResult = { ok: true; summary: string; lines: TakeoffLine[]; usage: TokenUsage } | { ok: false; error: "unreadable" | "failed"; usage: TokenUsage };

export const isPdf = (bytes: Uint8Array): boolean => bytes.length > 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";

export async function readPlans(opts: { pdfBase64: string; lang: Lang; client?: AiClient }): Promise<TakeoffResult> {
  const usage: TokenUsage = { input: 0, output: 0 };
  const client = opts.client ?? anthropicClient();
  const { input: r } = await withTool(client, {
    model: MODEL, max_tokens: 4000, system: plansSystemPrompt(opts.lang),
    messages: [{ role: "user", content: [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: opts.pdfBase64 } },
      { type: "text", text: "Take off the quantities from these plans." },
    ] }],
    tools: [TAKEOFF_TOOL as Anthropic.Tool], tool_choice: { type: "auto" },
  }, TAKEOFF_TOOL.name, usage);
  if (!r) return { ok: false, error: "failed", usage };
  const lines = (Array.isArray(r.lines) ? r.lines : []).slice(0, 60).flatMap((l) => {
    const x = (l ?? {}) as Record<string, unknown>;
    const item = clip(x.item, 120), where = clip(x.where, 160);
    const quantity = typeof x.quantity === "number" && x.quantity > 0 && x.quantity < 10_000_000 ? Math.round(x.quantity * 100) / 100 : null;
    const unit = (UNITS as readonly string[]).includes(String(x.unit)) ? (x.unit as TakeoffLine["unit"]) : null;
    return item && quantity && unit ? [{ item, quantity, unit, where }] : [];
  });
  if (r.readable !== true || !lines.length) return { ok: false, error: "unreadable", usage };
  return { ok: true, summary: clip(r.summary, 220), lines, usage };
}

/** The takeoff as lines the estimate parser can read: "Piso de madera — 320 SF (Plano A-2, sala)". */
export const takeoffText = (lines: TakeoffLine[]): string =>
  lines.map((l) => `${l.item} — ${l.quantity} ${l.unit}${l.where ? ` (${l.where})` : ""}`).join("\n");

// ---- Prices on the web ----

export interface PriceOption { vendor: string; product: string; priceCents: number; unit: string; url: string; where: string }
export type PricesResult = { ok: true; options: PriceOption[]; usage: TokenUsage } | { ok: false; error: "no_search" | "failed"; usage: TokenUsage };

/** The URLs the search actually returned: an option whose page isn't among them is dropped. */
export function searchedUrls(res: Anthropic.Message): Set<string> {
  const urls = new Set<string>();
  for (const b of res.content) {
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content) if (r.type === "web_search_result" && typeof r.url === "string") urls.add(r.url);
    }
  }
  return urls;
}

export function checkPrices(raw: unknown, seen: Set<string>): PriceOption[] {
  const list = Array.isArray((raw as { options?: unknown })?.options) ? ((raw as { options: unknown[] }).options as unknown[]) : [];
  const hosts = new Set([...seen].map((u) => { try { return new URL(u).host; } catch { return ""; } }));
  return list.slice(0, 5).flatMap((o) => {
    const r = (o ?? {}) as Record<string, unknown>;
    const url = clip(r.url, 500);
    const priceCents = dollars(r.price);
    let host = "";
    try { host = new URL(url).host; } catch { return []; }
    if (!/^https?:/.test(url) || !(seen.has(url) || hosts.has(host))) return [];
    const vendor = clip(r.vendor, 80), product = clip(r.product, 160);
    return vendor && product && priceCents ? [{ vendor, product, priceCents, unit: clip(r.unit, 60) || "each", url, where: clip(r.where, 80) }] : [];
  });
}

export async function searchPrices(opts: { query: string; zip: string; lang: Lang; client?: AiClient }): Promise<PricesResult> {
  const usage: TokenUsage = { input: 0, output: 0 };
  const client = opts.client ?? anthropicClient();
  let res: Anthropic.Message;
  try {
    res = await client.create({
      model: MODEL, max_tokens: 3000, system: pricesSystemPrompt(opts.lang, opts.zip),
      messages: [{ role: "user", content: `<query>\n${opts.query.replace(/[<>]/g, "").slice(0, 200)}\n</query>` }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 } as Anthropic.WebSearchTool20250305, PRICES_TOOL as Anthropic.Tool],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: /web_search|not enabled|permission/i.test(msg) ? "no_search" : "failed", usage };
  }
  addUsage(usage, res);
  const seen = searchedUrls(res);
  const r = toolCall(res, PRICES_TOOL.name);
  if (!r) return seen.size ? { ok: true, options: [], usage } : { ok: false, error: "failed", usage };
  return { ok: true, options: checkPrices(r, seen), usage };
}
