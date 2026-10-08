import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { SignupForm } from "@/components/AuthForms";
import { inviteEmail, signupsOpen } from "@/lib/accounts";
import { authText, langParam, SITE_URL } from "@/lib/auth-text";
import { getCtx } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Crear cuenta" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (await getCtx()) redirect("/");
  const sp = await searchParams;
  const lang = langParam(sp.lang);
  const t = authText(lang);
  const q = lang === "en" ? "?lang=en" : "";
  const invite = typeof sp.invite === "string" ? sp.invite : undefined;
  const invited = await inviteEmail(invite);
  const open = await signupsOpen();
  return (
    <AuthShell lang={lang} path="/signup" query={invite ? { invite } : {}}>
      {invited || open ? (
        <>
          <h1>{t.signupTitle}</h1>
          <p className="lede">{t.signupIntro}</p>
          {invited && <p className="note">{t.invitedAs} <strong>{invited}</strong></p>}
          <SignupForm t={t} lang={lang} invite={invited ? invite : undefined} invitedEmail={invited ?? undefined} />
        </>
      ) : (
        <>
          <h1>{t.inviteOnlyTitle}</h1>
          <p className="lede">{invite ? t.errors.link_invalid : t.inviteOnlyText}</p>
          <a className="btn primary block" href={`${SITE_URL}/#lista`}>{t.joinWaitlist}</a>
        </>
      )}
      <p className="alt">{t.haveAccount} <Link href={`/login${q}`}>{t.signIn}</Link></p>
    </AuthShell>
  );
}
