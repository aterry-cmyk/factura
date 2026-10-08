"use client";

import Link from "next/link";
import { useState } from "react";
import { errorText, type AuthText } from "@/lib/auth-text";
import type { Lang } from "@/lib/types";

async function post(url: string, body: object): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: data.error };
  } catch {
    return { ok: false };
  }
}

export function PasswordField({
  id, label, value, onChange, t, autoComplete, hint,
}: {
  id: string; label: string; value: string; onChange: (v: string) => void; t: AuthText;
  autoComplete: "current-password" | "new-password"; hint?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="pw">
        <input id={id} type={show ? "text" : "password"} autoComplete={autoComplete} value={value}
          onChange={(e) => onChange(e.target.value)} aria-describedby={hint ? `${id}-hint` : undefined} />
        <button type="button" className="btn small ghost" onClick={() => setShow(!show)} aria-pressed={show}>
          {show ? t.hidePassword : t.showPassword}
        </button>
      </div>
      {hint && <span className="hint" id={`${id}-hint`}>{hint}</span>}
    </div>
  );
}

function ErrorNote({ t, code }: { t: AuthText; code: string | null }) {
  return code === null ? null : <p className="note bad" role="alert">{errorText(t, code || undefined)}</p>;
}

export function LoginForm({ t, lang }: { t: AuthText; lang: Lang }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const q = lang === "en" ? "?lang=en" : "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await post("/api/login", { email, password });
    if (r.ok) {
      window.location.href = "/";
      return;
    }
    setBusy(false);
    setError(r.error ?? "");
  }

  return (
    <form onSubmit={submit} className="stack" noValidate>
      <div className="field">
        <label htmlFor="email">{t.email}</label>
        <input id="email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
      </div>
      <PasswordField id="password" label={t.password} value={password} onChange={setPassword} t={t} autoComplete="current-password" />
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 4 }}>
        <Link href={`/forgot${q}`} className="small">{t.forgot}</Link>
      </div>
      <ErrorNote t={t} code={error} />
      <button className="btn primary block" disabled={busy || !email || !password}>{busy ? t.signingIn : t.signIn}</button>
    </form>
  );
}

export function SignupForm({ t, lang, invite, invitedEmail }: { t: AuthText; lang: Lang; invite?: string; invitedEmail?: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState(invitedEmail ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await post("/api/signup", { name, email, password, invite, lang });
    if (r.ok) {
      window.location.href = "/welcome";
      return;
    }
    setBusy(false);
    setError(r.error ?? "");
  }

  return (
    <form onSubmit={submit} className="stack" noValidate>
      <div className="field">
        <label htmlFor="name">{t.yourName}</label>
        <input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.namePlaceholder} autoFocus maxLength={120} />
      </div>
      <div className="field">
        <label htmlFor="email">{t.email}</label>
        <input id="email" type="email" inputMode="email" autoComplete="email" value={email}
          onChange={(e) => setEmail(e.target.value)} readOnly={Boolean(invitedEmail)} />
      </div>
      <PasswordField id="password" label={t.password} value={password} onChange={setPassword} t={t} autoComplete="new-password" hint={t.passwordHint} />
      <ErrorNote t={t} code={error} />
      <button className="btn primary block" disabled={busy || !name.trim() || !email || !password}>{busy ? t.creating : t.createButton}</button>
    </form>
  );
}

export function ResetForm({ t, token }: { t: AuthText; token: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await post("/api/reset", { token, password });
    if (r.ok) {
      window.location.href = "/";
      return;
    }
    setBusy(false);
    setError(r.error ?? "");
  }

  return (
    <form onSubmit={submit} className="stack" noValidate>
      <PasswordField id="password" label={t.newPassword} value={password} onChange={setPassword} t={t} autoComplete="new-password" hint={t.passwordHint} />
      <ErrorNote t={t} code={error} />
      <button className="btn primary block" disabled={busy || !password}>{busy ? "…" : t.resetButton}</button>
    </form>
  );
}

export function ClaimForm({ t }: { t: AuthText }) {
  const [ownerPassword, setOwnerPassword] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await post("/api/claim", { ownerPassword, name, email, password });
    if (r.ok) {
      window.location.href = "/";
      return;
    }
    setBusy(false);
    setError(r.error ?? "");
  }

  return (
    <form onSubmit={submit} className="stack" noValidate>
      <PasswordField id="old-password" label={t.oldPassword} value={ownerPassword} onChange={setOwnerPassword} t={t} autoComplete="current-password" />
      <div className="field">
        <label htmlFor="name">{t.yourName}</label>
        <input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
      </div>
      <div className="field">
        <label htmlFor="email">{t.email}</label>
        <input id="email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <PasswordField id="password" label={t.newPassword} value={password} onChange={setPassword} t={t} autoComplete="new-password" hint={t.passwordHint} />
      <ErrorNote t={t} code={error} />
      <button className="btn primary block" disabled={busy || !ownerPassword || !name.trim() || !email || !password}>{busy ? "…" : t.claimButton}</button>
    </form>
  );
}
