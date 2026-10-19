import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocView } from "@/components/DocView";
import { dict } from "@/lib/i18n";
import { CustomerBox } from "@/components/CustomerBox";
import { amountDueCents, formatMoney, todayIso } from "@/lib/money";
import { MIN_ONLINE_CENTS, stripeConfigured } from "@/lib/payments";
import { getByToken, getSettings } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** The customer's page: the document and a PDF download. No sign-in; the link is the key. */
export default async function PublicDoc({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ pago?: string }> }) {
  const { token } = await params;
  const { pago } = await searchParams;
  const doc = await getByToken(token);
  if (!doc) notFound();
  const settings = await getSettings(doc.accountId);
  const t = dict(doc.lang);
  const today = todayIso();
  const due = amountDueCents(doc, today);
  const canPay = doc.kind === "invoice" && doc.status === "sent" && stripeConfigured() && settings.stripeReady && due >= MIN_ONLINE_CENTS;
  return (
    <main className="wrap">
      <div className="row" style={{ justifyContent: "flex-end", marginBottom: 12 }}>
        <a className="btn" href={`/i/${token}/pdf`}>{t.downloadPdf}</a>
      </div>
      <CustomerBox
        lang={doc.lang} token={token} kind={doc.kind} status={doc.status} canPay={canPay} amountText={formatMoney(due, doc.lang)}
        paidAt={doc.paidAt} acceptedAt={doc.acceptedAt} acceptedBy={doc.acceptedBy} payResult={pago ?? null} businessName={doc.business.name}
      />
      <DocView doc={doc} logoSrc={settings.hasLogo ? `/i/${token}/logo` : null} today={today} />
      <p className="made-with">{doc.lang === "es" ? "Hecha con" : "Made with"} <img src="/brand/loro-icon.svg" alt="" width={18} height={18} /> Loro AI</p>
    </main>
  );
}
