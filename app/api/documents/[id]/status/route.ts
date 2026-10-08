import { fail, readJson } from "@/lib/http";
import { canMove } from "@/lib/doc-list";
import { getDocument, setStatus } from "@/lib/store";
import type { DocStatus } from "@/lib/types";
import { routeCtx } from "@/lib/session";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const body = (await readJson(req)) as { status?: unknown } | null;
  const doc = await getDocument(ctx.accountId, id);
  if (!doc) return fail("not_found", 404);
  const next = body?.status as DocStatus;
  if (!canMove(doc, next)) return fail("not_allowed", 409);
  await setStatus(ctx.accountId, id, next);
  return Response.json({ ok: true });
}
