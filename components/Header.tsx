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
  business?: string;
}

const icon = {
  home: "M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z",
  docs: "M4 4h10l6 6v10a0 0 0 0 1 0 0H4z M14 4v6h6 M8 14h8 M8 17h5",
  dash: "M4 20V10 M10 20V4 M16 20v-7 M22 20H2",
  settings: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M19.4 13a7.6 7.6 0 0 0 0-2l2-1.5-2-3.4-2.3.9a7.5 7.5 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.5 7.5 0 0 0-1.7 1l-2.3-.9-2 3.4 2 1.5a7.6 7.6 0 0 0 0 2l-2 1.5 2 3.4 2.3-.9a7.5 7.5 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.5 7.5 0 0 0 1.7-1l2.3.9 2-3.4z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21a8 8 0 0 1 16 0",
  admin: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z M9 12l2 2 4-4",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M21 21l-4.3-4.3",
  spark: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
};
function Icon({ d, filled }: { d: string; filled?: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} fill={filled ? "currentColor" : "none"} stroke={filled ? "none" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The signed-in frame: a dark bar across the top (logo, business, search, account menu) and an icon
 * rail on the left, which becomes a bar along the bottom on phones.
 */
export function Header({ lang, user }: { lang: Lang; user: HeaderUser }) {
  const t = dict(lang);
  const es = lang === "es";
  const path = usePathname();
  const [busy, setBusy] = useState(false);
  const menu = useRef<HTMLDetailsElement>(null);

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
    await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lang: es ? "en" : "es" }) });
    window.location.reload();
  }
  async function signOut() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const here = (p: string) => (p === "/" ? path === "/" : path.startsWith(p)) ? "page" : undefined;
  const initial = (user.name || user.email).trim().charAt(0).toUpperCase();
  const rail: { href: string; label: string; d: string; filled?: boolean; show: boolean }[] = [
    { href: "/", label: es ? "Nueva" : "New", d: icon.home, filled: true, show: true },
    { href: "/documents", label: t.allDocs, d: icon.dash, show: true },
    { href: "/estimator", label: es ? "Estimador" : "Estimator", d: icon.spark, show: true },
    { href: "/settings", label: t.settings, d: icon.settings, show: true },
    { href: "/account", label: t.myAccount, d: icon.user, show: true },
    { href: "/admin", label: "Admin", d: icon.admin, show: user.isAdmin },
  ];

  return (
    <>
      <header className="topbar">
        <Link href="/" className="tb-brand" aria-label="Loro AI">
          <img src="/brand/loro-icon.svg" alt="" width={32} height={32} />
          <span>Loro AI</span>
        </Link>
        {user.business && (
          <span className="tb-org"><span className="tb-label">{es ? "Negocio:" : "Business:"}</span><b>{user.business}</b></span>
        )}
        <form className="tb-search" method="get" action="/documents" role="search">
          <label className="sr" htmlFor="tb-q">{es ? "Buscar facturas y clientes" : "Search invoices and customers"}</label>
          <input id="tb-q" name="q" type="search" placeholder={es ? "Buscar cliente, número o trabajo…" : "Search customer, number or job…"} />
          <button type="submit" aria-label={es ? "Buscar" : "Search"}><Icon d={icon.search} /></button>
        </form>
        <details className="menu" ref={menu}>
          <summary className="avatar" aria-label={t.menu}>{initial}</summary>
          <div className="menu-panel" role="menu">
            <div className="menu-who">
              <strong className="ellipsis">{user.name || user.email}</strong>
              <span className="muted small ellipsis">{user.email}</span>
            </div>
            <Link role="menuitem" href="/account">{t.myAccount}</Link>
            {user.isAdmin && <Link role="menuitem" href="/admin">{t.adminArea}</Link>}
            <button role="menuitem" onClick={switchLang} disabled={busy}>{es ? "English" : "Español"}</button>
            <button role="menuitem" onClick={signOut}>{t.signOut}</button>
          </div>
        </details>
      </header>
      <nav className="rail" aria-label={es ? "Secciones" : "Sections"}>
        {rail.filter((r) => r.show).map((r) => (
          <Link key={r.href} href={r.href} aria-current={here(r.href)} title={r.label}>
            <Icon d={r.d} filled={r.filled} />
            <span>{r.label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
