import { blockForCtx, recordUsage } from "@/lib/accounts";
import { aiConfigured } from "@/lib/ai/config";
import { planProject } from "@/lib/ai/plan-project";
import { fail, readJson } from "@/lib/http";
import { routeCtx } from "@/lib/session";
import { getDocument, getSettings } from "@/lib/store";

export const maxDuration = 60;

/** The planner proposes milestones and a checklist for the job. Nothing is saved: the owner edits and confirms. */
export async function POST(req: Request) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  if (!aiConfigured()) return fail("ai_setup", 501);
  const block = await blockForCtx(ctx, "ai");
  if (block) return Response.json({ error: block }, { status: 402 });
  const body = (await readJson(req)) as { name?: unknown; description?: unknown; estimateId?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 160) : "";
  const description = typeof body?.description === "string" ? body.description.trim().slice(0, 4000) : "";
  if (!name && !description) return fail("empty", 400);
  const est = typeof body?.estimateId === "string" ? await getDocument(ctx.accountId, body.estimateId) : null;
  const items = est?.kind === "estimate" ? est.items.map((i) => ({ description: i.description, quantity: i.quantity })) : [];
  try {
    const settings = await getSettings(ctx.accountId);
    const result = await planProject({ name, description, items, trade: settings.trade, lang: settings.lang });
    await recordUsage(ctx.accountId, "ai_request", 1, result.usage);
    if (!result.ok) return fail("plan_failed", 502, result.error);
    return Response.json({ plan: result.plan, ai: { model: result.model, promptVersion: result.promptVersion } });
  } catch (err) {
    return fail("plan_failed", 502, err);
  }
}
