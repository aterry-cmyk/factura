import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocView } from "@/components/DocView";
import { dict } from "@/lib/i18n";
import { todayIso } from "@/lib/money";
import { getByToken, getSettings } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** The customer's page: the document and a PDF download. No sign-in; the link is the key. */
export default async function PublicDoc({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const doc = await getByToken(token);
  if (!doc) notFound();
  const settings = await getSettings(doc.accountId);
  const t = dict(doc.lang);
  return (
    <main className="wrap">
      <div className="row" style={{ justifyContent: "flex-end", marginBottom: 12 }}>
        <a className="btn primary" href={`/i/${token}/pdf`}>{t.downloadPdf}</a>
      </div>
      <DocView doc={doc} logoSrc={settings.hasLogo ? `/i/${token}/logo` : null} today={todayIso()} />
    </main>
  );
}
