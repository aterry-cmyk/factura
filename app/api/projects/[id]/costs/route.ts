import { fail, readJson } from "@/lib/http";
import { validateCost } from "@/lib/costs";
import { addCost, listCosts } from "@/lib/costs-store";
import { getProject } from "@/lib/projects-store";
import { routeCtx } from "@/lib/session";
import { todayIso } from "@/lib/money";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const view = await getProject(ctx.accountId, id);
  if (!view) return fail("not_found", 404);
  return Response.json({ costs: await listCosts(view.project.id) });
}

/** A cost the owner confirmed on screen (typed, from his words, or from a receipt). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const body = (await readJson(req)) as Record<string, unknown> | null;
  const checked = validateCost(body, todayIso());
  if (!checked.ok) return Response.json({ error: "invalid", errors: checked.errors }, { status: 400 });
  const photoId = typeof body?.receiptPhotoId === "string" && /^[0-9a-f-]{36}$/i.test(body.receiptPhotoId) ? body.receiptPhotoId : null;
  const cost = await addCost(ctx.accountId, id, checked.value, photoId);
  if (!cost) return fail("not_found", 404);
  return Response.json({ cost });
}
