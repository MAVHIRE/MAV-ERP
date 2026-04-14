/**
 * MAV HIRE ERP — js/panes/invoices.js
 * Outstanding invoices: all jobs with balance due, sortable, quick payment.
 */
import { rpc }   from '../api/gas.js';
import { STATE } from '../utils/state.js';
import { showLoading, hideLoading, toast, emptyState } from '../utils/dom.js';
import { fmtCurDec, fmtDate, esc, statusBadge } from '../utils/format.js';
import { openRecordDepositModal } from './jobs.js';

export async function loadInvoices() {
  showLoading('Loading outstanding invoices…');
  try {
    const jobs = await rpc('getJobs', {});
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

export function filterInvoices() {
  const q   = (document.getElementById('inv2-search')?.value || '').toLowerCase();
  const age = document.getElementById('inv2-age-filter')?.value || '';
  const now = new Date();

  const filtered = (STATE.invoices || []).filter(j => {
    if (q && ![j.jobId, j.jobName, j.clientName, j.company].join(' ').toLowerCase().includes(q)) return false;
    if (age) {
      const days = j.eventDate
        ? Math.floor((now - new Date(j.eventDate)) / 86400000)
        : 0;
      if (age === '7'  && days < 7)  return false;
      if (age === '30' && days < 30) return false;
      if (age === '60' && days < 60) return false;
    }
    return true;
  });
  renderInvoices(filtered);
}

function renderInvoices(jobs) {
  const el = document.getElementById('invoices-list');
  if (!el) return;
  if (!jobs.length) { el.innerHTML = emptyState('✓', 'No outstanding balances — all clear'); return; }

  const totalDue = jobs.reduce((s, j) => s + (+j.balanceDue || 0), 0);
  const overdue30 = jobs.filter(j => {
    const d = j.eventDate ? Math.floor((new Date()-new Date(j.eventDate))/86400000) : 0;
    return d > 30;
  });

  const summary = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">
      <div style="background:var(--surface2);border-radius:8px;padding:12px;border-top:2px solid var(--warn)">
        <div style="font-size:10px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;margin-bottom:4px">Total Outstanding</div>
        <div style="font-family:var(--mono);font-size:20px;font-weight:700;color:var(--warn)">${fmtCurDec(totalDue)}</div>
      </div>
      <div style="background:var(--surface2);border-radius:8px;padding:12px;border-top:2px solid var(--info)">
        <div style="font-size:10px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;margin-bottom:4px">Invoices</div>
        <div style="font-size:20px;font-weight:700">${jobs.length}</div>
      </div>
      <div style="background:var(--surface2);border-radius:8px;padding:12px;border-top:2px solid var(--danger)">
        <div style="font-size:10px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;margin-bottom:4px">Overdue 30d+</div>
        <div style="font-size:20px;font-weight:700;color:${overdue30.length?'var(--danger)':'var(--ok)'}">${overdue30.length}</div>
      </div>
    </div>`;

  const rows = jobs.map(j => {
    const daysAgo = j.eventDate ? Math.floor((new Date()-new Date(j.eventDate))/86400000) : null;
    const overdue = daysAgo !== null && daysAgo > 30;
    const urgencyColor = overdue ? 'var(--danger)' : daysAgo > 14 ? 'var(--warn)' : 'var(--text3)';
    return `
      <div style="display:flex;gap:12px;align-items:center;padding:12px 14px;
        border-radius:var(--r2);background:var(--surface);border:1px solid var(--border);
        border-left:3px solid ${overdue?'var(--danger)':'var(--warn)'};margin-bottom:6px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:3px">
            <div style="font-weight:600;font-size:13px;cursor:pointer"
              onclick="window.__openJobDetail('${esc(j.jobId)}')">${esc(j.jobName||j.jobId)}</div>
            <span style="font-size:10px;color:var(--text3);font-family:var(--mono)">${esc(j.jobId)}</span>
          </div>
          <div style="font-size:11px;color:var(--text3)">${esc(j.clientName)}${j.company?' · '+esc(j.company):''}</div>
          <div style="display:flex;gap:10px;margin-top:4px;font-size:11px;flex-wrap:wrap">
            <span>${fmtDate(j.eventDate)}</span>
            ${daysAgo!==null?`<span style="color:${urgencyColor}">${daysAgo}d ago${overdue?' — OVERDUE':''}</span>`:''}
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-family:var(--mono);font-size:11px;color:var(--text3)">Total: ${fmtCurDec(j.total)}</div>
          <div style="font-family:var(--mono);font-size:15px;font-weight:700;color:var(--warn)">${fmtCurDec(j.balanceDue)}</div>
          <div style="font-size:10px;color:var(--text3)">due</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:5px;flex-shrink:0">
          <button class="btn btn-primary btn-sm"
            onclick="window.__recordDeposit('${esc(j.jobId)}',${j.balanceDue})">
            💰 Record Payment
          </button>
          <button class="btn btn-ghost btn-sm"
            onclick="window.__generateJobInvoice('${esc(j.jobId)}')">
            🧾 Generate Invoice
          </button>
          <button class="btn btn-ghost btn-sm"
            onclick="window.__sendPaymentReminder('${esc(j.jobId)}')">
            ✉ Send Reminder
          </button>
        </div>
      </div>`;
  }).join('');

  el.innerHTML = summary + rows;
}

export async function sendPaymentReminder(jobId) {
  try {
    const job = await rpc('getJobById', jobId);
    const email = job.clientEmail || '';
    if (!email) { toast('No email address on file for this client', 'warn'); return; }
    const balance = fmtCurDec(job.balanceDue || 0);
    const msg = `Hi ${job.clientName || 'there'},\n\nThis is a friendly reminder that a balance of ${balance} is outstanding for your recent hire: ${job.jobName || job.jobId}.\n\nPlease arrange payment at your earliest convenience.\n\nKind regards,\nMAV Hire`;
    // Open default email client
    const mailtoLink = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent('Payment Reminder — ' + (job.jobName||job.jobId))}&body=${encodeURIComponent(msg)}`;
    window.open(mailtoLink, '_blank');
    toast(`Reminder email opened for ${email}`, 'ok');
  } catch(e) { toast(e.message, 'err'); }
}

export async function generateJobInvoice(jobId) {
  showLoading('Generating invoice…');
  try {
    const result = await rpc('generateInvoice', jobId, {});
    hideLoading();
    // Open invoice HTML in new window
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(result.html);
      win.document.close();
      win.print();
    }
    toast(`Invoice ${result.invoiceNumber} generated`, 'ok');
  } catch(e) { hideLoading(); toast(e.message, 'err'); }
}