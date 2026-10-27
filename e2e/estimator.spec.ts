import { expect, test, type Page } from "@playwright/test";
import { resetDb, signIn } from "./helpers";

const FAKE = "http://127.0.0.1:3199";
const calls = async (page: Page) => (await (await page.request.get(`${FAKE}/_calls`)).json()) as { url: string; body: string }[];

test.beforeAll(async () => {
  await resetDb({ settings: { state: "MD" } });
});

test("refuses the estimator's API without signing in", async ({ request }) => {
  for (const p of ["read", "examples", "preview", "products"]) expect((await request.post(`/api/estimator/${p}`, { data: {} })).status()).toBe(401);
});

test("kitchen photo → what Loro sees → questions with examples → the look → preview and products → an estimate to confirm", async ({ page }) => {
  const shot = await page.context().newPage();
  await shot.setContent(`<div style="width:800px;height:600px;background:linear-gradient(#c9b28a,#8a6d45)"></div>`);
  const photo = await shot.screenshot({ type: "jpeg" });
  await shot.close();

  await signIn(page);
  await page.getByRole("navigation", { name: "Secciones" }).getByRole("link", { name: "Estimador" }).click();
  await expect(page.getByRole("heading", { name: "Estimador con IA" })).toBeVisible();
  const next = page.getByTestId("est-next");

  // 1. the space and its photo
  await next.click();
  await expect(page.locator(".est [role=alert]")).toHaveText("¿Qué vamos a estimar?");
  await page.locator("[data-space=kitchen]").click();
  await next.click();
  await page.getByTestId("est-file").setInputFiles({ name: "cocina.jpg", mimeType: "image/jpeg", buffer: photo });
  await expect(page.locator(".est-photo img")).toBeVisible();
  await next.click();

  // 2. what it sees: its suggestions, minus a roof (not a kitchen project) and minus the low-priority floor
  await expect(page.getByTestId("est-reading")).toContainText("gabinetes de roble");
  await expect(page.getByRole("heading", { name: "¿Remodelar esta cocina?" })).toBeVisible();
  await expect(page.locator("[data-trade=kitchen]")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-trade=flooring]")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("details [data-trade=roofing]")).toHaveCount(1); // offered under "Otros trabajos", never as a suggestion
  await expect(page.locator("[data-trade=roofing] .est-pri")).toHaveCount(0);
  await next.click();

  // 3. the kitchen's questions, the quality choice with AI example pictures
  await expect(page.getByRole("heading", { name: "Cocina" })).toBeVisible();
  await next.click();
  await expect(page.locator(".est [role=alert]")).toHaveText("Contesta las preguntas para sacar el precio.");
  await page.getByRole("button", { name: "Mediana · 120–200 pies²" }).click();
  await page.locator(".est-pic", { hasText: "Remodelación completa" }).click();
  await expect(page.locator(".est-pic", { hasText: "Remodelación completa" }).locator("img")).toHaveAttribute("src", /fal\.media/);
  await page.getByRole("button", { name: "Dejar la distribución", exact: true }).click();
  await page.getByRole("button", { name: "Agregar una isla" }).click();
  await next.click();

  // 4. the look: one pick per question
  await expect(page.getByRole("heading", { name: "El estilo" })).toBeVisible();
  const questions = page.locator(".est-q");
  await expect(questions).toHaveCount(5);
  for (let i = 0; i < 5; i++) await questions.nth(i).locator(".est-pic").nth(1).click();
  await next.click();

  // 5. the preview, made from the photo, and similar products at Home Depot
  const products = page.getByTestId("est-products");
  await expect(products.getByText("Gabinetes tipo shaker")).toBeVisible();
  await expect(products.getByRole("link").first()).toHaveAttribute("href", "https://www.homedepot.com/s/navy%20shaker%20cabinets");
  const sent = await calls(page);
  const preview = sent.find((c) => c.url === "/fal-ai/nano-banana/edit")!;
  const prompt = JSON.parse(preview.body).prompt as string;
  expect(prompt).toMatch(/fully remodeled with new cabinets/);
  expect(prompt).toMatch(/a kitchen island/);
  expect(prompt).toMatch(/soft greige painted cabinets/);
  await next.click();

  // 6. the price range and time on site
  await expect(page.getByTestId("est-total")).toHaveText("$43,000–$82,000");
  await expect(page.getByTestId("est-time")).toHaveText("4 semanas–10 semanas");
  await page.getByTestId("est-make").click();

  // 7. Loro's own review: every line is a suggested price he has to confirm
  await expect(page.getByRole("heading", { name: "Revisa los conceptos" })).toBeVisible();
  const items = page.getByTestId("item");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0).getByText("Precio sugerido")).toBeVisible();
  await expect(items.nth(0).getByText(/Rango típico \$38,000–\$70,000/)).toBeVisible();
  const step = page.getByRole("button", { name: "Siguiente" });
  await expect(step).toBeDisabled();
  await items.nth(0).getByLabel("Confirmo este precio").check();
  await items.nth(1).getByLabel("Confirmo este precio").check();
  await page.getByLabel("Nombre del cliente").fill("Ana López");
  await step.click();

  await expect(page.getByRole("heading", { name: "¿A quién se la mandamos?" })).toBeVisible();
  await step.click();
  await page.getByLabel("Nombre de tu empresa").fill("Remodelaciones Hernández");
  await page.getByLabel("Tu nombre").fill("José Hernández");
  await page.getByLabel("Tu correo").fill("jose@example.com");
  await step.click();
  await page.getByLabel("¿En qué estado trabajas?").selectOption("MD");
  await page.getByRole("button", { name: "No", exact: true }).click();
  await step.click();
  await page.getByRole("button", { name: "En 15 días" }).click();
  await step.click();
  await page.getByLabel("Cheque").check();
  await page.getByRole("button", { name: "Crear" }).click();

  await expect(page).toHaveURL(/\/documents\//);
  await expect(page.getByRole("heading", { name: /Estimado/ })).toBeVisible();
  const doc = page.getByTestId("doc");
  await expect(doc.getByText("Cocina: Remodelación completa · mediana")).toBeVisible();
  await expect(doc.getByText(/Tiempo de trabajo estimado: 4 semanas–10 semanas/)).toBeVisible();
  await expect(doc.getByText(/Gabinetes tipo shaker/)).toBeVisible();
});
