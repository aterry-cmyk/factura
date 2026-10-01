import { aiConfigured } from "@/lib/ai/config";
import { parseRequest } from "@/lib/ai/parse";
import { fail, readJson } from "@/lib/http";
import { todayIso } from "@/lib/money";
import { catalog, getSettings } from "@/lib/store";

export const maxDuration = 60;

export async function POST(req: Request) {
  if (!aiConfigured()) return fail("ai_setup", 501);
  const body = (await readJson(req)) as { transcript?: unknown } | null;
  const transcript = typeof body?.transcript === "string" ? body.transcript : "";
  if (transcript.trim().length < 3) return fail("empty", 400);
  try {
    const settings = await getSettings();
    const result = await parseRequest({
      transcript,
      lang: settings.lang,
      catalog: await catalog(),
      today: todayIso(),
    });
    if (!result.ok) return fail("not_understood", 422, result.error);
    return Response.json(result.value);
  } catch (err) {
    return fail("ai_failed", 502, err);
  }
}
