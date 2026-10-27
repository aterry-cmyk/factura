import { blockForCtx, recordUsage } from "@/lib/accounts";
import { aiConfigured } from "@/lib/ai/config";
import { searchPrices } from "@/lib/ai/costs";
import { ownPrices, saveLookup } from "@/lib/costs-store";
import { onebuildConfigured, searchOnebuild } from "@/lib/prices/onebuild";
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
  const settings0 = await getSettings(ctx.accountId);
  const zip0 = /\b\d{5}\b/.exec(settings0.address)?.[0] ?? "";
  // The licensed feed first: county-level material and labor rates, when the key is set.
  const feed = onebuildConfigured() ? await searchOnebuild({ query, zip: zip0, state: settings0.state }) : null;
  const rates = feed?.ok ? feed.options : [];
  if (feed && !feed.ok && feed.error === "failed") console.error("[onebuild]", feed.detail);
  if (!aiConfigured()) return Response.json({ own, rates, options: [], search: "ai_setup", feed: feed ? (feed.ok ? "ok" : feed.error) : "setup" });
  const block = await blockForCtx(ctx, "ai");
  if (block) return Response.json({ error: block }, { status: 402 });
  try {
    const result = await searchPrices({ query, zip: zip0, lang: settings0.lang });
    await recordUsage(ctx.accountId, "ai_request", 1, result.usage);
    if (!result.ok) return Response.json({ own, rates, options: [], search: result.error, feed: feed ? (feed.ok ? "ok" : feed.error) : "setup" });
    if (result.options.length) await saveLookup(ctx.accountId, query, result.options);
    return Response.json({ own, rates, options: result.options, search: "ok", feed: feed ? (feed.ok ? "ok" : feed.error) : "setup", foundOn: new Date().toISOString().slice(0, 10) });
  } catch (err) {
    return fail("search_failed", 502, err);
  }
}
