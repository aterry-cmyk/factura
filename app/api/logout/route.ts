import { clearedCookie, SESSION_COOKIE } from "@/lib/auth";
import { endSession } from "@/lib/session";
import { cookies } from "next/headers";

export async function POST() {
  await endSession((await cookies()).get(SESSION_COOKIE)?.value);
  const res = Response.json({ ok: true });
  res.headers.append("Set-Cookie", clearedCookie());
  return res;
}
