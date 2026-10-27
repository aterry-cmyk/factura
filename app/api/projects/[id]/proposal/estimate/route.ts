import { blockForCtx, recordUsage } from "@/lib/accounts";
import { fail, readJson } from "@/lib/http";
import { todayIso } from "@/lib/money";
import { proposalItems, proposalProblems, proposalTotals, scopeText, validateProposal } from "@/lib/proposal";
import { adoptEstimate, getProject, saveProposal } from "@/lib/projects-store";
import { routeCtx } from "@/lib/session";
import { createDocument, getSettings, markSent } from "@/lib/store";

/**
 * The confirmed proposal becomes the project's estimate: a sent estimate document the customer
 * accepts on their link, with the markup folded into each line and the scope in the notes. The
 * project takes the new total and re-splits its milestones while nothing is invoiced yet.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  const block = await blockForCtx(ctx, "document");
  if (block) return Response.json({ error: block }, { status: 402 });
  const { id } = await params;
  const view = await getProject(ctx.accountId, id);
  if (!view) return fail("not_found", 404);
  const checked = validateProposal(await readJson(req), new Date().toISOString());
  if (!checked.ok) return Response.json({ error: "invalid", errors: checked.errors }, { status: 400 });
  const settings = await getSettings(ctx.accountId);
  const problems = proposalProblems(checked.value, settings.lang);
  if (problems.length) return Response.json({ error: "not_ready", errors: problems }, { status: 409 });
  try {
    await saveProposal(ctx.accountId, id, checked.value);
    const items = proposalItems(checked.value, settings.lang);
    const doc = await createDocument(ctx.accountId, {
      kind: "estimate", lang: view.project.lang, customer: view.project.customer,
      business: { name: settings.name, ownerName: settings.ownerName, address: settings.address, phone: settings.phone, email: settings.email, website: settings.website },
      items, state: settings.state, taxRate: settings.taxEnabled ? settings.taxRate : 0, dueDays: settings.dueDays, reminderDays: 0,
      lateFee: { type: "none" }, paymentMethods: settings.paymentMethods, notes: scopeText(checked.value, settings.lang), transcript: "",
    }, { today: todayIso() });
    await markSent(doc.id);
    await recordUsage(ctx.accountId, "document");
    const { resplit } = await adoptEstimate(ctx.accountId, id, doc.id, doc.totalCents);
    return Response.json({ id: doc.id, number: doc.number, token: doc.publicToken, totalCents: doc.totalCents, priceCents: proposalTotals(checked.value).totalCents, resplit });
  } catch (err) {
    return fail("save_failed", 500, err);
  }
}
