import { appBase, deliver } from "@/lib/deliver";
import { BULK_ACTIONS, bulkPlan, MAX_BULK, type BulkAction } from "@/lib/doc-list";
import { fail, readJson } from "@/lib/http";
import { todayIso } from "@/lib/money";
import { emailConfigured, smsConfigured } from "@/lib/send";
import { getDocuments, setStatus } from "@/lib/store";

export const maxDuration = 300;

/**
 * Mark paid, void, or remind several documents at once. Each one follows the same rules as its
 * own buttons (lib/doc-list ALLOWED); the ones that don't fit are skipped and reported, never forced.
 * A reminder goes by email when the customer has one, otherwise by text, like the daily job.
 */
export async function POST(req: Request) {
  const body = (await readJson(req)) as { ids?: unknown; action?: unknown } | null;
  const action = body?.action as BulkAction;
  if (!BULK_ACTIONS.includes(action)) return fail("invalid", 400);
  const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.filter((x): x is string => typeof x === "string"))] : [];
  if (!ids.length || ids.length > MAX_BULK) return fail("invalid", 400);

  const docs = await getDocuments(ids);
  const plan = bulkPlan(docs, action);
  const failed: { id: string; reason: string }[] = [];
  let done = 0;

  if (action === "remind") {
    const today = todayIso();
    const base = appBase(req.url);
    for (const id of plan.apply) {
      const doc = docs.find((d) => d.id === id)!;
      const channel = doc.customer.email && emailConfigured() ? "email" : doc.customer.phone && smsConfigured() ? "sms" : null;
      if (!channel) {
        failed.push({ id, reason: !emailConfigured() && !smsConfigured() ? "setup" : "no_recipient" });
        continue;
      }
      try {
        const r = await deliver(doc, channel, base, { reminder: true, today });
        if (r.ok) done++;
        else failed.push({ id, reason: r.reason });
      } catch (err) {
        console.error("[bulk_remind]", doc.number, err);
        failed.push({ id, reason: "failed" });
      }
    }
  } else {
    for (const id of plan.apply) {
      await setStatus(id, action);
      done++;
    }
  }

  const missing = ids.filter((id) => !docs.some((d) => d.id === id)).map((id) => ({ id, reason: "not_found" }));
  return Response.json({ action, done, skipped: [...plan.skip, ...missing], failed });
}
