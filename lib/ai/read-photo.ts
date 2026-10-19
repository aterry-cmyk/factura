import type Anthropic from "@anthropic-ai/sdk";
import type { DocKind, Lang } from "@/lib/types";
import { MODEL } from "./config";
import { anthropicClient, type AiClient, type TokenUsage } from "./parse";

// Photos → text. A contractor photographs their own notes, a handwritten list, a supplier's quote
// or receipt, or an old invoice. The model only copies out what's written; that text then goes
// through the same parser and the same "no number nobody said" checks as speech, and the owner
// sees and can fix it first. A photo with no writing about work or prices is refused, never
// described or guessed at.

export const READ_PROMPT_VERSION = "read-photo@1";
export const MAX_PHOTOS = 4;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_READ_CHARS = 3000;

export type PhotoType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

/** The image type from its first bytes, never from the file name. */
export function photoType(bytes: Uint8Array): PhotoType | null {
  const b = (i: number) => bytes[i];
  if (bytes.length > 3 && b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "image/jpeg";
  if (bytes.length > 8 && b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return "image/png";
  if (bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  if (bytes.length > 6 && String.fromCharCode(...bytes.slice(0, 4)) === "GIF8") return "image/gif";
  return null;
}

export const READ_TOOL: Anthropic.Tool = {
  name: "record_reading",
  description: "Record what is written in the photos that matters for an invoice or estimate.",
  input_schema: {
    type: "object",
    properties: {
      readable: { type: "boolean", description: "false when the photos have no readable writing about work, materials or prices." },
      text: {
        type: "string",
        description: "What is written, as plain lines: the customer's name if written, then each job or material with its quantity and price exactly as written. Empty when not readable.",
      },
      kind_hint: { type: "string", enum: ["invoice", "estimate", "unknown"], description: "estimate if the paper says estimate, estimado, presupuesto, cotización or quote; invoice if it says invoice, factura or bill; otherwise unknown." },
    },
    required: ["readable", "text", "kind_hint"],
  },
};

export function readSystemPrompt(lang: Lang): string {
  return [
    "You read photos that a contractor took of their own notes, a handwritten list, a supplier's quote or receipt, or an old invoice or estimate. Answer only with the record_reading tool.",
    "Copy out what is written that matters for billing a customer: the customer's name if it's written, each job or material, its quantity and its price.",
    "Rules:",
    "- Copy numbers exactly as written. Never add, total, estimate, convert or calculate anything, and never write a number that isn't in the photo.",
    "- Don't describe the photo, the room or the damage. Only what is written.",
    "- Keep the language it's written in. One item per line, like: \"Pintar cocina 2 manos – 2200\".",
    "- Skip totals, taxes, phone numbers, addresses and anything that isn't a job, material, quantity, price or the customer's name.",
    "- If you can't read it, or it has no writing about work or prices (a photo of a wall, a person, a view), set readable to false and text to \"\".",
    `- The owner's app is in ${lang === "es" ? "Spanish" : "English"}, but copy the writing as it is.`,
  ].join("\n");
}

export type ReadResult =
  | { ok: true; text: string; kindHint: DocKind | null; usage: TokenUsage }
  | { ok: false; error: "unreadable" | "failed"; usage: TokenUsage };

/** Cleans what the model wrote: plain text only, no markup, a sane length. */
export function cleanReading(text: unknown): string {
  return typeof text === "string"
    ? text.replace(/<[^>]*>/g, "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_READ_CHARS)
    : "";
}

export async function readPhotos(opts: {
  photos: { type: PhotoType; base64: string }[];
  lang: Lang;
  client?: AiClient;
}): Promise<ReadResult> {
  const usage: TokenUsage = { input: 0, output: 0 };
  if (!opts.photos.length) return { ok: false, error: "unreadable", usage };
  const client = opts.client ?? anthropicClient();
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: [
        ...opts.photos.map((p): Anthropic.ImageBlockParam => ({ type: "image", source: { type: "base64", media_type: p.type, data: p.base64 } })),
        { type: "text", text: "Copy out what's written that matters for an invoice or estimate." },
      ],
    },
  ];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await client.create({
      model: MODEL,
      max_tokens: 4000,
      system: readSystemPrompt(opts.lang),
      messages,
      tools: [READ_TOOL],
      tool_choice: { type: "auto" },
    });
    usage.input += res.usage?.input_tokens ?? 0;
    usage.output += res.usage?.output_tokens ?? 0;
    const call = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!call) {
      messages.push({ role: "assistant", content: res.content.length ? res.content : "(no answer)" });
      messages.push({ role: "user", content: "Answer with the record_reading tool." });
      continue;
    }
    const input = (call.input ?? {}) as Record<string, unknown>;
    const text = cleanReading(input.text);
    if (input.readable !== true || text.length < 3) return { ok: false, error: "unreadable", usage };
    const kindHint = input.kind_hint === "estimate" ? "estimate" : input.kind_hint === "invoice" ? "invoice" : null;
    return { ok: true, text, kindHint, usage };
  }
  return { ok: false, error: "failed", usage };
}
