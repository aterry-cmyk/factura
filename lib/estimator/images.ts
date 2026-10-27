// fal.ai, for the estimator's pictures: example pictures for each choice (from fixed prompts) and the
// preview of the remodel made from the customer's own photo. Without FAL_KEY the screens say
// "setup needed" and nothing is faked. Each call has a fallback model, so one model being renamed or
// busy doesn't stop the estimator; a rejected key stops at once.

export const falConfigured = (): boolean => Boolean(process.env.FAL_KEY);

type Fetch = typeof fetch;
type Attempt = { model: string; input: Record<string, unknown> };

export class FalError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function run(f: Fetch, { model, input }: Attempt, ms: number): Promise<string> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await f(`${process.env.FAL_API_URL || "https://fal.run"}/${model}`, {
      method: "POST",
      signal: ctl.signal,
      headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const text = await r.text();
    if (!r.ok) throw new FalError(`${model} ${r.status}: ${text.slice(0, 300)}`, r.status);
    const j = JSON.parse(text) as { images?: { url?: string }[]; image?: { url?: string } };
    return j.images?.[0]?.url ?? j.image?.url ?? "";
  } finally {
    clearTimeout(t);
  }
}

async function first(attempts: Attempt[], ms: number, f: Fetch): Promise<string> {
  const errors: string[] = [];
  for (const a of attempts) {
    try {
      const url = await run(f, a, ms);
      if (isFalUrl(url)) return url;
      errors.push(`${a.model}: no image`);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
      if (err instanceof FalError && err.status === 401) break;
    }
  }
  throw new Error(`fal failed: ${errors.join(" | ")}`);
}

/** Only pictures fal itself made are ever shown or passed on. */
export function isFalUrl(v: unknown): v is string {
  return typeof v === "string" && /^https:\/\/[a-z0-9.-]+\.fal\.media\/[\w./-]+$/i.test(v);
}

/** An example picture for one option, from a fixed description. */
export function examplePicture(prompt: string, f: Fetch = fetch): Promise<string> {
  return first([
    { model: "fal-ai/flux/schnell", input: { prompt, image_size: "landscape_4_3", num_inference_steps: 4, num_images: 1, enable_safety_checker: true } },
    { model: "fal-ai/flux/dev", input: { prompt, image_size: "landscape_4_3", num_inference_steps: 20, num_images: 1 } },
  ], 30_000, f);
}

/** The customer's photo, remodeled: same room and camera, new finishes. */
export function previewPicture(imageDataUrl: string, prompt: string, f: Fetch = fetch): Promise<string> {
  return first([
    { model: "fal-ai/nano-banana/edit", input: { prompt, image_urls: [imageDataUrl], num_images: 1, output_format: "jpeg" } },
    { model: "fal-ai/flux-pro/kontext", input: { prompt, image_url: imageDataUrl, output_format: "jpeg", guidance_scale: 3.5 } },
  ], 58_000, f);
}
