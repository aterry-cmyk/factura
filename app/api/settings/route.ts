import { fail, readJson } from "@/lib/http";
import { saveBusiness, setLang, setVoice } from "@/lib/store";
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
  if (body.business) {
    const errors: string[] = [];
    const business = validateBusiness(body.business, errors);
    if (errors.length) return Response.json({ error: "invalid", errors }, { status: 400 });
    await saveBusiness(ctx.accountId, business);
  }
  return Response.json({ ok: true });
}
