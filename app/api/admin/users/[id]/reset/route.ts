import { createResetLink, RESET_HOURS } from "@/lib/accounts";
import { userInAnyAccount } from "@/lib/admin";
import { appBase } from "@/lib/deliver";
import { fail } from "@/lib/http";
import { routeCtx } from "@/lib/session";

/**
 * A one-time link to set a new password, shown once to the admin to send by hand. Email isn't
 * connected yet, so this is how someone who forgot their password gets back in.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await routeCtx({ admin: true });
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const user = await userInAnyAccount(id);
  if (!user) return fail("not_found", 404);
  const token = await createResetLink(id, ctx.userId);
  return Response.json({ link: `${appBase(req.url)}/reset?token=${token}`, email: user.email, hours: RESET_HOURS });
}
