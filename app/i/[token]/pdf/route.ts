import { todayIso } from "@/lib/money";
import { renderPdf } from "@/lib/pdf";
import { getByToken, getLogo } from "@/lib/store";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const doc = await getByToken(token);
  if (!doc) return new Response("Not found", { status: 404 });
  const pdf = await renderPdf(doc, { logo: await getLogo(), today: todayIso() });
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${doc.number}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
