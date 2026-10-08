import { sql } from "./db";
import { isPlan, isStatus, monthRange, type AccountStatus, type PlanId } from "./plans";

// The platform admin's view: every account with its plan, fee and usage. Counts only; an admin
// never sees a client's invoices or customers from here.

export interface AccountRow {
  id: string;
  name: string;
  ownerEmail: string;
  ownerName: string;
  plan: PlanId;
  status: AccountStatus;
  trialEndsAt: string;
  monthlyFeeCents: number;
  createdAt: string;
  lastActive: string | null;
  documentsThisMonth: number;
  aiThisMonth: number;
  documentsTotal: number;
  claimed: boolean;
}

const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());

export async function listAccounts(now = new Date()): Promise<AccountRow[]> {
  const { start } = monthRange(now);
  const rows = await sql()`
    select a.id, coalesce(nullif(s.business_name, ''), nullif(a.name, ''), '') as name, a.plan, a.status,
      a.trial_ends_at, a.monthly_fee_cents, a.created_at,
      o.email as owner_email, o.name as owner_name,
      (select max(greatest(se.last_seen_at, u.last_login_at)) from memberships m join users u on u.id = m.user_id
         left join sessions se on se.user_id = u.id where m.account_id = a.id) as last_active,
      (select coalesce(sum(quantity), 0) from usage_events e where e.account_id = a.id and e.kind = 'document' and e.created_at >= ${start})::int as docs_month,
      (select coalesce(sum(quantity), 0) from usage_events e where e.account_id = a.id and e.kind = 'ai_request' and e.created_at >= ${start})::int as ai_month,
      (select count(*) from documents d where d.account_id = a.id)::int as docs_total,
      exists (select 1 from memberships m where m.account_id = a.id) as claimed
    from accounts a
    left join settings s on s.account_id = a.id
    left join lateral (select u.email, u.name from memberships m join users u on u.id = m.user_id
      where m.account_id = a.id order by (m.role = 'owner') desc, m.created_at limit 1) o on true
    order by a.created_at desc`;
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    ownerEmail: r.owner_email ? String(r.owner_email) : "",
    ownerName: r.owner_name ? String(r.owner_name) : "",
    plan: r.plan as PlanId,
    status: r.status as AccountStatus,
    trialEndsAt: iso(r.trial_ends_at)!,
    monthlyFeeCents: Number(r.monthly_fee_cents),
    createdAt: iso(r.created_at)!,
    lastActive: iso(r.last_active),
    documentsThisMonth: Number(r.docs_month),
    aiThisMonth: Number(r.ai_month),
    documentsTotal: Number(r.docs_total),
    claimed: Boolean(r.claimed),
  }));
}

export interface PlatformTotals {
  accounts: number;
  trials: number;
  trialsOver: number;
  pro: number;
  comped: number;
  suspended: number;
  monthlyRevenueCents: number;
  newThisMonth: number;
}

/** Monthly revenue counts the fee of active Pro accounts: what they've agreed to pay, not card charges. */
export function platformTotals(rows: AccountRow[], now = Date.now()): PlatformTotals {
  const start = monthRange(new Date(now)).start;
  const active = rows.filter((r) => r.status === "active");
  return {
    accounts: rows.length,
    trials: active.filter((r) => r.plan === "trial" && Date.parse(r.trialEndsAt) >= now).length,
    trialsOver: active.filter((r) => r.plan === "trial" && Date.parse(r.trialEndsAt) < now).length,
    pro: active.filter((r) => r.plan === "pro").length,
    comped: active.filter((r) => r.plan === "comped").length,
    suspended: rows.filter((r) => r.status === "suspended").length,
    monthlyRevenueCents: active.filter((r) => r.plan === "pro").reduce((t, r) => t + r.monthlyFeeCents, 0),
    newThisMonth: rows.filter((r) => r.createdAt >= start).length,
  };
}

export interface AccountDetail {
  id: string;
  name: string;
  plan: PlanId;
  status: AccountStatus;
  trialEndsAt: string;
  monthlyFeeCents: number;
  billingEmail: string;
  billingNotes: string;
  createdAt: string;
  people: { id: string; email: string; name: string; role: string; isAdmin: boolean; lastLogin: string | null }[];
  usage: { month: string; documents: number; ai: number; inputTokens: number; outputTokens: number; voiceChars: number; email: number; sms: number }[];
}

export async function getAccount(id: string): Promise<AccountDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [a] = await sql()`select a.*, coalesce(nullif(s.business_name, ''), nullif(a.name, ''), '') as display_name
    from accounts a left join settings s on s.account_id = a.id where a.id = ${id}`;
  if (!a) return null;
  const people = await sql()`select u.id, u.email, u.name, u.is_admin, u.last_login_at, m.role
    from memberships m join users u on u.id = m.user_id where m.account_id = ${id} order by m.created_at`;
  const usage = await sql()`
    select to_char(date_trunc('month', created_at at time zone 'UTC'), 'YYYY-MM') as month, kind,
      sum(quantity)::bigint as q, sum(input_tokens)::bigint as tin, sum(output_tokens)::bigint as tout
    from usage_events where account_id = ${id} and created_at >= date_trunc('month', now()) - interval '5 months'
    group by 1, 2 order by 1 desc`;
  const months = new Map<string, AccountDetail["usage"][number]>();
  for (const r of usage) {
    const m = String(r.month);
    const row = months.get(m) ?? { month: m, documents: 0, ai: 0, inputTokens: 0, outputTokens: 0, voiceChars: 0, email: 0, sms: 0 };
    const q = Number(r.q);
    if (r.kind === "document") row.documents = q;
    if (r.kind === "ai_request") { row.ai = q; row.inputTokens = Number(r.tin); row.outputTokens = Number(r.tout); }
    if (r.kind === "voice_chars") row.voiceChars = q;
    if (r.kind === "email") row.email = q;
    if (r.kind === "sms") row.sms = q;
    months.set(m, row);
  }
  return {
    id: String(a.id),
    name: String(a.display_name),
    plan: a.plan as PlanId,
    status: a.status as AccountStatus,
    trialEndsAt: iso(a.trial_ends_at)!,
    monthlyFeeCents: Number(a.monthly_fee_cents),
    billingEmail: String(a.billing_email),
    billingNotes: String(a.billing_notes),
    createdAt: iso(a.created_at)!,
    people: people.map((p) => ({
      id: String(p.id), email: String(p.email), name: String(p.name), role: String(p.role),
      isAdmin: Boolean(p.is_admin), lastLogin: iso(p.last_login_at),
    })),
    usage: [...months.values()],
  };
}

export interface AccountChange {
  plan: PlanId;
  status: AccountStatus;
  trialEndsAt: string;
  monthlyFeeCents: number;
  billingEmail: string;
  billingNotes: string;
}

/** Checks an admin's edit; returns the clean values or the field names that are wrong. */
export function validateAccountChange(raw: unknown): { ok: true; value: AccountChange } | { ok: false; errors: string[] } {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const errors: string[] = [];
  if (!isPlan(b.plan)) errors.push("plan");
  if (!isStatus(b.status)) errors.push("status");
  const trial = typeof b.trialEndsAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.trialEndsAt) ? b.trialEndsAt : null;
  if (!trial || Number.isNaN(Date.parse(trial))) errors.push("trialEndsAt");
  const fee = typeof b.monthlyFeeCents === "number" && Number.isInteger(b.monthlyFeeCents) ? b.monthlyFeeCents : -1;
  if (fee < 0 || fee > 10_000_000) errors.push("monthlyFeeCents");
  const email = typeof b.billingEmail === "string" ? b.billingEmail.trim().toLowerCase() : "";
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("billingEmail");
  const notes = typeof b.billingNotes === "string" ? b.billingNotes.trim() : "";
  if (notes.length > 2000) errors.push("billingNotes");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      plan: b.plan as PlanId, status: b.status as AccountStatus,
      // The trial runs to the end of the chosen day (UTC).
      trialEndsAt: `${trial}T23:59:59.000Z`,
      monthlyFeeCents: fee, billingEmail: email, billingNotes: notes,
    },
  };
}

export async function updateAccount(id: string, c: AccountChange): Promise<boolean> {
  const rows = await sql()`update accounts set plan = ${c.plan}, status = ${c.status}, trial_ends_at = ${c.trialEndsAt},
    monthly_fee_cents = ${c.monthlyFeeCents}, billing_email = ${c.billingEmail}, billing_notes = ${c.billingNotes}
    where id = ${id} returning id`;
  return rows.length === 1;
}

export async function userInAnyAccount(userId: string): Promise<{ email: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
  const [u] = await sql()`select email from users where id = ${userId}`;
  return u ? { email: String(u.email) } : null;
}
