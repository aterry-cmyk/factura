import { blockForCtx, recordUsage } from "@/lib/accounts";
import { previewPrompt } from "@/lib/estimator/catalog";
import { falConfigured, previewPicture } from "@/lib/estimator/images";
import { asChoices, asKeys, asSpace, decodePhoto } from "@/lib/estimator/request";
import { fail, readJson } from "@/lib/http";
import { routeCtx } from "@/lib/session";

export const maxDuration = 60;

/** The customer's photo, remodeled with the choices made. The prompt is built only from catalog phrases. */
export async function POST(req: Request) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  if (!falConfigured()) return fail("images_setup", 501);
  const block = await blockForCtx(ctx, "ai");
  if (block) return Response.json({ error: block }, { status: 402 });
  const body = (await readJson(req)) as { photo?: unknown; space?: unknown; design?: unknown; priced?: unknown } | null;
  const photo = decodePhoto(body?.photo), space = asSpace(body?.space);
  if (!photo || !space) return fail("photo_type", 400);
  try {
    const url = await previewPicture(photo.dataUrl, previewPrompt(space, asChoices(body?.design), asKeys(body?.priced)));
    await recordUsage(ctx.accountId, "ai_request", 1);
    return Response.json({ url });
  } catch (err) {
    return fail("preview_failed", 502, err);
  }
}
