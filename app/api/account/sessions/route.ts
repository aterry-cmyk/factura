import { endOtherSessions, routeCtx } from "@/lib/session";

/** "Sign out everywhere else": keeps only this device's session. */
export async function DELETE() {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  const ended = await endOtherSessions(ctx.userId, ctx.sessionId);
  return Response.json({ ok: true, ended });
}
