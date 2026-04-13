/**
 * MAV HIRE ERP — forecast.js  v2.0
 * Demand forecasting with Chart.js timeline, shortage alerts,
 * buy recommendations with cost analysis.
 */
import { rpc }   from '../api/gas.js';
import { STATE } from '../utils/state.js';
import { showLoading, hideLoading, toast, emptyState } from '../utils/dom.js';
import { fmtCur, fmtCurDec, fmtPct, esc, statusBadge } from '../utils/format.js';

let _charts = {};

export async function loadForecast() {
  showLoading('Loading forecasts…');
  try {
    const [forecasts, buyReport] = await Promise.all([
      rpc('getForecasts', {}),
      rpc('getBuyRecommendationReport', 90, 'Low'),
    ]);
    STATE.forecasts = forecasts;
    await loadChartJs();
    render(forecasts, buyReport);
    const el = document.getElementById('forecast-subtitle');
    if (el) el.textContent = forecasts.length+' forecast lines · '+new Date().toLocaleTimeString('en-GB');
  } catch(e) { toast('Forecast failed: '+e.message,'err'); }
  finally { hideLoading(); }
}

function loadChartJs() {
  return new Promise(resolve=>{
    if (window.Chart) { resolve(); return; }
    const s=document.createElement('script');
    s.src='https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js';
    s.onload=resolve; s.onerror=resolve;
    document.head.appendChild(s);
  });
}

function render(forecasts, buyReport) {
  renderKPIs(forecasts, buyReport);
  renderForecastChart(forecasts);
  renderShortages(buyReport);
  renderBuyList(buyReport);
  renderForecastTable(forecasts);
}

function renderKPIs(forecasts, buyReport) {
  const el = document.getElementById('forecast-kpis');
  if (!el) return;
  const items    = buyReport.items||[];
  const shorts   = items.filter(b=>b.predictedShortageQty>0);
  const buys     = items.filter(b=>b.recommendedPurchaseQty>0);
  const totCost  = buyReport.estimatedTotalCost||0;
  const totForecastRev = forecasts.reduce((s,f)=>s+(+f.forecastRevenue||0),0);

  el.innerHTML = [
    ['Forecast Revenue 90d', fmtCur(totForecastRev),    'Based on demand history',      'accent'],
    ['Shortage SKUs',        shorts.length,              'Predicted in next 90 days',    shorts.length>0?'danger':'ok'],
    ['Buy Recommendations',  buys.length,                'SKUs to purchase',             buys.length>0?'warn':''],
    ['Est. Purchase Cost',   fmtCur(totCost),            'To cover predicted shortages', 'info'],
    ['Forecast Lines',       forecasts.length,           'SKU + category forecasts',     ''],
    ['High Confidence',      forecasts.filter(f=>f.confidence==='High').length, 'of '+forecasts.length+' lines', 'ok'],
  ].map(([l,v,s,c])=>`
    <div class="kpi">
      <div class="kpi-label">${l}</div>
      <div class="kpi-value ${c}">${v}</div>
      <div style="font-size:10px;color:var(--text3);margin-top:3px;font-family:var(--mono)">${s}</div>
    </div>`).join('');
}

function renderForecastChart(forecasts) {
  const el = document.getElementById('forecast-chart');
  if (!el || !window.Chart) return;

  const top = forecasts
    .filter(f=>f.forecastRevenue>0&&f.scope==='SKU')
    .sort((a,b)=>b.forecastRevenue-a.forecastRevenue)
    .slice(0,12);

  if (!top.length) { el.innerHTML=emptyState('◌','No forecast data — run refresh'); return; }

  el.innerHTML=`<div style="position:relative;height:200px"><canvas id="c-forecast"></canvas></div>`;
  setTimeout(()=>{
    const c=document.getElementById('c-forecast');
    if (!c) return;
    if (_charts.forecast) _charts.forecast.destroy();
    _charts.forecast = new Chart(c,{
      type:'bar',
      data:{
        labels:top.map(f=>f.scopeId&&f.scopeId.length>16?f.scopeId.substring(0,14)+'…':f.scopeId||f.scope),
        datasets:[
          { label:'Historic 90d',  data:top.map(f=>+(f.historicRevenue90||0).toFixed(0)),
            backgroundColor:'rgba(77,184,255,0.5)', borderColor:'#4db8ff', borderWidth:1, borderRadius:3 },
          { label:'Forecast 90d',  data:top.map(f=>+(f.forecastRevenue||0).toFixed(0)),
            backgroundColor:'rgba(232,255,71,0.7)', borderColor:'#e8ff47', borderWidth:1, borderRadius:3 },
        ]
      },
      options:{
        responsive:true, maintainAspectRatio:false, indexAxis:'y',
        plugins:{ legend:{ position:'top', labels:{ color:'#9090a8', font:{size:11} } } },
        scales:{
          x:{ grid:{color:'rgba(255,255,255,0.04)'}, ticks:{color:'#9090a8',font:{size:10},callback:v=>'£'+Math.round(v/1000)+'k'}, beginAtZero:true },
          y:{ grid:{display:false}, ticks:{color:'#e8e8f0',font:{size:10}} }
        }
      }
    });
  },50);
}

function renderShortages(buyReport) {
  const el = document.getElementById('shortage-list');
  if (!el) return;
  const shorts = (buyReport.items||[]).filter(b=>b.predictedShortageQty>0)
    .sort((a,b)=>b.predictedShortageQty-a.predictedShortageQty);

  if (!shorts.length) { el.innerHTML=emptyState('✓','No predicted shortages in next 90 days'); return; }
  el.innerHTML = shorts.slice(0,15).map(b=>{
    const severity = b.predictedShortageQty>=5?'var(--danger)':b.predictedShortageQty>=2?'var(--warn)':'var(--info)';
    return `<div style="display:flex;justify-content:space-between;align-items:center;
      padding:10px 12px;border-radius:6px;background:var(--surface2);margin-bottom:5px;
      border-left:3px solid ${severity}">
      <div>
        <div style="font-weight:500;font-size:13px">${esc(b.productName)}</div>
        <div style="font-size:10px;color:var(--text3);font-family:var(--mono)">${esc(b.sku)} · ${esc(b.category)}</div>
      </div>
      <div style="text-align:right">
        <div style="font-family:var(--mono);font-size:14px;font-weight:700;color:${severity}">
          −${Math.ceil(b.predictedShortageQty)} units</div>
        <div style="font-size:10px;color:var(--text3)">${esc(b.confidence)} confidence</div>
      </div>
    </div>`;
  }).join('');
}

function renderBuyList(buyReport) {
  const el = document.getElementById('buy-list');
  if (!el) return;
  const buys = (buyReport.items||[]).filter(b=>b.recommendedPurchaseQty>0)
    .sort((a,b)=>b.estimatedPurchaseCost-a.estimatedPurchaseCost);

  if (!buys.length) { el.innerHTML=emptyState('◌','No buy recommendations'); return; }

  const totalCost = buys.reduce((s,b)=>s+(+b.estimatedPurchaseCost||0),0);
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;padding:8px 12px;background:var(--surface2);
      border-radius:6px;margin-bottom:10px;font-size:12px">
      <span style="color:var(--text2)">${buys.length} items to purchase</span>
      <span style="font-family:var(--mono);font-weight:600;color:var(--accent)">${fmtCur(totalCost)} estimated total</span>
    </div>
    ${buys.slice(0,15).map(b=>`
    <div style="display:flex;justify-content:space-between;align-items:center;
      padding:10px 12px;border-radius:6px;background:var(--surface2);margin-bottom:5px">
      <div>
        <div style="font-weight:500;font-size:13px">${esc(b.productName)}</div>
        <div style="font-size:10px;color:var(--text3)">${esc(b.supplierName||'No supplier set')}</div>
      </div>
      <div style="display:flex;gap:12px;align-items:center">
        <div style="text-align:center">
          <div style="font-family:var(--mono);font-size:16px;font-weight:700;color:var(--accent)">${Math.ceil(b.recommendedPurchaseQty)}</div>
          <div style="font-size:9px;color:var(--text3);text-transform:uppercase">units</div>
        </div>
        <div style="text-align:right">
          <div style="font-family:var(--mono);font-size:12px;color:var(--text2)">${fmtCur(b.estimatedPurchaseCost)}</div>
          <div style="font-size:10px;color:var(--text3)">est. cost</div>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="window.__openNewPOModal()" title="Create PO">+ PO</button>
      </div>
    </div>`).join('')}`;
}

function renderForecastTable(forecasts) {
  const tbody = document.querySelector('#tbl-forecasts tbody');
  if (!tbody) return;
  tbody.innerHTML = forecasts.map(f=>{
    const shortColor = f.predictedShortageQty>0?'danger':'';
    const conf = f.confidence||'—';
    const confColor = conf==='High'?'ok':conf==='Medium'?'warn':'danger';
    return `<tr>
      <td><div style="font-weight:500;font-size:13px">${esc(f.scope)}</div>
          <div class="td-id">${esc(f.scopeId||'')}</div></td>
      <td class="td-num">${f.forecastHorizonDays}d</td>
      <td class="td-num">${fmtCur(f.historicRevenue90||0)}</td>
      <td class="td-num accent">${fmtCur(f.forecastRevenue||0)}</td>
      <td class="td-num">${f.forecastDemandQty>0?f.forecastDemandQty.toFixed(1):'—'}</td>
      <td class="td-num ${shortColor}">${f.predictedShortageQty>0?'−'+Math.ceil(f.predictedShortageQty):'—'}</td>
      <td class="td-num">${f.recommendedPurchaseQty>0?Math.ceil(f.recommendedPurchaseQty)+'→':'—'}</td>
      <td><span class="badge badge-${confColor}">${conf}</span></td>
    </tr>`;
  }).join('');
}

export async function runForecastRefresh() {
  showLoading('Rebuilding forecasts… may take 30-60 seconds');
  try {
    await rpc('refreshForecasts');
    toast('Forecasts rebuilt','ok');
    await loadForecast();
  } catch(e) { toast('Failed: '+e.message,'err'); }
  finally { hideLoading(); }
}