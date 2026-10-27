import { fail, readJson } from "@/lib/http";
import { validateBudgets } from "@/lib/costs";
import { setBudgets } from "@/lib/costs-store";
import { routeCtx } from "@/lib/session";

/** What the owner expects to spend per cost code; the P&L measures against it. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const checked = validateBudgets(await readJson(req));
  if (!checked.ok) return Response.json({ error: "invalid", errors: checked.errors }, { status: 400 });
  if (!(await setBudgets(ctx.accountId, id, checked.value))) return fail("not_found", 404);
  return Response.json({ ok: true });
}
