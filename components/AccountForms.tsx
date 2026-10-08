"use client";

import { useState } from "react";
import { PasswordField } from "@/components/AuthForms";
import { errorText, type AuthText } from "@/lib/auth-text";

async function send(url: string, method: string, body?: object) {
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const data = (await res.json().catch(() => ({}))) as { error?: string; ended?: number };
    return { ok: res.ok, error: data.error, ended: data.ended };
  } catch {
    return { ok: false, error: undefined, ended: undefined };
  }
}

type Note = { kind: "ok" | "bad"; text: string } | null;

export function NameForm({ t, initial, labels }: { t: AuthText; initial: string; labels: { title: string } }) {
  const [name, setName] = useState(initial);
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await send("/api/account", "PATCH", { name });
    setBusy(false);
    setNote(r.ok ? { kind: "ok", text: t.saved } : { kind: "bad", text: errorText(t, r.error) });
  }
  return (
    <form onSubmit={submit} className="stack" noValidate>
      <div className="field">
        <label htmlFor="acct-name">{labels.title}</label>
        <input id="acct-name" autoComplete="name" value={name} onChange={(e) => { setName(e.target.value); setNote(null); }} maxLength={120} />
      </div>
      <div className="row">
        <button className="btn" disabled={busy || !name.trim() || name.trim() === initial}>{t.save}</button>
        {note && <span className={`small ${note.kind === "bad" ? "note bad" : "muted"}`} role="status">{note.text}</span>}
      </div>
    </form>
  );
}

export function PasswordForm({ t, labels }: { t: AuthText; labels: { change: string; done: string } }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await send("/api/account/password", "POST", { current, next });
    setBusy(false);
    if (r.ok) {
      setCurrent("");
      setNext("");
      setNote({ kind: "ok", text: labels.done });
    } else setNote({ kind: "bad", text: errorText(t, r.error) });
  }
  return (
    <form onSubmit={submit} className="stack" noValidate>
      <PasswordField id="pw-current" label={t.currentPassword} value={current} onChange={setCurrent} t={t} autoComplete="current-password" />
      <PasswordField id="pw-next" label={t.newPassword} value={next} onChange={setNext} t={t} autoComplete="new-password" hint={t.passwordHint} />
      {note && <p className={`note ${note.kind === "bad" ? "bad" : ""}`} role="status">{note.text}</p>}
      <button className="btn" disabled={busy || !current || !next}>{labels.change}</button>
    </form>
  );
}

/** `done` has a {n} where the number of ended sessions goes (functions can't come from the server). */
export function SignOutOthers({ labels }: { labels: { button: string; done: string } }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    const r = await send("/api/account/sessions", "DELETE");
    setBusy(false);
    setMsg(r.ok ? labels.done.replace("{n}", String(r.ended ?? 0)) : "");
  }
  return (
    <div className="row">
      <button className="btn" onClick={go} disabled={busy}>{labels.button}</button>
      {msg && <span className="muted small" role="status">{msg}</span>}
    </div>
  );
}
