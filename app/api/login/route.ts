import { SESSION_COOKIE, SESSION_DAYS, makeSession, passwordMatches } from "@/lib/auth";
import { fail, readJson } from "@/lib/http";

export async function POST(req: Request) {
  const body = (await readJson(req)) as { password?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";
  if (!process.env.OWNER_PASSWORD || !process.env.SESSION_SECRET) return fail("auth_setup", 500);
  if (!(await passwordMatches(password))) {
    // A small fixed delay makes guessing slow without any stored state.
    await new Promise((r) => setTimeout(r, 600));
    return fail("wrong_password", 401);
  }
  const res = Response.json({ ok: true });
  res.headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${await makeSession()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${
      process.env.NODE_ENV === "production" ? "; Secure" : ""
    }`,
  );
  return res;
}
