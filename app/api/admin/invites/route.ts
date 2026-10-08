import { createInvite, INVITE_DAYS } from "@/lib/accounts";
import { appBase } from "@/lib/deliver";
import { fail, readJson } from "@/lib/http";
import { routeCtx } from "@/lib/session";

/** An invitation link for one email address, shown once to the admin to send by hand. */
export async function POST(req: Request) {
  const ctx = await routeCtx({ admin: true });
  if (ctx instanceof Response) return ctx;
  const body = (await readJson(req)) as { email?: unknown } | null;
  const invite = await createInvite(body?.email, ctx.userId);
  if (!invite) return fail("invalid_email", 400);
  return Response.json({ link: `${appBase(req.url)}/signup?invite=${invite.token}`, email: invite.email, days: INVITE_DAYS });
}
