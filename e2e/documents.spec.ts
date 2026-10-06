import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

// The owner's full list: totals, search, filters, CSV and bulk actions. Runs on the copy without
// Azure; email goes to the stand-in in e2e/fake-services.mjs.
test.use({ baseURL: "http://127.0.0.1:3101" });
test.describe.configure({ mode: "serial" });
const FAKE = "http://127.0.0.1:3199";

const draft = (name: string, description: string, cents: number, kind: "invoice" | "estimate" = "invoice") => ({
  kind, lang: "es",
  customer: { name, company: "", email: `${name.split(" ")[0].toLowerCase()}@example.com`, phone: "" },
  business: { name: "Pintura Hernández", phone: "301-555-0199" },
  items: [{ description, quantity: 1, unitPriceCents: cents, source: "said" }],
  state: "MD", taxEnabled: false, taxRate: 0, dueDays: 0, reminderDays: 7,
  lateFee: { type: "none" }, paymentMethods: { cash: { enabled: true } },
});

async function api(page: Page, url: string, data: object) {
  return page.evaluate(async ([u, body]) => {
    const r = await fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [url, data] as const);
}

test.beforeAll(async () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
  await sql.unsafe(readFileSync("db/schema.sql", "utf8"));
  await sql`truncate events, documents, customers restart identity cascade`;
  await sql`update settings set voice_on = false, lang = 'es', next_invoice_no = 1, next_estimate_no = 1 where id = 1`;
  await sql.end();
});

test("lists every document with totals, search, filters, CSV and bulk actions", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Contraseña / Password").fill("prueba-1234");
  await page.getByRole("button", { name: "Entrar / Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dime qué necesitas" })).toBeVisible();

  // F-0001 overdue (sent, due earlier), F-0002 sent, F-0003 paid, F-0004 draft, P-0001 estimate.
  const ids: string[] = [];
  for (const [n, d, c, k] of [["Juan Pérez", "Pintura de cocina", 220000], ["Ana López", "Reparación de techo", 90000], ["Rosa Díaz", "Limpieza de canaletas", 45000], ["Luis Mora", "Cambio de llave", 8500], ["Juan Pérez", "Pintura exterior", 350000, "estimate"]] as const) {
    const r = await api(page, "/api/documents", draft(n, d, c, (k ?? "invoice") as "invoice" | "estimate"));
    expect(r.status).toBe(200);
    ids.push(r.json.id);
  }
  await api(page, `/api/documents/${ids[0]}/status`, { status: "sent" });
  await api(page, `/api/documents/${ids[1]}/status`, { status: "sent" });
  await api(page, `/api/documents/${ids[2]}/status`, { status: "paid" });
  const sql = postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
  await sql`update documents set due_date = current_date - 10 where id = ${ids[0]}`;
  await sql.end();

  await page.getByRole("link", { name: "Facturas" }).click();
  await expect(page.getByRole("heading", { name: "Todas tus facturas y presupuestos" })).toBeVisible();
  const totals = page.getByTestId("totals");
  await expect(totals.getByRole("link", { name: /Por cobrar\s+\$3,100\.00/ })).toBeVisible();
  await expect(totals.getByRole("link", { name: /Vencido\s+\$2,200\.00/ })).toBeVisible();
  await expect(totals.getByRole("link", { name: /Cobrado este mes\s+\$450\.00/ })).toBeVisible();
  await expect(page.getByTestId("doc-row")).toHaveCount(5);

  // Search finds a customer, and an item description.
  await page.getByLabel("Buscar cliente, número o concepto").fill("juan");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page.getByTestId("doc-row")).toHaveCount(2);
  await page.getByLabel("Buscar cliente, número o concepto").fill("techo");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page.getByTestId("doc-row")).toHaveCount(1);
  await expect(page.getByTestId("doc-row")).toHaveAttribute("data-number", "F-0002");
  await page.getByRole("link", { name: "Quitar filtros" }).click();

  // Status chips and the overdue tile.
  await page.getByRole("link", { name: "Vencidas" }).click();
  await expect(page.getByTestId("doc-row")).toHaveCount(1);
  await expect(page.getByTestId("doc-row").getByText("Vencida")).toBeVisible();
  await page.getByRole("link", { name: "Todas", exact: true }).click();
  await page.getByLabel("Facturas y presupuestos").selectOption("estimate");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page.getByTestId("doc-row")).toHaveCount(1);
  await expect(page.getByTestId("doc-row")).toHaveAttribute("data-number", "P-0001");
  await page.getByRole("link", { name: "Quitar filtros" }).click();

  // CSV of what's on screen.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: /Descargar CSV/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/^facturas-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = readFileSync(await download.path(), "utf8");
  expect(csv.trim().split("\r\n")).toHaveLength(6);
  expect(csv).toContain("F-0001,Factura,Vencida,Juan Pérez");

  // Bulk: remind the two sent invoices (and a draft, which is skipped).
  const row = (n: string) => page.locator(`[data-testid="doc-row"][data-number="${n}"]`).getByRole("checkbox");
  await row("F-0001").check();
  await row("F-0002").check();
  await row("F-0004").check();
  await expect(page.getByText("3 seleccionados")).toBeVisible();
  const before = ((await (await page.request.get(`${FAKE}/_calls`)).json()) as { url: string }[]).filter((c) => c.url === "/emails").length;
  await page.getByRole("button", { name: "Enviar recordatorio" }).click();
  await expect(page.getByRole("status")).toHaveText("2 recordatorios enviados. 1 sin cambiar (no aplicaba).");
  const after = ((await (await page.request.get(`${FAKE}/_calls`)).json()) as { url: string }[]).filter((c) => c.url === "/emails").length;
  expect(after - before).toBe(2);

  // Bulk: mark the two sent ones paid; the totals follow.
  await row("F-0001").check();
  await row("F-0002").check();
  await page.getByRole("button", { name: "Marcar pagadas" }).click();
  await expect(page.getByRole("status")).toHaveText("2 marcadas pagadas.");
  await expect(totals.getByRole("link", { name: /Por cobrar\s+\$0\.00/ })).toBeVisible();
  await expect(totals.getByRole("link", { name: /Cobrado este mes\s+\$3,550\.00/ })).toBeVisible();

  // Bulk: void asks first; a paid invoice can't be voided.
  await row("F-0003").check();
  await row("F-0004").check();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Anular" }).click();
  await expect(page.getByRole("status")).toHaveText("1 anulados. 1 sin cambiar (no aplicaba).");
  await expect(page.locator('[data-testid="doc-row"][data-number="F-0004"]').getByText("Anulada")).toBeVisible();

  // The API refuses nonsense.
  expect((await api(page, "/api/documents/bulk", { ids: ids, action: "delete" })).status).toBe(400);
  expect((await api(page, "/api/documents/bulk", { ids: [], action: "paid" })).status).toBe(400);
});

test("the list, the export and bulk actions need the owner's sign-in", async ({ request }) => {
  expect((await request.get("/api/documents/export")).status()).toBe(401);
  expect((await request.post("/api/documents/bulk", { data: { ids: ["x"], action: "paid" } })).status()).toBe(401);
  const page = await request.get("/documents", { maxRedirects: 0 });
  expect(page.status()).toBe(307);
});

test("on a phone nothing is wider than the screen", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/login");
  await page.getByLabel("Contraseña / Password").fill("prueba-1234");
  await page.getByRole("button", { name: "Entrar / Sign in" }).click();
  for (const path of ["/", "/documents", "/settings"]) {
    await page.goto(path);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(wide, path).toBeLessThanOrEqual(375);
  }
});
