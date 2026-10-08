import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { looksLikeToken, newToken, SESSION_COOKIE, SESSION_DAYS, tokenId } from "./auth";
import { sql } from "./db";
import { fail } from "./http";
import type { AccountStatus, PlanId } from "./plans";

// Who is signed in, read from the session cookie and the database. Every page and route asks this
// itself (proxy.ts only redirects early), as the Next.js data-security guide recommends.

export interface Ctx {
  sessionId: string;
  userId: string;
  email: string;
  name: string;
  isAdmin: boolean;
  accountId: string;
  accountName: string;
  role: "owner" | "member";
  plan: PlanId;
  status: AccountStatus;
  trialEndsAt: string;
}

export async function lookupSession(token: string | undefined): Promise<Ctx | null> {
  if (!looksLikeToken(token)) return null;
  const id = tokenId(token);
  const [r] = await sql()`
    select s.id as sid, s.last_seen_at, u.id as uid, u.email, u.name, u.is_admin, a.id as aid, a.name as aname,
           a.plan, a.status, a.trial_ends_at, m.role
    from sessions s
    join users u on u.id = s.user_id
    join accounts a on a.id = s.account_id
    join memberships m on m.account_id = a.id and m.user_id = u.id
    where s.id = ${id} and s.expires_at > now()`;
  if (!r) return null;
  // Keep "last active" fresh without writing on every request.
  if (Date.now() - new Date(r.last_seen_at as string).getTime() > 10 * 60_000) {
    await sql()`update sessions set last_seen_at = now() where id = ${id}`;
  }
  return {
    sessionId: String(r.sid),
    userId: String(r.uid),
    email: String(r.email),
    name: String(r.name),
    isAdmin: Boolean(r.is_admin),
    accountId: String(r.aid),
    accountName: String(r.aname),
    role: r.role === "member" ? "member" : "owner",
    plan: r.plan as PlanId,
    status: r.status as AccountStatus,
    trialEndsAt: new Date(r.trial_ends_at as string).toISOString(),
  };
}

/** The signed-in person for this request (looked up once per request). */
export const getCtx = cache(async (): Promise<Ctx | null> => lookupSession((await cookies()).get(SESSION_COOKIE)?.value));

/** For pages: the signed-in person, or off to the sign-in page. */
export async function pageCtx(): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");
  return ctx;
}

/** For admin pages: anyone who isn't a platform admin sees a plain 404. */
export async function adminPageCtx(): Promise<Ctx> {
  const ctx = await pageCtx();
  if (!ctx.isAdmin) notFound();
  return ctx;
}

/** For routes: `const ctx = await routeCtx(); if (ctx instanceof Response) return ctx;` */
export async function routeCtx(opts: { admin?: boolean } = {}): Promise<Ctx | Response> {
  const ctx = await getCtx();
  if (!ctx) return fail("signed_out", 401);
  if (opts.admin && !ctx.isAdmin) return fail("not_found", 404);
  return ctx;
}

/** A new session for this person in this account; returns the cookie's token. */
export async function startSession(userId: string, accountId: string): Promise<string> {
  const token = newToken();
  await sql()`insert into sessions (id, user_id, account_id, expires_at)
    values (${tokenId(token)}, ${userId}, ${accountId}, now() + ${`${SESSION_DAYS} days`}::interval)`;
  await sql()`update users set last_login_at = now() where id = ${userId}`;
  // Old expired sessions are swept whenever someone signs in.
  await sql()`delete from sessions where expires_at < now()`;
  return token;
}

export async function endSession(token: string | undefined): Promise<void> {
  if (looksLikeToken(token)) await sql()`delete from sessions where id = ${tokenId(token)}`;
}

/** Signs this person out everywhere except (optionally) the session in use. */
export async function endOtherSessions(userId: string, keepSessionId?: string): Promise<number> {
  const rows = keepSessionId
    ? await sql()`delete from sessions where user_id = ${userId} and id <> ${keepSessionId} returning id`
    : await sql()`delete from sessions where user_id = ${userId} returning id`;
  return rows.length;
}

/** Only what the header shows; never send the session id or plan details to the browser. */
export const headerUser = (ctx: Ctx) => ({ name: ctx.name, email: ctx.email, isAdmin: ctx.isAdmin });
