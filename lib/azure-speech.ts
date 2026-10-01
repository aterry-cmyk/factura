// Natural voices through Azure Speech's text-to-speech REST API (no SDK). Without a key the app
// uses the device's own voice and Settings says Azure isn't connected; nothing is faked.

export const azureConfigured = (): boolean =>
  Boolean(process.env.AZURE_SPEECH_KEY && /^[a-z0-9]+$/.test(process.env.AZURE_SPEECH_REGION ?? ""));

/** Longest text spoken in one request: the summary of a long invoice fits easily. */
export const MAX_SPEAK_CHARS = 1500;

const escapeXml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);

/** The SSML Azure reads. The voice name comes from our own list, never from the browser. */
export function ssml(text: string, voice: { name: string; locale: string }): string {
  const clean = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ").slice(0, MAX_SPEAK_CHARS);
  return `<speak version='1.0' xml:lang='${voice.locale}'><voice xml:lang='${voice.locale}' name='${voice.name}'>${escapeXml(clean)}</voice></speak>`;
}

export type SpeakOutcome = { ok: true; audio: ArrayBuffer } | { ok: false; status: number; detail: string };

export async function synthesize(text: string, voice: { name: string; locale: string }, fetchImpl: typeof fetch = fetch): Promise<SpeakOutcome> {
  const region = process.env.AZURE_SPEECH_REGION!;
  const base = process.env.AZURE_SPEECH_URL || `https://${region}.tts.speech.microsoft.com`;
  try {
    const res = await fetchImpl(`${base}/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": process.env.AZURE_SPEECH_KEY!,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "factura",
      },
      body: ssml(text, voice),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const why =
        res.status === 401 ? "the key or region is wrong" : res.status === 429 ? "too many requests or the monthly quota is used up" : "the service failed";
      return { ok: false, status: res.status, detail: `Azure Speech ${res.status}: ${why}` };
    }
    return { ok: true, audio: await res.arrayBuffer() };
  } catch (err) {
    return { ok: false, status: 0, detail: `Azure Speech unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
}
