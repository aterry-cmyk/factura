import { claim } from "@/lib/accounts";
import { sessionCookie } from "@/lib/auth";
import { clientIp, fail, readJson } from "@/lib/http";
import { startSession } from "@/lib/session";

/** The original owner takes over the data from before accounts (once), and becomes the admin. */
export async function POST(req: Request) {
  const body = (await readJson(req)) as Record<string, unknown> | null;
  try {
    const r = await claim({
      ownerPassword: body?.ownerPassword, name: body?.name, email: body?.email, password: body?.password, ip: clientIp(req),
    });
    if (!r.ok) {
      const status = r.error === "nothing_to_claim" ? 404 : r.error === "wrong_password" ? 401 : r.error === "too_many" ? 429 : r.error === "email_taken" ? 409 : 400;
      return fail(r.error, status);
    }
    const res = Response.json({ ok: true });
    res.headers.append("Set-Cookie", sessionCookie(await startSession(r.userId, r.accountId)));
    return res;
  } catch (err) {
    return fail("claim_failed", 500, err);
  }
}
