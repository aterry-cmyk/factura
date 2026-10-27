import { fail, readJson } from "@/lib/http";
import { validateWorker } from "@/lib/costs";
import { removeWorker, updateWorker } from "@/lib/costs-store";
import { routeCtx } from "@/lib/session";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const checked = validateWorker(await readJson(req));
  if (!checked.ok) return Response.json({ error: "invalid", errors: checked.errors }, { status: 400 });
  const worker = await updateWorker(ctx.accountId, id, checked.value);
  if (!worker) return fail("not_found", 404);
  return Response.json({ worker });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  if (!(await removeWorker(ctx.accountId, id))) return fail("not_found", 404);
  return Response.json({ ok: true });
}
