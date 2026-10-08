import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { ResetForm } from "@/components/AuthForms";
import { resetTarget } from "@/lib/accounts";
import { authText, langParam } from "@/lib/auth-text";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Contraseña nueva", referrer: "no-referrer" };

export default async function ResetPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const lang = langParam(sp.lang);
  const t = authText(lang);
  const token = typeof sp.token === "string" ? sp.token : "";
  const target = await resetTarget(token);
  return (
    <AuthShell lang={lang} path="/reset" query={token ? { token } : {}} art="escribe">
      {target ? (
        <>
          <h1>{t.resetTitle}</h1>
          <p className="lede">{t.resetFor} <strong>{target.email}</strong></p>
          <ResetForm t={t} token={token} />
        </>
      ) : (
        <>
          <h1>{t.resetExpiredTitle}</h1>
          <p className="lede">{t.resetExpiredText}</p>
          <Link className="btn block" href={lang === "en" ? "/login?lang=en" : "/login"}>{t.backToLogin}</Link>
        </>
      )}
    </AuthShell>
  );
}
