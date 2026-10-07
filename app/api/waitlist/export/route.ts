import { fail } from "@/lib/http";
import { getSettings, searchWaitlist } from "@/lib/store";
import { parseWaitlistFilters, waitlistCsv } from "@/lib/waitlist";

/** The waitlist as filtered on screen, as a spreadsheet. Owner only (proxy.ts). */
export async function GET(req: Request) {
  try {
    const f = parseWaitlistFilters(Object.fromEntries(new URL(req.url).searchParams));
    const { lang } = await getSettings();
    const { entries } = await searchWaitlist(f, null);
    const day = new Date().toISOString().slice(0, 10);
    return new Response(waitlistCsv(entries, lang), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${lang === "es" ? "lista-de-espera" : "waitlist"}-${day}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return fail("export_failed", 500, err);
  }
}
