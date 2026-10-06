import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

// The assistant asks a few contractor's questions before writing the invoice. The stand-in AI
// (e2e/fake-services.mjs) asks three about a door and writes the line from the answers.
test.use({ baseURL: "http://127.0.0.1:3101" });

test.beforeAll(async () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
  await sql.unsafe(readFileSync("db/schema.sql", "utf8"));
  await sql`update settings set voice_on = false where id = 1`;
  await sql.end();
});

async function start(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Contraseña / Password").fill("prueba-1234");
  await page.getByRole("button", { name: "Entrar / Sign in" }).click();
  await page.getByLabel("O escríbelo aquí").fill("Factura para Ana, cambié una puerta 900");
  await page.getByRole("button", { name: "Continuar" }).click();
  const box = page.getByTestId("details");
  await expect(box).toBeVisible();
  return box;
}

test("asks the questions one by one, takes a tap, typed words or a skip, and writes the line from the answers", async ({ page }) => {
  const box = await start(page);
  await expect(box.getByRole("heading", { name: "¿Cuántas puertas?" })).toBeVisible();
  await expect(box.getByText("Unas preguntas rápidas · 1 de 3")).toBeVisible();
  await box.getByRole("button", { name: "2", exact: true }).click();

  await expect(box.getByRole("heading", { name: "¿De qué tipo?" })).toBeVisible();
  await box.getByLabel("Otra respuesta…").fill("Entrada");
  await box.getByLabel("Otra respuesta…").press("Enter");

  await expect(box.getByRole("heading", { name: "¿Incluye retiro de la vieja?" })).toBeVisible();
  await box.getByRole("button", { name: "Sí", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Revisa los conceptos" })).toBeVisible();
  const item = page.getByTestId("item").first();
  await expect(item.getByRole("textbox", { name: "Descripción" })).toHaveValue("Instalación de 2 puertas de entrada, con retiro y desecho de la puerta vieja");
  await expect(item.getByRole("textbox", { name: "Precio", exact: true })).toHaveValue("900");
  await expect(page.getByLabel("Nombre del cliente")).toHaveValue("Ana");
});

test("skipping a question leaves that detail out; skipping all keeps the first answer as it was", async ({ page }) => {
  let box = await start(page);
  await box.getByRole("button", { name: "Saltar", exact: true }).click();
  await box.getByRole("button", { name: "Interior" }).click();
  await box.getByRole("button", { name: "No", exact: true }).click();
  await expect(page.getByTestId("item").first().getByRole("textbox", { name: "Descripción" })).toHaveValue("Instalación de puerta de interior");

  await page.getByRole("button", { name: "Atrás" }).click();
  box = page.getByTestId("details");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(box).toBeVisible();
  await box.getByRole("button", { name: "Hacer la factura sin más detalles" }).click();
  await expect(page.getByTestId("item").first().getByRole("textbox", { name: "Descripción" })).toHaveValue("Cambio de puerta");
});
