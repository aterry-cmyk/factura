import { beforeAll, describe, expect, it } from "vitest";
import { makeSession, passwordMatches, validSession } from "@/lib/auth";

beforeAll(() => {
  process.env.SESSION_SECRET = "x".repeat(40);
  process.env.OWNER_PASSWORD = "correct horse";
});

describe("auth", () => {
  it("accepts its own session and refuses tampered or expired ones", async () => {
    const s = await makeSession();
    expect(await validSession(s)).toBe(true);
    const [exp, sig] = s.split(".");
    expect(await validSession(`${Number(exp) + 1}.${sig}`)).toBe(false);
    expect(await validSession(`${exp}.${sig.replace(/.$/, sig.endsWith("a") ? "b" : "a")}`)).toBe(false);
    expect(await validSession(await makeSession(Date.now() - 31 * 86_400_000))).toBe(false);
    expect(await validSession(undefined)).toBe(false);
  });
  it("checks the password", async () => {
    expect(await passwordMatches("correct horse")).toBe(true);
    expect(await passwordMatches("correct hors")).toBe(false);
  });
  it("refuses everything when the secret is too short", async () => {
    const s = await makeSession();
    process.env.SESSION_SECRET = "short";
    expect(await validSession(s)).toBe(false);
    process.env.SESSION_SECRET = "x".repeat(40);
  });
});
