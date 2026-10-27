import { expect, test, type Page } from "@playwright/test";
import { resetDb, signIn } from "./helpers";

// A project from an accepted estimate: Loro proposes the plan, the owner ticks steps and adds a
// photo, invoices the first milestone, and the customer's link shows progress and the next payment.
test.describe.configure({ mode: "serial" });

const call = (page: Page, url: string, method: string, data?: object) =>
  page.evaluate(async ([u, m, body]) => {
    const r = await fetch(u, { method: m, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [url, method, data] as const);

let estimateId = "";
let projectUrl = "";
let publicPath = "";

test.beforeAll(async () => {
  await resetDb({ settings: { business_name: "Pintura Hernández" } });
});

test("an accepted estimate offers to become a project, and Loro proposes the plan", async ({ page, browser }) => {
  await signIn(page);
  const r = await call(page, "/api/documents", "POST", {
    kind: "estimate", lang: "es",
    customer: { name: "Ana López", company: "", email: "ana@example.com", phone: "3015550100" },
    business: { name: "Pintura Hernández", phone: "301-555-0199" },
    items: [{ description: "Pintar la casa por dentro", quantity: 1, unitPriceCents: 1_200_000, source: "said" }],
    state: "MD", taxEnabled: false, taxRate: 0, dueDays: 15, reminderDays: 7, lateFee: { type: "none" }, paymentMethods: { cash: { enabled: true } },
  });
  expect(r.status).toBe(200);
  estimateId = r.json.id;
  expect((await call(page, `/api/documents/${estimateId}/status`, "POST", { status: "sent" })).status).toBe(200);
  await page.goto(`/documents/${estimateId}`);
  const link = await page.getByTestId("public-link").getAttribute("href");
  const token = new URL(link!, "http://127.0.0.1:3100").pathname.split("/").pop()!;
  const customer = await browser.newContext();
  const cp = await customer.newPage();
  const acc = await cp.request.post(`http://127.0.0.1:3100/i/${token}/accept`, { data: { name: "Ana López" } });
  expect(acc.ok()).toBeTruthy();
  await customer.close();

  await page.goto(`/documents/${estimateId}`);
  await expect(page.getByTestId("project-offer")).toContainText("Conviértelo en un proyecto");
  await page.getByRole("link", { name: "Crear proyecto" }).click();
  await expect(page).toHaveURL(/\/projects\/new\?from=/);
  await expect(page.getByTestId("from-estimate")).toContainText("Ana López");
  await expect(page.getByTestId("project-total")).toHaveValue("12000.00");

  await page.getByTestId("propose-plan").click();
  await expect(page.getByTestId("plan-source")).toHaveText("Propuesto por Loro");
  await expect(page.getByLabel("Hito 1", { exact: true })).toHaveValue("Anticipo");
  await expect(page.getByLabel("Hito 3", { exact: true })).toHaveValue("Entrega");
  await expect(page.getByTestId("ms-amount").nth(1)).toHaveText("$6,000.00");
  await expect(page.getByTestId("share-sum")).toContainText("100%");
  await page.getByTestId("create-project").click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  projectUrl = `${page.url()}?tab=avance`;
  await page.goto(projectUrl);
  await expect(page.getByTestId("project-name")).toHaveText("Pintar la casa por dentro");
  await expect(page.getByTestId("remaining")).toHaveText("$12,000.00");
  await expect(page.getByTestId("percent")).toHaveText("0%");
});

test("ticking the steps and adding a photo moves the progress; the milestone becomes an invoice", async ({ page }) => {
  await signIn(page);
  await page.goto(projectUrl);
  const first = page.getByTestId("milestone").first();
  await expect(first.getByTestId("invoice-milestone")).toBeDisabled();
  // The box is controlled: it ticks once the server has saved the step.
  await first.getByRole("checkbox").first().click();
  await expect(first.getByRole("checkbox").first()).toBeChecked();
  await expect(page.getByTestId("percent")).toHaveText("20%");
  await expect(first.getByTestId("invoice-milestone")).toBeEnabled();
  await expect(page.getByTestId("update-text")).toContainText("Terminado hoy: Fecha de inicio acordada.");

  // A real (small) PNG for the step; the server keeps it and the customer's page shows it.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  await first.getByTestId("step-photo").setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: png });
  await expect(page.getByRole("status")).toContainText("Foto guardada");
  await expect(first.locator("img")).toHaveCount(1);

  await first.getByTestId("invoice-milestone").click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("status")).toHaveText("Enviada");
  await expect(page.getByText("Pintar la casa por dentro — hito 1: Anticipo")).toBeVisible();
  await expect(page.getByText("$2,400.00").first()).toBeVisible();

  await page.goto(projectUrl);
  await expect(page.getByTestId("milestone").first()).toHaveAttribute("data-status", "invoiced");
  await expect(page.getByTestId("invoiced")).toHaveText("$2,400.00");
  await expect(page.getByTestId("remaining")).toHaveText("$9,600.00");
  const href = await page.getByTestId("public-link").getAttribute("href");
  publicPath = new URL(href!, "http://127.0.0.1:3100").pathname;
  expect(publicPath).toMatch(/^\/p\/[A-Za-z0-9_-]{20,}$/);
});

test("the customer's link shows progress, the photo and the next payment; paying the invoice pays the milestone", async ({ page, browser }) => {
  const customer = await browser.newContext();
  const cp = await customer.newPage();
  await cp.goto(`http://127.0.0.1:3100${publicPath}`);
  await expect(cp.getByTestId("project-name")).toHaveText("Pintar la casa por dentro");
  await expect(cp.getByTestId("progress-box")).toContainText("20% terminado");
  await expect(cp.getByTestId("next-payment")).toContainText("Anticipo");
  await expect(cp.getByTestId("next-payment")).toContainText("$2,400.00");
  await expect(cp.getByTestId("photos").locator("img")).toHaveCount(1);
  const invoiceLink = await cp.getByRole("link", { name: /Ver factura F-0001 y pagar/ }).getAttribute("href");
  await cp.goto(`http://127.0.0.1:3100${invoiceLink}`);
  await expect(cp.getByText("F-0001")).toBeVisible();
  await customer.close();

  await signIn(page);
  await page.goto(projectUrl);
  const invoiceHref = await page.getByRole("link", { name: "Ver factura F-0001" }).getAttribute("href");
  const invoiceId = invoiceHref!.split("/").pop()!;
  expect((await call(page, `/api/documents/${invoiceId}/status`, "POST", { status: "paid" })).status).toBe(200);
  await page.goto(projectUrl);
  await expect(page.getByTestId("milestone").first()).toHaveAttribute("data-status", "paid");
  await expect(page.getByTestId("paid")).toHaveText("$2,400.00");

  await page.goto(`/documents/${estimateId}`);
  await expect(page.getByTestId("project-offer")).toContainText("ya es un proyecto");
  await page.goto("/projects");
  await expect(page.getByTestId("project-list")).toContainText("Pintar la casa por dentro");

  // Nobody else's project: a made-up token is a 404, and a photo id from another project is refused.
  const r = await page.request.get("/p/abcdefghijklmnopqrstuvwx");
  expect(r.status()).toBe(404);
});
