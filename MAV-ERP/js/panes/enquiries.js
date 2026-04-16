/**
 * MAV HIRE ERP — js/panes/enquiries.js  v1.0
 * Inbound enquiry / lead management.
 * Pipeline view, triage, status updates, convert → Client/Quote.
 * Bridges the Shopify Gmail importer via syncEnquiriesFromShopifySheet.
 */
import { rpc, rpcWithFallback }   from '../api/gas.js';
import { STATE } from '../utils/state.js';
import { showLoading, hideLoading, toast, emptyState } from '../utils/dom.js';
import { esc, fmtDate, statusBadge, exportCsv } from '../utils/format.js';
import { openModal, closeModal } from '../components/modal.js';

// Status pipeline order
const PIPELINE = ['New','Contacted','Qualified','Quoted','Won','Lost','Spam'];

const STATUS_COLOR = {
  New:       'var(--accent)',
  Contacted: 'var(--info)',
  Qualified: 'var(--ok)',
  Quoted:    'var(--warn)',
  Won:       'var(--ok)',
  Lost:      'var(--danger)',
  Spam:      'var(--text3)',
};

const PRIORITY_COLOR = {
  High:   'var(--danger)',
  Medium: 'var(--warn)',
  Low:    'var(--text3)',
};

let _enquiries = [];
let _view = 'pipeline'; // 'pipeline' | 'list'

// ── Load ──────────────────────────────────────────────────────────────────────
export async function loadEnquiries() {
  showLoading('Loading enquiries…');
  try {
    const [enquiries, summary] = await Promise.all([
      rpcWithFallback('getEnquiries', {}),
      rpcWithFallback('getEnquirySummary').catch(() => null),
    ]);
    _enquiries = enquiries;
    STATE.enquiries = enquiries;
    renderSummaryKPIs(summary);
    renderEnquiries(_enquiries);
    const el = document.getElementById('enq-subtitle');
    if (el && summary) {
      el.textContent = `${summary.total} total · ${summary.newCount} new · ${summary.followUpDue} follow-up due`;
    }
  } catch(e) { toast('Enquiries failed: ' + e.message, 'err'); }
  finally { hideLoading(); }
}

function renderSummaryKPIs(s) {
  const el = document.getElementById('enq-kpis');
  if (!el || !s) return;
  el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:16px">
    ${[
      ['New',          s.newCount,      'var(--accent)'],
      ['Contacted',    s.contacted,     'var(--info)'],
      ['Qualified',    s.qualified,     'var(--ok)'],
      ['Quoted',       s.quoted,        'var(--warn)'],
      ['Won',          s.won,           'var(--ok)'],
      ['Follow-up Due',s.followUpDue,   s.followUpDue>0?'var(--danger)':'var(--ok)'],
    ].map(([l,v,c]) => `<div style="background:var(--surface2);border-radius:8px;padding:10px;text-align:center;cursor:pointer"
      onclick="window.__filterEnquiryStatus('${l}')">
      <div style="font-size:9px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;margin-bottom:3px">${l}</div>
      <div style="font-size:22px;font-weight:700;color:${c};font-family:var(--mono)">${v}</div>
    </div>`).join('')}
  </div>`;
}

// ── Render ────────────────────────────────────────────────────────────────────
export function filterEnquiries() {
  const q    = (document.getElementById('enq-search')?.value || '').toLowerCase();
  const stat = document.getElementById('enq-status-filter')?.value || '';
  const src  = document.getElementById('enq-source-filter')?.value || '';

  const filtered = _enquiries.filter(e => {
    const hay = [e.enquiryId, e.name, e.email, e.phone, e.company,
                 e.eventType, e.venuePostcode, e.enquiryDetails].join(' ').toLowerCase();
    return (!q    || hay.includes(q))
        && (!stat || e.status === stat)
        && (!src  || e.source === src);
  });
  renderEnquiries(filtered);
}

export function filterEnquiryStatus(status) {
  const el = document.getElementById('enq-status-filter');
  if (el) { el.value = status; filterEnquiries(); }
}

function renderEnquiries(list) {
  if (_view === 'pipeline') renderPipeline(list);
  else renderList(list);
}

// ── Pipeline (Kanban) view ────────────────────────────────────────────────────
function renderPipeline(list) {
  const el = document.getElementById('enq-pipeline');
  if (!el) return;

  const stages = PIPELINE.filter(s => !['Spam'].includes(s));
  const byStatus = {};
  stages.forEach(s => { byStatus[s] = []; });
  list.forEach(e => {
    if (byStatus[e.status]) byStatus[e.status].push(e);
    else if (e.status === 'Spam') {} // hidden from pipeline
    else byStatus['New'].push(e);
  });

  el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(${stages.length},minmax(200px,1fr));gap:10px;overflow-x:auto;padding-bottom:8px">
    ${stages.map(status => {
      const cards = byStatus[status] || [];
      const col = STATUS_COLOR[status] || 'var(--text3)';
      return `<div style="min-width:200px">
        <div style="display:flex;justify-content:space-between;align-items:center;
          padding:6px 10px;background:${col}22;border-radius:var(--r) var(--r) 0 0;
          border-bottom:2px solid ${col};margin-bottom:6px">
          <span style="font-weight:700;font-size:12px;color:${col}">${status}</span>
          <span style="font-family:var(--mono);font-size:11px;color:var(--text3)">${cards.length}</span>
        </div>
        ${cards.length ? cards.map(e => enquiryCard(e)).join('') : `
          <div style="padding:16px;text-align:center;font-size:11px;color:var(--text3)">—</div>`}
      </div>`;
    }).join('')}
  </div>`;
}

function enquiryCard(e) {
  const priorityC = PRIORITY_COLOR[e.priority] || 'var(--text3)';
  const daysAgo = e.receivedDate
    ? Math.floor((Date.now() - new Date(e.receivedDate)) / 86400000)
    : null;
  const hasFollowUp = e.followUpDate && new Date(e.followUpDate) <= new Date();

  // Extract distance from notes if enrichment ran
  const distMatch = e.notes?.match(/\[Distance\] ([\d.]+) miles/);
  const distMiles = distMatch ? distMatch[1] : null;

  return `<div onclick="window.__openEnquiryDetail('${esc(e.enquiryId)}')"
    style="background:var(--surface);border:1px solid var(--border);
    border-left:3px solid ${priorityC};border-radius:var(--r2);padding:10px;
    margin-bottom:6px;cursor:pointer;transition:all var(--trans)"
    onmouseover="this.style.background='var(--surface2)'"
    onmouseout="this.style.background='var(--surface)'">
    <div style="font-weight:600;font-size:12px;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
      ${esc(e.name || '—')}
    </div>
    ${e.company?`<div style="font-size:10px;color:var(--text3);margin-bottom:3px">${esc(e.company)}</div>`:''}
    ${e.eventType?`<div style="font-size:10px;color:var(--text2)">📅 ${esc(e.eventType)}${e.eventDate?' · '+esc(e.eventDate.substring(0,10)):''}</div>`:''}
    ${e.guests?`<div style="font-size:10px;color:var(--text3)">👥 ${esc(e.guests)} guests</div>`:''}
    ${e.venuePostcode?`<div style="font-size:10px;color:var(--text3)">📍 ${esc(e.venuePostcode)}${distMiles?` · <span style="color:var(--info)">${distMiles}mi</span>`:''}</div>`:''}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
      <span style="font-size:9px;color:var(--text3);font-family:var(--mono)">
        ${daysAgo !== null ? (daysAgo===0?'Today':daysAgo+'d ago') : ''}
      </span>
      <div style="display:flex;gap:4px;align-items:center">
        ${hasFollowUp?`<span style="font-size:9px;color:var(--danger)" title="Follow-up overdue">⚠</span>`:''}
        <span style="font-size:9px;padding:1px 5px;border-radius:10px;background:${priorityC}22;color:${priorityC}">${esc(e.priority||'')}</span>
        <span style="font-size:9px;font-family:var(--mono);color:var(--text3)">${esc(e.source||'')}</span>
      </div>
    </div>
  </div>`;
}

// ── List view ─────────────────────────────────────────────────────────────────
function renderList(list) {
  const el = document.getElementById('enq-pipeline');
  if (!el) return;
  if (!list.length) { el.innerHTML = emptyState('◎', 'No enquiries match filters'); return; }

  el.innerHTML = `<div class="tbl-wrap">
    <table>
      <thead><tr>
        <th>Date</th><th>Name</th><th>Email / Phone</th><th>Event</th>
        <th>Postcode</th><th>Source</th><th>Status</th><th>Priority</th><th></th>
      </tr></thead>
      <tbody>
        ${list.map(e => {
          const col = STATUS_COLOR[e.status] || 'var(--text3)';
          const pc  = PRIORITY_COLOR[e.priority] || 'var(--text3)';
          return `<tr style="cursor:pointer" onclick="window.__openEnquiryDetail('${esc(e.enquiryId)}')">
            <td style="font-size:11px;color:var(--text3);white-space:nowrap">${e.receivedDate?fmtDate(e.receivedDate.substring(0,10)):'—'}</td>
            <td>
              <div style="font-weight:600">${esc(e.name||'—')}</div>
              ${e.company?`<div style="font-size:10px;color:var(--text3)">${esc(e.company)}</div>`:''}
            </td>
            <td style="font-size:11px">
              ${e.email?`<div>${esc(e.email)}</div>`:''}
              ${e.phone?`<div style="color:var(--text3)">${esc(e.phone)}</div>`:''}
            </td>
            <td style="font-size:11px">
              ${e.eventType?`<div>${esc(e.eventType)}</div>`:''}
              ${e.eventDate?`<div style="color:var(--text3)">${esc(e.eventDate.substring(0,10))}</div>`:''}
            </td>
            <td class="td-id">${esc(e.venuePostcode||'—')}</td>
            <td><span style="font-size:10px;font-family:var(--mono)">${esc(e.source||'—')}</span></td>
            <td><span style="font-size:10px;padding:2px 8px;border-radius:20px;background:${col}22;color:${col}">${esc(e.status)}</span></td>
            <td><span style="font-size:10px;color:${pc}">${esc(e.priority||'—')}</span></td>
            <td>
              <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();window.__openEnquiryDetail('${esc(e.enquiryId)}')">View</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>`;
}

// ── Detail modal ──────────────────────────────────────────────────────────────
export async function openEnquiryDetail(enquiryId) {
  const e = _enquiries.find(x => x.enquiryId === enquiryId)
         || await rpc('getEnquiryById', enquiryId);
  if (!e) { toast('Enquiry not found', 'warn'); return; }

  const col      = STATUS_COLOR[e.status]   || 'var(--text3)';
  const priCol   = PRIORITY_COLOR[e.priority] || 'var(--text3)';
  const daysAgo  = e.receivedDate ? Math.floor((Date.now()-new Date(e.receivedDate))/86400000) : null;
  const isActive = !['Won','Lost','Spam'].includes(e.status);

  openModal('modal-enq-detail', `Enquiry — ${esc(e.name || e.enquiryId)}`, `
    <!-- Status + Priority badges -->
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:14px;flex-wrap:wrap">
      <span style="padding:3px 12px;border-radius:20px;background:${col}22;color:${col};font-size:12px;font-weight:600">${esc(e.status)}</span>
      <span style="padding:3px 12px;border-radius:20px;background:${priCol}22;color:${priCol};font-size:12px">${esc(e.priority)} Priority</span>
      <span style="font-size:11px;color:var(--text3);font-family:var(--mono)">${esc(e.source||'')}${daysAgo!==null?' · '+daysAgo+'d ago':''}</span>
      ${e.clientId?`<span style="font-size:11px;color:var(--ok)">✓ Client linked</span>`:''}
      ${e.quoteId?`<span style="font-size:11px;color:var(--info)">✓ Quote ${esc(e.quoteId)}</span>`:''}
    </div>

    <div class="two-col" style="gap:12px;margin-bottom:14px">
      <div>
        <div class="detail-row"><div class="detail-label">Name</div><div class="detail-value">${esc(e.name||'—')}</div></div>
        ${e.company?`<div class="detail-row"><div class="detail-label">Company</div><div class="detail-value">${esc(e.company)}</div></div>`:''}
        <div class="detail-row"><div class="detail-label">Email</div><div class="detail-value">${e.email?`<a href="mailto:${esc(e.email)}" style="color:var(--info)">${esc(e.email)}</a>`:'—'}</div></div>
        <div class="detail-row"><div class="detail-label">Phone</div><div class="detail-value">${e.phone?`<a href="tel:${esc(e.phone)}" style="color:var(--info)">${esc(e.phone)}</a>`:'—'}</div></div>
      </div>
      <div>
        <div class="detail-row"><div class="detail-label">Event Type</div><div class="detail-value">${esc(e.eventType||'—')}</div></div>
        <div class="detail-row"><div class="detail-label">Event Date</div><div class="detail-value">${esc(e.eventDate||'—')}</div></div>
        <div class="detail-row"><div class="detail-label">Guests</div><div class="detail-value">${esc(e.guests||'—')}</div></div>
        <div class="detail-row"><div class="detail-label">Venue Postcode</div><div class="detail-value td-id">${esc(e.venuePostcode||'—')}${(() => { const m=e.notes?.match(/\[Distance\] ([\d.]+) miles from home \(([^)]+)\)/); return m?` <span style="color:var(--info);font-size:11px">· ${m[1]}mi · ${m[2]}</span>`:''; })()}</div></div>
        ${e.countryCode?`<div class="detail-row"><div class="detail-label">Country</div><div class="detail-value">${esc(e.countryCode)}</div></div>`:''}
        <div class="detail-row"><div class="detail-label">Received</div><div class="detail-value">${e.receivedDate?fmtDate(e.receivedDate.substring(0,10)):'—'}</div></div>
        ${e.followUpDate?`<div class="detail-row"><div class="detail-label">Follow-up</div><div class="detail-value" style="color:${new Date(e.followUpDate)<=new Date()?'var(--danger)':'var(--ok)'}">${fmtDate(e.followUpDate.substring(0,10))}</div></div>`:''}
      </div>
    </div>

    ${e.enquiryDetails ? `
    <div class="section-title" style="margin-bottom:6px">Enquiry Details</div>
    <div style="background:var(--surface2);border-radius:var(--r);padding:12px;font-size:13px;
      line-height:1.7;color:var(--text2);white-space:pre-wrap;margin-bottom:14px">${esc(e.enquiryDetails)}</div>` : ''}

    ${e.notes ? `
    <div class="section-title" style="margin-bottom:6px">Notes</div>
    <div style="background:var(--surface2);border-radius:var(--r);padding:10px;font-size:12px;
      color:var(--text2);white-space:pre-wrap;margin-bottom:14px">${esc(e.notes)}</div>` : ''}

    <!-- Quick status change -->
    ${isActive ? `
    <div style="margin-bottom:10px">
      <div class="section-title" style="margin-bottom:6px">Update Status</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${['Contacted','Qualified','Quoted','Won','Lost','Spam']
          .filter(s => s !== e.status)
          .map(s => `<button class="btn btn-ghost btn-sm" style="font-size:11px;color:${STATUS_COLOR[s]||'var(--text2)'}"
            onclick="window.__setEnquiryStatus('${esc(e.enquiryId)}','${s}')">${s}</button>`).join('')}
      </div>
    </div>` : ''}
  `, `
    ${isActive ? `
    <button class="btn btn-ghost btn-sm" onclick="window.__openEnquiryEdit('${esc(e.enquiryId)}')">✏ Edit</button>
    ${e.venuePostcode ? `<button class="btn btn-ghost btn-sm" onclick="window.__enrichEnquiry('${esc(e.enquiryId)}')" title="Calculate distance + run triage rules">📍 Enrich</button>` : ''}
    ${!e.clientId ? `<button class="btn btn-ghost btn-sm" onclick="window.__enqConvertToClient('${esc(e.enquiryId)}')">👤 → Client</button>` : ''}
    ${!e.quoteId  ? `<button class="btn btn-primary btn-sm" onclick="window.__enqConvertToQuote('${esc(e.enquiryId)}')">📄 → Quote</button>` : `<button class="btn btn-ghost btn-sm" onclick="window.__switchPane('quotes');window.__openQuoteDetail('${esc(e.quoteId)}')">View Quote →</button>`}
    ` : ''}
    ${e.quoteId ? '' : `<button class="btn btn-danger btn-sm" onclick="window.__deleteEnquiry('${esc(e.enquiryId)}')">🗑 Delete</button>`}
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Close</button>
  `);
}

// ── Edit modal ────────────────────────────────────────────────────────────────
export async function openEnquiryEdit(enquiryId) {
  const e = _enquiries.find(x => x.enquiryId === enquiryId)
         || await rpc('getEnquiryById', enquiryId);
  if (!e) { toast('Not found', 'warn'); return; }

  openModal('modal-enq-edit', `Edit Enquiry — ${esc(e.name||e.enquiryId)}`, `
    <div class="form-grid">
      <div class="form-group span-2"><label>Name</label>
        <input type="text" id="ee-name" value="${esc(e.name||'')}"></div>
      <div class="form-group"><label>Email</label>
        <input type="email" id="ee-email" value="${esc(e.email||'')}"></div>
      <div class="form-group"><label>Phone</label>
        <input type="text" id="ee-phone" value="${esc(e.phone||'')}"></div>
      <div class="form-group"><label>Company</label>
        <input type="text" id="ee-company" value="${esc(e.company||'')}"></div>
      <div class="form-group"><label>Event Type</label>
        <input type="text" id="ee-eventtype" value="${esc(e.eventType||'')}"></div>
      <div class="form-group"><label>Event Date</label>
        <input type="date" id="ee-eventdate" value="${(e.eventDate||'').substring(0,10)}"></div>
      <div class="form-group"><label>Guests</label>
        <input type="text" id="ee-guests" value="${esc(e.guests||'')}"></div>
      <div class="form-group"><label>Venue Postcode</label>
        <input type="text" id="ee-postcode" value="${esc(e.venuePostcode||'')}"></div>
      <div class="form-group"><label>Status</label>
        <select id="ee-status">
          ${['New','Contacted','Qualified','Quoted','Won','Lost','Spam']
            .map(s=>`<option${e.status===s?' selected':''}>${s}</option>`).join('')}
        </select></div>
      <div class="form-group"><label>Priority</label>
        <select id="ee-priority">
          ${['High','Medium','Low'].map(p=>`<option${e.priority===p?' selected':''}>${p}</option>`).join('')}
        </select></div>
      <div class="form-group"><label>Assigned To</label>
        <input type="text" id="ee-assigned" value="${esc(e.assignedTo||'')}"></div>
      <div class="form-group"><label>Follow-up Date</label>
        <input type="date" id="ee-followup" value="${(e.followUpDate||'').substring(0,10)}"></div>
      <div class="form-group span-2"><label>Notes</label>
        <textarea id="ee-notes" rows="3">${esc(e.notes||'')}</textarea></div>
    </div>`, `
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="window.__submitEnquiryEdit('${esc(e.enquiryId)}')">Save Changes</button>`
  );

  window.__submitEnquiryEdit = async (id) => {
    showLoading('Saving…'); closeModal();
    try {
      await rpc('saveEnquiry', {
        enquiryId:   id,
        name:        document.getElementById('ee-name')?.value,
        email:       document.getElementById('ee-email')?.value,
        phone:       document.getElementById('ee-phone')?.value,
        company:     document.getElementById('ee-company')?.value,
        eventType:   document.getElementById('ee-eventtype')?.value,
        eventDate:   document.getElementById('ee-eventdate')?.value,
        guests:      document.getElementById('ee-guests')?.value,
        venuePostcode:document.getElementById('ee-postcode')?.value,
        status:      document.getElementById('ee-status')?.value,
        priority:    document.getElementById('ee-priority')?.value,
        assignedTo:  document.getElementById('ee-assigned')?.value,
        followUpDate:document.getElementById('ee-followup')?.value,
        notes:       document.getElementById('ee-notes')?.value,
      });
      toast('Enquiry updated', 'ok');
      await loadEnquiries();
    } catch(err) { toast(err.message, 'err'); }
    finally { hideLoading(); }
  };
}

// ── New enquiry modal ─────────────────────────────────────────────────────────
export function openNewEnquiryModal() {
  openModal('modal-enq-new', 'New Enquiry', `
    <div class="form-grid">
      <div class="form-group span-2"><label>Name *</label>
        <input type="text" id="en-name" autofocus></div>
      <div class="form-group"><label>Email</label>
        <input type="email" id="en-email"></div>
      <div class="form-group"><label>Phone</label>
        <input type="text" id="en-phone"></div>
      <div class="form-group"><label>Company</label>
        <input type="text" id="en-company"></div>
      <div class="form-group"><label>Event Type</label>
        <input type="text" id="en-eventtype" placeholder="Wedding, Corporate, Festival…"></div>
      <div class="form-group"><label>Event Date</label>
        <input type="date" id="en-eventdate"></div>
      <div class="form-group"><label>Guests</label>
        <input type="text" id="en-guests"></div>
      <div class="form-group"><label>Venue Postcode</label>
        <input type="text" id="en-postcode"></div>
      <div class="form-group"><label>Source</label>
        <select id="en-source">
          ${['Shopify','Email','Phone','Referral','Walk-in','Other']
            .map(s=>`<option>${s}</option>`).join('')}
        </select></div>
      <div class="form-group"><label>Priority</label>
        <select id="en-priority">
          <option>Medium</option><option>High</option><option>Low</option>
        </select></div>
      <div class="form-group span-2"><label>Enquiry Details</label>
        <textarea id="en-details" rows="4" placeholder="What did they ask for?"></textarea></div>
      <div class="form-group span-2"><label>Follow-up Date</label>
        <input type="date" id="en-followup"></div>
    </div>`, `
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="window.__submitNewEnquiry()">Create Enquiry</button>`
  );

  window.__submitNewEnquiry = async () => {
    const name = document.getElementById('en-name')?.value.trim();
    if (!name) { toast('Name is required', 'warn'); return; }
    showLoading('Saving…'); closeModal();
    try {
      await rpc('saveEnquiry', {
        name:          name,
        email:         document.getElementById('en-email')?.value,
        phone:         document.getElementById('en-phone')?.value,
        company:       document.getElementById('en-company')?.value,
        eventType:     document.getElementById('en-eventtype')?.value,
        eventDate:     document.getElementById('en-eventdate')?.value,
        guests:        document.getElementById('en-guests')?.value,
        venuePostcode: document.getElementById('en-postcode')?.value,
        source:        document.getElementById('en-source')?.value,
        priority:      document.getElementById('en-priority')?.value,
        enquiryDetails:document.getElementById('en-details')?.value,
        followUpDate:  document.getElementById('en-followup')?.value,
        status:        'New',
        receivedDate:  new Date().toISOString(),
      });
      toast('Enquiry created', 'ok');
      await loadEnquiries();
    } catch(err) { toast(err.message, 'err'); }
    finally { hideLoading(); }
  };
}

// ── Actions ───────────────────────────────────────────────────────────────────
export async function setEnquiryStatus(enquiryId, status) {
  showLoading('Updating…');
  try {
    await rpc('updateEnquiryStatus', enquiryId, status, null);
    toast(`Status → ${status}`, 'ok');
    closeModal();
    await loadEnquiries();
  } catch(e) { toast(e.message, 'err'); }
  finally { hideLoading(); }
}

export async function enqConvertToClient(enquiryId) {
  showLoading('Creating client…'); closeModal();
  try {
    const result = await rpc('convertEnquiryToClient', enquiryId);
    toast(result.existing ? 'Linked to existing client' : 'Client created', 'ok');
    STATE.loadedPanes.delete('clients');
    await loadEnquiries();
  } catch(e) { toast(e.message, 'err'); }
  finally { hideLoading(); }
}

export async function enqConvertToQuote(enquiryId) {
  showLoading('Creating quote…'); closeModal();
  try {
    const result = await rpc('convertEnquiryToQuote', enquiryId);
    toast('Quote ' + result.quoteId + ' created', 'ok');
    STATE.loadedPanes.delete('quotes');
    await loadEnquiries();
  } catch(e) { toast(e.message, 'err'); }
  finally { hideLoading(); }
}

export async function deleteEnquiryFn(enquiryId) {
  if (!confirm('Delete this enquiry? This cannot be undone.')) return;
  showLoading('Deleting…'); closeModal();
  try {
    await rpc('deleteEnquiry', enquiryId);
    toast('Enquiry deleted', 'ok');
    await loadEnquiries();
  } catch(e) { toast(e.message, 'err'); }
  finally { hideLoading(); }
}

export async function syncShopifyEnquiries() {
  showLoading('Syncing from Shopify sheet…');
  try {
    const result = await rpc('syncEnquiriesFromShopifySheet');
    toast(`Synced ${result.synced} new enquiries`, 'ok');
    if (result.synced > 0) await loadEnquiries();
  } catch(e) { toast(e.message, 'err'); }
  finally { hideLoading(); }
}

export function setEnquiryView(view) {
  _view = view;
  document.querySelectorAll('.enq-view-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.view === view));
  renderEnquiries(_enquiries);
}

export function exportEnquiriesCsv() {
  const rows = _enquiries.map(e => ({
    'Enquiry ID':      e.enquiryId,
    'Received':        e.receivedDate?.substring(0,10) || '',
    'Name':            e.name,
    'Email':           e.email,
    'Phone':           e.phone,
    'Company':         e.company,
    'Event Type':      e.eventType,
    'Event Date':      e.eventDate,
    'Guests':          e.guests,
    'Venue Postcode':  e.venuePostcode,
    'Source':          e.source,
    'Status':          e.status,
    'Priority':        e.priority,
    'Quote ID':        e.quoteId,
    'Client ID':       e.clientId,
  }));
  exportCsv(`MAV_Enquiries_${new Date().toISOString().substring(0,10)}.csv`, rows);
  toast(`Exported ${rows.length} enquiries`, 'ok');
}

// ── Triage all new enquiries ──────────────────────────────────────────────────
export async function triageAllEnquiries() {
  showLoading('Triaging enquiries (distance + rules)…');
  try {
    const result = await rpc('triageAllEnquiries');
    toast(`Triaged ${result.processed} enquiries`, 'ok');
    await loadEnquiries();
  } catch(e) { toast(e.message, 'err'); }
  finally { hideLoading(); }
}

// ── Distance lookup for a single enquiry ─────────────────────────────────────
export async function enrichEnquiry(enquiryId) {
  showLoading('Calculating distance…');
  try {
    const result = await rpc('enrichAndTriageEnquiry', enquiryId);
    const milesMatch = result.notes ? result.notes.match(/[\d.]+ miles/) : null;
    const milesStr   = milesMatch ? ' · ' + milesMatch[0] : '';
    toast('Enriched: ' + (result.priority || '') + milesStr, 'ok');
    await loadEnquiries();
  } catch(e) { toast(e.message, 'err'); }
  finally { hideLoading(); }
}