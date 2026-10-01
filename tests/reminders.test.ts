import { describe, expect, it } from "vitest";
import { MAX_REMINDERS, reminderDue } from "@/lib/reminders";

const base = {
  kind: "invoice" as const,
  status: "sent" as const,
  dueDate: "2026-10-15",
  reminderDays: 7,
  reminderCount: 0,
  lastReminderAt: null as string | null,
  customer: { name: "Juan", company: "", email: "juan@example.com", phone: "" },
};

describe("reminders", () => {
  it("starts on the due date", () => {
    expect(reminderDue(base, "2026-10-14")).toBe(false);
    expect(reminderDue(base, "2026-10-15")).toBe(true);
  });
  it("repeats every N days", () => {
    const sent = { ...base, reminderCount: 1, lastReminderAt: "2026-10-15T15:00:00Z" };
    expect(reminderDue(sent, "2026-10-21")).toBe(false);
    expect(reminderDue(sent, "2026-10-22")).toBe(true);
  });
  it("never for estimates, drafts, paid, void, 'never', no contact, or after the limit", () => {
    expect(reminderDue({ ...base, kind: "estimate" }, "2026-10-20")).toBe(false);
    for (const status of ["draft", "paid", "void"] as const) expect(reminderDue({ ...base, status }, "2026-10-20")).toBe(false);
    expect(reminderDue({ ...base, reminderDays: 0 }, "2026-10-20")).toBe(false);
    expect(reminderDue({ ...base, customer: { ...base.customer, email: "" } }, "2026-10-20")).toBe(false);
    expect(reminderDue({ ...base, reminderCount: MAX_REMINDERS }, "2026-12-20")).toBe(false);
  });
});
