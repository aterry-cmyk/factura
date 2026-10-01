import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

// The app on 3100 has Azure Speech, answered by e2e/fake-services.mjs. The page records what it
// is asked to play (headless Chrome can't play the stand-in audio) and anything the device says.
const FAKE = "http://127.0.0.1:3199";

const recorders = () => {
  const w = window as unknown as { __played: string[]; __spoken: string[] };
  w.__played = [];
  w.__spoken = [];
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    if (this.src.startsWith("blob:")) w.__played.push(this.src);
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function () {};
  class Utterance {
    text: string;
    lang = "";
    voice = null;
    rate = 1;
    volume = 1;
    constructor(text: string) {
      this.text = text;
    }
  }
  Object.defineProperty(window, "SpeechSynthesisUtterance", { value: Utterance, configurable: true });
  Object.defineProperty(window, "speechSynthesis", {
    value: {
      getVoices: () => [{ lang: "es-MX", name: "Voz es-MX", localService: true }],
      speak: (u: Utterance) => u.text.trim() && w.__spoken.push(u.text),
      cancel: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    configurable: true,
  });
};

const played = (page: Page) => page.evaluate(() => (window as unknown as { __played: string[] }).__played);
const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
const azureCalls = async (page: Page) =>
  ((await (await page.request.get(`${FAKE}/_calls`)).json()) as { url: string; body: string }[]).filter((c) => c.url === "/cognitiveservices/v1");
const post = (page: Page, url: string, data: object) =>
  page.evaluate(
    async ([u, body]) => (await fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).status,
    [url, data] as const,
  );

test.beforeAll(async () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
  await sql.unsafe(readFileSync("db/schema.sql", "utf8"));
  await sql`update settings set country = 'MX', voice_on = true, voice_gender = 'female', lang = 'es', business_name = 'Pintura Hernández' where id = 1`;
  await sql.end();
});

test.afterEach(async ({ request }) => {
  await request.get(`${FAKE}/_azure?fail=0`);
});

async function signIn(page: Page) {
  await page.addInitScript(recorders);
  await page.goto("/login");
  await page.getByLabel("Contraseña / Password").fill("prueba-1234");
  await page.getByRole("button", { name: "Entrar / Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dime qué necesitas" })).toBeVisible();
}

test("Settings shows Azure connected, the country's natural voice, and a woman's or man's voice", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings");
  await expect(page.getByText("Voz natural (Azure Speech)")).toBeVisible();
  const card = page.getByTestId("voice-settings");
  await expect(card.getByTestId("voice-status")).toHaveText("Voz natural de México: Dalia. Suena igual en cualquier teléfono.");

  await card.getByRole("button", { name: "Hombre" }).click();
  await expect(card.getByRole("status")).toHaveText("Guardado");
  await expect(card.getByTestId("voice-status")).toContainText("Jorge");

  const before = (await azureCalls(page)).length;
  await card.getByRole("button", { name: /Probar la voz/ }).click();
  await expect.poll(async () => (await played(page)).length).toBe(1);
  const call = (await azureCalls(page)).at(-1)!;
  expect((await azureCalls(page)).length).toBe(before + 1);
  expect(call.body).toContain("name='es-MX-JorgeNeural'");
  expect(call.body).toContain("xml:lang='es-MX'");
  expect(call.body).toContain("Hola, soy tu asistente de facturas.");
  expect(await spoken(page)).toEqual([]);

  // Puerto Rico, woman's voice.
  await card.getByLabel("¿De qué país eres?").selectOption("PR");
  await card.getByRole("button", { name: "Mujer" }).click();
  await expect(card.getByTestId("voice-status")).toContainText("Voz natural de Puerto Rico: Karina");
  await card.getByRole("button", { name: /Probar la voz/ }).click();
  await expect.poll(async () => (await azureCalls(page)).at(-1)!.body).toContain("name='es-PR-KarinaNeural'");

  expect(await post(page, "/api/settings", { voiceGender: "robot" })).toBe(400);
  expect(await post(page, "/api/settings", { country: "MX", voiceGender: "female" })).toBe(200);
});

test("the summary is read in the natural voice with the amounts on screen; listening again doesn't ask Azure twice", async ({ page }) => {
  await signIn(page);
  const before = (await azureCalls(page)).length;
  await page.getByLabel("O escríbelo aquí").fill("Factura para Juan, pintar la cocina 2200");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { name: "Revisa los conceptos" })).toBeVisible();

  await expect.poll(async () => (await played(page)).length).toBe(1);
  const calls = await azureCalls(page);
  expect(calls.length).toBe(before + 1);
  expect(calls.at(-1)!.body).toContain("name='es-MX-DaliaNeural'");
  expect(calls.at(-1)!.body).toContain("Una factura para Juan: Pintar la cocina, $2,200");

  await page.getByTestId("listen-again").click();
  await expect.poll(async () => (await played(page)).length).toBe(2);
  expect((await azureCalls(page)).length).toBe(before + 1);

  await page.getByRole("button", { name: "Siguiente" }).click();
  await expect.poll(async () => (await azureCalls(page)).at(-1)!.body).toContain("¿A quién se la mandamos?");
  expect(await spoken(page)).toEqual([]);
});

test("if Azure fails, the device's own voice says it instead and the flow carries on", async ({ page }) => {
  await page.request.get(`${FAKE}/_azure?fail=1`);
  await signIn(page);
  await page.getByLabel("O escríbelo aquí").fill("Factura para Juan, pintar la cocina 2200");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { name: "Revisa los conceptos" })).toBeVisible();
  await expect.poll(async () => (await spoken(page)).at(-1) ?? "").toContain("Una factura para Juan");
  expect(await played(page)).toEqual([]);
});

test("the speak endpoint needs the owner, takes no voice from the browser, and refuses long text", async ({ page, request }) => {
  expect((await request.post("/api/speak", { data: { text: "hola" } })).status()).toBe(401);
  await signIn(page);
  const before = (await azureCalls(page)).length;
  expect(await post(page, "/api/speak", { text: "Hola <b>&</b>", voice: "en-US-GuyNeural" })).toBe(200);
  const body = (await azureCalls(page)).at(-1)!.body;
  expect((await azureCalls(page)).length).toBe(before + 1);
  expect(body).toContain("name='es-MX-DaliaNeural'");
  expect(body).toContain("Hola &lt;b&gt;&amp;&lt;/b&gt;");
  expect(await post(page, "/api/speak", { text: "a".repeat(1501) })).toBe(400);
  expect(await post(page, "/api/speak", { text: "  " })).toBe(400);
});
