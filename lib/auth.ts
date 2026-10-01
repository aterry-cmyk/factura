// One owner, one password. The session is an expiry time signed with SESSION_SECRET (HMAC-SHA256),
// kept in an httpOnly cookie. Web Crypto only, so the same code runs in the proxy and in routes.

export const SESSION_COOKIE = "factura_session";
export const SESSION_DAYS = 30;

const enc = new TextEncoder();

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const secret = (): string | null => {
  const v = process.env.SESSION_SECRET;
  return v && v.length >= 32 ? v : null;
};

export async function makeSession(now = Date.now()): Promise<string> {
  const key = secret();
  if (!key) throw new Error("SESSION_SECRET must be at least 32 characters");
  const exp = String(now + SESSION_DAYS * 86_400_000);
  return `${exp}.${await hmac(key, exp)}`;
}

export async function validSession(value: string | undefined, now = Date.now()): Promise<boolean> {
  const key = secret();
  if (!key || !value) return false;
  const [exp, sig] = value.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < now) return false;
  return equal(sig, await hmac(key, exp));
}

/** Compares through HMAC so the time taken doesn't depend on how much of the password matched. */
export async function passwordMatches(given: string): Promise<boolean> {
  const expected = process.env.OWNER_PASSWORD;
  const key = secret();
  if (!expected || !key) return false;
  return equal(await hmac(key, given), await hmac(key, expected));
}
