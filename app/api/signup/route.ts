import { signUp } from "@/lib/accounts";
import { sessionCookie } from "@/lib/auth";
import { clientIp, fail, readJson } from "@/lib/http";
import { startSession } from "@/lib/session";

/** A new business on a free trial. Needs an invitation unless an admin opened sign-ups. */
export async function POST(req: Request) {
  const body = (await readJson(req)) as Record<string, unknown> | null;
  try {
    const r = await signUp({
      name: body?.name, email: body?.email, password: body?.password, invite: body?.invite,
      lang: body?.lang === "en" ? "en" : "es", ip: clientIp(req),
    });
    if (!r.ok) {
      const status = r.error === "email_taken" ? 409 : r.error === "invite_needed" ? 403 : r.error === "too_many" ? 429 : 400;
      return fail(r.error, status);
    }
    const res = Response.json({ ok: true });
    res.headers.append("Set-Cookie", sessionCookie(await startSession(r.userId, r.accountId)));
    return res;
  } catch (err) {
    return fail("signup_failed", 500, err);
  }
}
