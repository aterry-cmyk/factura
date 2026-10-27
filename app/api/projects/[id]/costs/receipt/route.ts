import { blockForCtx, recordUsage } from "@/lib/accounts";
import { aiConfigured } from "@/lib/ai/config";
import { readReceipt } from "@/lib/ai/costs";
import { photoType } from "@/lib/ai/read-photo";
import { fail } from "@/lib/http";
import { MAX_PHOTO_BYTES } from "@/lib/projects";
import { addPhoto, getProject } from "@/lib/projects-store";
import { routeCtx } from "@/lib/session";
import { getSettings } from "@/lib/store";

export const maxDuration = 60;

/** A photo of a receipt: kept with the project, read by Claude, and returned for the owner to confirm. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  if (!aiConfigured()) return fail("ai_setup", 501);
  const block = await blockForCtx(ctx, "ai");
  if (block) return Response.json({ error: block }, { status: 402 });
  const { id } = await params;
  const view = await getProject(ctx.accountId, id);
  if (!view) return fail("not_found", 404);
  const form = await req.formData().catch(() => null);
  const file = form?.get("photo");
  if (!(file instanceof File)) return fail("no_photo", 400);
  if (file.size > MAX_PHOTO_BYTES) return fail("photo_too_big", 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = photoType(bytes);
  if (!type || type === "image/gif") return fail("photo_type", 400);
  try {
    const { lang } = await getSettings(ctx.accountId);
    const result = await readReceipt({ photo: { type, base64: Buffer.from(bytes).toString("base64") }, lang });
    await recordUsage(ctx.accountId, "ai_request", 1, result.usage);
    if (!result.ok) return fail(result.error, result.error === "unreadable" ? 422 : 502);
    const photoId = await addPhoto(ctx.accountId, view.project.id, null, { bytes: Buffer.from(bytes), type });
    return Response.json({ reading: result.value, photoId });
  } catch (err) {
    return fail("read_failed", 502, err);
  }
}
