import { blockForCtx, recordUsage } from "@/lib/accounts";
import { fail, readJson } from "@/lib/http";
import { validateProjectInput } from "@/lib/projects";
import { createProject } from "@/lib/projects-store";
import { routeCtx } from "@/lib/session";
import { getDocument } from "@/lib/store";
import { validateCustomer } from "@/lib/validate";

/** A new project: the owner's confirmed plan (from the planner, the template or their own edits). */
export async function POST(req: Request) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  const block = await blockForCtx(ctx, "document");
  if (block) return Response.json({ error: block }, { status: 402 });
  const body = (await readJson(req)) as Record<string, unknown> | null;
  const checked = validateProjectInput(body, validateCustomer);
  if (!checked.ok) return Response.json({ error: "invalid", errors: checked.errors }, { status: 400 });
  // An estimate id must be one of this business's estimates; anything else is dropped, not trusted.
  if (checked.value.estimateId) {
    const est = await getDocument(ctx.accountId, checked.value.estimateId);
    if (!est || est.kind !== "estimate") checked.value.estimateId = null;
  }
  const ai = body?.ai && typeof body.ai === "object" ? (body.ai as Record<string, unknown>) : {};
  try {
    const project = await createProject(ctx.accountId, checked.value, {
      model: typeof ai.model === "string" ? ai.model.slice(0, 100) : undefined,
      promptVersion: typeof ai.promptVersion === "string" ? ai.promptVersion.slice(0, 100) : undefined,
    });
    await recordUsage(ctx.accountId, "document");
    return Response.json({ id: project.id });
  } catch (err) {
    return fail("save_failed", 500, err);
  }
}
