"use client";

import Link from "next/link";
import { useState } from "react";
import { dict } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

export function Header({ lang, settingsLabel, signOutLabel }: { lang: Lang; settingsLabel: string; signOutLabel: string }) {
  const [busy, setBusy] = useState(false);

  async function switchLang() {
    setBusy(true);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lang: lang === "es" ? "en" : "es" }),
    });
    window.location.reload();
  }

  async function signOut() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <header className="top">
      <Link href="/" className="brand">
        <span className="brand-mark">F</span> Factura
      </Link>
      <nav>
        <Link className="btn small ghost" href="/documents">
          {dict(lang).allDocs}
        </Link>
        <button className="btn small ghost" onClick={switchLang} disabled={busy} aria-label="Language">
          {lang === "es" ? "English" : "Español"}
        </button>
        <Link className="btn small ghost" href="/settings">
          {settingsLabel}
        </Link>
        <button className="btn small ghost" onClick={signOut}>
          {signOutLabel}
        </button>
      </nav>
    </header>
  );
}
