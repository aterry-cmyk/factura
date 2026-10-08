import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { NameForm, PasswordForm, SignOutOthers } from "@/components/AccountForms";
import { monthUsage } from "@/lib/accounts";
import { authText } from "@/lib/auth-text";
import { PLANS, trialDaysLeft } from "@/lib/plans";
import { headerUser, pageCtx } from "@/lib/session";
import { getSettings } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Mi cuenta" };

/** The person's own page: name, password, devices, and the account's plan and this month's use. */
export default async function AccountPage() {
  const ctx = await pageCtx();
  const [settings, usage] = await Promise.all([getSettings(ctx.accountId), monthUsage(ctx.accountId)]);
  const lang = settings.lang;
  const t = authText(lang);
  const es = lang === "es";
  const plan = PLANS[ctx.plan];
  const days = trialDaysLeft(ctx.trialEndsAt);
  const trialOver = ctx.plan === "trial" && days === 0;
  const meters = [
    { label: es ? "Facturas y presupuestos" : "Invoices and estimates", used: usage.documents, max: plan.documentsPerMonth },
    { label: es ? "Pedidos al asistente" : "Assistant requests", used: usage.ai, max: plan.aiPerMonth },
  ];
  const month = new Date().toLocaleDateString(es ? "es-US" : "en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <main className="wrap">
      <Header lang={lang} user={headerUser(ctx)} />
      <h1>{es ? "Mi cuenta" : "My account"}</h1>
      <p className="muted" style={{ marginTop: 0 }}>{ctx.email}</p>

      <section className="card stack" aria-labelledby="plan-h">
        <div className="row">
          <h2 id="plan-h" className="grow" style={{ margin: 0 }}>{es ? "Tu plan" : "Your plan"}</h2>
          <span className={`badge ${ctx.status === "suspended" || trialOver ? "bad" : ctx.plan === "trial" ? "warn" : ""}`} data-testid="plan-badge">
            {ctx.status === "suspended" ? (es ? "Pausada" : "Paused") : plan.name[lang]}
          </span>
        </div>
        {ctx.status === "suspended" ? (
          <p className="note bad">{es ? "Tu cuenta está pausada. Puedes ver y descargar tus facturas, pero no crear nuevas." : "Your account is paused. You can see and download your invoices, but not make new ones."}</p>
        ) : ctx.plan === "trial" ? (
          <p className={`note ${trialOver ? "bad" : "warn"}`} data-testid="trial-note">
            {trialOver
              ? es ? "Tu prueba gratis terminó. Puedes ver tus facturas; para crear nuevas, tu plan tiene que pasar a Pro." : "Your free trial ended. You can see your invoices; to make new ones, your plan needs to move to Pro."
              : es ? `Te quedan ${days} ${days === 1 ? "día" : "días"} de prueba gratis.` : `${days} ${days === 1 ? "day" : "days"} left in your free trial.`}
          </p>
        ) : null}
        <div className="stack">
          <span className="muted small">{es ? `Uso en ${month}` : `Use in ${month}`}</span>
          {meters.map((m) => (
            <div key={m.label} className="meter">
              <div className="row"><span className="grow">{m.label}</span><strong className="amount">{m.max === null ? m.used : `${m.used} / ${m.max}`}</strong></div>
              {m.max !== null && <div className="progress" style={{ margin: "6px 0 0" }}><span style={{ width: `${Math.min(100, (m.used / m.max) * 100)}%` }} /></div>}
            </div>
          ))}
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          {es ? "El pago con tarjeta todavía no está en la app. El equipo de Loro AI cambia tu plan." : "Card payments aren't in the app yet. The Loro AI team changes your plan."}
        </p>
      </section>

      <section className="card stack">
        <h2>{es ? "Tus datos" : "Your details"}</h2>
        <NameForm t={t} initial={ctx.name} labels={{ title: t.yourName }} />
      </section>

      <section className="card stack">
        <h2>{t.password}</h2>
        <PasswordForm t={t} labels={{ change: es ? "Cambiar contraseña" : "Change password", done: es ? "Listo. Cerramos tu sesión en los otros aparatos." : "Done. You've been signed out on your other devices." }} />
      </section>

      <section className="card stack">
        <h2>{es ? "Tus aparatos" : "Your devices"}</h2>
        <p className="muted" style={{ margin: 0 }}>{es ? "¿Entraste en un teléfono o computadora que ya no usas? Cierra la sesión en todos menos este." : "Signed in on a phone or computer you don't use anymore? Sign out everywhere except here."}</p>
        <SignOutOthers labels={{ button: es ? "Cerrar sesión en los demás" : "Sign out everywhere else", done: es ? "Listo. Sesiones cerradas: {n}." : "Done. Sessions ended: {n}." }} />
      </section>
    </main>
  );
}
