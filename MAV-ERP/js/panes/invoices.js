/**
 * MAV HIRE ERP — js/panes/invoices.js  v2.0
 * Outstanding invoices: balance, payment history, batch reminders.
 */
import { rpc, rpcWithFallback } from '../api/gas.js';
import { STATE }    from '../utils/state.js';
import { showLoading, hideLoading, toast, emptyState } from '../utils/dom.js';
import { fmtCurDec, fmtDate, esc, exportCsv , escAttr} from '../utils/format.js';
import { openModal, closeModal }  from '../components/modal.js';
import { openRecordDepositModal } from './jobs.js';

// ── Load ──────────────────────────────────────────────────────────────────────
export async function loadInvoices() {
  showLoading('Loading outstanding invoices…');
  try {
    const jobs = await rpcWithFallback('getJobs', {});
    const outstanding = jobs
      .filter(j => (+j.balanceDue || 0) > 0 && !['Cancelled'].includes(j.status))
      .sort((a, b) => (+b.balanceDue || 0) - (+a.balanceDue || 0));

    STATE.invoices = outstanding;
    renderInvoices(outstanding);

    const el = document.getElementById('invoices-subtitle');
    if (el) {
      const total = outstanding.reduce((s, j) => s + (+j.balanceDue || 0), 0);
      el.textContent = `${outstanding.length} outstanding · ${fmtCurDec(total)} total due`;
    }
  } catch(e) { toast('Invoices failed: ' + e.message, 'err'); }
  finally { hideLoading(); }
}

// ── Filter ────────────────────────────────────────────────────────────────────
export function filterInvoices() {
  const q   = (document.getElementById('inv2-search')?.value || '').toLowerCase();
  const age = document.getElementById('inv2-age-filter')?.value || '';
  const now = new Date();

  const filtered = (STATE.invoices || []).filter(j => {
    if (q && ![j.jobId, j.jobName, j.clientName, j.company].join(' ').toLowerCase().includes(q)) return false;
    if (age) {
      const days = j.eventDate ? Math.floor((now - new Date(j.eventDate)) / 86400000) : 0;
      if (age === '7'  && days < 7)  return false;
      if (age === '30' && days < 30) return false;
      if (age === '60' && days < 60) return false;
    }
    return true;
  });
  renderInvoices(filtered);
}

// ── Render list ───────────────────────────────────────────────────────────────
function renderInvoices(jobs) {
  const el = document.getElementById('invoices-list');
  if (!el) return;
  if (!jobs.length) { el.innerHTML = emptyState('✓', 'No outstanding balances — all clear'); return; }

  const totalDue  = jobs.reduce((s, j) => s + (+j.balanceDue || 0), 0);
  const overdue30 = jobs.filter(j => {
    const d = j.eventDate ? Math.floor((new Date()-new Date(j.eventDate))/86400000) : 0;
    return d > 30;
  });

  const summary = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">
      <div style="background:var(--surface2);border-radius:8px;padding:12px;border-top:2px solid var(--warn)">
        <div style="font-size:10px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;margin-bottom:4px">Outstanding</div>
        <div style="font-family:var(--mono);font-size:20px;font-weight:700;color:var(--warn)">${fmtCurDec(totalDue)}</div>
      </div>
      <div style="background:var(--surface2);border-radius:8px;padding:12px;border-top:2px solid var(--info)">
        <div style="font-size:10px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;margin-bottom:4px">Invoices</div>
        <div style="font-size:20px;font-weight:700">${jobs.length}</div>
      </div>
      <div style="background:var(--surface2);border-radius:8px;padding:12px;border-top:2px solid ${overdue30.length?'var(--danger)':'var(--ok)'}">
        <div style="font-size:10px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;margin-bottom:4px">Overdue 30d+</div>
        <div style="font-size:20px;font-weight:700;color:${overdue30.length?'var(--danger)':'var(--ok)'}">${overdue30.length}</div>
      </div>
    </div>
    ${overdue30.length > 1 ? `
    <div style="margin-bottom:12px">
      <button class="btn btn-ghost btn-sm" onclick="window.__batchPaymentReminder()">
        ✉ Send Reminders to All ${overdue30.length} Overdue
      </button>
    </div>` : ''}`;

  const rows = jobs.map(j => {
    const daysAgo     = j.eventDate ? Math.floor((new Date()-new Date(j.eventDate))/86400000) : null;
    const overdue     = daysAgo !== null && daysAgo > 30;
    const urgencyColor= overdue ? 'var(--danger)' : daysAgo > 14 ? 'var(--warn)' : 'var(--text3)';
    const paidPct     = j.total > 0 ? Math.round((+j.depositPaid||0) / +j.total * 100) : 0;
    return `
      <div style="display:flex;gap:12px;align-items:center;padding:12px 14px;
        border-radius:var(--r2);background:var(--surface);border:1px solid var(--border);
        border-left:3px solid ${overdue?'var(--danger)':'var(--warn)'};margin-bottom:6px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:3px">
            <div style="font-weight:600;font-size:13px;cursor:pointer"
              onclick="window.__openInvoiceDetail('${escAttr(j.jobId)}')">${esc(j.jobName||j.jobId)}</div>
            <span style="font-size:10px;color:var(--text3);font-family:var(--mono)">${esc(j.jobId)}</span>
          </div>
          <div style="font-size:11px;color:var(--text3)">${esc(j.clientName)}${j.company?` · ${esc(j.company)}`:''}</div>
          <div style="display:flex;gap:10px;margin-top:4px;font-size:11px;flex-wrap:wrap">
            <span>${fmtDate(j.eventDate)}</span>
            ${daysAgo!==null?`<span style="color:${urgencyColor}">${daysAgo}d ago${overdue?' · OVERDUE':''}</span>`:''}
          </div>
          <!-- Payment progress bar -->
          <div style="margin-top:6px">
            <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text3);margin-bottom:2px">
              <span>Paid ${fmtCurDec(+j.depositPaid||0)} of ${fmtCurDec(+j.total||0)}</span>
              <span>${paidPct}%</span>
            </div>
            <div style="height:4px;background:var(--surface3);border-radius:2px">
              <div style="height:100%;width:${paidPct}%;background:${paidPct>=100?'var(--ok)':'var(--accent)'};border-radius:2px;transition:width .4s"></div>
            </div>
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-family:var(--mono);font-size:11px;color:var(--text3)">Total: ${fmtCurDec(+j.total||0)}</div>
          <div style="font-family:var(--mono);font-size:15px;font-weight:700;color:var(--warn)">${fmtCurDec(+j.balanceDue||0)}</div>
          <div style="font-size:10px;color:var(--text3)">due</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:5px;flex-shrink:0">
          <button class="btn btn-ghost btn-sm"
            onclick="window.__openInvoiceDetail('${escAttr(j.jobId)}')">📋 Detail</button>
          <button class="btn btn-primary btn-sm"
            onclick="window.__recordDeposit('${escAttr(j.jobId)}',${+j.balanceDue||0})">💰 Pay</button>
          <button class="btn btn-ghost btn-sm"
            onclick="window.__sendPaymentReminder('${escAttr(j.jobId)}')">✉ Remind</button>
        </div>
      </div>`;
  }).join('');

  el.innerHTML = summary + rows;
}

// ── Invoice detail modal ──────────────────────────────────────────────────────
export async function openInvoiceDetail(jobId) {
  showLoading('Loading invoice detail…');
  try {
    const [job, auditLog] = await Promise.all([
      rpc('getJobById', jobId),
      rpc('getAuditLog', { entityType: 'Job', entityId: jobId, limit: 50 }).catch(() => []),
    ]);

    // Extract payment events from audit log
    const payments = (auditLog||[]).filter(r =>
      r.action === 'PAYMENT' || (r.action === 'UPDATE' && r.field === 'Deposit Paid')
    ).sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));

    const total       = +job.total      || 0;
    const paid        = +job.depositPaid|| 0;
    const balance     = +job.balanceDue || 0;
    const paidPct     = total > 0 ? Math.round(paid/total*100) : 0;
    const daysAgo     = job.eventDate ? Math.floor((new Date()-new Date(job.eventDate))/86400000) : null;
    const overdue     = daysAgo !== null && daysAgo > 30;

    hideLoading();
    openModal('modal-invoice-detail', `Invoice — ${esc(job.jobName||job.jobId)}`, `
      <!-- Header KPIs -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;margin-bottom:16px">
        ${[
          ['Total', fmtCurDec(total), 'var(--text)'],
          ['Paid', fmtCurDec(paid), 'var(--ok)'],
          ['Balance', fmtCurDec(balance), balance>0?'var(--warn)':'var(--ok)'],
          ['Progress', paidPct+'%', paidPct>=100?'var(--ok)':overdue?'var(--danger)':'var(--accent)'],
        ].map(([l,v,c]) => `<div style="background:var(--surface2);border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:9px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;margin-bottom:3px">${l}</div>
          <div style="font-size:16px;font-weight:700;color:${c};font-family:var(--mono)">${v}</div>
        </div>`).join('')}
      </div>

      <!-- Progress bar -->
      <div style="margin-bottom:14px">
        <div style="height:6px;background:var(--surface3);border-radius:3px">
          <div style="height:100%;width:${paidPct}%;background:${paidPct>=100?'var(--ok)':'var(--accent)'};border-radius:3px;transition:width .5s"></div>
        </div>
      </div>

      <!-- Job summary -->
      <div class="two-col" style="gap:12px;margin-bottom:14px">
        <div>
          <div class="detail-row"><div class="detail-label">Client</div><div class="detail-value">${esc(job.clientName||'—')}${job.company?`<br><span style="font-size:10px;color:var(--text3)">${esc(job.company)}</span>`:''}</div></div>
          <div class="detail-row"><div class="detail-label">Email</div><div class="detail-value">${job.clientEmail?`<a href="mailto:${esc(job.clientEmail)}" style="color:var(--info)">${esc(job.clientEmail)}</a>`:'—'}</div></div>
          <div class="detail-row"><div class="detail-label">Phone</div><div class="detail-value">${esc(job.clientPhone||'—')}</div></div>
        </div>
        <div>
          <div class="detail-row"><div class="detail-label">Event Date</div><div class="detail-value">${fmtDate(job.eventDate)}${daysAgo!==null?`<span style="font-size:10px;color:${overdue?'var(--danger)':'var(--text3)'}"> (${daysAgo}d ago${overdue?' · OVERDUE':''})</span>`:''}</div></div>
          <div class="detail-row"><div class="detail-label">Status</div><div class="detail-value">${esc(job.status||'—')}</div></div>
          <div class="detail-row"><div class="detail-label">Deposit Req.</div><div class="detail-value">${fmtCurDec(+job.depositRequired||0)}</div></div>
        </div>
      </div>

      <!-- Payment history -->
      <div class="section-title" style="margin-bottom:8px">Payment History</div>
      ${payments.length ? `
      <div style="margin-bottom:14px">
        ${payments.map((p,i) => {
          const amt = p.newValue && !isNaN(p.newValue) ? fmtCurDec(+p.newValue - +(p.oldValue||0)) : '—';
          return `<div style="display:flex;justify-content:space-between;align-items:center;
            padding:8px 10px;background:var(--surface2);border-radius:var(--r);
            border-left:3px solid var(--ok);margin-bottom:4px">
            <div>
              <div style="font-size:12px;font-weight:600;color:var(--ok)">${amt}</div>
              <div style="font-size:10px;color:var(--text3)">${p.notes||'Payment recorded'}</div>
            </div>
            <div style="font-size:10px;color:var(--text3);text-align:right;font-family:var(--mono)">
              ${p.timestamp?fmtDate(p.timestamp.substring(0,10)):'—'}<br>
              ${p.user||''}
            </div>
          </div>`;
        }).join('')}
        <div style="font-size:11px;color:var(--text3);padding:4px 0">
          Total paid to date: <strong>${fmtCurDec(paid)}</strong>
        </div>
      </div>` : `<div style="font-size:12px;color:var(--text3);margin-bottom:14px">No payments recorded yet</div>`}

      <!-- Line items summary -->
      <div class="section-title" style="margin-bottom:8px">Line Items</div>
      <div class="tbl-wrap" style="margin-bottom:4px">
        <table style="font-size:12px">
          <thead><tr><th>Item</th><th class="td-num">Qty</th><th class="td-num">Days</th><th class="td-num">Total</th></tr></thead>
          <tbody>
            ${(job.items||[]).map(item => `<tr>
              <td>${esc(item.name||item.productId)}</td>
              <td class="td-num">${item.quantity||1}</td>
              <td class="td-num">${item.hireDays||1}</td>
              <td class="td-num" style="font-family:var(--mono)">${fmtCurDec(+item.lineTotal||0)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `, `
      <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Close</button>
      <button class="btn btn-ghost btn-sm" onclick="window.__generateJobInvoice('${escAttr(jobId)}')">🧾 Invoice PDF</button>
      <button class="btn btn-ghost btn-sm" onclick="window.__sendPaymentReminder('${escAttr(jobId)}')">✉ Remind</button>
      <button class="btn btn-primary btn-sm" onclick="window.__closeModal();window.__recordDeposit('${escAttr(jobId)}',${balance})">💰 Record Payment</button>
    `);
  } catch(e) { hideLoading(); toast(e.message, 'err'); }
}

// ── Batch payment reminder ────────────────────────────────────────────────────
export async function batchPaymentReminder() {
  const overdue = (STATE.invoices||[]).filter(j => {
    const d = j.eventDate ? Math.floor((new Date()-new Date(j.eventDate))/86400000) : 0;
    return d > 30;
  });
  if (!overdue.length) { toast('No overdue invoices', 'info'); return; }

  // Group by client email
  const byEmail = {};
  overdue.forEach(j => {
    const email = j.clientEmail || '';
    if (!email) return;
    if (!byEmail[email]) byEmail[email] = { name: j.clientName, jobs: [] };
    byEmail[email].jobs.push(j);
  });

  const entries = Object.entries(byEmail);
  if (!entries.length) { toast('No client emails on file for overdue invoices', 'warn'); return; }

  for (const [email, { name, jobs }] of entries) {
    const totalDue = jobs.reduce((s,j) => s+(+j.balanceDue||0), 0);
    const jobLines = jobs.map(j => `  • ${j.jobName||j.jobId}: ${fmtCurDec(+j.balanceDue||0)} due`).join('\n');
    const body = `Hi ${name},\n\nThis is a reminder that the following balance${jobs.length>1?'s are':' is'} currently outstanding:\n\n${jobLines}\n\nTotal: ${fmtCurDec(totalDue)}\n\nPlease don't hesitate to get in touch if you have any questions.\n\nKind regards,\nMAV Hire`;
    const subject = `Payment Reminder — MAV Hire${jobs.length>1?` (${jobs.length} invoices)`:''}`;
    window.open(`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_blank');
    await new Promise(r => setTimeout(r, 500));
  }
  toast(`Opened ${entries.length} reminder email${entries.length!==1?'s':''}`, 'ok');
}

// ── CSV export ────────────────────────────────────────────────────────────────
export function exportInvoicesCsv() {
  const rows = (STATE.invoices||[]).map(j => ({
    'Job ID':      j.jobId,
    'Job Name':    j.jobName,
    'Client':      j.clientName,
    'Company':     j.company,
    'Email':       j.clientEmail,
    'Event Date':  j.eventDate?.substring(0,10)||'',
    'Total':       +j.total||0,
    'Paid':        +j.depositPaid||0,
    'Balance':     +j.balanceDue||0,
    'Status':      j.status,
  }));
  exportCsv(`MAV_Invoices_${new Date().toISOString().substring(0,10)}.csv`, rows);
  toast(`Exported ${rows.length} invoices`, 'ok');
}

// Keep backwards-compat exports
export { sendPaymentReminder, generateJobInvoice };

async function sendPaymentReminder(jobId) {
  try {
    const job = await rpc('getJobById', jobId);
    const email = job.clientEmail || '';
    if (!email) { toast('No email address on file for this client', 'warn'); return; }
    const balance = fmtCurDec(job.balanceDue || 0);
    const msg = `Hi ${job.clientName || 'there'},\n\nThis is a friendly reminder that a balance of ${balance} remains outstanding for your event on ${fmtDate(job.eventDate)}.\n\nPlease don't hesitate to get in touch if you have any questions.\n\nKind regards,\nMAV Hire`;
    const mailtoLink = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(`Payment Reminder — ${job.jobName||job.jobId}`)}&body=${encodeURIComponent(msg)}`;
    window.open(mailtoLink, '_blank');
    toast(`Reminder email opened for ${email}`, 'ok');
  } catch(e) { toast(e.message, 'err'); }
}

async function generateJobInvoice(jobId) {
  showLoading('Generating invoice…');
  try {
    const result = await rpc('generateInvoice', jobId, {});
    hideLoading();
    const win = window.open('', '_blank');
    if (win) { win.document.write(result.html); win.document.close(); win.print(); }
    toast(`Invoice ${result.invoiceNumber} generated`, 'ok');
  } catch(e) { hideLoading(); toast(e.message, 'err'); }
}