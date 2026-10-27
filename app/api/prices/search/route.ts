import { blockForCtx, recordUsage } from "@/lib/accounts";
import { aiConfigured } from "@/lib/ai/config";
import { searchPrices } from "@/lib/ai/costs";
import { ownPrices, saveLookup } from "@/lib/costs-store";
import { fail, readJson } from "@/lib/http";
import { routeCtx } from "@/lib/session";
import { getSettings } from "@/lib/store";

export const maxDuration = 60;

/**
 * A material's price: first what this business actually paid (its receipts), then a live search
 * of real product pages, each option with the page it came from and today's date. No source, no price.
 */
export async function POST(req: Request) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  const body = (await readJson(req)) as { query?: unknown } | null;
  const query = typeof body?.query === "string" ? body.query.trim().slice(0, 200) : "";
  if (query.length < 2) return fail("empty", 400);
  const own = await ownPrices(ctx.accountId, query);
  if (!aiConfigured()) return Response.json({ own, options: [], search: "ai_setup" });
  const block = await blockForCtx(ctx, "ai");
  if (block) return Response.json({ error: block }, { status: 402 });
  try {
    const settings = await getSettings(ctx.accountId);
    const zip = /\b\d{5}\b/.exec(settings.address)?.[0] ?? "";
    const result = await searchPrices({ query, zip, lang: settings.lang });
    await recordUsage(ctx.accountId, "ai_request", 1, result.usage);
    if (!result.ok) return Response.json({ own, options: [], search: result.error });
    if (result.options.length) await saveLookup(ctx.accountId, query, result.options);
    return Response.json({ own, options: result.options, search: "ok", foundOn: new Date().toISOString().slice(0, 10) });
  } catch (err) {
    return fail("search_failed", 502, err);
  }
}
