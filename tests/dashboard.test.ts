import { describe, expect, it } from "vitest";
import { acceptanceRate, aging, byMonth, monthKeys, topOwing } from "@/lib/dashboard";
import { sampleDoc } from "./fixtures";

const open = (name: string, cents: number, due: string, over = {}) =>
  sampleDoc({ status: "sent", kind: "invoice", customer: { name, company: "", email: "", phone: "" }, totalCents: cents, subtotalCents: cents, taxCents: 0, taxRate: 0, dueDate: due, lateFee: { type: "none" }, items: [{ description: "x", quantity: 1, unitPriceCents: cents, source: "said" }], ...over });

describe("dashboard numbers", () => {
  it("lists the last months across the year end", () => {
    expect(monthKeys("2026-02-15", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("groups open invoices by how late they are", () => {
    const a = aging([
      open("A", 1000, "2026-10-20"), open("B", 2000, "2026-10-10"), open("C", 3000, "2026-09-01"), open("D", 4000, "2026-07-01"),
      open("E", 9999, "2026-07-01", { status: "paid" }),
    ], "2026-10-15");
    expect(a).toEqual({ current: { count: 1, cents: 1000 }, d1_30: { count: 1, cents: 2000 }, d31_60: { count: 1, cents: 3000 }, d61: { count: 1, cents: 4000 } });
  });

  it("adds up what each customer owes, biggest first", () => {
    const top = topOwing([open("Juan Pérez", 1000, "2026-10-20"), open("juan pérez ", 500, "2026-10-20"), open("Ana", 1200, "2026-10-20")], "2026-10-15");
    expect(top).toEqual([{ name: "Juan Pérez", cents: 1500, count: 2 }, { name: "Ana", cents: 1200, count: 1 }]);
  });

  it("works out the acceptance rate only from decided estimates", () => {
    expect(acceptanceRate(2, 1)).toBe(67);
    expect(acceptanceRate(0, 0)).toBeNull();
  });

  it("fills missing months with zeros, in order", () => {
    expect(byMonth(["2026-09", "2026-10"], [{ month: "2026-10", billed: 5 }], { billed: 0 })).toEqual([{ month: "2026-09", billed: 0 }, { month: "2026-10", billed: 5 }]);
  });
});
