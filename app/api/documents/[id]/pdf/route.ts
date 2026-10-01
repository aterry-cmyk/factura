import { fail } from "@/lib/http";
import { todayIso } from "@/lib/money";
import { renderPdf } from "@/lib/pdf";
import { getDocument, getLogo } from "@/lib/store";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await getDocument(id);
  if (!doc) return fail("not_found", 404);
  const pdf = await renderPdf(doc, { logo: await getLogo(), today: todayIso() });
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${doc.number}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
