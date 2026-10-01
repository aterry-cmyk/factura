import { fail, readJson } from "@/lib/http";
import { saveBusiness, setLang, setVoice } from "@/lib/store";
import { validateBusiness } from "@/lib/validate";
import { isCountry } from "@/lib/voice";

export async function POST(req: Request) {
  const body = (await readJson(req)) as Record<string, unknown> | null;
  if (!body) return fail("invalid", 400);
  if (body.lang === "es" || body.lang === "en") await setLang(body.lang);
  if (body.country !== undefined && !isCountry(body.country)) return fail("invalid", 400);
  if (body.voiceOn !== undefined && typeof body.voiceOn !== "boolean") return fail("invalid", 400);
  if (body.country !== undefined || body.voiceOn !== undefined) {
    await setVoice({ country: body.country as string | undefined, voiceOn: body.voiceOn as boolean | undefined });
  }
  if (body.business) {
    const errors: string[] = [];
    const business = validateBusiness(body.business, errors);
    if (errors.length) return Response.json({ error: "invalid", errors }, { status: 400 });
    await saveBusiness(business);
  }
  return Response.json({ ok: true });
}
