import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const FAKE = "http://127.0.0.1:3199";

test.beforeAll(async () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
  await sql.unsafe(readFileSync("db/schema.sql", "utf8"));
  await sql`truncate events, documents, customers restart identity cascade`;
  await sql`delete from settings`;
  await sql`insert into settings (id) values (1)`;
  await sql.end();
});

async function signIn(page: Page) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Contraseña / Password").fill("prueba-1234");
  await page.getByRole("button", { name: "Entrar / Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dime qué necesitas" })).toBeVisible();
}

const calls = async (page: Page) => (await (await page.request.get(`${FAKE}/_calls`)).json()) as { url: string; body: string }[];

test("refuses the API and pages without signing in", async ({ request }) => {
  expect((await request.post("/api/documents", { data: {} })).status()).toBe(401);
  expect((await request.get("/api/cron/reminders")).status()).toBe(401);
  const wrong = await request.post("/api/login", { data: { password: "nope" } });
  expect(wrong.status()).toBe(401);
});

test("voice request → confirm the estimator's price → questions in Spanish → invoice → send → paid", async ({ page }) => {
  await signIn(page);
  await page.getByLabel("O escríbelo aquí").fill("Necesito una factura para Juan por pintar la cocina $2,200 y cambiar 3 ventanas");
  await page.getByRole("button", { name: "Continuar" }).click();

  await expect(page.getByRole("heading", { name: "Revisa los conceptos" })).toBeVisible();
  await expect(page.getByLabel("Nombre del cliente")).toHaveValue("Juan");
  const items = page.getByTestId("item");
  await expect(items).toHaveCount(2);
  await expect(items.nth(1).getByText("Precio sugerido")).toBeVisible();
  await expect(items.nth(1).getByText("Típico para 3 ventanas")).toBeVisible();
  const next = page.getByRole("button", { name: "Siguiente" });
  await expect(next).toBeDisabled();
  await items.nth(1).getByLabel("Confirmo este precio").check();
  await next.click();

  // 1. customer
  await expect(page.getByRole("heading", { name: "¿A quién se la mandamos?" })).toBeVisible();
  await page.getByLabel("Correo del cliente").fill("juan@example.com");
  await page.getByLabel("Celular del cliente").fill("301 555 0100");
  await next.click();
  // 2. business
  await expect(page.getByRole("heading", { name: "¿Cómo se llama tu empresa?" })).toBeVisible();
  await expect(next).toBeDisabled();
  await page.getByLabel("Nombre de tu empresa").fill("Pintura Hernández");
  await page.getByLabel("Tu nombre").fill("José Hernández");
  await page.getByLabel("Tu correo").fill("jose@example.com");
  await next.click();
  // 3. state and tax
  await page.getByLabel("¿En qué estado trabajas?").selectOption("MD");
  await page.getByRole("button", { name: "Sí", exact: true }).click();
  await page.getByLabel("Tasa de impuesto (%)").fill("6");
  await next.click();
  // 4. due and reminders
  await page.getByRole("button", { name: "En 15 días" }).click();
  await page.getByRole("button", { name: "Cada 7 días" }).click();
  await next.click();
  // 5. late fee
  await page.getByRole("button", { name: "Cantidad fija" }).click();
  await expect(page.getByText("Cada estado tiene límites")).toBeVisible();
  await next.click();
  // 6. payment
  await expect(page.getByRole("heading", { name: "¿Cómo quieres que te paguen?" })).toBeVisible();
  const create = page.getByRole("button", { name: "Crear" });
  await expect(create).toBeDisabled();
  await page.getByLabel("Zelle", { exact: true }).check();
  await page.getByLabel("Correo o teléfono de Zelle").fill("301-555-0199");
  await page.getByLabel("Cheque").check();
  await expect(page.getByTestId("total")).toHaveText("$3,869.00");
  await create.click();

  await expect(page).toHaveURL(/\/documents\//);
  await expect(page.getByRole("heading", { name: "Factura F-0001" })).toBeVisible();
  await expect(page.getByTestId("status")).toHaveText("Borrador");
  const doc = page.getByTestId("doc");
  await expect(doc.getByText("Pintar la cocina")).toBeVisible();
  await expect(doc.getByText("Zelle: 301-555-0199")).toBeVisible();
  await expect(doc.getByText(/Recargo de \$25\.00 si se paga más de 5 días/)).toBeVisible();

  await expect(page.getByRole("heading", { name: "¿Está lista para enviar?" })).toBeVisible();
  await page.getByTestId("send-email").click();
  await expect(page.getByTestId("status")).toHaveText("Enviada", { timeout: 15_000 });
  await page.getByTestId("send-sms").click();
  await expect(page.getByText("Enviada ✓")).toBeVisible();

  const sent = await calls(page);
  // The newest email: other specs send their own to the same stand-in earlier in the run.
  const email = JSON.parse([...sent].reverse().find((c) => c.url === "/emails")!.body);
  expect(email.to).toEqual(["juan@example.com"]);
  expect(email.attachments[0].filename).toBe("F-0001.pdf");
  const sms = new URLSearchParams(sent.find((c) => c.url.includes("Messages.json"))!.body);
  expect(sms.get("To")).toBe("+13015550100");
  const link = /http:\/\/127\.0\.0\.1:3100\/i\/[\w-]+/.exec(sms.get("Body")!)![0];

  // The customer's link works without signing in, and so does its PDF.
  const customer = await page.context().browser()!.newContext();
  const cp = await customer.newPage();
  await cp.goto(link);
  await expect(cp.getByTestId("doc").getByText("FACTURA")).toBeVisible();
  const pdf = await cp.request.get(`${link}/pdf`);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await customer.close();

  await page.reload();
  await page.getByRole("button", { name: "Marcar pagada" }).click();
  await expect(page.getByTestId("status")).toHaveText("Pagada");
  await expect(page.getByTestId("doc").getByText("PAGADA")).toBeVisible();
});

test("an estimate remembers last time's answers and becomes an invoice", async ({ page }) => {
  await signIn(page);
  await page.getByLabel("O escríbelo aquí").fill("Presupuesto para Juan, cambiar ventanas");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("button", { name: "Presupuesto" })).toHaveAttribute("aria-pressed", "true");
  // Changing the suggested price by hand counts as confirming it.
  await page.getByTestId("item").first().getByRole("textbox", { name: "Precio", exact: true }).fill("1600");
  await page.getByRole("button", { name: "Siguiente" }).click();
  // Juan is offered from last time, with his details.
  await page.getByRole("button", { name: "Juan" }).first().click();
  await expect(page.getByLabel("Correo del cliente")).toHaveValue("juan@example.com");
  await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(page.getByLabel("Nombre de tu empresa")).toHaveValue("Pintura Hernández");
  await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(page.getByLabel("Tasa de impuesto (%)")).toHaveValue("6");
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(page.getByLabel("Zelle", { exact: true })).toBeChecked();
  await page.getByRole("button", { name: "English" }).last().click();
  await page.getByRole("button", { name: "Crear" }).click();

  await expect(page.getByRole("heading", { name: "Presupuesto P-0001" })).toBeVisible();
  await expect(page.getByTestId("doc").getByText("ESTIMATE")).toBeVisible();
  await page.getByRole("button", { name: "Convertir en factura" }).click();
  await expect(page.getByRole("heading", { name: "Factura F-0002" })).toBeVisible();
  await expect(page.getByTestId("doc").getByText("$1,696.00").first()).toBeVisible();
});

test("the daily reminder job needs its secret and reminds nothing that isn't due", async ({ request }) => {
  const res = await request.get("/api/cron/reminders", { headers: { Authorization: "Bearer cron-fake" } });
  expect(res.status()).toBe(200);
  const json = await res.json();
  expect(json.results).toEqual([]);
});
