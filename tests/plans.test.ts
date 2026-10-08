import { describe, expect, it } from "vitest";
import { platformTotals, validateAccountChange, type AccountRow } from "@/lib/admin";
import { blockFor, monthRange, NO_USAGE, PLANS, trialDaysLeft } from "@/lib/plans";

const NOW = Date.parse("2026-10-08T12:00:00Z");
const trial = { plan: "trial" as const, status: "active" as const, trialEndsAt: "2026-10-20T23:59:59.000Z" };

describe("plans", () => {
  it("lets a trial work until its limits, then says which limit", () => {
    expect(blockFor(trial, NO_USAGE, "document", NOW)).toBeNull();
    expect(blockFor(trial, { ...NO_USAGE, documents: PLANS.trial.documentsPerMonth! }, "document", NOW)).toBe("limit_documents");
    expect(blockFor(trial, { ...NO_USAGE, documents: 999 }, "ai", NOW)).toBeNull();
    expect(blockFor(trial, { ...NO_USAGE, ai: PLANS.trial.aiPerMonth! }, "ai", NOW)).toBe("limit_ai");
  });

  it("stops an ended trial and a paused account, but never courtesy for usage", () => {
    expect(blockFor({ ...trial, trialEndsAt: "2026-10-01T00:00:00Z" }, NO_USAGE, "ai", NOW)).toBe("trial_over");
    expect(blockFor({ ...trial, plan: "pro", trialEndsAt: "2026-10-01T00:00:00Z" }, NO_USAGE, "ai", NOW)).toBeNull();
    expect(blockFor({ ...trial, plan: "comped", status: "suspended" }, NO_USAGE, "document", NOW)).toBe("suspended");
    expect(blockFor({ ...trial, plan: "comped" }, { ...NO_USAGE, documents: 1e6, ai: 1e6 }, "document", NOW)).toBeNull();
  });

  it("counts trial days up, never below zero", () => {
    expect(trialDaysLeft("2026-10-20T23:59:59.000Z", NOW)).toBe(13);
    expect(trialDaysLeft("2026-10-08T13:00:00.000Z", NOW)).toBe(1);
    expect(trialDaysLeft("2026-10-01T00:00:00.000Z", NOW)).toBe(0);
  });

  it("uses calendar months in UTC, across the year end", () => {
    expect(monthRange(new Date("2026-12-31T23:00:00Z"))).toEqual({ start: "2026-12-01T00:00:00.000Z", end: "2027-01-01T00:00:00.000Z" });
  });
});

describe("admin billing", () => {
  it("accepts a clean edit and runs the trial to the end of the chosen day", () => {
    const r = validateAccountChange({ plan: "pro", status: "active", trialEndsAt: "2026-11-01", monthlyFeeCents: 2900, billingEmail: " Ana@Example.com ", billingNotes: "Zelle" });
    expect(r).toEqual({ ok: true, value: { plan: "pro", status: "active", trialEndsAt: "2026-11-01T23:59:59.000Z", monthlyFeeCents: 2900, billingEmail: "ana@example.com", billingNotes: "Zelle" } });
  });

  it("names every wrong field", () => {
    const r = validateAccountChange({ plan: "gold", status: "x", trialEndsAt: "11/01/2026", monthlyFeeCents: 12.5, billingEmail: "nope", billingNotes: "x".repeat(2001) });
    expect(r).toEqual({ ok: false, errors: ["plan", "status", "trialEndsAt", "monthlyFeeCents", "billingEmail", "billingNotes"] });
    expect(validateAccountChange(null).ok).toBe(false);
  });

  it("adds up revenue from active Pro accounts only", () => {
    const row = (over: Partial<AccountRow>): AccountRow => ({
      id: "x", name: "", ownerEmail: "", ownerName: "", plan: "trial", status: "active", trialEndsAt: "2026-10-20T00:00:00Z",
      monthlyFeeCents: 0, createdAt: "2026-09-01T00:00:00Z", lastActive: null, documentsThisMonth: 0, aiThisMonth: 0, documentsTotal: 0, claimed: true, ...over,
    });
    const t = platformTotals([
      row({ plan: "pro", monthlyFeeCents: 2900 }),
      row({ plan: "pro", monthlyFeeCents: 4900, status: "suspended" }),
      row({ plan: "comped", monthlyFeeCents: 9999 }),
      row({}),
      row({ trialEndsAt: "2026-10-01T00:00:00Z", createdAt: "2026-10-02T00:00:00Z" }),
    ], NOW);
    expect(t).toEqual({ accounts: 5, trials: 1, trialsOver: 1, pro: 1, comped: 1, suspended: 1, monthlyRevenueCents: 2900, newThisMonth: 1 });
  });
});
