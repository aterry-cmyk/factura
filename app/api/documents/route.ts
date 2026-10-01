import { fail, readJson } from "@/lib/http";
import { todayIso } from "@/lib/money";
import { createDocument, saveDefaults } from "@/lib/store";
import { validateDraft } from "@/lib/validate";

export async function POST(req: Request) {
  const body = (await readJson(req)) as Record<string, unknown> | null;
  const checked = validateDraft(body);
  if (!checked.ok) return Response.json({ error: "invalid", errors: checked.errors }, { status: 400 });
  const ai = body?.ai && typeof body.ai === "object" ? (body.ai as Record<string, unknown>) : {};
  try {
    const doc = await createDocument(checked.value, {
      today: todayIso(),
      model: typeof ai.model === "string" ? ai.model.slice(0, 100) : undefined,
      promptVersion: typeof ai.promptVersion === "string" ? ai.promptVersion.slice(0, 100) : undefined,
    });
    await saveDefaults(checked.value);
    return Response.json({ id: doc.id });
  } catch (err) {
    return fail("save_failed", 500, err);
  }
}
