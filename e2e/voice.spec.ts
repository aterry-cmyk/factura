import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

// The copy of the app without Azure Speech: everything here is the device's own voice.
test.use({ baseURL: "http://127.0.0.1:3101" });

// Headless Chrome has no voices, so each page gets a stand-in list and a recorder in place of
// speechSynthesis. What the app passes to speak() is what a real device would read aloud.
const fakeVoices = (langs: string[]) => {
  const voices = langs.map((lang) => ({ lang, name: `Voz ${lang}`, localService: true, default: false, voiceURI: lang }));
  const spoken: { text: string; lang: string; voice: string | null }[] = [];
  (window as unknown as { __spoken: typeof spoken }).__spoken = spoken;
  // The real utterance only accepts real voices, so it's replaced too.
  class Utterance {
    text: string;
    lang = "";
    voice: { name: string } | null = null;
    rate = 1;
    volume = 1;
    constructor(text: string) {
      this.text = text;
    }
  }
  Object.defineProperty(window, "SpeechSynthesisUtterance", { value: Utterance, configurable: true });
  Object.defineProperty(window, "speechSynthesis", {
    value: {
      getVoices: () => voices,
      speak: (u: Utterance) => {
        if (u.text.trim()) spoken.push({ text: u.text, lang: u.lang, voice: u.voice?.name ?? null });
      },
      cancel: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    configurable: true,
  });
};

// Through the page, so the signed-in cookie goes with it.
const saveSettings = (page: Page, data: object) =>
  page.evaluate(async (body) => (await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).status, data);

const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: { text: string; lang: string; voice: string | null }[] }).__spoken);

test.beforeAll(async () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
  await sql.unsafe(readFileSync("db/schema.sql", "utf8"));
  await sql`update settings set country = 'US', voice_on = true, business_name = 'Pintura Hernández' where id = 1`;
  await sql.end();
});

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Contraseña / Password").fill("prueba-1234");
  await page.getByRole("button", { name: "Entrar / Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dime qué necesitas" })).toBeVisible();
}

test("the owner picks his country; the app says whether this device has that accent", async ({ page }) => {
  await page.addInitScript(fakeVoices, ["es-MX", "es-US", "en-US"]);
  await signIn(page);
  await page.goto("/settings");
  const card = page.getByTestId("voice-settings");
  await expect(card.getByLabel("¿De qué país eres?")).toHaveValue("US");

  await card.getByLabel("¿De qué país eres?").selectOption("MX");
  await expect(card.getByRole("status")).toHaveText("Guardado");
  await expect(card.getByTestId("voice-status")).toHaveText("Este dispositivo tiene una voz de México.");
  await card.getByRole("button", { name: /Probar la voz/ }).click();
  expect((await spoken(page)).at(-1)).toMatchObject({ lang: "es-MX", voice: "Voz es-MX" });

  // No Colombian voice on this device: it says so and names the voice it will use instead.
  await card.getByLabel("¿De qué país eres?").selectOption("CO");
  await expect(card.getByTestId("voice-status")).toContainText("no tiene una voz de Colombia");
  await expect(card.getByTestId("voice-status")).toContainText("es-US");

  await page.reload();
  await expect(page.getByTestId("voice-settings").getByLabel("¿De qué país eres?")).toHaveValue("CO");

  // Only listed countries are saved.
  expect(await saveSettings(page, { country: "ZZ" })).toBe(400);
  expect(await saveSettings(page, { country: "MX" })).toBe(200);
});

test("it reads back what it understood and asks each question out loud, in the owner's Spanish", async ({ page }) => {
  await page.addInitScript(fakeVoices, ["es-MX", "es-US"]);
  await signIn(page);
  await page.getByLabel("O escríbelo aquí").fill("Factura para Juan, pintar la cocina 2200");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { name: "Revisa los conceptos" })).toBeVisible();

  const summary = (await spoken(page)).at(-1)!;
  expect(summary.lang).toBe("es-MX");
  expect(summary.text).toContain("Una factura para Juan: Pintar la cocina, $2,200");
  expect(summary.text).toContain("Total: $2,200");

  const before = (await spoken(page)).length;
  await page.getByTestId("listen-again").click();
  expect((await spoken(page)).length).toBe(before + 1);

  await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(page.getByRole("heading", { name: "¿A quién se la mandamos?" })).toBeVisible();
  expect((await spoken(page)).at(-1)!.text).toBe("¿A quién se la mandamos?");
  await page.getByRole("button", { name: "Siguiente" }).click();
  expect((await spoken(page)).at(-1)!.text).toBe("¿Cómo se llama tu empresa?");
});

test("with the voice off, it stays quiet", async ({ page }) => {
  await page.addInitScript(fakeVoices, ["es-MX"]);
  await signIn(page);
  expect(await saveSettings(page, { voiceOn: false })).toBe(200);
  await page.reload();
  await page.getByLabel("O escríbelo aquí").fill("Factura para Juan, pintar la cocina 2200");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { name: "Revisa los conceptos" })).toBeVisible();
  await page.getByRole("button", { name: "Siguiente" }).click();
  expect(await spoken(page)).toEqual([]);
  await expect(page.getByTestId("listen-again")).toHaveCount(0);
  expect(await saveSettings(page, { voiceOn: true })).toBe(200);
});
