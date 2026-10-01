import { afterEach, describe, expect, it, vi } from "vitest";
import { azureConfigured, MAX_SPEAK_CHARS, ssml, synthesize } from "@/lib/azure-speech";
import { azureVoiceFor, azureVoiceLabel, COUNTRIES } from "@/lib/voice";

afterEach(() => vi.unstubAllEnvs());

describe("Azure voices", () => {
  it("every country has a woman's and a man's natural voice in its own Spanish", () => {
    for (const c of COUNTRIES) {
      for (const g of ["female", "male"] as const) {
        const v = azureVoiceFor(c.code, "es", g);
        expect(v.locale).toBe(c.locale);
        expect(v.name).toMatch(new RegExp(`^${c.locale}-[A-Z][a-z]+Neural$`));
      }
      expect(c.azure.female).not.toBe(c.azure.male);
    }
  });

  it("picks by country and choice, English for the app in English, US Spanish for an unknown country", () => {
    expect(azureVoiceFor("MX", "es", "female")).toEqual({ name: "es-MX-DaliaNeural", locale: "es-MX" });
    expect(azureVoiceFor("PR", "es", "male")).toEqual({ name: "es-PR-VictorNeural", locale: "es-PR" });
    expect(azureVoiceFor("MX", "en", "male")).toEqual({ name: "en-US-GuyNeural", locale: "en-US" });
    expect(azureVoiceFor("ZZ", "es", "female").name).toBe("es-US-PalomaNeural");
    expect(azureVoiceLabel("es-CO-SalomeNeural")).toBe("Salome");
  });
});

describe("SSML", () => {
  it("escapes what is read so text can't change the markup", () => {
    const out = ssml(`Juan & Ana <voice name='x'>"$2,200"</voice>`, { name: "es-MX-DaliaNeural", locale: "es-MX" });
    expect(out).toBe(
      "<speak version='1.0' xml:lang='es-MX'><voice xml:lang='es-MX' name='es-MX-DaliaNeural'>Juan &amp; Ana &lt;voice name=&apos;x&apos;&gt;&quot;$2,200&quot;&lt;/voice&gt;</voice></speak>",
    );
  });

  it("drops control characters and caps the length", () => {
    const out = ssml("a\u0000b" + "c".repeat(MAX_SPEAK_CHARS + 50), { name: "v", locale: "es-US" });
    expect(out).toContain("a b");
    expect(out.length).toBeLessThan(MAX_SPEAK_CHARS + 120);
  });
});

describe("synthesize", () => {
  const voice = { name: "es-MX-DaliaNeural", locale: "es-MX" };

  it("is configured only with a key and a plain region name", () => {
    vi.stubEnv("AZURE_SPEECH_KEY", "k");
    vi.stubEnv("AZURE_SPEECH_REGION", "eastus");
    expect(azureConfigured()).toBe(true);
    vi.stubEnv("AZURE_SPEECH_REGION", "east.us/evil");
    expect(azureConfigured()).toBe(false);
    vi.stubEnv("AZURE_SPEECH_KEY", "");
    vi.stubEnv("AZURE_SPEECH_REGION", "eastus");
    expect(azureConfigured()).toBe(false);
  });

  it("calls the region's endpoint with the key and asks for MP3", async () => {
    vi.stubEnv("AZURE_SPEECH_KEY", "secret");
    vi.stubEnv("AZURE_SPEECH_REGION", "eastus");
    vi.stubEnv("AZURE_SPEECH_URL", "");
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const out = await synthesize("Hola", voice, fetchImpl as unknown as typeof fetch);
    expect(out.ok && new Uint8Array(out.audio)).toEqual(new Uint8Array([1, 2, 3]));
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://eastus.tts.speech.microsoft.com/cognitiveservices/v1");
    const h = init.headers as Record<string, string>;
    expect(h["Ocp-Apim-Subscription-Key"]).toBe("secret");
    expect(h["Content-Type"]).toBe("application/ssml+xml");
    expect(h["X-Microsoft-OutputFormat"]).toBe("audio-24khz-48kbitrate-mono-mp3");
    expect(String(init.body)).toContain("name='es-MX-DaliaNeural'>Hola<");
  });

  it("explains a refused key, a used-up quota and an unreachable service", async () => {
    vi.stubEnv("AZURE_SPEECH_KEY", "k");
    vi.stubEnv("AZURE_SPEECH_REGION", "eastus");
    const status = (s: number) => vi.fn(async () => new Response("no", { status: s })) as unknown as typeof fetch;
    expect(await synthesize("x", voice, status(401))).toEqual({ ok: false, status: 401, detail: "Azure Speech 401: the key or region is wrong" });
    expect(await synthesize("x", voice, status(429))).toMatchObject({ ok: false, detail: expect.stringContaining("quota") });
    const down = vi.fn(async () => {
      throw new Error("ENOTFOUND");
    }) as unknown as typeof fetch;
    expect(await synthesize("x", voice, down)).toEqual({ ok: false, status: 0, detail: "Azure Speech unreachable: ENOTFOUND" });
  });
});
