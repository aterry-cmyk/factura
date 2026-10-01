"use client";

import { useState } from "react";
import { dict } from "@/lib/i18n";
import type { Business, Lang } from "@/lib/types";

export function SettingsForm({ lang, hasLogo, business: initial }: { lang: Lang; hasLogo: boolean; business: Business }) {
  const t = dict(lang);
  const [b, setB] = useState({ ...initial, phone: initial.phone.replace(/^\+1/, "") });
  const [msg, setMsg] = useState<{ kind: "" | "bad"; text: string } | null>(null);
  const [logoVersion, setLogoVersion] = useState(hasLogo ? 1 : 0);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business: b }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) return setMsg({ kind: "", text: t.saved });
    const json = res ? ((await res.json().catch(() => ({}))) as { errors?: string[] }) : {};
    setMsg({ kind: "bad", text: json.errors?.map((e) => e.replace(/^[\w.]+: /, "")).join(" ") ?? t.errorGeneric });
  }

  async function upload(file: File) {
    const form = new FormData();
    form.append("logo", file);
    const res = await fetch("/api/settings/logo", { method: "POST", body: form }).catch(() => null);
    if (res?.ok) {
      setLogoVersion((v) => v + 1);
      setMsg({ kind: "", text: t.saved });
    } else {
      const code = res ? ((await res.json().catch(() => ({}))) as { error?: string }).error : "";
      setMsg({
        kind: "bad",
        text: code === "too_big" ? (lang === "es" ? "El logo debe pesar menos de 1 MB." : "The logo must be under 1 MB.")
          : lang === "es" ? "Usa un archivo PNG o JPG." : "Use a PNG or JPG file.",
      });
    }
  }

  async function removeLogo() {
    await fetch("/api/settings/logo", { method: "DELETE" });
    setLogoVersion(0);
  }

  const field = (key: keyof Business, label: string, type = "text") => (
    <div>
      <label htmlFor={`s-${key}`}>{label}</label>
      <input id={`s-${key}`} type={type} value={b[key]} onChange={(e) => setB({ ...b, [key]: e.target.value })} />
    </div>
  );

  return (
    <section className="card stack">
      <div>
        <label>{t.logo}</label>
        <div className="row">
          {logoVersion > 0 && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/settings/logo?v=${logoVersion}`} alt="Logo" style={{ maxHeight: 64, maxWidth: 180, background: "#fff", borderRadius: 8, padding: 4 }} />
          )}
          <input type="file" accept="image/png,image/jpeg" aria-label={t.logo} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} style={{ maxWidth: 260 }} />
          {logoVersion > 0 && <button className="btn small danger" onClick={removeLogo}>{t.removeLogo}</button>}
        </div>
      </div>
      {field("name", t.businessName)}
      {field("ownerName", t.yourName)}
      {field("phone", t.yourPhone, "tel")}
      {field("email", t.yourEmail, "email")}
      {field("address", t.yourAddress)}
      {field("website", "Web")}
      {msg && <p className={`note ${msg.kind}`} role="status">{msg.text}</p>}
      <button className="btn primary" onClick={save} disabled={busy}>{t.save}</button>
    </section>
  );
}
