/**
 * MAV HIRE ERP — js/panes/quotes.js  v3.0
 * Full quote management: create, edit, status workflow, PDF, email.
 */
import { rpc }                from '../api/gas.js';
import { STATE }              from '../utils/state.js';
import { showLoading, hideLoading, toast, emptyState, setupClientAutocomplete } from '../utils/dom.js';
import { fmtCurDec, fmtDate, esc, statusBadge } from '../utils/format.js';
import { openModal, closeModal, confirmDialog } from '../components/modal.js';
import { initLineItems, getLines, addRentalLine, addServiceLine } from '../components/lineItems.js';
import { generateQuotePdf } from '../components/quotePdf.js';

// ── Load / filter ─────────────────────────────────────────────────────────────
export async function loadQuotes() {
  showLoading('Loading quotes…');
  try {
    STATE.quotes = await rpc('getQuotes', {});
    render(STATE.quotes);
    const el = document.getElementById('quotes-subtitle');
    if (el) el.textContent = STATE.quotes.length + ' quotes';
  } catch(e) { toast('Quotes failed: ' + e.message, 'err'); }
  finally { hideLoading(); }
}

export function filterQuotes() {
  const q = (document.getElementById('quotes-search')?.value || '').toLowerCase();
  const s = document.getElementById('quotes-status-filter')?.value || '';
  render(STATE.quotes.filter(x => {
    const hay = [x.quoteId, x.clientName, x.company, x.eventName, x.status].join(' ').toLowerCase();
    return (!q || hay.includes(q)) && (!s || x.status === s);
  }));
}

function render(quotes) {
  const el = document.getElementById('quotes-list');
  if (!el) return;
  if (!quotes.length) { el.innerHTML = emptyState('◎', 'No quotes found'); return; }

  // Pipeline summary bar
  const statuses = ['Draft','Sent','Accepted','Declined','Expired'];
  const statusColors = { Draft:'#5a5a70', Sent:'#4db8ff', Accepted:'#4dff91', Declined:'#ff4d4d', Expired:'#3a3a4a' };
  const byStatus = {};
  statuses.forEach(s => { byStatus[s] = quotes.filter(q=>q.status===s); });
  const totalVal = quotes.reduce((s,q)=>s+(+q.total||0),0);
  const pipelineVal = [...(byStatus.Draft||[]), ...(byStatus.Sent||[])].reduce((s,q)=>s+(+q.total||0),0);
  const wonVal = (byStatus.Accepted||[]).reduce((s,q)=>s+(+q.total||0),0);
  const winRate = quotes.filter(q=>['Accepted','Declined'].includes(q.status)).length > 0
    ? Math.round((byStatus.Accepted||[]).length / quotes.filter(q=>['Accepted','Declined'].includes(q.status)).length * 100)
    : 0;

  const pipeline = `
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:16px">
      ${statuses.map(s=>{
        const qs=byStatus[s]||[];
        const val=qs.reduce((sum,q)=>sum+(+q.total||0),0);
        return `<div style="background:var(--surface2);border-radius:8px;padding:10px;border-top:2px solid ${statusColors[s]}">
          <div style="font-family:var(--mono);font-size:10px;color:${statusColors[s]};text-transform:uppercase;letter-spacing:.06em">${s}</div>
          <div style="font-size:20px;font-weight:700;margin:4px 0">${qs.length}</div>
          <div style="font-family:var(--mono);font-size:11px;color:var(--text3)">${fmtCur(val)}</div>
        </div>`;
      }).join('')}
    </div>
    <div style="display:flex;gap:16px;padding:10px 14px;background:var(--surface2);border-radius:6px;margin-bottom:14px;font-size:12px;flex-wrap:wrap">
      <div><span style="color:var(--text3)">Pipeline: </span><span style="font-family:var(--mono);font-weight:600;color:var(--info)">${fmtCur(pipelineVal)}</span></div>
      <div><span style="color:var(--text3)">Won: </span><span style="font-family:var(--mono);font-weight:600;color:var(--ok)">${fmtCur(wonVal)}</span></div>
      <div><span style="color:var(--text3)">Win rate: </span><span style="font-family:var(--mono);font-weight:600;color:${winRate>60?'var(--ok)':winRate>40?'var(--warn)':'var(--danger)'}">${winRate}%</span></div>
      <div><span style="color:var(--text3)">Total: </span><span style="font-family:var(--mono);font-weight:600">${fmtCur(totalVal)}</span></div>
    </div>`;

  const rows = quotes.map(q => {
    const isActive = ['Draft','Sent'].includes(q.status);
    const statusColor = statusColors[q.status]||'#5a5a70';
    return `<div style="display:grid;grid-template-columns:1fr 1fr auto auto auto;gap:12px;align-items:center;
      padding:12px 14px;border-radius:8px;background:var(--surface2);margin-bottom:6px;
      border-left:3px solid ${statusColor};cursor:pointer;transition:background .15s"
      onclick="window.__openQuoteDetail('${esc(q.quoteId)}')"
      onmouseover="this.style.background='var(--surface3)'" onmouseout="this.style.background='var(--surface2)'">
      <div>
        <div style="font-weight:600;font-size:13px">${esc(q.eventName||q.quoteId)}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px">${esc(q.clientName)}${q.company?' · '+esc(q.company):''}</div>
        <div style="font-size:10px;color:var(--text3);font-family:var(--mono);margin-top:2px">${esc(q.quoteId)}</div>
      </div>
      <div>
        <div style="font-size:12px">${fmtDate(q.eventDate)}</div>
        ${q.venue?`<div style="font-size:11px;color:var(--text3);margin-top:2px">${esc(q.venue)}</div>`:''}
        ${q.validUntil?`<div style="font-size:10px;color:var(--text3)">Valid: ${fmtDate(q.validUntil)}</div>`:''}
      </div>
      <div style="text-align:right">
        ${statusBadge(q.status)}
        ${q.linkedJobId?`<div style="font-size:10px;color:var(--ok);margin-top:3px">→ ${esc(q.linkedJobId)}</div>`:''}
      </div>
      <div style="text-align:right">
        <div style="font-family:var(--mono);font-size:14px;font-weight:700">${fmtCurDec(q.total)}</div>
        ${q.replacementValue?`<div style="font-size:10px;color:var(--text3)">RV: ${fmtCurDec(q.replacementValue)}</div>`:''}
      </div>
      <div style="display:flex;gap:4px" onclick="event.stopPropagation()">
        <button class="btn btn-ghost btn-sm" onclick="window.__editQuote('${esc(q.quoteId)}')" title="Edit">✏</button>
        <button class="btn btn-ghost btn-sm" onclick="window.__downloadQuotePdf('${esc(q.quoteId)}')" title="PDF">⬇</button>
        ${isActive?`<button class="btn btn-ghost btn-sm" onclick="window.__emailQuote('${esc(q.quoteId)}')" title="Email">✉</button>`:''}
        ${isActive?`<button class="btn btn-ghost btn-sm" onclick="window.__generateApprovalLink('${esc(q.quoteId)}')" title="Approval link">🔗</button>`:''}
        ${q.status==='Accepted'&&!q.linkedJobId?`<button class="btn btn-primary btn-sm" onclick="window.__convertQuoteToJob('${esc(q.quoteId)}')">→ Job</button>`:''}
      </div>
    </div>`;
  }).join('');

  el.innerHTML = pipeline + rows;
}

// ── Quote detail modal ────────────────────────────────────────────────────────
export async function openQuoteDetail(quoteId) {
  showLoading('Loading quote…');
  try {
    const q = await rpc('getQuoteById', quoteId);
    hideLoading();
    showQuoteModal(q);
  } catch(e) { hideLoading(); toast(e.message, 'err'); }
}

function showQuoteModal(q) {
  const items    = q.items || [];
  const itemRows = items.map(i => `<tr>
    <td><span class="line-type-badge line-type-${(i.lineType||'rental').toLowerCase()}">${esc(i.lineType||'Rental')}</span></td>
    <td class="td-name">${esc(i.name)}<br><span class="td-id">${esc(i.sku||'')}</span></td>
    <td>${esc(i.category||'')}</td>
    <td class="td-num">${i.quantity}</td>
    <td class="td-num">${fmtCurDec(i.unitPrice)}${i.discountPct>0?` <span class="td-id">-${i.discountPct}%</span>`:''}</td>
    <td class="td-num">${fmtCurDec(i.lineTotal)}</td>
    <td class="td-num">${i.totalWeightKg?(+i.totalWeightKg).toFixed(1)+' kg':'—'}</td>
  </tr>`).join('');

  const statusFlow = { Draft:['Sent'], Sent:['Accepted','Declined'], Accepted:[], Declined:[], Expired:[] };
  const nextStatuses = statusFlow[q.status] || [];
  const statusBtns   = nextStatuses.map(s =>
    `<button class="btn btn-ghost btn-sm" onclick="window.__updateQuoteStatus('${esc(q.quoteId)}','${esc(s)}')">→ Mark ${esc(s)}</button>`
  ).join('');

  openModal('modal-quote', `Quote: ${esc(q.eventName||q.quoteId)}`, `
    <div class="two-col" style="gap:12px;margin-bottom:16px">
      <div>
        <div class="detail-row"><div class="detail-label">Quote ID</div><div class="detail-value td-id">${esc(q.quoteId)}</div></div>
        <div class="detail-row"><div class="detail-label">Status</div><div class="detail-value">${statusBadge(q.status)}</div></div>
        <div class="detail-row"><div class="detail-label">Client</div><div class="detail-value">${esc(q.clientName)} ${esc(q.company||'')}</div></div>
        <div class="detail-row"><div class="detail-label">Email</div><div class="detail-value">${esc(q.email||'—')}</div></div>
        <div class="detail-row"><div class="detail-label">Event</div><div class="detail-value">${esc(q.eventName||'—')}</div></div>
        <div class="detail-row"><div class="detail-label">Event Date</div><div class="detail-value">${fmtDate(q.eventDate)}</div></div>
        <div class="detail-row"><div class="detail-label">Venue</div><div class="detail-value">${esc(q.venue||'—')}</div></div>
        ${q.validUntil?`<div class="detail-row"><div class="detail-label">Valid Until</div><div class="detail-value">${fmtDate(q.validUntil)}</div></div>`:''}
        ${q.customerReference?`<div class="detail-row"><div class="detail-label">Ref</div><div class="detail-value td-id">${esc(q.customerReference)}</div></div>`:''}
      </div>
      <div>
        <div class="detail-row"><div class="detail-label">Subtotal</div><div class="detail-value">${fmtCurDec(q.subtotal)}</div></div>
        <div class="detail-row"><div class="detail-label">VAT</div><div class="detail-value">${fmtCurDec(q.vat)}</div></div>
        <div class="detail-row"><div class="detail-label">Total</div><div class="detail-value" style="color:var(--accent);font-size:16px">${fmtCurDec(q.total)}</div></div>
        <div class="detail-row"><div class="detail-label">Replacement Value</div><div class="detail-value">${fmtCurDec(q.replacementValue)}</div></div>
        <div class="detail-row"><div class="detail-label">Total Weight</div><div class="detail-value">${(+q.totalWeightKg||0).toFixed(1)} kg</div></div>
        ${q.linkedJobId?`<div class="detail-row"><div class="detail-label">Linked Job</div><div class="detail-value td-id">${esc(q.linkedJobId)}</div></div>`:''}
      </div>
    </div>
    <div class="section-title" style="margin-bottom:8px">Line Items</div>
    <div class="tbl-wrap">
      <table>
        <thead><tr><th>Type</th><th>Item</th><th>Category</th><th>Qty</th><th>Price</th><th>Total</th><th>Weight</th></tr></thead>
        <tbody>${itemRows}</tbody>
      </table>
    </div>
    ${q.notes?`<div style="margin-top:12px;font-size:12px;color:var(--text2);padding:10px;background:var(--surface2);border-radius:var(--r)">${esc(q.notes)}</div>`:''}
  `, `
    <button class="btn btn-ghost btn-sm" onclick="window.__downloadQuotePdf('${esc(q.quoteId)}')">⬇ PDF</button>
    ${['Draft','Sent'].includes(q.status)?`<button class="btn btn-ghost btn-sm" onclick="window.__emailQuote('${esc(q.quoteId)}')">✉ Email</button>`:''} ${['Draft','Sent','Accepted'].includes(q.status)?`<button class="btn btn-ghost btn-sm" onclick="window.__generateApprovalLink('${esc(q.quoteId)}')">🔗 Approval Link</button>`:''}
    <button class="btn btn-ghost btn-sm" onclick="window.__editQuote('${esc(q.quoteId)}')">✏ Edit</button>
    ${statusBtns}
    ${!q.linkedJobId?`<button class="btn btn-ghost btn-sm" onclick="window.__convertQuoteToJob('${esc(q.quoteId)}')">→ Convert to Job</button>`:''}
    <button class="btn btn-ghost btn-sm" onclick="window.__duplicateQuote('${esc(q.quoteId)}')">⎘ Duplicate</button>
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Close</button>
  `, 'modal-lg');
}

// ── Edit quote ────────────────────────────────────────────────────────────────
export async function editQuote(quoteId) {
  showLoading('Loading quote…'); closeModal();
  try {
    const q = await rpc('getQuoteById', quoteId);
    hideLoading();
    openQuoteForm(q);
  } catch(e) { hideLoading(); toast(e.message, 'err'); }
}

// ── New quote modal ───────────────────────────────────────────────────────────
export function openNewQuoteModal() {
  openQuoteForm(null);
}

function openQuoteForm(existingQuote) {
  const q      = existingQuote || {};
  const isEdit = !!q.quoteId;
  const title  = isEdit ? `Edit Quote: ${esc(q.eventName||q.quoteId)}` : 'New Quote';

  openModal('modal-quote-form', title, buildQuoteFormHtml(q), `
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="window.__submitQuoteForm()">
      ${isEdit ? 'Save Changes' : 'Save Quote'}
    </button>
  `, 'modal-xl');

  // Pre-populate line items for edit
  const initialLines = (q.items||[]).map(i => ({
    lineType:    i.lineType    || 'Rental',
    bundleId:    i.bundleId    || '',
    productId:   i.productId   || '',
    serviceId:   i.serviceId   || '',
    sku:         i.sku         || '',
    name:        i.name        || '',
    category:    i.category    || '',
    quantity:    i.quantity    || 0,
    unitPrice:   i.unitPrice   || 0,
    discountPct: i.discountPct || 0,
    replacementCost: i.replacementCost || 0,
    weightKg:    i.weightKg    || 0,
  }));

  setTimeout(() => {
    initLineItems('quote-lines', initialLines);
    if (!isEdit) addRentalLine();
    setupClientAutocomplete('fq-client-name','fq-company','fq-email','fq-phone');
  }, 50);

  window.__submitQuoteForm = async () => {
    const clientName = document.getElementById('fq-client-name')?.value.trim();
    if (!clientName) { toast('Client name required', 'warn'); return; }
    const lines = getLines().filter(l => l.name && (+l.quantity||0) > 0);
    if (!lines.length) { toast('Add at least one item', 'warn'); return; }

    showLoading(isEdit ? 'Saving…' : 'Creating quote…'); closeModal();
    try {
      const result = await rpc('saveQuoteDraft', {
        quoteId:   q.quoteId || null,
        status:    q.status  || 'Draft',
        linkedJobId: q.linkedJobId || '',
        client: {
          clientId:  q.clientId,
          clientName,
          company: document.getElementById('fq-company')?.value,
          email:   document.getElementById('fq-email')?.value,
          phone:   document.getElementById('fq-phone')?.value,
        },
        eventName:  document.getElementById('fq-event-name')?.value,
        eventDate:  document.getElementById('fq-event-date')?.value,
        venue:      document.getElementById('fq-venue')?.value,
        validUntil: document.getElementById('fq-valid-until')?.value,
        customerReference: document.getElementById('fq-ref')?.value,
        delivery:   {
          date:    document.getElementById('fq-delivery-date')?.value,
          address: document.getElementById('fq-delivery-addr')?.value,
        },
        collection: {
          date:    document.getElementById('fq-collection-date')?.value,
          address: document.getElementById('fq-collection-addr')?.value,
        },
        notes:         document.getElementById('fq-notes')?.value,
        internalNotes: document.getElementById('fq-internal')?.value,
        items: lines.map(l => ({
          lineType:    l.lineType || 'Rental',
          bundleId:    l.bundleId || '', productId: l.productId||'', serviceId: l.serviceId||'',
          name: l.name, sku: l.sku||'', category: l.category||'',
          quantity: +l.quantity||1, unitPrice: +l.unitPrice||0, discountPct: +l.discountPct||0,
          replacementCost: +l.replacementCost||0, weightKg: +l.weightKg||0,
        })),
      });
      toast(isEdit ? 'Quote saved' : 'Quote created: ' + result.quoteId, 'ok');
      STATE.loadedPanes.delete('quotes');
      await loadQuotes();
    } catch(e) { toast(e.message, 'err'); }
    finally { hideLoading(); }
  };
}

function buildQuoteFormHtml(q) {
  const v = (field, fallback='') => esc(q[field]||fallback);
  const d = (field) => (q[field]||'').substring(0,10);
  return `<div class="form-grid">
    <div class="form-group"><label>Client Name *</label>
      <input type="text" id="fq-client-name" value="${v('clientName')}" placeholder="Type to search…"></div>
    <div class="form-group"><label>Company</label>
      <input type="text" id="fq-company" value="${v('company')}"></div>
    <div class="form-group"><label>Email</label>
      <input type="email" id="fq-email" value="${v('email')}"></div>
    <div class="form-group"><label>Phone</label>
      <input type="text" id="fq-phone" value="${v('phone')}"></div>
    <div class="form-group"><label>Event Name</label>
      <input type="text" id="fq-event-name" value="${v('eventName')}" placeholder="e.g. Smith Wedding"></div>
    <div class="form-group"><label>Event Date</label>
      <input type="date" id="fq-event-date" value="${d('eventDate')}"></div>
    <div class="form-group span-2"><label>Venue</label>
      <input type="text" id="fq-venue" value="${v('venue')}"></div>
    <div class="form-group"><label>Delivery Date</label>
      <input type="date" id="fq-delivery-date" value="${d('deliveryDate')}"></div>
    <div class="form-group"><label>Delivery Address</label>
      <input type="text" id="fq-delivery-addr" value="${v('deliveryAddress')}"></div>
    <div class="form-group"><label>Collection Date</label>
      <input type="date" id="fq-collection-date" value="${d('collectionDate')}"></div>
    <div class="form-group"><label>Collection Address</label>
      <input type="text" id="fq-collection-addr" value="${v('collectionAddress')}"></div>
    <div class="form-group"><label>Valid Until</label>
      <input type="date" id="fq-valid-until" value="${d('validUntil')}"></div>
    <div class="form-group"><label>Customer Reference</label>
      <input type="text" id="fq-ref" value="${v('customerReference')}"></div>
    <div class="form-group span-2"><label>Notes (customer-facing)</label>
      <textarea id="fq-notes" rows="2">${v('notes')}</textarea></div>
    <div class="form-group span-2"><label>Internal Notes</label>
      <textarea id="fq-internal" rows="2">${v('internalNotes')}</textarea></div>
  </div>
  <div style="margin-top:16px">
    <div class="section-title" style="margin-bottom:8px">Line Items</div>
    <div id="quote-lines"></div>
  </div>`;
}

// ── Status update ─────────────────────────────────────────────────────────────
export async function updateQuoteStatus(quoteId, status) {
  showLoading('Updating status…'); closeModal();
  try {
    await rpc('updateQuoteStatus', quoteId, status);
    toast('Status → ' + status, 'ok');
    STATE.loadedPanes.delete('quotes');
    await loadQuotes();
  } catch(e) { toast(e.message, 'err'); }
  finally { hideLoading(); }
}

// ── PDF ───────────────────────────────────────────────────────────────────────
export async function downloadQuotePdf(quoteId) {
  showLoading('Building PDF…');
  try {
    const quote = await rpc('getQuoteById', quoteId);
    hideLoading();
    generateQuotePdf(quote);
  } catch(e) { hideLoading(); toast(e.message, 'err'); }
}

// ── Email quote ───────────────────────────────────────────────────────────────
export async function emailQuote(quoteId) {
  showLoading('Loading quote…');
  try {
    const q = await rpc('getQuoteById', quoteId);
    hideLoading();
    openEmailModal(q);
  } catch(e) { hideLoading(); toast(e.message, 'err'); }
}

function openEmailModal(q) {
  const defaultSubject = `Quotation: ${q.eventName || q.quoteId} — MAV Hire`;
  const defaultBody    = `Hi ${q.clientName || 'there'},\n\nPlease find attached your quotation for ${q.eventName || 'your event'}.\n\nQuote reference: ${q.quoteId}\nTotal: £${(+q.total||0).toFixed(2)}\n${q.validUntil ? 'Valid until: '+fmtDate(q.validUntil)+'\n' : ''}\nPlease don't hesitate to get in touch if you have any questions.\n\nKind regards,\nMAV Hire`;

  openModal('modal-email-quote', 'Email Quote', `
    <div class="form-grid cols-1">
      <div class="form-group"><label>To *</label>
        <input type="email" id="eq-to" value="${esc(q.email||'')}"></div>
      <div class="form-group"><label>Subject</label>
        <input type="text" id="eq-subject" value="${esc(defaultSubject)}"></div>
      <div class="form-group"><label>Message</label>
        <textarea id="eq-body" rows="8" style="font-family:var(--body)">${esc(defaultBody)}</textarea></div>
      <div style="font-size:11px;color:var(--text3);padding:8px 10px;background:var(--surface2);border-radius:var(--r)">
        📎 A PDF of the quote will be generated and attached via your Google Apps Script deployment.
      </div>
    </div>`, `
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-ghost btn-sm" onclick="window.__previewQuotePdf('${esc(q.quoteId)}')">Preview PDF</button>
    <button class="btn btn-primary btn-sm" onclick="window.__submitEmailQuote('${esc(q.quoteId)}')">Send Email</button>`
  );

  window.__previewQuotePdf = (qId) => downloadQuotePdf(qId);
  window.__submitEmailQuote = async (qId) => {
    const to      = document.getElementById('eq-to')?.value.trim();
    const subject = document.getElementById('eq-subject')?.value.trim();
    const body    = document.getElementById('eq-body')?.value.trim();
    if (!to) { toast('Recipient email required', 'warn'); return; }

    showLoading('Sending email…'); closeModal();
    try {
      await rpc('sendQuoteEmail', qId, { to, subject, body });
      toast('Email sent to ' + to, 'ok');
      // Mark as Sent if still Draft
      if (q.status === 'Draft') {
        await rpc('updateQuoteStatus', qId, 'Sent');
        STATE.loadedPanes.delete('quotes');
        await loadQuotes();
      }
    } catch(e) { toast('Email failed: ' + e.message, 'err'); }
    finally { hideLoading(); }
  };
}

// ── Convert to job ────────────────────────────────────────────────────────────
export async function convertQuoteToJob(quoteId) {
  showLoading('Converting…'); closeModal();
  try {
    const r = await rpc('createJobFromQuote', quoteId, {});
    toast('Job created: ' + r.jobId, 'ok');
    STATE.loadedPanes.delete('quotes');
    STATE.loadedPanes.delete('jobs');
    await loadQuotes();
  } catch(e) { toast(e.message, 'err'); }
  finally { hideLoading(); }
}

// ── Duplicate ─────────────────────────────────────────────────────────────────
export async function duplicateQuote(quoteId) {
  showLoading('Duplicating…'); closeModal();
  try {
    const r = await rpc('duplicateQuote', quoteId);
    toast('Duplicate created: ' + r.quoteId, 'ok');
    STATE.loadedPanes.delete('quotes');
    await loadQuotes();
  } catch(e) { toast(e.message, 'err'); }
  finally { hideLoading(); }
}