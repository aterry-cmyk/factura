import { daysBetween } from "./money";
import type { Doc } from "./types";

/** After this many reminders the app stops; a person should call at that point. */
export const MAX_REMINDERS = 6;

/**
 * Whether an invoice should get a reminder today. Reminders start on the due date and repeat
 * every `reminderDays` while it's unpaid. Estimates, drafts, paid and void documents never get one.
 */
export function reminderDue(
  doc: Pick<
    Doc,
    "kind" | "status" | "dueDate" | "reminderDays" | "reminderCount" | "lastReminderAt" | "customer"
  >,
  today: string,
): boolean {
  if (doc.kind !== "invoice" || doc.status !== "sent") return false;
  if (doc.reminderDays <= 0 || doc.reminderCount >= MAX_REMINDERS) return false;
  if (!doc.customer.email && !doc.customer.phone) return false;
  if (daysBetween(doc.dueDate, today) < 0) return false;
  if (!doc.lastReminderAt) return true;
  return daysBetween(doc.lastReminderAt.slice(0, 10), today) >= doc.reminderDays;
}
