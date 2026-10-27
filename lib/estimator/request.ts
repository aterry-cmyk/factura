import { MAX_PHOTO_BYTES, photoType, type PhotoType } from "@/lib/ai/read-photo";
import { spaceIds } from "./catalog";
import type { Space } from "./pricebook";

/** A photo sent as a data URL: its real type from its first bytes, or null when it isn't a usable photo. */
export function decodePhoto(v: unknown): { type: PhotoType; base64: string; dataUrl: string } | null {
  const m = typeof v === "string" ? /^data:image\/[a-z]+;base64,([A-Za-z0-9+/=]+)$/.exec(v) : null;
  if (!m) return null;
  const bytes = Buffer.from(m[1], "base64");
  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) return null;
  const type = photoType(new Uint8Array(bytes));
  if (!type || type === "image/gif") return null;
  return { type, base64: m[1], dataUrl: `data:${type};base64,${m[1]}` };
}

export const asSpace = (v: unknown): Space | undefined => ((spaceIds as string[]).includes(String(v)) ? (v as Space) : undefined);

/** A {question: option} map, strings only, a few dozen at most. */
export function asChoices(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, x] of Object.entries(v).slice(0, 20)) if (typeof x === "string" && /^[a-z]{1,20}$/.test(k) && /^[a-z0-9]{1,20}$/.test(x)) out[k] = x;
  }
  return out;
}
export const asKeys = (v: unknown, max = 60): string[] =>
  (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string" && /^[a-z0-9:.]{3,60}$/.test(x)).slice(0, max);
