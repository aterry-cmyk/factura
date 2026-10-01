import { fail } from "@/lib/http";
import { todayIso } from "@/lib/money";
import { createDocument, getDocument, getSettings, setStatus } from "@/lib/store";

/** An accepted estimate becomes an invoice: same customer and items, today's saved terms. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const est = await getDocument(id);
  if (!est) return fail("not_found", 404);
  if (est.kind !== "estimate" || est.status === "void") return fail("not_allowed", 409);
  const s = await getSettings();
  try {
    const inv = await createDocument(
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
    if (est.status !== "accepted") await setStatus(est.id, "accepted");
    return Response.json({ id: inv.id });
  } catch (err) {
    return fail("save_failed", 500, err);
  }
}
