import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { pdfSafe, renderPdf } from "@/lib/pdf";
import { sampleDoc } from "./fixtures";

// 1×1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");


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
