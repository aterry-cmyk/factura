import {
  cleanName, dummyHash, hashPassword, looksLikeToken, newToken, normalEmail, ownerPasswordMatches,
  passwordProblem, tokenId, verifyPassword,
} from "./auth";
import { sql } from "./db";
import { blockFor, monthRange, NO_USAGE, type Block, type MonthUsage } from "./plans";
import type { Ctx } from "./session";
import type { Lang } from "./types";

// Accounts, people, passwords, one-time links and usage. Database only; the routes decide who may
// call what.

export type AuthError =
  | "invalid_email" | "password_short" | "password_weak" | "password_long" | "name_missing"
  | "wrong_login" | "too_many" | "email_taken" | "invite_needed" | "link_invalid" | "wrong_password"
  | "nothing_to_claim";

const ATTEMPT_WINDOW = "15 minutes";
const MAX_LOGIN_FAILS = 8;
const MAX_SIGNUPS_PER_IP = 5;
export const RESET_HOURS = 48;
export const INVITE_DAYS = 14;

async function attempts(key: string, window = ATTEMPT_WINDOW): Promise<number> {
  const [r] = await sql()`select count(*)::int as n from auth_attempts where key = ${key}
    and created_at > now() - ${window}::interval`;
  return Number(r.n);
}
const noteAttempt = async (key: string) => {
  await sql()`insert into auth_attempts (key) values (${key})`;
  await sql()`delete from auth_attempts where created_at < now() - interval '1 day'`;
};

/** The account a person signs into: the first one they belong to (owners first). */
async function homeAccount(userId: string): Promise<string | null> {
  const [m] = await sql()`select account_id from memberships where user_id = ${userId}
    order by (role = 'owner') desc, created_at limit 1`;
  return m ? String(m.account_id) : null;
}

export async function signIn(
  emailRaw: unknown, password: unknown, ip: string,
): Promise<{ ok: true; userId: string; accountId: string } | { ok: false; error: AuthError }> {
  const email = normalEmail(emailRaw);
  const pw = typeof password === "string" ? password : "";
  if (!email || !pw) return { ok: false, error: "wrong_login" };
  if ((await attempts(`login:${email}`)) >= MAX_LOGIN_FAILS || (await attempts(`ip:${ip}`)) >= MAX_LOGIN_FAILS * 3) {
    return { ok: false, error: "too_many" };
  }
  const [u] = await sql()`select id, password_hash from users where email = ${email}`;
  const good = await verifyPassword(pw, u ? String(u.password_hash) : await dummyHash());
  const accountId = u && good ? await homeAccount(String(u.id)) : null;
  if (!u || !good || !accountId) {
    await noteAttempt(`login:${email}`);
    await noteAttempt(`ip:${ip}`);
    return { ok: false, error: "wrong_login" };
  }
  await sql()`delete from auth_attempts where key = ${`login:${email}`}`;
  return { ok: true, userId: String(u.id), accountId };
}

export async function signupsOpen(): Promise<boolean> {
  const [r] = await sql()`select signups_open from platform where id = 1`;
  return Boolean(r?.signups_open);
}

export async function setSignupsOpen(open: boolean): Promise<void> {
  await sql()`update platform set signups_open = ${open} where id = 1`;
}

/** The email an unused, unexpired invitation was made for, or null. */
export async function inviteEmail(token: unknown): Promise<string | null> {
  if (typeof token !== "string" || !looksLikeToken(token)) return null;
  const [r] = await sql()`select email from auth_tokens where id = ${tokenId(token)} and purpose = 'invite'
    and used_at is null and expires_at > now()`;
  return r ? String(r.email) : null;
}

/**
 * A new business: the person, their account (free trial) and its settings, in one transaction.
 * Needs an invitation for this email unless sign-ups are open.
 */
export async function signUp(input: {
  name: unknown; email: unknown; password: unknown; invite?: unknown; lang?: Lang; ip: string;
}): Promise<{ ok: true; userId: string; accountId: string } | { ok: false; error: AuthError }> {
  const email = normalEmail(input.email);
  if (!email) return { ok: false, error: "invalid_email" };
  const name = cleanName(input.name);
  if (!name) return { ok: false, error: "name_missing" };
  const problem = passwordProblem(input.password);
  if (problem) return { ok: false, error: problem };
  const invited = await inviteEmail(input.invite);
  if (invited !== email && !(await signupsOpen())) return { ok: false, error: "invite_needed" };
  if ((await attempts(`signup:${input.ip}`, "1 hour")) >= MAX_SIGNUPS_PER_IP) return { ok: false, error: "too_many" };
  await noteAttempt(`signup:${input.ip}`);
  const hash = await hashPassword(input.password as string);
  try {
    return await sql().begin(async (tx) => {
      const [u] = await tx`insert into users (email, name, password_hash) values (${email}, ${name}, ${hash}) returning id`;
      const [a] = await tx`insert into accounts (name, billing_email) values ('', ${email}) returning id`;
      await tx`insert into memberships (account_id, user_id, role) values (${a.id}, ${u.id}, 'owner')`;
      await tx`insert into settings (account_id, owner_name, email, lang) values (${a.id}, ${name}, ${email}, ${input.lang ?? "es"})`;
      if (invited) await tx`update auth_tokens set used_at = now() where id = ${tokenId(input.invite as string)}`;
      return { ok: true as const, userId: String(u.id), accountId: String(a.id) };
    });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505") {
      return { ok: false, error: "email_taken" };
    }
    throw err;
  }
}

export async function changePassword(
  userId: string, current: unknown, next: unknown,
): Promise<{ ok: true } | { ok: false; error: AuthError }> {
  const [u] = await sql()`select password_hash from users where id = ${userId}`;
  if (!u || typeof current !== "string" || !(await verifyPassword(current, String(u.password_hash)))) {
    return { ok: false, error: "wrong_password" };
  }
  const problem = passwordProblem(next);
  if (problem) return { ok: false, error: problem };
  await sql()`update users set password_hash = ${await hashPassword(next as string)} where id = ${userId}`;
  return { ok: true };
}

export async function updateProfile(userId: string, name: unknown): Promise<AuthError | null> {
  const clean = cleanName(name);
  if (!clean) return "name_missing";
  await sql()`update users set name = ${clean} where id = ${userId}`;
  return null;
}

/** A one-time link an admin sends by hand (WhatsApp, text) until email is connected. */
export async function createResetLink(userId: string, createdBy: string): Promise<string> {
  const token = newToken();
  await sql()`update auth_tokens set used_at = now() where user_id = ${userId} and purpose = 'reset' and used_at is null`;
  await sql()`insert into auth_tokens (id, purpose, user_id, created_by, expires_at)
    values (${tokenId(token)}, 'reset', ${userId}, ${createdBy}, now() + ${`${RESET_HOURS} hours`}::interval)`;
  return token;
}

export async function resetTarget(token: unknown): Promise<{ userId: string; email: string } | null> {
  if (typeof token !== "string" || !looksLikeToken(token)) return null;
  const [r] = await sql()`select u.id, u.email from auth_tokens t join users u on u.id = t.user_id
    where t.id = ${tokenId(token)} and t.purpose = 'reset' and t.used_at is null and t.expires_at > now()`;
  return r ? { userId: String(r.id), email: String(r.email) } : null;
}

/** Sets the new password, uses up the link and signs the person out everywhere. */
export async function redeemResetLink(
  token: unknown, password: unknown,
): Promise<{ ok: true; userId: string; accountId: string } | { ok: false; error: AuthError }> {
  const target = await resetTarget(token);
  if (!target) return { ok: false, error: "link_invalid" };
  const problem = passwordProblem(password);
  if (problem) return { ok: false, error: problem };
  const accountId = await homeAccount(target.userId);
  if (!accountId) return { ok: false, error: "link_invalid" };
  const hash = await hashPassword(password as string);
  await sql().begin(async (tx) => {
    await tx`update users set password_hash = ${hash} where id = ${target.userId}`;
    await tx`update auth_tokens set used_at = now() where id = ${tokenId(token as string)}`;
    await tx`delete from sessions where user_id = ${target.userId}`;
  });
  return { ok: true, userId: target.userId, accountId };
}

export async function createInvite(emailRaw: unknown, createdBy: string): Promise<{ token: string; email: string } | null> {
  const email = normalEmail(emailRaw);
  if (!email) return null;
  const token = newToken();
  await sql()`insert into auth_tokens (id, purpose, email, created_by, expires_at)
    values (${tokenId(token)}, 'invite', ${email}, ${createdBy}, now() + ${`${INVITE_DAYS} days`}::interval)`;
  return { token, email };
}

/** Data from before accounts existed: an account nobody belongs to yet. */
export async function unclaimedAccount(): Promise<{ id: string; name: string } | null> {
  const [a] = await sql()`select id, name from accounts a
    where not exists (select 1 from memberships m where m.account_id = a.id) order by created_at limit 1`;
  return a ? { id: String(a.id), name: String(a.name) } : null;
}

/**
 * The original owner proves who they are with the old OWNER_PASSWORD, picks an email and a new
 * password, and becomes the owner of the old data and the platform admin. Works once.
 */
export async function claim(input: {
  ownerPassword: unknown; name: unknown; email: unknown; password: unknown; ip: string;
}): Promise<{ ok: true; userId: string; accountId: string } | { ok: false; error: AuthError }> {
  const acct = await unclaimedAccount();
  if (!acct || !process.env.OWNER_PASSWORD) return { ok: false, error: "nothing_to_claim" };
  if ((await attempts(`claim:${input.ip}`)) >= MAX_LOGIN_FAILS) return { ok: false, error: "too_many" };
  if (typeof input.ownerPassword !== "string" || !ownerPasswordMatches(input.ownerPassword)) {
    await noteAttempt(`claim:${input.ip}`);
    return { ok: false, error: "wrong_password" };
  }
  const email = normalEmail(input.email);
  if (!email) return { ok: false, error: "invalid_email" };
  const name = cleanName(input.name);
  if (!name) return { ok: false, error: "name_missing" };
  const problem = passwordProblem(input.password);
  if (problem) return { ok: false, error: problem };
  const hash = await hashPassword(input.password as string);
  try {
    return await sql().begin(async (tx) => {
      const [u] = await tx`insert into users (email, name, password_hash, is_admin)
        values (${email}, ${name}, ${hash}, true) returning id`;
      await tx`insert into memberships (account_id, user_id, role) values (${acct.id}, ${u.id}, 'owner')`;
      await tx`update accounts set billing_email = ${email} where id = ${acct.id}`;
      return { ok: true as const, userId: String(u.id), accountId: acct.id };
    });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505") {
      return { ok: false, error: "email_taken" };
    }
    throw err;
  }
}

// ---- Usage ----

export type UsageKind = "ai_request" | "document" | "voice_chars" | "email" | "sms";

export async function recordUsage(
  accountId: string, kind: UsageKind, quantity = 1, tokens: { input?: number; output?: number } = {},
): Promise<void> {
  await sql()`insert into usage_events (account_id, kind, quantity, input_tokens, output_tokens)
    values (${accountId}, ${kind}, ${Math.max(0, Math.round(quantity))}, ${tokens.input ?? 0}, ${tokens.output ?? 0})`;
}

function toUsage(rows: Record<string, unknown>[]): MonthUsage {
  const u: MonthUsage = { ...NO_USAGE };
  for (const r of rows) {
    const q = Number(r.q);
    if (r.kind === "document") u.documents = q;
    if (r.kind === "ai_request") { u.ai = q; u.inputTokens = Number(r.tin); u.outputTokens = Number(r.tout); }
    if (r.kind === "voice_chars") u.voiceChars = q;
    if (r.kind === "email") u.email = q;
    if (r.kind === "sms") u.sms = q;
  }
  return u;
}

export async function monthUsage(accountId: string, now = new Date()): Promise<MonthUsage> {
  const { start, end } = monthRange(now);
  const rows = await sql()`select kind, sum(quantity)::bigint as q, sum(input_tokens)::bigint as tin,
      sum(output_tokens)::bigint as tout
    from usage_events where account_id = ${accountId} and created_at >= ${start} and created_at < ${end}
    group by kind`;
  return toUsage(rows);
}

/** Whether this account may make one more document / AI request right now. */
export async function blockForCtx(ctx: Pick<Ctx, "accountId" | "plan" | "status" | "trialEndsAt">, what: "document" | "ai"): Promise<Block | null> {
  return blockFor(ctx, await monthUsage(ctx.accountId), what);
}
