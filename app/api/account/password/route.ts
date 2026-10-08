import { changePassword } from "@/lib/accounts";
import { fail, readJson } from "@/lib/http";
import { endOtherSessions, routeCtx } from "@/lib/session";

/** Needs the current password; every other device is signed out afterwards. */
export async function POST(req: Request) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  const body = (await readJson(req)) as { current?: unknown; next?: unknown } | null;
  const r = await changePassword(ctx.userId, body?.current, body?.next);
  if (!r.ok) return fail(r.error, r.error === "wrong_password" ? 401 : 400);
  await endOtherSessions(ctx.userId, ctx.sessionId);
  return Response.json({ ok: true });
}
