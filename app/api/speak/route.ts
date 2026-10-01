import { azureConfigured, MAX_SPEAK_CHARS, synthesize } from "@/lib/azure-speech";
import { fail, readJson } from "@/lib/http";
import { getSettings } from "@/lib/store";
import { azureVoiceFor } from "@/lib/voice";

export const maxDuration = 30;

/**
 * The owner's text in his country's natural voice, as MP3. The voice comes from his saved settings,
 * never from the request. 501 without Azure: the browser then uses the device's own voice.
 */
export async function POST(req: Request) {
  if (!azureConfigured()) return fail("voice_setup", 501);
  const body = (await readJson(req)) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return fail("empty", 400);
  if (text.length > MAX_SPEAK_CHARS) return fail("too_long", 400);
  const s = await getSettings();
  const out = await synthesize(text, azureVoiceFor(s.country, s.lang, s.voiceGender));
  if (!out.ok) return fail("voice_failed", 502, out.detail);
  return new Response(out.audio, {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, no-store" },
  });
}
