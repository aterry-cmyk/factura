"use client";

import { useState } from "react";
import type { Lang } from "@/lib/types";

const L = (lang: Lang, es: string, en: string) => (lang === "es" ? es : en);

/** What the customer can do on their link: pay an invoice online, or accept an estimate. */
export function CustomerBox(props: {
  lang: Lang;
  token: string;
  kind: "invoice" | "estimate";
  status: string;
  canPay: boolean;
  amountText: string;
  paidAt: string | null;
  acceptedAt: string | null;
  acceptedBy: string;
  payResult: string | null;
  businessName: string;
}) {
  const { lang } = props;
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const date = (iso: string) => new Date(iso).toLocaleDateString(lang === "es" ? "es-US" : "en-US", { day: "numeric", month: "long", year: "numeric" });

  async function accept(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch(`/i/${props.token}/accept`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
    }).catch(() => null);
    if (res?.ok) return window.location.reload();
    setBusy(false);
    setError(L(lang, "No se pudo aceptar. Recarga la página e intenta otra vez.", "Couldn't accept it. Reload the page and try again."));
  }

  if (props.kind === "estimate") {
    if (props.status === "accepted") {
      return (
        <section className="cust ok" data-testid="customer-box">
          <strong>{L(lang, "Estimado aceptado", "Estimate accepted")}</strong>
          <span>{props.acceptedBy ? `${props.acceptedBy} · ` : ""}{props.acceptedAt ? date(props.acceptedAt) : ""}</span>
        </section>
      );
    }
    if (props.status !== "sent") return null;
    return (
      <form className="cust" onSubmit={accept} data-testid="customer-box">
        <strong>{L(lang, `¿Le damos luz verde? ${props.businessName} empieza cuando aceptes.`, `Ready to go ahead? ${props.businessName} starts when you accept.`)}</strong>
        <div className="row">
          <label className="sr" htmlFor="accept-name">{L(lang, "Tu nombre", "Your name")}</label>
          <input id="accept-name" className="grow" value={name} onChange={(e) => setName(e.target.value)} placeholder={L(lang, "Tu nombre", "Your name")} autoComplete="name" maxLength={120} />
          <button className="btn primary" disabled={busy || !name.trim()}>{L(lang, "Aceptar estimado", "Accept estimate")}</button>
        </div>
        {error && <p className="note bad" role="alert">{error}</p>}
      </form>
    );
  }

  if (props.status === "paid") {
    return (
      <section className="cust ok" data-testid="customer-box">
        <strong>{L(lang, "Pagada", "Paid")}{props.paidAt ? ` · ${date(props.paidAt)}` : ""}</strong>
        <span>{L(lang, "Gracias por tu pago.", "Thank you for your payment.")}</span>
      </section>
    );
  }
  if (props.status !== "sent") return null;
  const notice =
    props.payResult === "ok"
      ? L(lang, "Recibimos tu pago. Con tarjeta se confirma en segundos; con cuenta bancaria tarda unos días. Esta factura dirá «Pagada» en cuanto se confirme.", "We got your payment. Card payments confirm in seconds; bank payments take a few days. This invoice will say “Paid” once it's confirmed.")
      : props.payResult === "error"
        ? L(lang, "No se pudo abrir el pago. Intenta otra vez en un momento.", "Couldn't open the payment page. Try again in a moment.")
        : null;
  if (!props.canPay) return notice ? <p className="note" role="status">{notice}</p> : null;
  return (
    <form className="cust pay" method="post" action={`/i/${props.token}/pay`} data-testid="customer-box">
      {notice && <p className="note" role="status" style={{ margin: 0 }}>{notice}</p>}
      <button className="btn primary block big-pay">{L(lang, `Pagar ${props.amountText}`, `Pay ${props.amountText}`)}</button>
      <span className="muted small">{L(lang, "Con tarjeta o cuenta bancaria. Pago seguro con Stripe.", "By card or bank account. Secure payment with Stripe.")}</span>
    </form>
  );
}
