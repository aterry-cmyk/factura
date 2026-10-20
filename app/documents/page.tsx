import Link from "next/link";
import { DocumentsTable } from "@/components/DocumentsTable";
import { Header } from "@/components/Header";
import { filtersQuery, isOverdue, PAGE_SIZE, parseFilters, type StatusFilter } from "@/lib/doc-list";
import { dict, statusLabel } from "@/lib/i18n";
import { formatMoney, todayIso } from "@/lib/money";
import { documentTotals, estimateTotals, getSettings, invoiceMonths, openInvoices, periodSummary, recentActivity, searchDocuments } from "@/lib/store";
import { acceptanceRate, aging, byMonth, isPeriod, monthKeys, periodRange, PERIODS, topOwing, type Period } from "@/lib/dashboard";
import { Donut } from "@/components/Donut";
import { MonthBars } from "@/components/MonthBars";
import { headerUser, pageCtx } from "@/lib/session";

export const dynamic = "force-dynamic";

const ACTIVITY: Record<string, [string, string]> = {
  created: ["Creada", "Created"],
  edited: ["Editada", "Edited"],
  sent_email: ["Enviada por correo", "Emailed"],
  sent_sms: ["Enviada por texto", "Texted"],
  reminder_email: ["Recordatorio por correo", "Reminder emailed"],
  reminder_sms: ["Recordatorio por texto", "Reminder texted"],
  paid: ["Marcada pagada", "Marked paid"],
  paid_online: ["Pagada en línea", "Paid online"],
  accepted: ["Aceptado", "Accepted"],
  accepted_by_customer: ["El cliente lo aceptó", "The customer accepted it"],
  void: ["Anulada", "Voided"],
  unpaid: ["Marcada sin pagar", "Marked unpaid"],
  payment_processing: ["Pago bancario en proceso", "Bank payment processing"],
};

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const f = parseFilters(sp);
  const period: Period = isPeriod(sp.period) ? sp.period : "month";
  const ctx = await pageCtx();
  const today = todayIso();
  const range = periodRange(period, today);
  const months = monthKeys(today, 6);
  const [settings, totals, found, invMonths, est, open, sum, activity] = await Promise.all([
    getSettings(ctx.accountId),
    documentTotals(ctx.accountId, today),
    searchDocuments(ctx.accountId, f, today, { limit: PAGE_SIZE, offset: (f.page - 1) * PAGE_SIZE }),
    invoiceMonths(ctx.accountId, `${months[0]}-01`),
    estimateTotals(ctx.accountId, today),
    openInvoices(ctx.accountId),
    periodSummary(ctx.accountId, range.from, range.to),
    recentActivity(ctx.accountId, 8),
  ]);
  const lang = settings.lang;
  const es = lang === "es";
  const L = (a: string, b: string) => (es ? a : b);
  const t = dict(lang);
  const money = (c: number) => formatMoney(c, lang);
  const pages = Math.max(1, Math.ceil(found.total / PAGE_SIZE));
  const filtered = f.q || f.status !== "all" || f.from || f.to;
  const tab = f.kind;
  /** Keeps the chosen period on every link that changes the list. */
  const q = (change: Parameters<typeof filtersQuery>[1] = {}) => {
    const base = filtersQuery(f, change);
    return period === "month" ? base : `${base}${base ? "&" : "?"}period=${period}`;
  };

  const statusChips: [StatusFilter, string][] =
    tab === "estimate"
      ? [["all", t.filterAll], ["draft", t.filterDrafts], ["sent", L("Enviados", "Sent")], ["accepted", t.filterAccepted], ["void", L("Rechazados / anulados", "Declined / void")]]
      : tab === "invoice"
        ? [["all", t.filterAll], ["draft", t.filterDrafts], ["sent", t.filterSent], ["overdue", t.filterOverdue], ["paid", t.filterPaid], ["void", t.filterVoid]]
        : [["all", t.filterAll], ["draft", t.filterDrafts], ["sent", t.filterSent], ["overdue", t.filterOverdue], ["paid", t.filterPaid], ["void", t.filterVoid], ["accepted", t.filterAccepted]];

  const periodLabel: Record<Period, string> = { month: L("Este mes", "This month"), "30": L("Últimos 30 días", "Last 30 days"), "90": L("Últimos 90 días", "Last 90 days"), year: L("Este año", "This year") };
  const rate = acceptanceRate(sum.estimates.accepted.count, sum.estimates.declined.count);
  const kpis = [
    { label: t.owed, value: money(totals.owed.cents), sub: `${t.docsCount(totals.owed.count)} · ${t.withLateFees}`, href: q({ status: "sent", kind: "invoice" }), tone: "blue" },
    { label: t.overdueTotal, value: money(totals.overdue.cents), sub: t.docsCount(totals.overdue.count), href: q({ status: "overdue", kind: "invoice" }), tone: totals.overdue.count ? "bad" : "" },
    { label: L("Cobrado", "Collected"), value: money(sum.invoices.collected.cents), sub: `${periodLabel[period]} · ${t.docsCount(sum.invoices.collected.count)}`, href: q({ status: "paid", kind: "invoice" }), tone: "good" },
    { label: L("Facturado", "Invoiced"), value: money(sum.invoices.issued.cents), sub: `${periodLabel[period]} · ${t.docsCount(sum.invoices.issued.count)}`, href: q({ kind: "invoice" }), tone: "" },
    { label: L("Estimados abiertos", "Open estimates"), value: money(est.open.cents), sub: L(`${est.open.count} esperando respuesta`, `${est.open.count} awaiting an answer`), href: q({ kind: "estimate", status: "sent" }), tone: "blue" },
    { label: L("Tasa de aceptación", "Acceptance rate"), value: rate === null ? "—" : `${rate}%`, sub: L(`${sum.estimates.accepted.count} sí · ${sum.estimates.declined.count} no`, `${sum.estimates.accepted.count} yes · ${sum.estimates.declined.count} no`), href: q({ kind: "estimate", status: "accepted" }), tone: "" },
  ];
  const ages = aging(open, today);
  const owedNow = ages.current.cents + ages.d1_30.cents + ages.d31_60.cents + ages.d61.cents;
  const ageRows = ([["current", L("Al día", "Not due yet")], ["d1_30", L("1–30 días tarde", "1–30 days late")], ["d31_60", L("31–60 días tarde", "31–60 days late")], ["d61", L("Más de 60 días", "Over 60 days")]] as const)
    .map(([k, label]) => ({ k, label, ...ages[k], pct: owedNow ? Math.round((ages[k].cents / owedNow) * 100) : 0 }));
  const owing = topOwing(open, today, 4);
  const inv = byMonth(months, invMonths, { billed: 0, collected: 0, online: 0 });
  const manual = Math.max(0, sum.invoices.collected.cents - sum.invoices.online.cents);
  const tabs: [typeof tab, string][] = [["all", L("Todo", "All")], ["invoice", L("Facturas", "Invoices")], ["estimate", L("Estimados", "Estimates")]];
  const when = (iso: string) => new Date(iso).toLocaleString(es ? "es-US" : "en-US", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const pending = [
    { label: L("Borradores sin enviar", "Drafts not sent"), n: sum.drafts, href: q({ status: "draft" }), alert: false },
    { label: L("Estimados esperando respuesta", "Estimates awaiting an answer"), n: sum.estimatesWaiting, href: q({ kind: "estimate", status: "sent" }), alert: false },
    { label: L("Facturas vencidas", "Overdue invoices"), n: totals.overdue.count, href: q({ kind: "invoice", status: "overdue" }), alert: totals.overdue.count > 0 },
    { label: L("Facturas por cobrar", "Invoices to collect"), n: totals.owed.count, href: q({ kind: "invoice", status: "sent" }), alert: false },
  ];

  return (
    <main className="wrap full">
      <Header lang={lang} user={headerUser(ctx)} />
      <h1 className="sr">{t.allDocsTitle}</h1>

      <section className="db-bar card" aria-label={L("Filtros", "Filters")}>
        <div className="db-field">
          <span>{L("Período", "Period")}</span>
          <div className="seg-links" role="group" aria-label={L("Período", "Period")}>
            {PERIODS.map((p) => (
              <Link key={p} href={`/documents${filtersQuery(f)}${filtersQuery(f) ? "&" : "?"}period=${p}`} aria-current={p === period ? "true" : undefined}>{periodLabel[p]}</Link>
            ))}
          </div>
        </div>
        <div className="db-field">
          <span>{L("Tipo", "Type")}</span>
          <nav className="seg-links" aria-label={L("Qué ver", "What to see")}>
            {tabs.map(([k, label]) => (
              <Link key={k} href={`/documents${q({ ...{}, kind: k, status: "all", q: "", from: null, to: null })}`} aria-current={tab === k ? "page" : undefined}>{label}</Link>
            ))}
          </nav>
        </div>
        <div className="db-actions">
          <a className="btn small" href={`/api/documents/export${filtersQuery(f, { page: 1 })}`} download>⬇ {t.exportCsv}</a>
          <Link className="btn primary small" href="/">{L("+ Nueva", "+ New")}</Link>
        </div>
      </section>

      <div className="db">
        <div className="db-main">
          <section className="kpis" data-testid="totals">
            {kpis.map((k) => (
              <Link key={k.label} href={`/documents${k.href}`} className="kpi">
                <span className="kpi-label">{k.label}</span>
                <span className={`kpi-value ${k.tone}`}>{k.value}</span>
                <span className="kpi-sub">{k.sub}</span>
              </Link>
            ))}
          </section>

          <div className="db-row">
            <section className="card db-aging" data-testid="aging">
              <div className="db-card-head"><h2>{L("Antigüedad", "By age")}</h2><span className="pill">{money(owedNow)}</span></div>
              <ul className="hbars">
                {ageRows.map((a) => (
                  <li key={a.k} className={a.k !== "current" && a.count ? "late" : ""}>
                    <span className="hb-label">{a.label}</span>
                    <span className="hb-track"><span style={{ width: `${a.pct}%` }} /></span>
                    <span className="hb-pct">{a.pct}%</span>
                    <b className="amount">{money(a.cents)}</b>
                  </li>
                ))}
              </ul>
              <h3 style={{ marginTop: 14 }}>{L("Quién te debe más", "Who owes you most")}</h3>
              {owing.length ? (
                <ol className="owing">{owing.map((o) => (
                  <li key={o.name}><Link href={`/documents${q({ status: "sent", kind: "invoice", from: null, to: null, q: o.name })}`}>{o.name}</Link><strong className="amount">{money(o.cents)}</strong></li>
                ))}</ol>
              ) : <p className="muted small" style={{ margin: 0 }}>{L("Nadie te debe ahora mismo.", "Nobody owes you right now.")}</p>}
            </section>
            <section className="card" data-testid="estimate-donut">
              <Donut title={L("Estimados", "Estimates")} money={money} center={String(sum.estimates.sent.count)} sub={L("enviados", "sent")}
                parts={[
                  { label: L("Aceptados", "Accepted"), value: sum.estimates.accepted.cents, color: "var(--accent)" },
                  { label: L("Esperando", "Waiting"), value: sum.estimates.open.cents, color: "var(--chart-1)" },
                  { label: L("Rechazados", "Declined"), value: sum.estimates.declined.cents, color: "var(--muted)" },
                ]} />
            </section>
            <section className="card" data-testid="payments-donut">
              <Donut title={L("Cobros", "Payments")} money={money} center={money(sum.invoices.collected.cents).replace(/\.00$/, "")} sub={periodLabel[period]}
                parts={[
                  { label: L("En línea", "Online"), value: sum.invoices.online.cents, color: "var(--chart-1)" },
                  { label: L("A mano", "By hand"), value: manual, color: "var(--chart-2)" },
                ]} />
            </section>
            <section className="minis">
              <div className="mini"><span>{L("Borradores", "Drafts")}</span><b>{sum.drafts}</b></div>
              <div className="mini"><span>{L("Recordatorios enviados", "Reminders sent")}</span><b>{sum.remindersSent}</b></div>
              <div className="mini"><span>{L("Días promedio para cobrar", "Average days to get paid")}</span><b>{sum.invoices.avgDaysToPay ?? "—"}</b></div>
              <div className="mini"><span>{L("Cobrado en línea", "Collected online")}</span><b className="blue">{money(sum.invoices.online.cents)}</b></div>
            </section>
          </div>

          <div className="summaries">
            <section className="card">
              <h2>{L("Resumen de facturas", "Invoice summary")}</h2>
              <dl className="sum">
                <div><dt>{L("Emitidas", "Issued")}</dt><dd>{money(sum.invoices.issued.cents)} <small>({sum.invoices.issued.count})</small></dd></div>
                <div><dt>{L("Cobradas", "Collected")}</dt><dd className="good">{money(sum.invoices.collected.cents)} <small>({sum.invoices.collected.count})</small></dd></div>
                <div><dt>{L("Por cobrar hoy", "Owed today")}</dt><dd>{money(totals.owed.cents)}</dd></div>
                <div><dt>{L("Vencido hoy", "Overdue today")}</dt><dd className={totals.overdue.count ? "bad" : ""}>{money(totals.overdue.cents)}</dd></div>
                <div><dt>{L("Anuladas", "Voided")}</dt><dd>{sum.invoices.voided}</dd></div>
                <div><dt>{L("Borradores", "Drafts")}</dt><dd>{totals.drafts}</dd></div>
              </dl>
            </section>
            <section className="card">
              <h2>{L("Resumen de estimados", "Estimate summary")}</h2>
              <dl className="sum">
                <div><dt>{L("Enviados", "Sent")}</dt><dd>{money(sum.estimates.sent.cents)} <small>({sum.estimates.sent.count})</small></dd></div>
                <div><dt>{L("Aceptados", "Accepted")}</dt><dd className="good">{money(sum.estimates.accepted.cents)} <small>({sum.estimates.accepted.count})</small></dd></div>
                <div><dt>{L("Esperando respuesta", "Awaiting an answer")}</dt><dd>{money(sum.estimates.open.cents)} <small>({sum.estimates.open.count})</small></dd></div>
                <div><dt>{L("Rechazados", "Declined")}</dt><dd>{money(sum.estimates.declined.cents)} <small>({sum.estimates.declined.count})</small></dd></div>
                <div><dt>{L("Pasados a factura", "Turned into invoices")}</dt><dd>{sum.estimates.converted}</dd></div>
                <div><dt>{L("Tasa de aceptación", "Acceptance rate")}</dt><dd>{rate === null ? "—" : `${rate}%`}</dd></div>
              </dl>
            </section>
            <section className="card">
              <h2>{L("Resumen de cobros", "Payment summary")}</h2>
              <dl className="sum">
                <div><dt>{L("Cobrado", "Collected")}</dt><dd className="good">{money(sum.invoices.collected.cents)}</dd></div>
                <div><dt>{L("En línea (tarjeta o banco)", "Online (card or bank)")}</dt><dd>{money(sum.invoices.online.cents)}</dd></div>
                <div><dt>{L("A mano (efectivo, cheque, Zelle)", "By hand (cash, check, Zelle)")}</dt><dd>{money(manual)}</dd></div>
                <div><dt>{L("Días promedio para cobrar", "Average days to get paid")}</dt><dd>{sum.invoices.avgDaysToPay ?? "—"}</dd></div>
                <div><dt>{L("Recordatorios enviados", "Reminders sent")}</dt><dd>{sum.remindersSent}</dd></div>
                <div><dt>{L("Período", "Period")}</dt><dd>{periodLabel[period]}</dd></div>
              </dl>
            </section>
          </div>

          <section className="card" data-testid="invoice-chart">
            <MonthBars lang={lang} months={months} money={money} title={L("Facturado y cobrado por mes", "Invoiced and collected by month")}
              series={[{ name: L("Facturado", "Invoiced"), color: "1", values: inv.map((m) => m.billed) }, { name: L("Cobrado", "Collected"), color: "2", values: inv.map((m) => m.collected) }]} />
          </section>
        </div>

        <aside className="db-side">
          <section className="card side" data-testid="pending">
            <h2>{L("Pendientes", "To do")}</h2>
            <ul className="side-list">
              {pending.map((p) => (
                <li key={p.label}><Link href={`/documents${p.href}`}>{p.label}</Link>{p.alert && <span className="dot-alert" aria-hidden="true">!</span>}<b>{p.n}</b></li>
              ))}
            </ul>
          </section>
          <section className="card side" data-testid="activity">
            <h2>{L("Actividad reciente", "Recent activity")}</h2>
            {activity.length ? (
              <ul className="activity">
                {activity.map((a, i) => (
                  <li key={i}>
                    <span className={`act-dot ${a.kind.startsWith("paid") || a.kind.startsWith("accepted") ? "good" : a.kind.startsWith("reminder") ? "warn" : ""}`} />
                    <Link href={`/documents/${a.docId}`}><b>{a.number}</b> · {a.customer}</Link>
                    <span>{(ACTIVITY[a.kind] ?? [a.kind, a.kind])[es ? 0 : 1]}{a.kind === "paid_online" ? `: ${money(Number(a.detail))}` : ""}</span>
                    <time>{when(a.at)}</time>
                  </li>
                ))}
              </ul>
            ) : <p className="muted small" style={{ margin: 0 }}>{L("Todavía no hay actividad.", "No activity yet.")}</p>}
          </section>
          <section className="card side links-card">
            <Link href="/">{L("Nueva factura o estimado", "New invoice or estimate")}<span>→</span></Link>
            <Link href="/settings#pagos">{L("Cobros en línea", "Online payments")}<span>→</span></Link>
            <Link href="/settings">{t.settings}<span>→</span></Link>
          </section>
        </aside>
      </div>

      <h2 className="list-title">{tab === "estimate" ? L("Tus estimados", "Your estimates") : tab === "invoice" ? L("Tus facturas", "Your invoices") : L("Todos tus documentos", "All your documents")}</h2>
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
            <Link key={s} href={`/documents${q({ status: s })}`} className="chip" aria-pressed={f.status === s}>
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
