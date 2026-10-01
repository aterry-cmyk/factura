import { fail, readJson } from "@/lib/http";
import { saveBusiness, setLang } from "@/lib/store";
import { validateBusiness } from "@/lib/validate";

export async function POST(req: Request) {
  const body = (await readJson(req)) as Record<string, unknown> | null;
  if (!body) return fail("invalid", 400);
  if (body.lang === "es" || body.lang === "en") await setLang(body.lang);
  if (body.business) {
    const errors: string[] = [];
    const business = validateBusiness(body.business, errors);
    if (errors.length) return Response.json({ error: "invalid", errors }, { status: 400 });
    await saveBusiness(business);
  }
  return Response.json({ ok: true });
}
