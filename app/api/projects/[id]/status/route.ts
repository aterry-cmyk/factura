import { fail, readJson } from "@/lib/http";
import { setProjectStatus } from "@/lib/projects-store";
import { routeCtx } from "@/lib/session";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const body = (await readJson(req)) as { status?: unknown } | null;
  const status = body?.status;
  if (status !== "active" && status !== "done" && status !== "cancelled") return fail("invalid", 400);
  if (!(await setProjectStatus(ctx.accountId, id, status))) return fail("not_found", 404);
  return Response.json({ ok: true });
}
