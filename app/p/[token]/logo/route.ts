import { getProjectByToken } from "@/lib/projects-store";
import { getLogo } from "@/lib/store";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await getProjectByToken(token);
  if (!view) return new Response("Not found", { status: 404 });
  const logo = await getLogo(view.project.accountId);
  if (!logo) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(logo.bytes), { headers: { "Content-Type": logo.type, "Cache-Control": "private, max-age=300" } });
}
