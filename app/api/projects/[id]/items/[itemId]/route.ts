import { fail, readJson } from "@/lib/http";
import { setItemDone } from "@/lib/projects-store";
import { routeCtx } from "@/lib/session";

/** Tick or untick a checklist step, with an optional note. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  const { id, itemId } = await params;
  const body = (await readJson(req)) as { done?: unknown; note?: unknown } | null;
  if (typeof body?.done !== "boolean") return fail("invalid", 400);
  const item = await setItemDone(ctx.accountId, id, itemId, body.done, typeof body.note === "string" ? body.note : undefined);
  if (!item) return fail("not_found", 404);
  return Response.json({ ok: true, doneAt: item.doneAt });
}
