import { fail, readJson } from "@/lib/http";
import { todayIso } from "@/lib/money";
import { getDocument, updateDraft } from "@/lib/store";
import { validateDraft } from "@/lib/validate";

/** Changing a document is allowed until it has been sent; after that, void it and make a new one. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await getDocument(id);
  if (!doc) return fail("not_found", 404);
  if (doc.status !== "draft") return fail("not_draft", 409);
  const body = await readJson(req);
  const checked = validateDraft(body);
  if (!checked.ok) return Response.json({ error: "invalid", errors: checked.errors }, { status: 400 });
  if (checked.value.kind !== doc.kind) return fail("kind_changed", 400);
  try {
    await updateDraft(id, checked.value, todayIso());
    return Response.json({ id });
  } catch (err) {
    return fail("save_failed", 500, err);
  }
}
