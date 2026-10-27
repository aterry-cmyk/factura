import { sql } from "./db";
import { COST_CODES, NO_BUDGETS, NO_BURDEN, type Budgets, type Cost, type CostCode, type CostInput, type CostSource, type LaborBurden, type Worker, type WorkerRole } from "./costs";
import type { PriceOption } from "./ai/costs";

// Costs, budgets, the crew and price lookups in the database. Every function takes the account
// id first and checks it in the query, like the rest of the store.

type Row = Record<string, unknown>;
const n = (v: unknown): number => Number(v ?? 0);
const s = (v: unknown): string => (v == null ? "" : String(v));
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));
const day = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const isId = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

const toCost = (r: Row): Cost => ({
  id: s(r.id), code: r.code as CostCode, amountCents: n(r.amount_cents), description: s(r.description), vendor: s(r.vendor),
  spentOn: day(r.spent_on), source: r.source as CostSource, receiptPhotoId: r.receipt_photo_id ? s(r.receipt_photo_id) : null,
  workerId: r.worker_id ? s(r.worker_id) : null, hours: r.hours == null ? null : n(r.hours), createdAt: iso(r.created_at) ?? "",
});
const toWorker = (r: Row): Worker => ({ id: s(r.id), name: s(r.name), role: r.role as WorkerRole, hourlyCents: n(r.hourly_cents), active: r.active !== false });

// ---- Crew ----

export async function listWorkers(acct: string, activeOnly = false): Promise<Worker[]> {
  const rows = activeOnly
    ? await sql()`select * from workers where account_id = ${acct} and active order by lower(name)`
    : await sql()`select * from workers where account_id = ${acct} order by active desc, lower(name)`;
  return rows.map(toWorker);
}

export async function addWorker(acct: string, w: Omit<Worker, "id">): Promise<Worker> {
  const [row] = await sql()`insert into workers (account_id, name, role, hourly_cents, active) values (${acct}, ${w.name}, ${w.role}, ${w.hourlyCents}, ${w.active}) returning *`;
  return toWorker(row);
}

export async function updateWorker(acct: string, id: string, w: Omit<Worker, "id">): Promise<Worker | null> {
  if (!isId(id)) return null;
  const [row] = await sql()`update workers set name = ${w.name}, role = ${w.role}, hourly_cents = ${w.hourlyCents}, active = ${w.active}
    where account_id = ${acct} and id = ${id} returning *`;
  return row ? toWorker(row) : null;
}

/** A worker who logged hours is kept (inactive) so old costs keep their name; one who never did is removed. */
export async function removeWorker(acct: string, id: string): Promise<boolean> {
  if (!isId(id)) return false;
  const [used] = await sql()`select count(*)::int as n from project_costs where worker_id = ${id} and account_id = ${acct}`;
  const rows = n(used.n)
    ? await sql()`update workers set active = false where account_id = ${acct} and id = ${id} returning id`
    : await sql()`delete from workers where account_id = ${acct} and id = ${id} returning id`;
  return rows.length === 1;
}

export async function getBurden(acct: string): Promise<LaborBurden> {
  const [row] = await sql()`select labor_burden from settings where account_id = ${acct}`;
  const b = (row?.labor_burden ?? {}) as Partial<LaborBurden>;
  if (!row) return NO_BURDEN;
  return { workersComp: n(b.workersComp), liability: n(b.liability), payrollTax: n(b.payrollTax) };
}

export async function setBurden(acct: string, b: LaborBurden): Promise<void> {
  const db = sql();
  await db`update settings set labor_burden = ${db.json(b as never)}, updated_at = now() where account_id = ${acct}`;
}

// ---- Budgets and costs ----

async function owns(acct: string, projectId: string): Promise<boolean> {
  if (!isId(projectId)) return false;
  const [p] = await sql()`select id from projects where account_id = ${acct} and id = ${projectId}`;
  return Boolean(p);
}

export async function getBudgets(projectId: string): Promise<Budgets> {
  const rows = await sql()`select code, estimated_cents from project_budgets where project_id = ${projectId}`;
  const out = { ...NO_BUDGETS };
  for (const r of rows) if ((COST_CODES as readonly string[]).includes(s(r.code))) out[r.code as CostCode] = n(r.estimated_cents);
  return out;
}

export async function setBudgets(acct: string, projectId: string, b: Budgets): Promise<boolean> {
  if (!(await owns(acct, projectId))) return false;
  await sql().begin(async (tx) => {
    for (const code of COST_CODES) {
      await tx`insert into project_budgets (project_id, account_id, code, estimated_cents) values (${projectId}, ${acct}, ${code}, ${b[code]})
        on conflict (project_id, code) do update set estimated_cents = excluded.estimated_cents`;
    }
    await tx`update projects set updated_at = now() where id = ${projectId}`;
  });
  return true;
}

export async function listCosts(projectId: string): Promise<Cost[]> {
  const rows = await sql()`select * from project_costs where project_id = ${projectId} order by spent_on desc, created_at desc limit 1000`;
  return rows.map(toCost);
}

export async function addCost(acct: string, projectId: string, c: CostInput, receiptPhotoId: string | null = null): Promise<Cost | null> {
  if (!(await owns(acct, projectId))) return null;
  if (c.workerId) {
    const [w] = await sql()`select id from workers where account_id = ${acct} and id = ${c.workerId}`;
    if (!w) c = { ...c, workerId: null };
  }
  const [row] = await sql()`insert into project_costs (project_id, account_id, code, amount_cents, description, vendor, spent_on, source, receipt_photo_id, worker_id, hours)
    values (${projectId}, ${acct}, ${c.code}, ${c.amountCents}, ${c.description}, ${c.vendor}, ${c.spentOn}, ${c.source}, ${receiptPhotoId}, ${c.workerId}, ${c.hours})
    returning *`;
  await sql()`update projects set updated_at = now() where id = ${projectId}`;
  await sql()`insert into project_events (project_id, kind, detail) values (${projectId}, 'cost', ${`${c.code} ${c.amountCents}`})`;
  return toCost(row);
}

export async function removeCost(acct: string, projectId: string, costId: string): Promise<boolean> {
  if (!isId(projectId) || !isId(costId)) return false;
  const rows = await sql()`delete from project_costs where account_id = ${acct} and project_id = ${projectId} and id = ${costId} returning id`;
  return rows.length === 1;
}

/** Money received on the project: each paid milestone on the day its invoice was paid. */
export async function paymentsOf(projectId: string): Promise<{ day: string; amountCents: number; name: string }[]> {
  const rows = await sql()`select m.name, m.amount_cents, coalesce(d.paid_at, m.done_at, m.created_at) as paid_at
    from milestones m left join documents d on d.id = m.invoice_id where m.project_id = ${projectId} and m.status = 'paid' order by paid_at`;
  return rows.map((r) => ({ day: day(r.paid_at), amountCents: n(r.amount_cents), name: s(r.name) }));
}

/** The business as a whole, per month: received on projects and spent on them, newest first. */
export async function businessMonths(acct: string, since: string): Promise<{ month: string; receivedCents: number; spentCents: number }[]> {
  const rows = await sql()`
    with received as (
      select to_char(coalesce(d.paid_at, m.done_at, m.created_at) at time zone 'UTC', 'YYYY-MM') as month, sum(m.amount_cents)::bigint as cents
      from milestones m left join documents d on d.id = m.invoice_id
      where m.account_id = ${acct} and m.status = 'paid' and coalesce(d.paid_at, m.done_at, m.created_at) >= ${since} group by 1),
    spent as (
      select to_char(spent_on, 'YYYY-MM') as month, sum(amount_cents)::bigint as cents from project_costs
      where account_id = ${acct} and spent_on >= ${since} group by 1)
    select coalesce(r.month, p.month) as month, coalesce(r.cents, 0) as received, coalesce(p.cents, 0) as spent
    from received r full join spent p on p.month = r.month order by 1 desc`;
  return rows.map((r) => ({ month: s(r.month), receivedCents: n(r.received), spentCents: n(r.spent) }));
}

// ---- The owner's own prices, and lookups ----

/** What this business actually paid for materials, newest first: the first place a price comes from. */
export async function ownPrices(acct: string, query: string, limit = 8): Promise<{ description: string; vendor: string; amountCents: number; spentOn: string; project: string }[]> {
  const like = `%${query.trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await sql()`select c.description, c.vendor, c.amount_cents, c.spent_on, p.name as project
    from project_costs c join projects p on p.id = c.project_id
    where c.account_id = ${acct} and c.code = 'materials' and (lower(c.description) like ${like} or lower(c.vendor) like ${like})
    order by c.spent_on desc, c.created_at desc limit ${limit}`;
  return rows.map((r) => ({ description: s(r.description), vendor: s(r.vendor), amountCents: n(r.amount_cents), spentOn: day(r.spent_on), project: s(r.project) }));
}

export async function saveLookup(acct: string, query: string, results: PriceOption[]): Promise<string> {
  const db = sql();
  const [row] = await db`insert into price_lookups (account_id, query, results) values (${acct}, ${query.slice(0, 200)}, ${db.json(results as never)}) returning id`;
  return s(row.id);
}

export async function recentLookups(acct: string, limit = 10): Promise<{ id: string; query: string; results: PriceOption[]; at: string }[]> {
  const rows = await sql()`select * from price_lookups where account_id = ${acct} order by created_at desc limit ${limit}`;
  return rows.map((r) => ({ id: s(r.id), query: s(r.query), results: (r.results as PriceOption[]) ?? [], at: iso(r.created_at) ?? "" }));
}
