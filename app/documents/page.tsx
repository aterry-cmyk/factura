import Link from "next/link";
import { DocumentsTable } from "@/components/DocumentsTable";
import { Header } from "@/components/Header";
import { filtersQuery, isOverdue, PAGE_SIZE, parseFilters, type StatusFilter } from "@/lib/doc-list";
import { dict, statusLabel } from "@/lib/i18n";
import { formatMoney, todayIso } from "@/lib/money";
import { documentTotals, estimateMonths, estimateTotals, getSettings, invoiceMonths, openInvoices, searchDocuments } from "@/lib/store";
import { acceptanceRate, aging, byMonth, monthKeys, topOwing } from "@/lib/dashboard";
import { MonthBars } from "@/components/MonthBars";
import { headerUser, pageCtx } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const f = parseFilters(await searchParams);
  const ctx = await pageCtx();
  const today = todayIso();
  const months = monthKeys(today, 6);
  const since = `${months[0]}-01`;
  const [settings, totals, found, invMonths, estMonths, est, open] = await Promise.all([
    getSettings(ctx.accountId),
    documentTotals(ctx.accountId, today),
    searchDocuments(ctx.accountId, f, today, { limit: PAGE_SIZE, offset: (f.page - 1) * PAGE_SIZE }),
    invoiceMonths(ctx.accountId, since),
    estimateMonths(ctx.accountId, since),
    estimateTotals(ctx.accountId, today),
    openInvoices(ctx.accountId),
  ]);
  const lang = settings.lang;
  const es = lang === "es";
  const t = dict(lang);
  const money = (c: number) => formatMoney(c, lang);
  const pages = Math.max(1, Math.ceil(found.total / PAGE_SIZE));
  const filtered = f.q || f.status !== "all" || f.from || f.to;
  const tab = f.kind;

  const statusChips: [StatusFilter, string][] =
    tab === "estimate"
      ? [["all", t.filterAll], ["draft", t.filterDrafts], ["sent", es ? "Enviados" : "Sent"], ["accepted", t.filterAccepted], ["void", es ? "Rechazados / anulados" : "Declined / void"]]
      : tab === "invoice"
        ? [["all", t.filterAll], ["draft", t.filterDrafts], ["sent", t.filterSent], ["overdue", t.filterOverdue], ["paid", t.filterPaid], ["void", t.filterVoid]]
        : [["all", t.filterAll], ["draft", t.filterDrafts], ["sent", t.filterSent], ["overdue", t.filterOverdue], ["paid", t.filterPaid], ["void", t.filterVoid], ["accepted", t.filterAccepted]];
  const tiles = [
    { label: t.owed, value: money(totals.owed.cents), sub: `${t.docsCount(totals.owed.count)} · ${t.withLateFees}`, href: filtersQuery(f, { status: "sent", kind: "invoice" }), tone: "" },
    { label: t.overdueTotal, value: money(totals.overdue.cents), sub: t.docsCount(totals.overdue.count), href: filtersQuery(f, { status: "overdue", kind: "invoice" }), tone: totals.overdue.count ? "bad" : "" },
    { label: t.paidThisMonth, value: money(totals.paidThisMonth.cents), sub: t.docsCount(totals.paidThisMonth.count), href: filtersQuery(f, { status: "paid", kind: "invoice" }), tone: "good" },
    { label: t.draftsCount, value: String(totals.drafts), sub: "\u00a0", href: filtersQuery(f, { status: "draft" }), tone: "" },
  ];
  const rate = acceptanceRate(est.accepted90, est.declined90);
  const estTiles = [
    { label: es ? "Estimados abiertos" : "Open estimates", value: money(est.open.cents), sub: es ? `${est.open.count} esperando respuesta` : `${est.open.count} awaiting an answer`, href: filtersQuery(f, { kind: "estimate", status: "sent" }), tone: "" },
    { label: es ? "Aceptados este mes" : "Accepted this month", value: money(est.acceptedThisMonth.cents), sub: es ? `${est.acceptedThisMonth.count} ${est.acceptedThisMonth.count === 1 ? "estimado" : "estimados"}` : `${est.acceptedThisMonth.count} ${est.acceptedThisMonth.count === 1 ? "estimate" : "estimates"}`, href: filtersQuery(f, { kind: "estimate", status: "accepted" }), tone: "good" },
    { label: es ? "Tasa de aceptación" : "Acceptance rate", value: rate === null ? "—" : `${rate}%`, sub: es ? `últimos 90 días · ${est.accepted90} sí, ${est.declined90} no` : `last 90 days · ${est.accepted90} yes, ${est.declined90} no`, href: filtersQuery(f, { kind: "estimate" }), tone: "" },
    { label: es ? "Pasados a factura" : "Turned into invoices", value: String(est.converted90), sub: es ? "últimos 90 días" : "last 90 days", href: filtersQuery(f, { kind: "invoice" }), tone: "" },
  ];
  const ages = aging(open, today);
  const owing = topOwing(open, today, 5);
  const inv = byMonth(months, invMonths, { billed: 0, collected: 0, online: 0 });
  const estM = byMonth(months, estMonths, { sent: 0, accepted: 0 });
  const tabs: [typeof tab, string][] = [["all", es ? "Resumen" : "Overview"], ["invoice", es ? "Facturas" : "Invoices"], ["estimate", es ? "Estimados" : "Estimates"]];

  return (
    <main className="wrap wide">
      <Header lang={lang} user={headerUser(ctx)} />
      <div className="dash-head">
        <h1>{t.allDocsTitle}</h1>
        <div className="row">
          <a className="btn" href={`/api/documents/export${filtersQuery(f, { page: 1 })}`} download>⬇ {t.exportCsv}</a>
          <Link className="btn primary" href="/">{es ? "+ Nueva" : "+ New"}</Link>
        </div>
      </div>
      <nav className="tabs" aria-label={es ? "Qué ver" : "What to see"}>
        {tabs.map(([k, label]) => (
          <Link key={k} href={`/documents${filtersQuery({ ...f, status: "all", q: "", from: null, to: null }, { kind: k })}`} aria-current={tab === k ? "page" : undefined}>{label}</Link>
        ))}
      </nav>

      {tab !== "estimate" && (
        <section className="tiles" data-testid="totals" aria-label={es ? "Facturas" : "Invoices"}>
          {tiles.map((x) => (
            <Link key={x.label} href={`/documents${x.href}`} className={`tile ${x.tone}`}>
              <span className="muted small">{x.label}</span>
              <span className="tile-value">{x.value}</span>
              <span className="muted small">{x.sub}</span>
            </Link>
          ))}
        </section>
      )}
      {tab !== "invoice" && (
        <section className="tiles" data-testid="estimate-totals" aria-label={es ? "Estimados" : "Estimates"}>
          {estTiles.map((x) => (
            <Link key={x.label} href={`/documents${x.href}`} className={`tile ${x.tone}`}>
              <span className="muted small">{x.label}</span>
              <span className="tile-value">{x.value}</span>
              <span className="muted small">{x.sub}</span>
            </Link>
          ))}
        </section>
      )}

      <div className={tab === "invoice" ? "dash-grid" : "dash-one"}>
        {tab !== "estimate" && (
          <section className="card" data-testid="invoice-chart">
            <MonthBars lang={lang} months={months} money={money} title={es ? "Facturado y cobrado por mes" : "Invoiced and collected by month"}
              series={[{ name: es ? "Facturado" : "Invoiced", color: "1", values: inv.map((m) => m.billed) }, { name: es ? "Cobrado" : "Collected", color: "2", values: inv.map((m) => m.collected) }]} />
          </section>
        )}
        {tab === "invoice" && (
          <section className="card stack" data-testid="aging">
            <h3>{es ? "¿Qué tan atrasado?" : "How late?"}</h3>
            <ul className="aging">
              {([["current", es ? "Al día" : "Not due yet"], ["d1_30", es ? "1 a 30 días tarde" : "1–30 days late"], ["d31_60", es ? "31 a 60 días tarde" : "31–60 days late"], ["d61", es ? "Más de 60 días" : "Over 60 days"]] as const).map(([k, label]) => (
                <li key={k} className={k !== "current" && ages[k].count ? "late" : ""}>
                  <span>{label}</span><strong className="amount">{money(ages[k].cents)}</strong><span className="muted small">{ages[k].count}</span>
                </li>
              ))}
            </ul>
            <h3 style={{ marginTop: 8 }}>{es ? "Quién te debe más" : "Who owes you most"}</h3>
            {owing.length ? (
              <ol className="owing">{owing.map((o) => (
                <li key={o.name}><Link href={`/documents${filtersQuery({ ...f, status: "sent", kind: "invoice", from: null, to: null }, { q: o.name })}`}>{o.name}</Link><strong className="amount">{money(o.cents)}</strong></li>
              ))}</ol>
            ) : <p className="muted small" style={{ margin: 0 }}>{es ? "Nadie te debe ahora mismo." : "Nobody owes you right now."}</p>}
          </section>
        )}
        {tab === "estimate" && (
          <section className="card" data-testid="estimate-chart">
            <MonthBars lang={lang} months={months} money={money} title={es ? "Estimados enviados y aceptados por mes" : "Estimates sent and accepted by month"}
              series={[{ name: es ? "Enviados" : "Sent", color: "1", values: estM.map((m) => m.sent) }, { name: es ? "Aceptados" : "Accepted", color: "2", values: estM.map((m) => m.accepted) }]} />
          </section>
        )}
      </div>

      <section className="card stack">
        <form className="filters" method="get" action="/documents">
          <input type="search" name="q" defaultValue={f.q} placeholder={t.searchPlaceholder} aria-label={t.searchPlaceholder} className="grow" />
          {f.kind !== "all" && <input type="hidden" name="kind" value={f.kind} />}
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
