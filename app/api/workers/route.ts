import { fail, readJson } from "@/lib/http";
import { validateWorker } from "@/lib/costs";
import { addWorker, listWorkers } from "@/lib/costs-store";
import { routeCtx } from "@/lib/session";

export async function GET() {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  return Response.json({ workers: await listWorkers(ctx.accountId) });
}

export async function POST(req: Request) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  const checked = validateWorker(await readJson(req));
  if (!checked.ok) return Response.json({ error: "invalid", errors: checked.errors }, { status: 400 });
  if ((await listWorkers(ctx.accountId)).length >= 50) return fail("too_many", 409);
  return Response.json({ worker: await addWorker(ctx.accountId, checked.value) });
}
