/**
 * MAV HIRE ERP — js/panes/dashboard.js
 */
import { rpc }                   from '../api/gas.js';
import { STATE }                 from '../utils/state.js';
import { showLoading, hideLoading, toast, setValue, emptyState } from '../utils/dom.js';
import { fmtCur, fmtCurDec, fmtDate, esc, statusBadge } from '../utils/format.js';

export async function initDashboard() {
  showLoading('Loading dashboard…');
  try {
    const data    = await rpc('getDashboardSnapshot');
    STATE.dashboard = data;
    render(data);
    setValue('dash-ts', 'Updated ' + new Date().toLocaleTimeString('en-GB'));
  } catch(e) {
    toast('Dashboard failed: ' + e.message, 'err');
    setValue('dash-ts', '⚠ ' + e.message);
  } finally {
    hideLoading();
  }
}

function render(d) {
  d = d || {};
  const ops = d.operations || {};
  const fin = d.finance    || {};
  const stk = d.stock      || {};
  const mnt = d.maintenance|| {};

  setValue('k-active-jobs',  ops.activeJobCount     ?? 0);
  setValue('k-checked-out',  ops.checkedOutCount    ?? 0);
  setValue('k-overdue',      ops.overdueReturnCount ?? 0);
  setValue('k-rev30',        fmtCur(fin.revenueLast30Days));
  setValue('k-rev365',       fmtCur(fin.revenueLast365Days));
  setValue('k-outstanding',  fmtCur(fin.outstandingBalance));
  setValue('k-maint',        mnt.openCount          ?? 0);
  setValue('k-lowstock',     stk.lowStockCount      ?? 0);

  const alerts = d.alerts || [];
  const pill   = document.getElementById('alert-pill');
  const count  = document.getElementById('alert-count');
  if (count) count.textContent = alerts.length;
  if (pill) {
    pill.classList.toggle('hidden', alerts.length === 0);
    pill.style.cursor = 'pointer';
    pill.onclick = () => {
      const ac = document.getElementById('dash-alerts-section');
      if (ac) ac.scrollIntoView({ behavior: 'smooth' });
    };
  }

  // Revenue mini chart (30d vs 90d vs 365d)
  renderRevenueChart(fin);

  // Alerts panel
  const ac = document.getElementById('dash-alerts');
  if (ac) ac.innerHTML = alerts.length === 0
    ? emptyState('✓', 'No alerts')
    : alerts.slice(0, 10).map(a => {
        const clickable = a.jobId || a.productId || a.maintenanceId;
        const onclick = a.jobId
          ? `window.__openJobDetail('${esc(a.jobId)}')`
          : a.maintenanceId
            ? `window.__openMaintDetail('${esc(a.maintenanceId)}')`
            : a.productId
              ? `window.__switchPane('inventory')`
              : '';
        return `<div class="alert-item ${(a.severity||'').toLowerCase()}"
          style="cursor:${clickable?'pointer':'default'};display:flex;align-items:flex-start;gap:8px"
          ${onclick ? `onclick="${onclick}"` : ''}>
          <div class="alert-dot"></div>
          <div style="flex:1">
            <div class="alert-cat">${esc(a.severity)} · ${esc(a.category)}</div>
            <div class="alert-msg">${esc(a.message)}</div>
          </div>
          ${clickable ? '<div style="color:var(--text3);font-size:11px;margin-top:2px">→</div>' : ''}
        </div>`;
      }).join('');

  // Overdue returns
  const ov   = ops.overdueReturns || [];
  const ovEl = document.getElementById('dash-overdue');
  if (ovEl) ovEl.innerHTML = ov.length === 0
    ? emptyState('✓', 'None overdue')
    : ov.map(j => jobCard(j, `<span class="badge badge-danger">${j.daysOverdue}d overdue</span>`, fmtCur(j.total))).join('');

  // Upcoming jobs
  const up   = ops.upcomingJobs || [];
  const upEl = document.getElementById('dash-upcoming');
  if (upEl) upEl.innerHTML = up.length === 0
    ? emptyState('◌', 'None upcoming')
    : up.map(j => jobCard(j, statusBadge(j.status), fmtDate(j.startDate||j.eventDate))).join('');

  // Low stock
  const ls   = stk.lowStockItems || [];
  const lsEl = document.getElementById('dash-lowstock');
  if (lsEl) lsEl.innerHTML = ls.length === 0
    ? emptyState('▦', 'All stocked')
    : ls.map(p => `
        <div class="card-sm" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <div>
            <div style="font-weight:500;font-size:13px">${esc(p.name)}</div>
            <div class="td-id">${esc(p.sku)}</div>
          </div>
          <div style="text-align:right">
            <div class="pc-qty" style="color:var(--danger)">${p.qtyAvailable??0} avail</div>
            <div class="td-id">min ${p.minStockLevel}</div>
          </div>
        </div>`).join('');
}

function renderRevenueChart(fin) {
  const el = document.getElementById('dash-revenue-chart');
  if (!el) return;

  const r30  = +(fin.revenueLast30Days  || 0);
  const r90  = +(fin.revenueLast90Days  || 0);
  const r365 = +(fin.revenueLast365Days || 0);
  const outstanding = +(fin.outstandingBalance || 0);
  const confirmed   = +(fin.confirmedRevenue   || 0);

  const max = Math.max(r30, r90, r365, 1);

  const bar = (val, label, color) => {
    const pct = Math.round((val / max) * 100);
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:6px;flex:1">
      <div style="font-family:var(--mono);font-size:11px;color:var(--text2);font-weight:500">${fmtCur(val)}</div>
      <div style="width:100%;background:var(--surface2);border-radius:3px;height:80px;display:flex;align-items:flex-end;overflow:hidden">
        <div style="width:100%;height:${pct}%;background:${color};border-radius:3px 3px 0 0;transition:height .4s ease;min-height:${val>0?'3px':'0'}"></div>
      </div>
      <div style="font-family:var(--mono);font-size:10px;color:var(--text3);letter-spacing:.06em;text-transform:uppercase">${label}</div>
    </div>`;
  };

  el.innerHTML = `
    <div style="display:flex;gap:12px;align-items:flex-end;margin-bottom:16px">
      ${bar(r30,  '30 days',  'var(--info)')}
      ${bar(r90,  '90 days',  'var(--accent2)')}
      ${bar(r365, '12 months','var(--accent)')}
    </div>
    <div style="display:flex;gap:16px;padding-top:12px;border-top:1px solid var(--border)">
      <div>
        <div style="font-family:var(--mono);font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">Outstanding</div>
        <div style="font-family:var(--mono);font-size:13px;color:${outstanding>0?'var(--warn)':'var(--text2)'};font-weight:500">${fmtCur(outstanding)}</div>
      </div>
      ${confirmed > 0 ? `<div>
        <div style="font-family:var(--mono);font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">Confirmed Pipeline</div>
        <div style="font-family:var(--mono);font-size:13px;color:var(--ok);font-weight:500">${fmtCur(confirmed)}</div>
      </div>` : ''}
    </div>`;
}

function jobCard(j, rightTop, rightBottom) {
  return `<div class="job-card" data-status="${esc(j.status)}" onclick="window.__openJobDetail('${esc(j.jobId)}')">
    <div>
      <div class="jc-name">${esc(j.jobName || j.jobId)}</div>
      <div class="jc-client">${esc(j.clientName)} ${j.company ? '· ' + esc(j.company) : ''}</div>
    </div>
    <div class="jc-right">${rightTop}<div class="jc-meta">${rightBottom}</div></div>
  </div>`;
}