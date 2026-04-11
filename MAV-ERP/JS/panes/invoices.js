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
  if (!jobs.length) {
    el.innerHTML = emptyState('✓', 'No outstanding balances');
    return;
  }

  const totalDue = jobs.reduce((s, j) => s + (+j.balanceDue || 0), 0);

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;
                padding:10px 14px;background:var(--surface2);border-radius:var(--r);
                margin-bottom:12px;font-size:13px">
      <span style="color:var(--text2)">${jobs.length} invoice${jobs.length!==1?'s':''} shown</span>
      <span style="font-family:var(--mono);font-size:15px;color:var(--warn);font-weight:700">
        ${fmtCurDec(totalDue)} outstanding
      </span>
    </div>
    <div class="tbl-wrap">
      <table>
        <thead><tr>
          <th>Job</th><th>Client</th><th>Event Date</th><th>Status</th>
          <th class="right">Total</th><th class="right">Paid</th>
          <th class="right" style="color:var(--warn)">Balance Due</th>
          <th>Actions</th>
        </tr></thead>
        <tbody>
          ${jobs.map(j => {
            const daysAgo = j.eventDate
              ? Math.floor((new Date() - new Date(j.eventDate)) / 86400000)
              : null;
            const overdue = daysAgo !== null && daysAgo > 30;
            return `<tr>
              <td>
                <div class="td-name" style="cursor:pointer" onclick="window.__openJobDetail('${esc(j.jobId)}')">${esc(j.jobName||j.jobId)}</div>
                <div class="td-id">${esc(j.jobId)}</div>
              </td>
              <td>${esc(j.clientName)}<br><span class="td-id">${esc(j.company||'')}</span></td>
              <td>${fmtDate(j.eventDate)}${daysAgo!==null?`<br><span class="td-id" style="${overdue?'color:var(--danger)':''}">${daysAgo}d ago</span>`:''}</td>
              <td>${statusBadge(j.status)}</td>
              <td class="td-num">${fmtCurDec(j.total)}</td>
              <td class="td-num">${fmtCurDec(j.depositPaid)}</td>
              <td class="td-num" style="color:var(--warn);font-weight:600">${fmtCurDec(j.balanceDue)}</td>
              <td>
                <button class="btn btn-primary btn-sm"
                  onclick="window.__recordDeposit('${esc(j.jobId)}',${j.balanceDue})">
                  💰 Record Payment
                </button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}