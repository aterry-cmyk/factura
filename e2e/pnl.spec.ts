import { expect, test, type Page } from "@playwright/test";
import { templatePlan } from "../lib/projects";
import { resetDb, signIn } from "./helpers";

// The money side: the crew and its burden, a project's budget, costs said in words (hours become
// labor at the real wage), a receipt photo, the P&L by period, a material price with its source,
// and quantities taken off a PDF of plans. The model is the stand-in in e2e/fake-services.mjs.
test.describe.configure({ mode: "serial" });

const call = (page: Page, url: string, method: string, data?: object) =>
  page.evaluate(async ([u, m, body]) => {
    const r = await fetch(u, { method: m, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [url, method, data] as const);

let projectUrl = "";

test.beforeAll(async () => {
  await resetDb({ settings: { business_name: "Pintura Hernández", address: "4041 Powder Mill Rd, Beltsville, MD 20705" } });
});

test("the crew: a worker with a wage, and the burden that makes the true hourly cost", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings/crew");
  await page.getByTestId("burden-wc").fill("9.58");
  await page.getByTestId("burden-gl").fill("2.5");
  await page.getByTestId("burden-tax").fill("14");
  await page.getByTestId("save-burden").click();
  await expect(page.getByTestId("burden-total")).toHaveText("26.08%");
  await page.getByTestId("worker-name").fill("Pedro");
  await page.getByTestId("worker-wage").fill("28");
  await page.getByTestId("add-worker").click();
  const row = page.getByTestId("worker").first();
  await expect(row).toContainText("Pedro");
  await expect(row).toContainText("$35.30"); // $28 × 1.2608
  await expect(row).toContainText("$282.40");
});

test("budget, costs from words and a receipt, and the P&L that follows", async ({ page }) => {
  await signIn(page);
  const r = await call(page, "/api/projects", "POST", {
    name: "Cocina de Ana", description: "", lang: "es", customer: { name: "Ana López", company: "", email: "", phone: "" },
    totalCents: 2_500_000, estimateId: null, plan: templatePlan("es"), planSource: "template",
  });
  expect(r.status).toBe(200);
  projectUrl = `/projects/${r.json.id}?tab=dinero`;
  await page.goto(projectUrl);

  await page.getByTestId("budget-labor").fill("9000");
  await page.getByTestId("budget-materials").fill("4000");
  await page.getByTestId("save-budgets").click();
  await expect(page.getByTestId("pnl-labor")).toContainText("$9,000.00");
  await expect(page.getByTestId("margin-projected")).toContainText("$12,000.00"); // 25,000 − 13,000 budget, nothing done yet

  await page.getByTestId("cost-text").fill("Hoy trabajó Pedro 8 horas, 340 de pintura en Home Depot y el plomero cobró seiscientos y pico");
  await page.getByTestId("parse-costs").click();
  const pending = page.getByTestId("pending-cost");
  await expect(pending).toHaveCount(3);
  await expect(pending.nth(0)).toContainText("Pedro · 8 h · calculado con su salario");
  await expect(pending.nth(0).getByTestId("pending-amount")).toHaveValue("282.40");
  await expect(pending.nth(1)).toContainText("Monto dicho por ti");
  await expect(pending.nth(1).getByTestId("pending-amount")).toHaveValue("340.00");
  // 650 wasn't in the words: the app flags it and won't save until the owner confirms.
  await expect(pending.nth(2).getByTestId("confirm-cost")).toBeVisible();
  await page.getByTestId("save-costs").click();
  await expect(page.getByTestId("cost-note")).toContainText("Confirma cada monto");
  await pending.nth(2).getByTestId("confirm-cost").check();
  await page.getByTestId("save-costs").click();
  await expect(page.getByTestId("cost-note")).toContainText("Guardado: 3 gastos");

  await page.goto(projectUrl);
  await expect(page.getByTestId("spent")).toHaveText("$1,272.40");
  await expect(page.getByTestId("pnl-labor")).toContainText("$282.40 (3%)");
  await expect(page.getByTestId("cost-list").locator("li")).toHaveCount(3);

  // A receipt: a real-sized picture reads as Home Depot, $184.32; the owner confirms it.
  const paper = await page.context().newPage();
  await paper.setContent(`<div style="font:22px monospace;padding:30px;width:420px;height:640px;background:#fff">HOME DEPOT<br>10/20/2026<br>DRYWALL 1/2 4X8 120.00<br>TORNILLOS 64.32<br>TOTAL 184.32<br>${"·".repeat(300)}</div>`);
  const photo = await paper.screenshot({ type: "png" });
  await paper.close();
  await page.getByTestId("receipt-photo").setInputFiles({ name: "recibo.png", mimeType: "image/png", buffer: photo });
  await expect(page.getByTestId("cost-note")).toContainText("Leí el recibo: Home Depot, $184.32");
  await expect(page.getByTestId("pending-cost")).toHaveCount(1);
  await page.getByTestId("confirm-cost").check();
  await page.getByTestId("save-costs").click();
  await expect(page.getByTestId("cost-note")).toContainText("Guardado: 1 gasto.");
  await page.goto(projectUrl);
  await expect(page.getByTestId("spent")).toHaveText("$1,456.72");
  await expect(page.getByTestId("cost-list")).toContainText("Drywall 1/2 4x8, Tornillos · Home Depot");

  // The P&L page by period.
  await page.goto(`${projectUrl.split("?")[0]}/pnl?period=month`);
  await expect(page.getByTestId("rollup-row")).toHaveCount(1);
  await expect(page.getByTestId("rollup-row").first()).toContainText("$1,456.72");
  await page.goto(`${projectUrl.split("?")[0]}/pnl?period=day`);
  await expect(page.getByTestId("rollup-row")).toHaveCount(2); // today, and the receipt's 10/20
  await page.goto("/projects");
  await expect(page.getByTestId("business-month")).toContainText("Gastado este mes");
});

test("a material price comes with the page it was found on; a page the search never returned is dropped", async ({ page }) => {
  await signIn(page);
  await page.goto("/prices");
  await page.getByTestId("price-query").fill("drywall 1/2 4x8");
  await page.getByTestId("price-search").click();
  await expect(page.getByTestId("own-prices")).toContainText("Drywall 1/2 4x8, Tornillos · Home Depot"); // the receipt from the project
  const options = page.getByTestId("price-option");
  await expect(options).toHaveCount(1);
  await expect(options.first()).toContainText("Home Depot");
  await expect(options.first()).toContainText("$15.98");
  await expect(options.first().getByRole("link", { name: "Ver la página" })).toHaveAttribute("href", "https://www.homedepot.com/p/drywall-123");
  await expect(page.getByTestId("found-prices")).toContainText("Confirma antes de comprar");
});

test("quantities taken off a PDF of plans become lines for the estimate, never prices", async ({ page }) => {
  await signIn(page);
  await page.goto("/");
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF");
  await page.getByTestId("plans-input").setInputFiles({ name: "planos.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(page.getByTestId("photo-note")).toContainText("Son cantidades, no precios");
  await expect(page.getByLabel("O escríbelo aquí")).toHaveValue("Piso de madera — 320 SF (A-2, sala 16x20)\nZoclo — 72 LF (A-2)");
  await expect(page.getByRole("button", { name: "Estimado", exact: true })).toHaveAttribute("aria-pressed", "true");
  const bad = await page.getByTestId("plans-input").setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0]) });
  void bad;
  await expect(page.getByTestId("photo-note")).toContainText("Sube un PDF");
});
