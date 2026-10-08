import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { ClaimForm } from "@/components/AuthForms";
import { unclaimedAccount } from "@/lib/accounts";
import { authText, langParam } from "@/lib/auth-text";
import { getCtx } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Recuperar cuenta" };

/** Exists only until the data from before accounts has an owner. */
export default async function ClaimPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (await getCtx()) redirect("/");
  if (!process.env.OWNER_PASSWORD || !(await unclaimedAccount())) notFound();
  const lang = langParam((await searchParams).lang);
  const t = authText(lang);
  return (
    <AuthShell lang={lang} path="/claim">
      <h1>{t.claimTitle}</h1>
      <p className="lede">{t.claimIntro}</p>
      <ClaimForm t={t} />
    </AuthShell>
  );
}
