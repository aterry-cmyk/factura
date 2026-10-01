import { appBase, deliver } from "@/lib/deliver";
import { fail } from "@/lib/http";
import { todayIso } from "@/lib/money";
import { reminderDue } from "@/lib/reminders";
import { emailConfigured, smsConfigured } from "@/lib/send";
import { unpaidInvoices } from "@/lib/store";

export const maxDuration = 300;

/**
 * Runs once a day (vercel.json). Vercel sends "Authorization: Bearer $CRON_SECRET".
 * Each due invoice gets one reminder, by email if it has one, otherwise by text.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return fail("unauthorized", 401);
  const today = todayIso();
  const base = appBase(req.url);
  const results: { number: string; channel: string; ok: boolean; reason?: string }[] = [];
  for (const doc of await unpaidInvoices()) {
    if (!reminderDue(doc, today)) continue;
    const channel = doc.customer.email && emailConfigured() ? "email" : doc.customer.phone && smsConfigured() ? "sms" : null;
    if (!channel) {
      results.push({ number: doc.number, channel: "none", ok: false, reason: "setup" });
      continue;
    }
    try {
      const r = await deliver(doc, channel, base, { reminder: true, today });
      results.push({ number: doc.number, channel, ok: r.ok, reason: r.ok ? undefined : r.reason });
    } catch (err) {
      console.error("[reminder]", doc.number, err);
      results.push({ number: doc.number, channel, ok: false, reason: "failed" });
    }
  }
  return Response.json({ today, results });
}
