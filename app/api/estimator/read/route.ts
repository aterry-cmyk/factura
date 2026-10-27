import { blockForCtx, recordUsage } from "@/lib/accounts";
import { aiConfigured } from "@/lib/ai/config";
import { readSpace } from "@/lib/ai/estimator";
import { asSpace, decodePhoto } from "@/lib/estimator/request";
import { fail, readJson } from "@/lib/http";
import { routeCtx } from "@/lib/session";
import { getSettings } from "@/lib/store";

export const maxDuration = 60;

/** One photo of a room or the front of a house → what Loro sees and which projects could fit. */
export async function POST(req: Request) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  if (!aiConfigured()) return fail("ai_setup", 501);
  const block = await blockForCtx(ctx, "ai");
  if (block) return Response.json({ error: block }, { status: 402 });
  const body = (await readJson(req)) as { photo?: unknown; hint?: unknown } | null;
  const photo = decodePhoto(body?.photo);
  if (!photo) return fail("photo_type", 400);
  try {
    const { lang } = await getSettings(ctx.accountId);
    const result = await readSpace({ photo, lang, hint: asSpace(body?.hint) });
    await recordUsage(ctx.accountId, "ai_request", 1, result.usage);
    if (!result.ok) return fail(result.error === "not_home" ? "not_home" : "read_failed", result.error === "not_home" ? 422 : 502);
    return Response.json(result.value);
  } catch (err) {
    return fail("read_failed", 502, err);
  }
}
