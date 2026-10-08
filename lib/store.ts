import { randomBytes } from "node:crypto";
import { sql } from "./db";
import { addDays, amountDueCents, totals } from "./money";
import type { DocFilters } from "./doc-list";
import type { CatalogEntry } from "./ai/prompts/parse-request";
import type { Business, Customer, Doc, DocKind, DocStatus, LateFee, Lang, PaymentMethods, Settings } from "./types";
import { DEFAULT_COUNTRY, isCountry } from "./voice";
import type { DraftInput } from "./validate";
import { isTrade, type WaitlistEntry, type WaitlistFilters } from "./waitlist";

type Row = Record<string, unknown>;

const n = (v: unknown): number => Number(v ?? 0);
const s = (v: unknown): string => (v == null ? "" : String(v));
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));
const day = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

function toSettings(r: Row): Settings {
  return {
    name: s(r.business_name),
    ownerName: s(r.owner_name),
    address: s(r.address),
    phone: s(r.phone),
    email: s(r.email),
    website: s(r.website),
    hasLogo: Boolean(r.has_logo),
    lang: r.lang === "en" ? "en" : "es",
    state: s(r.state),
    taxEnabled: Boolean(r.tax_enabled),
    taxRate: n(r.tax_rate),
    dueDays: n(r.due_days),
    reminderDays: n(r.reminder_days),
    lateFee: (r.late_fee as LateFee) ?? { type: "none" },
    paymentMethods: (r.payment_methods as PaymentMethods) ?? {},
    onboarded: Boolean(r.onboarded),
    country: isCountry(r.country) ? r.country : DEFAULT_COUNTRY,
    voiceOn: r.voice_on !== false,
    voiceGender: r.voice_gender === "male" ? "male" : "female",
    trade: s(r.trade),
  };
}

// Every function below that touches business data takes the account id first; nothing reads or
// writes across accounts except the reminder job and the public invoice link (by its secret token).

export async function getSettings(acct: string): Promise<Settings> {
  const [row] = await sql()`select *, logo is not null as has_logo from settings where account_id = ${acct}`;
  if (!row) throw new Error("settings missing for account");
  return toSettings(row);
}

export async function setLang(acct: string, lang: Lang): Promise<void> {
  await sql()`update settings set lang = ${lang}, updated_at = now() where account_id = ${acct}`;
}

export async function setVoice(acct: string, v: { country?: string; voiceOn?: boolean; voiceGender?: "female" | "male" }): Promise<void> {
  if (v.voiceGender !== undefined) await sql()`update settings set voice_gender = ${v.voiceGender}, updated_at = now() where account_id = ${acct}`;
  if (v.country !== undefined) await sql()`update settings set country = ${v.country}, updated_at = now() where account_id = ${acct}`;
  if (v.voiceOn !== undefined) await sql()`update settings set voice_on = ${v.voiceOn}, updated_at = now() where account_id = ${acct}`;
}

export async function saveBusiness(acct: string, b: Business): Promise<void> {
  await sql()`update settings set business_name = ${b.name}, owner_name = ${b.ownerName}, address = ${b.address},
    phone = ${b.phone}, email = ${b.email}, website = ${b.website}, updated_at = now() where account_id = ${acct}`;
}

/** The wizard's answers become next time's defaults. */
export async function saveDefaults(acct: string, d: DraftInput): Promise<void> {
  const db = sql();
  await db`update settings set business_name = ${d.business.name}, owner_name = ${d.business.ownerName},
    address = ${d.business.address}, phone = ${d.business.phone}, email = ${d.business.email},
    website = ${d.business.website}, state = ${d.state}, tax_enabled = ${d.taxRate > 0}, tax_rate = ${d.taxRate},
    due_days = ${d.dueDays}, payment_methods = ${db.json(d.paymentMethods as never)},
    ${d.kind === "invoice" ? db`reminder_days = ${d.reminderDays}, late_fee = ${db.json(d.lateFee as never)},` : db``}
    onboarded = true, updated_at = now() where account_id = ${acct}`;
}

export async function getLogo(acct: string): Promise<{ bytes: Buffer; type: string } | null> {
  const [row] = await sql()`select logo, logo_type from settings where account_id = ${acct}`;
  if (!row?.logo) return null;
  return { bytes: Buffer.from(row.logo as Uint8Array), type: s(row.logo_type) };
}

export async function setLogo(acct: string, logo: { bytes: Buffer; type: string } | null): Promise<void> {
  await sql()`update settings set logo = ${logo ? logo.bytes : null}, logo_type = ${logo?.type ?? null},
    updated_at = now() where account_id = ${acct}`;
}

/** What he has charged before: the latest price for each distinct description. */
export async function catalog(acct: string, limit = 60): Promise<CatalogEntry[]> {
  const rows = await sql()`
    select distinct on (lower(item->>'description')) item->>'description' as description,
           (item->>'unitPriceCents')::bigint as cents, d.created_at
    from documents d, jsonb_array_elements(d.items) item
    where d.account_id = ${acct} and d.status <> 'void' and item->>'source' <> 'suggested'
    order by lower(item->>'description'), d.created_at desc`;
  return rows
    .sort((a, b) => Date.parse(String(b.created_at)) - Date.parse(String(a.created_at)))
    .slice(0, limit)
    .map((r) => ({ description: s(r.description), unitPriceCents: n(r.cents) }));
}

export async function findCustomers(acct: string, query: string): Promise<(Customer & { id: string })[]> {
  const q = `%${query.trim().toLowerCase()}%`;
  const rows = await sql()`select * from customers where account_id = ${acct} and (lower(name) like ${q} or lower(company) like ${q})
    order by created_at desc limit 5`;
  return rows.map((r) => ({ id: s(r.id), name: s(r.name), company: s(r.company), email: s(r.email), phone: s(r.phone) }));
}

function toDoc(r: Row): Doc {
  return {
    id: s(r.id),
    accountId: s(r.account_id),
    kind: r.kind as DocKind,
    number: s(r.number),
    status: r.status as DocStatus,
    customer: r.customer as Customer,
    business: r.business as Business,
    lang: r.lang === "en" ? "en" : "es",
    items: r.items as Doc["items"],
    state: s(r.state),
    taxRate: n(r.tax_rate),
    subtotalCents: n(r.subtotal_cents),
    taxCents: n(r.tax_cents),
    totalCents: n(r.total_cents),
    issueDate: day(r.issue_date),
    dueDate: day(r.due_date),
    reminderDays: n(r.reminder_days),
    lateFee: r.late_fee as LateFee,
    paymentMethods: r.payment_methods as PaymentMethods,
    notes: s(r.notes),
    publicToken: s(r.public_token),
    sentAt: iso(r.sent_at),
    paidAt: iso(r.paid_at),
    lastReminderAt: iso(r.last_reminder_at),
    reminderCount: n(r.reminder_count),
    createdAt: iso(r.created_at) ?? "",
  };
}

export const newToken = (): string => randomBytes(18).toString("base64url");

/**
 * Saves a checked draft as a numbered document. The number and the customer are taken in the
 * same transaction, so two documents can never share a number.
 */
export async function createDocument(
  acct: string,
  d: DraftInput,
  meta: { today: string; model?: string; promptVersion?: string; convertedFrom?: string },
): Promise<Doc> {
  const t = totals(d.items, d.taxRate);
  return sql().begin(async (tx) => {
    const counter = d.kind === "invoice" ? "next_invoice_no" : "next_estimate_no";
    const [seq] = await tx`update settings set ${tx(counter)} = ${tx(counter)} + 1 where account_id = ${acct}
      returning ${tx(counter)} - 1 as no`;
    const number = `${d.kind === "invoice" ? "F" : "P"}-${String(n(seq.no)).padStart(4, "0")}`;
    const [existing] = await tx`select id from customers where account_id = ${acct} and lower(name) = ${d.customer.name.toLowerCase()}
      order by created_at desc limit 1`;
    let customerId: string;
    if (existing) {
      customerId = s(existing.id);
      await tx`update customers set company = ${d.customer.company},
        email = coalesce(nullif(${d.customer.email}, ''), email),
        phone = coalesce(nullif(${d.customer.phone}, ''), phone) where id = ${customerId}`;
    } else {
      const [c] = await tx`insert into customers (account_id, name, company, email, phone)
        values (${acct}, ${d.customer.name}, ${d.customer.company}, ${d.customer.email}, ${d.customer.phone}) returning id`;
      customerId = s(c.id);
    }
    const [row] = await tx`insert into documents (account_id, kind, number, customer_id, customer, business, lang, items, state,
        tax_rate, subtotal_cents, tax_cents, total_cents, issue_date, due_date, reminder_days, late_fee,
        payment_methods, notes, transcript, ai_model, prompt_version, public_token, converted_from)
      values (${acct}, ${d.kind}, ${number}, ${customerId}, ${tx.json(d.customer as never)}, ${tx.json(d.business as never)},
        ${d.lang}, ${tx.json(d.items as never)}, ${d.state}, ${d.taxRate}, ${t.subtotalCents}, ${t.taxCents},
        ${t.totalCents}, ${meta.today}, ${addDays(meta.today, d.dueDays)}, ${d.reminderDays},
        ${tx.json(d.lateFee as never)}, ${tx.json(d.paymentMethods as never)}, ${d.notes}, ${d.transcript},
        ${meta.model ?? null}, ${meta.promptVersion ?? null}, ${newToken()}, ${meta.convertedFrom ?? null})
      returning *`;
    await tx`insert into events (document_id, kind, detail) values (${s(row.id)}, 'created', ${number})`;
    return toDoc(row);
  });
}

export async function getDocument(acct: string, id: string): Promise<Doc | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await sql()`select * from documents where account_id = ${acct} and id = ${id}`;
  return row ? toDoc(row) : null;
}

export async function getByToken(token: string): Promise<Doc | null> {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  const [row] = await sql()`select * from documents where public_token = ${token} and status <> 'draft'`;
  return row ? toDoc(row) : null;
}

export async function listDocuments(acct: string, limit = 50): Promise<Doc[]> {
  const rows = await sql()`select * from documents where account_id = ${acct} order by created_at desc limit ${limit}`;
  return rows.map(toDoc);
}

/**
 * The owner's full list: search (customer, company, number, item descriptions), status (with
 * "overdue" = sent invoices past their due date), kind and issue-date range, newest first.
 */
export async function searchDocuments(
  acct: string,
  f: DocFilters,
  today: string,
  page: { limit: number; offset: number } | null,
): Promise<{ docs: Doc[]; total: number }> {
  const db = sql();
  const like = `%${f.q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const conds = [
    db`account_id = ${acct}`,
    f.q
      ? db`(lower(customer->>'name') like ${like} or lower(customer->>'company') like ${like}
          or lower(number) like ${like} or lower(items::text) like ${like})`
      : db`true`,
    f.kind === "all" ? db`true` : db`kind = ${f.kind}`,
    f.status === "all"
      ? db`true`
      : f.status === "overdue"
        ? db`kind = 'invoice' and status = 'sent' and due_date < ${today}`
        : db`status = ${f.status}`,
    f.from ? db`issue_date >= ${f.from}` : db`true`,
    f.to ? db`issue_date <= ${f.to}` : db`true`,
  ];
  const where = conds.reduce((a, c) => db`${a} and ${c}`);
  const [{ count }] = await db`select count(*)::int as count from documents where ${where}`;
  const rows = page
    ? await db`select * from documents where ${where} order by created_at desc limit ${page.limit} offset ${page.offset}`
    : await db`select * from documents where ${where} order by created_at desc limit 5000`;
  return { docs: rows.map(toDoc), total: n(count) };
}

/** The money at a glance: what's owed (with late fees as of today), overdue, and paid this month. */
export async function documentTotals(acct: string, today: string): Promise<{
  owed: { count: number; cents: number };
  overdue: { count: number; cents: number };
  paidThisMonth: { count: number; cents: number };
  drafts: number;
}> {
  const db = sql();
  const open = (await db`select * from documents where account_id = ${acct} and kind = 'invoice' and status = 'sent'`).map(toDoc);
  const late = open.filter((d) => d.dueDate < today);
  const sum = (docs: Doc[]) => docs.reduce((t, d) => t + amountDueCents(d, today), 0);
  const month = today.slice(0, 7);
  const [paid] = await db`select count(*)::int as count, coalesce(sum(total_cents), 0)::bigint as cents from documents
    where account_id = ${acct} and kind = 'invoice' and status = 'paid' and to_char(paid_at at time zone 'UTC', 'YYYY-MM') = ${month}`;
  const [drafts] = await db`select count(*)::int as count from documents where account_id = ${acct} and status = 'draft'`;
  return {
    owed: { count: open.length, cents: sum(open) },
    overdue: { count: late.length, cents: sum(late) },
    paidThisMonth: { count: n(paid.count), cents: n(paid.cents) },
    drafts: n(drafts.count),
  };
}

export async function getDocuments(acct: string, ids: string[]): Promise<Doc[]> {
  const valid = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (!valid.length) return [];
  const rows = await sql()`select * from documents where account_id = ${acct} and id in ${sql()(valid)}`;
  return rows.map(toDoc);
}

export async function setStatus(acct: string, id: string, status: DocStatus): Promise<Doc | null> {
  const [row] = await sql()`update documents set status = ${status},
      paid_at = case when ${status} = 'paid' then now() when ${status} = 'sent' then null else paid_at end,
      updated_at = now()
    where account_id = ${acct} and id = ${id} returning *`;
  if (row) await recordEvent(id, status === "sent" ? "unpaid" : status, "");
  return row ? toDoc(row) : null;
}

/** Called only with a document already loaded for its account (or by the reminder job). */
/** First send moves a draft to "sent"; a resend leaves the status alone. */
export async function markSent(id: string): Promise<void> {
  await sql()`update documents set status = case when status = 'draft' then 'sent' else status end,
    sent_at = coalesce(sent_at, now()), updated_at = now() where id = ${id}`;
}

export async function markReminded(id: string): Promise<void> {
  await sql()`update documents set last_reminder_at = now(), reminder_count = reminder_count + 1,
    updated_at = now() where id = ${id}`;
}

export async function recordEvent(documentId: string, kind: string, detail: string): Promise<void> {
  await sql()`insert into events (document_id, kind, detail) values (${documentId}, ${kind}, ${detail.slice(0, 500)})`;
}

export async function listEvents(documentId: string): Promise<{ kind: string; detail: string; at: string }[]> {
  const rows = await sql()`select kind, detail, created_at from events where document_id = ${documentId}
    order by created_at desc limit 50`;
  return rows.map((r) => ({ kind: s(r.kind), detail: s(r.detail), at: iso(r.created_at) ?? "" }));
}

export async function unpaidInvoices(): Promise<Doc[]> {
  // Across all accounts: the daily job. Suspended accounts don't send reminders.
  const rows = await sql()`select d.* from documents d join accounts a on a.id = d.account_id
    where a.status = 'active' and d.kind = 'invoice' and d.status = 'sent' and d.reminder_days > 0`;
  return rows.map(toDoc);
}

/** Rewrites a draft in place: same number and link, new contents and totals. */
export async function updateDraft(acct: string, id: string, d: DraftInput, today: string): Promise<void> {
  const t = totals(d.items, d.taxRate);
  const db = sql();
  await db`update documents set customer = ${db.json(d.customer as never)}, business = ${db.json(d.business as never)},
    lang = ${d.lang}, items = ${db.json(d.items as never)}, state = ${d.state}, tax_rate = ${d.taxRate},
    subtotal_cents = ${t.subtotalCents}, tax_cents = ${t.taxCents}, total_cents = ${t.totalCents},
    issue_date = ${today}, due_date = ${addDays(today, d.dueDays)}, reminder_days = ${d.reminderDays},
    late_fee = ${db.json(d.lateFee as never)}, payment_methods = ${db.json(d.paymentMethods as never)},
    notes = ${d.notes}, updated_at = now()
    where account_id = ${acct} and id = ${id} and status = 'draft'`;
  await recordEvent(id, "edited", "");
}

// ---- Waitlist (sign-ups from the public website) ----

function toWaitlist(r: Record<string, unknown>): WaitlistEntry {
  return {
    id: String(r.id),
    email: String(r.email),
    name: r.name ? String(r.name) : "",
    trade: isTrade(r.trade) ? r.trade : null,
    lang: r.lang === "en" ? "en" : "es",
    createdAt: new Date(r.created_at as string).toISOString(),
  };
}

/** Sign-ups matching the filters, newest first. `limit` null = everything (for the CSV). */
export async function searchWaitlist(f: WaitlistFilters, limit: number | null): Promise<{ entries: WaitlistEntry[]; total: number }> {
  const db = sql();
  const like = `%${f.q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const conds = [
    f.q ? db`(lower(email) like ${like} or lower(coalesce(name, '')) like ${like})` : db`true`,
    f.trade === "all" ? db`true` : f.trade === "none" ? db`trade is null` : db`trade = ${f.trade}`,
  ];
  const where = conds.reduce((a, c) => db`${a} and ${c}`);
  const [{ count }] = await db`select count(*)::int as count from waitlist where ${where}`;
  const rows = await db`select * from waitlist where ${where} order by created_at desc limit ${limit ?? 50000}`;
  return { entries: rows.map(toWaitlist), total: n(count) };
}

/** Totals for the tiles: everyone, the last 7 days, and how many said each trade. */
export async function waitlistTotals(): Promise<{ total: number; lastWeek: number; byTrade: { trade: string | null; count: number }[] }> {
  const db = sql();
  const [t] = await db`select count(*)::int as total,
    count(*) filter (where created_at > now() - interval '7 days')::int as last_week from waitlist`;
  const byTrade = await db`select trade, count(*)::int as count from waitlist group by trade order by count desc, trade`;
  return {
    total: n(t.total),
    lastWeek: n(t.last_week),
    byTrade: byTrade.map((r) => ({ trade: r.trade ? String(r.trade) : null, count: n(r.count) })),
  };
}

// ---- Setup questions (app/welcome) ----

/** Saves the answers, names the account after the business and marks the setup done. */
export async function saveSetup(acct: string, v: import("./setup").Setup): Promise<void> {
  const db = sql();
  await db.begin(async (tx) => {
    await tx`update settings set business_name = ${v.business.name}, owner_name = ${v.business.ownerName},
      address = ${v.business.address}, phone = ${v.business.phone}, email = ${v.business.email},
      website = ${v.business.website}, trade = ${v.trade}, state = ${v.state}, tax_enabled = ${v.taxRate > 0},
      tax_rate = ${v.taxRate}, due_days = ${v.dueDays}, reminder_days = ${v.reminderDays},
      payment_methods = ${tx.json(v.paymentMethods as never)}, country = ${v.country}, voice_gender = ${v.voiceGender},
      lang = ${v.lang}, onboarded = true, updated_at = now()
      where account_id = ${acct}`;
    await tx`update accounts set name = ${v.business.name} where id = ${acct}`;
  });
}
