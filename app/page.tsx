import Link from "next/link";
import { Creator } from "@/components/Creator";
import { Header } from "@/components/Header";
import { aiConfigured } from "@/lib/ai/config";
import { azureConfigured } from "@/lib/azure-speech";
import { dict, statusLabel } from "@/lib/i18n";
import { formatMoney, todayIso } from "@/lib/money";
import { getDocument, getSettings, listDocuments } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const { edit } = await searchParams;
  const settings = await getSettings();
  const t = dict(settings.lang);
  const editDoc = edit ? await getDocument(edit) : null;
  const docs = editDoc ? [] : await listDocuments(30);
  const today = todayIso();
  const first = settings.ownerName.split(" ")[0];

  return (
    <main className="wrap">
      <Header lang={settings.lang} settingsLabel={t.settings} signOutLabel={t.signOut} />
      {!editDoc && first && <p className="muted" style={{ margin: "0 0 8px" }}>{t.hello}, {first} 👋</p>}
      <Creator
        key={editDoc?.id ?? "new"}
        lang={settings.lang}
        defaults={settings}
        ai={aiConfigured()}
        cloudVoice={azureConfigured()}
        edit={editDoc && editDoc.status === "draft" ? editDoc : undefined}
      >
      {!editDoc && (
        <section className="card">
          <div className="row">
            <h3 className="grow" style={{ margin: 0 }}>{t.recent}</h3>
            {docs.length > 0 && <Link href="/documents" className="btn small ghost">{t.seeAll} →</Link>}
          </div>
          {docs.length === 0 ? (
            <p className="muted">{t.nothingYet}</p>
          ) : (
            <ul className="list">
              {docs.map((d) => {
                const overdue = d.kind === "invoice" && d.status === "sent" && d.dueDate < today;
                return (
                  <li key={d.id}>
                    <Link href={`/documents/${d.id}`}>
                      <div className="grow">
                        <div style={{ fontWeight: 600 }}>{d.customer.name}</div>
                        <div className="muted small">
                          {d.kind === "invoice" ? t.invoice : t.estimate} {d.number}
                        </div>
                      </div>
                      <span className={`badge ${overdue ? "bad" : d.status === "paid" ? "" : d.status === "draft" || d.status === "void" ? "grey" : "warn"}`}>
                        {overdue ? t.overdue : statusLabel(t, d.status)}
                      </span>
                      <span className="amount">{formatMoney(d.totalCents, settings.lang)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
      </Creator>
    </main>
  );
}
