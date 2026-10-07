import { describe, expect, it } from "vitest";
import { isTrade, parseWaitlistFilters, tradeName, waitlistCsv, waitlistQuery, type WaitlistEntry } from "@/lib/waitlist";

const entry = (over: Partial<WaitlistEntry> = {}): WaitlistEntry => ({
  id: "1", email: "juan@example.com", name: "", trade: "painting", lang: "es", createdAt: "2026-10-07T21:41:17.000Z", ...over,
});

describe("waitlist", () => {
  it("knows the trades the website sends, and nothing else", () => {
    expect(isTrade("roofing")).toBe(true);
    expect(isTrade("astronaut")).toBe(false);
    expect(tradeName("hvac", "es")).toBe("Aire acondicionado");
    expect(tradeName("hvac", "en")).toBe("HVAC");
    expect(tradeName(null, "es")).toBe("");
  });

  it("reads filters from the address and writes them back", () => {
    expect(parseWaitlistFilters({})).toEqual({ q: "", trade: "all" });
    expect(parseWaitlistFilters({ q: "  juan ", trade: "roofing" })).toEqual({ q: "juan", trade: "roofing" });
    expect(parseWaitlistFilters({ trade: "none" }).trade).toBe("none");
    expect(parseWaitlistFilters({ trade: "'; drop table" }).trade).toBe("all");
    expect(parseWaitlistFilters({ q: "x".repeat(300) }).q).toHaveLength(100);
    expect(waitlistQuery({ q: "", trade: "all" })).toBe("");
    expect(waitlistQuery({ q: "ana lópez", trade: "all" }, { trade: "painting" })).toBe("?q=ana+l%C3%B3pez&trade=painting");
  });

  it("makes a CSV Excel opens with accents, in the owner's language", () => {
    const csv = waitlistCsv([entry(), entry({ email: "=cmd@example.com", trade: null, lang: "en", name: 'Ana "La Jefa"' })], "es");
    expect(csv.startsWith("﻿Email,Nombre,Oficio,Idioma,Fecha\r\n")).toBe(true);
    const lines = csv.slice(1).trim().split("\r\n");
    expect(lines[1]).toBe("juan@example.com,,Pintura,Español,2026-10-07");
    // A cell that starts like a formula is defused; quotes are escaped.
    expect(lines[2]).toBe(`'=cmd@example.com,"Ana ""La Jefa""",,Inglés,2026-10-07`);
    expect(waitlistCsv([entry()], "en").split("\r\n")[1]).toBe("juan@example.com,,Painting,Spanish,2026-10-07");
  });
});
