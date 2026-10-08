import { redeemResetLink } from "@/lib/accounts";
import { sessionCookie } from "@/lib/auth";
import { fail, readJson } from "@/lib/http";
import { startSession } from "@/lib/session";

/** A one-time link from an admin: set a new password, sign out everywhere else, sign in here. */
export async function POST(req: Request) {
  const body = (await readJson(req)) as { token?: unknown; password?: unknown } | null;
  try {
    const r = await redeemResetLink(body?.token, body?.password);
    if (!r.ok) return fail(r.error, r.error === "link_invalid" ? 410 : 400);
    const res = Response.json({ ok: true });
    res.headers.append("Set-Cookie", sessionCookie(await startSession(r.userId, r.accountId)));
    return res;
  } catch (err) {
    return fail("reset_failed", 500, err);
  }
}
