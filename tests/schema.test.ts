import { readdirSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("the Supabase migrations, in order, are the schema", () => {
  const dir = "supabase/migrations";
  const all = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(`${dir}/${f}`, "utf8"))
    .join("");
  expect(all).toBe(readFileSync("db/schema.sql", "utf8"));
});
