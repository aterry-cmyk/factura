import { blockForCtx, recordUsage } from "@/lib/accounts";
import { aiConfigured } from "@/lib/ai/config";
import { scopeQuestions, type Answer } from "@/lib/ai/proposal";
import { fail, readJson } from "@/lib/http";
import { getProject } from "@/lib/projects-store";
import { routeCtx } from "@/lib/session";
import { getSettings } from "@/lib/store";

export const maxDuration = 60;

const cleanAnswers = (raw: unknown): Answer[] =>
  (Array.isArray(raw) ? raw : []).slice(0, 12).flatMap((a) => {
    const x = a && typeof a === "object" ? (a as Record<string, unknown>) : {};
    const question = typeof x.question === "string" ? x.question.trim().slice(0, 200) : "";
    const answer = typeof x.answer === "string" ? x.answer.trim().slice(0, 300) : "";
    return question && answer ? [{ question, answer }] : [];
  });

/** What Loro still needs to know before writing the scope, given what the owner answered so far. */
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
  const description = typeof body?.description === "string" ? body.description.trim().slice(0, 4000) : view.project.description;
  try {
    const settings = await getSettings(ctx.accountId);
    const r = await scopeQuestions({ name: view.project.name, description, trade: settings.trade, answers: cleanAnswers(body?.answers), lang: settings.lang });
    await recordUsage(ctx.accountId, "ai_request", 1, r.usage);
    if (!r.ok) return fail("questions_failed", 502, r.error);
    return Response.json({ ready: r.ready, questions: r.questions });
  } catch (err) {
    return fail("questions_failed", 502, err);
  }
}
