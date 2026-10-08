import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { authText, langParam } from "@/lib/auth-text";

export const metadata: Metadata = { title: "Contraseña" };

/** No email yet, so a forgotten password is fixed with a one-time link an admin makes in /admin. */
export default async function ForgotPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const lang = langParam((await searchParams).lang);
  const t = authText(lang);
  return (
    <AuthShell lang={lang} path="/forgot" art="escribe">
      <h1>{t.forgotTitle}</h1>
      <p className="lede">{t.forgotText}</p>
      <Link className="btn block" href={lang === "en" ? "/login?lang=en" : "/login"}>{t.backToLogin}</Link>
    </AuthShell>
  );
}
