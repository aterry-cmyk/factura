import { dict } from "@/lib/i18n";
import { amountDueCents, formatMoney, lateFeeCents, lineTotalCents } from "@/lib/money";
import { businessLines, docTitle, formatDate, lateFeeTerms, paymentLines } from "@/lib/document-text";
import type { Doc } from "@/lib/types";
import { displayPhone } from "@/lib/validate";

/** The document as the customer sees it. Same wording as the PDF. */
export function DocView({ doc, logoSrc, today }: { doc: Doc; logoSrc: string | null; today: string }) {
  const t = dict(doc.lang);
  const late = doc.kind === "invoice" && doc.status !== "paid" && doc.status !== "void" ? lateFeeCents(doc, today) : 0;
  const pay = paymentLines(doc);
  const terms = lateFeeTerms(doc);
  return (
    <article className="doc" data-testid="doc">
      <div className="doc-head">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {logoSrc && <img src={logoSrc} alt="" />}
          <div style={{ fontWeight: 800, fontSize: 18 }}>{doc.business.name}</div>
          {doc.business.ownerName && <div className="muted">{doc.business.ownerName}</div>}
          {businessLines(doc).map((l) => <div key={l} className="muted" style={{ fontSize: 14 }}>{l}</div>)}
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="doc-title">{docTitle(doc).toUpperCase()}</div>
          <div><span className="muted">{t.number}:</span> <strong>{doc.number}</strong></div>
          <div><span className="muted">{t.issued}:</span> {formatDate(doc.issueDate, doc.lang)}</div>
          <div><span className="muted">{doc.kind === "invoice" ? t.due : t.validUntil}:</span> {formatDate(doc.dueDate, doc.lang)}</div>
          {doc.status === "paid" && <div style={{ marginTop: 8 }}><span className="stamp">{t.statusPaid.toUpperCase()}</span></div>}
          {doc.status === "void" && <div style={{ marginTop: 8 }}><span className="stamp" style={{ borderColor: "#b3261e", color: "#b3261e" }}>{t.statusVoid.toUpperCase()}</span></div>}
        </div>
      </div>

      <div className="section">
        <h4>{t.billTo}</h4>
        <div style={{ fontWeight: 700 }}>{doc.customer.name}</div>
        {doc.customer.company && <div>{doc.customer.company}</div>}
        {doc.customer.email && <div className="muted">{doc.customer.email}</div>}
        {doc.customer.phone && <div className="muted">{displayPhone(doc.customer.phone)}</div>}
      </div>

      <table>
        <thead>
          <tr>
            <th>{t.description}</th>
            <th className="num">{t.quantity}</th>
            <th className="num hide-sm">{t.price}</th>
            <th className="num">{t.amount}</th>
          </tr>
        </thead>
        <tbody>
          {doc.items.map((i, n) => (
            <tr key={n}>
              <td>{i.description}</td>
              <td className="num">{i.quantity}</td>
              <td className="num hide-sm">{formatMoney(i.unitPriceCents, doc.lang)}</td>
              <td className="num">{formatMoney(lineTotalCents(i), doc.lang)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="totals">
        <div><span className="muted">{t.subtotal}</span><span>{formatMoney(doc.subtotalCents, doc.lang)}</span></div>
        {doc.taxCents > 0 && (
          <div><span className="muted">{t.tax} ({doc.taxRate}%{doc.state ? ` ${doc.state}` : ""})</span><span>{formatMoney(doc.taxCents, doc.lang)}</span></div>
        )}
        <div className="strong"><span>{t.total}</span><span>{formatMoney(doc.totalCents, doc.lang)}</span></div>
        {late > 0 && (
          <>
            <div><span className="muted">{t.lateCharge}</span><span>{formatMoney(late, doc.lang)}</span></div>
            <div className="strong"><span>{t.amountDue}</span><span>{formatMoney(amountDueCents(doc, today), doc.lang)}</span></div>
          </>
        )}
      </div>

      {pay.length > 0 && (
        <div className="section">
          <h4>{t.howToPay}</h4>
          {pay.map((l) => <div key={l} style={{ whiteSpace: "pre-wrap" }}>{l}</div>)}
        </div>
      )}
      {terms && (
        <div className="section">
          <h4>{t.lateCharge}</h4>
          <div>{terms}</div>
        </div>
      )}
      {doc.notes && (
        <div className="section">
          <h4>{t.notes.replace(/\s*\(.*\)$/, "")}</h4>
          <div style={{ whiteSpace: "pre-wrap" }}>{doc.notes}</div>
        </div>
      )}
      <p style={{ marginTop: 22, fontWeight: 700, color: "#14261d" }}>{t.thankYou}</p>
    </article>
  );
}
