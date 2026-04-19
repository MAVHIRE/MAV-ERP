/**
 * MAV HIRE ERP — dashboard.js  v3.0
 * Phase 1: syntax clean, delegation fixed, malformed HTML fixed
 * Phase 2: loadChartJs cached, rAF not setTimeout, destroyDashboard, pure helpers
 * Phase 3: semantic buttons, component helpers, DOM cache, CSS classes
 */
import { rpc, rpcWithFallback }  from '../api/gas.js';
import { STATE }                 from '../utils/state.js';
import { showLoading, hideLoading, toast, setValue, emptyState } from '../utils/dom.js';
import { fmtCur, fmtDate, esc, statusBadge, escAttr } from '../utils/format.js';

// ── Module state ───────────────────────────────────────────────────────────────
let _chartRevenue = null;
let _chartUtil    = null;
let _chartStatus  = null;
let _chartJsPromise = null; // Phase 2: cached promise — no duplicate script appends

// ── DOM cache — avoid repeated getElementById calls ───────────────────────────
const DOM = {
  kpis:       () => document.getElementById('dash-kpis'),
  revenue:    () => document.getElementById('dash-revenue-chart'),
  status:     () => document.getElementById('dash-status-chart'),
  util:       () => document.getElementById('dash-util-chart'),
  alerts:     () => document.getElementById('dash-alerts'),
  overdue:    () => document.getElementById('dash-overdue'),
  upcoming:   () => document.getElementById('dash-upcoming'),
  lowStock:   () => document.getElementById('dash-lowstock'),
  finance:    () => document.getElementById('dash-finance'),
  serviceDue: () => document.getElementById('dash-service-due'),
  enquiries:  () => document.getElementById('dash-new-enquiries'),
  brain:      () => document.getElementById('dash-brain'),
  alertPill:  () => document.getElementById('alert-pill'),
  alertCount: () => document.getElementById('alert-count'),
};

// ── Pure business-logic helpers ────────────────────────────────────────────────
function getSeverityColor(severity) {
  const s = (severity || '').toLowerCase();
  return s === 'high' ? 'var(--danger)' : s === 'medium' ? 'var(--warn)' : 'var(--info)';
}
function getUtilisationColor(pct) {
  return pct > 80 ? '#4dff91' : pct > 50 ? '#e8ff47' : '#ff8c00';
}
function getDaysAwayColor(daysAway) {
  if (typeof daysAway !== 'number') return 'var(--text3)';
  return daysAway <= 3 ? 'var(--danger)' : daysAway <= 7 ? 'var(--warn)' : 'var(--text3)';
}
function getStockColor(pct) {
  return pct < 30 ? 'var(--danger)' : pct < 70 ? 'var(--warn)' : 'var(--ok)';
}
function getPriorityColor(priority) {
  return priority === 'High' ? 'var(--danger)' : priority === 'Low' ? 'var(--text3)' : 'var(--warn)';
}

// ── Reusable component helpers ─────────────────────────────────────────────────

/** Clickable dashboard card rendered as a <button> for keyboard + screen reader access */
function dashCard({ action, id, borderColor = 'var(--border2)', extraClass = '', children }) {
  return `
    <button type="button" class="dash-card ${extraClass}"
      data-action="${action}" data-id="${escAttr(id)}"
      style="border-left:3px solid ${borderColor}">
      ${children}
    </button>`;
}

/** Stat row: label on left, value on right */
function statRow(label, value, valueColor = 'var(--text)') {
  return `
    <div class="dash-stat-row">
      <span class="dash-stat-label">${esc(label)}</span>
      <span class="dash-stat-value" style="color:${valueColor}">${value}</span>
    </div>`;
}

/** KPI tile */
function kpiTile(label, value, sub = '', colorClass = '', icon = '') {
  return `
    <div class="kpi">
      <div class="dash-kpi-header">
        <div class="kpi-label">${label}</div>
        ${icon ? `<div class="dash-kpi-icon">${icon}</div>` : ''}
      </div>
      <div class="kpi-value ${colorClass}">${value}</div>
      ${sub ? `<div class="kpi-delta">${sub}</div>` : ''}
    </div>`;
}

/** Revenue mini-stat */
function revStatCell(label, val, color) {
  return `
    <div class="dash-rev-stat">
      <div class="dash-rev-stat__value" style="color:${color}">${fmtCur(val)}</div>
      <div class="dash-rev-stat__label">${label}</div>
    </div>`;
}

// ── Chart.js loader — promise cached, no duplicate appends ────────────────────
function loadChartJs() {
  if (window.Chart) return Promise.resolve();
  if (_chartJsPromise) return _chartJsPromise;
  _chartJsPromise = new Promise(resolve => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js';
    s.onload  = resolve;
    s.onerror = () => { _chartJsPromise = null; resolve(); }; // allow retry on error
    document.head.appendChild(s);
  });
  return _chartJsPromise;
}

// ── Public API ─────────────────────────────────────────────────────────────────
export async function initDashboard() {
  showLoading('Loading dashboard...');
  try {
    const [data, serviceDue, upcomingReport, lowStock, overdueReport, enquirySummary] = await Promise.all([
      rpcWithFallback('getDashboardSnapshot'),
      rpc('getUpcomingServiceDue', 14).catch(() => []),
      rpc('getUpcomingJobsReport', 14).catch(() => null),
      rpc('getLowStockProducts').catch(() => null),
      rpc('getOverdueReturnsReport').catch(() => null),
      rpcWithFallback('getEnquiries', { status: 'New' }).catch(() => []),
    ]);
    STATE.dashboard = data;
    await render(data, serviceDue, upcomingReport, lowStock, overdueReport, enquirySummary);
    setupPaneEvents();
    setValue('dash-ts', 'Updated ' + new Date().toLocaleTimeString('en-GB'));
    // Brain report loads in background — non-blocking
    rpc('getManagementBrainReport')
      .then(brain => { renderBrainReport(brain); setupPaneEvents(); })
      .catch(e => console.warn('[Dashboard] Brain report:', e.message));
  } catch(e) {
    toast('Dashboard failed: ' + e.message, 'err');
    setValue('dash-ts', 'Error: ' + e.message);
  } finally {
    hideLoading();
  }
}

export function destroyDashboard() {
  _chartRevenue?.destroy(); _chartRevenue = null;
  _chartUtil?.destroy();    _chartUtil    = null;
  _chartStatus?.destroy();  _chartStatus  = null;
}

// ── Main render ────────────────────────────────────────────────────────────────
async function render(d, serviceDue, upcomingReport, lowStock, _overdueReport, newEnquiries) {
  d = d || {};
  const ops = d.operations || {};
  const fin = d.finance    || {};
  const stk = d.stock      || {};
  const mnt = d.maintenance|| {};

  renderKPIs(ops, fin, stk, mnt);
  await loadChartJs();
  renderRevenueChart(fin);
  renderStatusChart(ops);
  renderUtilChart(stk);

  renderAlerts(d.alerts || []);
  renderOverdue(ops.overdueReturns || []);
  renderUpcoming(upcomingReport || ops.upcomingJobs || []);
  renderLowStock(lowStock || stk.lowStockItems || []);
  renderFinanceSummary(fin);
  renderServiceDue(serviceDue || []);
  renderNewEnquiries(newEnquiries || []);
}

// ── KPIs ──────────────────────────────────────────────────────────────────────
function renderKPIs(ops, fin, stk, mnt) {
  const el = DOM.kpis();
  if (!el) return;

  const overdueCount = ops.overdueReturnCount || 0;
  const outBalance   = fin.outstandingBalance || 0;
  const utilPct      = stk.averageUtilisation ? Math.round(stk.averageUtilisation * 100) + '%' : '---';
  // Phase 1 fix: use Math.round not |0 for integer coercion
  const avgMonthly   = fmtCur(Math.round((fin.revenueLast365Days || 0) / 12));

  el.innerHTML =
    kpiTile('Active Jobs',        ops.activeJobCount ?? '---',  (ops.checkedOutCount || 0) + ' checked out', '', '◉') +
    kpiTile('Revenue 30d',        fmtCur(fin.revenueLast30Days), 'vs ' + avgMonthly + ' avg/mo', 'accent', '£') +
    kpiTile('Outstanding',        fmtCur(outBalance), (fin.overdueInvoiceCount || 0) + ' invoices', outBalance > 0 ? 'warn' : '', '!') +
    kpiTile('Overdue Returns',    overdueCount || '0', overdueCount > 0 ? 'Requires action' : 'All on time', overdueCount > 0 ? 'danger' : 'ok', '↩') +
    kpiTile('Fleet Utilisation',  utilPct, (stk.lowStockCount || 0) + ' low stock SKUs', '', '▦') +
    kpiTile('Open Maintenance',   mnt.openCount ?? '---', (mnt.highPriorityCount || 0) + ' high priority', mnt.openCount > 0 ? 'warn' : '', '⟳') +
    kpiTile('Confirmed Pipeline', fmtCur(fin.confirmedRevenue || 0), 'Accepted quotes not yet invoiced', 'ok', '→') +
    kpiTile('Revenue 12m',        fmtCur(fin.revenueLast365Days), 'Gross before costs', '', '◈');
}

// ── Revenue chart ─────────────────────────────────────────────────────────────
function renderRevenueChart(fin) {
  const el = DOM.revenue();
  if (!el) return;
  if (!window.Chart) { renderRevenueBarFallback(fin, el); return; }

  const r30  = +(fin.revenueLast30Days  || 0);
  const r90  = +(fin.revenueLast90Days  || 0);
  const r365 = +(fin.revenueLast365Days || 0);
  const out  = +(fin.outstandingBalance || 0);

  el.innerHTML = `
    <div class="dash-rev-stats">
      ${revStatCell('30 days',   r30,  'var(--info)')}
      ${revStatCell('90 days',   r90,  'var(--accent2)')}
      ${revStatCell('12 months', r365, 'var(--accent)')}
      ${out > 0 ? revStatCell('Outstanding', out, 'var(--warn)') : ''}
    </div>
    <div class="dash-chart-wrap"><canvas id="c-revenue"></canvas></div>`;

  // Phase 2: rAF instead of setTimeout
  requestAnimationFrame(() => {
    const canvas = document.getElementById('c-revenue');
    if (!canvas || !window.Chart) return;
    if (_chartRevenue) _chartRevenue.destroy();
    _chartRevenue = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: ['30d', '90d', '12m'],
        datasets: [{
          data: [r30, r90, r365],
          backgroundColor: ['rgba(77,184,255,0.7)', 'rgba(184,255,0,0.7)', 'rgba(232,255,71,0.85)'],
          borderColor:     ['#4db8ff', '#b8ff00', '#e8ff47'],
          borderWidth: 2, borderRadius: 4,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#9090a8', font: { size: 11 } } },
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#9090a8', font: { size: 10 },
               callback: v => '£' + Math.round(v / 1000) + 'k' }, beginAtZero: true },
        },
      },
    });
  });
}

function renderRevenueBarFallback(fin, el) {
  if (!el) return;
  const r30 = +(fin.revenueLast30Days || 0);
  const r90 = +(fin.revenueLast90Days || 0);
  const r365 = +(fin.revenueLast365Days || 0);
  const out  = +(fin.outstandingBalance || 0);
  const max  = Math.max(r30, r90, r365, 1);

  const bar = (v, l, c) => `
    <div class="dash-fallback-bar">
      <div class="dash-fallback-bar__label" style="color:${c}">${fmtCur(v)}</div>
      <div class="dash-fallback-bar__track">
        <div class="dash-fallback-bar__fill" style="height:${Math.round(v / max * 100)}%;background:${c}"></div>
      </div>
      <div class="dash-fallback-bar__name">${l}</div>
    </div>`;

  el.innerHTML = `<div class="dash-fallback-bars">
    ${bar(r30, '30d', 'var(--info)')}
    ${bar(r90, '90d', 'var(--accent2)')}
    ${bar(r365, '12m', 'var(--accent)')}
    ${out > 0 ? bar(out, 'due', 'var(--warn)') : ''}
  </div>`;
}

// ── Job status donut ──────────────────────────────────────────────────────────
function renderStatusChart(ops) {
  const el = DOM.status();
  if (!el || !window.Chart) return;

  const statusCounts = ops.statusCounts || {};
  const statuses = Object.keys(statusCounts).filter(s => statusCounts[s] > 0);
  if (!statuses.length) { el.innerHTML = emptyState('◉', 'No jobs'); return; }

  const colors = {
    'Draft': '#5a5a70', 'Confirmed': '#4db8ff', 'Allocated': '#9b8aff',
    'Prepping': '#ffaa00', 'Checked Out': '#ff8c00', 'Live': '#4dff91',
    'Returned': '#4dff91', 'Complete': '#3a3a4a', 'Cancelled': '#ff4d4d',
  };

  el.innerHTML = `
    <div class="dash-chart-wrap" style="height:140px"><canvas id="c-status"></canvas></div>
    <div class="dash-legend">
      ${statuses.map(s => `
        <div class="dash-legend-item">
          <div class="dash-legend-dot" style="background:${colors[s] || '#888'}"></div>
          <span>${s} (${statusCounts[s]})</span>
        </div>`).join('')}
    </div>`;

  requestAnimationFrame(() => {
    const canvas = document.getElementById('c-status');
    if (!canvas || !window.Chart) return;
    if (_chartStatus) _chartStatus.destroy();
    _chartStatus = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: statuses,
        datasets: [{
          data: statuses.map(s => statusCounts[s]),
          backgroundColor: statuses.map(s => colors[s] || '#888'),
          borderWidth: 2, borderColor: '#141418',
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.parsed} jobs` } },
        },
        cutout: '65%',
      },
    });
  });
}

// ── Utilisation ring ──────────────────────────────────────────────────────────
function renderUtilChart(stk) {
  const el = DOM.util();
  if (!el || !window.Chart) return;

  const pct   = Math.min(100, Math.round((stk.averageUtilisation || 0) * 100));
  const color = getUtilisationColor(pct);

  el.innerHTML = `
    <div class="dash-util-ring-wrap">
      <div class="dash-chart-wrap" style="height:120px;width:120px;margin:0 auto">
        <canvas id="c-util"></canvas>
      </div>
      <div class="dash-util-overlay">
        <div class="dash-util-pct" style="color:${color}">${pct}%</div>
        <div class="dash-util-label">utilisation</div>
      </div>
    </div>
    <div class="dash-util-meta">
      ${stk.totalBarcodes || 0} units tracked &middot; ${stk.lowStockCount || 0} low stock
    </div>`;

  requestAnimationFrame(() => {
    const canvas = document.getElementById('c-util');
    if (!canvas || !window.Chart) return;
    if (_chartUtil) _chartUtil.destroy();
    _chartUtil = new Chart(canvas, {
      type: 'doughnut',
      data: {
        datasets: [{
          data: [pct, 100 - pct],
          backgroundColor: [color, 'rgba(255,255,255,0.05)'],
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        cutout: '72%',
      },
    });
  });
}

// ── Finance summary ───────────────────────────────────────────────────────────
function renderFinanceSummary(fin) {
  const el = DOM.finance();
  if (!el) return;
  const outBalance = fin.outstandingBalance || 0;
  const metrics = [
    ['Total Revenue',     fmtCur(fin.totalRevenue || 0),      'var(--accent)'],
    ['Revenue 30d',       fmtCur(fin.revenueLast30Days || 0), 'var(--info)'],
    ['Revenue 90d',       fmtCur(fin.revenueLast90Days || 0), 'var(--info)'],
    ['Outstanding',       fmtCur(outBalance),                  outBalance > 0 ? 'var(--warn)' : 'var(--ok)'],
    ['Confirmed Pipeline',fmtCur(fin.confirmedRevenue || 0),  'var(--ok)'],
    ['Avg Invoice',       fmtCur(fin.averageJobValue || 0),   'var(--text2)'],
  ];
  el.innerHTML = metrics.map(([l, v, c]) => statRow(l, v, c)).join('');
}

// ── Alerts ────────────────────────────────────────────────────────────────────
function renderAlerts(alerts) {
  const pill  = DOM.alertPill();
  const count = DOM.alertCount();
  if (count) count.textContent = alerts.length;
  if (pill) {
    pill.classList.toggle('hidden', alerts.length === 0);
    // Phase 2: addEventListener not .onclick
    pill.removeEventListener('click', _alertPillClick);
    pill.addEventListener('click', _alertPillClick);
  }

  const el = DOM.alerts();
  if (!el) return;
  if (!alerts.length) { el.innerHTML = emptyState('✓', 'No alerts -- all clear'); return; }

  el.innerHTML = alerts.slice(0, 12).map(a => {
    const color  = getSeverityColor(a.severity);
    const action = a.jobId         ? 'openJobDetail'
                 : a.maintenanceId ? 'openMaintDetail'
                 : a.productId     ? 'openProductDetail'
                 : '';
    const id     = a.jobId || a.maintenanceId || a.productId || '';

    return `
      <button type="button" class="dash-alert-card ${action ? '' : 'dash-alert-card--static'}"
        style="border-left-color:${color}"
        ${action ? `data-action="${action}" data-id="${escAttr(id)}"` : 'disabled'}>
        <div class="dash-alert-dot" style="background:${color}"></div>
        <div class="dash-alert-body">
          <div class="dash-alert-meta">${esc(a.severity)} &middot; ${esc(a.category)}</div>
          <div class="dash-alert-msg">${esc(a.message)}</div>
        </div>
        ${action ? '<div class="dash-alert-arrow">→</div>' : ''}
      </button>`;
  }).join('');
}

function _alertPillClick() {
  document.getElementById('dash-alerts-section')?.scrollIntoView({ behavior: 'smooth' });
}

// ── Overdue returns ───────────────────────────────────────────────────────────
function renderOverdue(jobs) {
  const el = DOM.overdue();
  if (!el) return;
  if (!jobs.length) { el.innerHTML = emptyState('✓', 'No overdue returns'); return; }

  el.innerHTML = jobs.map(j => dashCard({
    action: 'openJobDetail',
    id: j.jobId,
    borderColor: 'var(--danger)',
    children: `
      <div class="dash-card-main">
        <div class="dash-card-title">${esc(j.jobName || j.jobId)}</div>
        <div class="dash-card-sub">${esc(j.clientName)}${j.venue ? ' &middot; ' + esc(j.venue) : ''}</div>
      </div>
      <div class="dash-card-aside">
        <div class="dash-card-value" style="color:var(--danger)">${j.daysOverdue}d overdue</div>
        <div class="dash-card-sub">${fmtCur(j.total)}</div>
      </div>`,
  })).join('');
}

// ── Upcoming jobs ─────────────────────────────────────────────────────────────
function renderUpcoming(jobs) {
  const el = DOM.upcoming();
  if (!el) return;
  if (!jobs.length) { el.innerHTML = emptyState('◌', 'No upcoming jobs'); return; }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const statusColors = {
    'Confirmed': '#4db8ff', 'Allocated': '#9b8aff', 'Prepping': '#ffaa00',
    'Checked Out': '#ff8c00', 'Draft': '#5a5a70',
  };

  el.innerHTML = jobs.map(j => {
    const evDate   = new Date(j.eventDate || j.startDate || '');
    const daysAway = isNaN(evDate) ? '?' : Math.ceil((evDate - today) / 86400000);
    const urgency  = getDaysAwayColor(daysAway);
    const color    = statusColors[j.status] || '#5a5a70';

    return dashCard({
      action: 'openJobDetail',
      id: j.jobId,
      children: `
        <div class="dash-days-badge">
          <div class="dash-days-num" style="color:${urgency}">${daysAway}</div>
          <div class="dash-days-label">days</div>
        </div>
        <div class="dash-status-bar" style="background:${color}"></div>
        <div class="dash-card-main">
          <div class="dash-card-title">${esc(j.jobName || j.jobId)}</div>
          <div class="dash-card-sub">${esc(j.clientName)} &middot; ${fmtDate(j.eventDate || j.startDate)}</div>
        </div>
        <div>${statusBadge(j.status)}</div>`,
    });
  }).join('');
}

// ── Low stock ─────────────────────────────────────────────────────────────────
function renderLowStock(items) {
  const el = DOM.lowStock();
  if (!el) return;
  if (!items.length) { el.innerHTML = emptyState('✓', 'All products adequately stocked'); return; }

  el.innerHTML = items.map(p => {
    const pct      = p.minStockLevel > 0 ? Math.round(p.qtyAvailable / p.minStockLevel * 100) : 100;
    const barColor = getStockColor(pct);

    return dashCard({
      action: 'openProductDetail',
      id: p.productId,
      extraClass: 'dash-stock-card',
      children: `
        <div class="dash-card-main">
          <div class="dash-card-title">${esc(p.name)}</div>
          <div class="dash-card-sub">${esc(p.sku)}</div>
        </div>
        <div class="dash-card-aside">
          <div class="dash-card-value" style="color:${barColor}">${p.qtyAvailable ?? 0}</div>
          <div class="dash-card-sub">min ${p.minStockLevel}</div>
        </div>
        <div class="progress-bar" style="grid-column:1/-1">
          <div class="progress-fill" style="width:${Math.min(100, pct)}%;background:${barColor}"></div>
        </div>`,
    });
  }).join('');
}

// ── Management brain report ───────────────────────────────────────────────────
function renderBrainReport(brain) {
  const el = DOM.brain();
  if (!el || !brain) return;

  const opportunities = brain.opportunities || [];
  const risks         = brain.risks || [];
  const actions       = brain.recommendedActions || [];

  if (!opportunities.length && !risks.length && !actions.length) {
    el.style.display = 'none';
    return;
  }

  const itemText  = i => typeof i === 'string' ? i : (i.message || i.title || i.action || i.opportunity || i.risk || JSON.stringify(i));
  const itemLabel = i => typeof i === 'string' ? '' : (i.type || i.category || '');
  const itemSub   = i => typeof i === 'string' ? '' : (i.detail || (i.items?.length ? i.items.slice(0, 3).join(', ') : ''));

  const brainCard = (item, borderColor) => `
    <div class="dash-brain-card" style="border-left-color:${borderColor}">
      ${itemLabel(item) ? `<div class="dash-brain-card__label">${esc(itemLabel(item))}</div>` : ''}
      <div class="dash-brain-card__text">${esc(itemText(item))}</div>
      ${itemSub(item) ? `<div class="dash-brain-card__sub">${esc(itemSub(item))}</div>` : ''}
    </div>`;

  const colCount = [actions.length, opportunities.length, risks.length].filter(Boolean).length;

  el.style.display = '';
  el.innerHTML = `
    <div class="dash-brain-grid" style="grid-template-columns:repeat(${colCount},1fr)">
      ${actions.length ? `
        <div>
          <div class="dash-brain-header" style="color:var(--accent)">⚡ Recommended Actions</div>
          ${actions.slice(0, 4).map(a => brainCard(a, 'var(--accent)')).join('')}
        </div>` : ''}
      ${opportunities.length ? `
        <div>
          <div class="dash-brain-header" style="color:var(--ok)">↑ Opportunities</div>
          ${opportunities.slice(0, 4).map(o => brainCard(o, 'var(--ok)')).join('')}
        </div>` : ''}
      ${risks.length ? `
        <div>
          <div class="dash-brain-header" style="color:var(--danger)">⚠ Risks</div>
          ${risks.slice(0, 4).map(r => brainCard(r, 'var(--danger)')).join('')}
        </div>` : ''}
    </div>`;
}

// ── Service due ───────────────────────────────────────────────────────────────
function renderServiceDue(items) {
  const el = DOM.serviceDue();
  if (!el) return;
  if (!items || !items.length) {
    el.innerHTML = `<div class="dash-all-clear">✓ No service due in next 14 days</div>`;
    return;
  }
  el.innerHTML = items.slice(0, 5).map(item => {
    const days    = item.daysUntilDue ?? 99;
    const urgency = days <= 3 ? 'var(--danger)' : days <= 7 ? 'var(--warn)' : 'var(--info)';
    return `
      <div class="dash-service-row" style="border-left-color:${urgency}">
        <div class="dash-card-main">
          <div class="dash-card-title">${esc(item.productName || item.productId || '---')}</div>
          <div class="dash-card-sub">${esc(item.barcode || '')} &middot; ${esc(item.serviceType || 'Service due')}</div>
        </div>
        <div class="dash-card-aside">
          <div class="dash-card-value" style="color:${urgency}">${item.daysUntilDue != null ? item.daysUntilDue + 'd' : '---'}</div>
          <div class="dash-card-sub">until due</div>
        </div>
      </div>`;
  }).join('') +
  (items.length > 5 ? `
    <button type="button" class="dash-view-more" data-action="switch-pane" data-pane="maintenance">
      +${items.length - 5} more -- view all →
    </button>` : '');
}

// ── New enquiries ─────────────────────────────────────────────────────────────
function renderNewEnquiries(enquiries) {
  const el = DOM.enquiries();
  if (!el) return;
  const list = (enquiries || []).slice(0, 5);
  if (!list.length) {
    el.innerHTML = `<div class="dash-all-clear">✓ No unactioned enquiries</div>`;
    return;
  }

  el.innerHTML = list.map(e => {
    const distMatch  = e.notes?.match(/\[Distance\] ([\d.]+) miles/);
    const dist       = distMatch ? distMatch[1] + 'mi' : null;
    const daysAgo    = e.receivedDate ? Math.floor((Date.now() - new Date(e.receivedDate)) / 86400000) : null;
    const priColor   = getPriorityColor(e.priority);
    const daysLabel  = daysAgo != null ? (daysAgo === 0 ? 'Today' : daysAgo + 'd ago') : '';

    return `
      <div class="dash-enq-row" style="border-left-color:${priColor}">
        <div class="dash-card-main">
          <div class="dash-card-title">
            ${esc(e.name || '---')}
            ${dist ? `<span class="dash-enq-dist">📍${dist}</span>` : ''}
          </div>
          <div class="dash-card-sub">
            ${e.eventType ? esc(e.eventType) + ' &middot; ' : ''}${daysLabel}
          </div>
        </div>
        <div class="dash-enq-actions">
          <button type="button" class="btn btn-ghost btn-sm dash-enq-btn"
            data-action="open-enquiry-detail" data-id="${escAttr(e.enquiryId)}">View</button>
          <button type="button" class="btn btn-primary btn-sm dash-enq-btn"
            data-action="enqConvertToQuote" data-id="${escAttr(e.enquiryId)}">→ Quote</button>
        </div>
      </div>`;
  }).join('') +
  (enquiries.length > 5 ? `
    <button type="button" class="dash-view-more" data-action="switch-pane" data-pane="enquiries">
      +${enquiries.length - 5} more -- view all enquiries →
    </button>` : '');
}

// ── Pane-level event delegation ───────────────────────────────────────────────
// Phase 1 fix: correct container IDs matching actual rendered section IDs
// Phase 2: single consistent delegation strategy — no mixed onclick / addEventListener
function setupPaneEvents() {
  const containerIds = [
    'dash-kpis', 'dash-alerts', 'dash-overdue', 'dash-upcoming',
    'dash-lowstock', 'dash-brain', 'dash-new-enquiries', 'dash-service-due',
  ];
  containerIds.forEach(cid => {
    const container = document.getElementById(cid);
    if (!container || container._delegated) return;
    container._delegated = true;
    container.addEventListener('click', e => {
      const el = e.target.closest('[data-action]');
      if (!el || !container.contains(el)) return;
      const action = el.dataset.action;
      const id     = el.dataset.id   || '';
      const pane   = el.dataset.pane || '';
      switch (action) {
        case 'openJobDetail':       window.__openJobDetail?.(id); break;
        case 'openProductDetail':   window.__openProductDetail?.(id); break;
        case 'openMaintDetail':     window.__openMaintDetail?.(id); break;
        case 'enqConvertToQuote':   window.__enqConvertToQuote?.(id); break;
        case 'open-enquiry-detail': window.__openEnquiryDetail?.(id); break;
        case 'switch-pane':         window.__switchPane?.(pane); break;
        default: break;
      }
    });
  });
}