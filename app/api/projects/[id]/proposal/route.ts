import { fail, readJson } from "@/lib/http";
import { validateProposal } from "@/lib/proposal";
import { getProposal, saveProposal } from "@/lib/projects-store";
import { routeCtx } from "@/lib/session";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  return Response.json({ proposal: await getProposal(ctx.accountId, id) });
}

/** The proposal as the owner has it on screen, saved as a draft on the project. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const checked = validateProposal(await readJson(req), new Date().toISOString());
  if (!checked.ok) return Response.json({ error: "invalid", errors: checked.errors }, { status: 400 });
  if (!(await saveProposal(ctx.accountId, id, checked.value))) return fail("not_found", 404);
  return Response.json({ ok: true, proposal: checked.value });
}
