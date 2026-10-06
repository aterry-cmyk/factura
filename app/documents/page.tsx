import Link from "next/link";
import { DocumentsTable } from "@/components/DocumentsTable";
import { Header } from "@/components/Header";
import { filtersQuery, isOverdue, PAGE_SIZE, parseFilters, type StatusFilter } from "@/lib/doc-list";
import { dict, statusLabel } from "@/lib/i18n";
import { formatMoney, todayIso } from "@/lib/money";
import { documentTotals, getSettings, searchDocuments } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const f = parseFilters(await searchParams);
  const today = todayIso();
  const [settings, totals, found] = await Promise.all([
    getSettings(),
    documentTotals(today),
    searchDocuments(f, today, { limit: PAGE_SIZE, offset: (f.page - 1) * PAGE_SIZE }),
  ]);
  const lang = settings.lang;
  const t = dict(lang);
  const pages = Math.max(1, Math.ceil(found.total / PAGE_SIZE));
  const filtered = f.q || f.status !== "all" || f.kind !== "all" || f.from || f.to;

  const statusChips: [StatusFilter, string][] = [
    ["all", t.filterAll], ["draft", t.filterDrafts], ["sent", t.filterSent], ["overdue", t.filterOverdue],
    ["paid", t.filterPaid], ["void", t.filterVoid], ["accepted", t.filterAccepted],
  ];
  const tiles = [
    { label: t.owed, value: totals.owed.cents, sub: `${t.docsCount(totals.owed.count)} · ${t.withLateFees}`, href: filtersQuery(f, { status: "sent", kind: "invoice" }), tone: "" },
    { label: t.overdueTotal, value: totals.overdue.cents, sub: t.docsCount(totals.overdue.count), href: filtersQuery(f, { status: "overdue" }), tone: totals.overdue.count ? "bad" : "" },
    { label: t.paidThisMonth, value: totals.paidThisMonth.cents, sub: t.docsCount(totals.paidThisMonth.count), href: filtersQuery(f, { status: "paid", kind: "invoice" }), tone: "good" },
  ];

  return (
    <main className="wrap wide">
      <Header lang={lang} settingsLabel={t.settings} signOutLabel={t.signOut} />
      <h1>{t.allDocsTitle}</h1>

      <section className="tiles" data-testid="totals">
        {tiles.map((x) => (
          <Link key={x.label} href={`/documents${x.href}`} className={`tile ${x.tone}`}>
            <span className="muted small">{x.label}</span>
            <span className="tile-value">{formatMoney(x.value, lang)}</span>
            <span className="muted small">{x.sub}</span>
          </Link>
        ))}
        <Link href={`/documents${filtersQuery(f, { status: "draft" })}`} className="tile">
          <span className="muted small">{t.draftsCount}</span>
          <span className="tile-value">{totals.drafts}</span>
          <span className="muted small">&nbsp;</span>
        </Link>
      </section>

      <section className="card stack">
        <form className="filters" method="get" action="/documents">
          <input type="search" name="q" defaultValue={f.q} placeholder={t.searchPlaceholder} aria-label={t.searchPlaceholder} className="grow" />
          <select name="kind" defaultValue={f.kind} aria-label={t.kindAll}>
            <option value="all">{t.kindAll}</option>
            <option value="invoice">{t.kindInvoices}</option>
            <option value="estimate">{t.kindEstimates}</option>
          </select>
          <label className="date">{t.dateFrom}<input type="date" name="from" defaultValue={f.from ?? ""} /></label>
          <label className="date">{t.dateTo}<input type="date" name="to" defaultValue={f.to ?? ""} /></label>
          {f.status !== "all" && <input type="hidden" name="status" value={f.status} />}
          <button className="btn primary small" type="submit">{t.applyFilters}</button>
        </form>
        <div className="chips" role="group" aria-label="Status">
          {statusChips.map(([s, label]) => (
            <Link key={s} href={`/documents${filtersQuery(f, { status: s })}`} className="chip" aria-pressed={f.status === s}>
              {label}
            </Link>
          ))}
        </div>
        <div className="row">
          <span className="muted small grow" data-testid="count">{t.docsCount(found.total)}</span>
          {filtered && <Link href="/documents" className="btn small ghost">{t.clearFilters}</Link>}
          <a href={`/api/documents/export${filtersQuery(f, { page: 1 })}`} className="btn small" download>⬇ {t.exportCsv}</a>
        </div>
      </section>

      {found.docs.length === 0 ? (
        <section className="card"><p className="muted" style={{ margin: 0 }}>{filtered ? t.noMatches : t.nothingYet}</p></section>
      ) : (
        <DocumentsTable
          lang={lang}
          docs={found.docs.map((d) => ({
            id: d.id,
            number: d.number,
            kind: d.kind,
            status: d.status,
            customer: d.customer.company ? `${d.customer.name} · ${d.customer.company}` : d.customer.name,
            summary: d.items.map((i) => i.description).join(", "),
            issueDate: d.issueDate,
            dueDate: d.dueDate,
            totalCents: d.totalCents,
            overdue: isOverdue(d, today),
            statusText: isOverdue(d, today) ? t.overdue : statusLabel(t, d.status),
          }))}
        />
      )}

      {pages > 1 && (
        <nav className="row" style={{ justifyContent: "space-between", marginTop: 12 }}>
          {f.page > 1 ? <Link className="btn small" href={`/documents${filtersQuery(f, { page: f.page - 1 })}`}>← {t.prevPage}</Link> : <span />}
          <span className="muted small">{t.pageOf(f.page, pages)}</span>
          {f.page < pages ? <Link className="btn small" href={`/documents${filtersQuery(f, { page: f.page + 1 })}`}>{t.nextPage} →</Link> : <span />}
        </nav>
      )}
    </main>
  );
}
