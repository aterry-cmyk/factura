import { blockForCtx, recordUsage } from "@/lib/accounts";
import { aiConfigured } from "@/lib/ai/config";
import { listProducts } from "@/lib/ai/estimator";
import { DESIGN } from "@/lib/estimator/catalog";
import { isFalUrl } from "@/lib/estimator/images";
import { asChoices, asSpace } from "@/lib/estimator/request";
import { fail, readJson } from "@/lib/http";
import { routeCtx } from "@/lib/session";
import { getSettings } from "@/lib/store";

export const maxDuration = 60;

/** The preview → products to look for at Home Depot (search links, no prices) and things to confirm on site. */
export async function POST(req: Request) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  if (!aiConfigured()) return fail("ai_setup", 501);
  const block = await blockForCtx(ctx, "ai");
  if (block) return Response.json({ error: block }, { status: 402 });
  const body = (await readJson(req)) as { preview?: unknown; space?: unknown; design?: unknown } | null;
  const space = asSpace(body?.space);
  if (!isFalUrl(body?.preview) || !space) return fail("no_preview", 400);
  const design = asChoices(body?.design);
  const chosen = (DESIGN[space] ?? []).flatMap((q) => {
    const o = q.opts.find((x) => x.v === design[q.id]);
    return o ? [`${q.label.en}: ${o.label.en}`] : [];
  });
  try {
    const { lang } = await getSettings(ctx.accountId);
    const result = await listProducts({ previewUrl: body.preview as string, space, chosen, lang });
    await recordUsage(ctx.accountId, "ai_request", 1, result.usage);
    if (!result.ok) return fail("products_failed", 502);
    return Response.json({ products: result.products, notes: result.notes });
  } catch (err) {
    return fail("products_failed", 502, err);
  }
}
