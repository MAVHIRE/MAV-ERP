/**
 * MAV HIRE ERP — forecast.js  v2.0
 * Demand forecasting with Chart.js timeline, shortage alerts,
 * buy recommendations with cost analysis.
 */
import { rpc }   from '../api/gas.js';
import { STATE } from '../utils/state.js';
import { showLoading, hideLoading, toast, emptyState } from '../utils/dom.js';
import { fmtCur, fmtCurDec, fmtPct, esc, statusBadge } from '../utils/format.js';
import { openModal, closeModal } from '../components/modal.js';

let _charts = {};

export async function loadForecast() {
  showLoading('Loading forecasts…');
  try {
    const [forecasts, buyReport, summary, shortage90] = await Promise.all([
      rpc('getForecasts', {}),
      rpc('getBuyRecommendationReport', 90, 'Low'),
      rpc('getForecastSummaryReport').catch(() => null),
      rpc('getShortageForecastReport', 90).catch(() => []),
    ]);
    STATE.forecasts = forecasts;
    await loadChartJs();
    render(forecasts, buyReport, summary, shortage90);
    const el = document.getElementById('forecast-subtitle');
    if (el) el.textContent = forecasts.length+' forecast lines · '+(shortage90?.length||0)+' shortages · '+new Date().toLocaleTimeString('en-GB');
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

function render(forecasts, buyReport, summary, shortage90) {
  renderKPIs(forecasts, buyReport);
  renderForecastChart(forecasts);
  renderShortages(shortage90 || (buyReport.items||[]).filter(i=>i.predictedShortageQty>0));
  renderBuyList(buyReport);
  renderCategoryForecasts(summary?.categoryForecasts || []);
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

function renderShortages(items) {
  const el = document.getElementById('shortage-list');
  if (!el) return;
  // Handle both getShortageForecastReport (array) and buyReport.items format
  const shorts = (Array.isArray(items) ? items : (items?.items||[])).filter(b =>
    (b.predictedShortageQty||b.shortageQty||0) > 0
  ).sort((a,b) =>
    (b.predictedShortageQty||b.shortageQty||0) - (a.predictedShortageQty||a.shortageQty||0)
  );

  if (!shorts.length) { el.innerHTML=emptyState('✓','No predicted shortages in next 90 days'); return; }
  el.innerHTML = shorts.slice(0,15).map(b => {
    const qty = b.predictedShortageQty || b.shortageQty || 0;
    const severity = qty>=5?'var(--danger)':qty>=2?'var(--warn)':'var(--info)';
    const daysUntil = b.daysUntilShortage ?? b.firstShortageDay ?? null;
    return `<div style="display:flex;justify-content:space-between;align-items:center;
      padding:10px 12px;border-radius:6px;background:var(--surface2);margin-bottom:5px;
      border-left:3px solid ${severity}">
      <div>
        <div style="font-weight:500;font-size:13px">${esc(b.productName||b.scopeId||'—')}</div>
        <div style="font-size:10px;color:var(--text3);font-family:var(--mono)">
          ${esc(b.sku||'')}${b.category?' · '+esc(b.category):''}
          ${daysUntil!=null?' · in '+Math.ceil(daysUntil)+'d':''}
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-family:var(--mono);font-size:14px;font-weight:700;color:${severity}">
          −${Math.ceil(qty)} units</div>
        <div style="font-size:10px;color:var(--text3)">${esc(b.confidence||'—')} confidence</div>
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
    <div style="display:flex;justify-content:space-between;align-items:center;
      padding:10px 14px;background:var(--surface2);border-radius:6px;margin-bottom:10px">
      <div>
        <span style="font-size:13px;color:var(--text)">${buys.length} items to purchase</span>
        <span style="font-family:var(--mono);font-size:12px;color:var(--accent);margin-left:12px">${fmtCur(totalCost)} estimated total</span>
      </div>
      <button class="btn btn-primary btn-sm" onclick="window.__generateBuyListPOs()">
        ⬆ Generate Purchase Orders
      </button>
    </div>
    ${buys.map((b,i)=>`
    <div style="display:flex;justify-content:space-between;align-items:center;
      padding:10px 12px;border-radius:6px;background:var(--surface2);margin-bottom:5px">
      <div style="flex:1">
        <div style="font-weight:500;font-size:13px">${esc(b.productName)}</div>
        <div style="font-size:10px;color:var(--text3)">${esc(b.supplierName||'No supplier set')} · ${esc(b.sku||'')}</div>
      </div>
      <div style="display:flex;gap:16px;align-items:center;text-align:right">
        <div>
          <div style="font-family:var(--mono);font-size:18px;font-weight:700;color:var(--warn)">${Math.ceil(b.recommendedPurchaseQty)}</div>
          <div style="font-size:9px;color:var(--text3);text-transform:uppercase">units</div>
        </div>
        <div>
          <div style="font-family:var(--mono);font-size:12px;color:var(--text2)">${fmtCur(b.estimatedPurchaseCost)}</div>
          <div style="font-size:10px;color:var(--text3)">est. cost</div>
        </div>
        <span class="badge badge-${b.shortageRisk==='High'?'danger':b.shortageRisk==='Medium'?'warn':'muted'}">${b.shortageRisk||'Low'}</span>
      </div>
    </div>`).join('')}`;

  // Expose generate POs handler
  window.__generateBuyListPOs = () => openBuyListPoModal(buys);
}

function openBuyListPoModal(buys) {
  // Group by supplier
  const bySupplier = {};
  buys.forEach(b => {
    const key = b.supplierId || b.supplierName || 'Unknown Supplier';
    if (!bySupplier[key]) bySupplier[key] = { supplierName: b.supplierName||'Unknown', supplierId: b.supplierId||'', items: [] };
    bySupplier[key].items.push(b);
  });
  const groups = Object.values(bySupplier);

  openModal('modal-buy-list-po', '⬆ Generate Purchase Orders from Buy List', `
    <p style="font-size:12px;color:var(--text2);margin-bottom:14px">
      This will create ${groups.length} draft Purchase Order${groups.length!==1?'s':''}, one per supplier.
      Review quantities below before confirming.
    </p>
    ${groups.map((g,gi) => `
      <div style="margin-bottom:14px">
        <div style="font-weight:600;font-size:13px;margin-bottom:6px;color:var(--text)">
          ${esc(g.supplierName)}
          <span style="font-size:11px;color:var(--text3);font-weight:400;margin-left:8px">${g.items.length} line${g.items.length!==1?'s':''}</span>
        </div>
        ${g.items.map((b,bi) => `
          <div style="display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center;
            padding:6px 10px;background:var(--surface2);border-radius:4px;margin-bottom:4px;font-size:12px">
            <span>${esc(b.productName)}</span>
            <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text3)">
              Qty: <input type="number" id="bl-qty-${gi}-${bi}"
                value="${Math.ceil(b.recommendedPurchaseQty)}" min="1"
                style="width:60px;font-size:12px;padding:3px 6px">
            </label>
            <span style="font-family:var(--mono);font-size:11px;color:var(--text2)">${fmtCur(b.estimatedPurchaseCost)}</span>
          </div>`).join('')}
      </div>`).join('')}
    <div class="form-group" style="margin-top:8px">
      <label>Notes for all POs (optional)</label>
      <input type="text" id="bl-notes" placeholder="e.g. Festival season stock replenishment">
    </div>`, `
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="window.__submitBuyListPOs()">Create ${groups.length} Draft PO${groups.length!==1?'s':''}</button>
  `, 'modal-lg');

  window.__submitBuyListPOs = async () => {
    const notes = document.getElementById('bl-notes')?.value || 'Auto-generated from forecast buy list';
    showLoading('Creating Purchase Orders…'); closeModal();
    let created = 0;
    try {
      for (let gi = 0; gi < groups.length; gi++) {
        const g = groups[gi];
        const items = g.items.map((b, bi) => ({
          productId:   b.productId,
          productName: b.productName,
          sku:         b.sku || '',
          quantity:    parseInt(document.getElementById(`bl-qty-${gi}-${bi}`)?.value||b.recommendedPurchaseQty, 10),
          unitCost:    b.unitCost || 0,
        })).filter(i => i.quantity > 0);
        if (!items.length) continue;
        await rpc('savePurchaseOrder', {
          supplierId:   g.supplierId,
          supplierName: g.supplierName,
          status:       'Draft',
          orderDate:    new Date().toISOString().substring(0,10),
          expectedDate: '',
          notes,
          items,
        });
        created++;
      }
      toast(`${created} Purchase Order${created!==1?'s':''} created as Draft`, 'ok');
      STATE.loadedPanes.delete('purchaseorders');
    } catch(e) { toast('Error: ' + e.message, 'err'); }
    finally { hideLoading(); }
  };
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

// ── Category forecasts ────────────────────────────────────────────────────────
function renderCategoryForecasts(items) {
  const el = document.getElementById('category-forecasts');
  if (!el || !items.length) return;
  const max = Math.max(...items.map(i => +i.forecastRevenue||0), 1);
  el.innerHTML = items.slice(0,10).map(i => {
    const pct = Math.round((+i.forecastRevenue||0)/max*100);
    const shortColor = i.predictedShortageQty>0?'var(--danger)':'var(--ok)';
    return `<div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px;font-size:12px">
        <span style="font-weight:500">${esc(i.scopeId||'—')}</span>
        <span style="font-family:var(--mono);color:var(--accent)">${fmtCur(i.forecastRevenue||0)}</span>
      </div>
      <div style="height:5px;background:var(--surface3);border-radius:3px;margin-bottom:3px">
        <div style="height:100%;width:${pct}%;background:var(--accent);border-radius:3px"></div>
      </div>
      <div style="font-size:10px;color:var(--text3)">
        Demand: ${(i.forecastDemandQty||0).toFixed(1)} units ·
        Shortage: <span style="color:${shortColor}">${i.predictedShortageQty>0?'−'+Math.ceil(i.predictedShortageQty):'None'}</span>
        · ${esc(i.confidence||'—')} confidence
      </div>
    </div>`;
  }).join('');
}