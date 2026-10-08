import type { Metadata } from "next";
import Link from "next/link";
import { AdminNav } from "@/components/AdminNav";
import { InviteForm, SignupsToggle } from "@/components/AdminTools";
import { Header } from "@/components/Header";
import { signupsOpen } from "@/lib/accounts";
import { listAccounts, platformTotals } from "@/lib/admin";
import { formatMoney } from "@/lib/money";
import { PLANS, trialDaysLeft } from "@/lib/plans";
import { adminPageCtx, headerUser } from "@/lib/session";
import { getSettings } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin" };

/** Every account on the platform with its plan, fee and this month's use. Platform admins only. */
export default async function AdminPage() {
  const ctx = await adminPageCtx();
  const [settings, rows, open] = await Promise.all([getSettings(ctx.accountId), listAccounts(), signupsOpen()]);
  const lang = settings.lang;
  const es = lang === "es";
  const totals = platformTotals(rows);
  const date = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(es ? "es-US" : "en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";
  const tiles = [
    { label: es ? "Ingreso mensual" : "Monthly revenue", value: formatMoney(totals.monthlyRevenueCents, lang), sub: es ? `${totals.pro} en Pro` : `${totals.pro} on Pro` },
    { label: es ? "Cuentas" : "Accounts", value: String(totals.accounts), sub: es ? `${totals.newThisMonth} ${totals.newThisMonth === 1 ? "nueva" : "nuevas"} este mes` : `${totals.newThisMonth} new this month` },
    { label: es ? "En prueba" : "On trial", value: String(totals.trials), sub: es ? `${totals.trialsOver} con la prueba vencida` : `${totals.trialsOver} with trial ended` },
    { label: es ? "Cortesía / pausadas" : "Courtesy / paused", value: `${totals.comped} / ${totals.suspended}`, sub: " " },
  ];

  return (
    <main className="wrap wide">
      <Header lang={lang} user={headerUser(ctx)} />
      <h1>{es ? "Admin de Loro AI" : "Loro AI admin"}</h1>
      <AdminNav lang={lang} current="accounts" />

      <section className="tiles" data-testid="admin-totals">
        {tiles.map((x) => (
          <div key={x.label} className="tile">
            <span className="muted small">{x.label}</span>
            <span className="tile-value">{x.value}</span>
            <span className="muted small">{x.sub}</span>
          </div>
        ))}
      </section>
      <p className="muted small" style={{ marginTop: -6 }}>
        {es ? "El ingreso mensual suma la cuota de las cuentas Pro activas: lo acordado, no cobros con tarjeta (todavía no están conectados)." : "Monthly revenue adds up the fee of active Pro accounts: what's agreed, not card charges (those aren't connected yet)."}
      </p>

      <section className="card stack">
        <h2>{es ? "Quién puede entrar" : "Who can join"}</h2>
        <SignupsToggle lang={lang} open={open} />
        <div className="stack">
          <span className="muted small">{es ? "Invita a alguien: crea un enlace y mándaselo tú." : "Invite someone: create a link and send it yourself."}</span>
          <InviteForm lang={lang} />
        </div>
      </section>

      <section className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table className="wl-table" data-testid="accounts">
          <thead>
            <tr>
              <th>{es ? "Negocio" : "Business"}</th>
              <th>{es ? "Plan" : "Plan"}</th>
              <th>{es ? "Cuota" : "Fee"}</th>
              <th>{es ? "Este mes" : "This month"}</th>
              <th>{es ? "Última vez" : "Last active"}</th>
              <th>{es ? "Desde" : "Since"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const over = r.plan === "trial" && trialDaysLeft(r.trialEndsAt) === 0;
              return (
                <tr key={r.id} data-account={r.id}>
                  <td>
                    <Link href={`/admin/accounts/${r.id}`} style={{ fontWeight: 600 }}>{r.name || r.ownerName || (es ? "(sin nombre)" : "(no name)")}</Link>
                    {!r.name && r.claimed && <span className="badge grey" style={{ marginLeft: 6 }}>{es ? "sin configurar" : "not set up"}</span>}
                    <div className="muted small">{r.ownerEmail || (es ? "sin dueño todavía" : "no owner yet")}</div>
                  </td>
                  <td>
                    <span className={`badge ${r.status === "suspended" || over ? "bad" : r.plan === "trial" ? "warn" : ""}`}>
                      {r.status === "suspended" ? (es ? "Pausada" : "Paused") : PLANS[r.plan].name[lang]}
                    </span>
                    {r.plan === "trial" && r.status === "active" && (
                      <div className="muted small">{over ? (es ? "vencida" : "ended") : es ? `${trialDaysLeft(r.trialEndsAt)} días` : `${trialDaysLeft(r.trialEndsAt)} days`}</div>
                    )}
                  </td>
                  <td className="nowrap amount">{r.monthlyFeeCents ? formatMoney(r.monthlyFeeCents, lang) : "—"}</td>
                  <td className="nowrap">
                    {r.documentsThisMonth} {es ? "docs" : "docs"} · {r.aiThisMonth} IA
                    <div className="muted small">{r.documentsTotal} {es ? "en total" : "total"}</div>
                  </td>
                  <td className="nowrap">{date(r.lastActive)}</td>
                  <td className="nowrap">{date(r.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </main>
  );
}
