"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pickVoice } from "@/lib/voice";

// Two ways to talk: Azure's natural voice for his country (cloud, when the server has a key), or
// the device's own voice. If Azure fails for any reason, the device's voice says it instead.
function synth(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
}

// A tenth of a second of silence, so iPhone Safari lets this page play sound after a tap.
function silentWav(): string {
  const samples = 2400;
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + samples * 2, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 24000, true);
  v.setUint32(28, 48000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, samples * 2, true);
  let bin = "";
  new Uint8Array(buf).forEach((b) => (bin += String.fromCharCode(b)));
  return `data:audio/wav;base64,${btoa(bin)}`;
}

/** voiceKey: changes whenever the Azure voice does (country, woman/man), so old clips aren't replayed. */
export function useVoice(locale: string, enabled: boolean, cloud = false, voiceKey = locale) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [supported, setSupported] = useState(true);
  const audio = useRef<HTMLAudioElement | null>(null);
  const clips = useRef(new Map<string, string>()); // text → object URL, so "listen again" is instant
  const pending = useRef<AbortController | null>(null);

  useEffect(() => {
    const s = synth();
    if (!s) {
      setSupported(false);
      return;
    }
    // Voices load late in Chrome: the list is empty until "voiceschanged".
    const load = () => setVoices(s.getVoices());
    load();
    s.addEventListener("voiceschanged", load);
    const urls = clips.current;
    return () => {
      s.removeEventListener("voiceschanged", load);
      s.cancel();
      pending.current?.abort();
      audio.current?.pause();
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  const picked = pickVoice(voices, locale);

  const deviceSpeak = useCallback(
    (text: string) => {
      const s = synth();
      if (!s) return;
      // Talking is a help, never a step: if the device's speech fails, the flow carries on quietly.
      try {
        s.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = picked.voice?.lang ?? locale;
        if (picked.voice) u.voice = picked.voice;
        u.rate = 1;
        s.speak(u);
      } catch {
        // nothing to do: the screen already shows everything that would have been said
      }
    },
    [locale, picked.voice],
  );

  const player = () => (audio.current ??= typeof Audio !== "undefined" ? new Audio() : null);

  const stop = useCallback(() => {
    pending.current?.abort();
    pending.current = null;
    audio.current?.pause();
    try {
      synth()?.cancel();
    } catch {
      // see deviceSpeak
    }
  }, []);

  const speak = useCallback(
    async (text: string, force = false) => {
      if ((!enabled && !force) || !text.trim()) return;
      stop();
      const a = player();
      if (!cloud || !a) return deviceSpeak(text);
      const ctrl = new AbortController();
      pending.current = ctrl;
      try {
        const key = `${voiceKey}|${text}`;
        let url = clips.current.get(key);
        if (!url) {
          const res = await fetch("/api/speak", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
            signal: ctrl.signal,
          });
          if (!res.ok) throw new Error(`speak ${res.status}`);
          url = URL.createObjectURL(await res.blob());
          clips.current.set(key, url);
        }
        if (ctrl.signal.aborted) return;
        a.src = url;
        await a.play();
      } catch (err) {
        if (ctrl.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
        deviceSpeak(text);
      } finally {
        if (pending.current === ctrl) pending.current = null;
      }
    },
    [cloud, deviceSpeak, enabled, stop, voiceKey],
  );

  /**
   * iPhone Safari only plays sound that began inside a tap. Call this in the tap handler before an
   * await, so a summary spoken after the server answers is still allowed.
   */
  const prime = useCallback(() => {
    if (!enabled) return;
    try {
      const a = player();
      if (cloud && a) {
        a.src = silentWav();
        a.play().catch(() => {});
      } else {
        const s = synth();
        if (!s) return;
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0;
        s.speak(u);
      }
    } catch {
      // see deviceSpeak
    }
  }, [cloud, enabled]);

  return {
    speak,
    prime,
    stop,
    cloud,
    supported: cloud || supported,
    voice: picked.voice,
    match: cloud ? ("exact" as const) : picked.match,
    loaded: cloud || voices.length > 0,
  };
}
