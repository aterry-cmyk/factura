import { fail } from "@/lib/http";
import { getPhoto, getProjectByToken } from "@/lib/projects-store";

/** A progress photo on the customer's link: the project's token is the key. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string; photoId: string }> }) {
  const { token, photoId } = await params;
  const view = await getProjectByToken(token);
  const photo = view ? await getPhoto(view.project.id, photoId) : null;
  if (!photo) return fail("not_found", 404);
  return new Response(new Uint8Array(photo.bytes), { headers: { "Content-Type": photo.type, "Cache-Control": "private, max-age=3600" } });
}
