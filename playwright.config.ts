import { defineConfig } from "@playwright/test";

// Browser tests: a fresh build against a local test database, with Anthropic, Resend and Twilio
// replaced by e2e/fake-services.mjs. Needs TEST_DATABASE_URL (it's wiped).
const db = process.env.TEST_DATABASE_URL;
if (!db) throw new Error("Set TEST_DATABASE_URL to a throwaway Postgres database.");
const FAKE = "http://127.0.0.1:3199";

const env = {
  NEXT_DIST_DIR: ".next-e2e",
  DATABASE_URL: db,
  OWNER_PASSWORD: "prueba-1234",
  SESSION_SECRET: "e2e-secret-e2e-secret-e2e-secret-0000",
  ANTHROPIC_API_KEY: "fake",
  ANTHROPIC_BASE_URL: FAKE,
  RESEND_API_KEY: "re_fake",
  RESEND_API_URL: FAKE,
  EMAIL_FROM: "Facturas <facturas@example.com>",
  TWILIO_ACCOUNT_SID: "AC_fake",
  TWILIO_AUTH_TOKEN: "fake",
  TWILIO_FROM: "+15555550123",
  TWILIO_API_URL: FAKE,
  CRON_SECRET: "cron-fake",
  APP_URL: "http://127.0.0.1:3100",
};

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3100",
    locale: "es-US",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : undefined,
  },
  // Two copies of one build on the same test database: 3100 has a stand-in Azure Speech (natural
  // voices), 3101 has none (the device's own voice). e2e/voice.spec.ts runs on 3101.
  webServer: [
    { command: "node e2e/fake-services.mjs", url: `${FAKE}/_calls`, reuseExistingServer: false },
    {
      command: `${process.env.E2E_SKIP_BUILD ? "" : "npx next build && "}npx next start -p 3100`,
      url: "http://127.0.0.1:3100/login",
      timeout: 240_000,
      reuseExistingServer: false,
      env: { ...env, AZURE_SPEECH_KEY: "fake", AZURE_SPEECH_REGION: "fake", AZURE_SPEECH_URL: FAKE },
    },
    {
      command: "npx next start -p 3101",
      url: "http://127.0.0.1:3101/login",
      timeout: 60_000,
      reuseExistingServer: false,
      env: { ...env, APP_URL: "http://127.0.0.1:3101" },
    },
  ],
});