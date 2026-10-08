import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { db, resetDb, signIn } from "./helpers";

// The website waitlist lives in the Loro AI admin: totals, search, trade filter, CSV and invitations.
test.use({ baseURL: "http://127.0.0.1:3101" });

test.beforeAll(async () => {
  await resetDb({ admin: true });
  const sql = db();
  await sql`insert into waitlist (email, trade, lang, created_at) values
    ('juan@example.com', 'painting', 'es', now() - interval '1 day'),
    ('ana@example.com', 'painting', 'en', now() - interval '2 days'),
    ('rosa@example.com', 'roofing', 'es', now() - interval '30 days'),
    ('luis@example.com', null, 'es', now())`;
  await sql.end();
});

test("the admin sees the waitlist, filters it, downloads it and invites someone", async ({ page }) => {
  await signIn(page);
  await page.getByLabel("Menú de la cuenta").click();
  await page.getByRole("menuitem", { name: "Admin de Loro AI" }).click();
  await page.getByRole("link", { name: "Lista de espera" }).click();
  await expect(page.getByRole("heading", { name: "Lista de espera del sitio web" })).toBeVisible();
  const totals = page.getByTestId("waitlist-totals");
  await expect(totals.getByText(/En la lista\s*4/)).toBeVisible();
  await expect(totals.getByText(/Últimos 7 días\s*3/)).toBeVisible();
  await expect(totals.getByRole("link", { name: /Oficio más común\s+Pintura\s+2 personas/ })).toBeVisible();

  const rows = page.getByTestId("waitlist").locator("tbody tr");
  await expect(rows).toHaveCount(4);
  await expect(rows.first()).toContainText("luis@example.com"); // newest first

  await page.getByLabel("Buscar por email").fill("ROSA");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Techos");
  // Invite her straight from the list: a one-time sign-up link for her email.
  await rows.first().getByRole("button", { name: "Crear invitación" }).click();
  await expect(rows.first().getByTestId("one-time-link")).toHaveText(/\/signup\?invite=[A-Za-z0-9_-]{43}$/);
  await page.getByRole("link", { name: "Quitar filtros" }).click();

  await page.getByLabel("Todos los oficios").selectOption("painting");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page.getByTestId("waitlist-count")).toHaveText("2 personas");

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: /Descargar CSV/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/^lista-de-espera-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = readFileSync(await download.path(), "utf8");
  expect(csv.replace(/^﻿/, "").split("\r\n").filter(Boolean)).toEqual([
    "Email,Nombre,Oficio,Idioma,Fecha",
    expect.stringMatching(/^juan@example\.com,,Pintura,Español,\d{4}-\d{2}-\d{2}$/),
    expect.stringMatching(/^ana@example\.com,,Pintura,Inglés,\d{4}-\d{2}-\d{2}$/),
  ]);

  // The old address still works.
  await page.goto("/waitlist");
  await expect(page).toHaveURL(/\/admin\/waitlist$/);

  // Signed out, the page and the CSV are closed.
  await page.context().clearCookies();
  const r = await page.request.get("/api/admin/waitlist/export", { maxRedirects: 0 });
  expect(r.status()).toBe(401);
});
