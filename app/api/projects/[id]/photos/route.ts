import { photoType } from "@/lib/ai/read-photo";
import { fail } from "@/lib/http";
import { MAX_PHOTO_BYTES } from "@/lib/projects";
import { addPhoto } from "@/lib/projects-store";
import { routeCtx } from "@/lib/session";

/** A progress photo from the owner's phone, attached to a step (or the project). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const form = await req.formData().catch(() => null);
  const file = form?.get("photo");
  if (!(file instanceof File)) return fail("no_photo", 400);
  if (file.size > MAX_PHOTO_BYTES) return fail("photo_too_big", 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = photoType(bytes);
  if (!type || type === "image/gif") return fail("photo_type", 400);
  const itemRaw = form?.get("itemId");
  const itemId = typeof itemRaw === "string" && itemRaw ? itemRaw : null;
  const photoId = await addPhoto(ctx.accountId, id, itemId, { bytes: Buffer.from(bytes), type });
  if (!photoId) return fail("not_found", 404);
  return Response.json({ id: photoId });
}
