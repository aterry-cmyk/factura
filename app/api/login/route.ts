import { signIn } from "@/lib/accounts";
import { sessionCookie } from "@/lib/auth";
import { clientIp, fail, readJson } from "@/lib/http";
import { startSession } from "@/lib/session";

export async function POST(req: Request) {
  const body = (await readJson(req)) as { email?: unknown; password?: unknown } | null;
  try {
    const r = await signIn(body?.email, body?.password, clientIp(req));
    if (!r.ok) {
      // A small fixed delay makes guessing slower on top of the attempt limit.
      await new Promise((ok) => setTimeout(ok, 400));
      return fail(r.error, r.error === "too_many" ? 429 : 401);
    }
    const res = Response.json({ ok: true });
    res.headers.append("Set-Cookie", sessionCookie(await startSession(r.userId, r.accountId)));
    return res;
  } catch (err) {
    return fail("login_failed", 500, err);
  }
}
