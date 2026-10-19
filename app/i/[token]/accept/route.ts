import { cleanName } from "@/lib/auth";
import { fail, readJson } from "@/lib/http";
import { acceptByToken } from "@/lib/store";

/** The customer accepts an estimate from their link, with their name. No sign-in: the link is the key. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = (await readJson(req)) as { name?: unknown } | null;
  const name = cleanName(body?.name);
  if (!name) return fail("name_missing", 400);
  const doc = await acceptByToken(token, name);
  if (!doc) return fail("not_acceptable", 409);
  return Response.json({ ok: true });
}
