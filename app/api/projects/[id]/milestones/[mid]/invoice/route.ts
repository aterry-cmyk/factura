import { blockForCtx, recordUsage } from "@/lib/accounts";
import { fail } from "@/lib/http";
import { todayIso } from "@/lib/money";
import { canInvoice } from "@/lib/projects";
import { getProject, invoiceMilestone } from "@/lib/projects-store";
import { routeCtx } from "@/lib/session";
import { getSettings } from "@/lib/store";

/** The milestone's work is done: make its invoice and send it to the customer's link. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string; mid: string }> }) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  const block = await blockForCtx(ctx, "document");
  if (block) return Response.json({ error: block }, { status: 402 });
  const { id, mid } = await params;
  const view = await getProject(ctx.accountId, id);
  const m = view?.milestones.find((x) => x.id === mid);
  if (!view || !m) return fail("not_found", 404);
  if (!canInvoice(m, view.items.filter((i) => i.milestoneId === m.id))) return fail("steps_open", 409);
  if (m.amountCents <= 0) return fail("nothing_to_invoice", 409);
  try {
    const doc = await invoiceMilestone(ctx.accountId, view, mid, await getSettings(ctx.accountId), todayIso());
    if (!doc) return fail("not_allowed", 409);
    await recordUsage(ctx.accountId, "document");
    return Response.json({ id: doc.id, number: doc.number, token: doc.publicToken });
  } catch (err) {
    return fail("save_failed", 500, err);
  }
}
