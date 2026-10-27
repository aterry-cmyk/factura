import { expect, test, type Page } from "@playwright/test";
import { templatePlan } from "../lib/projects";
import { resetDb, signIn } from "./helpers";

// The control center: the client record, Loro asking and building the proposal, a line priced
// from the county feed (1build stand-in), the estimate it becomes, and the timeline.
test.describe.configure({ mode: "serial" });

const call = (page: Page, url: string, method: string, data?: object) =>
  page.evaluate(async ([u, m, body]) => {
    const r = await fetch(u, { method: m, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [url, method, data] as const);

let projectUrl = "";

test.beforeAll(async () => {
  await resetDb({ settings: { business_name: "Pintura Hernández", address: "4041 Powder Mill Rd, Beltsville, MD 20705", markup_percent: 25, contingency_percent: 10 } });
});

test("a client has a record; the project's overview is the control center", async ({ page }) => {
  await signIn(page);
  // A past invoice so "Pintar cocina" is in the owner's catalog.
  const inv = await call(page, "/api/documents", "POST", {
    kind: "invoice", lang: "es", customer: { name: "Ana López", company: "", email: "ana@example.com", phone: "3015550100" }, business: { name: "Pintura Hernández", phone: "301-555-0199" },
    items: [{ description: "Pintar cocina", quantity: 1, unitPriceCents: 220000, source: "said" }], state: "MD", taxEnabled: false, taxRate: 0, dueDays: 15, reminderDays: 7, lateFee: { type: "none" }, paymentMethods: { cash: { enabled: true } },
  });
  expect(inv.status).toBe(200);
  await call(page, `/api/documents/${inv.json.id}/status`, "POST", { status: "sent" });
  const r = await call(page, "/api/projects", "POST", {
    name: "Cocina de Ana", description: "Remodelar la cocina completa", lang: "es", customer: { name: "Ana López", company: "", email: "ana@example.com", phone: "3015550100" },
    totalCents: 0, estimateId: null, plan: templatePlan("es"), planSource: "template",
  });
  expect(r.status).toBe(200);
  projectUrl = `/projects/${r.json.id}`;

  await page.goto("/clients");
  await expect(page.getByTestId("client-list")).toContainText("Ana López");
  await page.getByRole("link", { name: /Ana López/ }).click();
  await expect(page.getByTestId("client-name")).toHaveText("Ana López");
  await page.getByTestId("client-address").fill("12 Elm St, Beltsville MD");
  await page.getByTestId("save-client").click();
  await expect(page.getByRole("status")).toContainText("Cliente guardado");
  await expect(page.getByTestId("client-projects")).toContainText("Cocina de Ana");
  await expect(page.getByTestId("client-docs")).toContainText("F-0001");

  await page.goto(projectUrl);
  await expect(page.getByTestId("project-tabs")).toContainText("Propuesta");
  await expect(page.getByTestId("next-steps")).toContainText("Armar la propuesta con Loro");
  await expect(page.getByTestId("next-steps")).toContainText("Poner fechas al cronograma");
});

test("Loro asks, builds the proposal, a line is priced from the county feed, and it becomes the estimate", async ({ page }) => {
  await signIn(page);
  await page.goto(`${projectUrl}?tab=propuesta`);
  await page.getByTestId("start-proposal").click();
  const questions = page.getByTestId("scope-question");
  await expect(questions).toHaveCount(2);
  await questions.nth(0).getByRole("button", { name: "150" }).click();
  await questions.nth(1).getByRole("button", { name: "Sí" }).click();
  await page.getByTestId("answer-questions").click();
  await expect(page.getByTestId("proposal-note")).toContainText("Propuesta armada");
  const lines = page.getByTestId("proposal-line");
  await expect(lines).toHaveCount(3);
  await expect(lines.nth(0)).toHaveAttribute("data-source", "suggested");
  await expect(lines.nth(1)).toHaveAttribute("data-source", "history"); // matches the past invoice exactly
  await expect(lines.nth(1)).toContainText("Tu precio anterior");
  await expect(lines.nth(2)).toHaveAttribute("data-source", "none");
  await expect(page.getByTestId("make-estimate")).toBeDisabled();

  // The unpriced floor line: county rates from the feed, picked with one tap.
  await lines.nth(2).getByTestId("find-price").click();
  await expect(page.getByTestId("price-lookup")).toContainText("Prince George's County");
  await page.getByTestId("pick-rate").click();
  await expect(lines.nth(2)).toHaveAttribute("data-source", "price");
  await expect(lines.nth(2)).toContainText("$1,875.00"); // 150 SF × $12.50
  await lines.nth(0).getByTestId("confirm-line").check();
  // cost 600 + 2200 + 1875 = 4675; +25% = 5843.75; +10% = 6428.13
  await expect(page.getByTestId("proposal-total")).toHaveText("$6,428.13");
  await page.getByTestId("save-proposal").click();
  await expect(page.getByTestId("proposal-note")).toContainText("Borrador guardado");

  page.once("dialog", (d) => d.accept());
  await page.getByTestId("make-estimate").click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("status")).toHaveText("Enviada");
  await expect(page.getByRole("cell", { name: /Pintura: Pintar cocina/ })).toBeVisible();
  await expect(page.getByRole("cell", { name: /Contingencia \(10%\)/ })).toBeVisible();

  await page.goto(projectUrl);
  await expect(page.getByTestId("overview")).toContainText("$6,428.13");
  await expect(page.getByTestId("next-steps")).toContainText("Esperando que Ana López acepte el estimado P-0001");
});

test("the timeline: Loro's days, the owner's start date, dates end to end, and the customer sees them", async ({ page, browser }) => {
  await signIn(page);
  await page.goto(`${projectUrl}?tab=cronograma`);
  await expect(page.getByTestId("gantt-row")).toHaveCount(5);
  await page.getByTestId("starts-on").fill("2026-11-02");
  await page.getByTestId("milestone-days").nth(2).fill("7");
  await expect(page.getByTestId("ends-on")).toHaveText("17 nov"); // 1 + 3 + 7 + 4 + 1 days from Nov 2
  await page.getByTestId("save-schedule").click();
  await expect(page.getByRole("status")).toContainText("Cronograma guardado");
  await page.goto(projectUrl);
  await expect(page.getByTestId("overview")).toContainText("2026-11-02".slice(0, 0) + "2 nov");
  await expect(page.getByTestId("next-steps")).not.toContainText("Poner fechas");

  const href = await page.getByTestId("public-link").getAttribute("href");
  const customer = await browser.newContext();
  const cp = await customer.newPage();
  await cp.goto(href!);
  await expect(cp.getByText("2026-11-06 – 2026-11-12")).toBeVisible();
  await customer.close();
});
