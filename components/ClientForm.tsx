"use client";

import { useState } from "react";
import type { Client } from "@/lib/projects-store";
import type { Lang } from "@/lib/types";

const L = (lang: Lang, es: string, en: string) => (lang === "es" ? es : en);

/** The client's record: contact, address and notes, edited in place. */
export function ClientForm({ lang, client }: { lang: Lang; client: Client }) {
  const [c, setC] = useState({ name: client.name, company: client.company, email: client.email, phone: client.phone.replace(/^\+1/, ""), address: client.address, notes: client.notes });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch(`/api/customers/${client.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c) }).catch(() => null);
    const json = res ? ((await res.json().catch(() => ({}))) as { errors?: string[] }) : {};
    setBusy(false);
    setNote(res?.ok ? { kind: "ok", text: L(lang, "Cliente guardado.", "Client saved.") } : { kind: "bad", text: json.errors?.join(" ") ?? L(lang, "No se pudo guardar.", "Couldn't save.") });
  }
  const f = (k: keyof typeof c) => ({ value: c[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setC({ ...c, [k]: e.target.value }) });
  return (
    <form className="card" onSubmit={save} data-testid="client-form">
      <div className="grid2">
        <label className="field"><span className="field-label">{L(lang, "Nombre", "Name")}</span><input {...f("name")} maxLength={120} required /></label>
        <label className="field"><span className="field-label">{L(lang, "Empresa", "Company")}</span><input {...f("company")} maxLength={120} /></label>
        <label className="field"><span className="field-label">{L(lang, "Teléfono", "Phone")}</span><input {...f("phone")} inputMode="tel" maxLength={40} /></label>
        <label className="field"><span className="field-label">{L(lang, "Correo", "Email")}</span><input {...f("email")} inputMode="email" maxLength={200} /></label>
      </div>
      <label className="field" style={{ marginTop: 10 }}><span className="field-label">{L(lang, "Dirección de la obra", "Job address")}</span><input {...f("address")} maxLength={300} data-testid="client-address" /></label>
      <label className="field" style={{ marginTop: 10 }}><span className="field-label">{L(lang, "Notas", "Notes")}</span><textarea {...f("notes")} rows={3} maxLength={2000} placeholder={L(lang, "Cómo llegó, qué le importa, horarios…", "How they found you, what they care about, hours…")} /></label>
      {note && <p className={`note ${note.kind}`} role="status" style={{ marginTop: 8 }}>{note.text}</p>}
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
        <button className="btn primary" disabled={busy} data-testid="save-client">{busy ? L(lang, "Guardando…", "Saving…") : L(lang, "Guardar cliente", "Save client")}</button>
      </div>
    </form>
  );
}
