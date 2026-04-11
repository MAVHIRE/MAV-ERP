/**
 * MAV HIRE ERP — js/panes/analytics.js
 */
import { rpc }    from '../api/gas.js';
import { STATE }  from '../utils/state.js';
import { showLoading, hideLoading, toast, setValue, emptyState } from '../utils/dom.js';
import { fmtCur, fmtPct, esc, statusBadge } from '../utils/format.js';

export async function loadAnalytics() {
  showLoading('Loading analytics…');
  try {
    const [skuStats, snapshot] = await Promise.all([
      rpc('getSkuStats'),
      rpc('getExecutiveAnalyticsSnapshot'),
    ]);
    STATE.skuStats = skuStats;
    render(skuStats, snapshot);
    const el = document.getElementById('analytics-subtitle');
    if (el) el.textContent = 'Last refreshed: ' + new Date().toLocaleTimeString('en-GB');
  } catch(e) { toast('Analytics failed: ' + e.message, 'err'); }
  finally { hideLoading(); }
}

function render(skuStats, snapshot) {
  const totals = snapshot?.totals || {};

  const kpis = document.getElementById('analytics-kpis');
  if (kpis) kpis.innerHTML = `
    <div class="kpi"><div class="kpi-label">Total Revenue</div><div class="kpi-value accent">${fmtCur(totals.totalRevenue)}</div></div>
    <div class="kpi"><div class="kpi-label">Overall ROI</div><div class="kpi-value ${(totals.overallRoiPct||0)>0?'ok':'danger'}">${fmtPct(totals.overallRoiPct)}</div></div>
    <div class="kpi"><div class="kpi-label">Asset Cost</div><div class="kpi-value">${fmtCur(totals.totalAssetCost)}</div></div>
    <div class="kpi"><div class="kpi-label">Book Value</div><div class="kpi-value">${fmtCur(totals.totalBookValue)}</div></div>
    <div class="kpi"><div class="kpi-label">Maint Cost</div><div class="kpi-value warn">${fmtCur(totals.totalMaintenanceCost)}</div></div>
    <div class="kpi"><div class="kpi-label">SKU Count</div><div class="kpi-value">${totals.skuCount||0}</div></div>`;

  const topSkus = snapshot?.topRevenueSkus || skuStats.slice(0, 10);
  const topTbody = document.querySelector('#tbl-top-skus tbody');
  if (topTbody) topTbody.innerHTML = topSkus.map(s => `<tr>
    <td class="td-name">${esc(s.name)}<br><span class="td-id">${esc(s.sku)}</span></td>
    <td class="td-num">${fmtCur(s.totalRevenue)}</td>
    <td class="td-num">${s.totalHires||0}</td>
    <td class="td-num ${s.roiPct>0?'ok':'danger'}">${fmtPct(s.roiPct)}</td>
    <td class="td-num">${fmtPct(s.utilisationPct)}</td>
  </tr>`).join('');

  const dead = snapshot?.deadStock || [];
  const deadEl = document.getElementById('dead-stock-list');
  if (deadEl) deadEl.innerHTML = dead.length === 0
    ? emptyState('✓', 'No dead stock')
    : dead.slice(0, 10).map(s => `
        <div class="card-sm" style="margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">
          <div><div style="font-weight:500;font-size:13px">${esc(s.name)}</div>
          <div class="td-id">Last hire: ${esc(s.lastHiredDate||'Never')}</div></div>
          <div class="td-num">${fmtCur(s.totalRevenue)} lifetime</div>
        </div>`).join('');

  renderSkuTable(skuStats);
}

export function renderSkuTable(stats) {
  const tbody = document.querySelector('#tbl-sku-stats tbody');
  if (!tbody) return;
  tbody.innerHTML = stats.map(s => `<tr>
    <td class="td-name">${esc(s.name)}<br><span class="td-id">${esc(s.sku)}</span></td>
    <td>${esc(s.category)}</td>
    <td class="td-num">${s.qtyOwned}</td>
    <td class="td-num">${fmtCur(s.totalRevenue)}</td>
    <td class="td-num">${fmtCur(s.revenueLast30Days)}</td>
    <td class="td-num">${fmtCur(s.revenueLast365Days)}</td>
    <td class="td-num">${fmtCur(s.totalMaintenanceCost)}</td>
    <td class="td-num ${s.roiPct>0?'ok':'danger'}">${fmtPct(s.roiPct)}</td>
    <td class="td-num">${fmtPct(s.utilisationPct)}</td>
    <td class="td-num">${s.paybackMonthsEstimate>0 ? s.paybackMonthsEstimate.toFixed(0)+' mo' : '—'}</td>
  </tr>`).join('');
}

export function filterSkuTable() {
  const q = (document.getElementById('sku-search')?.value || '').toLowerCase();
  const f = STATE.skuStats.filter(s => [s.sku, s.name, s.category].join(' ').toLowerCase().includes(q));
  renderSkuTable(f);
}

export async function runAnalyticsRefresh() {
  showLoading('Refreshing analytics… (may take a moment)');
  try {
    await rpc('refreshAllAnalytics');
    toast('Analytics refreshed', 'ok');
    STATE.loadedPanes.delete('analytics');
    await loadAnalytics();
  } catch(e) { toast('Refresh failed: ' + e.message, 'err'); }
  finally { hideLoading(); }
}
