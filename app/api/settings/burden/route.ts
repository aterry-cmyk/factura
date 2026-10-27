import { readJson } from "@/lib/http";
import { validateBurden } from "@/lib/costs";
import { setBurden } from "@/lib/costs-store";
import { routeCtx } from "@/lib/session";

/** The owner's burden on wages (workers' comp, liability, payroll taxes), in percent. */
export async function POST(req: Request) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  const checked = validateBurden(await readJson(req));
  if (!checked.ok) return Response.json({ error: "invalid", errors: checked.errors }, { status: 400 });
  await setBurden(ctx.accountId, checked.value);
  return Response.json({ ok: true });
}
