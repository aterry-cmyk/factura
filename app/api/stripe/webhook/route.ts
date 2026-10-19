import { feeCents, verifyWebhook } from "@/lib/payments";
import { firstTimeEvent, forgetEvent, markPaidOnline, recordEvent } from "@/lib/store";

/**
 * Stripe tells us when a customer paid. Card payments arrive as paid at once; bank (ACH) payments
 * finish days later with async_payment_succeeded, and only then is the invoice marked paid. The
 * signature is checked on the raw body, and each event is handled once.
 */
export async function POST(req: Request) {
  const body = await req.text();
  const event = verifyWebhook(body, req.headers.get("stripe-signature"), process.env.STRIPE_WEBHOOK_SECRET ?? "");
  if (!event) return Response.json({ error: "bad_signature" }, { status: 400 });
  if (!(await firstTimeEvent(event.id, event.type))) return Response.json({ ok: true, repeat: true });

  const o = event.data.object as {
    id?: string; payment_status?: string; payment_intent?: string | null; amount_total?: number;
    metadata?: { loro_doc?: string; loro_account?: string };
  };
  const docId = o.metadata?.loro_doc ?? "";
  const accountId = o.metadata?.loro_account ?? "";
  try {
    if (
      (event.type === "checkout.session.completed" && o.payment_status === "paid") ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      const amount = Number(o.amount_total ?? 0);
      await markPaidOnline({
        docId, accountId, sessionId: String(o.id ?? ""), paymentIntent: o.payment_intent ?? null, amountCents: amount, feeCents: feeCents(amount),
      });
    } else if (event.type === "checkout.session.completed" && /^[0-9a-f-]{36}$/i.test(docId)) {
      // A bank payment started; it isn't money yet.
      await recordEvent(docId, "payment_processing", "");
    } else if (event.type === "checkout.session.async_payment_failed" && /^[0-9a-f-]{36}$/i.test(docId)) {
      await recordEvent(docId, "payment_failed", "");
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[stripe_webhook]", event.type, err);
    await forgetEvent(event.id).catch(() => {});
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
