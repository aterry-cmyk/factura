import { expect, test, type Page } from "@playwright/test";
import { signWebhook } from "../lib/payments";
import { resetDb, signIn } from "./helpers";

// Estimates, photos, customers accepting and paying, and the dashboard. Stripe and Anthropic are
// the stand-ins in e2e/fake-services.mjs; the webhook is signed with the test secret.
test.use({ baseURL: "http://127.0.0.1:3101" });
test.describe.configure({ mode: "serial" });
const FAKE = "http://127.0.0.1:3199";

const call = (page: Page, url: string, method: string, data?: object) =>
  page.evaluate(async ([u, m, body]) => {
    const r = await fetch(u, { method: m, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [url, method, data] as const);

const doc = (kind: "invoice" | "estimate", name: string, description: string, cents: number) => ({
  kind, lang: "es",
  customer: { name, company: "", email: "", phone: "" },
  business: { name: "Pintura Hernández", phone: "301-555-0199" },
  items: [{ description, quantity: 1, unitPriceCents: cents, source: "said" }],
  state: "MD", taxEnabled: false, taxRate: 0, dueDays: 15, reminderDays: 7, lateFee: { type: "none" }, paymentMethods: { cash: { enabled: true } },
});

async function makeSent(page: Page, kind: "invoice" | "estimate", name: string, description: string, cents: number) {
  const r = await call(page, "/api/documents", "POST", doc(kind, name, description, cents));
  expect(r.status).toBe(200);
  expect((await call(page, `/api/documents/${r.json.id}/status`, "POST", { status: "sent" })).status).toBe(200);
  return { id: r.json.id as string };
}

/** The customer's link for a document, read from the owner's page. */
async function linkOf(page: Page, id: string): Promise<string> {
  await page.goto(`/documents/${id}`);
  const href = await page.getByTestId("public-link").getAttribute("href");
  return new URL(href!, "http://127.0.0.1:3101").pathname;
}

test.beforeAll(async ({ request }) => {
  await resetDb({ settings: { business_name: "Pintura Hernández" } });
  await request.get(`${FAKE}/_stripe?ready=0`);
});

test("Home: choose Estimado and Loro makes an estimate, whatever the words say", async ({ page }) => {
  await signIn(page);
  await expect(page.getByText("Loro decide")).toBeVisible();
  await page.getByRole("button", { name: "Estimado", exact: true }).click();
  await expect(page.getByText(/Ejemplo: «Estimado para Ana/)).toBeVisible();
  await page.getByLabel("O escríbelo aquí").fill("Factura para Juan, pintar la cocina 2200");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { name: "Revisa los conceptos" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Estimado", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("a photo of notes becomes text to check; a photo with nothing written is refused", async ({ page }) => {
  // A real photo-sized image of handwritten-style notes, and a blank 1×1 one.
  const notes = await page.context().newPage();
  await notes.setContent(`<div style="font:28px cursive;padding:30px;width:640px;height:420px;background:#fffbe6;line-height:1.6">
    Estimado para Juan<br>Pintar cocina 2200<br>Cambiar 3 ventanas<br>${"·".repeat(200)}</div>`);
  const photo = await notes.screenshot({ type: "png" });
  await notes.close();
  const blank = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

  await signIn(page);
  const input = page.getByTestId("photo-input");
  await input.setInputFiles({ name: "blank.png", mimeType: "image/png", buffer: blank });
  await expect(page.getByTestId("photo-note")).toHaveText(/No encontré trabajos ni precios escritos en la foto/);

  await input.setInputFiles({ name: "notas.png", mimeType: "image/png", buffer: photo });
  await expect(page.getByTestId("photo-note")).toHaveText(/Esto es lo que leí en la foto/);
  await expect(page.getByLabel("O escríbelo aquí")).toHaveValue("Estimado para Juan\nPintar cocina 2200\nCambiar 3 ventanas");
  // The paper said "Estimado", so Loro picks it.
  await expect(page.getByRole("button", { name: "Estimado", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { name: "Revisa los conceptos" })).toBeVisible();
  await expect(page.getByLabel("Nombre del cliente")).toHaveValue("Juan");
});

test("the customer accepts an estimate from their link, and the owner sees it", async ({ page, browser }) => {
  await signIn(page);
  const est = await makeSent(page, "estimate", "Elena Vas", "Cocina completa", 540000);
  const link = await linkOf(page, est.id);

  const customer = await browser.newContext({ baseURL: "http://127.0.0.1:3101" });
  const cp = await customer.newPage();
  await cp.goto(link);
  const box = cp.getByTestId("customer-box");
  await expect(box).toContainText("Pintura Hernández empieza cuando aceptes");
  await expect(box.getByRole("button", { name: "Aceptar estimado" })).toBeDisabled();
  await box.getByPlaceholder("Tu nombre").fill("Elena Vas");
  await box.getByRole("button", { name: "Aceptar estimado" }).click();
  await expect(box).toContainText("Estimado aceptado");
  await expect(box).toContainText("Elena Vas");
  // Accepting again does nothing.
  expect((await cp.request.post(`${link}/accept`, { data: { name: "Otra" } })).status()).toBe(409);
  await customer.close();

  await page.goto(`/documents/${est.id}`);
  await expect(page.getByText("El cliente lo aceptó Elena Vas")).toBeVisible();
});

test("online payments: connect Stripe, the customer pays, Stripe confirms, the invoice is paid", async ({ page, browser, request }) => {
  await signIn(page);
  const inv = await makeSent(page, "invoice", "Juan Pérez", "Pintar cocina", 220000);
  const link = await linkOf(page, inv.id);

  // Before Stripe is connected, the customer sees no Pagar button.
  const customer = await browser.newContext({ baseURL: "http://127.0.0.1:3101" });
  const cp = await customer.newPage();
  await cp.goto(link);
  await expect(cp.getByRole("button", { name: /Pagar/ })).toHaveCount(0);

  // The owner connects Stripe: off to Stripe's sign-up, back to Settings.
  await page.route("https://connect.stripe.test/**", (r) => r.fulfill({ body: "Stripe sign-up (stand-in)" }));
  await page.goto("/settings");
  const card = page.getByTestId("payments");
  await expect(card.getByTestId("payments-state")).toHaveText("Apagados");
  await card.getByRole("button", { name: "Conectar con Stripe" }).click();
  await expect(page).toHaveURL("https://connect.stripe.test/setup/acct_fake123");
  await page.goto("/settings?stripe=return");
  await expect(card.getByTestId("payments-state")).toHaveText("Falta terminar");
  await request.get(`${FAKE}/_stripe?ready=1`);
  await page.goto("/settings?stripe=return");
  await expect(card.getByTestId("payments-state")).toHaveText("Activos");

  // The customer pays: the button goes to Stripe's page for what's due.
  // The button posts to the app, which sends the customer on to Stripe (a 303 to the payment page).
  let sentTo = "";
  await cp.route(`**${link}/pay`, async (route) => {
    const res = await route.fetch({ maxRedirects: 0 });
    sentTo = res.headers().location ?? "";
    await route.fulfill({ body: "Stripe checkout (stand-in)" });
  });
  await cp.goto(link);
  await cp.getByRole("button", { name: "Pagar $2,200.00" }).click();
  await expect.poll(() => sentTo).toBe("https://checkout.stripe.test/pay/cs_test_fake");
  const calls = (await (await request.get(`${FAKE}/_calls`)).json()) as { url: string; body: string }[];
  const checkout = new URLSearchParams(calls.filter((c) => c.url === "/v1/checkout/sessions").at(-1)!.body);
  expect(checkout.get("line_items[0][price_data][unit_amount]")).toBe("220000");
  expect(checkout.get("payment_intent_data[application_fee_amount]")).toBe("2200");
  expect(checkout.get("payment_intent_data[transfer_data][destination]")).toBe("acct_fake123");
  const accountId = checkout.get("metadata[loro_account]")!;

  // Back on the link before Stripe confirms: it says the payment is being confirmed.
  await cp.goto(`${link}?pago=ok`);
  await expect(cp.getByRole("status")).toContainText("Recibimos tu pago");

  // Stripe's webhook: a bad signature is refused; the real one marks it paid, once.
  const event = (id: string, type: string) => JSON.stringify({
    id, type, data: { object: { id: "cs_test_fake", payment_status: "paid", payment_intent: "pi_1", amount_total: 220000, metadata: { loro_doc: inv.id, loro_account: accountId } } },
  });
  const bad = await request.post("/api/stripe/webhook", { data: event("evt_x", "checkout.session.completed"), headers: { "stripe-signature": signWebhook("other", "whsec_fake"), "content-type": "application/json" } });
  expect(bad.status()).toBe(400);
  const body = event("evt_1", "checkout.session.completed");
  const ok = await request.post("/api/stripe/webhook", { data: body, headers: { "stripe-signature": signWebhook(body, "whsec_fake"), "content-type": "application/json" } });
  expect(await ok.json()).toEqual({ ok: true });
  const again = await request.post("/api/stripe/webhook", { data: body, headers: { "stripe-signature": signWebhook(body, "whsec_fake"), "content-type": "application/json" } });
  expect(await again.json()).toEqual({ ok: true, repeat: true });

  await cp.goto(link);
  await expect(cp.getByTestId("customer-box")).toContainText("Pagada");
  await expect(cp.getByRole("button", { name: /Pagar/ })).toHaveCount(0);
  await customer.close();

  await page.goto(`/documents/${inv.id}`);
  await expect(page.getByText("Pagada en línea: $2,200.00")).toBeVisible();
});

test("the dashboard: overview, invoices with how late and who owes, estimates with acceptance", async ({ page }) => {
  await signIn(page);
  await makeSent(page, "invoice", "Carlos Ruiz", "Pintar 3 cuartos", 310000);
  await page.goto("/documents");
  await expect(page.getByTestId("totals")).toBeVisible();
  await expect(page.getByTestId("estimate-totals")).toBeVisible();
  await expect(page.getByTestId("invoice-chart")).toContainText("Facturado y cobrado por mes");

  await page.getByRole("link", { name: "Facturas", exact: true }).last().click();
  await expect(page).toHaveURL(/kind=invoice/);
  await expect(page.getByTestId("aging")).toContainText("Al día");
  await expect(page.getByTestId("aging").getByRole("link", { name: "Carlos Ruiz" })).toBeVisible();
  await expect(page.getByTestId("estimate-totals")).toHaveCount(0);

  await page.getByRole("link", { name: "Estimados", exact: true }).click();
  await expect(page).toHaveURL(/kind=estimate/);
  await expect(page.getByTestId("estimate-totals")).toContainText("Tasa de aceptación");
  await expect(page.getByTestId("estimate-chart")).toBeVisible();
  await expect(page.getByTestId("totals")).toHaveCount(0);
});
