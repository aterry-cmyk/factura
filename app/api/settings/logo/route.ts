import { fail } from "@/lib/http";
import { MAX_LOGO_BYTES, logoType } from "@/lib/logo";
import { getLogo, setLogo } from "@/lib/store";
import { routeCtx } from "@/lib/session";

export async function GET() {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  const logo = await getLogo(ctx.accountId);
  if (!logo) return fail("not_found", 404);
  return new Response(new Uint8Array(logo.bytes), { headers: { "Content-Type": logo.type, "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  const form = await req.formData().catch(() => null);
  const file = form?.get("logo");
  if (!(file instanceof File)) return fail("no_file", 400);
  if (file.size > MAX_LOGO_BYTES) return fail("too_big", 400);
  const bytes = Buffer.from(await file.arrayBuffer());
  const type = logoType(bytes);
  if (!type) return fail("bad_type", 400);
  await setLogo(ctx.accountId, { bytes, type });
  return Response.json({ ok: true });
}

export async function DELETE() {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  await setLogo(ctx.accountId, null);
  return Response.json({ ok: true });
}
