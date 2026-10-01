import { describe, expect, it } from "vitest";
import { normalizePhone, validateDraft } from "@/lib/validate";

const good = {
  kind: "invoice",
  lang: "es",
  customer: { name: "Juan Pérez", email: "JUAN@example.com", phone: "(301) 555-0100" },
  business: { name: "Pintura Hernández", phone: "301-555-0199" },
  items: [{ description: "Pintar cocina", quantity: 1, unitPriceCents: 220000, source: "said" }],
  state: "md",
  taxEnabled: true,
  taxRate: 6,
  dueDays: 15,
  reminderDays: 7,
  lateFee: { type: "flat", amountCents: 2500, graceDays: 5 },
  paymentMethods: { zelle: { enabled: true, handle: "301-555-0199" }, cash: { enabled: true } },
};

describe("validateDraft", () => {
  it("accepts a complete draft and cleans it", () => {
    const r = validateDraft(good);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.customer.email).toBe("juan@example.com");
    expect(r.value.customer.phone).toBe("+13015550100");
    expect(r.value.state).toBe("MD");
    expect(r.value.taxRate).toBe(6);
  });

  it("refuses an unconfirmed suggested price", () => {
    const r = validateDraft({ ...good, items: [{ description: "Ventanas", quantity: 3, unitPriceCents: 40000, source: "suggested" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/Confirm the suggested price/);
    const ok = validateDraft({ ...good, items: [{ description: "Ventanas", quantity: 3, unitPriceCents: 40000, source: "suggested", confirmed: true }] });
    expect(ok.ok).toBe(true);
  });

  it("needs a way to get paid and the details for it", () => {
    const none = validateDraft({ ...good, paymentMethods: {} });
    expect(none.ok).toBe(false);
    const blank = validateDraft({ ...good, paymentMethods: { check: { enabled: true, payableTo: "" } } });
    expect(blank.ok).toBe(false);
    const http = validateDraft({ ...good, paymentMethods: { card: { enabled: true, link: "http://pay.example.com" } } });
    expect(http.ok).toBe(false);
  });

  it("drops tax when it's off and late fees/reminders on estimates", () => {
    const r = validateDraft({ ...good, kind: "estimate", taxEnabled: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.taxRate).toBe(0);
    expect(r.value.lateFee).toEqual({ type: "none" });
    expect(r.value.reminderDays).toBe(0);
  });

  it("refuses bad numbers and unknown states", () => {
    for (const bad of [
      { taxRate: 45 },
      { state: "ZZ" },
      { reminderDays: 5 },
      { items: [] },
      { items: [{ description: "x", quantity: 0, unitPriceCents: 100 }] },
      { items: [{ description: "x", quantity: 1, unitPriceCents: 10.5 }] },
      { lateFee: { type: "percent", percent: 25, graceDays: 0 } },
      { customer: { name: "" } },
      { customer: { name: "Juan", phone: "555" } },
    ]) {
      expect(validateDraft({ ...good, ...bad }).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("normalizes US phone numbers", () => {
    expect(normalizePhone("1 (240) 555-0101")).toBe("+12405550101");
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone("12345")).toBeNull();
  });
});
