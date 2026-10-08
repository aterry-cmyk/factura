import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { pdfSafe, renderPdf } from "@/lib/pdf";
import type { Doc } from "@/lib/types";

// 1×1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

export const sampleDoc = (over: Partial<Doc> = {}): Doc => ({
  id: "00000000-0000-0000-0000-000000000001",
  accountId: "00000000-0000-0000-0000-0000000000aa",
  kind: "invoice",
  number: "F-0001",
  status: "sent",
  customer: { name: "Juan Peña", company: "Peña & Hijos", email: "juan@example.com", phone: "+13015550100" },
  business: { name: "Pintura Hernández LLC", ownerName: "José Hernández", address: "123 Main St, Silver Spring, MD", phone: "+13015550199", email: "jose@example.com", website: "" },
  lang: "es",
  items: [
    { description: "Pintar cocina (paredes y techo), 2 manos — color «Agua»", quantity: 1, unitPriceCents: 220000, source: "said" },
    { description: "Materiales", quantity: 1, unitPriceCents: 35000, source: "said" },
  ],
  state: "MD",
  taxRate: 6,
  subtotalCents: 255000,
  taxCents: 15300,
  totalCents: 270300,
  issueDate: "2026-10-01",
  dueDate: "2026-10-16",
  reminderDays: 7,
  lateFee: { type: "flat", amountCents: 2500, graceDays: 5 },
  paymentMethods: { zelle: { enabled: true, handle: "301-555-0199" }, check: { enabled: true, payableTo: "Pintura Hernández LLC" } },
  notes: "Garantía de 1 año. ¡Gracias! 🎨",
  publicToken: "abcdefghijklmnopqrstuvwx",
  sentAt: null,
  paidAt: null,
  lastReminderAt: null,
  reminderCount: 0,
  createdAt: "2026-10-01T12:00:00Z",
  ...over,
});

describe("pdf", () => {
  it("keeps Spanish and replaces what the standard fonts can't draw", () => {
    expect(pdfSafe("Peña ¿Cuánto? ¡Sí! — «ok»")).toBe("Peña ¿Cuánto? ¡Sí! — «ok»");
    expect(pdfSafe("🎨 ą ő x")).toBe("? a o x");
  });

  it("renders a letter-size invoice with a logo", async () => {
    const bytes = await renderPdf(sampleDoc(), { logo: { bytes: PNG, type: "image/png" }, today: "2026-10-01" });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    expect(pdf.getTitle()).toBe("Factura F-0001");
  });

  it("flows long invoices onto more pages and survives a broken logo", async () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ description: `Concepto ${i + 1} con una descripción bastante larga para que ocupe dos líneas en la tabla de conceptos`, quantity: 1, unitPriceCents: 1000, source: "typed" as const }));
    const bytes = await renderPdf(sampleDoc({ items, lang: "en", status: "paid" }), { logo: { bytes: Buffer.from("nope"), type: "image/png" }, today: "2026-12-01" });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(2);
  });
});
