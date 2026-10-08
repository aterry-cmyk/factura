import { afterEach, describe, expect, it } from "vitest";
import {
  hashPassword, looksLikeToken, newToken, normalEmail, ownerPasswordMatches, passwordProblem, sessionCookie,
  tokenId, verifyPassword,
} from "@/lib/auth";

describe("passwords", () => {
  it("hashes with a fresh salt each time and checks only the right password", async () => {
    const a = await hashPassword("Pintura2026");
    const b = await hashPassword("Pintura2026");
    expect(a).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword("Pintura2026", a)).toBe(true);
    expect(await verifyPassword("pintura2026", a)).toBe(false);
    expect(await verifyPassword("Pintura2026", "garbage")).toBe(false);
  });

  it("treats the same accented password typed two ways as the same", async () => {
    const h = await hashPassword("Peña2026");
    expect(await verifyPassword("Peña2026", h)).toBe(true);
  });

  it("asks for 8+ characters with letters and numbers", () => {
    expect(passwordProblem("abc1")).toBe("password_short");
    expect(passwordProblem("solamenteletras")).toBe("password_weak");
    expect(passwordProblem("12345678")).toBe("password_weak");
    expect(passwordProblem("x".repeat(199) + "12")).toBe("password_long");
    expect(passwordProblem("cañería99")).toBeNull();
    expect(passwordProblem(undefined)).toBe("password_short");
  });
});

describe("emails and tokens", () => {
  it("cleans emails and refuses broken ones", () => {
    expect(normalEmail("  Juan@Example.COM ")).toBe("juan@example.com");
    expect(normalEmail("juan@example")).toBeNull();
    expect(normalEmail("juan example.com")).toBeNull();
    expect(normalEmail(42)).toBeNull();
  });

  it("makes long random tokens and stores only their hash", () => {
    const t = newToken();
    expect(looksLikeToken(t)).toBe(true);
    expect(looksLikeToken("short")).toBe(false);
    expect(looksLikeToken(`${t}!`)).toBe(false);
    expect(tokenId(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenId(t)).not.toContain(t);
    expect(newToken()).not.toBe(t);
  });

  it("sets an httpOnly cookie, Secure in production", () => {
    expect(sessionCookie("abc")).toContain("HttpOnly; SameSite=Lax");
    expect(sessionCookie("abc")).not.toContain("Secure");
    const env = process.env as Record<string, string | undefined>;
    const before = env.NODE_ENV;
    env.NODE_ENV = "production";
    expect(sessionCookie("abc")).toContain("; Secure");
    env.NODE_ENV = before;
  });
});

describe("the old owner password", () => {
  afterEach(() => { delete process.env.OWNER_PASSWORD; });
  it("matches only when set and equal", () => {
    expect(ownerPasswordMatches("anything")).toBe(false);
    process.env.OWNER_PASSWORD = "correct horse";
    expect(ownerPasswordMatches("correct horse")).toBe(true);
    expect(ownerPasswordMatches("correct hors")).toBe(false);
    expect(ownerPasswordMatches("")).toBe(false);
  });
});
