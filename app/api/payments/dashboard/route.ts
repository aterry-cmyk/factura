import { fail } from "@/lib/http";
import { dashboardLink, stripeConfigured } from "@/lib/payments";
import { routeCtx } from "@/lib/session";
import { getSettings } from "@/lib/store";

/** A one-time link into the business's own Stripe dashboard: payouts and bank account. */
export async function POST() {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  if (!stripeConfigured()) return fail("stripe_setup", 501);
  const s = await getSettings(ctx.accountId);
  if (!s.stripeAccountId) return fail("not_connected", 409);
  const link = await dashboardLink(s.stripeAccountId);
  if (!link.ok) return fail("stripe_failed", 502, link.detail);
  return Response.json({ url: link.data.url });
}
