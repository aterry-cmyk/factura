import { fail, readJson } from "@/lib/http";
import { todayIso } from "@/lib/money";
import { getDocument, updateDraft } from "@/lib/store";
import { validateDraft } from "@/lib/validate";
import { routeCtx } from "@/lib/session";

/** Changing a document is allowed until it has been sent; after that, void it and make a new one. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const doc = await getDocument(ctx.accountId, id);
  if (!doc) return fail("not_found", 404);
  if (doc.status !== "draft") return fail("not_draft", 409);
  const body = await readJson(req);
  const checked = validateDraft(body);
  if (!checked.ok) return Response.json({ error: "invalid", errors: checked.errors }, { status: 400 });
  if (checked.value.kind !== doc.kind) return fail("kind_changed", 400);
  try {
    await updateDraft(ctx.accountId, id, checked.value, todayIso());
    return Response.json({ id });
  } catch (err) {
    return fail("save_failed", 500, err);
  }
}
