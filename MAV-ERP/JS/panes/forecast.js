/**
 * MAV HIRE ERP — js/panes/forecast.js
 */
import { rpc }   from '../api/gas.js';
import { STATE } from '../utils/state.js';
import { showLoading, hideLoading, toast, emptyState } from '../utils/dom.js';
import { fmtCur, fmtCurDec, esc, statusBadge } from '../utils/format.js';

export async function loadForecast() {
  showLoading('Loading forecasts…');
  try {
    const [forecasts, buyReport] = await Promise.all([
      rpc('getForecasts', {}),
      rpc('getBuyRecommendationReport', 90, 'Low'),
    ]);
    STATE.forecasts = forecasts;
    render(forecasts, buyReport);
    const el = document.getElementById('forecast-subtitle');
    if (el) el.textContent = forecasts.length + ' forecast lines';
  } catch(e) { toast('Forecast failed: ' + e.message, 'err'); }
  finally { hideLoading(); }
}

function render(forecasts, buyReport) {
  const kpis = document.getElementById('forecast-kpis');
  if (kpis) kpis.innerHTML = `
    <div class="kpi"><div class="kpi-label">Forecast Lines</div><div class="kpi-value">${forecasts.length}</div></div>
    <div class="kpi"><div class="kpi-label">Buy Recommendations</div><div class="kpi-value warn">${(buyReport.items||[]).length}</div></div>
    <div class="kpi"><div class="kpi-label">Shortage SKUs 90d</div><div class="kpi-value danger">${(buyReport.items||[]).filter(b=>b.predictedShortageQty>0).length}</div></div>
    <div class="kpi"><div class="kpi-label">Est. Buy Cost</div><div class="kpi-value accent">${fmtCur(buyReport.estimatedTotalCost)}</div></div>`;

  const shortages = (buyReport.items||[]).filter(b => b.predictedShortageQty > 0);
  const shortEl   = document.getElementById('shortage-list');
  if (shortEl) shortEl.innerHTML = shortages.length === 0
    ? emptyState('✓', 'No predicted shortages')
    : shortages.slice(0, 10).map(b => `
        <div class="card-sm" style="margin-bottom:6px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <div style="font-weight:500;font-size:13px">${esc(b.productName)}</div>
              <div class="td-id">${esc(b.sku)} · ${esc(b.category)}</div>
            </div>
            <div style="text-align:right">
              <div style="font-family:var(--mono);font-size:13px;color:var(--danger)">Short ${Math.ceil(b.predictedShortageQty)}</div>
              <div class="td-id">${esc(b.confidence)} confidence</div>
            </div>
          </div>
        </div>`).join('');

  const buys   = (buyReport.items||[]).filter(b => b.recommendedPurchaseQty > 0);
  const buyEl  = document.getElementById('buy-list');
  if (buyEl) buyEl.innerHTML = buys.length === 0
    ? emptyState('◌', 'No buy recommendations')
    : buys.slice(0, 10).map(b => `
        <div class="card-sm" style="margin-bottom:6px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <div style="font-weight:500;font-size:13px">${esc(b.productName)}</div>
              <div class="td-id">${esc(b.supplierName||'—')}</div>
            </div>
            <div style="text-align:right">
              <div style="font-family:var(--mono);font-size:13px;color:var(--accent)">Buy ${Math.ceil(b.recommendedPurchaseQty)}</div>
              <div class="td-id">${fmtCur(b.estimatedPurchaseCost)}</div>
            </div>
          </div>
        </div>`).join('');

  const tbody = document.querySelector('#tbl-forecasts tbody');
  if (tbody) tbody.innerHTML = forecasts.map(f => `<tr>
    <td class="td-name">${esc(f.scope)}<br><span class="td-id">${esc(f.scopeId)}</span></td>
    <td class="td-num">${f.forecastHorizonDays}d</td>
    <td class="td-num">${fmtCur(f.forecastRevenue)}</td>
    <td class="td-num">${f.forecastDemandQty > 0 ? f.forecastDemandQty.toFixed(1) : '—'}</td>
    <td class="td-num ${f.predictedShortageQty > 0 ? 'danger' : ''}">${f.predictedShortageQty > 0 ? Math.ceil(f.predictedShortageQty) : '—'}</td>
    <td class="td-num">${f.recommendedPurchaseQty > 0 ? Math.ceil(f.recommendedPurchaseQty) : '—'}</td>
    <td>${statusBadge(f.confidence)}</td>
  </tr>`).join('');
}

export async function runForecastRefresh() {
  showLoading('Rebuilding forecasts… (may take a moment)');
  try {
    await rpc('refreshForecasts');
    toast('Forecasts rebuilt', 'ok');
    STATE.loadedPanes.delete('forecast');
    await loadForecast();
  } catch(e) { toast('Failed: ' + e.message, 'err'); }
  finally { hideLoading(); }
}
