import { expect, test, type Page } from "@playwright/test";
import { db, OWNER, resetDb, signIn } from "./helpers";

// Loro AI accounts end to end: an admin invites a contractor, she signs up and answers the setup
// questions, her data is hers alone, she manages her password, and the admin manages her plan.
test.use({ baseURL: "http://127.0.0.1:3101" });
test.describe.configure({ mode: "serial" });

const ROSA = { email: "rosa@example.com", password: "Techos2026", name: "Rosa Díaz" };
let invite = "";
let ownerDocId = "";

const call = (page: Page, url: string, method: string, data?: object) =>
  page.evaluate(async ([u, m, body]) => {
    const r = await fetch(u, { method: m, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [url, method, data] as const);

test.beforeAll(async () => {
  await resetDb({ admin: true, settings: { business_name: "Pintura Hernández" } });
});

test("sign-up is invitation-only until the admin opens it", async ({ page, request }) => {
  await page.goto("/signup");
  await expect(page.getByRole("heading", { name: "Loro AI es por invitación, por ahora" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Unirme a la lista de espera" })).toHaveAttribute("href", /#lista$/);
  const r = await request.post("/api/signup", { data: { name: "X", email: "x@example.com", password: "Prueba2026" } });
  expect(r.status()).toBe(403);
});

test("the admin makes an invitation and the owner's first invoice exists", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Dime qué necesitas" })).toBeVisible();
  const doc = await call(page, "/api/documents", "POST", {
    kind: "invoice", lang: "es",
    customer: { name: "Juan Pérez", company: "", email: "", phone: "" },
    business: { name: "Pintura Hernández", phone: "301-555-0199" },
    items: [{ description: "Pintar cocina", quantity: 1, unitPriceCents: 220000, source: "said" }],
    state: "MD", taxEnabled: false, taxRate: 0, dueDays: 15, reminderDays: 7, lateFee: { type: "none" }, paymentMethods: { cash: { enabled: true } },
  });
  expect(doc.status).toBe(200);
  ownerDocId = doc.json.id;

  await page.getByLabel("Menú de la cuenta").click();
  await page.getByRole("menuitem", { name: "Admin de Loro AI" }).click();
  await expect(page.getByRole("heading", { name: "Admin de Loro AI" })).toBeVisible();
  await page.getByPlaceholder("contratista@email.com").fill(ROSA.email);
  await page.getByRole("button", { name: "Crear invitación" }).click();
  const link = page.getByTestId("one-time-link");
  await expect(link).toHaveText(/\/signup\?invite=/);
  invite = new URL((await link.textContent())!).searchParams.get("invite")!;
});

test("the invited contractor signs up and answers the setup questions", async ({ page }) => {
  await page.goto(`/signup?invite=${invite}`);
  await expect(page.getByText(`Invitación para ${ROSA.email}`)).toBeVisible();
  await expect(page.getByLabel("Tu email")).toHaveValue(ROSA.email);
  await page.getByLabel("Tu nombre").fill(ROSA.name);
  await page.getByLabel("Contraseña", { exact: true }).fill("corta");
  await page.getByRole("button", { name: "Crear mi cuenta" }).click();
  await expect(page.locator(".note.bad[role=alert]")).toHaveText("La contraseña necesita al menos 8 caracteres.");
  await page.getByLabel("Contraseña", { exact: true }).fill(ROSA.password);
  await page.getByRole("button", { name: "Crear mi cuenta" }).click();

  // New accounts land on the setup questions.
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByRole("heading", { name: "¡Hola, Rosa! Soy Loro." })).toBeVisible();
  await page.getByRole("button", { name: "Empezar" }).click();

  await expect(page.getByText("Paso 1 de 6")).toBeVisible();
  const next = page.getByRole("button", { name: "Siguiente" });
  await expect(next).toBeDisabled();
  await page.getByLabel("Nombre del negocio").fill("Techos Díaz");
  await page.getByRole("button", { name: "Techos" }).click();
  await next.click();

  await expect(page.getByRole("heading", { name: "¿Cómo te contactan tus clientes?" })).toBeVisible();
  await page.getByLabel("Teléfono").fill("30155");
  await expect(page.getByText("Escribe un teléfono de 10 dígitos.")).toBeVisible();
  await expect(next).toBeDisabled();
  await page.getByLabel("Teléfono").fill("(240) 555-0142");
  await expect(page.getByLabel("Email")).toHaveValue(ROSA.email);
  await next.click();

  await expect(page.getByRole("heading", { name: "¿En qué estado trabajas?" })).toBeVisible();
  await page.getByLabel("¿En qué estado trabajas?").selectOption("VA");
  await page.getByRole("button", { name: "Sí" }).click();
  await page.getByLabel("Porcentaje de impuesto").fill("5.3");
  await next.click();

  await expect(page.getByRole("heading", { name: "¿Cómo te pagan?" })).toBeVisible();
  await page.getByLabel("Zelle").check();
  await expect(page.getByLabel("Correo o teléfono de Zelle")).toHaveValue("2405550142");
  await page.getByRole("button", { name: "30 días", exact: true }).click();
  await page.getByRole("button", { name: "Cada 7 días", exact: true }).click();
  await next.click();

  await expect(page.getByRole("heading", { name: "¿Cómo quieres que te hable?" })).toBeVisible();
  await page.getByLabel("País").selectOption("MX");
  await page.getByRole("button", { name: "Voz de hombre" }).click();
  await page.getByRole("button", { name: "Guardar" }).click();

  await expect(page.getByRole("heading", { name: "¿Tienes un logo?" })).toBeVisible();
  await page.getByRole("button", { name: "Saltar" }).click();
  await expect(page.getByRole("heading", { name: "¡Listo! Ya estoy anotado." })).toBeVisible();
  await page.getByRole("link", { name: "Hacer mi primera factura" }).click();
  await expect(page.getByRole("heading", { name: "Dime qué necesitas" })).toBeVisible();
  await expect(page.getByText("Hola, Rosa")).toBeVisible();

  // What she answered is what's saved.
  const sql = db();
  const [s] = await sql`select s.business_name, s.trade, s.state, s.tax_rate::float as tax, s.phone, s.due_days, s.reminder_days,
      s.payment_methods, s.country, s.voice_gender, s.onboarded, a.name, a.plan
    from settings s join accounts a on a.id = s.account_id join memberships m on m.account_id = a.id
    join users u on u.id = m.user_id where u.email = ${ROSA.email}`;
  await sql.end();
  expect(s).toMatchObject({
    business_name: "Techos Díaz", trade: "roofing", state: "VA", tax: 5.3, phone: "+12405550142", due_days: 30, reminder_days: 7,
    payment_methods: { cash: { enabled: true }, zelle: { enabled: true, handle: "2405550142" } },
    country: "MX", voice_gender: "male", onboarded: true, name: "Techos Díaz", plan: "trial",
  });
});

test("one business can't see or touch another's invoices, and only the admin sees the admin", async ({ page }) => {
  await signIn(page, ROSA);
  await page.goto("/documents");
  await expect(page.getByText("Pintar cocina")).toHaveCount(0);
  expect((await page.goto(`/documents/${ownerDocId}`))?.status()).toBe(404);
  expect((await call(page, `/api/documents/${ownerDocId}/status`, "POST", { status: "void" })).status).toBe(404);
  expect((await call(page, `/api/documents/${ownerDocId}/pdf`, "GET")).status).toBe(404);

  await page.goto("/");
  await page.getByLabel("Menú de la cuenta").click();
  await expect(page.getByRole("menuitem", { name: "Mi cuenta" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Admin de Loro AI" })).toHaveCount(0);
  expect((await page.goto("/admin"))?.status()).toBe(404);
  expect((await call(page, "/api/admin/platform", "PATCH", { signupsOpen: true })).status).toBe(404);
  expect((await call(page, "/api/admin/invites", "POST", { email: "z@example.com" })).status).toBe(404);
});

test("my account: plan and use, a password change, and signing out other devices", async ({ page, browser }) => {
  // Another device signed in as Rosa.
  const other = await browser.newContext({ baseURL: "http://127.0.0.1:3101" });
  const phone = await other.newPage();
  await signIn(phone, ROSA);

  await signIn(page, ROSA);
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Mi cuenta" })).toBeVisible();
  await expect(page.getByTestId("plan-badge")).toHaveText("Prueba gratis");
  await expect(page.getByTestId("trial-note")).toHaveText(/Te quedan 1[34] días de prueba gratis/);
  await expect(page.getByText("0 / 20")).toBeVisible();

  await page.getByLabel("Contraseña actual").fill("Equivocada1");
  await page.getByLabel("Contraseña nueva").fill("Nueva2026x");
  await page.getByRole("button", { name: "Cambiar contraseña" }).click();
  await expect(page.getByText("La contraseña no es correcta.")).toBeVisible();
  await page.getByLabel("Contraseña actual").fill(ROSA.password);
  await page.getByRole("button", { name: "Cambiar contraseña" }).click();
  await expect(page.getByText("Listo. Cerramos tu sesión en los otros aparatos.")).toBeVisible();
  ROSA.password = "Nueva2026x";

  // The other device was signed out by the change.
  await phone.goto("/documents");
  await expect(phone).toHaveURL(/\/login$/);
  await other.close();

  // This one still works, and signing out works.
  await page.goto("/documents");
  await expect(page.getByRole("heading", { name: "Todas tus facturas y presupuestos" })).toBeVisible();
  await page.getByLabel("Menú de la cuenta").click();
  await page.getByRole("menuitem", { name: "Salir" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

test("the admin sees her account, moves her to Pro, pauses her, and makes a reset link", async ({ page, browser }) => {
  await signIn(page);
  await page.goto("/admin");
  const row = page.getByTestId("accounts").locator("tr", { hasText: "Techos Díaz" });
  await expect(row).toContainText(ROSA.email);
  await expect(row).toContainText("Prueba gratis");
  await row.getByRole("link", { name: "Techos Díaz" }).click();
  await expect(page.getByRole("heading", { name: "Techos Díaz" })).toBeVisible();

  await page.getByLabel("Plan", { exact: true }).selectOption("pro");
  await page.getByLabel("Cuota mensual (USD)").fill("29");
  await page.getByLabel("Notas de cobro").fill("Paga por Zelle el día 5");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Guardado")).toBeVisible();
  await page.goto("/admin");
  await expect(page.getByTestId("admin-totals")).toContainText("Ingreso mensual$29.00");

  // Paused: she can sign in and look, but not make anything.
  await page.getByTestId("accounts").locator("tr", { hasText: "Techos Díaz" }).getByRole("link").first().click();
  await page.getByLabel("Estado").selectOption("suspended");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Guardado")).toBeVisible();
  const rosa = await browser.newContext({ baseURL: "http://127.0.0.1:3101" });
  const rp = await rosa.newPage();
  await signIn(rp, ROSA);
  const blocked = await call(rp, "/api/documents", "POST", {});
  expect(blocked).toEqual({ status: 402, json: { error: "suspended" } });
  await rp.goto("/account");
  await expect(rp.getByTestId("plan-badge")).toHaveText("Pausada");
  await rosa.close();
  await page.getByLabel("Estado").selectOption("active");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Guardado")).toBeVisible();

  // A forgotten password: the admin makes a one-time link and sends it by hand.
  await page.getByRole("button", { name: "Enlace para cambiar contraseña" }).click();
  const resetUrl = new URL((await page.getByTestId("one-time-link").textContent())!);
  const anon = await browser.newContext({ baseURL: "http://127.0.0.1:3101" });
  const ap = await anon.newPage();
  await ap.goto(`/reset${resetUrl.search}`);
  await expect(ap.getByText(`Para ${ROSA.email}`)).toBeVisible();
  await ap.getByLabel("Contraseña nueva").fill("Olvide2026x");
  await ap.getByRole("button", { name: "Guardar y entrar" }).click();
  await expect(ap.getByRole("heading", { name: "Dime qué necesitas" })).toBeVisible();
  await ap.context().clearCookies();
  await ap.goto(`/reset${resetUrl.search}`);
  await expect(ap.getByRole("heading", { name: "Este enlace ya no sirve" })).toBeVisible();
  await signIn(ap, { email: ROSA.email, password: "Olvide2026x" });
  await anon.close();
});

test("wrong passwords are refused and the forgot-password page explains what to do", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Tu email").fill(OWNER.email);
  await page.getByLabel("Contraseña", { exact: true }).fill("Equivocada1");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.locator(".note.bad[role=alert]")).toHaveText("El email o la contraseña no coinciden.");
  await page.getByRole("link", { name: "¿Olvidaste tu contraseña?" }).click();
  await expect(page.getByRole("heading", { name: "¿Olvidaste tu contraseña?" })).toBeVisible();
  await page.getByRole("link", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Forgot your password?" })).toBeVisible();
});

test("the original owner claims the data from before accounts with the old password", async ({ page }) => {
  // What production looks like right after the migration: an account with data and no owner.
  const sql = db();
  const [a] = await sql`insert into accounts (name, plan) values ('Negocio de antes', 'comped') returning id`;
  await sql`insert into settings (account_id, business_name, onboarded) values (${a.id}, 'Negocio de antes', true)`;
  await sql.end();

  await page.goto("/login");
  await page.getByRole("link", { name: "Recupera tu cuenta" }).click();
  await page.getByLabel("La contraseña que usabas antes").fill("no-es");
  await page.getByLabel("Tu nombre").fill("Dueño Original");
  await page.getByLabel("Tu email").fill("original@example.com");
  await page.getByLabel("Contraseña nueva").fill("Original2026");
  await page.getByRole("button", { name: "Recuperar mi cuenta" }).click();
  await expect(page.locator(".note.bad[role=alert]")).toHaveText("La contraseña no es correcta.");
  // OWNER_PASSWORD in playwright.config.ts.
  await page.getByLabel("La contraseña que usabas antes").fill("prueba-1234");
  await page.getByRole("button", { name: "Recuperar mi cuenta" }).click();
  await expect(page.getByRole("heading", { name: "Dime qué necesitas" })).toBeVisible();
  await page.getByLabel("Menú de la cuenta").click();
  await expect(page.getByRole("menuitem", { name: "Admin de Loro AI" })).toBeVisible();

  // Once claimed, the screen is gone.
  await page.context().clearCookies();
  expect((await page.goto("/claim"))?.status()).toBe(404);
  await page.goto("/login");
  await expect(page.getByRole("link", { name: "Recupera tu cuenta" })).toHaveCount(0);
});

test("the new screens fit a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of ["/login", "/signup", "/forgot"]) {
    await page.goto(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(375);
  }
  await signIn(page);
  for (const path of ["/", "/account", "/welcome", "/admin", "/admin/waitlist"]) {
    await page.goto(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(375);
  }
});
