import { fail, readJson } from "@/lib/http";
import { saveBusiness, setLang, setPricing, setVoice } from "@/lib/store";
import { validateBusiness } from "@/lib/validate";
import { isCountry, isGender } from "@/lib/voice";
import { routeCtx } from "@/lib/session";

export async function POST(req: Request) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  const body = (await readJson(req)) as Record<string, unknown> | null;
  if (!body) return fail("invalid", 400);
  if (body.lang === "es" || body.lang === "en") await setLang(ctx.accountId, body.lang);
  if (body.country !== undefined && !isCountry(body.country)) return fail("invalid", 400);
  if (body.voiceOn !== undefined && typeof body.voiceOn !== "boolean") return fail("invalid", 400);
  if (body.voiceGender !== undefined && !isGender(body.voiceGender)) return fail("invalid", 400);
  if (body.country !== undefined || body.voiceOn !== undefined || body.voiceGender !== undefined) {
    await setVoice(ctx.accountId, {
      country: body.country as string | undefined,
      voiceOn: body.voiceOn as boolean | undefined,
      voiceGender: body.voiceGender as "female" | "male" | undefined,
    });
  }
  if (body.pricing && typeof body.pricing === "object") {
    const p = body.pricing as Record<string, unknown>;
    const markup = Number(p.markupPercent ?? 0), contingency = Number(p.contingencyPercent ?? 0);
    if (!(markup >= 0 && markup <= 300) || !(contingency >= 0 && contingency <= 100)) return Response.json({ error: "invalid", errors: ["pricing: markup 0–300%, contingency 0–100%"] }, { status: 400 });
    await setPricing(ctx.accountId, { markupPercent: Math.round(markup * 100) / 100, contingencyPercent: Math.round(contingency * 100) / 100 });
  }
  if (body.business) {
    const errors: string[] = [];
    const business = validateBusiness(body.business, errors);
    if (errors.length) return Response.json({ error: "invalid", errors }, { status: 400 });
    await saveBusiness(ctx.accountId, business);
  }
  return Response.json({ ok: true });
}
