import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminNav } from "@/components/AdminNav";
import { AccountBillingForm, ResetLinkButton } from "@/components/AdminTools";
import { Header } from "@/components/Header";
import { getAccount } from "@/lib/admin";
import { PLANS } from "@/lib/plans";
import { adminPageCtx, headerUser } from "@/lib/session";
import { getSettings } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cuenta" };

/** One account: billing, its people (with password reset links) and six months of use. */
export default async function AdminAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await adminPageCtx();
  const { id } = await params;
  const [settings, acct] = await Promise.all([getSettings(ctx.accountId), getAccount(id)]);
  if (!acct) notFound();
  const lang = settings.lang;
  const es = lang === "es";
  const nf = new Intl.NumberFormat(es ? "es-US" : "en-US");
  const date = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(es ? "es-US" : "en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";
  const month = (m: string) =>
    new Date(`${m}-01T00:00:00Z`).toLocaleDateString(es ? "es-US" : "en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <main className="wrap wide">
      <Header lang={lang} user={headerUser(ctx)} />
      <p className="small" style={{ margin: "0 0 4px" }}><Link href="/admin">← {es ? "Todas las cuentas" : "All accounts"}</Link></p>
      <h1>{acct.name || acct.people[0]?.name || (es ? "(sin nombre)" : "(no name)")}</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {PLANS[acct.plan].name[lang]} · {es ? "desde" : "since"} {date(acct.createdAt)}
      </p>
      <AdminNav lang={lang} current="accounts" />

      <section className="card stack">
        <h2>{es ? "Plan y cobro" : "Plan and billing"}</h2>
        <AccountBillingForm lang={lang} id={acct.id} initial={acct} />
      </section>

      <section className="card stack">
        <h2>{es ? "Personas" : "People"}</h2>
        {acct.people.length === 0 ? (
          <p className="muted">{es ? "Nadie ha entrado a esta cuenta todavía." : "Nobody has signed in to this account yet."}</p>
        ) : (
          <ul className="list">
            {acct.people.map((p) => (
              <li key={p.id} className="person">
                <div className="grow" style={{ minWidth: 0 }}>
                  <strong>{p.name || p.email}</strong> {p.isAdmin && <span className="badge">Admin</span>}
                  <div className="muted small ellipsis">{p.email} · {es ? "última vez" : "last sign-in"} {date(p.lastLogin)}</div>
                </div>
                <ResetLinkButton lang={lang} userId={p.id} email={p.email} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" style={{ padding: 0, overflowX: "auto" }}>
        <h2 style={{ padding: "18px 18px 0" }}>{es ? "Uso por mes" : "Use by month"}</h2>
        {acct.usage.length === 0 ? (
          <p className="muted" style={{ padding: "0 18px 18px" }}>{es ? "Sin uso todavía." : "No use yet."}</p>
        ) : (
          <table className="wl-table" data-testid="usage">
            <thead>
              <tr>
                <th>{es ? "Mes" : "Month"}</th>
                <th>{es ? "Documentos" : "Documents"}</th>
                <th>{es ? "Pedidos a la IA" : "AI requests"}</th>
                <th>{es ? "Tokens (entrada / salida)" : "Tokens (in / out)"}</th>
                <th>{es ? "Voz (caracteres)" : "Voice (characters)"}</th>
                <th>Email / SMS</th>
              </tr>
            </thead>
            <tbody>
              {acct.usage.map((u) => (
                <tr key={u.month}>
                  <td className="nowrap">{month(u.month)}</td>
                  <td className="amount">{nf.format(u.documents)}</td>
                  <td className="amount">{nf.format(u.ai)}</td>
                  <td className="amount nowrap">{nf.format(u.inputTokens)} / {nf.format(u.outputTokens)}</td>
                  <td className="amount">{nf.format(u.voiceChars)}</td>
                  <td className="amount">{u.email} / {u.sms}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
