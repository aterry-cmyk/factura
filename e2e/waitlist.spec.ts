import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

// The owner's view of the website waitlist: totals, search, trade filter and the CSV.
test.use({ baseURL: "http://127.0.0.1:3101" });

test.beforeAll(async () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
  await sql.unsafe(readFileSync("db/schema.sql", "utf8"));
  await sql`truncate waitlist`;
  await sql`update settings set voice_on = false, lang = 'es' where id = 1`;
  await sql`insert into waitlist (email, trade, lang, created_at) values
    ('juan@example.com', 'painting', 'es', now() - interval '1 day'),
    ('ana@example.com', 'painting', 'en', now() - interval '2 days'),
    ('rosa@example.com', 'roofing', 'es', now() - interval '30 days'),
    ('luis@example.com', null, 'es', now())`;
  await sql.end();
});

test("the owner sees the waitlist, filters it and downloads it", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Contraseña / Password").fill("prueba-1234");
  await page.getByRole("button", { name: "Entrar / Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dime qué necesitas" })).toBeVisible();

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

  // Signed out, the page and the CSV are closed.
  await page.context().clearCookies();
  const r = await page.request.get("/api/waitlist/export", { maxRedirects: 0 });
  expect(r.status()).toBe(401);
});
