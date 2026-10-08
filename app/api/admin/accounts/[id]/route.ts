import { updateAccount, validateAccountChange } from "@/lib/admin";
import { fail, readJson } from "@/lib/http";
import { routeCtx } from "@/lib/session";

/** Plan, status, trial end, monthly fee and billing notes. Platform admins only. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await routeCtx({ admin: true });
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const checked = validateAccountChange(await readJson(req));
  if (!checked.ok) return Response.json({ error: "invalid", errors: checked.errors }, { status: 400 });
  if (!/^[0-9a-f-]{36}$/i.test(id) || !(await updateAccount(id, checked.value))) return fail("not_found", 404);
  return Response.json({ ok: true });
}
