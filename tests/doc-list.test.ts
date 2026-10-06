import { describe, expect, it } from "vitest";
import { bulkPlan, canMove, csvCell, documentsCsv, filtersQuery, isOverdue, parseFilters } from "@/lib/doc-list";
import type { Doc } from "@/lib/types";

const doc = (over: Partial<Doc> = {}): Doc => ({
  id: "00000000-0000-0000-0000-000000000001", kind: "invoice", number: "F-0001", status: "sent",
  customer: { name: "Juan Pérez", company: "", email: "juan@example.com", phone: "" },
  business: { name: "Pintura", ownerName: "", address: "", phone: "", email: "", website: "" },
  lang: "es", items: [{ description: "Pintar cocina", quantity: 1, unitPriceCents: 220000, source: "said" }],
  state: "MD", taxRate: 0, subtotalCents: 220000, taxCents: 0, totalCents: 220000,
  issueDate: "2026-09-01", dueDate: "2026-09-16", reminderDays: 7,
  lateFee: { type: "flat", amountCents: 2500, graceDays: 5 }, paymentMethods: {}, notes: "", publicToken: "t",
  sentAt: null, paidAt: null, lastReminderAt: null, reminderCount: 0, createdAt: "2026-09-01T00:00:00Z",
  ...over,
});

describe("filters from the address bar", () => {
  it("keeps only what it understands", () => {
    expect(parseFilters({ q: "  Juan ", status: "overdue", kind: "invoice", from: "2026-09-01", to: "nope", page: "3" }))
      .toEqual({ q: "Juan", status: "overdue", kind: "invoice", from: "2026-09-01", to: null, page: 3 });
    expect(parseFilters({ status: "deleted", kind: "x", page: "-2" })).toMatchObject({ status: "all", kind: "all", page: 1 });
    expect(parseFilters({ q: ["a", "b"] }).q).toBe("a");
    expect(parseFilters({ q: "x".repeat(300) }).q.length).toBe(100);
  });

  it("writes them back without defaults, and starts again from page 1 when a filter changes", () => {
    const f = parseFilters({ q: "Juan", status: "paid", page: "4" });
    expect(filtersQuery(f)).toBe("?q=Juan&status=paid");
    expect(filtersQuery(f, { page: 5 })).toBe("?q=Juan&status=paid&page=5");
    expect(filtersQuery(f, { status: "all", q: "" })).toBe("");
  });

  it("counts only sent invoices past their due date as overdue", () => {
    expect(isOverdue(doc(), "2026-09-17")).toBe(true);
    expect(isOverdue(doc(), "2026-09-16")).toBe(false);
    expect(isOverdue(doc({ status: "paid" }), "2026-12-01")).toBe(false);
    expect(isOverdue(doc({ kind: "estimate" }), "2026-12-01")).toBe(false);
  });
});

describe("CSV", () => {
  it("quotes what needs quoting and never lets a cell run as a formula", () => {
    expect(csvCell("Juan")).toBe("Juan");
    expect(csvCell('Dice "hola", y ya')).toBe('"Dice ""hola"", y ya"');
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell("+1 301")).toBe("'+1 301");
    expect(csvCell("@sum")).toBe("'@sum");
    expect(csvCell(12.5)).toBe("12.5");
  });

  it("has one row per document with plain amounts and today's balance", () => {
    const csv = documentsCsv(
      [doc(), doc({ id: "2", number: "P-0001", kind: "estimate", status: "accepted", customer: { name: "Ana", company: "ACME, LLC", email: "", phone: "" } })],
      "es", "2026-09-30", (d) => d.status,
    );
    expect(csv.startsWith("﻿Número,Tipo,Estado,Cliente")).toBe(true);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe("F-0001,Factura,sent,Juan Pérez,,juan@example.com,,2026-09-01,2026-09-16,1 × Pintar cocina ($2200.00),2200.00,0.00,2200.00,25.00,2225.00,");
    expect(lines[2]).toContain('Presupuesto,accepted,Ana,"ACME, LLC"');
    expect(lines[2].endsWith(",0.00,0.00,")).toBe(true);
  });
});

describe("bulk actions", () => {
  const d = (id: string, kind: Doc["kind"], status: Doc["status"]) => ({ id, kind, status });

  it("marks paid only invoices that can be paid, and says why the rest were left", () => {
    const plan = bulkPlan([d("a", "invoice", "sent"), d("b", "invoice", "draft"), d("c", "invoice", "paid"), d("e", "invoice", "void"), d("f", "estimate", "sent")], "paid");
    expect(plan.apply).toEqual(["a", "b"]);
    expect(plan.skip).toEqual([{ id: "c", reason: "already" }, { id: "e", reason: "closed" }, { id: "f", reason: "not_invoice" }]);
  });

  it("voids anything open, never something paid or already void", () => {
    const plan = bulkPlan([d("a", "invoice", "sent"), d("b", "estimate", "accepted"), d("c", "invoice", "paid"), d("e", "invoice", "void")], "void");
    expect(plan.apply).toEqual(["a", "b"]);
    expect(plan.skip.map((s) => s.reason)).toEqual(["closed", "already"]);
  });

  it("reminds only invoices that were sent and aren't paid", () => {
    const plan = bulkPlan([d("a", "invoice", "sent"), d("b", "invoice", "draft"), d("c", "invoice", "paid"), d("e", "estimate", "sent")], "remind");
    expect(plan.apply).toEqual(["a"]);
    expect(plan.skip.map((s) => s.reason)).toEqual(["not_sent", "closed", "not_invoice"]);
  });

  it("uses the same rules as a single document's buttons", () => {
    expect(canMove({ kind: "invoice", status: "paid" }, "sent")).toBe(true);
    expect(canMove({ kind: "invoice", status: "void" }, "paid")).toBe(false);
    expect(canMove({ kind: "estimate", status: "sent" }, "paid")).toBe(false);
  });
});
