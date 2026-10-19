import { appBase } from "@/lib/deliver";
import { fail } from "@/lib/http";
import { createAccount, onboardingLink, stripeConfigured } from "@/lib/payments";
import { routeCtx } from "@/lib/session";
import { getSettings, setStripeAccount } from "@/lib/store";

/** Starts (or continues) connecting this business's own Stripe account. Owners only. */
export async function POST(req: Request) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  if (ctx.role !== "owner") return fail("owner_only", 403);
  if (!stripeConfigured()) return fail("stripe_setup", 501);
  const s = await getSettings(ctx.accountId);
  let id = s.stripeAccountId;
  if (!id) {
    const created = await createAccount({ email: s.email || ctx.email, businessName: s.name, accountId: ctx.accountId });
    if (!created.ok) return fail("stripe_failed", 502, created.detail);
    id = created.data.id;
    await setStripeAccount(ctx.accountId, id);
  }
  const link = await onboardingLink(id, appBase(req.url));
  if (!link.ok) return fail("stripe_failed", 502, link.detail);
  return Response.json({ url: link.data.url });
}
