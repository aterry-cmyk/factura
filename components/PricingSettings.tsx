"use client";

import { useState } from "react";
import type { Lang } from "@/lib/types";

const L = (lang: Lang, es: string, en: string) => (lang === "es" ? es : en);

/** The owner's pricing rules: markup on cost and contingency, applied to every proposal. */
export function PricingSettings({ lang, markupPercent, contingencyPercent }: { lang: Lang; markupPercent: number; contingencyPercent: number }) {
  const [markup, setMarkup] = useState(String(markupPercent || ""));
  const [contingency, setContingency] = useState(String(contingencyPercent || ""));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pricing: { markupPercent: Number(markup || 0), contingencyPercent: Number(contingency || 0) } }) }).catch(() => null);
    setBusy(false);
    setNote(res?.ok ? { kind: "ok", text: L(lang, "Reglas guardadas. Se aplican a cada propuesta nueva.", "Rules saved. They apply to every new proposal.") } : { kind: "bad", text: L(lang, "Margen de 0 a 300%, contingencia de 0 a 100%.", "Markup 0 to 300%, contingency 0 to 100%.") });
  }
  return (
    <form className="card" onSubmit={save} data-testid="pricing">
      <h3 style={{ marginTop: 0 }}>{L(lang, "Margen y contingencia", "Markup and contingency")}</h3>
      <p className="muted small">{L(lang, "Tus reglas de precio: ninguna propuesta sale sin tu margen. Loro nunca los cambia.", "Your pricing rules: no proposal goes out without your markup. Loro never changes them.")}</p>
      <div className="grid2">
        <label className="field"><span className="field-label">{L(lang, "Margen sobre el costo %", "Markup on cost %")}</span><input inputMode="decimal" value={markup} onChange={(e) => setMarkup(e.target.value)} placeholder="25" data-testid="markup-setting" /></label>
        <label className="field"><span className="field-label">{L(lang, "Contingencia %", "Contingency %")}</span><input inputMode="decimal" value={contingency} onChange={(e) => setContingency(e.target.value)} placeholder="10" data-testid="contingency-setting" /></label>
      </div>
      {note && <p className={`note ${note.kind}`} role="status" style={{ marginTop: 8 }}>{note.text}</p>}
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 10 }}><button className="btn primary" disabled={busy} data-testid="save-pricing">{L(lang, "Guardar reglas", "Save rules")}</button></div>
    </form>
  );
}
