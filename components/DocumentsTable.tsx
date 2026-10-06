"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { BulkAction } from "@/lib/doc-list";
import { dict } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import type { DocKind, DocStatus, Lang } from "@/lib/types";

export interface DocRow {
  id: string;
  number: string;
  kind: DocKind;
  status: DocStatus;
  customer: string;
  summary: string;
  issueDate: string;
  dueDate: string;
  totalCents: number;
  overdue: boolean;
  statusText: string;
}

const tone = (r: DocRow) => (r.overdue ? "bad" : r.status === "paid" || r.status === "accepted" ? "" : r.status === "draft" || r.status === "void" ? "grey" : "warn");

export function DocumentsTable({ lang, docs }: { lang: Lang; docs: DocRow[] }) {
  const t = dict(lang);
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<BulkAction | null>(null);
  const [msg, setMsg] = useState<{ kind: "" | "bad"; text: string } | null>(null);
  const all = docs.length > 0 && docs.every((d) => picked.has(d.id));

  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function run(action: BulkAction) {
    const ids = [...picked];
    if (!ids.length) return;
    if (action === "void" && !window.confirm(t.bulkVoidConfirm(ids.length))) return;
    setBusy(action);
    setMsg(null);
    const res = await fetch("/api/documents/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, action }),
    }).catch(() => null);
    setBusy(null);
    if (!res?.ok) return setMsg({ kind: "bad", text: t.errorGeneric });
    const r = (await res.json()) as { done: number; skipped: unknown[]; failed: { reason: string }[] };
    const parts = [t.bulkDone(action, r.done)];
    if (r.skipped.length) parts.push(t.bulkSkipped(r.skipped.length));
    if (r.failed.length) parts.push(r.failed.some((f) => f.reason === "setup") ? t.bulkSetup : t.bulkFailed(r.failed.length));
    setMsg({ kind: r.failed.length ? "bad" : "", text: parts.join(" ") });
    setPicked(new Set());
    router.refresh();
  }

  return (
    <section className="card" data-testid="documents">
      <div className="bulkbar">
        <label className="check">
          <input type="checkbox" checked={all} onChange={() => setPicked(all ? new Set() : new Set(docs.map((d) => d.id)))} />
          {picked.size ? t.selected(picked.size) : t.selectAll}
        </label>
        {picked.size > 0 && (
          <div className="row">
            <button className="btn small" onClick={() => run("paid")} disabled={busy !== null}>{busy === "paid" ? "…" : t.bulkPaid}</button>
            <button className="btn small" onClick={() => run("remind")} disabled={busy !== null}>{busy === "remind" ? "…" : t.bulkRemind}</button>
            <button className="btn small danger" onClick={() => run("void")} disabled={busy !== null}>{busy === "void" ? "…" : t.bulkVoid}</button>
          </div>
        )}
      </div>
      {msg && <p className={`note ${msg.kind}`} role="status">{msg.text}</p>}
      <ul className="list doclist">
        {docs.map((d) => (
          <li key={d.id} data-testid="doc-row" data-number={d.number}>
            <input type="checkbox" aria-label={`${d.number} ${d.customer}`} checked={picked.has(d.id)} onChange={() => toggle(d.id)} />
            <Link href={`/documents/${d.id}`}>
              <div className="grow" style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{d.customer}</div>
                <div className="muted small ellipsis">
                  {d.kind === "invoice" ? t.invoice : t.estimate} {d.number} · {d.issueDate}
                  {d.kind === "invoice" && d.status === "sent" ? ` · ${t.dueOn} ${d.dueDate}` : ""}
                </div>
                <div className="muted small ellipsis">{d.summary}</div>
              </div>
              <span className={`badge ${tone(d)}`}>{d.statusText}</span>
              <span className="amount">{formatMoney(d.totalCents, lang)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
