import { blockForCtx, recordUsage } from "@/lib/accounts";
import { aiConfigured } from "@/lib/ai/config";
import { isPdf, MAX_PDF_BYTES, readPlans, takeoffText } from "@/lib/ai/costs";
import { fail } from "@/lib/http";
import { routeCtx } from "@/lib/session";
import { getSettings } from "@/lib/store";

export const maxDuration = 120;

/** A PDF of plans → the quantities as lines of text the owner checks before they become an estimate. */
export async function POST(req: Request) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  if (!aiConfigured()) return fail("ai_setup", 501);
  const block = await blockForCtx(ctx, "ai");
  if (block) return Response.json({ error: block }, { status: 402 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("plans");
  if (!(file instanceof File)) return fail("no_file", 400);
  if (file.size > MAX_PDF_BYTES) return fail("file_too_big", 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isPdf(bytes)) return fail("not_pdf", 400);
  try {
    const { lang } = await getSettings(ctx.accountId);
    const result = await readPlans({ pdfBase64: Buffer.from(bytes).toString("base64"), lang });
    await recordUsage(ctx.accountId, "ai_request", 1, result.usage);
    if (!result.ok) return fail(result.error, result.error === "unreadable" ? 422 : 502);
    return Response.json({ summary: result.summary, lines: result.lines, text: takeoffText(result.lines) });
  } catch (err) {
    return fail("read_failed", 502, err);
  }
}
