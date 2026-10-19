import { blockForCtx, recordUsage } from "@/lib/accounts";
import { aiConfigured } from "@/lib/ai/config";
import { MAX_PHOTO_BYTES, MAX_PHOTOS, photoType, readPhotos, type PhotoType } from "@/lib/ai/read-photo";
import { fail } from "@/lib/http";
import { routeCtx } from "@/lib/session";
import { getSettings } from "@/lib/store";

export const maxDuration = 60;

/**
 * Up to 4 photos of notes, a list, a receipt or an old invoice → the text written on them. The
 * owner checks that text, then it goes through the normal parser like anything they said.
 */
export async function POST(req: Request) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  if (!aiConfigured()) return fail("ai_setup", 501);
  const block = await blockForCtx(ctx, "ai");
  if (block) return Response.json({ error: block }, { status: 402 });

  const form = await req.formData().catch(() => null);
  const files = (form?.getAll("photos") ?? []).filter((f): f is File => f instanceof File);
  if (!files.length) return fail("no_photo", 400);
  if (files.length > MAX_PHOTOS) return fail("too_many_photos", 400);
  const photos: { type: PhotoType; base64: string }[] = [];
  for (const f of files) {
    if (f.size > MAX_PHOTO_BYTES) return fail("photo_too_big", 400);
    const bytes = new Uint8Array(await f.arrayBuffer());
    const type = photoType(bytes);
    if (!type) return fail("photo_type", 400);
    photos.push({ type, base64: Buffer.from(bytes).toString("base64") });
  }

  try {
    const { lang } = await getSettings(ctx.accountId);
    const result = await readPhotos({ photos, lang });
    await recordUsage(ctx.accountId, "ai_request", 1, result.usage);
    if (!result.ok) return fail(result.error === "unreadable" ? "unreadable" : "read_failed", result.error === "unreadable" ? 422 : 502);
    return Response.json({ text: result.text, kindHint: result.kindHint });
  } catch (err) {
    return fail("read_failed", 502, err);
  }
}
