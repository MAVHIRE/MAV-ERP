/**
 * MAV HIRE ERP — js/components/quotePdf.js
 * Generates a print-ready quote PDF matching Current RMS style.
 * Uses the browser's print dialog (window.print) with a dedicated
 * print stylesheet injected at runtime — no external PDF lib needed.
 *
 * Usage:
 *   import { generateQuotePdf } from '../components/quotePdf.js';
 *   generateQuotePdf(quote);  // opens print dialog
 */

import { esc, fmtCurDec, fmtDate } from '../utils/format.js';
import { STATE } from '../utils/state.js';

// Company config — pulled from STATE.settings if loaded, otherwise fallback
function getCompany() {
  const s = STATE.settings || {};
  return {
    name:    s.businessName    || 'MAV Hire',
    address: s.businessAddress || '',
    phone:   s.businessPhone   || '',
    email:   s.businessEmail   || '',
    website: s.businessWebsite || '',
    logoUrl: s.logoUrl         || '',
    vatRate: s.vatRate         || 20,
  };
}

const TERMS = `I, the undersigned, accept the terms and conditions of rental.`;

// ── Main export ───────────────────────────────────────────────────────────────
export function generateQuotePdf(quote) {
  const html = buildPdfHtml(quote);
  const win  = window.open('', '_blank', 'width=900,height=700');
  if (!win) { alert('Pop-up blocked — please allow pop-ups for this site.'); return; }
  win.document.write(html);
  win.document.close();
  win.addEventListener('load', () => { win.focus(); win.print(); });
}

// ── HTML builder ──────────────────────────────────────────────────────────────
function buildPdfHtml(q) {
  const COMPANY  = getCompany();
  const items    = q.items || [];
  const grouped  = groupByCategory(items);
  const rentalItems = items.filter(i => i.lineType !== 'Service');
  const serviceItems= items.filter(i => i.lineType === 'Service');

  const deliveryRange = [
    q.deliveryDate   ? fmtDate(q.deliveryDate)   : '',
    q.collectionDate ? fmtDate(q.collectionDate) : '',
  ].filter(Boolean).join(' to ');

  const rentalRange = [
    q.startDate  ? `${fmtDate(q.startDate)} ${q.startTime  || '07:00'}` : '',
    q.endDate    ? `${fmtDate(q.endDate)}   ${q.endTime    || '20:00'}` : '',
  ].filter(Boolean).join(' to ');

  const logoHtml = COMPANY.logoUrl
    ? `<img src="${COMPANY.logoUrl}" class="logo" alt="${esc(COMPANY.name)}">`
    : `<div class="logo-text">${esc(COMPANY.name)}</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Quotation — ${esc(q.eventName || q.quoteId)}</title>
<style>
  /* ── Reset ── */
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  /* ── Page ── */
  @page { size: A4; margin: 18mm 16mm; }
  body {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 10pt;
    color: #1a1a1a;
    background: #fff;
    line-height: 1.45;
  }

  /* ── Header ── */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 20pt;
    padding-bottom: 14pt;
    border-bottom: 2px solid #111;
  }
  .logo { height: 52pt; width: auto; }
  .logo-text {
    font-size: 22pt;
    font-weight: 700;
    letter-spacing: -.02em;
    color: #111;
  }
  .doc-type {
    text-align: right;
  }
  .doc-type h1 {
    font-size: 22pt;
    font-weight: 700;
    color: #111;
    letter-spacing: -.01em;
    line-height: 1;
  }
  .doc-type .event-name {
    font-size: 13pt;
    font-weight: 600;
    color: #333;
    margin-top: 3pt;
  }
  .doc-type .doc-date {
    font-size: 9pt;
    color: #666;
    margin-top: 2pt;
  }

  /* ── Meta grid ── */
  .meta-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    margin-bottom: 18pt;
    font-size: 9.5pt;
  }
  .meta-block { padding: 10pt 0; }
  .meta-block + .meta-block { padding-left: 20pt; border-left: 1px solid #e0e0e0; }
  .meta-row { display: flex; gap: 8pt; margin-bottom: 3pt; }
  .meta-label { color: #888; width: 90pt; flex-shrink: 0; }
  .meta-value { color: #111; font-weight: 500; }

  /* ── Client block ── */
  .client-name { font-size: 11pt; font-weight: 600; margin-bottom: 2pt; }
  .client-detail { font-size: 9pt; color: #555; }

  /* ── Items table ── */
  .items-section { margin-bottom: 14pt; }
  .event-title {
    font-size: 12pt;
    font-weight: 700;
    margin-bottom: 8pt;
    color: #111;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9.5pt;
  }
  thead tr {
    background: #111;
    color: #fff;
  }
  th {
    padding: 6pt 8pt;
    text-align: left;
    font-weight: 600;
    font-size: 9pt;
    letter-spacing: .03em;
    text-transform: uppercase;
  }
  th.right { text-align: right; }

  .category-row td {
    padding: 8pt 8pt 3pt;
    font-weight: 700;
    font-size: 10pt;
    color: #111;
    border-bottom: 1px solid #ccc;
  }

  td {
    padding: 5pt 8pt;
    border-bottom: 1px solid #efefef;
    vertical-align: top;
  }
  td.right { text-align: right; }
  td.item-name { font-weight: 500; }
  td.item-img { width: 28pt; padding: 3pt 6pt 3pt 8pt; }
  td.item-img img { width: 22pt; height: 22pt; object-fit: contain; border-radius: 2pt; }
  td.item-type { width: 50pt; }
  td.type-pill {
    display: inline-block;
    font-size: 7.5pt;
    padding: 1pt 5pt;
    border-radius: 3pt;
    font-weight: 600;
    text-transform: uppercase;
  }
  .type-rental  { background: #e8f4fd; color: #1a6fa8; }
  .type-service { background: #fff3e0; color: #b36200; }
  .type-bundle  { background: #f0fce8; color: #2d7a1f; }

  /* Totals */
  .totals-table { width: 240pt; margin-left: auto; margin-top: 10pt; }
  .totals-table td { padding: 4pt 8pt; border: none; }
  .totals-table .total-label { color: #555; }
  .totals-table .total-value { text-align: right; font-weight: 500; }
  .totals-table tr.grand-total td {
    border-top: 2px solid #111;
    font-weight: 700;
    font-size: 11pt;
    padding-top: 7pt;
  }

  /* ── Footer meta ── */
  .footer-meta {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 12pt;
    margin-top: 16pt;
    padding-top: 10pt;
    border-top: 1px solid #e0e0e0;
    font-size: 9pt;
  }
  .footer-meta-label { color: #888; font-size: 8pt; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 2pt; }
  .footer-meta-value { font-weight: 600; }

  /* ── Signature block ── */
  .signature-block {
    margin-top: 20pt;
    padding: 12pt;
    border: 1px solid #ccc;
    border-radius: 3pt;
    font-size: 9.5pt;
    color: #444;
  }
  .sig-terms { margin-bottom: 14pt; font-style: italic; }
  .sig-line {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 20pt;
  }
  .sig-field { border-bottom: 1px solid #999; padding-bottom: 14pt; }
  .sig-field-label { font-size: 8pt; color: #888; margin-top: 4pt; text-transform: uppercase; letter-spacing: .04em; }

  /* ── Page footer ── */
  .page-footer {
    position: fixed;
    bottom: 0; left: 0; right: 0;
    display: flex;
    justify-content: space-between;
    font-size: 8pt;
    color: #999;
    padding: 6pt 0;
    border-top: 1px solid #efefef;
  }

  /* ── Notes ── */
  .notes-block {
    margin-top: 14pt;
    padding: 10pt;
    background: #f9f9f9;
    border-left: 3pt solid #ddd;
    font-size: 9pt;
    color: #555;
  }

  /* ── Print ── */
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>

<!-- ── Print button (hidden when printing) ── -->
<div class="no-print" style="background:#111;color:#fff;padding:10px 16px;display:flex;gap:12px;align-items:center;position:sticky;top:0;z-index:100">
  <span style="font-weight:600;font-size:13px">Quote Preview</span>
  <button onclick="window.print()" style="background:#e8ff47;color:#111;border:none;padding:6px 16px;font-weight:700;font-size:12px;border-radius:3px;cursor:pointer;letter-spacing:.04em">⬇ Download PDF</button>
  <button onclick="window.close()" style="background:transparent;color:#aaa;border:1px solid #444;padding:6px 12px;font-size:12px;border-radius:3px;cursor:pointer">Close</button>
</div>

<div style="max-width:740pt;margin:0 auto;padding:20pt 0">

<!-- ── Header ── -->
<div class="header">
  <div>
    ${logoHtml}
  </div>
  <div class="doc-type">
    <h1>Quotation</h1>
    <div class="event-name">${esc(q.eventName || q.quoteId)}</div>
    <div class="doc-date">${fmtDate(q.createdAt || new Date())}</div>
  </div>
</div>

<!-- ── Meta grid ── -->
<div class="meta-grid">
  <div class="meta-block">
    <div class="client-name">${esc(q.clientName || '—')}</div>
    ${q.company ? `<div class="client-detail">${esc(q.company)}</div>` : ''}
    ${q.email   ? `<div class="client-detail">${esc(q.email)}</div>`   : ''}
    ${q.phone   ? `<div class="client-detail">${esc(q.phone)}</div>`   : ''}
  </div>

  <div class="meta-block">
    ${q.validUntil ? `<div class="meta-row"><span class="meta-label">Valid Until</span><span class="meta-value">${fmtDate(q.validUntil)}</span></div>` : ''}
    ${rentalRange  ? `<div class="meta-row"><span class="meta-label">Rental</span><span class="meta-value">${rentalRange}</span></div>` : ''}
    ${q.venue      ? `<div class="meta-row"><span class="meta-label">Venue</span><span class="meta-value">${esc(q.venue)}</span></div>` : ''}
    ${q.deliveryAddress ? `<div class="meta-row"><span class="meta-label">Delivery</span><span class="meta-value">${esc(q.deliveryAddress)}</span></div>` : ''}
    ${q.customerReference ? `<div class="meta-row"><span class="meta-label">Reference</span><span class="meta-value">${esc(q.customerReference)}</span></div>` : ''}
    <div class="meta-row"><span class="meta-label">Company</span><span class="meta-value">${esc(COMPANY.name)}</span></div>
    <div class="meta-row"><span class="meta-label"></span><span class="meta-value" style="color:#555">${esc(COMPANY.phone)}</span></div>
    <div class="meta-row"><span class="meta-label"></span><span class="meta-value" style="color:#555">${esc(COMPANY.email)}</span></div>
    ${q.totalWeightKg > 0 ? `<div class="meta-row"><span class="meta-label">Weight</span><span class="meta-value">${(+q.totalWeightKg).toFixed(2)} kgs</span></div>` : ''}
    ${q.replacementValue > 0 ? `<div class="meta-row"><span class="meta-label">Replacement Charge</span><span class="meta-value">${fmtCurDec(q.replacementValue)}</span></div>` : ''}
  </div>
</div>

<!-- ── Items ── -->
<div class="items-section">
  <div class="event-title">${esc(q.eventName || 'Quote')}</div>

  <table>
    <thead>
      <tr>
        <th style="width:28pt"></th>
        <th>Item</th>
        <th class="right" style="width:40pt">Type</th>
        <th class="right" style="width:30pt">Qty</th>
        <th class="right" style="width:52pt">Price</th>
        <th class="right" style="width:30pt">Discount</th>
        <th class="right" style="width:58pt">Charge Total</th>
      </tr>
    </thead>
    <tbody>
      ${buildItemRows(grouped)}
    </tbody>
  </table>
</div>

<!-- ── Totals ── -->
<table class="totals-table">
  <tr>
    <td class="total-label">Subtotal</td>
    <td class="total-value">${fmtCurDec(q.subtotal)}</td>
  </tr>
  <tr>
    <td class="total-label">Tax Total</td>
    <td class="total-value">${fmtCurDec(q.vat)}</td>
  </tr>
  <tr class="grand-total">
    <td class="total-label">Grand Total</td>
    <td class="total-value">${fmtCurDec(q.total)}</td>
  </tr>
</table>

<!-- ── Notes ── -->
${q.notes ? `<div class="notes-block">${esc(q.notes)}</div>` : ''}

<!-- ── Signature block ── -->
<div class="signature-block">
  <div class="sig-terms">${TERMS}</div>
  <div class="sig-line">
    <div>
      <div class="sig-field"></div>
      <div class="sig-field-label">Signed</div>
    </div>
    <div>
      <div class="sig-field"></div>
      <div class="sig-field-label">Printed</div>
    </div>
    <div>
      <div class="sig-field"></div>
      <div class="sig-field-label">Date</div>
    </div>
  </div>
</div>

<!-- ── Page footer ── -->
<div class="page-footer">
  <span>${esc(COMPANY.address)}</span>
  <span>Page 1 of 1</span>
</div>

</div><!-- /max-width -->
</body>
</html>`;
}

// ── Group items by category ───────────────────────────────────────────────────
function groupByCategory(items) {
  const groups = {};
  items.forEach(item => {
    const cat = item.category || (item.lineType === 'Service' ? 'Services' : 'General');
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(item);
  });
  return groups;
}

function buildItemRows(grouped) {
  let html = '';
  Object.entries(grouped).forEach(([category, items]) => {
    html += `<tr class="category-row"><td colspan="7">${esc(category)}</td></tr>`;
    items.forEach(item => {
      const qty     = +(item.quantity || item.qtyRequired || 0);
      const price   = +(item.unitPrice || 0);
      const disc    = +(item.discountPct || 0);
      const total   = +(item.lineTotal || (qty * price * (1 - disc / 100)));
      const lt      = item.lineType || 'Rental';
      const typeCls = lt === 'Service' ? 'type-service' : lt === 'Bundle' ? 'type-bundle' : 'type-rental';

      const imgHtml = item.imageUrl
        ? `<img src="${esc(item.imageUrl)}" alt="" onerror="this.style.display='none'">`
        : '';

      html += `<tr>
        <td class="item-img">${imgHtml}</td>
        <td class="item-name">${esc(item.name || '—')}${item.description ? `<div style="font-size:8.5pt;color:#888;margin-top:1pt">${esc(item.description)}</div>` : ''}</td>
        <td class="right"><span class="type-pill ${typeCls}">${esc(lt)}</span></td>
        <td class="right">${qty}</td>
        <td class="right">${fmtCurDec(price)}</td>
        <td class="right">${disc > 0 ? disc + '%' : '0%'}</td>
        <td class="right">${fmtCurDec(total)}</td>
      </tr>`;
    });
  });
  return html;
}