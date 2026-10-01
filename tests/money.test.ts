import { describe, expect, it } from "vitest";
import { addDays, amountDueCents, daysBetween, lateFeeCents, parseMoney, totals } from "@/lib/money";
import type { LineItem } from "@/lib/types";

const item = (quantity: number, unitPriceCents: number): LineItem => ({ description: "x", quantity, unitPriceCents, source: "said" });

describe("money", () => {
  it("adds lines and tax in whole cents", () => {
    expect(totals([item(1, 220000), item(1, 35000)], 0)).toEqual({ subtotalCents: 255000, taxCents: 0, totalCents: 255000 });
    expect(totals([item(1, 10000)], 6)).toEqual({ subtotalCents: 10000, taxCents: 600, totalCents: 10600 });
    // 2.5 hours at $33.33 = 83.325 → 8333 cents; tax 8.875% of 8333 = 739.55 → 740
    expect(totals([item(2.5, 3333)], 8.875)).toEqual({ subtotalCents: 8333, taxCents: 740, totalCents: 9073 });
  });

  it("reads amounts the way people type them", () => {
    expect(parseMoney("2200")).toBe(220000);
    expect(parseMoney("$2,200.50")).toBe(220050);
    expect(parseMoney(" 49.9 ")).toBe(4990);
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("1.234")).toBeNull();
    expect(parseMoney("")).toBeNull();
  });

  it("counts days on the calendar", () => {
    expect(daysBetween("2026-10-01", "2026-10-31")).toBe(30);
    expect(addDays("2026-10-25", 15)).toBe("2026-11-09");
  });

  const doc = { totalCents: 100000, dueDate: "2026-10-15", status: "sent" as const };

  it("charges nothing during the grace days", () => {
    const fee = { type: "flat" as const, amountCents: 2500, graceDays: 5 };
    expect(lateFeeCents({ ...doc, lateFee: fee }, "2026-10-15")).toBe(0);
    expect(lateFeeCents({ ...doc, lateFee: fee }, "2026-10-20")).toBe(0);
    expect(lateFeeCents({ ...doc, lateFee: fee }, "2026-10-21")).toBe(2500);
    expect(lateFeeCents({ ...doc, lateFee: fee }, "2027-06-01")).toBe(2500);
  });

  it("charges a percentage per started month, capped at 12", () => {
    const fee = { type: "percent" as const, percent: 1.5, graceDays: 0 };
    expect(lateFeeCents({ ...doc, lateFee: fee }, "2026-10-16")).toBe(1500);
    expect(lateFeeCents({ ...doc, lateFee: fee }, "2026-11-14")).toBe(1500);
    expect(lateFeeCents({ ...doc, lateFee: fee }, "2026-11-15")).toBe(3000);
    expect(lateFeeCents({ ...doc, lateFee: fee }, "2030-01-01")).toBe(18000);
  });

  it("owes nothing once paid or void", () => {
    const fee = { type: "flat" as const, amountCents: 2500, graceDays: 0 };
    expect(amountDueCents({ ...doc, lateFee: fee }, "2026-12-01")).toBe(102500);
    expect(amountDueCents({ ...doc, status: "paid", lateFee: fee }, "2026-12-01")).toBe(0);
    expect(amountDueCents({ ...doc, status: "void", lateFee: fee }, "2026-12-01")).toBe(0);
  });
});
