import { fail } from "@/lib/http";
import { removeCost } from "@/lib/costs-store";
import { routeCtx } from "@/lib/session";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; costId: string }> }) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  const { id, costId } = await params;
  if (!(await removeCost(ctx.accountId, id, costId))) return fail("not_found", 404);
  return Response.json({ ok: true });
}
