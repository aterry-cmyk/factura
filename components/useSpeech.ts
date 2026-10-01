"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The browser's own speech recognition (Chrome, Edge, Safari). No audio leaves through this app;
// the browser turns speech into text and we only ever see the text.
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type SpeechState = "idle" | "listening" | "unsupported" | "denied";

/** locale: "es-MX", "es-PR", "en-US"… from lib/voice.ts localeFor. */
export function useSpeech(locale: string, onFinal: (text: string) => void) {
  const [state, setState] = useState<SpeechState>("idle");
  const [interim, setInterim] = useState("");
  const rec = useRef<Recognition | null>(null);
  const final = useRef(onFinal);
  useEffect(() => {
    final.current = onFinal;
  }, [onFinal]);
  useEffect(() => {
    if (!ctor()) setState("unsupported");
    return () => rec.current?.stop();
  }, []);

  const begin = useCallback(function listen(lang: string) {
    const C = ctor();
    if (!C) return setState("unsupported");
    const r = new C();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) final.current(res[0].transcript.trim());
        else live += res[0].transcript;
      }
      setInterim(live);
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setState("denied");
      // A browser that doesn't know this country's Spanish still knows US Spanish.
      if (e.error === "language-not-supported" && lang !== "es-US" && lang.startsWith("es")) {
        r.onend = null;
        listen("es-US");
      }
    };
    r.onend = () => {
      setInterim("");
      setState((s) => (s === "listening" ? "idle" : s));
    };
    rec.current = r;
    r.start();
    setState("listening");
  }, []);

  const start = useCallback(() => begin(locale), [begin, locale]);

  const stop = useCallback(() => {
    rec.current?.stop();
    setState((s) => (s === "listening" ? "idle" : s));
  }, []);

  return { state, interim, start, stop };
}
