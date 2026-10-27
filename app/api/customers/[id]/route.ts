import { fail, readJson } from "@/lib/http";
import { getClient, updateClient } from "@/lib/projects-store";
import { routeCtx } from "@/lib/session";
import { validateCustomer } from "@/lib/validate";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const client = await getClient(ctx.accountId, id);
  if (!client) return fail("not_found", 404);
  return Response.json({ client });
}

/** The client's record: contact, address and notes. Projects and drafts follow the new contact. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const body = (await readJson(req)) as Record<string, unknown> | null;
  const errors: string[] = [];
  const customer = validateCustomer(body, errors);
  if (errors.length) return Response.json({ error: "invalid", errors }, { status: 400 });
  const address = typeof body?.address === "string" ? body.address.trim().slice(0, 300) : "";
  const notes = typeof body?.notes === "string" ? body.notes.trim().slice(0, 2000) : "";
  const client = await updateClient(ctx.accountId, id, { ...customer, address, notes });
  if (!client) return fail("not_found", 404);
  return Response.json({ client });
}
