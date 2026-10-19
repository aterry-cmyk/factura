import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { cleanReading, photoType, readPhotos, readSystemPrompt } from "@/lib/ai/read-photo";
import type { AiClient } from "@/lib/ai/parse";

const tool = (input: unknown) =>
  ({ usage: { input_tokens: 500, output_tokens: 20 }, content: [{ type: "tool_use", id: "t1", name: "record_reading", input }] }) as unknown as Anthropic.Message;
const prose = { usage: { input_tokens: 100, output_tokens: 5 }, content: [{ type: "text", text: "It's a list." }] } as unknown as Anthropic.Message;
const script = (...answers: Anthropic.Message[]) => {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: AiClient = { create: async (p) => { calls.push(p); return answers.shift()!; } };
  return { client, calls };
};
const PHOTO = { type: "image/jpeg" as const, base64: "abc" };

describe("photo types", () => {
  it("knows images by their first bytes", () => {
    expect(photoType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(photoType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(photoType(new TextEncoder().encode("RIFF....WEBPVP8 "))).toBe("image/webp");
    expect(photoType(new TextEncoder().encode("%PDF-1.7 hello"))).toBeNull();
  });
});

describe("reading photos", () => {
  it("sends the photos, asks to copy only what's written, and returns the text", async () => {
    const { client, calls } = script(tool({ readable: true, text: "Juan Pérez\nPintar cocina 2200", kind_hint: "estimate" }));
    const r = await readPhotos({ photos: [PHOTO, PHOTO], lang: "es", client });
    expect(r).toEqual({ ok: true, text: "Juan Pérez\nPintar cocina 2200", kindHint: "estimate", usage: { input: 500, output: 20 } });
    const content = calls[0].messages[0].content as Anthropic.ContentBlockParam[];
    expect(content.filter((b) => b.type === "image")).toHaveLength(2);
    expect(readSystemPrompt("es")).toMatch(/never write a number that isn't in the photo/);
    expect(readSystemPrompt("es")).toMatch(/Don't describe the photo/);
  });

  it("says unreadable instead of guessing when there's nothing written", async () => {
    const { client } = script(tool({ readable: false, text: "A kitchen with old cabinets", kind_hint: "unknown" }));
    expect(await readPhotos({ photos: [PHOTO], lang: "es", client })).toEqual({ ok: false, error: "unreadable", usage: { input: 500, output: 20 } });
  });

  it("asks once more for the tool, then gives up clearly", async () => {
    const ok = script(prose, tool({ readable: true, text: "Cerca 750", kind_hint: "invoice" }));
    expect(await readPhotos({ photos: [PHOTO], lang: "en", client: ok.client })).toMatchObject({ ok: true, text: "Cerca 750", kindHint: "invoice" });
    expect(ok.calls).toHaveLength(2);
    const bad = script(prose, prose);
    expect(await readPhotos({ photos: [PHOTO], lang: "en", client: bad.client })).toEqual({ ok: false, error: "failed", usage: { input: 200, output: 10 } });
  });

  it("keeps only plain text of a sane length", () => {
    expect(cleanReading("<b>Pintar</b> cocina\n\n\n\n2200\u0007")).toBe("Pintar cocina\n\n2200");
    expect(cleanReading("x".repeat(5000))).toHaveLength(3000);
    expect(cleanReading(42)).toBe("");
  });
});
