/**
 * MAV HIRE ERP — js/panes/clients.js  v2.0
 * Client list + full history modal (quotes, jobs, total spend).
 */
import { rpc }       from '../api/gas.js';
import { STATE }     from '../utils/state.js';
import { showLoading, hideLoading, toast, emptyState } from '../utils/dom.js';
import { fmtCurDec, fmtDate, esc, statusBadge, exportCsv, escAttr} from '../utils/format.js';
import { openModal, closeModal } from '../components/modal.js';

export async function loadClients() {
  showLoading('Loading clients…');
  try {
    STATE.clients = await rpc('getClients', {});
    render(STATE.clients);
    // Load revenue report in background
    rpc('getClientRevenueReport').then(report => renderClientRevenue(report)).catch(()=>{});
    const el = document.getElementById('clients-subtitle');
    if (el) el.textContent = STATE.clients.length + ' clients';
  } catch(e) { toast('Clients failed: ' + e.message, 'err'); }
  finally { hideLoading(); }
}

function renderClientRevenue(report) {
  const el = document.getElementById('clients-revenue');
  if (!el || !report?.length) return;
  const top5 = report.slice(0, 5);
  const max = top5[0]?.totalRevenue || 1;
  el.innerHTML = `
    <div style="display:flex;gap:8px;align-items:flex-end;height:80px;margin-bottom:4px">
      ${top5.map(c => {
        const pct = Math.round((c.totalRevenue||0)/max*100);
        return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer"
          onclick="window.__openClientHistory('${escAttr(c.clientId)}')">
          <div style="font-family:var(--mono);font-size:9px;color:var(--text3)">${fmtCurDec(c.totalRevenue||0)}</div>
          <div style="width:100%;background:var(--accent);border-radius:3px 3px 0 0;opacity:.8"
            style="height:${pct}%">&nbsp;</div>
        </div>`;
      }).join('')}
    </div>
    <div style="display:flex;gap:8px">
      ${top5.map(c => `<div style="flex:1;font-size:9px;color:var(--text3);text-align:center;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer"
        onclick="window.__openClientHistory('${escAttr(c.clientId)}')"
        title="${esc(c.clientName)}">${esc(c.clientName.split(' ')[0])}</div>`).join('')}
    </div>`;
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

  const typeColors = { Agency:'#4db8ff', Corporate:'#9b8aff', Individual:'#4dff91' };

  el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px">
    ${clients.map(c => {
      const initials = c.clientName.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
      const typeColor = typeColors[c.clientType]||'#5a5a70';
      return `<div onclick="window.__openClientHistory('${escAttr(c.clientId)}')"
        style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r2);
        padding:14px;cursor:pointer;transition:all var(--trans)"
        onmouseover="this.style.borderColor='var(--border2)';this.style.background='var(--surface2)'"
        onmouseout="this.style.borderColor='var(--border)';this.style.background='var(--surface)'">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <div style="width:38px;height:38px;border-radius:50%;background:${typeColor}22;
            border:1px solid ${typeColor}44;display:flex;align-items:center;justify-content:center;
            font-family:var(--mono);font-size:13px;font-weight:700;color:${typeColor};flex-shrink:0">
            ${initials}</div>
          <div style="min-width:0">
            <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.clientName)}</div>
            ${c.company?`<div style="font-size:11px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.company)}</div>`:''}
          </div>
          ${c.clientType?`<span style="margin-left:auto;font-size:10px;padding:2px 7px;border-radius:20px;
            background:${typeColor}22;color:${typeColor};font-family:var(--mono);white-space:nowrap;flex-shrink:0">${esc(c.clientType)}</span>`:''}
        </div>
        <div style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--text3)">
          ${c.email?`<div style="display:flex;gap:6px"><span>✉</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.email)}</span></div>`:''}
          ${c.phone?`<div style="display:flex;gap:6px"><span>☎</span><span>${esc(c.phone)}</span></div>`:''}
          ${c.source?`<div style="display:flex;gap:6px"><span>→</span><span>${esc(c.source)}</span></div>`:''}
        </div>
      </div>`;
    }).join('')}
  </div>`;
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

  const jobRows = jobs.slice(0, 20).map(j => `<tr onclick="window.__openJobDetail('${escAttr(j.jobId)}')" style="cursor:pointer">
    <td class="td-id">${esc(j.jobId)}</td>
    <td class="td-name">${esc(j.jobName||'—')}</td>
    <td>${fmtDate(j.eventDate||j.startDate)}</td>
    <td>${statusBadge(j.status)}</td>
    <td class="td-num">${fmtCurDec(j.total)}</td>
    <td class="td-num" style="${j.balanceDue>0?'color:var(--warn)':''}">${j.balanceDue>0?fmtCurDec(j.balanceDue):'—'}</td>
  </tr>`).join('');

  const quoteRows = quotes.slice(0, 10).map(q => `<tr onclick="window.__openQuoteDetail('${escAttr(q.quoteId)}')" style="cursor:pointer">
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
    <button class="btn btn-ghost btn-sm" onclick="window.__openClientPortal('${escAttr(clientId)}')">◎ Portal Link</button>
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


export function exportClientsCsv() {
  const rows = (STATE.clients || []).map(c => ({
    'Client ID':  c.clientId,
    'Name':       c.clientName,
    'Company':    c.company || '',
    'Email':      c.email || '',
    'Phone':      c.phone || '',
    'Type':       c.clientType || '',
    'Source':     c.source || '',
  }));
  exportCsv(`MAV_Clients_${new Date().toISOString().substring(0,10)}.csv`, rows);
}

// ── Client portal link generator ──────────────────────────────────────────────
export async function openClientPortal(clientId) {
  showLoading('Generating portal link…');
  try {
    const [tokenRes, gasUrlRes] = await Promise.all([
      rpc('generateClientPortalToken', clientId),
      Promise.resolve(localStorage.getItem('mav_gas_url') || ''),
    ]);
    hideLoading();

    const gasUrl  = gasUrlRes;
    const token   = tokenRes.token;
    const portalUrl = `${gasUrl}?page=portal&clientId=${encodeURIComponent(clientId)}&token=${encodeURIComponent(token)}`;

    openModal('modal-client-portal', '◎ Client Portal Link', `
      <p style="font-size:13px;color:var(--text2);margin-bottom:14px">
        Share this link with your client. It gives them a read-only view of their
        quotes, jobs and outstanding invoices — no login required.
      </p>
      <div class="form-group">
        <label>Portal URL</label>
        <input type="text" id="portal-url-field" value="${esc(portalUrl)}" readonly
          style="font-family:var(--mono);font-size:11px;cursor:text;background:var(--surface2)">
      </div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn btn-ghost btn-sm" onclick="navigator.clipboard.writeText('${escAttr(portalUrl)}');window.__toast('Link copied','ok')">
          📋 Copy Link
        </button>
        <button class="btn btn-ghost btn-sm" onclick="window.open('${escAttr(portalUrl)}','_blank')">
          ↗ Preview
        </button>
        <button class="btn btn-ghost btn-sm"
          onclick="window.open('mailto:?subject=${encodeURIComponent('Your MAV Hire Client Portal')}&body=${encodeURIComponent('Hi,\\n\\nYou can view your quotes, jobs and invoices here:\\n\\n'+portalUrl+'\\n\\nKind regards,\\nMAV Hire')}','_blank')">
          ✉ Email to Client
        </button>
      </div>
      <p style="font-size:11px;color:var(--text3);margin-top:12px">
        ⚠ This link is unique to this client. Anyone with it can view their data.
        Click Revoke to invalidate it.
      </p>`, `
      <button class="btn btn-danger btn-sm" onclick="window.__revokeClientPortal('${escAttr(clientId)}')">✕ Revoke</button>
      <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Close</button>`
    );

    // Select all on click
    document.getElementById('portal-url-field')?.select();

  } catch(e) { hideLoading(); toast(e.message, 'err'); }
}

export async function revokeClientPortal(clientId) {
  if (!confirm('Revoke the portal link for this client? The current URL will stop working.')) return;
  showLoading('Revoking…');
  try {
    await rpc('revokeClientPortalToken', clientId);
    toast('Portal link revoked', 'ok');
    closeModal();
  } catch(e) { toast(e.message, 'err'); }
  finally { hideLoading(); }
}