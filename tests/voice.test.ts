import { describe, expect, it } from "vitest";
import { COUNTRIES, isCountry, localeFor, pickVoice, spokenMoney, spokenSummary } from "@/lib/voice";

const v = (lang: string, name = lang, localService = true) => ({ lang, name, localService });

describe("countries and locales", () => {
  it("maps a country to its Spanish, and English to US English", () => {
    expect(localeFor("MX", "es")).toBe("es-MX");
    expect(localeFor("PR", "es")).toBe("es-PR");
    expect(localeFor("MX", "en")).toBe("en-US");
    expect(localeFor("ZZ", "es")).toBe("es-US");
  });

  it("accepts only listed countries", () => {
    expect(isCountry("CO")).toBe(true);
    expect(isCountry("co")).toBe(false);
    expect(isCountry("ZZ")).toBe(false);
    expect(isCountry(undefined)).toBe(false);
    expect(new Set(COUNTRIES.map((c) => c.code)).size).toBe(COUNTRIES.length);
    for (const c of COUNTRIES) expect(c.locale).toMatch(/^es-[A-Z]{2}$/);
  });
});

describe("pickVoice", () => {
  it("uses the country's own voice when the device has one, on-device first", () => {
    const voices = [v("es-ES"), v("es-MX", "Paulina (online)", false), v("es-MX", "Paulina"), v("en-US")];
    expect(pickVoice(voices, "es-MX")).toEqual({ voice: voices[2], match: "exact" });
  });

  it("falls back to US, then Mexican Spanish, and says it isn't the country's accent", () => {
    expect(pickVoice([v("es-ES"), v("es-MX"), v("es-US")], "es-CO")).toEqual({ voice: v("es-US"), match: "language" });
    expect(pickVoice([v("es-ES"), v("es-MX")], "es-HN").voice?.lang).toBe("es-MX");
    expect(pickVoice([v("es_ES")], "es-AR")).toEqual({ voice: v("es_ES"), match: "language" });
  });

  it("matches Android-style locale names", () => {
    expect(pickVoice([v("es_PR")], "es-PR").match).toBe("exact");
  });

  it("reports when there is nothing to speak with", () => {
    expect(pickVoice([v("en-US"), v("fr-FR")], "es-MX")).toEqual({ voice: null, match: "none" });
    expect(pickVoice([], "es-MX")).toEqual({ voice: null, match: "none" });
  });
});

describe("what the app says", () => {
  it("reads whole dollars without cents", () => {
    expect(spokenMoney(220000, "en")).toBe("$2,200");
    expect(spokenMoney(4999, "en")).toBe("$49.99");
    expect(spokenMoney(220000, "es")).toContain("2,200");
    expect(spokenMoney(220000, "es")).not.toContain(".00");
  });

  it("repeats the items with the exact amounts on screen", () => {
    const said = spokenSummary({
      lang: "es",
      kind: "invoice",
      customerName: "Juan",
      items: [
        { description: "Pintar la cocina", quantity: 1, unitPriceCents: 220000, suggested: false },
        { description: "Materiales", quantity: 1, unitPriceCents: 35000, suggested: false },
      ],
      totalCents: 255000,
      questions: [],
    });
    expect(said).toContain("Una factura para Juan");
    expect(said).toContain("Pintar la cocina, $2,200");
    expect(said).toContain("Materiales, $350");
    expect(said).toContain("Total: $2,550");
    expect(said).not.toContain("sugerido");
  });

  it("flags suggested prices, reads the assistant's questions, and shortens long lists", () => {
    const items = Array.from({ length: 6 }, (_, i) => ({ description: `Cosa ${i + 1}`, quantity: 2, unitPriceCents: 1000, suggested: i === 0 }));
    const said = spokenSummary({ lang: "es", kind: "estimate", customerName: "", items, totalCents: 12000, questions: ["¿Cuántas ventanas son?"] });
    expect(said).toContain("Un presupuesto:");
    expect(said).toContain("Cosa 1, 2 × $10, precio sugerido");
    expect(said).toContain("y 2 más");
    expect(said).not.toContain("Cosa 5");
    expect(said).toContain("Revisa los precios sugeridos");
    expect(said.endsWith("¿Cuántas ventanas son?")).toBe(true);
  });

  it("speaks English when the app is in English", () => {
    const said = spokenSummary({
      lang: "en",
      kind: "invoice",
      customerName: "Ana",
      items: [{ description: "Fix the fence", quantity: 1, unitPriceCents: 45050, suggested: false }],
      totalCents: 45050,
      questions: [],
    });
    expect(said).toBe("Done. An invoice for Ana: Fix the fence, $450.50. Total: $450.50.");
  });
});

describe("voice quality", () => {
  it("prefers a natural voice over Apple's character voices, as on a Mac", () => {
    const mac = ["Eddy (Spanish (Mexico))", "Flo (Spanish (Mexico))", "Grandma (Spanish (Mexico))", "Paulina", "Rocko (Spanish (Mexico))"].map((name) => v("es-MX", name));
    expect(pickVoice(mac, "es-MX").voice?.name).toBe("Paulina");
    const spain = [v("es-ES", "Eddy (Spanish (Spain))"), v("es-ES", "Mónica")];
    expect(pickVoice(spain, "es-CO").voice?.name).toBe("Mónica");
  });

  it("prefers enhanced and Google voices", () => {
    const voices = [v("es-US", "Paulina"), v("es-US", "Google español de Estados Unidos", false), v("es-US", "Marisol (Enhanced)")];
    expect(pickVoice(voices, "es-US").voice?.name).toBe("Marisol (Enhanced)");
  });
});
