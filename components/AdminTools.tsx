"use client";

import { useState } from "react";
import { PLAN_IDS, PLANS, type AccountStatus, type PlanId } from "@/lib/plans";
import type { Lang } from "@/lib/types";

const L = (lang: Lang, es: string, en: string) => (lang === "es" ? es : en);

async function call(url: string, method: string, body?: object) {
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { ok: res.ok, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  } catch {
    return { ok: false, data: {} as Record<string, unknown> };
  }
}

/** A link shown once, with a copy button and the text selectable in case copying is refused. */
function OneTimeLink({ lang, link, note }: { lang: Lang; link: string; note: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="onetime" role="status">
      <code data-testid="one-time-link">{link}</code>
      <div className="row">
        <button type="button" className="btn small" onClick={copy}>{copied ? L(lang, "Copiado", "Copied") : L(lang, "Copiar enlace", "Copy link")}</button>
        <span className="muted small grow">{note}</span>
      </div>
    </div>
  );
}

export function InviteForm({ lang, initialEmail = "", compact = false }: { lang: Lang; initialEmail?: string; compact?: boolean }) {
  const [email, setEmail] = useState(initialEmail);
  const [link, setLink] = useState("");
  const [days, setDays] = useState(14);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const r = await call("/api/admin/invites", "POST", { email });
    setBusy(false);
    if (r.ok) {
      setLink(String(r.data.link));
      setDays(Number(r.data.days));
    } else setError(L(lang, "Revisa el email.", "Check the email."));
  }
  if (link) {
    return <OneTimeLink lang={lang} link={link} note={L(lang, `Mándalo por WhatsApp o texto. Sirve para ${email}, una vez, durante ${days} días.`, `Send it by WhatsApp or text. It works for ${email}, once, for ${days} days.`)} />;
  }
  return (
    <form onSubmit={submit} className={compact ? "row" : "row"} noValidate>
      {!compact && (
        <>
          <label className="sr" htmlFor="invite-email">Email</label>
          <input id="invite-email" type="email" className="grow" placeholder="contratista@email.com" value={email} onChange={(e) => setEmail(e.target.value)} style={{ minWidth: 200 }} />
        </>
      )}
      <button className={`btn ${compact ? "small" : "primary"}`} disabled={busy || !email}>{L(lang, "Crear invitación", "Create invitation")}</button>
      {error && <span className="note bad small">{error}</span>}
    </form>
  );
}

export function SignupsToggle({ lang, open }: { lang: Lang; open: boolean }) {
  const [value, setValue] = useState(open);
  const [busy, setBusy] = useState(false);
  async function flip() {
    setBusy(true);
    const r = await call("/api/admin/platform", "PATCH", { signupsOpen: !value });
    setBusy(false);
    if (r.ok) setValue(!value);
  }
  return (
    <div className="row">
      <div className="grow">
        <strong>{value ? L(lang, "Cualquiera puede crear una cuenta", "Anyone can create an account") : L(lang, "Solo con invitación", "Invitation only")}</strong>
        <div className="muted small">{value ? L(lang, "La página de registro está abierta a todos.", "The sign-up page is open to everyone.") : L(lang, "Para crear una cuenta hace falta un enlace de invitación.", "Creating an account needs an invitation link.")}</div>
      </div>
      <button className="btn small" onClick={flip} disabled={busy} data-testid="signups-toggle">
        {value ? L(lang, "Cerrar registro", "Close sign-ups") : L(lang, "Abrir registro", "Open sign-ups")}
      </button>
    </div>
  );
}

export function ResetLinkButton({ lang, userId, email }: { lang: Lang; userId: string; email: string }) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  async function make() {
    setBusy(true);
    const r = await call(`/api/admin/users/${userId}/reset`, "POST");
    setBusy(false);
    if (r.ok) setLink(String(r.data.link));
  }
  if (link) {
    return <OneTimeLink lang={lang} link={link} note={L(lang, `Para ${email}. Sirve una vez durante 48 horas; cierra su sesión en todos lados.`, `For ${email}. Works once for 48 hours; signs them out everywhere.`)} />;
  }
  return <button className="btn small" onClick={make} disabled={busy}>{L(lang, "Enlace para cambiar contraseña", "Password reset link")}</button>;
}

export function AccountBillingForm({
  lang, id, initial,
}: {
  lang: Lang; id: string;
  initial: { plan: PlanId; status: AccountStatus; trialEndsAt: string; monthlyFeeCents: number; billingEmail: string; billingNotes: string };
}) {
  const [plan, setPlan] = useState<PlanId>(initial.plan);
  const [status, setStatus] = useState<AccountStatus>(initial.status);
  const [trial, setTrial] = useState(initial.trialEndsAt.slice(0, 10));
  const [fee, setFee] = useState((initial.monthlyFeeCents / 100).toFixed(2));
  const [email, setEmail] = useState(initial.billingEmail);
  const [notes, setNotes] = useState(initial.billingNotes);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const cents = Math.round(Number(fee.replace(/[^0-9.]/g, "")) * 100);
    setBusy(true);
    const r = await call(`/api/admin/accounts/${id}`, "PATCH", {
      plan, status, trialEndsAt: trial, monthlyFeeCents: Number.isFinite(cents) ? cents : -1, billingEmail: email, billingNotes: notes,
    });
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: L(lang, "Guardado", "Saved") } : { ok: false, text: L(lang, "Revisa: ", "Check: ") + ((r.data.errors as string[]) ?? []).join(", ") });
  }

  return (
    <form onSubmit={submit} className="stack" noValidate>
      <div className="grid2">
        <div className="field">
          <label htmlFor="plan">{L(lang, "Plan", "Plan")}</label>
          <select id="plan" value={plan} onChange={(e) => setPlan(e.target.value as PlanId)}>
            {PLAN_IDS.map((p) => <option key={p} value={p}>{PLANS[p].name[lang]}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="status">{L(lang, "Estado", "Status")}</label>
          <select id="status" value={status} onChange={(e) => setStatus(e.target.value as AccountStatus)}>
            <option value="active">{L(lang, "Activa", "Active")}</option>
            <option value="suspended">{L(lang, "Pausada (no puede crear)", "Paused (can't create)")}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="trial">{L(lang, "La prueba termina", "Trial ends")}</label>
          <input id="trial" type="date" value={trial} onChange={(e) => setTrial(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="fee">{L(lang, "Cuota mensual (USD)", "Monthly fee (USD)")}</label>
          <input id="fee" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="billing-email">{L(lang, "Email de cobro", "Billing email")}</label>
        <input id="billing-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="notes">{L(lang, "Notas de cobro", "Billing notes")}</label>
        <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} placeholder={L(lang, "Ej.: paga por Zelle el día 5", "E.g. pays by Zelle on the 5th")} />
      </div>
      <div className="row">
        <button className="btn primary" disabled={busy}>{L(lang, "Guardar", "Save")}</button>
        {msg && <span className={msg.ok ? "muted small" : "note bad small"} role="status">{msg.text}</span>}
      </div>
    </form>
  );
}
