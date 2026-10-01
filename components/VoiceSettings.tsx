"use client";

import { useState } from "react";
import { dict } from "@/lib/i18n";
import type { Lang } from "@/lib/types";
import { COUNTRIES, countryName, localeFor } from "@/lib/voice";
import { useVoice } from "./useVoice";

export function VoiceSettings({ lang, country: initialCountry, voiceOn: initialOn }: { lang: Lang; country: string; voiceOn: boolean }) {
  const t = dict(lang);
  const [country, setCountry] = useState(initialCountry);
  const [on, setOn] = useState(initialOn);
  const [msg, setMsg] = useState<{ kind: "" | "bad"; text: string } | null>(null);
  const voice = useVoice(localeFor(country, lang), on);

  async function save(patch: { country?: string; voiceOn?: boolean }) {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null);
    setMsg(res?.ok ? { kind: "", text: t.saved } : { kind: "bad", text: t.errorGeneric });
  }

  const place = countryName(country, lang);
  const status = !voice.supported
    ? t.voiceUnsupported
    : !voice.loaded
      ? ""
      : voice.match === "exact"
        ? t.voiceExact(place)
        : voice.match === "language" && voice.voice
          ? t.voiceNear(place, `${voice.voice.name}, ${voice.voice.lang}`)
          : t.voiceNone;

  return (
    <section className="card stack" data-testid="voice-settings">
      <h3 style={{ margin: 0 }}>{t.voiceTitle}</h3>
      <div>
        <label htmlFor="country">{t.country}</label>
        <select
          id="country"
          value={country}
          onChange={(e) => {
            setCountry(e.target.value);
            save({ country: e.target.value });
          }}
        >
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>{c[lang]}</option>
          ))}
        </select>
        <p className="muted small">{t.countryHint}</p>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            setOn(e.target.checked);
            save({ voiceOn: e.target.checked });
          }}
        />
        {t.voiceOnLabel}
      </label>
      {status && <p className={`note ${voice.match === "exact" ? "" : "warn"}`} data-testid="voice-status">{status}</p>}
      {voice.supported && voice.match !== "none" && (
        <div>
          <button className="btn" onClick={() => voice.speak(t.voiceSample, true)}>🔊 {t.testVoice}</button>
        </div>
      )}
      {msg && <p className={`note ${msg.kind}`} role="status">{msg.text}</p>}
    </section>
  );
}
