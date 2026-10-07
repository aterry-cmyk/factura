import { csvCell } from "@/lib/doc-list";
import type { Lang } from "@/lib/types";

// The waitlist from the public website (~/loro-site → table `waitlist`). The site only sends these
// trade values; anything else is stored as null.
export const TRADES = [
  "painting", "remodeling", "roofing", "landscaping", "cleaning", "plumbing",
  "electrical", "flooring", "drywall", "hvac", "concrete", "other",
] as const;
export type Trade = (typeof TRADES)[number];

const TRADE_NAMES: Record<Lang, Record<Trade, string>> = {
  es: {
    painting: "Pintura", remodeling: "Remodelación", roofing: "Techos", landscaping: "Jardinería",
    cleaning: "Limpieza", plumbing: "Plomería", electrical: "Electricidad", flooring: "Pisos",
    drywall: "Drywall", hvac: "Aire acondicionado", concrete: "Concreto", other: "Otro",
  },
  en: {
    painting: "Painting", remodeling: "Remodeling", roofing: "Roofing", landscaping: "Landscaping",
    cleaning: "Cleaning", plumbing: "Plumbing", electrical: "Electrical", flooring: "Flooring",
    drywall: "Drywall", hvac: "HVAC", concrete: "Concrete", other: "Other",
  },
};

export type WaitlistEntry = { id: string; email: string; name: string; trade: Trade | null; lang: Lang; createdAt: string };
export type WaitlistFilters = { q: string; trade: Trade | "all" | "none" };

export function isTrade(v: unknown): v is Trade {
  return typeof v === "string" && (TRADES as readonly string[]).includes(v);
}

export function tradeName(trade: Trade | null, lang: Lang): string {
  return trade ? TRADE_NAMES[lang][trade] : "";
}

export function parseWaitlistFilters(raw: Record<string, string | string[] | undefined>): WaitlistFilters {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const q = one(raw.q).trim().slice(0, 100);
  const t = one(raw.trade);
  return { q, trade: isTrade(t) || t === "none" ? t : "all" };
}

export function waitlistQuery(f: WaitlistFilters, change: Partial<WaitlistFilters> = {}): string {
  const g = { ...f, ...change };
  const p = new URLSearchParams();
  if (g.q) p.set("q", g.q);
  if (g.trade !== "all") p.set("trade", g.trade);
  const s = p.toString();
  return s ? `?${s}` : "";
}

const HEADERS: Record<Lang, string[]> = {
  es: ["Email", "Nombre", "Oficio", "Idioma", "Fecha"],
  en: ["Email", "Name", "Trade", "Language", "Date"],
};

/** The list as a spreadsheet (Excel opens it with accents intact thanks to the BOM). */
export function waitlistCsv(entries: WaitlistEntry[], lang: Lang): string {
  const rows = entries.map((e) => [
    e.email,
    e.name,
    tradeName(e.trade, lang),
    e.lang === "es" ? (lang === "es" ? "Español" : "Spanish") : lang === "es" ? "Inglés" : "English",
    e.createdAt.slice(0, 10),
  ]);
  return "﻿" + [HEADERS[lang], ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
