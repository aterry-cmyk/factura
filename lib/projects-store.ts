import { sql } from "./db";
import { milestoneLine, splitAmounts, type ChecklistItem, type Milestone, type MilestoneStatus, type PlanSource, type Project, type ProjectInput, type ProjectStatus } from "./projects";
import { createDocument, markSent, newToken, recordEvent } from "./store";
import type { Customer, Doc, Lang, Settings } from "./types";

// Projects in the database. Every function that touches a project takes the account id first and
// checks it in the query, like lib/store.ts does for documents.

type Row = Record<string, unknown>;
const n = (v: unknown): number => Number(v ?? 0);
const s = (v: unknown): string => (v == null ? "" : String(v));
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));
const day = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const isId = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

function toProject(r: Row): Project {
  return {
    id: s(r.id),
    accountId: s(r.account_id),
    customerId: r.customer_id ? s(r.customer_id) : null,
    customer: (r.customer as Customer) ?? { name: "", company: "", email: "", phone: "" },
    name: s(r.name),
    description: s(r.description),
    status: r.status as ProjectStatus,
    totalCents: n(r.total_cents),
    lang: r.lang === "en" ? "en" : "es",
    estimateId: r.estimate_id ? s(r.estimate_id) : null,
    publicToken: s(r.public_token),
    planSource: r.plan_source as PlanSource,
    startsOn: r.starts_on ? day(r.starts_on) : null,
    createdAt: iso(r.created_at) ?? "",
    updatedAt: iso(r.updated_at) ?? "",
  };
}

function toMilestone(r: Row): Milestone {
  return {
    id: s(r.id),
    position: n(r.position),
    name: s(r.name),
    amountCents: n(r.amount_cents),
    status: r.status as MilestoneStatus,
    invoiceId: r.invoice_id ? s(r.invoice_id) : null,
    invoiceToken: r.invoice_token ? s(r.invoice_token) : null,
    invoiceNumber: s(r.invoice_number),
    doneAt: iso(r.done_at),
    days: r.days == null ? null : n(r.days),
    startsOn: r.starts_on ? day(r.starts_on) : null,
    endsOn: r.ends_on ? day(r.ends_on) : null,
  };
}

function toItem(r: Row): ChecklistItem {
  return {
    id: s(r.id),
    milestoneId: r.milestone_id ? s(r.milestone_id) : null,
    position: n(r.position),
    text: s(r.text),
    doneAt: iso(r.done_at),
    note: s(r.note),
    photoIds: Array.isArray(r.photo_ids) ? (r.photo_ids as unknown[]).map(s) : [],
  };
}

export interface ProjectView {
  project: Project;
  milestones: Milestone[];
  items: ChecklistItem[];
}

/** Saves a project with its milestones (amounts split from the total) and checklist, in one transaction. */
export async function createProject(acct: string, d: ProjectInput, meta: { model?: string; promptVersion?: string } = {}): Promise<Project> {
  const amounts = splitAmounts(d.totalCents, d.plan.map((m) => m.sharePercent));
  return sql().begin(async (tx) => {
    const [existing] = await tx`select id from customers where account_id = ${acct} and lower(name) = ${d.customer.name.toLowerCase()}
      order by created_at desc limit 1`;
    let customerId: string;
    if (existing) {
      customerId = s(existing.id);
      await tx`update customers set company = coalesce(nullif(${d.customer.company}, ''), company),
        email = coalesce(nullif(${d.customer.email}, ''), email), phone = coalesce(nullif(${d.customer.phone}, ''), phone) where id = ${customerId}`;
    } else {
      const [c] = await tx`insert into customers (account_id, name, company, email, phone)
        values (${acct}, ${d.customer.name}, ${d.customer.company}, ${d.customer.email}, ${d.customer.phone}) returning id`;
      customerId = s(c.id);
    }
    const [row] = await tx`insert into projects (account_id, customer_id, customer, name, description, total_cents, lang, estimate_id,
        public_token, plan_source, ai_model, prompt_version)
      values (${acct}, ${customerId}, ${tx.json(d.customer as never)}, ${d.name}, ${d.description}, ${d.totalCents}, ${d.lang},
        ${d.estimateId}, ${newToken()}, ${d.planSource}, ${meta.model ?? null}, ${meta.promptVersion ?? null}) returning *`;
    const projectId = s(row.id);
    let position = 0;
    for (const [i, m] of d.plan.entries()) {
      const [ms] = await tx`insert into milestones (project_id, account_id, position, name, amount_cents, days)
        values (${projectId}, ${acct}, ${i}, ${m.name}, ${amounts[i]}, ${m.days ?? null}) returning id`;
      for (const step of m.steps) {
        await tx`insert into checklist_items (project_id, milestone_id, account_id, position, text)
          values (${projectId}, ${s(ms.id)}, ${acct}, ${position++}, ${step})`;
      }
    }
    await tx`insert into project_events (project_id, kind, detail) values (${projectId}, 'created', ${d.planSource})`;
    return toProject(row);
  });
}

async function loadParts(projectId: string): Promise<{ milestones: Milestone[]; items: ChecklistItem[] }> {
  const db = sql();
  const [ms, items] = await Promise.all([
    db`select m.*, d.public_token as invoice_token, d.number as invoice_number from milestones m
      left join documents d on d.id = m.invoice_id where m.project_id = ${projectId} order by m.position`,
    db`select i.*, coalesce((select array_agg(p.id order by p.created_at) from project_photos p where p.item_id = i.id), '{}') as photo_ids
      from checklist_items i where i.project_id = ${projectId} order by i.position`,
  ]);
  return { milestones: ms.map(toMilestone), items: items.map(toItem) };
}

export async function getProject(acct: string, id: string): Promise<ProjectView | null> {
  if (!isId(id)) return null;
  const [row] = await sql()`select * from projects where account_id = ${acct} and id = ${id}`;
  if (!row) return null;
  return { project: toProject(row), ...(await loadParts(s(row.id))) };
}

/** The customer's view, by the link's token. No account check: the token is the key. */
export async function getProjectByToken(token: string): Promise<ProjectView | null> {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  const [row] = await sql()`select * from projects where public_token = ${token}`;
  if (!row) return null;
  return { project: toProject(row), ...(await loadParts(s(row.id))) };
}

export interface ProjectCard extends Project {
  milestones: Pick<Milestone, "id" | "position" | "amountCents" | "status" | "doneAt">[];
  items: Pick<ChecklistItem, "milestoneId" | "doneAt">[];
}

/** Every project of the business with what the list needs for progress and money, newest first. */
export async function listProjects(acct: string, limit = 100): Promise<ProjectCard[]> {
  const db = sql();
  const rows = await db`select * from projects where account_id = ${acct} order by (status = 'active') desc, created_at desc limit ${limit}`;
  if (!rows.length) return [];
  const ids = rows.map((r) => s(r.id));
  const [ms, items] = await Promise.all([
    db`select id, project_id, position, amount_cents, status, done_at from milestones where project_id in ${db(ids)}`,
    db`select project_id, milestone_id, done_at from checklist_items where project_id in ${db(ids)}`,
  ]);
  return rows.map((r) => ({
    ...toProject(r),
    milestones: ms.filter((m) => s(m.project_id) === s(r.id)).map((m) => ({ id: s(m.id), position: n(m.position), amountCents: n(m.amount_cents), status: m.status as MilestoneStatus, doneAt: iso(m.done_at) })),
    items: items.filter((i) => s(i.project_id) === s(r.id)).map((i) => ({ milestoneId: i.milestone_id ? s(i.milestone_id) : null, doneAt: iso(i.done_at) })),
  }));
}

export async function setProjectStatus(acct: string, id: string, status: ProjectStatus): Promise<boolean> {
  if (!isId(id)) return false;
  const rows = await sql()`update projects set status = ${status}, updated_at = now() where account_id = ${acct} and id = ${id} returning id`;
  if (rows.length) await recordProjectEvent(id, status, "");
  return rows.length === 1;
}

/** Ticks or unticks a step. Returns the item as it now stands, or null if it isn't this business's. */
export async function setItemDone(acct: string, projectId: string, itemId: string, done: boolean, note?: string): Promise<ChecklistItem | null> {
  if (!isId(projectId) || !isId(itemId)) return null;
  const db = sql();
  const [row] = await db`update checklist_items set done_at = ${done ? db`coalesce(done_at, now())` : null},
      note = ${note === undefined ? db`note` : note.slice(0, 500)}
    where account_id = ${acct} and project_id = ${projectId} and id = ${itemId} returning *`;
  if (!row) return null;
  await db`update projects set updated_at = now() where id = ${projectId}`;
  await recordProjectEvent(projectId, done ? "step_done" : "step_undone", s(row.text));
  return toItem({ ...row, photo_ids: [] });
}

export async function addPhoto(acct: string, projectId: string, itemId: string | null, photo: { bytes: Buffer; type: string }): Promise<string | null> {
  if (!isId(projectId) || (itemId && !isId(itemId))) return null;
  const [p] = await sql()`select id from projects where account_id = ${acct} and id = ${projectId}`;
  if (!p) return null;
  if (itemId) {
    const [i] = await sql()`select id from checklist_items where project_id = ${projectId} and id = ${itemId}`;
    if (!i) return null;
  }
  const [row] = await sql()`insert into project_photos (project_id, item_id, account_id, data, type, bytes)
    values (${projectId}, ${itemId}, ${acct}, ${photo.bytes}, ${photo.type}, ${photo.bytes.length}) returning id`;
  await sql()`update projects set updated_at = now() where id = ${projectId}`;
  await recordProjectEvent(projectId, "photo", itemId ?? "");
  return s(row.id);
}

/** A photo's bytes, only when it belongs to that project (the project was already looked up by account or token). */
export async function getPhoto(projectId: string, photoId: string): Promise<{ bytes: Buffer; type: string } | null> {
  if (!isId(projectId) || !isId(photoId)) return null;
  const [row] = await sql()`select data, type from project_photos where project_id = ${projectId} and id = ${photoId}`;
  return row ? { bytes: Buffer.from(row.data as Uint8Array), type: s(row.type) } : null;
}

export async function listPhotos(projectId: string): Promise<{ id: string; itemId: string | null; at: string }[]> {
  const rows = await sql()`select id, item_id, created_at from project_photos where project_id = ${projectId} order by created_at desc limit 200`;
  return rows.map((r) => ({ id: s(r.id), itemId: r.item_id ? s(r.item_id) : null, at: iso(r.created_at) ?? "" }));
}

/**
 * A milestone becomes an invoice: one line for its amount, sent at once so the customer's link
 * (and the Pagar button) works. The milestone remembers its invoice, and the invoice's status
 * flows back (lib/store.ts syncMilestoneForInvoice) when it is paid, voided or marked unpaid.
 */
export async function invoiceMilestone(acct: string, view: ProjectView, milestoneId: string, settings: Settings, today: string): Promise<Doc | null> {
  const { project } = view;
  const m = view.milestones.find((x) => x.id === milestoneId);
  if (!m || m.status !== "pending") return null;
  const lang: Lang = project.lang;
  const doc = await createDocument(acct, {
    kind: "invoice",
    lang,
    customer: project.customer,
    business: { name: settings.name, ownerName: settings.ownerName, address: settings.address, phone: settings.phone, email: settings.email, website: settings.website },
    items: [{ description: milestoneLine(project.name, m, lang), quantity: 1, unitPriceCents: m.amountCents, source: "typed" }],
    state: settings.state,
    taxRate: 0,
    dueDays: settings.dueDays,
    reminderDays: settings.reminderDays,
    lateFee: settings.lateFee,
    paymentMethods: settings.paymentMethods,
    notes: lang === "es" ? `Pago por hito del proyecto "${project.name}". El total del proyecto ya incluye impuestos cuando aplican.` : `Milestone payment for the project "${project.name}". The project total already includes tax where it applies.`,
    transcript: "",
  }, { today });
  await markSent(doc.id);
  await sql()`update milestones set status = 'invoiced', invoice_id = ${doc.id}, done_at = coalesce(done_at, now())
    where id = ${milestoneId} and account_id = ${acct} and status = 'pending'`;
  await sql()`update projects set updated_at = now() where id = ${project.id}`;
  await recordProjectEvent(project.id, "milestone_invoiced", `${m.name} · ${doc.number}`);
  await recordEvent(doc.id, "created", `${doc.number} · ${project.name}`);
  return { ...doc, status: "sent" };
}

export async function recordProjectEvent(projectId: string, kind: string, detail: string): Promise<void> {
  await sql()`insert into project_events (project_id, kind, detail) values (${projectId}, ${kind}, ${detail.slice(0, 500)})`;
}

export async function listProjectEvents(projectId: string): Promise<{ kind: string; detail: string; at: string }[]> {
  const rows = await sql()`select kind, detail, created_at from project_events where project_id = ${projectId} order by created_at desc limit 50`;
  return rows.map((r) => ({ kind: s(r.kind), detail: s(r.detail), at: iso(r.created_at) ?? "" }));
}

/** The project an accepted estimate became, if any. */
export async function projectForEstimate(acct: string, estimateId: string): Promise<string | null> {
  if (!isId(estimateId)) return null;
  const [row] = await sql()`select id from projects where account_id = ${acct} and estimate_id = ${estimateId} order by created_at desc limit 1`;
  return row ? s(row.id) : null;
}

// ---- Schedule and proposal ----

/** The start date and each milestone's days; dates are laid end to end from the start. */
export async function saveSchedule(acct: string, projectId: string, startsOn: string, dated: { id: string; days: number; startsOn: string; endsOn: string }[]): Promise<boolean> {
  if (!isId(projectId)) return false;
  const rows = await sql()`update projects set starts_on = ${startsOn}, updated_at = now() where account_id = ${acct} and id = ${projectId} returning id`;
  if (!rows.length) return false;
  await sql().begin(async (tx) => {
    for (const m of dated) {
      await tx`update milestones set days = ${m.days}, starts_on = ${m.startsOn}, ends_on = ${m.endsOn} where account_id = ${acct} and project_id = ${projectId} and id = ${m.id}`;
    }
  });
  await recordProjectEvent(projectId, "scheduled", startsOn);
  return true;
}

export async function saveProposal(acct: string, projectId: string, proposal: import("./proposal").Proposal): Promise<boolean> {
  if (!isId(projectId)) return false;
  const db = sql();
  const rows = await db`update projects set proposal = ${db.json(proposal as never)}, updated_at = now() where account_id = ${acct} and id = ${projectId} returning id`;
  return rows.length === 1;
}

export async function getProposal(acct: string, projectId: string): Promise<import("./proposal").Proposal | null> {
  if (!isId(projectId)) return null;
  const [row] = await sql()`select proposal from projects where account_id = ${acct} and id = ${projectId}`;
  return (row?.proposal as import("./proposal").Proposal) ?? null;
}

/**
 * The proposal became an estimate: the project remembers it and takes its total, and the
 * milestone amounts are re-split by their shares, but only while nothing has been invoiced.
 */
export async function adoptEstimate(acct: string, projectId: string, estimateId: string, totalCents: number): Promise<{ resplit: boolean }> {
  const view = await getProject(acct, projectId);
  if (!view) return { resplit: false };
  const untouched = view.milestones.every((m) => m.status === "pending");
  await sql().begin(async (tx) => {
    await tx`update projects set estimate_id = ${estimateId}, total_cents = ${totalCents}, updated_at = now() where account_id = ${acct} and id = ${projectId}`;
    if (untouched && view.milestones.length) {
      const oldTotal = view.milestones.reduce((a, m) => a + m.amountCents, 0);
      const shares = view.milestones.map((m) => (oldTotal > 0 ? (m.amountCents / oldTotal) * 100 : 100 / view.milestones.length));
      const amounts = splitAmounts(totalCents, shares);
      for (const [i, m] of view.milestones.entries()) await tx`update milestones set amount_cents = ${amounts[i]} where id = ${m.id}`;
    }
  });
  await recordProjectEvent(projectId, "proposal_sent", String(totalCents));
  return { resplit: untouched };
}

// ---- Clients ----

export interface Client { id: string; name: string; company: string; email: string; phone: string; address: string; notes: string; createdAt: string }
export interface ClientCard extends Client { projects: number; documents: number; owedCents: number; paidCents: number }

const toClient = (r: Row): Client => ({ id: s(r.id), name: s(r.name), company: s(r.company), email: s(r.email), phone: s(r.phone), address: s(r.address), notes: s(r.notes), createdAt: iso(r.created_at) ?? "" });

export async function listClients(acct: string): Promise<ClientCard[]> {
  const rows = await sql()`select c.*,
      (select count(*)::int from projects p where p.customer_id = c.id) as projects,
      (select count(*)::int from documents d where d.customer_id = c.id and d.status <> 'draft') as documents,
      (select coalesce(sum(total_cents), 0)::bigint from documents d where d.customer_id = c.id and d.kind = 'invoice' and d.status = 'sent') as owed,
      (select coalesce(sum(coalesce(paid_amount_cents, total_cents)), 0)::bigint from documents d where d.customer_id = c.id and d.kind = 'invoice' and d.status = 'paid') as paid
    from customers c where c.account_id = ${acct} order by lower(c.name) limit 500`;
  return rows.map((r) => ({ ...toClient(r), projects: n(r.projects), documents: n(r.documents), owedCents: n(r.owed), paidCents: n(r.paid) }));
}

export async function getClient(acct: string, id: string): Promise<Client | null> {
  if (!isId(id)) return null;
  const [row] = await sql()`select * from customers where account_id = ${acct} and id = ${id}`;
  return row ? toClient(row) : null;
}

export async function updateClient(acct: string, id: string, c: Omit<Client, "id" | "createdAt">): Promise<Client | null> {
  if (!isId(id)) return null;
  const [row] = await sql()`update customers set name = ${c.name}, company = ${c.company}, email = ${c.email}, phone = ${c.phone}, address = ${c.address}, notes = ${c.notes}
    where account_id = ${acct} and id = ${id} returning *`;
  if (!row) return null;
  // The name and contact on the client's open projects and drafts follow.
  const customer = { name: c.name, company: c.company, email: c.email, phone: c.phone };
  const db = sql();
  await db`update projects set customer = ${db.json(customer as never)} where account_id = ${acct} and customer_id = ${id}`;
  await db`update documents set customer = ${db.json(customer as never)} where account_id = ${acct} and customer_id = ${id} and status = 'draft'`;
  return toClient(row);
}

export async function clientProjects(acct: string, customerId: string): Promise<ProjectCard[]> {
  return (await listProjects(acct, 500)).filter((p) => p.customerId === customerId);
}
