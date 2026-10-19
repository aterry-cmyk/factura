"use client";

import { useState } from "react";
import type { Lang } from "@/lib/types";

const L = (lang: Lang, es: string, en: string) => (lang === "es" ? es : en);

/** Settings → online payments: connect Stripe, see if it's ready, open the Stripe dashboard. */
export function PaymentsSettings(props: {
  lang: Lang; configured: boolean; connected: boolean; ready: boolean; detailsSubmitted: boolean; feePercent: number; owner: boolean;
}) {
  const { lang } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function go(url: "/api/payments/connect" | "/api/payments/dashboard") {
    setBusy(true);
    setError("");
    const res = await fetch(url, { method: "POST" }).catch(() => null);
    const json = res ? ((await res.json().catch(() => ({}))) as { url?: string }) : {};
    if (res?.ok && json.url) {
      window.location.href = json.url;
      return;
    }
    setBusy(false);
    setError(L(lang, "Stripe no respondió. Intenta otra vez en un momento.", "Stripe didn't answer. Try again in a moment."));
  }

  const state = !props.configured ? "setup" : props.ready ? "ready" : props.connected ? "pending" : "off";
  return (
    <section className="card stack" id="pagos" data-testid="payments">
      <div className="row">
        <h2 className="grow" style={{ margin: 0 }}>{L(lang, "Cobros en línea", "Online payments")}</h2>
        <span className={`badge ${state === "ready" ? "" : state === "pending" ? "warn" : "grey"}`} data-testid="payments-state">
          {state === "ready" ? L(lang, "Activos", "On") : state === "pending" ? L(lang, "Falta terminar", "Not finished") : state === "setup" ? L(lang, "Pronto", "Coming soon") : L(lang, "Apagados", "Off")}
        </span>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {L(lang,
          "Tus clientes pagan con tarjeta o cuenta bancaria desde el enlace de la factura, y la factura se marca «Pagada» sola. El dinero llega a tu banco por Stripe.",
          "Your customers pay by card or bank account from the invoice link, and the invoice marks itself “Paid”. The money reaches your bank through Stripe.")}
      </p>
      {state === "setup" ? (
        <p className="note">{L(lang, "Los cobros en línea todavía no están activados en Loro AI.", "Online payments aren't switched on in Loro AI yet.")}</p>
      ) : state === "ready" ? (
        <div className="row">
          <button className="btn" onClick={() => go("/api/payments/dashboard")} disabled={busy}>{L(lang, "Abrir mi panel de Stripe", "Open my Stripe dashboard")}</button>
          <span className="muted small">{L(lang, "Ahí ves tus depósitos y cambias tu banco.", "See your payouts and change your bank there.")}</span>
        </div>
      ) : props.owner ? (
        <div className="stack">
          {state === "pending" && (
            <p className="note warn">{props.detailsSubmitted
              ? L(lang, "Stripe está revisando tus datos. Suele tardar minutos; a veces pide algo más.", "Stripe is reviewing your details. It usually takes minutes; sometimes it asks for more.")
              : L(lang, "Empezaste a conectar Stripe pero falta terminar.", "You started connecting Stripe but didn't finish.")}</p>
          )}
          <button className="btn primary" onClick={() => go("/api/payments/connect")} disabled={busy}>
            {state === "pending" ? L(lang, "Seguir en Stripe", "Continue on Stripe") : L(lang, "Conectar con Stripe", "Connect with Stripe")}
          </button>
          <span className="muted small">
            {L(lang,
              `Stripe te pide tu nombre, tu negocio, tu banco y tu número de impuestos (SSN, ITIN o EIN). Por cada pago, Stripe cobra su tarifa y Loro AI cobra ${props.feePercent}%.`,
              `Stripe asks for your name, business, bank and tax number (SSN, ITIN or EIN). On each payment, Stripe charges its fee and Loro AI charges ${props.feePercent}%.`)}
          </span>
        </div>
      ) : (
        <p className="muted small">{L(lang, "La persona dueña de la cuenta conecta Stripe.", "The account owner connects Stripe.")}</p>
      )}
      {error && <p className="note bad" role="alert">{error}</p>}
    </section>
  );
}
