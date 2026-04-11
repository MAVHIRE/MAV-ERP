/**
 * MAV HIRE ERP — js/panes/clients.js  v2.0
 * Client list + full history modal (quotes, jobs, total spend).
 */
import { rpc }       from '../api/gas.js';
import { STATE }     from '../utils/state.js';
import { showLoading, hideLoading, toast, emptyState } from '../utils/dom.js';
import { fmtCurDec, fmtDate, esc, statusBadge } from '../utils/format.js';
import { openModal, closeModal } from '../components/modal.js';

export async function loadClients() {
  if (STATE.clients.length) { render(STATE.clients); const el = document.getElementById('clients-subtitle'); if (el) el.textContent = STATE.clients.length + ' clients'; return; }
  showLoading('Loading clients…');
  try {
    STATE.clients = await rpc('getClients', {});
    render(STATE.clients);
    const el = document.getElementById('clients-subtitle');
    if (el) el.textContent = STATE.clients.length + ' clients';
  } catch(e) { toast('Clients failed: ' + e.message, 'err'); }
  finally { hideLoading(); }
}

export function filterClients() {
  const q = (document.getElementById('clients-search')?.value || '').toLowerCase();
  render(STATE.clients.filter(c =>
    [c.clientId, c.clientName, c.company, c.email, c.phone].join(' ').toLowerCase().includes(q)
  ));
}

function render(clients) {
  const el = document.getElementById('clients-list');
  if (!el) return;
  if (!clients.length) { el.innerHTML = emptyState('◑', 'No clients found'); return; }
  el.innerHTML = `<div class="tbl-wrap"><table>
    <thead><tr><th>Name</th><th>Company</th><th>Email</th><th>Phone</th><th>Type</th><th>Source</th><th></th></tr></thead>
    <tbody>${clients.map(c => `<tr style="cursor:pointer" onclick="window.__openClientHistory('${esc(c.clientId)}')">
      <td class="td-name">${esc(c.clientName)}</td>
      <td>${esc(c.company||'—')}</td>
      <td>${esc(c.email||'—')}</td>
      <td>${esc(c.phone||'—')}</td>
      <td>${c.clientType ? statusBadge(c.clientType) : '—'}</td>
      <td class="td-id">${esc(c.source||'')}</td>
      <td><button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();window.__openClientHistory('${esc(c.clientId)}')">History</button></td>
    </tr>`).join('')}
    </tbody></table></div>`;
}

// ── Client history modal ──────────────────────────────────────────────────────
export async function openClientHistory(clientId) {
  showLoading('Loading client history…');
  try {
    const [client, allJobs, allQuotes] = await Promise.all([
      rpc('getClientById', clientId),
      rpc('getJobs',   { clientId }),
      rpc('getQuotes', { clientId }),
    ]);
    hideLoading();
    showClientHistoryModal(client, allJobs, allQuotes);
  } catch(e) { hideLoading(); toast(e.message, 'err'); }
}

function showClientHistoryModal(client, jobs, quotes) {
  // Calculate lifetime value
  const completedJobs  = jobs.filter(j => ['Complete','Returned'].includes(j.status));
  const lifetimeRevenue= completedJobs.reduce((s, j) => s + (+j.total||0), 0);
  const outstandingBal = jobs.reduce((s, j) => s + (+j.balanceDue||0), 0);
  const activeJobs     = jobs.filter(j => !['Complete','Cancelled','Returned'].includes(j.status));

  const jobRows = jobs.slice(0, 20).map(j => `<tr onclick="window.__openJobDetail('${esc(j.jobId)}')" style="cursor:pointer">
    <td class="td-id">${esc(j.jobId)}</td>
    <td class="td-name">${esc(j.jobName||'—')}</td>
    <td>${fmtDate(j.eventDate||j.startDate)}</td>
    <td>${statusBadge(j.status)}</td>
    <td class="td-num">${fmtCurDec(j.total)}</td>
    <td class="td-num" style="${j.balanceDue>0?'color:var(--warn)':''}">${j.balanceDue>0?fmtCurDec(j.balanceDue):'—'}</td>
  </tr>`).join('');

  const quoteRows = quotes.slice(0, 10).map(q => `<tr onclick="window.__openQuoteDetail('${esc(q.quoteId)}')" style="cursor:pointer">
    <td class="td-id">${esc(q.quoteId)}</td>
    <td class="td-name">${esc(q.eventName||'—')}</td>
    <td>${fmtDate(q.eventDate)}</td>
    <td>${statusBadge(q.status)}</td>
    <td class="td-num">${fmtCurDec(q.total)}</td>
  </tr>`).join('');

  openModal('modal-client-history', `${esc(client.clientName)} ${client.company ? '· '+esc(client.company) : ''}`, `
    <!-- KPIs -->
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:20px">
      <div class="kpi"><div class="kpi-label">Lifetime Revenue</div>
        <div class="kpi-value accent">${fmtCurDec(lifetimeRevenue)}</div></div>
      <div class="kpi"><div class="kpi-label">Total Jobs</div>
        <div class="kpi-value">${jobs.length}</div></div>
      <div class="kpi"><div class="kpi-label">Active Jobs</div>
        <div class="kpi-value ok">${activeJobs.length}</div></div>
      <div class="kpi"><div class="kpi-label">Outstanding Balance</div>
        <div class="kpi-value ${outstandingBal>0?'warn':''}">${fmtCurDec(outstandingBal)}</div></div>
    </div>

    <!-- Contact info -->
    <div class="two-col" style="gap:12px;margin-bottom:20px">
      <div>
        <div class="detail-row"><div class="detail-label">Email</div>
          <div class="detail-value">${esc(client.email||'—')}</div></div>
        <div class="detail-row"><div class="detail-label">Phone</div>
          <div class="detail-value">${esc(client.phone||'—')}</div></div>
        <div class="detail-row"><div class="detail-label">Type</div>
          <div class="detail-value">${client.clientType ? statusBadge(client.clientType) : '—'}</div></div>
        <div class="detail-row"><div class="detail-label">Source</div>
          <div class="detail-value td-id">${esc(client.source||'—')}</div></div>
      </div>
      <div>
        <div class="detail-row"><div class="detail-label">Address</div>
          <div class="detail-value">${esc(client.address||'—')}</div></div>
        <div class="detail-row"><div class="detail-label">Total Quotes</div>
          <div class="detail-value">${quotes.length}</div></div>
        <div class="detail-row"><div class="detail-label">Conversion Rate</div>
          <div class="detail-value">${quotes.length > 0
            ? Math.round((quotes.filter(q=>q.status==='Accepted').length/quotes.length)*100)+'%'
            : '—'}</div></div>
        ${client.notes ? `<div class="detail-row"><div class="detail-label">Notes</div>
          <div class="detail-value" style="font-size:12px">${esc(client.notes)}</div></div>` : ''}
      </div>
    </div>

    <!-- Jobs -->
    ${jobs.length ? `
    <div class="section-title" style="margin-bottom:8px">Jobs (${jobs.length})</div>
    <div class="tbl-wrap" style="margin-bottom:16px">
      <table>
        <thead><tr><th>Job ID</th><th>Name</th><th>Date</th><th>Status</th><th>Total</th><th>Balance</th></tr></thead>
        <tbody>${jobRows}</tbody>
      </table>
    </div>` : ''}

    <!-- Quotes -->
    ${quotes.length ? `
    <div class="section-title" style="margin-bottom:8px">Quotes (${quotes.length})</div>
    <div class="tbl-wrap">
      <table>
        <thead><tr><th>Quote ID</th><th>Event</th><th>Date</th><th>Status</th><th>Total</th></tr></thead>
        <tbody>${quoteRows}</tbody>
      </table>
    </div>` : ''}
  `, `
    <button class="btn btn-ghost btn-sm" onclick="window.__openNewJobModal()">+ New Job</button>
    <button class="btn btn-ghost btn-sm" onclick="window.__openNewQuoteModal()">+ New Quote</button>
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Close</button>
  `, 'modal-lg');
}

// ── New client modal ──────────────────────────────────────────────────────────
export function openNewClientModal() {
  openModal('modal-new-client', 'New Client', `
    <div class="form-grid">
      <div class="form-group"><label>Name *</label><input type="text" id="fc-name"></div>
      <div class="form-group"><label>Company</label><input type="text" id="fc-company"></div>
      <div class="form-group"><label>Email</label><input type="email" id="fc-email"></div>
      <div class="form-group"><label>Phone</label><input type="text" id="fc-phone"></div>
      <div class="form-group span-2"><label>Address</label><input type="text" id="fc-address"></div>
      <div class="form-group"><label>Type</label>
        <select id="fc-type">
          <option>Individual</option><option>Corporate</option>
          <option>Venue</option><option>Agency</option><option>Other</option>
        </select></div>
      <div class="form-group"><label>Source</label>
        <input type="text" id="fc-source" placeholder="e.g. Referral, Instagram"></div>
      <div class="form-group span-2"><label>Notes</label>
        <textarea id="fc-notes" rows="2"></textarea></div>
    </div>`, `
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="window.__submitNewClient()">Save Client</button>`
  );
  window.__submitNewClient = submitNewClient;
  setTimeout(() => document.getElementById('fc-name')?.focus(), 50);
}

async function submitNewClient() {
  const clientName = document.getElementById('fc-name')?.value.trim();
  if (!clientName) { toast('Name required', 'warn'); return; }
  showLoading('Saving…'); closeModal();
  try {
    const r = await rpc('saveClient', {
      clientName,
      company:    document.getElementById('fc-company')?.value,
      email:      document.getElementById('fc-email')?.value,
      phone:      document.getElementById('fc-phone')?.value,
      address:    document.getElementById('fc-address')?.value,
      clientType: document.getElementById('fc-type')?.value,
      source:     document.getElementById('fc-source')?.value,
      notes:      document.getElementById('fc-notes')?.value,
    });
    toast('Client saved: ' + r.clientId, 'ok');
    STATE.loadedPanes.delete('clients');
    await loadClients();
  } catch(e) { toast(e.message, 'err'); }
  finally { hideLoading(); }
}