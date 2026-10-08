import { documentsCsv, isOverdue, parseFilters } from "@/lib/doc-list";
import { fail } from "@/lib/http";
import { dict, statusLabel } from "@/lib/i18n";
import { todayIso } from "@/lib/money";
import { getSettings, searchDocuments } from "@/lib/store";
import { routeCtx } from "@/lib/session";

/** The list as filtered on screen, as a spreadsheet for his accountant. */
export async function GET(req: Request) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  try {
    const f = parseFilters(Object.fromEntries(new URL(req.url).searchParams));
    const today = todayIso();
    const { lang } = await getSettings(ctx.accountId);
    const t = dict(lang);
    const { docs } = await searchDocuments(ctx.accountId, f, today, null);
    const csv = documentsCsv(docs, lang, today, (d) => (isOverdue(d, today) ? t.overdue : statusLabel(t, d.status)));
    const name = `${lang === "es" ? "facturas" : "invoices"}-${today}.csv`;
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return fail("export_failed", 500, err);
  }
}
