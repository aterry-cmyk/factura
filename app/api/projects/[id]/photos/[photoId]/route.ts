import { fail } from "@/lib/http";
import { getPhoto, getProject } from "@/lib/projects-store";
import { routeCtx } from "@/lib/session";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; photoId: string }> }) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  const { id, photoId } = await params;
  const view = await getProject(ctx.accountId, id);
  const photo = view ? await getPhoto(view.project.id, photoId) : null;
  if (!photo) return fail("not_found", 404);
  return new Response(new Uint8Array(photo.bytes), { headers: { "Content-Type": photo.type, "Cache-Control": "private, max-age=3600" } });
}
