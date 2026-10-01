import type { Lang } from "./types";

/**
 * The owner's country sets the Spanish the app listens for and speaks in. The voice is the
 * device's own (speechSynthesis); a device that has no voice for that country uses another Spanish
 * voice, and the settings page says so rather than pretending.
 */
// azure: the natural voices Azure Speech has for that country (learn.microsoft.com, language
// support → text to speech), a woman's and a man's. Used when AZURE_SPEECH_KEY is set.
export const COUNTRIES: { code: string; locale: string; es: string; en: string; azure: { female: string; male: string } }[] = [
  { code: "US", locale: "es-US", es: "Estados Unidos", en: "United States", azure: { female: "es-US-PalomaNeural", male: "es-US-AlonsoNeural" } },
  { code: "MX", locale: "es-MX", es: "México", en: "Mexico", azure: { female: "es-MX-DaliaNeural", male: "es-MX-JorgeNeural" } },
  { code: "PR", locale: "es-PR", es: "Puerto Rico", en: "Puerto Rico", azure: { female: "es-PR-KarinaNeural", male: "es-PR-VictorNeural" } },
  { code: "DO", locale: "es-DO", es: "República Dominicana", en: "Dominican Republic", azure: { female: "es-DO-RamonaNeural", male: "es-DO-EmilioNeural" } },
  { code: "CU", locale: "es-CU", es: "Cuba", en: "Cuba", azure: { female: "es-CU-BelkysNeural", male: "es-CU-ManuelNeural" } },
  { code: "GT", locale: "es-GT", es: "Guatemala", en: "Guatemala", azure: { female: "es-GT-MartaNeural", male: "es-GT-AndresNeural" } },
  { code: "SV", locale: "es-SV", es: "El Salvador", en: "El Salvador", azure: { female: "es-SV-LorenaNeural", male: "es-SV-RodrigoNeural" } },
  { code: "HN", locale: "es-HN", es: "Honduras", en: "Honduras", azure: { female: "es-HN-KarlaNeural", male: "es-HN-CarlosNeural" } },
  { code: "NI", locale: "es-NI", es: "Nicaragua", en: "Nicaragua", azure: { female: "es-NI-YolandaNeural", male: "es-NI-FedericoNeural" } },
  { code: "CO", locale: "es-CO", es: "Colombia", en: "Colombia", azure: { female: "es-CO-SalomeNeural", male: "es-CO-GonzaloNeural" } },
  { code: "VE", locale: "es-VE", es: "Venezuela", en: "Venezuela", azure: { female: "es-VE-PaolaNeural", male: "es-VE-SebastianNeural" } },
  { code: "EC", locale: "es-EC", es: "Ecuador", en: "Ecuador", azure: { female: "es-EC-AndreaNeural", male: "es-EC-LuisNeural" } },
  { code: "PE", locale: "es-PE", es: "Perú", en: "Peru", azure: { female: "es-PE-CamilaNeural", male: "es-PE-AlexNeural" } },
  { code: "AR", locale: "es-AR", es: "Argentina", en: "Argentina", azure: { female: "es-AR-ElenaNeural", male: "es-AR-TomasNeural" } },
];

const ENGLISH_AZURE = { female: "en-US-JennyNeural", male: "en-US-GuyNeural" };

export type VoiceGender = "female" | "male";
export const isGender = (g: unknown): g is VoiceGender => g === "female" || g === "male";

/** The Azure voice for the owner's country and choice; the app in English uses a US English voice. */
export function azureVoiceFor(country: string, lang: Lang, gender: VoiceGender): { name: string; locale: string } {
  if (lang === "en") return { name: ENGLISH_AZURE[gender], locale: "en-US" };
  const c = COUNTRIES.find((x) => x.code === country) ?? COUNTRIES[0];
  return { name: c.azure[gender], locale: c.locale };
}

/** "es-MX-DaliaNeural" → "Dalia". */
export const azureVoiceLabel = (name: string): string => /-([A-Z][a-z]+)Neural$/.exec(name)?.[1] ?? name;

export const DEFAULT_COUNTRY = "US";

export const isCountry = (code: unknown): code is string =>
  typeof code === "string" && COUNTRIES.some((c) => c.code === code);

export const countryName = (code: string, lang: Lang): string =>
  COUNTRIES.find((c) => c.code === code)?.[lang] ?? code;

/** The locale to listen and speak in. The app in English is US English whatever the country. */
export function localeFor(country: string, lang: Lang): string {
  if (lang === "en") return "en-US";
  return COUNTRIES.find((c) => c.code === country)?.locale ?? "es-US";
}

export interface VoiceLike {
  lang: string;
  name: string;
  localService?: boolean;
}

const norm = (l: string) => l.replace("_", "-").toLowerCase();

// Apple's character voices (listed for every language) sound like toys; a real person's voice
// such as Paulina or a Google/neural voice should always win over them.
const NOVELTY = /^(eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley|albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox)\b/i;
const NATURAL = /premium|enhanced|natural|neural|google/i;

/** Lower is better: natural voices, then ordinary ones, then novelty; on-device before online. */
function quality(v: VoiceLike): number {
  const sound = NATURAL.test(v.name) ? 0 : NOVELTY.test(v.name) ? 2 : 1;
  return sound * 2 + (v.localService ? 0 : 1);
}

/**
 * The best voice the device has for this locale. "exact": that country's accent. "language": another
 * voice in the same language (es-US, then es-MX, then any). "none": nothing to speak with.
 */
export function pickVoice<V extends VoiceLike>(voices: V[], locale: string): { voice: V | null; match: "exact" | "language" | "none" } {
  const want = norm(locale);
  const lang = want.split("-")[0];
  const rank = quality;
  const exact = voices.filter((v) => norm(v.lang) === want).sort((a, b) => rank(a) - rank(b));
  if (exact.length) return { voice: exact[0], match: "exact" };
  const near = voices.filter((v) => norm(v.lang).split("-")[0] === lang);
  const order = lang === "es" ? ["es-us", "es-mx", "es-419"] : ["en-us"];
  near.sort((a, b) => {
    const ia = order.indexOf(norm(a.lang));
    const ib = order.indexOf(norm(b.lang));
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || rank(a) - rank(b);
  });
  return near.length ? { voice: near[0], match: "language" } : { voice: null, match: "none" };
}

/** Money as it should be heard: no ".00" for whole dollars, which voices read out as "punto cero cero". */
export function spokenMoney(cents: number, lang: Lang): string {
  return new Intl.NumberFormat(lang === "es" ? "es-US" : "en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

const MAX_SPOKEN_ITEMS = 4;

/**
 * What the app says after it understood a request. Every amount comes from the items on screen,
 * never from anything the model wrote as text.
 */
export function spokenSummary(opts: {
  lang: Lang;
  kind: "invoice" | "estimate";
  customerName: string;
  items: { description: string; quantity: number; unitPriceCents: number; suggested: boolean }[];
  totalCents: number;
  questions: string[];
}): string {
  const es = opts.lang === "es";
  const doc = opts.kind === "invoice" ? (es ? "factura" : "invoice") : es ? "presupuesto" : "estimate";
  const who = opts.customerName ? (es ? ` para ${opts.customerName}` : ` for ${opts.customerName}`) : "";
  const lines = opts.items.slice(0, MAX_SPOKEN_ITEMS).map((i) => {
    const qty = i.quantity !== 1 ? `${i.quantity} × ` : "";
    const price = spokenMoney(Math.round(i.unitPriceCents), opts.lang);
    const note = i.suggested ? (es ? ", precio sugerido" : ", suggested price") : "";
    return `${i.description}, ${qty}${price}${note}`;
  });
  const more = opts.items.length - lines.length;
  if (more > 0) lines.push(es ? `y ${more} más` : `and ${more} more`);
  const parts = [
    `${es ? "Listo" : "Done"}. ${es ? (opts.kind === "invoice" ? "Una" : "Un") : "An"} ${doc}${who}: ${lines.join("; ")}.`,
    `${es ? "Total" : "Total"}: ${spokenMoney(opts.totalCents, opts.lang)}.`,
  ];
  if (opts.items.some((i) => i.suggested)) {
    parts.push(es ? "Revisa los precios sugeridos antes de seguir." : "Check the suggested prices before you continue.");
  }
  parts.push(...opts.questions);
  return parts.join(" ");
}
