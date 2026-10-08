import { fail } from "@/lib/http";
import { todayIso } from "@/lib/money";
import { blockForCtx, recordUsage } from "@/lib/accounts";
import { createDocument, getDocument, getSettings, setStatus } from "@/lib/store";
import { routeCtx } from "@/lib/session";

/** An accepted estimate becomes an invoice: same customer and items, today's saved terms. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const est = await getDocument(ctx.accountId, id);
  if (!est) return fail("not_found", 404);
  if (est.kind !== "estimate" || est.status === "void") return fail("not_allowed", 409);
  const block = await blockForCtx(ctx, "document");
  if (block) return Response.json({ error: block }, { status: 402 });
  const s = await getSettings(ctx.accountId);
  try {
    const inv = await createDocument(
      ctx.accountId,
      {
        kind: "invoice",
        lang: est.lang,
        customer: est.customer,
        business: est.business,
        items: est.items.map((i) => ({ ...i, source: i.source === "suggested" ? "typed" : i.source })),
        state: est.state,
        taxRate: est.taxRate,
        dueDays: s.dueDays,
        reminderDays: s.reminderDays,
        lateFee: s.lateFee,
        paymentMethods: est.paymentMethods,
        notes: est.notes,
        transcript: "",
      },
      { today: todayIso(), convertedFrom: est.id },
    );
    await recordUsage(ctx.accountId, "document");
    if (est.status !== "accepted") await setStatus(ctx.accountId, est.id, "accepted");
    return Response.json({ id: inv.id });
  } catch (err) {
    return fail("save_failed", 500, err);
  }
}
