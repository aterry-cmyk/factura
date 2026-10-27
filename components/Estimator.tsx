"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { blockMessage } from "@/lib/plans";
import { PRICED_EXAMPLES, PRICED_LOOK, SPACES, designFor, spaceIds } from "@/lib/estimator/catalog";
import { draftItems, draftNotes, pricedAll, rangeText, totalRange, type EstimatorProduct } from "@/lib/estimator/draft";
import { HOME, STORIES, TRADES, choiceKeys, complete, spaceOf, tradeIds, weeksFor, weeksText, withDefaults, type Answers, type Home, type Opt, type Question, type Space } from "@/lib/estimator/pricebook";
import { estimatorText } from "@/lib/estimator/text";
import type { Lang, Settings } from "@/lib/types";
import { Creator, type Prefill } from "./Creator";
import { shrinkPhoto } from "./shrinkPhoto";

interface Reading {
  space: Space;
  summary: string;
  observations: string[];
  suggestions: { trade: string; reason: string; priority: "high" | "medium" | "low" }[];
}
type Look = Reading | { error: string } | null;
interface Product extends EstimatorProduct { search: string }

const ICONS: Record<Space, string> = { exterior: "🏠", kitchen: "🍳", bathroom: "🛁", basement: "🛋️", room: "🪟" };

const toDataUrl = (blob: Blob) =>
  new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = no; r.readAsDataURL(blob); });

async function postJson<T>(url: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; code: string }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  if (!res) return { ok: false, code: "" };
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  return res.ok ? { ok: true, data } : { ok: false, code: data.error ?? "" };
}

/**
 * Photo → what Loro sees and which projects fit → a few questions per project (with AI example
 * pictures for the quality and material choices) → the look → a preview made from the customer's
 * photo, with similar products at Home Depot → a price range and time on site → a Loro estimate,
 * every line a suggested price the owner confirms.
 */
export function Estimator({ lang, defaults, ai, images, cloudVoice, model }: { lang: Lang; defaults: Settings; ai: boolean; images: boolean; cloudVoice: boolean; model: string }) {
  const t = estimatorText(lang);
  const [step, setStep] = useState(0);
  const [hint, setHint] = useState<Space | "none" | "">("");
  const [photo, setPhoto] = useState("");
  const [look, setLook] = useState<Look>(null);
  const [space, setSpace] = useState<Space | "">("");
  const [trades, setTrades] = useState<string[]>([]);
  const [ans, setAns] = useState<Record<string, Answers>>({});
  const [home, setHome] = useState<Home>({ size: "", stories: "2" });
  const [design, setDesign] = useState<Record<string, string>>({});
  const [ex, setEx] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState({ url: "", busy: false, made: 0, error: "" });
  const [prod, setProd] = useState<{ items: Product[] | null; notes: string[]; busy: boolean; error: string }>({ items: null, notes: [], busy: false, error: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const pending = useRef(new Set<string>());
  const top = useRef<HTMLDivElement>(null);

  const withPhoto = hint !== "" && hint !== "none";
  const looks = space ? designFor(space, trades) : [];
  const steps = useMemo(() => {
    const s = ["start", ...(withPhoto ? ["photo", "look"] : ["trades"]), ...trades.map((x) => `q:${x}`)];
    if (withPhoto && photo && images && space && looks.length) s.push("design");
    if (withPhoto && photo && images && space) s.push("preview");
    s.push("result");
    return s;
  }, [withPhoto, trades, photo, images, space, looks.length]);
  const key = steps[Math.min(step, steps.length - 1)];

  const priced = useMemo(() => pricedAll(trades.filter((x) => complete(x, ans[x] ?? {}, home)), ans, home, defaults.state), [trades, ans, home, defaults.state]);
  const pricedKeys = trades.flatMap((x) => choiceKeys(x, ans[x] ?? {}));

  // ---------- example pictures for what's on screen ----------
  const exKeys = useMemo(() => {
    if (!images) return [];
    if (key.startsWith("q:")) {
      const tr = key.slice(2), a = ans[tr] ?? {};
      return TRADES[tr].q.filter((q) => (!q.when || q.when(a)) && q.type === "choice" && PRICED_EXAMPLES[`${tr}.${q.id}`])
        .flatMap((q) => (q as { opts: Opt[] }).opts.filter((o) => PRICED_LOOK[`${tr}.${q.id}.${o.v}`]).map((o) => `t:${tr}.${q.id}.${o.v}`));
    }
    if (key === "design" && space) return looks.flatMap((q) => q.opts.map((o) => `d:${space}.${q.id}.${o.v}`));
    return [];
  }, [key, ans, images, space, looks]);
  useEffect(() => {
    const want = exKeys.filter((k) => !(k in ex) && !pending.current.has(k));
    for (let i = 0; i < want.length; i += 6) {
      const chunk = want.slice(i, i + 6);
      chunk.forEach((k) => pending.current.add(k));
      postJson<{ images: Record<string, string> }>("/api/estimator/examples", { keys: chunk }).then((r) => {
        setEx((prev) => { const next = { ...prev }; for (const k of chunk) next[k] = r.ok ? r.data.images[k] ?? "" : ""; return next; });
        chunk.forEach((k) => pending.current.delete(k));
      });
    }
  }, [exKeys, ex]);

  // ---------- the preview starts itself the first time its step opens ----------
  useEffect(() => {
    if (key === "preview" && !preview.url && !preview.busy && !preview.made && !preview.error) makePreview();
  }, [key]);

  if (prefill) {
    return <Creator lang={lang} defaults={defaults} ai={ai} cloudVoice={cloudVoice} prefill={prefill} />;
  }

  function addTrade(id: string, list = trades) {
    if (!TRADES[id] || list.includes(id)) return list;
    setAns((a) => ({ ...a, [id]: withDefaults(id, a[id]) }));
    return [...list, id];
  }
  function toggleTrade(id: string) {
    setTrades(trades.includes(id) ? trades.filter((x) => x !== id) : addTrade(id));
    setPreview({ url: "", busy: false, made: 0, error: "" });
  }
  function answer(id: string, qid: string, v: string | number, multi = false) {
    setAns((all) => {
      const a = { ...(all[id] ?? {}) };
      if (multi) { const cur = (a[qid] as string[]) ?? []; a[qid] = cur.includes(String(v)) ? cur.filter((x) => x !== v) : [...cur, String(v)]; }
      else a[qid] = v;
      return { ...all, [id]: a };
    });
    if (preview.url) setPreview({ url: "", busy: false, made: 0, error: "" });
  }

  function problem(): string {
    if (key === "start" && !hint) return t.whatFor;
    if (key === "photo" && !photo) return t.takePhoto;
    if ((key === "look" || key === "trades") && !trades.length) return t.pickOne;
    if (key.startsWith("q:") && !complete(key.slice(2), ans[key.slice(2)] ?? {}, home)) return t.answerAll;
    if (key === "design") { const miss = looks.find((q) => !design[q.id]); if (miss) return t.pickLook(miss.label[lang]); }
    if (key === "preview" && preview.busy) return t.wait;
    return "";
  }

  async function go(d: number) {
    setError("");
    if (d > 0) {
      const p = problem();
      if (p) return setError(p);
      if (key === "photo" && !look) await readPhoto();
    }
    setStep((s) => Math.max(0, Math.min(steps.length - 1, s + d)));
    top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    setError("");
    try {
      setPhoto(await toDataUrl(await shrinkPhoto(file, 1280)));
      setLook(null); setTrades([]); setDesign({}); setPreview({ url: "", busy: false, made: 0, error: "" });
    } catch {
      setError(t.generic);
    }
  }

  async function readPhoto() {
    const fallback = (msg: string) => { setLook({ error: msg }); setSpace(hint as Space); };
    if (!ai) return fallback(t.aiOff);
    setBusy(true);
    const r = await postJson<Reading>("/api/estimator/read", { photo, hint });
    setBusy(false);
    if (!r.ok) return fallback(blockMessage(r.code, lang) ?? (r.code === "not_home" ? t.notHome : t.readFailed));
    setLook(r.data);
    setSpace(r.data.space);
    let list: string[] = [];
    for (const s of r.data.suggestions) if (s.priority !== "low") list = addTrade(s.trade, list);
    setTrades(list);
  }

  async function makePreview() {
    if (!space) return;
    setPreview((p) => ({ ...p, busy: true, error: "" }));
    setProd({ items: null, notes: [], busy: false, error: "" });
    const r = await postJson<{ url: string }>("/api/estimator/preview", { photo, space, design, priced: pricedKeys });
    if (!r.ok) return setPreview((p) => ({ ...p, busy: false, error: blockMessage(r.code, lang) ?? t.previewFailed }));
    setPreview((p) => ({ url: r.data.url, busy: false, made: p.made + 1, error: "" }));
    if (!ai) return;
    setProd({ items: null, notes: [], busy: true, error: "" });
    const pr = await postJson<{ products: Product[]; notes: string[] }>("/api/estimator/products", { preview: r.data.url, space, design });
    setProd(pr.ok ? { items: pr.data.products, notes: pr.data.notes, busy: false, error: "" } : { items: null, notes: [], busy: false, error: t.productsFailed });
  }

  function makeEstimate() {
    const items = draftItems(priced, lang);
    if (!items.length) return setError(t.pickOne);
    setPrefill({
      kind: "estimate",
      items: items.map(({ description, quantity, unitPriceCents, source, basis }) => ({ description, quantity, unitPriceCents, source, basis })),
      notes: draftNotes(priced.map((p) => p.id), lang, prod.items ?? [], prod.notes),
      ai: { model, promptVersion: "estimator@1" },
    });
    window.scrollTo({ top: 0 });
  }

  // ---------- pieces ----------
  const chip = (label: string, on: boolean, onClick: () => void, testid?: string) => (
    <button type="button" className="chip big" aria-pressed={on} onClick={onClick} data-testid={testid}>{label}</button>
  );
  const pic = (k: string, label: string, sub: string | undefined, on: boolean, onClick: () => void) => {
    const url = ex[k];
    return (
      <button type="button" key={k} className="est-pic" aria-pressed={on} onClick={onClick}>
        <span className={`est-ph${k in ex ? " done" : ""}`}>
          {url ? <img src={url} alt="" loading="lazy" /> : null}
          <span className="est-tag">{k in ex && !url ? t.noExample : t.example}</span>
        </span>
        <b>{label}</b>
        {sub && <small className="muted">{sub}</small>}
      </button>
    );
  };
  const before = (url: string) => (
    <div className="est-ba">
      <img src={url} alt={t.aiPreview} />
      <div className="est-before" style={{ clipPath: "inset(0 calc(100% - var(--p, 50%)) 0 0)" }}><img src={photo} alt={t.today} /></div>
      <span className="est-tag l">{t.today}</span><span className="est-tag r">{t.aiPreview}</span>
      <input type="range" min={0} max={100} defaultValue={50} aria-label={t.drag}
        onInput={(e) => (e.currentTarget.parentElement as HTMLElement).style.setProperty("--p", `${e.currentTarget.value}%`)} />
    </div>
  );
  const productsBox = () => (
    <div data-testid="est-products">
      <h3>{t.products}</h3>
      {prod.busy ? <p className="muted">{t.findingProducts}</p> : prod.error ? <p className="muted small">{prod.error}</p> : prod.items ? (
        <>
          <div className="est-prods">
            {prod.items.map((p) => (
              <a key={p.url + p.name} className="est-prod" href={p.url} target="_blank" rel="noopener noreferrer">
                <span className="muted small">{p.category}</span><b>{p.name}</b><small className="muted">{p.details}</small><span className="est-hd">{t.searchHD}</span>
              </a>
            ))}
          </div>
          <p className="muted small">{t.productsNote}</p>
        </>
      ) : null}
    </div>
  );

  function question(id: string, q: Question) {
    const a = ans[id] ?? {};
    if (q.when && !q.when(a)) return null;
    if (q.type === "number") {
      const v = Number(a[q.id]) || q.def;
      return (
        <div className="est-q" key={q.id}>
          <p className="field-title">{q.label[lang]}</p>
          <div className="row"><input className="grow" type="range" min={q.min} max={q.max} step={q.step} value={v} aria-label={q.label[lang]} onChange={(e) => answer(id, q.id, Number(e.target.value))} />
            <b>{v.toLocaleString("en-US")} {q.unit[lang]}</b></div>
          {q.hint && <p className="muted small">{q.hint[lang]}</p>}
        </div>
      );
    }
    if (q.type === "home") {
      return (
        <div className="est-q" key={q.id}>
          <p className="field-title">{q.label[lang]}</p>
          <div className="chips">{HOME.map((h) => chip(h.label[lang], home.size === h.v, () => setHome((x) => ({ ...x, size: h.v }))))}</div>
          <p className="field-title" style={{ marginTop: 12 }}>{t.stories}</p>
          <div className="chips">{STORIES.map((s) => chip(s.label[lang], home.stories === s.v, () => setHome((x) => ({ ...x, stories: s.v }))))}</div>
        </div>
      );
    }
    const opts = q.opts.filter((o) => !o.when || o.when(a));
    if (q.type === "multi") {
      const cur = (a[q.id] as string[]) ?? [];
      return (
        <div className="est-q" key={q.id}>
          <p className="field-title">{q.label[lang]}</p>
          <div className="chips">{opts.map((o) => chip(o.label[lang], cur.includes(o.v), () => answer(id, q.id, o.v, true)))}</div>
        </div>
      );
    }
    const withPics = images && PRICED_EXAMPLES[`${id}.${q.id}`];
    return (
      <div className="est-q" key={q.id}>
        <p className="field-title">{q.label[lang]}</p>
        {withPics ? (
          <div className="est-pics">{opts.map((o) => PRICED_LOOK[`${id}.${q.id}.${o.v}`]
            ? pic(`t:${id}.${q.id}.${o.v}`, o.label[lang], o.sub?.[lang], a[q.id] === o.v, () => answer(id, q.id, o.v))
            : <button type="button" key={o.v} className="est-pic plain" aria-pressed={a[q.id] === o.v} onClick={() => answer(id, q.id, o.v)}><b>{o.label[lang]}</b>{o.sub && <small className="muted">{o.sub[lang]}</small>}</button>)}</div>
        ) : (
          <div className="chips">{opts.map((o) => chip(o.label[lang] + (o.sub ? ` · ${o.sub[lang]}` : ""), a[q.id] === o.v, () => answer(id, q.id, o.v)))}</div>
        )}
      </div>
    );
  }

  const tradeButton = (id: string, reason?: string, priority?: string) => (
    <button key={id} type="button" className="est-trade" aria-pressed={trades.includes(id)} onClick={() => toggleTrade(id)} data-trade={id}>
      {priority && <span className={`est-pri ${priority}`}>{priority === "high" ? t.recommended : priority === "medium" ? t.worth : t.optional}</span>}
      <b>{TRADES[id].label[lang]}</b>
      <small className="muted">{reason || TRADES[id].sub[lang]}</small>
    </button>
  );

  // ---------- screens ----------
  let body: React.ReactNode = null;
  if (key === "start") {
    body = (
      <>
        <h2>{t.whatFor}</h2>
        <p className="muted">{t.intro}</p>
        <div className="est-spaces">
          {spaceIds.map((s) => (
            <button key={s} type="button" className="est-trade" aria-pressed={hint === s} data-space={s}
              onClick={() => { if (hint !== s) { setHint(s); setPhoto(""); setLook(null); setSpace(s); setTrades([]); setDesign({}); } }}>
              <span className="est-ico" aria-hidden="true">{ICONS[s]}</span><b>{SPACES[s].label[lang]}</b>
            </button>
          ))}
          <button type="button" className="est-trade" aria-pressed={hint === "none"} data-space="none"
            onClick={() => { if (hint !== "none") { setHint("none"); setPhoto(""); setLook(null); setSpace(""); setTrades([]); setDesign({}); } }}>
            <span className="est-ico" aria-hidden="true">📝</span><b>{t.noPhoto}</b><small className="muted">{t.noPhotoSub}</small>
          </button>
        </div>
        {!images && <p className="note warn small">{t.imagesOff}</p>}
      </>
    );
  } else if (key === "photo") {
    const what = hint === "exterior" ? SPACES.exterior.label[lang].toLowerCase() : (SPACES[hint as Space]?.label[lang] ?? "").toLowerCase();
    body = (
      <>
        <h2>{t.photoTitle(what)}</h2>
        <p className="muted">{hint === "exterior" ? t.photoTipOut : t.photoTipIn}</p>
        {photo ? <div className="est-photo"><img src={photo} alt="" /></div> : null}
        <label className={photo ? "btn" : "est-drop"}>
          {!photo && <span className="est-ico" aria-hidden="true">📷</span>}
          <b>{photo ? t.otherPhoto : t.takePhoto}</b>
          {!photo && <small className="muted">{t.photoPrivate}</small>}
          <input type="file" accept="image/*" capture="environment" className="sr" data-testid="est-file" onChange={(e) => choosePhoto(e.target.files?.[0])} />
        </label>
        {busy && <p className="note">{t.reading}</p>}
      </>
    );
  } else if (key === "look") {
    const L = look && "summary" in look ? look : null;
    const sp = space ? SPACES[space] : null;
    const sugg = L?.suggestions ?? [];
    const rest = tradeIds.filter((x) => !sugg.some((s) => s.trade === x));
    const near = rest.filter((x) => sp?.trades.includes(x)), other = rest.filter((x) => !sp?.trades.includes(x));
    body = (
      <div className="est-look">
        <div className="est-photo"><img src={photo} alt="" /></div>
        <div>
          {L ? (
            <div data-testid="est-reading">
              <span className="pill">✦ {t.sees}</span>
              <p>{L.summary}</p>
              {L.observations.length > 0 && <ul className="muted">{L.observations.map((o) => <li key={o}>{o}</li>)}</ul>}
            </div>
          ) : look && "error" in look ? <p className="note warn">{look.error}</p> : null}
          <h2>{sp ? sp.ask[lang] : t.whichProjects}</h2>
          <p className="muted small">{t.pickAll}</p>
          {sugg.length > 0 && <p><button type="button" className="btn primary" onClick={() => setTrades(sugg.reduce((acc, s) => addTrade(s.trade, acc), trades))}>{t.yesAll}</button></p>}
          <div className="est-list">{sugg.map((s) => tradeButton(s.trade, s.reason, s.priority))}{near.map((x) => tradeButton(x))}</div>
          {other.length > 0 && <details style={{ marginTop: 12 }}><summary className="muted small">{t.otherProjects}</summary><div className="est-list">{other.map((x) => tradeButton(x))}</div></details>}
          <p className="muted small">{t.onlyPhoto}</p>
        </div>
      </div>
    );
  } else if (key === "trades") {
    body = (
      <>
        <h2>{t.whichProjects}</h2>
        <div className="est-list grid">{tradeIds.map((x) => tradeButton(x))}</div>
      </>
    );
  } else if (key.startsWith("q:")) {
    const id = key.slice(2);
    body = (
      <>
        <h2>{TRADES[id].label[lang]}</h2>
        {TRADES[id].q.map((q) => question(id, q))}
      </>
    );
  } else if (key === "design" && space) {
    body = (
      <>
        <h2>{t.lookTitle}</h2>
        <p className="muted">{t.lookHint}</p>
        {looks.map((q) => (
          <div className="est-q" key={q.id}>
            <p className="field-title">{q.label[lang]}</p>
            <div className="est-pics">{q.opts.map((o) => pic(`d:${space}.${q.id}.${o.v}`, o.label[lang], undefined, design[q.id] === o.v, () => { setDesign((d) => ({ ...d, [q.id]: o.v })); setPreview({ url: "", busy: false, made: 0, error: "" }); }))}</div>
          </div>
        ))}
      </>
    );
  } else if (key === "preview") {
    body = (
      <>
        <h2>{t.previewTitle}</h2>
        {preview.busy ? (
          <div className="card center" data-testid="est-making"><p><b>{t.making}</b></p><p className="muted small">{t.makingTime}</p></div>
        ) : preview.url ? (
          <>
            {before(preview.url)}
            <p className="muted small">{t.previewNote}</p>
            {preview.made < 3 && <p><button type="button" className="btn" onClick={makePreview}>{t.another}</button></p>}
            {productsBox()}
          </>
        ) : (
          <>
            {preview.error && <p className="note warn">{preview.error}</p>}
            <p><button type="button" className="btn primary" onClick={makePreview}>{t.makePreview}</button></p>
          </>
        )}
      </>
    );
  } else if (key === "result") {
    const total = totalRange(priced);
    body = (
      <>
        <h2>{t.result}</h2>
        <p className="est-total" data-testid="est-total">{rangeText(total, lang)}</p>
        <p className="muted small">{t.typical}</p>
        <div className="tiles est-facts">
          <div className="tile"><span className="muted small">{t.time}</span><span className="tile-value" data-testid="est-time">{weeksText(weeksFor(priced.map((p) => p.id)), lang)}</span></div>
          <div className="tile"><span className="muted small">{t.projects}</span><span className="tile-value">{priced.length}</span></div>
        </div>
        {preview.url && <>{before(preview.url)}{productsBox()}</>}
        <div className="card">
          {priced.map((p) => (
            <div key={p.id} className="est-break">
              <div className="row"><b className="grow">{TRADES[p.id].label[lang]}</b><b>{rangeText(p.total, lang)}</b></div>
              <ul className="muted small">{p.lines.map((x, i) => <li key={i} className="row"><span className="grow">{x.label[lang]}{x.note ? ` (${x.note[lang]})` : ""}</span><span>{rangeText(x.range, lang)}</span></li>)}</ul>
              <p className="muted small">{t.time}: {weeksText(TRADES[p.id].weeks, lang)}</p>
            </div>
          ))}
        </div>
        <p className="note small">{t.rangeNote}</p>
        <p><button type="button" className="btn primary" onClick={makeEstimate} data-testid="est-make">{t.makeEstimate} →</button></p>
      </>
    );
  }

  return (
    <section className="card est" ref={top} aria-live="polite">
      <div className="row"><h1 className="grow" style={{ margin: 0 }}>{t.title}</h1><span className="muted small">{t.step(step + 1, steps.length)}</span></div>
      <div className="progress est-progress" aria-hidden="true"><i style={{ width: `${((step + 1) / steps.length) * 100}%` }} /></div>
      {body}
      {error && <p className="note bad" role="alert">{error}</p>}
      <div className="row est-nav">
        {step > 0 && <button type="button" className="btn ghost" onClick={() => go(-1)} disabled={busy}>← {t.back}</button>}
        <span className="grow" />
        {key !== "result" && <button type="button" className="btn secondary" onClick={() => go(1)} disabled={busy} data-testid="est-next">{busy ? t.reading : `${key === "photo" ? t.readPhoto : t.next} →`}</button>}
      </div>
    </section>
  );
}
