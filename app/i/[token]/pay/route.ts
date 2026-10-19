import { appBase } from "@/lib/deliver";
import { amountDueCents, todayIso } from "@/lib/money";
import { createCheckout, MIN_ONLINE_CENTS, stripeConfigured } from "@/lib/payments";
import { getByToken, getSettings, rememberCheckout } from "@/lib/store";

/**
 * The customer's "Pagar" button: a Stripe payment page for what's due today (late fees included),
 * then back to their link. A plain form post, so it works without JavaScript.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const back = (q: string) => Response.redirect(`${appBase(req.url)}/i/${token}?pago=${q}`, 303);
  const doc = await getByToken(token);
  if (!doc) return new Response("Not found", { status: 404 });
  if (doc.kind !== "invoice" || doc.status !== "sent") return back("cerrada");
  const settings = await getSettings(doc.accountId);
  const amount = amountDueCents(doc, todayIso());
  if (!stripeConfigured() || !settings.stripeReady || amount < MIN_ONLINE_CENTS) return back("no");
  const session = await createCheckout({
    stripeAccountId: settings.stripeAccountId, docId: doc.id, accountId: doc.accountId, token, number: doc.number,
    businessName: doc.business.name, amountCents: amount, customerEmail: doc.customer.email, appUrl: appBase(req.url), lang: doc.lang,
  });
  if (!session.ok) {
    console.error("[checkout]", doc.number, session.detail);
    return back("error");
  }
  await rememberCheckout(doc.id, session.data.id);
  return Response.redirect(session.data.url, 303);
}
