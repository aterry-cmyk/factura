import { fail } from "@/lib/http";
import { todayIso } from "@/lib/money";
import { renderPdf } from "@/lib/pdf";
import { getDocument, getLogo } from "@/lib/store";
import { routeCtx } from "@/lib/session";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const doc = await getDocument(ctx.accountId, id);
  if (!doc) return fail("not_found", 404);
  const pdf = await renderPdf(doc, { logo: await getLogo(ctx.accountId), today: todayIso() });
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${doc.number}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
