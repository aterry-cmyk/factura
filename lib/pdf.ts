import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from "pdf-lib";
import { dict } from "./i18n";
import { amountDueCents, formatMoney, lateFeeCents, lineTotalCents } from "./money";
import type { Doc } from "./types";
import { businessLines, docTitle, formatDate, lateFeeTerms, paymentLines } from "./document-text";

// The standard PDF fonts only know Windows-1252. Spanish (á é í ó ú ñ ü ¿ ¡) is all in it;
// anything else is folded to its plain letter, or "?" — never a crash on a customer's name.
const CP1252_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
export function pdfSafe(text: string): string {
  return Array.from(text.replace(/[   ]/g, " "))
    .map((ch) => {
      const c = ch.charCodeAt(0);
      if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || CP1252_EXTRA.includes(ch)) return ch;
      if (ch === "\n" || ch === "\t") return " ";
      const folded = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
      return folded && folded !== ch && /^[\x20-\x7e]+$/.test(folded) ? folded : "?";
    })
    .join("");
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of pdfSafe(text).split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      // A single word longer than the line (a long email or link) is cut, not overflowed.
      let w = word;
      while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
        let cut = w.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut--;
        out.push(w.slice(0, cut));
        w = w.slice(cut);
      }
      line = w;
    }
    out.push(line);
  }
  return out;
}

const INK = rgb(0.12, 0.13, 0.16);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.86, 0.87, 0.9);
const ACCENT = rgb(0.09, 0.4, 0.33);

export async function renderPdf(
  doc: Doc,
  opts: { logo?: { bytes: Buffer; type: string } | null; today: string },
): Promise<Uint8Array> {
  const t = dict(doc.lang);
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${docTitle(doc)} ${doc.number}`);
  pdf.setAuthor(pdfSafe(doc.business.name));
  pdf.setCreator("Factura");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 612;
  const H = 792;
  const M = 48;
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;

  const text = (s: string, x: number, yy: number, size = 10, f = font, color = INK) =>
    page.drawText(pdfSafe(s), { x, y: yy, size, font: f, color });
  const right = (s: string, xRight: number, yy: number, size = 10, f = font, color = INK) =>
    text(s, xRight - f.widthOfTextAtSize(pdfSafe(s), size), yy, size, f, color);
  const ensure = (needed: number) => {
    if (y - needed < M + 20) {
      page = pdf.addPage([W, H]);
      y = H - M;
    }
  };

  // Header: logo and business on the left, title and dates on the right.
  let logo: PDFImage | null = null;
  if (opts.logo) {
    try {
      logo = opts.logo.type === "image/png" ? await pdf.embedPng(opts.logo.bytes) : await pdf.embedJpg(opts.logo.bytes);
    } catch {
      logo = null; // A logo that can't be read is left off rather than failing the invoice.
    }
  }
  let leftY = y;
  if (logo) {
    const scale = Math.min(150 / logo.width, 60 / logo.height, 1);
    const w = logo.width * scale;
    const h = logo.height * scale;
    page.drawImage(logo, { x: M, y: leftY - h, width: w, height: h });
    leftY -= h + 10;
  }
  text(doc.business.name, M, leftY - 14, 14, bold);
  leftY -= 30;
  if (doc.business.ownerName) {
    text(doc.business.ownerName, M, leftY, 9, font, MUTED);
    leftY -= 12;
  }
  for (const line of businessLines(doc)) {
    for (const l of wrap(line, font, 9, 260)) {
      text(l, M, leftY, 9, font, MUTED);
      leftY -= 12;
    }
  }

  const title = docTitle(doc).toUpperCase();
  right(title, W - M, y - 22, 24, bold, ACCENT);
  let rightY = y - 44;
  const meta: [string, string][] = [
    [t.number, doc.number],
    [t.issued, formatDate(doc.issueDate, doc.lang)],
    [doc.kind === "invoice" ? t.due : t.validUntil, formatDate(doc.dueDate, doc.lang)],
  ];
  if (doc.status === "paid") meta.push([t.status, t.statusPaid]);
  for (const [k, v] of meta) {
    right(v, W - M, rightY, 10, bold);
    right(`${k}:`, W - M - bold.widthOfTextAtSize(pdfSafe(v), 10) - 6, rightY, 10, font, MUTED);
    rightY -= 14;
  }
  y = Math.min(leftY, rightY) - 14;

  // Bill to
  text(t.billTo.toUpperCase(), M, y, 8, bold, MUTED);
  y -= 14;
  const c = doc.customer;
  for (const line of [c.name, c.company, c.email, c.phone ? c.phone.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3") : ""].filter(Boolean)) {
    text(line, M, y, line === c.name ? 11 : 9, line === c.name ? bold : font, line === c.name ? INK : MUTED);
    y -= line === c.name ? 14 : 12;
  }
  y -= 12;

  // Items
  const colQty = 360;
  const colPrice = 460;
  const colAmt = W - M;
  const descWidth = colQty - M - 40;
  page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 20, color: rgb(0.95, 0.96, 0.97) });
  text(t.description, M + 6, y, 9, bold, MUTED);
  right(t.quantity, colQty, y, 9, bold, MUTED);
  right(t.price, colPrice, y, 9, bold, MUTED);
  right(t.amount, colAmt - 6, y, 9, bold, MUTED);
  y -= 24;
  for (const item of doc.items) {
    const lines = wrap(item.description, font, 10, descWidth);
    ensure(lines.length * 13 + 10);
    const top = y;
    lines.forEach((l, i) => text(l, M + 6, top - i * 13, 10));
    right(String(item.quantity), colQty, top, 10);
    right(formatMoney(item.unitPriceCents, doc.lang), colPrice, top, 10);
    right(formatMoney(lineTotalCents(item), doc.lang), colAmt - 6, top, 10);
    y = top - lines.length * 13 - 6;
    page.drawLine({ start: { x: M, y: y + 2 }, end: { x: W - M, y: y + 2 }, thickness: 0.5, color: RULE });
    y -= 8;
  }

  // Totals
  ensure(110);
  const labelX = colPrice - 30;
  const row = (label: string, value: string, strong = false) => {
    right(label, labelX + 60, y, strong ? 11 : 10, strong ? bold : font, strong ? INK : MUTED);
    right(value, colAmt - 6, y, strong ? 11 : 10, strong ? bold : font);
    y -= strong ? 18 : 15;
  };
  y -= 4;
  row(t.subtotal, formatMoney(doc.subtotalCents, doc.lang));
  if (doc.taxCents > 0) row(`${t.tax} (${doc.taxRate}%${doc.state ? ` ${doc.state}` : ""})`, formatMoney(doc.taxCents, doc.lang));
  row(t.total, formatMoney(doc.totalCents, doc.lang), true);
  const late = doc.kind === "invoice" && doc.status !== "paid" ? lateFeeCents(doc, opts.today) : 0;
  if (late > 0) {
    row(t.lateCharge, formatMoney(late, doc.lang));
    row(t.amountDue, formatMoney(amountDueCents(doc, opts.today), doc.lang), true);
  }
  y -= 10;

  // Terms, how to pay, notes
  const block = (heading: string, lines: string[]) => {
    if (!lines.length) return;
    const wrapped = lines.flatMap((l) => wrap(l, font, 9.5, W - 2 * M));
    ensure(18 + wrapped.length * 13);
    text(heading.toUpperCase(), M, y, 8, bold, MUTED);
    y -= 14;
    for (const l of wrapped) {
      text(l, M, y, 9.5);
      y -= 13;
    }
    y -= 10;
  };
  block(t.howToPay, paymentLines(doc));
  const terms = lateFeeTerms(doc);
  if (terms) block(t.lateCharge, [terms]);
  if (doc.notes) block(t.notes.replace(/\s*\(.*\)$/, ""), [doc.notes]);

  ensure(30);
  text(t.thankYou, M, Math.max(y - 6, M), 10, bold, ACCENT);

  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    if (pages.length > 1)
      p.drawText(`${doc.number} · ${i + 1}/${pages.length}`, { x: W - M - 60, y: 24, size: 8, font, color: MUTED });
  });
  return pdf.save();
}
