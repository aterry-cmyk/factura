import { updateProfile } from "@/lib/accounts";
import { fail, readJson } from "@/lib/http";
import { routeCtx } from "@/lib/session";

/** The signed-in person's own name. */
export async function PATCH(req: Request) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  const body = (await readJson(req)) as { name?: unknown } | null;
  const error = await updateProfile(ctx.userId, body?.name);
  if (error) return fail(error, 400);
  return Response.json({ ok: true });
}
