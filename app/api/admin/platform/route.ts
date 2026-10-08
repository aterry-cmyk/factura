import { setSignupsOpen } from "@/lib/accounts";
import { fail, readJson } from "@/lib/http";
import { routeCtx } from "@/lib/session";

/** Open sign-ups to anyone, or keep them invitation-only. */
export async function PATCH(req: Request) {
  const ctx = await routeCtx({ admin: true });
  if (ctx instanceof Response) return ctx;
  const body = (await readJson(req)) as { signupsOpen?: unknown } | null;
  if (typeof body?.signupsOpen !== "boolean") return fail("invalid", 400);
  await setSignupsOpen(body.signupsOpen);
  return Response.json({ ok: true });
}
