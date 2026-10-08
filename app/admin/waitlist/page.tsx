import Link from "next/link";
import type { Metadata } from "next";
import { AdminNav } from "@/components/AdminNav";
import { InviteForm } from "@/components/AdminTools";
import { Header } from "@/components/Header";
import { dict } from "@/lib/i18n";
import { adminPageCtx, headerUser } from "@/lib/session";
import { getSettings, searchWaitlist, waitlistTotals } from "@/lib/store";
import { isTrade, parseWaitlistFilters, TRADES, tradeName, waitlistQuery } from "@/lib/waitlist";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Lista de espera" };

const SHOWN = 500;

export default async function WaitlistPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await adminPageCtx();
  const f = parseWaitlistFilters(await searchParams);
  const [settings, totals, found] = await Promise.all([getSettings(ctx.accountId), waitlistTotals(), searchWaitlist(f, SHOWN)]);
  const lang = settings.lang;
  const t = dict(lang);
  const filtered = f.q || f.trade !== "all";
  const top = totals.byTrade.find((x) => x.trade);
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "es" ? "es-US" : "en-US", { day: "numeric", month: "short", year: "numeric" });

  return (
    <main className="wrap wide">
      <Header lang={lang} user={headerUser(ctx)} />
      <h1>{t.waitlistTitle}</h1>
      <AdminNav lang={lang} current="waitlist" />
      <p className="muted" style={{ marginTop: -6 }}>{t.waitlistIntro}</p>

      <section className="tiles" data-testid="waitlist-totals">
        <Link href="/admin/waitlist" className="tile">
          <span className="muted small">{t.waitlistTotal}</span>
          <span className="tile-value">{totals.total}</span>
          <span className="muted small">&nbsp;</span>
        </Link>
        <div className="tile">
          <span className="muted small">{t.waitlistWeek}</span>
          <span className="tile-value">{totals.lastWeek}</span>
          <span className="muted small">&nbsp;</span>
        </div>
        {top && isTrade(top.trade) && (
          <Link href={`/admin/waitlist${waitlistQuery(f, { trade: top.trade })}`} className="tile">
            <span className="muted small">{t.waitlistTopTrade}</span>
            <span className="tile-value">{tradeName(top.trade, lang)}</span>
            <span className="muted small">{t.waitlistCount(top.count)}</span>
          </Link>
        )}
      </section>

      <section className="card stack">
        <form className="filters" method="get" action="/admin/waitlist">
          <input type="search" name="q" defaultValue={f.q} placeholder={t.waitlistSearch} aria-label={t.waitlistSearch} className="grow" />
          <select name="trade" defaultValue={f.trade} aria-label={t.waitlistAnyTrade}>
            <option value="all">{t.waitlistAnyTrade}</option>
            {TRADES.map((tr) => <option key={tr} value={tr}>{tradeName(tr, lang)}</option>)}
            <option value="none">{t.waitlistNoTrade}</option>
          </select>
          <button className="btn primary small" type="submit">{t.applyFilters}</button>
        </form>
        <div className="row">
          <span className="muted small grow" data-testid="waitlist-count">{t.waitlistCount(found.total)}</span>
          {filtered && <Link href="/admin/waitlist" className="btn small ghost">{t.clearFilters}</Link>}
          <a href={`/api/admin/waitlist/export${waitlistQuery(f)}`} className="btn small" download>⬇ {t.exportCsv}</a>
        </div>
      </section>

      {found.entries.length === 0 ? (
        <section className="card"><p className="muted" style={{ margin: 0 }}>{filtered ? t.noMatches : t.waitlistEmpty}</p></section>
      ) : (
        <section className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table className="wl-table" data-testid="waitlist">
            <thead>
              <tr>
                <th>{t.waitlistColEmail}</th>
                <th>{t.waitlistColTrade}</th>
                <th>{t.waitlistColLang}</th>
                <th>{t.waitlistColDate}</th>
                <th><span className="sr">{lang === "es" ? "Invitar" : "Invite"}</span></th>
              </tr>
            </thead>
            <tbody>
              {found.entries.map((e) => (
                <tr key={e.id}>
                  <td>{e.email}{e.name && <span className="muted"> · {e.name}</span>}</td>
                  <td>{tradeName(e.trade, lang) || <span className="muted">—</span>}</td>
                  <td>{e.lang.toUpperCase()}</td>
                  <td className="nowrap">{date(e.createdAt)}</td>
                  <td><InviteForm lang={lang} initialEmail={e.email} compact /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {found.total > found.entries.length && (
            <p className="muted small" style={{ padding: "0 16px 12px" }}>{t.waitlistShowing(found.entries.length, found.total)}</p>
          )}
        </section>
      )}
    </main>
  );
}
