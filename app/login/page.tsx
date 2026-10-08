import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { LoginForm } from "@/components/AuthForms";
import { unclaimedAccount } from "@/lib/accounts";
import { authText, langParam } from "@/lib/auth-text";
import { getCtx } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (await getCtx()) redirect("/");
  const lang = langParam((await searchParams).lang);
  const t = authText(lang);
  const q = lang === "en" ? "?lang=en" : "";
  const claimable = Boolean(process.env.OWNER_PASSWORD) && (await unclaimedAccount()) !== null;
  return (
    <AuthShell lang={lang} path="/login">
      <h1>{t.welcomeBack}</h1>
      <p className="lede">{t.loginIntro}</p>
      {claimable && (
        <div className="banner">
          <span>{t.claimBanner}</span>
          <Link href={`/claim${q}`} className="btn small secondary">{t.claimLink}</Link>
        </div>
      )}
      <LoginForm t={t} lang={lang} />
      <p className="alt">{t.noAccount} <Link href={`/signup${q}`}>{t.createAccount}</Link></p>
    </AuthShell>
  );
}
