import { blockForCtx, recordUsage } from "@/lib/accounts";
import { aiConfigured } from "@/lib/ai/config";
import { buildProposal, type Answer } from "@/lib/ai/proposal";
import { fail, readJson } from "@/lib/http";
import { getProject } from "@/lib/projects-store";
import { routeCtx } from "@/lib/session";
import { catalog, getSettings } from "@/lib/store";

export const maxDuration = 90;

/** The scope as sections of priced lines, from the job, the answers and the owner's own past prices. Nothing is saved here. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  if (!aiConfigured()) return fail("ai_setup", 501);
  const block = await blockForCtx(ctx, "ai");
  if (block) return Response.json({ error: block }, { status: 402 });
  const { id } = await params;
  const view = await getProject(ctx.accountId, id);
  if (!view) return fail("not_found", 404);
  const body = (await readJson(req)) as { answers?: unknown; description?: unknown } | null;
  const answers: Answer[] = (Array.isArray(body?.answers) ? body!.answers : []).slice(0, 12).flatMap((a: unknown) => {
    const x = a && typeof a === "object" ? (a as Record<string, unknown>) : {};
    const question = typeof x.question === "string" ? x.question.trim().slice(0, 200) : "";
    const answer = typeof x.answer === "string" ? x.answer.trim().slice(0, 300) : "";
    return question && answer ? [{ question, answer }] : [];
  });
  const description = typeof body?.description === "string" ? body.description.trim().slice(0, 4000) : view.project.description;
  try {
    const [settings, past] = await Promise.all([getSettings(ctx.accountId), catalog(ctx.accountId)]);
    const r = await buildProposal({ name: view.project.name, description, trade: settings.trade, answers, lang: settings.lang, catalog: past });
    await recordUsage(ctx.accountId, "ai_request", 1, r.usage);
    if (!r.ok) return fail("build_failed", 502, r.error);
    return Response.json({ ...r.value, markupPercent: settings.markupPercent, contingencyPercent: settings.contingencyPercent, ai: { model: r.model, promptVersion: r.promptVersion } });
  } catch (err) {
    return fail("build_failed", 502, err);
  }
}
