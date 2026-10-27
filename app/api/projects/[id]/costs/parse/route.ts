import { blockForCtx, recordUsage } from "@/lib/accounts";
import { aiConfigured } from "@/lib/ai/config";
import { recordCosts } from "@/lib/ai/costs";
import { getBurden, listWorkers } from "@/lib/costs-store";
import { fail, readJson } from "@/lib/http";
import { todayIso } from "@/lib/money";
import { getProject } from "@/lib/projects-store";
import { routeCtx } from "@/lib/session";
import { getSettings } from "@/lib/store";

export const maxDuration = 60;

/** "Hoy trabajaron Pedro y Luis 8 horas, y $340 de pintura en Home Depot" → entries to confirm. Nothing is saved here. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  if (!aiConfigured()) return fail("ai_setup", 501);
  const block = await blockForCtx(ctx, "ai");
  if (block) return Response.json({ error: block }, { status: 402 });
  const { id } = await params;
  const body = (await readJson(req)) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text : "";
  if (!text.trim()) return fail("empty", 400);
  if (!(await getProject(ctx.accountId, id))) return fail("not_found", 404);
  try {
    const [settings, workers, burden] = await Promise.all([getSettings(ctx.accountId), listWorkers(ctx.accountId, true), getBurden(ctx.accountId)]);
    const result = await recordCosts({ text, workers, burden, lang: settings.lang, today: todayIso() });
    await recordUsage(ctx.accountId, "ai_request", 1, result.usage);
    if (!result.ok) return fail(result.error === "nothing_found" ? "nothing_found" : "parse_failed", result.error === "nothing_found" ? 422 : 502);
    return Response.json({ entries: result.entries });
  } catch (err) {
    return fail("parse_failed", 502, err);
  }
}
