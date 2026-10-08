import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

// Passwords and session tokens. Pure helpers live here; anything that reads the database is in
// lib/session.ts. The cookie carries a random token; the database keeps only its SHA-256, so a
// leaked sessions table can't be used to sign in.

export const SESSION_COOKIE = "loro_session";
export const SESSION_DAYS = 30;

const N = 16384;
const R = 8;
const P = 1;
const LEN = 32;
const MAXMEM = 64 * 1024 * 1024;

function scrypt(password: string, salt: Buffer, len: number, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize("NFKC"), salt, len, { N: n, r, p, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, LEN, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const got = await scrypt(password, Buffer.from(salt, "base64"), expected.length, Number(n), Number(r), Number(p));
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** A hash to check against when the email doesn't exist, so both cases take the same time. */
let dummy: Promise<string> | null = null;
export const dummyHash = (): Promise<string> => (dummy ??= hashPassword("not-a-real-password-0"));

export const MIN_PASSWORD = 8;

/** null when the password is acceptable, else a short code the screens translate. */
export function passwordProblem(password: unknown): "password_short" | "password_weak" | "password_long" | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD) return "password_short";
  if (password.length > 200) return "password_long";
  if (!/\p{L}/u.test(password) || !/\d/.test(password)) return "password_weak";
  return null;
}

export function normalEmail(email: unknown): string | null {
  if (typeof email !== "string") return null;
  const e = email.trim().toLowerCase();
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

export function cleanName(name: unknown, max = 120): string {
  return typeof name === "string" ? name.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

export const newToken = (): string => randomBytes(32).toString("base64url");
export const tokenId = (token: string): string => createHash("sha256").update(token).digest("hex");
/** 32 random bytes in base64url are 43 characters. */
export const looksLikeToken = (v: string | undefined | null): v is string => Boolean(v && /^[A-Za-z0-9_-]{43}$/.test(v));

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${
    process.env.NODE_ENV === "production" ? "; Secure" : ""
  }`;
}
export const clearedCookie = (): string => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

/** The old single-owner password, used once to claim the data that existed before accounts. */
export function ownerPasswordMatches(given: string): boolean {
  const expected = process.env.OWNER_PASSWORD;
  if (!expected || !given) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
