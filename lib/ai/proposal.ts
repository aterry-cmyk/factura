import type Anthropic from "@anthropic-ai/sdk";
import { isUnit, MAX_LINES, MAX_SECTIONS, type ProposalLine, type ProposalSection } from "@/lib/proposal";
import type { Lang } from "@/lib/types";
import { MODEL } from "./config";
import { withTool } from "./costs";
import { anthropicClient, type AiClient, type TokenUsage } from "./parse";
import type { CatalogEntry } from "./prompts/parse-request";
import { ASK_TOOL, PROPOSAL_PROMPT_VERSION, PROPOSAL_TOOL, proposalSystemPrompt, proposalUserMessage, questionsSystemPrompt } from "./prompts/proposal";

// The proposal builder's two calls. Questions first (what a good estimator asks), then the scope
// as sections of lines. The app checks every line: a "history" cost must match the owner's own
// past price exactly or it becomes a suggestion; a quantity not found in the owner's words is
// marked as Loro's reading. Nothing is saved until the owner confirms each line on screen.

const clip = (v: unknown, n: number): string =>
  typeof v === "string" ? v.replace(/<[^>]*>/g, "").replace(/[\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim().slice(0, n) : "";

export interface ScopeQuestion { question: string; options: string[] }
export type Answer = { question: string; answer: string };
export type QuestionsResult = { ok: true; ready: boolean; questions: ScopeQuestion[]; usage: TokenUsage } | { ok: false; error: string; usage: TokenUsage };

export interface JobInput { name: string; description: string; trade: string; answers: Answer[]; lang: Lang; client?: AiClient }

export async function scopeQuestions(opts: JobInput): Promise<QuestionsResult> {
  const usage: TokenUsage = { input: 0, output: 0 };
  const client = opts.client ?? anthropicClient();
  const { input: r } = await withTool(client, {
    model: MODEL, max_tokens: 1200, system: questionsSystemPrompt(opts.lang),
    messages: [{ role: "user", content: proposalUserMessage({ ...opts, catalog: [] }) }],
    tools: [ASK_TOOL as Anthropic.Tool], tool_choice: { type: "auto" },
  }, ASK_TOOL.name, usage);
  if (!r) return { ok: false, error: "no_answer", usage };
  const asked = new Set(opts.answers.map((a) => a.question.toLowerCase()));
  const questions = (Array.isArray(r.questions) ? r.questions : []).slice(0, 5).flatMap((q) => {
    const x = (q ?? {}) as Record<string, unknown>;
    const question = clip(x.question, 200);
    const options = (Array.isArray(x.options) ? x.options : []).map((o) => clip(o, 60)).filter(Boolean).slice(0, 4);
    return question && options.length >= 2 && !asked.has(question.toLowerCase()) ? [{ question, options }] : [];
  });
  return { ok: true, ready: r.ready === true || questions.length === 0, questions, usage };
}

/** The numbers the owner gave, so a quantity can be traced back to them. */
export function numbersIn(text: string): Set<number> {
  const out = new Set<number>();
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, ""));
    if (Number.isFinite(n)) out.add(n);
  }
  return out;
}

export interface BuiltProposal { summary: string; sections: ProposalSection[] }

/** Checks the model's sections: history costs must match the catalog, quantities are traced to the owner's words. */
export function checkProposal(raw: unknown, given: string, catalog: CatalogEntry[]): { value?: BuiltProposal; errors: string[] } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const errors: string[] = [];
  const numbers = numbersIn(given);
  const byDesc = new Map(catalog.map((c) => [c.description.toLowerCase(), c.unitPriceCents]));
  let count = 0;
  const sections: ProposalSection[] = (Array.isArray(r.sections) ? r.sections : []).slice(0, MAX_SECTIONS).flatMap((sv, si) => {
    const s = (sv ?? {}) as Record<string, unknown>;
    const title = clip(s.title, 120);
    if (!title) { errors.push(`sections.${si}: needs a title`); return []; }
    const lines: ProposalLine[] = (Array.isArray(s.lines) ? s.lines : []).slice(0, 12).flatMap((lv, li) => {
      const l = (lv ?? {}) as Record<string, unknown>;
      const description = clip(l.description, 200);
      if (!description) { errors.push(`sections.${si}.lines.${li}: needs a description`); return []; }
      const quantity = typeof l.quantity === "number" && l.quantity > 0 && l.quantity <= 1_000_000 ? Math.round(l.quantity * 100) / 100 : 1;
      const unit = isUnit(l.unit) ? l.unit : "LS";
      const cents = typeof l.unit_cost === "number" && l.unit_cost >= 0 ? Math.round(l.unit_cost * 100) : 0;
      let source: ProposalLine["source"] = "suggested";
      let basis = clip(l.basis, 300);
      if (l.cost_source === "history") {
        const match = byDesc.get(description.toLowerCase()) ?? [...byDesc.entries()].find(([d]) => basis.toLowerCase().includes(d))?.[1];
        if (match !== undefined && match === cents) source = "history";
        else { source = "suggested"; basis = basis ? `${basis} (no coincide con tus precios anteriores)` : "No está en tus precios anteriores"; }
      }
      if (!cents) { source = "none"; }
      count++;
      return [{ key: `${si}-${li}`, description, quantity, unit, unitCostCents: cents, source, basis, confirmed: source === "history", quantityGiven: quantity === 1 || numbers.has(quantity) }];
    });
    return lines.length ? [{ title, lines }] : [];
  });
  if (!sections.length) errors.push("no sections with lines");
  if (count > MAX_LINES) errors.push(`more than ${MAX_LINES} lines`);
  return errors.length ? { errors } : { value: { summary: clip(r.summary, 600), sections }, errors: [] };
}

export type BuildResult = { ok: true; value: BuiltProposal; usage: TokenUsage; model: string; promptVersion: string } | { ok: false; error: string; usage: TokenUsage };

export async function buildProposal(opts: JobInput & { catalog: CatalogEntry[] }): Promise<BuildResult> {
  const usage: TokenUsage = { input: 0, output: 0 };
  const client = opts.client ?? anthropicClient();
  const given = [opts.name, opts.description, ...opts.answers.map((a) => a.answer)].join(" \n ");
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: proposalUserMessage(opts) }];
  let last = "no_answer";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { res, input: r } = await withTool(client, {
      model: MODEL, max_tokens: 4000, system: proposalSystemPrompt(opts.lang), messages,
      tools: [PROPOSAL_TOOL as Anthropic.Tool], tool_choice: { type: "auto" },
    }, PROPOSAL_TOOL.name, usage);
    const checked = checkProposal(r, given, opts.catalog);
    if (checked.value) return { ok: true, value: checked.value, usage, model: res.model ?? MODEL, promptVersion: PROPOSAL_PROMPT_VERSION };
    last = checked.errors.join(" ");
    messages.push({ role: "assistant", content: res.content.length ? res.content : "(no answer)" });
    messages.push({ role: "user", content: `The proposal has problems; fix them and call record_proposal again:\n${checked.errors.map((e) => `- ${e}`).join("\n")}` });
  }
  return { ok: false, error: last, usage };
}
