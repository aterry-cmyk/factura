"use client";

import { useState } from "react";

export function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (res.ok) window.location.href = "/";
    else setError(res.status === 401 ? "Contraseña incorrecta. / Wrong password." : "Falta configurar la app. / The app isn't set up yet.");
  }

  return (
    <form onSubmit={submit} className="stack">
      <div>
        <label htmlFor="password">Contraseña / Password</label>
        <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
      </div>
      {error && <p className="note bad" role="alert">{error}</p>}
      <button className="btn primary block" disabled={busy || !password}>
        {busy ? "…" : "Entrar / Sign in"}
      </button>
    </form>
  );
}
