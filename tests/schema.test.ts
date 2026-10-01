import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("the first Supabase migration is the schema", () => {
  expect(readFileSync("supabase/migrations/20261001000000_init.sql", "utf8")).toBe(readFileSync("db/schema.sql", "utf8"));
});
