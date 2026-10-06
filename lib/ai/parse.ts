import Anthropic from "@anthropic-ai/sdk";
import type { Lang, LineItem, DocKind } from "@/lib/types";
import { MODEL } from "./config";
import {
  PARSE_PROMPT_VERSION,
  type DetailAnswer,
  RECORD_TOOL,
  parseSystemPrompt,
  parseUserMessage,
  type CatalogEntry,
} from "./prompts/parse-request";

export interface AiClient {
  create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
}

export function anthropicClient(): AiClient {
  const client = new Anthropic();
  return { create: (params) => client.messages.create(params) };
}

export interface DraftItem extends LineItem {
  /** For a line the app couldn't match to his words: the owner has to confirm it. */
  needsConfirm: boolean;
}

export interface ParsedRequest {
  kind: DocKind;
  customerName: string;
  items: DraftItem[];
  notes: string;
  /** Follow-up questions to ask before the invoice is made, each with tap-able answers. */
  questions: FollowUp[];
  model: string;
  promptVersion: string;
}

export interface FollowUp {
  question: string;
  options: string[];
}

export const MAX_ANSWERS = 3;

/** His answers as they come from the browser: kept only when both sides are real text. */
export function cleanAnswers(raw: unknown): DetailAnswer[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_ANSWERS)
    .map((a) => (a && typeof a === "object" ? (a as Record<string, unknown>) : {}))
    .map((a) => ({ question: asString(a.question, 200), answer: asString(a.answer, 200) }))
    .filter((a) => a.question && a.answer);
}

/** What counts as "said": his words plus his answers to the follow-up questions. */
export const heardText = (transcript: string, answers: DetailAnswer[]): string =>
  [transcript, ...answers.map((a) => a.answer)].join(" \n ");

export type ParseResult = { ok: true; value: ParsedRequest } | { ok: false; error: string };

const SPOKEN_NUMBERS: Record<string, number> = {
  un: 1, uno: 1, una: 1, one: 1, a: 1,
  dos: 2, two: 2, tres: 3, three: 3, cuatro: 4, four: 4, cinco: 5, five: 5,
  seis: 6, six: 6, siete: 7, seven: 7, ocho: 8, eight: 8, nueve: 9, nine: 9,
  diez: 10, ten: 10, once: 11, eleven: 11, doce: 12, twelve: 12, docena: 12, dozen: 12,
  quince: 15, fifteen: 15, veinte: 20, twenty: 20, treinta: 30, thirty: 30,
  cuarenta: 40, forty: 40, cincuenta: 50, fifty: 50, cien: 100, hundred: 100,
};

/**
 * Every amount a person could mean in what was heard, in cents: "$2,200", "2200", "2.200"
 * (Spanish thousands), "2,200.50", "1.5", "2 mil", "3k", "dos mil".
 */
export function amountsHeard(transcript: string): Set<number> {
  const out = new Set<number>();
  const text = transcript.toLowerCase();
  const add = (dollars: number) => {
    if (Number.isFinite(dollars) && dollars >= 0) out.add(Math.round(dollars * 100));
  };
  for (const m of text.matchAll(/\d[\d.,]*/g)) {
    let raw = m[0].replace(/[.,]$/, "");
    const after = text.slice(m.index! + m[0].length).trimStart();
    const multiplier = /^(mil|k)\b/.test(after) ? 1000 : /^(millones|millón|million)\b/.test(after) ? 1_000_000 : 1;
    if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(raw)) raw = raw.replace(/,/g, "");
    else if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(raw)) raw = raw.replace(/\./g, "").replace(",", ".");
    else if (/^\d+,\d{1,2}$/.test(raw)) raw = raw.replace(",", ".");
    const n = Number(raw);
    add(n);
    if (multiplier > 1) add(n * multiplier);
  }
  // "dos mil", "tres mil quinientos" are rare from dictation, but cheap to accept.
  for (const m of text.matchAll(/\b([a-záéíóúñ]+)\s+mil\b/g)) {
    const n = SPOKEN_NUMBERS[m[1]];
    if (n) add(n * 1000);
  }
  return out;
}

function quantityHeard(quantity: number, transcript: string): boolean {
  if (quantity === 1) return true;
  const text = transcript.toLowerCase();
  if (amountsHeard(text).has(Math.round(quantity * 100))) return true;
  return Object.entries(SPOKEN_NUMBERS).some(
    ([word, n]) => n === quantity && new RegExp(`\\b${word}\\b`).test(text),
  );
}

const asString = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** The plain numbers in some text, with thousands separators removed: "2,200 y 3" → {"2200","3"}. */
function numbersIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/\d[\d.,]*\d|\d/g)) {
    out.add(m[0].replace(/[.,](?=\d{3}\b)/g, ""));
    for (const part of m[0].split(/[.,]/)) out.add(part);
  }
  return out;
}

/**
 * The descriptions are rewritten to read professionally, so this is the line the wording can't
 * cross: a number in a description (coats, square feet, hours, rooms) must be one he said or one
 * already in his past items. Anything else is an invented fact.
 */
export function inventedNumbers(description: string, transcript: string, catalog: CatalogEntry[]): string[] {
  const allowed = numbersIn([transcript, ...catalog.map((c) => c.description)].join(" "));
  return [...numbersIn(description)].filter((n) => !allowed.has(n) && !/[.,]/.test(n));
}

/**
 * Check the model's answer against what was heard and what he charged before. A "said" price
 * that isn't in the transcript, or a "catalog" price that isn't in his catalog, is never trusted:
 * it becomes a suggestion he has to confirm. Returns the problems that make the answer unusable.
 */
export function checkParsed(
  input: unknown,
  transcript: string,
  catalog: CatalogEntry[],
  lang: Lang,
): { problems: string[]; value?: Omit<ParsedRequest, "model" | "promptVersion"> } {
  const problems: string[] = [];
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const rawItems = Array.isArray(r.items) ? r.items : [];
  if (rawItems.length === 0) problems.push("items: return at least one item.");
  const heard = amountsHeard(transcript);
  const catalogPrices = new Set(catalog.map((c) => c.unitPriceCents));
  const unheard = lang === "es" ? "No escuché este precio con claridad; confírmalo." : "I didn't catch this price clearly; please confirm it.";
  const unheardQty = lang === "es" ? "Revisa la cantidad." : "Check the quantity.";

  const items: DraftItem[] = rawItems.slice(0, 50).flatMap((v, i) => {
    const it = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    const description = asString(it.description, 200);
    const quantity = typeof it.quantity === "number" && it.quantity > 0 ? it.quantity : NaN;
    const price = typeof it.unit_price === "number" && it.unit_price >= 0 ? it.unit_price : NaN;
    if (!description) problems.push(`items[${i}].description is empty.`);
    const invented = description ? inventedNumbers(description, transcript, catalog) : [];
    if (invented.length) {
      problems.push(
        `items[${i}].description "${description}" has ${invented.join(", ")}, which he didn't say. Keep the professional wording but use only details he said.`,
      );
    }
    if (!Number.isFinite(quantity)) problems.push(`items[${i}].quantity must be a positive number.`);
    if (!Number.isFinite(price)) problems.push(`items[${i}].unit_price must be a number of dollars.`);
    if (!description || !Number.isFinite(quantity) || !Number.isFinite(price)) return [];
    const cents = Math.round(price * 100);
    let source = it.price_source === "said" || it.price_source === "catalog" ? it.price_source : "suggested";
    let basis = asString(it.basis, 200);
    if (source === "said" && !heard.has(cents)) {
      source = "suggested";
      basis = unheard;
    } else if (source === "catalog" && !catalogPrices.has(cents)) {
      source = "suggested";
      basis = basis || unheard;
    }
    const qtyOk = quantityHeard(quantity, transcript);
    if (!qtyOk && source !== "suggested") {
      source = "suggested";
      basis = unheardQty;
    }
    const item: DraftItem = {
      description,
      quantity,
      unitPriceCents: cents,
      source: source as LineItem["source"],
      needsConfirm: source === "suggested",
    };
    if (source === "suggested") item.basis = basis || (lang === "es" ? "Precio estimado." : "Estimated price.");
    return [item];
  });

  if (problems.length) return { problems };
  return {
    problems,
    value: {
      kind: r.kind === "estimate" ? "estimate" : "invoice",
      customerName: asString(r.customer_name, 120),
      items,
      notes: asString(r.notes, 1000),
      questions: (Array.isArray(r.questions) ? r.questions : [])
        .map((q): FollowUp => {
          const o = (q && typeof q === "object" ? q : {}) as Record<string, unknown>;
          return {
            question: asString(o.question, 120),
            options: (Array.isArray(o.options) ? o.options : []).map((x) => asString(x, 40)).filter(Boolean).slice(0, 4),
          };
        })
        .filter((q) => q.question)
        .slice(0, MAX_ANSWERS),
    },
  };
}

export const MAX_ATTEMPTS = 2;

/** One call with the record_request tool; one retry with the exact problems; then a clear failure. */
export async function parseRequest(opts: {
  transcript: string;
  lang: Lang;
  catalog: CatalogEntry[];
  today: string;
  /** His answers to the first pass's questions: the second pass writes the lines from them. */
  answers?: DetailAnswer[];
  client?: AiClient;
}): Promise<ParseResult> {
  const transcript = opts.transcript.trim().slice(0, 5000);
  if (transcript.length < 3) return { ok: false, error: "empty" };
  const answers = cleanAnswers(opts.answers);
  const heard = heardText(transcript, answers);
  const client = opts.client ?? anthropicClient();
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: parseUserMessage(transcript, opts.catalog, answers) },
  ];
  let lastProblems: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await client.create({
      model: MODEL,
      // The model thinks before answering, and that counts toward this limit.
      max_tokens: 8000,
      system: parseSystemPrompt(opts.lang, opts.today),
      messages,
      tools: [RECORD_TOOL],
      // Forcing the tool is refused by current models; the prompt asks for it and the loop retries.
      tool_choice: { type: "auto" },
    });
    const call = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const checked = call
      ? checkParsed(call.input, heard, opts.catalog, opts.lang)
      : { problems: ["You didn't call record_request."] };
    if (checked.value) {
      // He's been asked once; the second pass never asks again, whatever the model returned.
      const questions = opts.answers ? [] : checked.value.questions;
      return { ok: true, value: { ...checked.value, questions, model: MODEL, promptVersion: PARSE_PROMPT_VERSION } };
    }
    lastProblems = checked.problems;
    if (call) {
      messages.push({ role: "assistant", content: res.content });
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: call.id,
            is_error: true,
            content: `Fix these and call record_request again:\n- ${lastProblems.join("\n- ")}`,
          },
        ],
      });
    } else {
      messages.push({ role: "assistant", content: res.content.length ? res.content : "(no answer)" });
      messages.push({ role: "user", content: "Answer with the record_request tool." });
    }
  }
  return { ok: false, error: lastProblems.join(" ") };
}
