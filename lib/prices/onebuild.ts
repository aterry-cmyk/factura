// 1build's Cost Data API: live material and labor rates by county, searched by zip code. Used
// first for prices when ONEBUILD_API_KEY is set; otherwise the app says so and falls back to a
// web search. Every price returned carries the county it was priced for and the date.
// Reference: https://developer.1build.com/1build-api-reference (query `sources`).

export const onebuildConfigured = (): boolean => Boolean(process.env.ONEBUILD_API_KEY);
const endpoint = () => process.env.ONEBUILD_API_URL || "https://gateway-external.1build.com/";

export interface RateOption {
  id: string;
  name: string;
  unit: string;
  materialCents: number;
  laborCents: number;
  burdenedLaborCents: number;
  unitRateCents: number;
  url: string;
  county: string;
  state: string;
}

const QUERY = `query sources($input: SourceSearchInput!) {
  sources(input: $input) {
    nodes { id name uom materialRateUsdCents laborRateUsdCents burdenedLaborRateUsdCents calculatedUnitRateUsdCents externalProductUrl }
    dataLocation { countyName stateName }
  }
}`;

export type OnebuildResult = { ok: true; options: RateOption[] } | { ok: false; error: "setup" | "failed"; detail?: string };

/** Material (or labor) rates for a search term near a zip code, up to `limit` results. */
export async function searchOnebuild(input: { query: string; zip: string; state: string; type?: "MATERIAL" | "LABOR"; limit?: number }, f: typeof fetch = fetch): Promise<OnebuildResult> {
  const key = process.env.ONEBUILD_API_KEY;
  if (!key) return { ok: false, error: "setup" };
  const variables = {
    input: {
      sourceType: input.type ?? "MATERIAL",
      searchTerm: input.query.slice(0, 200),
      ...(input.zip ? { zipcode: input.zip } : {}),
      ...(input.state && !input.zip ? { state: input.state } : {}),
      page: { limit: Math.min(10, Math.max(1, input.limit ?? 5)) },
    },
  };
  try {
    const res = await f(endpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "1build-api-key": key },
      body: JSON.stringify({ query: QUERY, variables }),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => ({}))) as { data?: { sources?: { nodes?: Record<string, unknown>[]; dataLocation?: { countyName?: string; stateName?: string } } }; errors?: { message?: string }[] };
    if (!res.ok || json.errors?.length) return { ok: false, error: "failed", detail: `1build ${res.status}: ${json.errors?.[0]?.message ?? "error"}` };
    const loc = json.data?.sources?.dataLocation ?? {};
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);
    const s = (v: unknown) => (typeof v === "string" ? v.slice(0, 300) : "");
    const options = (json.data?.sources?.nodes ?? []).flatMap((node) => {
      const name = s(node.name);
      const unitRateCents = n(node.calculatedUnitRateUsdCents);
      if (!name || !unitRateCents) return [];
      return [{
        id: s(node.id), name, unit: s(node.uom) || "EA", materialCents: n(node.materialRateUsdCents), laborCents: n(node.laborRateUsdCents),
        burdenedLaborCents: n(node.burdenedLaborRateUsdCents), unitRateCents, url: /^https?:/.test(s(node.externalProductUrl)) ? s(node.externalProductUrl) : "",
        county: s(loc.countyName), state: s(loc.stateName),
      }];
    });
    return { ok: true, options };
  } catch (err) {
    return { ok: false, error: "failed", detail: err instanceof Error ? err.message : String(err) };
  }
}
