import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  // One file at a time: the database tests (store, accounts) share and wipe TEST_DATABASE_URL.
  test: { include: ["tests/**/*.test.ts", "lib/**/*.test.ts"], testTimeout: 30000, fileParallelism: false },
});
