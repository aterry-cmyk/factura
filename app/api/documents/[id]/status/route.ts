import { fail, readJson } from "@/lib/http";
import { getDocument, setStatus } from "@/lib/store";
import type { DocStatus } from "@/lib/types";

// Which status changes make sense from where. Paid can be undone (a bounced check); void can't.
const ALLOWED: Record<string, { invoice: DocStatus[]; estimate: DocStatus[] }> = {
  draft: { invoice: ["sent", "paid", "void"], estimate: ["sent", "accepted", "void"] },
  sent: { invoice: ["paid", "void"], estimate: ["accepted", "void"] },
  paid: { invoice: ["sent"], estimate: [] },
  accepted: { invoice: [], estimate: ["sent", "void"] },
  void: { invoice: [], estimate: [] },
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await readJson(req)) as { status?: unknown } | null;
  const doc = await getDocument(id);
  if (!doc) return fail("not_found", 404);
  const next = body?.status as DocStatus;
  if (!ALLOWED[doc.status]?.[doc.kind].includes(next)) return fail("not_allowed", 409);
  await setStatus(id, next);
  return Response.json({ ok: true });
}
