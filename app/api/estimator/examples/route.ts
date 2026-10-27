import { blockForCtx, recordUsage } from "@/lib/accounts";
import { examplePrompt } from "@/lib/estimator/catalog";
import { examplePicture, falConfigured } from "@/lib/estimator/images";
import { asKeys } from "@/lib/estimator/request";
import { fail, readJson } from "@/lib/http";
import { routeCtx } from "@/lib/session";

export const maxDuration = 60;

/** Example pictures for a question's options ("what does high-end look like?"), from fixed prompts. */
export async function POST(req: Request) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  if (!falConfigured()) return fail("images_setup", 501);
  const block = await blockForCtx(ctx, "ai");
  if (block) return Response.json({ error: block }, { status: 402 });
  const body = (await readJson(req)) as { keys?: unknown } | null;
  const keys = [...new Set(asKeys(body?.keys, 6))].filter((k) => examplePrompt(k));
  if (!keys.length) return fail("nothing", 400);
  const images: Record<string, string> = {};
  const errors: unknown[] = [];
  await Promise.all(keys.map(async (k) => {
    try { images[k] = await examplePicture(examplePrompt(k)); } catch (err) { errors.push(err); }
  }));
  if (!Object.keys(images).length) return fail("images_failed", 502, errors[0]);
  await recordUsage(ctx.accountId, "ai_request", 1);
  return Response.json({ images });
}
