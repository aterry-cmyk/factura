"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { dict } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

export interface HeaderUser {
  name: string;
  email: string;
  isAdmin: boolean;
}

export function Header({ lang, user }: { lang: Lang; user: HeaderUser }) {
  const t = dict(lang);
  const path = usePathname();
  const [busy, setBusy] = useState(false);
  const menu = useRef<HTMLDetailsElement>(null);

  // Close the menu when the page changes or when tapping elsewhere.
  useEffect(() => {
    if (menu.current) menu.current.open = false;
  }, [path]);
  useEffect(() => {
    function away(e: MouseEvent) {
      if (menu.current?.open && !menu.current.contains(e.target as Node)) menu.current.open = false;
    }
    document.addEventListener("click", away);
    return () => document.removeEventListener("click", away);
  }, []);

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

  const here = (p: string) => (path === p || (p !== "/" && path.startsWith(p)) ? "page" : undefined);
  const initial = (user.name || user.email).trim().charAt(0).toUpperCase();

  return (
    <header className="top">
      <Link href="/" className="brand" aria-label="Loro AI">
        <img src="/brand/loro-icon.svg" alt="" width={34} height={34} /> Loro AI
      </Link>
      <nav>
        <Link className="btn small ghost" href="/documents" aria-current={here("/documents")}>
          {t.allDocs}
        </Link>
        <Link className="btn small ghost" href="/settings" aria-current={here("/settings")}>
          {t.settings}
        </Link>
        <details className="menu" ref={menu}>
          <summary className="avatar" aria-label={t.menu}>{initial}</summary>
          <div className="menu-panel" role="menu">
            <div className="menu-who">
              <strong className="ellipsis">{user.name || user.email}</strong>
              <span className="muted small ellipsis">{user.email}</span>
            </div>
            <Link role="menuitem" href="/account">{t.myAccount}</Link>
            {user.isAdmin && <Link role="menuitem" href="/admin">{t.adminArea}</Link>}
            <button role="menuitem" onClick={switchLang} disabled={busy}>{lang === "es" ? "English" : "Español"}</button>
            <button role="menuitem" onClick={signOut}>{t.signOut}</button>
          </div>
        </details>
      </nav>
    </header>
  );
}
