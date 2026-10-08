import Link from "next/link";
import type { Lang } from "@/lib/types";

/**
 * The frame for every screen before sign-in: the form on the left, Loro on a yellow panel on the
 * right (on top, smaller, on phones). The language switch keeps the rest of the address.
 */
export function AuthShell({
  lang, path, query = {}, children, art = "hola",
}: {
  lang: Lang; path: string; query?: Record<string, string>; children: React.ReactNode; art?: "hola" | "escribe";
}) {
  const other = lang === "es" ? "en" : "es";
  const params = new URLSearchParams({ ...query, ...(other === "en" ? { lang: "en" } : {}) }).toString();
  return (
    <main className="auth">
      <section className="auth-form">
        <div className="auth-top">
          <Link href={lang === "en" ? "/login?lang=en" : "/login"} className="brand" aria-label="Loro AI">
            <img src="/brand/loro-icon.svg" alt="" width={34} height={34} /> Loro AI
          </Link>
          <Link className="btn small ghost" href={`${path}${params ? `?${params}` : ""}`} hrefLang={other}>
            {other === "en" ? "English" : "Español"}
          </Link>
        </div>
        <div className="auth-body">{children}</div>
      </section>
      <aside className="auth-art" aria-hidden="true">
        <div className="auth-blob">
          <video src={`/brand/loro-${art}.mp4`} poster={`/brand/loro-${art}.jpg`} autoPlay muted loop playsInline />
        </div>
        <p className="auth-bubble">{art === "hola" ? (lang === "es" ? "¡Hola!" : "Hi!") : lang === "es" ? "¡Anotado!" : "Got it!"}</p>
      </aside>
    </main>
  );
}
