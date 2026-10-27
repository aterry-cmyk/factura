import type Anthropic from "@anthropic-ai/sdk";
import type { Lang } from "@/lib/types";
import { validatePlan, type PlanMilestone } from "@/lib/projects";
import { MODEL } from "./config";
import { anthropicClient, type AiClient, type TokenUsage } from "./parse";
import { PLAN_PROMPT_VERSION, PLAN_TOOL, planSystemPrompt, planUserMessage } from "./prompts/plan-project";

// The planner: milestones (with a share of the price each) and the checklist steps inside them,
// proposed from the job and the estimate's items. Structured output only; the result goes through
// validatePlan, one retry with the exact problems, then a clear failure. The owner edits and
// confirms the plan before anything is saved, and amounts are never written by the model.

export type PlanResult =
  | { ok: true; plan: PlanMilestone[]; model: string; promptVersion: string; usage: TokenUsage }
  | { ok: false; error: string; usage: TokenUsage };

export async function planProject(opts: {
  name: string; description: string; items: { description: string; quantity: number }[]; trade: string; lang: Lang; client?: AiClient;
}): Promise<PlanResult> {
  const usage: TokenUsage = { input: 0, output: 0 };
  const client = opts.client ?? anthropicClient();
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: planUserMessage(opts) }];
  let lastError = "no_answer";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await client.create({
      model: MODEL,
      max_tokens: 2500,
      system: planSystemPrompt(opts.lang),
      messages,
      tools: [PLAN_TOOL as Anthropic.Tool],
      tool_choice: { type: "tool", name: PLAN_TOOL.name },
    });
    usage.input += res.usage?.input_tokens ?? 0;
    usage.output += res.usage?.output_tokens ?? 0;
    const call = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const raw = call ? (call.input as { milestones?: unknown } | null)?.milestones : undefined;
    const checked = validatePlan(raw);
    if (checked.ok) return { ok: true, plan: checked.value, model: res.model ?? MODEL, promptVersion: PLAN_PROMPT_VERSION, usage };
    lastError = checked.errors.join(" ");
    messages.push({ role: "assistant", content: res.content.length ? res.content : "(no answer)" });
    messages.push({ role: "user", content: `The plan has problems; fix them and call plan_project again:\n${checked.errors.map((e) => `- ${e}`).join("\n")}` });
  }
  return { ok: false, error: lastError, usage };
}
