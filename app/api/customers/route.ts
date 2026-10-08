import { findCustomers } from "@/lib/store";
import { routeCtx } from "@/lib/session";

export async function GET(req: Request) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  const q = new URL(req.url).searchParams.get("q") ?? "";
  if (q.trim().length < 2) return Response.json([]);
  return Response.json(await findCustomers(ctx.accountId, q.slice(0, 60)));
}
