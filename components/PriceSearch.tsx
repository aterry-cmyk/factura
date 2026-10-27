"use client";

import { useState } from "react";
import type { PriceOption } from "@/lib/ai/costs";
import type { RateOption } from "@/lib/prices/onebuild";
import { formatMoney } from "@/lib/money";
import type { Lang } from "@/lib/types";
import { blockMessage } from "@/lib/plans";

const L = (lang: Lang, es: string, en: string) => (lang === "es" ? es : en);
type Own = { description: string; vendor: string; amountCents: number; spentOn: string; project: string };

/**
 * A material's price: what this business paid before (its receipts) first, then a live search of
 * real product pages. Every found price shows the page it came from and the day it was found,
 * and says to confirm before buying. A price with no page is never shown.
 */
export function PriceSearch({ lang, aiReady, recent }: { lang: Lang; aiReady: boolean; recent: { query: string; results: PriceOption[]; at: string }[] }) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [own, setOwn] = useState<Own[]>([]);
  const [options, setOptions] = useState<PriceOption[]>([]);
  const [rates, setRates] = useState<RateOption[]>([]);
  const [feed, setFeed] = useState("setup");
  const [foundOn, setFoundOn] = useState("");
  const [state, setState] = useState<"idle" | "ok" | "ai_setup" | "no_search" | "failed">("idle");
  const [error, setError] = useState("");

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim().length < 2) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/prices/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) }).catch(() => null);
    const json = res ? ((await res.json().catch(() => ({}))) as { own?: Own[]; rates?: RateOption[]; feed?: string; options?: PriceOption[]; search?: string; foundOn?: string; error?: string }) : {};
    setBusy(false);
    if (!res?.ok) return setError(res?.status === 402 ? (blockMessage(json.error, lang) ?? "") : L(lang, "No se pudo buscar. Intenta otra vez.", "The search failed. Try again."));
    setOwn(json.own ?? []);
    setOptions(json.options ?? []);
    setRates(json.rates ?? []);
    setFeed(json.feed ?? "setup");
    setFoundOn(json.foundOn ?? "");
    setState(json.search === "ok" ? "ok" : json.search === "ai_setup" ? "ai_setup" : json.search === "no_search" ? "no_search" : "failed");
  }

  const copy = async (o: PriceOption) => {
    try { await navigator.clipboard.writeText(`${o.product} — ${formatMoney(o.priceCents, lang)} ${o.unit} (${o.vendor}, ${o.url})`); } catch { /* the line is on screen */ }
  };

  return (
    <div className="stack">
      <form className="card" onSubmit={search}>
        <label className="field">
          <span className="field-label">{L(lang, "¿Qué material?", "Which material?")}</span>
          <div className="row">
            <input className="grow" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={L(lang, "drywall 1/2 4x8, pintura interior galón, tubería PVC 2 pulgadas…", "1/2 drywall 4x8, interior paint gallon, 2 inch PVC pipe…")} maxLength={200} data-testid="price-query" />
            <button className="btn primary" disabled={busy || query.trim().length < 2} data-testid="price-search">{busy ? L(lang, "Buscando…", "Searching…") : L(lang, "Buscar precio", "Find the price")}</button>
          </div>
        </label>
        {error && <p className="note bad" role="alert">{error}</p>}
      </form>

      {state !== "idle" && (
        <section className="card" data-testid="own-prices">
          <h3 style={{ marginTop: 0 }}>{L(lang, "Lo que tú has pagado", "What you have paid")}</h3>
          {own.length ? (
            <ul className="list small">
              {own.map((o, i) => (
                <li key={i} className="row" style={{ padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
                  <span className="muted" style={{ width: 86 }}>{o.spentOn}</span>
                  <span className="grow">{o.description}{o.vendor ? ` · ${o.vendor}` : ""} <span className="muted">({o.project})</span></span>
                  <strong className="amount">{formatMoney(o.amountCents, lang)}</strong>
                </li>
              ))}
            </ul>
          ) : <p className="muted small" style={{ margin: 0 }}>{L(lang, "Ningún recibo tuyo menciona eso todavía. Cuando fotografíes recibos en tus proyectos, tus precios aparecerán aquí primero.", "None of your receipts mention that yet. As you photograph receipts on your projects, your own prices show here first.")}</p>}
        </section>
      )}

      {state !== "idle" && (
        <section className="card" data-testid="county-rates">
          <h3 style={{ marginTop: 0 }}>{L(lang, "Tarifas por condado (1build)", "County rates (1build)")}</h3>
          {feed === "setup" && <p className="note small" style={{ margin: 0 }}>{L(lang, "La fuente de tarifas por condado no está conectada todavía (falta la clave de 1build). Mientras tanto: tus recibos y la búsqueda en línea.", "The county cost feed isn't connected yet (the 1build key is missing). Meanwhile: your receipts and the online search.")}</p>}
          {feed === "failed" && <p className="note bad" style={{ margin: 0 }}>{L(lang, "La fuente de tarifas no respondió.", "The cost feed didn't answer.")}</p>}
          {feed === "ok" && rates.length === 0 && <p className="muted small" style={{ margin: 0 }}>{L(lang, "Sin resultados en la fuente para eso.", "No results in the feed for that.")}</p>}
          {rates.length > 0 && (
            <ul className="list small">
              {rates.map((r) => (
                <li key={r.id} className="row" style={{ padding: "6px 0", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }} data-testid="rate-option">
                  <span className="grow">{r.name} <span className="muted">· {r.county ? `${r.county}, ` : ""}{r.state}</span>{r.url ? <> · <a href={r.url} target="_blank" rel="noreferrer">{L(lang, "producto", "product")}</a></> : null}</span>
                  <strong className="amount">{formatMoney(r.unitRateCents, lang)} <span className="muted small">/ {r.unit}</span></strong>
                  {r.laborCents ? <span className="muted small">{L(lang, "mano de obra", "labor")} {formatMoney(r.burdenedLaborCents || r.laborCents, lang)}/h</span> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {state !== "idle" && (
        <section className="card" data-testid="found-prices">
          <h3 style={{ marginTop: 0 }}>{L(lang, "Encontrado en línea", "Found online")}</h3>
          {state === "ai_setup" && <p className="note warn">{L(lang, "Loro no está conectado todavía (falta la clave de IA), así que no puede buscar en línea.", "Loro isn't connected yet (the AI key is missing), so it can't search online.")}</p>}
          {state === "no_search" && <p className="note warn">{L(lang, "La búsqueda web no está habilitada en la cuenta de IA. Hay que activarla en el panel de Anthropic.", "Web search isn't enabled on the AI account. It has to be turned on in the Anthropic console.")}</p>}
          {state === "failed" && <p className="note bad">{L(lang, "La búsqueda falló. Intenta con otras palabras.", "The search failed. Try other words.")}</p>}
          {state === "ok" && options.length === 0 && <p className="muted small" style={{ margin: 0 }}>{L(lang, "No encontré una página con ese precio. Prueba con la medida o la marca.", "I didn't find a page with that price. Try the size or the brand.")}</p>}
          {options.length > 0 && (
            <>
              <ul className="list small">
                {options.map((o, i) => (
                  <li key={i} className="row" style={{ padding: "8px 0", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }} data-testid="price-option">
                    <span className="grow">
                      <strong>{o.vendor}</strong> · {o.product}{o.where ? <span className="muted"> · {o.where}</span> : null}
                      <br /><a href={o.url} target="_blank" rel="noreferrer" className="small">{L(lang, "Ver la página", "See the page")}</a>
                    </span>
                    <strong className="amount">{formatMoney(o.priceCents, lang)} <span className="muted small">{o.unit}</span></strong>
                    <button type="button" className="btn small" onClick={() => copy(o)}>{L(lang, "Copiar", "Copy")}</button>
                  </li>
                ))}
              </ul>
              <p className="muted small" style={{ marginBottom: 0 }}>{L(lang, `Precios vistos el ${foundOn}; cambian por tienda y por día. Confirma antes de comprar.`, `Prices seen on ${foundOn}; they change by store and by day. Confirm before buying.`)}</p>
            </>
          )}
        </section>
      )}

      {recent.length > 0 && state === "idle" && (
        <section className="card">
          <h3 style={{ marginTop: 0 }}>{L(lang, "Búsquedas recientes", "Recent searches")}</h3>
          <ul className="list small">
            {recent.map((r) => (
              <li key={r.at} style={{ padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
                <button type="button" className="btn small" onClick={() => setQuery(r.query)}>{r.query}</button>
                <span className="muted"> · {r.results.length} {L(lang, "precios", "prices")} · {new Date(r.at).toLocaleDateString(lang === "es" ? "es-US" : "en-US")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
