import { fail, readJson } from "@/lib/http";
import { routeCtx } from "@/lib/session";
import { validateSetup } from "@/lib/setup";
import { saveSetup } from "@/lib/store";

/** The setup questions' answers, all at once. Can be sent again to change them. */
export async function POST(req: Request) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  const checked = validateSetup(await readJson(req));
  if (!checked.ok) return Response.json({ error: "invalid", errors: checked.errors }, { status: 400 });
  try {
    await saveSetup(ctx.accountId, checked.value);
    return Response.json({ ok: true });
  } catch (err) {
    return fail("save_failed", 500, err);
  }
}
