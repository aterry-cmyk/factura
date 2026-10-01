"use client";

import { useCallback, useMemo, useState } from "react";
import { dict, US_STATES } from "@/lib/i18n";
import { formatMoney, lineTotalCents, parseMoney, totals } from "@/lib/money";
import type { Doc, DocKind, Lang, LateFee, PaymentMethods, PriceSource, Settings } from "@/lib/types";
import { REMINDER_CHOICES } from "@/lib/types";
import { localeFor, spokenSummary } from "@/lib/voice";
import { useSpeech } from "./useSpeech";
import { useVoice } from "./useVoice";

interface EditItem {
  key: number;
  description: string;
  quantity: string;
  price: string;
  source: PriceSource;
  basis?: string;
  confirmed: boolean;
}

interface Parsed {
  kind: DocKind;
  customerName: string;
  items: { description: string; quantity: number; unitPriceCents: number; source: PriceSource; basis?: string; needsConfirm: boolean }[];
  notes: string;
  questions: string[];
  model: string;
  promptVersion: string;
}

const DUE_CHOICES = [0, 7, 15, 30];
let nextKey = 1;
const centsText = (c: number) => (c / 100).toFixed(2).replace(/\.00$/, "");

function toEditItems(items: { description: string; quantity: number; unitPriceCents: number; source: PriceSource; basis?: string }[], fresh: boolean): EditItem[] {
  return items.map((i) => ({
    key: nextKey++,
    description: i.description,
    quantity: String(i.quantity),
    price: centsText(i.unitPriceCents),
    source: i.source,
    basis: i.basis,
    // Prices on a saved document were already confirmed; a fresh suggestion isn't.
    confirmed: !fresh || i.source !== "suggested",
  }));
}

type Stage = "speak" | "review" | "wizard";

export function Creator({ lang, defaults, ai, edit, children }: { lang: Lang; defaults: Settings; ai: boolean; edit?: Doc; children?: React.ReactNode }) {
  const t = dict(lang);
  const [stage, setStage] = useState<Stage>(edit ? "review" : "speak");
  const [transcript, setTranscript] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [questions, setQuestions] = useState<string[]>([]);
  const [aiMeta, setAiMeta] = useState<{ model: string; promptVersion: string } | null>(null);

  const [kind, setKind] = useState<DocKind>(edit?.kind ?? "invoice");
  const [items, setItems] = useState<EditItem[]>(edit ? toEditItems(edit.items, false) : []);
  const [customer, setCustomer] = useState(edit?.customer ?? { name: "", company: "", email: "", phone: "" });
  const [business, setBusiness] = useState(
    edit?.business ?? {
      name: defaults.name,
      ownerName: defaults.ownerName,
      address: defaults.address,
      phone: defaults.phone,
      email: defaults.email,
      website: defaults.website,
    },
  );
  const [state, setState] = useState(edit?.state ?? defaults.state);
  const [taxEnabled, setTaxEnabled] = useState(edit ? edit.taxRate > 0 : defaults.taxEnabled);
  const [taxRate, setTaxRate] = useState(String(edit?.taxRate || defaults.taxRate || ""));
  const [dueDays, setDueDays] = useState(edit ? Math.max(0, Math.round((Date.parse(edit.dueDate) - Date.parse(edit.issueDate)) / 86_400_000)) : defaults.dueDays);
  const [reminderDays, setReminderDays] = useState(edit?.reminderDays ?? defaults.reminderDays);
  const [lateFee, setLateFee] = useState<LateFee>(edit?.lateFee ?? defaults.lateFee);
  const [payment, setPayment] = useState<PaymentMethods>(edit?.paymentMethods ?? defaults.paymentMethods);
  const [docLang, setDocLang] = useState<Lang>(edit?.lang ?? lang);
  const [notes, setNotes] = useState(edit?.notes ?? "");
  const [step, setStep] = useState(0);
  const [suggestions, setSuggestions] = useState<{ id: string; name: string; company: string; email: string; phone: string }[]>([]);

  const appendHeard = useCallback((text: string) => setTranscript((prev) => (prev ? `${prev} ${text}` : text)), []);
  const locale = localeFor(defaults.country, lang);
  const speech = useSpeech(locale, appendHeard);
  const voice = useVoice(locale, defaults.voiceOn);
  const [summary, setSummary] = useState("");

  function listen() {
    voice.stop(); // never let the microphone hear the app talking
    speech.start();
  }

  async function understand() {
    speech.stop();
    voice.prime();
    setBusy(true);
    setError("");
    const res = await fetch("/api/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript }),
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      const code = res ? ((await res.json().catch(() => ({}))) as { error?: string }).error : "";
      setError(
        code === "not_understood"
          ? lang === "es"
            ? "No entendí los conceptos. Dilo otra vez con cada cosa y su precio, o escríbelos tú."
            : "I couldn't make out the items. Say it again with each thing and its price, or type them yourself."
          : t.errorGeneric,
      );
      return;
    }
    const p = (await res.json()) as Parsed;
    setKind(p.kind);
    setCustomer((c) => ({ ...c, name: p.customerName || c.name }));
    setItems(toEditItems(p.items, true));
    setNotes(p.notes);
    setQuestions(p.questions);
    setAiMeta({ model: p.model, promptVersion: p.promptVersion });
    if (p.customerName) lookupCustomer(p.customerName);
    const said = spokenSummary({
      lang,
      kind: p.kind,
      customerName: p.customerName,
      items: p.items.map((i) => ({ description: i.description, quantity: i.quantity, unitPriceCents: i.unitPriceCents, suggested: i.needsConfirm })),
      totalCents: totals(p.items.map((i) => ({ ...i })), 0).totalCents,
      questions: p.questions,
    });
    setSummary(said);
    voice.speak(said);
    setStage("review");
  }

  function manual() {
    speech.stop();
    setItems([{ key: nextKey++, description: "", quantity: "1", price: "", source: "typed", confirmed: true }]);
    setStage("review");
  }

  async function lookupCustomer(name: string) {
    if (name.trim().length < 2) return setSuggestions([]);
    const res = await fetch(`/api/customers?q=${encodeURIComponent(name)}`).catch(() => null);
    if (res?.ok) setSuggestions(await res.json());
  }

  const updateItem = (key: number, patch: Partial<EditItem>) =>
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const cleanItems = useMemo(
    () =>
      items.map((i) => ({
        description: i.description.trim(),
        quantity: Number(i.quantity),
        unitPriceCents: parseMoney(i.price) ?? NaN,
        source: i.source,
        basis: i.basis,
        confirmed: i.confirmed,
      })),
    [items],
  );
  const itemsOk =
    cleanItems.length > 0 &&
    cleanItems.every((i) => i.description && i.quantity > 0 && Number.isFinite(i.unitPriceCents) && (i.source !== "suggested" || i.confirmed));
  const unconfirmed = items.some((i) => i.source === "suggested" && !i.confirmed);
  const rate = taxEnabled ? Number(taxRate) || 0 : 0;
  const preview = totals(
    cleanItems.filter((i) => Number.isFinite(i.unitPriceCents) && i.quantity > 0).map((i) => ({ ...i, source: i.source })),
    rate,
  );

  const steps = kind === "invoice" ? ["customer", "business", "tax", "due", "late", "pay"] : ["customer", "business", "tax", "due", "pay"];
  const current = steps[step];

  function stepQuestion(name: string): string {
    if (name === "customer") return t.qCustomer;
    if (name === "business") return t.qBusiness;
    if (name === "tax") return `${t.qState} ${t.qTax}`;
    if (name === "due") return kind === "invoice" ? `${t.qDue} ${t.qReminders}` : lang === "es" ? "¿Por cuántos días vale el presupuesto?" : "How many days is the estimate valid?";
    if (name === "late") return t.qLate;
    if (name === "pay") return t.qPay;
    return "";
  }

  function goToStep(next: number) {
    setStep(next);
    voice.speak(stepQuestion(steps[next]));
  }

  function stepOk(): boolean {
    if (current === "customer") return customer.name.trim().length > 0;
    if (current === "business") return business.name.trim().length > 0;
    if (current === "tax") return !taxEnabled || (Number(taxRate) > 0 && Number(taxRate) <= 30);
    if (current === "late")
      return lateFee.type === "none" || (lateFee.type === "flat" ? lateFee.amountCents > 0 : lateFee.percent > 0 && lateFee.percent <= 10);
    if (current === "pay") return Object.values(payment).some((m) => m?.enabled);
    return true;
  }

  async function create() {
    voice.stop();
    setBusy(true);
    setErrors([]);
    const body = {
      kind,
      lang: docLang,
      customer,
      business,
      items: cleanItems,
      state,
      taxEnabled,
      taxRate: Number(taxRate),
      dueDays,
      reminderDays: kind === "invoice" ? reminderDays : 0,
      lateFee,
      paymentMethods: payment,
      notes,
      transcript,
      ai: aiMeta ?? undefined,
    };
    const res = await fetch(edit ? `/api/documents/${edit.id}` : "/api/documents", {
      method: edit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (res?.ok) {
      const { id } = (await res.json()) as { id: string };
      window.location.href = `/documents/${id}`;
      return;
    }
    setBusy(false);
    const json = res ? ((await res.json().catch(() => ({}))) as { errors?: string[] }) : {};
    setErrors(json.errors?.map((e) => e.replace(/^[\w.]+: /, "")) ?? [t.errorGeneric]);
  }

  // ---------- speak ----------
  if (stage === "speak") {
    const listening = speech.state === "listening";
    return (
      <>
      <section className="card center stack">
        <h1>{t.speakPrompt}</h1>
        <p className="muted small">{t.speakExample}</p>
        {speech.state !== "unsupported" && (
          <button
            className={`mic${listening ? " on" : ""}`}
            onClick={listening ? speech.stop : listen}
            aria-label={listening ? t.listening : t.tapToTalk}
            data-testid="mic"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" />
            </svg>
          </button>
        )}
        <p className="muted small">{listening ? t.listening : speech.state === "unsupported" ? t.noVoice : speech.state === "denied" ? t.micDenied : t.tapToTalk}</p>
        <div style={{ textAlign: "left" }}>
          <label htmlFor="heard">{t.orType}</label>
          <textarea
            id="heard"
            value={transcript + (speech.interim ? ` ${speech.interim}` : "")}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder={t.speakExample.replace(/^[^:]+:\s*/, "").replace(/[«»"]/g, "")}
          />
        </div>
        {!ai && (
          <p className="note warn" style={{ textAlign: "left" }}>
            {lang === "es"
              ? "El asistente necesita configuración (ANTHROPIC_API_KEY). Mientras tanto, puedes escribir los conceptos tú."
              : "The assistant needs setup (ANTHROPIC_API_KEY). Meanwhile, you can type the items yourself."}
          </p>
        )}
        {error && <p className="note bad" role="alert">{error}</p>}
        <div className="row">
          <button className="btn primary grow" onClick={understand} disabled={!ai || busy || transcript.trim().length < 3}>
            {busy ? t.thinking : t.continue}
          </button>
          <button className="btn" onClick={manual}>
            {lang === "es" ? "Escribir a mano" : "Type it myself"}
          </button>
        </div>
      </section>
      {children}
      </>
    );
  }

  // ---------- review items ----------
  if (stage === "review") {
    return (
      <section className="stack">
        <div className="card stack">
          <div className="row">
            <h2 className="grow" style={{ margin: 0, minWidth: 180 }}>{t.reviewItems}</h2>
            {!edit && (
              <div className="chips">
                {(["invoice", "estimate"] as const).map((k) => (
                  <button key={k} className="chip" aria-pressed={kind === k} onClick={() => { setKind(k); setStep(0); }}>
                    {k === "invoice" ? t.invoice : t.estimate}
                  </button>
                ))}
              </div>
            )}
          </div>
          {transcript && (
            <p className="muted small">
              <strong>{t.heard}:</strong> “{transcript}”
            </p>
          )}
          {summary && defaults.voiceOn && voice.supported && voice.match !== "none" && (
            <div>
              <button className="btn small" onClick={() => voice.speak(summary)} data-testid="listen-again">🔊 {t.listenAgain}</button>
            </div>
          )}
          {questions.length > 0 && (
            <div className="note warn">
              <strong>{t.aiQuestions}:</strong>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{questions.map((q) => <li key={q}>{q}</li>)}</ul>
            </div>
          )}
          <div>
            <label htmlFor="cust">{t.customerName}</label>
            <input id="cust" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
          </div>
          {items.map((i) => {
            const attention = i.source === "suggested" && !i.confirmed;
            const cents = parseMoney(i.price);
            return (
              <div key={i.key} className={`item${attention ? " attention" : ""}`} data-testid="item">
                <div className="row">
                  {i.source === "suggested" && <span className="badge warn">{t.suggested}</span>}
                  {i.source === "catalog" && <span className="badge">{t.fromBefore}</span>}
                  <span className="grow" />
                  <button className="btn small ghost danger" onClick={() => setItems(items.filter((x) => x.key !== i.key))}>
                    {t.remove}
                  </button>
                </div>
                <div className="item-grid">
                  <div><span className="field-label">{t.description}</span>
                    <input aria-label={t.description} value={i.description} onChange={(e) => updateItem(i.key, { description: e.target.value })} /></div>
                  <div><span className="field-label">{t.quantity}</span>
                    <input aria-label={t.quantity} inputMode="decimal" value={i.quantity} onChange={(e) => updateItem(i.key, { quantity: e.target.value })} /></div>
                  <div><span className="field-label">{t.price} ($)</span>
                    <input
                      aria-label={t.price}
                      inputMode="decimal"
                      value={i.price}
                      onChange={(e) => updateItem(i.key, { price: e.target.value, source: "typed", confirmed: true, basis: undefined })}
                    /></div>
                </div>
                {i.source === "suggested" && (
                  <div className="stack" style={{ marginTop: 8 }}>
                    {i.basis && <p className="small muted" style={{ margin: 0 }}>{i.basis}</p>}
                    <label className="check">
                      <input type="checkbox" checked={i.confirmed} onChange={(e) => updateItem(i.key, { confirmed: e.target.checked })} />
                      {t.confirmPrice}
                    </label>
                  </div>
                )}
                {cents != null && Number(i.quantity) > 0 && (
                  <p className="small muted" style={{ margin: "6px 0 0", textAlign: "right" }}>
                    {formatMoney(lineTotalCents({ quantity: Number(i.quantity), unitPriceCents: cents }), lang)}
                  </p>
                )}
              </div>
            );
          })}
          <button className="btn" onClick={() => setItems([...items, { key: nextKey++, description: "", quantity: "1", price: "", source: "typed", confirmed: true }])}>
            + {t.addItem}
          </button>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <span className="muted">{t.subtotal}</span>
            <span className="amount">{formatMoney(preview.subtotalCents, lang)}</span>
          </div>
          {unconfirmed && <p className="note warn">{t.confirmAll}</p>}
        </div>
        <div className="footer-bar">
          {!edit && <button className="btn" onClick={() => setStage("speak")}>{t.back}</button>}
          <button className="btn primary" disabled={!itemsOk || !customer.name.trim()} onClick={() => { setStage("wizard"); goToStep(0); }}>
            {t.next}
          </button>
        </div>
      </section>
    );
  }

  // ---------- wizard ----------
  const setMethod = <K extends keyof PaymentMethods>(k: K, v: PaymentMethods[K] | undefined) => setPayment({ ...payment, [k]: v });
  const last = step === steps.length - 1;

  return (
    <section>
      <p className="muted small" style={{ margin: 0 }}>
        {t.step} {step + 1} {t.of} {steps.length} · {kind === "invoice" ? t.invoice : t.estimate}
      </p>
      <div className="progress"><span style={{ width: `${((step + 1) / steps.length) * 100}%` }} /></div>
      <div className="card stack" data-step={current}>
        {current === "customer" && (
          <>
            <h2>{t.qCustomer}</h2>
            <div>
              <label htmlFor="c-name">{t.customerName}</label>
              <input id="c-name" value={customer.name} onChange={(e) => { setCustomer({ ...customer, name: e.target.value }); lookupCustomer(e.target.value); }} />
              {suggestions.filter((s) => s.email !== customer.email || s.phone !== customer.phone).length > 0 && (
                <div className="chips" style={{ marginTop: 8 }}>
                  {suggestions.map((s) => (
                    <button key={s.id} className="chip" onClick={() => { setCustomer({ name: s.name, company: s.company, email: s.email, phone: s.phone }); setSuggestions([]); }}>
                      {s.name}{s.company ? ` · ${s.company}` : ""}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div><label htmlFor="c-company">{t.customerCompany}</label><input id="c-company" value={customer.company} onChange={(e) => setCustomer({ ...customer, company: e.target.value })} /></div>
            <div><label htmlFor="c-email">{t.customerEmail}</label><input id="c-email" type="email" inputMode="email" value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} /></div>
            <div><label htmlFor="c-phone">{t.customerPhone}</label><input id="c-phone" type="tel" inputMode="tel" value={customer.phone.replace(/^\+1/, "")} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} /></div>
            <p className="muted small">{t.contactHint}</p>
          </>
        )}
        {current === "business" && (
          <>
            <h2>{t.qBusiness}</h2>
            <div><label htmlFor="b-name">{t.businessName}</label><input id="b-name" value={business.name} onChange={(e) => setBusiness({ ...business, name: e.target.value })} /></div>
            <div><label htmlFor="b-owner">{t.yourName}</label><input id="b-owner" value={business.ownerName} onChange={(e) => setBusiness({ ...business, ownerName: e.target.value })} /></div>
            <div><label htmlFor="b-phone">{t.yourPhone}</label><input id="b-phone" type="tel" value={business.phone.replace(/^\+1/, "")} onChange={(e) => setBusiness({ ...business, phone: e.target.value })} /></div>
            <div><label htmlFor="b-email">{t.yourEmail}</label><input id="b-email" type="email" value={business.email} onChange={(e) => setBusiness({ ...business, email: e.target.value })} /></div>
            <div><label htmlFor="b-address">{t.yourAddress}</label><input id="b-address" value={business.address} onChange={(e) => setBusiness({ ...business, address: e.target.value })} /></div>
            <p className="muted small">{t.rememberHint}</p>
          </>
        )}
        {current === "tax" && (
          <>
            <h2>{t.qState}</h2>
            <select aria-label={t.qState} value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">—</option>
              {US_STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </select>
            <h2 style={{ marginTop: 18 }}>{t.qTax}</h2>
            <div className="chips">
              <button className="chip" aria-pressed={taxEnabled} onClick={() => setTaxEnabled(true)}>{t.yes}</button>
              <button className="chip" aria-pressed={!taxEnabled} onClick={() => setTaxEnabled(false)}>{t.no}</button>
            </div>
            {taxEnabled && (
              <div>
                <label htmlFor="tax">{t.taxRate}</label>
                <input id="tax" inputMode="decimal" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} placeholder="6" />
                <p className="muted small">{t.taxHint}</p>
              </div>
            )}
          </>
        )}
        {current === "due" && (
          <>
            <h2>{kind === "invoice" ? t.qDue : lang === "es" ? "¿Por cuántos días vale el presupuesto?" : "How many days is the estimate valid?"}</h2>
            <div className="chips">
              {DUE_CHOICES.filter((d) => kind === "invoice" || d > 0).map((d) => (
                <button key={d} className="chip" aria-pressed={dueDays === d} onClick={() => setDueDays(d)}>
                  {d === 0 ? t.onReceipt : t.inDays(d)}
                </button>
              ))}
            </div>
            {kind === "invoice" && (
              <>
                <h2 style={{ marginTop: 18 }}>{t.qReminders}</h2>
                <div className="chips">
                  {REMINDER_CHOICES.map((d) => (
                    <button key={d} className="chip" aria-pressed={reminderDays === d} onClick={() => setReminderDays(d)}>
                      {d === 0 ? t.never : t.everyDays(d)}
                    </button>
                  ))}
                </div>
                <p className="muted small">{t.remindersHint}</p>
              </>
            )}
          </>
        )}
        {current === "late" && (
          <>
            <h2>{t.qLate}</h2>
            <div className="chips">
              <button className="chip" aria-pressed={lateFee.type === "none"} onClick={() => setLateFee({ type: "none" })}>{t.lateNone}</button>
              <button className="chip" aria-pressed={lateFee.type === "flat"} onClick={() => setLateFee({ type: "flat", amountCents: 2500, graceDays: lateFee.type === "none" ? 5 : lateFee.graceDays })}>{t.lateFlat}</button>
              <button className="chip" aria-pressed={lateFee.type === "percent"} onClick={() => setLateFee({ type: "percent", percent: 1.5, graceDays: lateFee.type === "none" ? 5 : lateFee.graceDays })}>{t.latePercent}</button>
            </div>
            {lateFee.type === "flat" && (
              <div><label htmlFor="late-amt">{t.lateAmount}</label>
                <input id="late-amt" inputMode="decimal" defaultValue={centsText(lateFee.amountCents)} onChange={(e) => setLateFee({ ...lateFee, amountCents: parseMoney(e.target.value) ?? 0 })} /></div>
            )}
            {lateFee.type === "percent" && (
              <div><label htmlFor="late-pct">{t.latePercentLabel}</label>
                <input id="late-pct" inputMode="decimal" defaultValue={String(lateFee.percent)} onChange={(e) => setLateFee({ ...lateFee, percent: Number(e.target.value) || 0 })} /></div>
            )}
            {lateFee.type !== "none" && (
              <>
                <div><label htmlFor="grace">{t.graceDays}</label>
                  <input id="grace" inputMode="numeric" value={String(lateFee.graceDays)} onChange={(e) => setLateFee({ ...lateFee, graceDays: Math.max(0, Math.min(90, Number(e.target.value.replace(/\D/g, "")) || 0)) })} /></div>
                <p className="note warn">{t.lateHint}</p>
              </>
            )}
          </>
        )}
        {current === "pay" && (
          <>
            <h2>{t.qPay}</h2>
            <div>
              <div className="pay-option">
                <label className="check"><input type="checkbox" checked={!!payment.zelle?.enabled} onChange={(e) => setMethod("zelle", e.target.checked ? { enabled: true, handle: payment.zelle?.handle ?? business.phone.replace(/^\+1/, "") } : undefined)} />{t.payZelle}</label>
                {payment.zelle?.enabled && <input type="text" aria-label={t.zelleHandle} placeholder={t.zelleHandle} value={payment.zelle.handle} onChange={(e) => setMethod("zelle", { enabled: true, handle: e.target.value })} />}
              </div>
              <div className="pay-option">
                <label className="check"><input type="checkbox" checked={!!payment.check?.enabled} onChange={(e) => setMethod("check", e.target.checked ? { enabled: true, payableTo: payment.check?.payableTo ?? business.name } : undefined)} />{t.payCheck}</label>
                {payment.check?.enabled && <input type="text" aria-label={t.payableTo} placeholder={t.payableTo} value={payment.check.payableTo} onChange={(e) => setMethod("check", { enabled: true, payableTo: e.target.value })} />}
              </div>
              <div className="pay-option">
                <label className="check"><input type="checkbox" checked={!!payment.bank?.enabled} onChange={(e) => setMethod("bank", e.target.checked ? { enabled: true, details: payment.bank?.details ?? "" } : undefined)} />{t.payBank}</label>
                {payment.bank?.enabled && <textarea aria-label={t.bankDetails} placeholder={t.bankDetails} value={payment.bank.details} onChange={(e) => setMethod("bank", { enabled: true, details: e.target.value })} />}
              </div>
              <div className="pay-option">
                <label className="check"><input type="checkbox" checked={!!payment.cash?.enabled} onChange={(e) => setMethod("cash", e.target.checked ? { enabled: true } : undefined)} />{t.payCash}</label>
              </div>
              <div className="pay-option">
                <label className="check"><input type="checkbox" checked={!!payment.card?.enabled} onChange={(e) => setMethod("card", e.target.checked ? { enabled: true, link: payment.card?.link ?? "" } : undefined)} />{t.payCard}</label>
                {payment.card?.enabled && <input type="text" inputMode="url" aria-label={t.cardLink} placeholder="https://" value={payment.card.link} onChange={(e) => setMethod("card", { enabled: true, link: e.target.value })} />}
              </div>
              <div className="pay-option">
                <label className="check"><input type="checkbox" checked={!!payment.other?.enabled} onChange={(e) => setMethod("other", e.target.checked ? { enabled: true, text: payment.other?.text ?? "" } : undefined)} />{t.payOther}</label>
                {payment.other?.enabled && <input type="text" aria-label={t.otherText} placeholder={t.otherText} value={payment.other.text} onChange={(e) => setMethod("other", { enabled: true, text: e.target.value })} />}
              </div>
            </div>
            <div>
              <label>{t.docLang}</label>
              <div className="chips">
                <button className="chip" aria-pressed={docLang === "es"} onClick={() => setDocLang("es")}>Español</button>
                <button className="chip" aria-pressed={docLang === "en"} onClick={() => setDocLang("en")}>English</button>
              </div>
            </div>
            <div><label htmlFor="notes">{t.notes}</label><textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="muted">{t.total}</span>
              <span className="amount" data-testid="total">{formatMoney(preview.totalCents, lang)}</span>
            </div>
          </>
        )}
        {errors.length > 0 && (
          <div className="note bad" role="alert">
            <ul style={{ margin: 0, paddingLeft: 18 }}>{errors.map((e) => <li key={e}>{e}</li>)}</ul>
          </div>
        )}
      </div>
      <div className="footer-bar">
        <button className="btn" onClick={() => (step === 0 ? (voice.stop(), setStage("review")) : goToStep(step - 1))}>{t.back}</button>
        {last ? (
          <button className="btn primary" disabled={busy || !stepOk()} onClick={create}>{busy ? t.generating : t.generate}</button>
        ) : (
          <button className="btn primary" disabled={!stepOk()} onClick={() => goToStep(step + 1)}>{t.next}</button>
        )}
      </div>
    </section>
  );
}
