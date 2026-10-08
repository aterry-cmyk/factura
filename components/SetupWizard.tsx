"use client";

import { useEffect, useRef, useState } from "react";
import { dict, US_STATES } from "@/lib/i18n";
import { DUE_CHOICES, stepOfError } from "@/lib/setup";
import { setupText } from "@/lib/setup-text";
import { REMINDER_CHOICES, type Lang, type PaymentMethods, type Settings } from "@/lib/types";
import { COUNTRIES } from "@/lib/voice";
import { TRADES, tradeName, type Trade } from "@/lib/waitlist";

/** Questions 1–5 are saved together at the end of step 5; step 6 is the logo (its own upload); 7 is "done". */
const LAST_QUESTION = 5;
const LOGO_STEP = 6;
const STEPS = 6;
const DONE = 7;

const digits = (s: string) => s.replace(/\D/g, "");
const phoneOk = (s: string) => !digits(s) || digits(s).length === 10 || (digits(s).length === 11 && digits(s).startsWith("1"));
const emailOk = (s: string) => !s.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
const showPhone = (e164: string) => {
  const d = digits(e164).replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164;
};

export function SetupWizard({ defaults, ownerName, hadLogo }: { defaults: Settings; ownerName: string; hadLogo: boolean }) {
  const [step, setStep] = useState(0);
  const [lang, setLang] = useState<Lang>(defaults.lang);
  const t = setupText(lang);
  const d = dict(lang);

  const [name, setName] = useState(defaults.name);
  const [owner, setOwner] = useState(defaults.ownerName || ownerName);
  const [trade, setTrade] = useState<Trade | "">((TRADES as readonly string[]).includes(defaults.trade) ? (defaults.trade as Trade) : "");
  const [phone, setPhone] = useState(defaults.phone ? showPhone(defaults.phone) : "");
  const [email, setEmail] = useState(defaults.email);
  const [address, setAddress] = useState(defaults.address);
  const [website, setWebsite] = useState(defaults.website);
  const [state, setState] = useState(defaults.state);
  const [charges, setCharges] = useState(defaults.taxEnabled);
  const [taxRate, setTaxRate] = useState(defaults.taxRate ? String(defaults.taxRate) : "");
  const [payment, setPayment] = useState<PaymentMethods>(Object.keys(defaults.paymentMethods).length ? defaults.paymentMethods : { cash: { enabled: true } });
  const [dueDays, setDueDays] = useState<number>((DUE_CHOICES as readonly number[]).includes(defaults.dueDays) ? defaults.dueDays : 15);
  const [reminderDays, setReminderDays] = useState<number>(defaults.reminderDays);
  const [country, setCountry] = useState(defaults.country);
  const [gender, setGender] = useState(defaults.voiceGender);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [logo, setLogo] = useState<{ url: string } | null>(hadLogo ? { url: `/api/settings/logo?v=${Date.now()}` } : null);
  const [logoError, setLogoError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);

  // Each new step moves focus to its question, so a screen reader (and a keyboard) follows along.
  useEffect(() => {
    window.scrollTo({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, [step]);

  const setMethod = <K extends keyof PaymentMethods>(k: K, v: PaymentMethods[K] | undefined) =>
    setPayment((p) => { const n = { ...p }; if (v) n[k] = v; else delete n[k]; return n; });

  const paymentOk =
    Object.keys(payment).length > 0 &&
    (!payment.zelle || payment.zelle.handle.trim()) && (!payment.check || payment.check.payableTo.trim()) &&
    (!payment.bank || payment.bank.details.trim()) && (!payment.card || /^https:\/\/\S+$/.test(payment.card.link.trim())) &&
    (!payment.other || payment.other.text.trim());
  const taxOk = !charges || (Number(taxRate) > 0 && Number(taxRate) <= 30);

  const canGo: Record<number, boolean> = {
    0: true,
    1: name.trim().length > 0,
    2: phoneOk(phone) && emailOk(email),
    3: Boolean(state) && taxOk,
    4: Boolean(paymentOk),
    5: true,
  };

  async function save() {
    setBusy(true);
    setErrors([]);
    const res = await fetch("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        business: { name, ownerName: owner, phone, email, address, website },
        trade, state, taxRate: charges ? Number(taxRate) : 0, dueDays, reminderDays,
        paymentMethods: payment, country, voiceGender: gender, lang,
      }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) return setStep(LOGO_STEP);
    const data = (await res?.json().catch(() => null)) as { errors?: string[] } | null;
    const list = data?.errors?.length ? data.errors : [t.saveFailed];
    setErrors(list.map((e) => e.replace(/^[\w.]+: /, "")));
    if (data?.errors?.length) setStep(Math.min(...data.errors.map(stepOfError)));
  }

  function next() {
    if (!canGo[step] || busy) return;
    if (step === LAST_QUESTION) void save();
    else setStep(step + 1);
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setLogoError("");
    if (file.size > 1_000_000) return setLogoError(t.logoTooBig);
    if (!/^image\/(png|jpeg)$/.test(file.type)) return setLogoError(t.logoBadType);
    const form = new FormData();
    form.append("logo", file);
    setBusy(true);
    const res = await fetch("/api/settings/logo", { method: "POST", body: form }).catch(() => null);
    setBusy(false);
    if (res?.ok) setLogo({ url: `/api/settings/logo?v=${Date.now()}` });
    else setLogoError(t.logoFailed);
  }

  const done = step === DONE;
  const loroSays = (q: string, hint?: string) => (
    <div className="say">
      <img src="/brand/loro-icon.svg" alt="" width={44} height={44} className="say-loro" />
      <div className="say-bubble">
        <h1 ref={heading} tabIndex={-1}>{q}</h1>
        {hint && <p>{hint}</p>}
      </div>
    </div>
  );

  return (
    <div className="setup" lang={lang}>
      {step > 0 && !done && (
        <div className="setup-top">
          <button type="button" className="btn small ghost" onClick={() => setStep(step - 1)} disabled={busy}>← {t.back}</button>
          <span className="muted small" aria-live="polite">{t.step(step, STEPS)}</span>
        </div>
      )}
      {step > 0 && !done && <div className="progress" aria-hidden="true"><span style={{ width: `${(step / STEPS) * 100}%` }} /></div>}

      <form className="setup-step" key={step} onSubmit={(e) => { e.preventDefault(); next(); }} noValidate>
        {step === 0 && (
          <div className="setup-hello">
            <div className="setup-video">
              <video src="/brand/loro-hola.mp4" poster="/brand/loro-hola.jpg" autoPlay muted loop playsInline aria-hidden="true" />
            </div>
            <h1 ref={heading} tabIndex={-1}>{t.hello(owner.split(" ")[0])}</h1>
            <p className="lede">{t.helloText}</p>
            <div className="chips" role="group" aria-label={t.appLang}>
              <button type="button" className="chip" aria-pressed={lang === "es"} onClick={() => setLang("es")}>Español</button>
              <button type="button" className="chip" aria-pressed={lang === "en"} onClick={() => setLang("en")}>English</button>
            </div>
          </div>
        )}

        {step === 1 && (
          <>
            {loroSays(t.bizQ, t.bizHint)}
            <div className="field">
              <label htmlFor="biz">{t.bizLabel}</label>
              <input id="biz" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.bizPlaceholder} maxLength={120} autoComplete="organization" />
            </div>
            <div className="field">
              <label htmlFor="owner">{t.yourNameLabel}</label>
              <input id="owner" value={owner} onChange={(e) => setOwner(e.target.value)} maxLength={120} autoComplete="name" />
            </div>
            <div className="field">
              <span className="field-title">{t.tradeQ}</span>
              <span className="hint">{t.tradeHint}</span>
              <div className="chips trades" role="group" aria-label={t.tradeQ}>
                {TRADES.map((tr) => (
                  <button key={tr} type="button" className="chip" aria-pressed={trade === tr} onClick={() => setTrade(trade === tr ? "" : tr)}>
                    {tradeName(tr, lang)}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            {loroSays(t.contactQ, t.contactHint)}
            <div className="field">
              <label htmlFor="phone">{t.phone}</label>
              <input id="phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(301) 555-0199" aria-invalid={!phoneOk(phone)} />
              {!phoneOk(phone) && <span className="hint bad">{t.phoneBad}</span>}
            </div>
            <div className="field">
              <label htmlFor="email">{t.email}</label>
              <input id="email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!emailOk(email)} />
              {!emailOk(email) && <span className="hint bad">{t.emailBad}</span>}
            </div>
            <div className="field">
              <label htmlFor="address">{t.address}</label>
              <input id="address" autoComplete="street-address" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={300} />
            </div>
            <div className="field">
              <label htmlFor="website">{t.website}</label>
              <input id="website" inputMode="url" autoComplete="url" value={website} onChange={(e) => setWebsite(e.target.value)} maxLength={200} />
            </div>
          </>
        )}

        {step === 3 && (
          <>
            {loroSays(t.whereQ)}
            <div className="field">
              <label htmlFor="state" className="sr">{t.whereQ}</label>
              <select id="state" value={state} onChange={(e) => setState(e.target.value)}>
                <option value="">{t.pickState}</option>
                {US_STATES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
              </select>
            </div>
            <div className="field">
              <span className="field-title">{t.taxQ}</span>
              <span className="hint">{t.taxHint}</span>
              <div className="chips" role="group" aria-label={t.taxQ}>
                <button type="button" className="chip big" aria-pressed={!charges} onClick={() => setCharges(false)}>{t.no}</button>
                <button type="button" className="chip big" aria-pressed={charges} onClick={() => setCharges(true)}>{t.yes}</button>
              </div>
            </div>
            {charges && (
              <div className="field" style={{ maxWidth: 200 }}>
                <label htmlFor="tax">{t.taxRate}</label>
                <div className="suffix"><input id="tax" inputMode="decimal" value={taxRate} onChange={(e) => setTaxRate(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="6" /><span>%</span></div>
              </div>
            )}
          </>
        )}

        {step === 4 && (
          <>
            {loroSays(t.payQ, t.payHint)}
            <div>
              <div className="pay-option">
                <label className="check"><input type="checkbox" checked={!!payment.zelle} onChange={(e) => setMethod("zelle", e.target.checked ? { enabled: true, handle: payment.zelle?.handle ?? digits(phone).slice(-10) } : undefined)} />{d.payZelle}</label>
                {payment.zelle && <input type="text" aria-label={d.zelleHandle} placeholder={d.zelleHandle} value={payment.zelle.handle} onChange={(e) => setMethod("zelle", { enabled: true, handle: e.target.value })} />}
              </div>
              <div className="pay-option">
                <label className="check"><input type="checkbox" checked={!!payment.cash} onChange={(e) => setMethod("cash", e.target.checked ? { enabled: true } : undefined)} />{d.payCash}</label>
              </div>
              <div className="pay-option">
                <label className="check"><input type="checkbox" checked={!!payment.check} onChange={(e) => setMethod("check", e.target.checked ? { enabled: true, payableTo: payment.check?.payableTo ?? name } : undefined)} />{d.payCheck}</label>
                {payment.check && <input type="text" aria-label={d.payableTo} placeholder={d.payableTo} value={payment.check.payableTo} onChange={(e) => setMethod("check", { enabled: true, payableTo: e.target.value })} />}
              </div>
              <div className="pay-option">
                <label className="check"><input type="checkbox" checked={!!payment.card} onChange={(e) => setMethod("card", e.target.checked ? { enabled: true, link: payment.card?.link ?? "" } : undefined)} />{d.payCard}</label>
                {payment.card && <input type="url" aria-label={d.cardLink} placeholder="https://" value={payment.card.link} onChange={(e) => setMethod("card", { enabled: true, link: e.target.value })} />}
              </div>
              <div className="pay-option">
                <label className="check"><input type="checkbox" checked={!!payment.bank} onChange={(e) => setMethod("bank", e.target.checked ? { enabled: true, details: payment.bank?.details ?? "" } : undefined)} />{d.payBank}</label>
                {payment.bank && <textarea aria-label={d.bankDetails} placeholder={d.bankDetails} value={payment.bank.details} onChange={(e) => setMethod("bank", { enabled: true, details: e.target.value })} />}
              </div>
              <div className="pay-option">
                <label className="check"><input type="checkbox" checked={!!payment.other} onChange={(e) => setMethod("other", e.target.checked ? { enabled: true, text: payment.other?.text ?? "" } : undefined)} />{d.payOther}</label>
                {payment.other && <input type="text" aria-label={d.otherText} placeholder={d.otherText} value={payment.other.text} onChange={(e) => setMethod("other", { enabled: true, text: e.target.value })} />}
              </div>
              {!paymentOk && <p className="hint bad" style={{ marginTop: 8 }}>{t.payNeedOne}</p>}
            </div>
            <div className="field">
              <span className="field-title">{t.dueQ}</span>
              <div className="chips" role="group" aria-label={t.dueQ}>
                {DUE_CHOICES.map((n) => (
                  <button key={n} type="button" className="chip" aria-pressed={dueDays === n} onClick={() => setDueDays(n)}>{n === 0 ? t.dueNow : t.dueDays(n)}</button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="field-title">{t.remindQ}</span>
              <div className="chips" role="group" aria-label={t.remindQ}>
                {REMINDER_CHOICES.map((n) => (
                  <button key={n} type="button" className="chip" aria-pressed={reminderDays === n} onClick={() => setReminderDays(n)}>{n === 0 ? t.remindNever : t.remindEvery(n)}</button>
                ))}
              </div>
            </div>
          </>
        )}

        {step === 5 && (
          <>
            {loroSays(t.voiceQ, t.voiceHint)}
            <div className="field">
              <label htmlFor="country">{t.country}</label>
              <select id="country" value={country} onChange={(e) => setCountry(e.target.value)}>
                {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{lang === "es" ? c.es : c.en}</option>)}
              </select>
            </div>
            <div className="chips" role="group" aria-label={t.voiceQ}>
              <button type="button" className="chip big" aria-pressed={gender === "female"} onClick={() => setGender("female")}>{t.woman}</button>
              <button type="button" className="chip big" aria-pressed={gender === "male"} onClick={() => setGender("male")}>{t.man}</button>
            </div>
            <div className="field">
              <span className="field-title">{t.appLang}</span>
              <div className="chips" role="group" aria-label={t.appLang}>
                <button type="button" className="chip" aria-pressed={lang === "es"} onClick={() => setLang("es")}>Español</button>
                <button type="button" className="chip" aria-pressed={lang === "en"} onClick={() => setLang("en")}>English</button>
              </div>
            </div>
          </>
        )}

        {step === LOGO_STEP && (
          <>
            {loroSays(t.logoQ, t.logoHint)}
            <div className="logo-drop">
              {logo ? <img src={logo.url} alt="" /> : <img src="/brand/loro-icon.svg" alt="" className="placeholder" />}
              <label className="btn">
                {logo ? t.logoChange : t.logoPick}
                <input type="file" accept="image/png,image/jpeg" className="sr" onChange={(e) => upload(e.target.files?.[0])} disabled={busy} />
              </label>
            </div>
            {logoError && <p className="note bad" role="alert">{logoError}</p>}
          </>
        )}

        {done && (
          <div className="setup-hello">
            <div className="setup-video">
              <video src="/brand/loro-escribe.mp4" poster="/brand/loro-escribe.jpg" autoPlay muted loop playsInline aria-hidden="true" />
            </div>
            <h1 ref={heading} tabIndex={-1}>{t.doneTitle}</h1>
            <p className="lede">{t.doneText}</p>
            <a className="btn primary block" href="/">{t.firstInvoice}</a>
          </div>
        )}

        {errors.length > 0 && !done && (
          <div className="note bad" role="alert">{errors.map((e) => <div key={e}>{e}</div>)}</div>
        )}

        {!done && (
          <div className="setup-actions">
            {step === LOGO_STEP ? (
              <>
                <button type="button" className="btn ghost" onClick={() => setStep(DONE)}>{t.skip}</button>
                <button type="button" className="btn primary" onClick={() => setStep(DONE)} disabled={busy || !logo}>{t.next}</button>
              </>
            ) : (
              <button className="btn primary block" disabled={!canGo[step] || busy}>
                {step === 0 ? t.start : step === LAST_QUESTION ? (busy ? t.saving : t.saveAndGo) : t.next}
              </button>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
