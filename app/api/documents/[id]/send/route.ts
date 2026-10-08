import { appBase, deliver } from "@/lib/deliver";
import { fail, readJson } from "@/lib/http";
import { getDocument } from "@/lib/store";
import { routeCtx } from "@/lib/session";

export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const body = (await readJson(req)) as { channel?: unknown } | null;
  const channel = body?.channel === "sms" ? "sms" : body?.channel === "email" ? "email" : null;
  if (!channel) return fail("bad_channel", 400);
  const doc = await getDocument(ctx.accountId, id);
  if (!doc) return fail("not_found", 404);
  try {
    const result = await deliver(doc, channel, appBase(req.url));
    if (!result.ok) return fail(result.reason, result.reason === "setup" ? 501 : result.reason === "failed" ? 502 : 409);
    return Response.json({ ok: true });
  } catch (err) {
    return fail("failed", 502, err);
  }
}
