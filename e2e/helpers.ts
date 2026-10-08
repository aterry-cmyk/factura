import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import postgres from "postgres";
import { hashPassword } from "../lib/auth";

// Shared by the browser tests: a fresh test database with one business owner, and signing in.

export const OWNER = { email: "jose@example.com", password: "Prueba2026", name: "José Hernández" };

export const db = () => postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });

/**
 * Wipes the test database and makes one account with its owner. `onboarded` false sends them to
 * the setup questions first; `admin` makes the owner a platform admin.
 */
export async function resetDb(opts: { onboarded?: boolean; admin?: boolean; settings?: Record<string, unknown> } = {}): Promise<string> {
  const sql = db();
  await sql.unsafe(readFileSync("db/schema.sql", "utf8"));
  await sql`truncate events, documents, customers, usage_events, sessions, auth_tokens, auth_attempts, memberships, users, accounts, waitlist restart identity cascade`;
  await sql`delete from settings`;
  await sql`update platform set signups_open = false`;
  const [a] = await sql`insert into accounts (name, plan) values ('', 'comped') returning id`;
  const [u] = await sql`insert into users (email, name, password_hash, is_admin)
    values (${OWNER.email}, ${OWNER.name}, ${await hashPassword(OWNER.password)}, ${opts.admin ?? false}) returning id`;
  await sql`insert into memberships (account_id, user_id, role) values (${a.id}, ${u.id}, 'owner')`;
  await sql`insert into settings (account_id, onboarded, voice_on, lang) values (${a.id}, ${opts.onboarded ?? true}, false, 'es')`;
  if (opts.settings) await sql`update settings set ${sql(opts.settings)} where account_id = ${a.id}`;
  await sql.end();
  return String(a.id);
}

export async function signIn(page: Page, who: { email: string; password: string } = OWNER) {
  await page.goto("/login");
  await page.getByLabel("Tu email").fill(who.email);
  await page.getByLabel("Contraseña", { exact: true }).fill(who.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
