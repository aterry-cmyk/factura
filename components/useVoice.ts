"use client";

import { useCallback, useEffect, useState } from "react";
import { pickVoice } from "@/lib/voice";

// The device's own text-to-speech. Nothing leaves the browser.
function synth(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
}

export function useVoice(locale: string, enabled: boolean) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [supported, setSupported] = useState(true);

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
    return () => {
      s.removeEventListener("voiceschanged", load);
      s.cancel();
    };
  }, []);

  const picked = pickVoice(voices, locale);

  const speak = useCallback(
    (text: string, force = false) => {
      const s = synth();
      if (!s || (!enabled && !force) || !text.trim()) return;
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
    [enabled, locale, picked.voice],
  );

  /**
   * iPhone Safari only speaks if speech began inside a tap. Call this in the tap handler before an
   * await, so a summary spoken after the server answers is still allowed.
   */
  const prime = useCallback(() => {
    const s = synth();
    if (!s || !enabled) return;
    try {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      s.speak(u);
    } catch {
      // see speak()
    }
  }, [enabled]);

  const stop = useCallback(() => {
    try {
      synth()?.cancel();
    } catch {
      // see speak()
    }
  }, []);

  return { speak, prime, stop, supported, voice: picked.voice, match: picked.match, loaded: voices.length > 0 };
}
