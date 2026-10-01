import { fail } from "@/lib/http";
import { MAX_LOGO_BYTES, logoType } from "@/lib/logo";
import { getLogo, setLogo } from "@/lib/store";

export async function GET() {
  const logo = await getLogo();
  if (!logo) return fail("not_found", 404);
  return new Response(new Uint8Array(logo.bytes), { headers: { "Content-Type": logo.type, "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("logo");
  if (!(file instanceof File)) return fail("no_file", 400);
  if (file.size > MAX_LOGO_BYTES) return fail("too_big", 400);
  const bytes = Buffer.from(await file.arrayBuffer());
  const type = logoType(bytes);
  if (!type) return fail("bad_type", 400);
  await setLogo({ bytes, type });
  return Response.json({ ok: true });
}

export async function DELETE() {
  await setLogo(null);
  return Response.json({ ok: true });
}
