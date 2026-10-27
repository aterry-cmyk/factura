import { readdirSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";

// The production model rejects a forced tool choice ("tool_choice: type \"tool\" and \"any\" are
// not supported for this model"), which took the planner down on Oct 27. Every call uses "auto"
// and nudges once when the model answers in prose instead.
it("no AI call forces the tool choice", () => {
  const dir = "lib/ai";
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    const src = readFileSync(`${dir}/${f}`, "utf8");
    expect(src, `${dir}/${f}`).not.toMatch(/tool_choice:\s*\{\s*type:\s*"(tool|any)"/);
  }
});
