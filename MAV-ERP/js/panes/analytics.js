/**
 * MAV HIRE ERP — analytics.js  v2.0
 * Chart.js revenue bars, ROI scatter, category breakdown,
 * utilisation heatmap, dead stock analysis, ABC classification.
 */
import { rpc }    from '../api/gas.js';
import { STATE }  from '../utils/state.js';
import { showLoading, hideLoading, toast, emptyState } from '../utils/dom.js';
import { fmtCur, fmtCurDec, fmtPct, esc } from '../utils/format.js';

let _charts = {};

export async function loadAnalytics() {
  showLoading('Loading analytics…');
  try {
    const [skuStats, snapshot, deadStock, slowMoving, topSkus, pipeline,
           worstSkus, highUtil, repairReplace, categoryRevenue] = await Promise.all([
      rpc('getSkuStats'),
      rpc('getExecutiveAnalyticsSnapshot'),
      rpc('getDeadStockReport').catch(() => []),
      rpc('getSlowMovingStockReport').catch(() => []),
      rpc('getTopPerformingSkus', 10).catch(() => []),
      rpc('getSalesPipelineReport').catch(() => null),
      rpc('getWorstPerformingSkus', 10).catch(() => []),
      rpc('getHighUtilisationReport', 70).catch(() => []),
      rpc('getRepairVsReplaceReport').catch(() => []),
      rpc('getCategoryRevenueReport').catch(() => []),
    ]);
    STATE.skuStats = skuStats;
    STATE.deadStockReport = deadStock;
    await loadChartJs();
    render(skuStats, snapshot, deadStock, slowMoving, topSkus, pipeline, worstSkus, highUtil, repairReplace, categoryRevenue);
    const el = document.getElementById('analytics-subtitle');
    if (el) el.textContent = skuStats.length + ' SKUs · refreshed ' + new Date().toLocaleTimeString('en-GB');
  } catch(e) { toast('Analytics failed: ' + e.message, 'err'); }
  finally { hideLoading(); }
}

function loadChartJs() {
  return new Promise(resolve => {
    if (window.Chart) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js';
    s.onload = resolve; s.onerror = resolve;
    document.head.appendChild(s);
  });
}

function render(skuStats, snapshot, deadStock, slowMoving, topSkus, pipeline, worstSkus, highUtil, repairReplace, categoryRevenue) {
  const totals = snapshot?.totals || {};
  renderKPIs(totals, skuStats);
  renderRevenueBySkuChart(skuStats);
  renderCategoryChart(snapshot);
  renderROIChart(skuStats);
  renderAbcTable(skuStats);
  renderDeadStock(deadStock || snapshot?.deadStock || []);
  renderSlowMoving(slowMoving || []);
  renderTopSkus(topSkus || []);
  renderWorstSkus(worstSkus || []);
  renderHighUtil(highUtil || []);
  renderRepairReplace(repairReplace || []);
  renderCategoryRevenue(categoryRevenue || []);
  renderPipeline(pipeline);
  renderSkuTable(skuStats);
}

// ── KPIs ──────────────────────────────────────────────────────────────────────
function renderKPIs(totals, skuStats) {
  const el = document.getElementById('analytics-kpis');
  if (!el) return;
  const highROI = skuStats.filter(s=>(s.roiPct||0)>100).length;
  const deadCount= skuStats.filter(s=>!s.lastHiredDate||new Date(s.lastHiredDate)<new Date(Date.now()-90*86400000)).length;
  const avgUtil  = skuStats.length ? Math.round(skuStats.reduce((s,k)=>s+(+k.utilisationPct||0),0)/skuStats.length) : 0;

  el.innerHTML = [
    ['Total Revenue',   fmtCur(totals.totalRevenue),       '',       'accent'],
    ['Overall ROI',     fmtPct(totals.overallRoiPct),      '',       (totals.overallRoiPct||0)>0?'ok':'danger'],
    ['Asset Cost',      fmtCur(totals.totalAssetCost),     '',       ''],
    ['Book Value',      fmtCur(totals.totalBookValue),     '',       ''],
    ['Maint Cost',      fmtCur(totals.totalMaintenanceCost),'',      'warn'],
    ['Avg Utilisation', avgUtil+'%',                        '',       avgUtil>60?'ok':avgUtil>30?'warn':'danger'],
    ['High ROI SKUs',   highROI,                            '>100% ROI','ok'],
    ['Dead Stock SKUs', deadCount,                          '90d+ no hire', deadCount>0?'warn':''],
  ].map(([l,v,s,c])=>`
    <div class="kpi">
      <div class="kpi-label">${l}</div>
      <div class="kpi-value ${c}">${v}</div>
      ${s?`<div style="font-size:10px;color:var(--text3);margin-top:3px;font-family:var(--mono)">${s}</div>`:''}
    </div>`).join('');
}

// ── Top SKUs revenue bar chart ────────────────────────────────────────────────
function renderRevenueBySkuChart(skuStats) {
  const el = document.getElementById('analytics-revenue-chart');
  if (!el || !window.Chart) return;

  const top = skuStats.slice(0,12).sort((a,b)=>(b.totalRevenue||0)-(a.totalRevenue||0));
  if (!top.length) { el.innerHTML = emptyState('∴','No data yet'); return; }

  el.innerHTML = `<div style="position:relative;height:220px"><canvas id="c-sku-rev"></canvas></div>`;
  setTimeout(() => {
    const c = document.getElementById('c-sku-rev');
    if (!c) return;
    if (_charts.skuRev) _charts.skuRev.destroy();
    _charts.skuRev = new Chart(c, {
      type:'bar',
      data:{
        labels: top.map(s=>s.name.length>20?s.name.substring(0,18)+'…':s.name),
        datasets:[
          { label:'Total Revenue', data:top.map(s=>+(s.totalRevenue||0).toFixed(0)),
            backgroundColor:'rgba(232,255,71,0.75)', borderColor:'#e8ff47', borderWidth:1, borderRadius:3 },
          { label:'Last 30d',      data:top.map(s=>+(s.revenueLast30Days||0).toFixed(0)),
            backgroundColor:'rgba(77,184,255,0.6)', borderColor:'#4db8ff', borderWidth:1, borderRadius:3 },
        ]
      },
      options:{
        responsive:true, maintainAspectRatio:false, indexAxis:'y',
        plugins:{ legend:{ position:'top', labels:{ color:'#9090a8', font:{size:11} } } },
        scales:{
          x:{ grid:{color:'rgba(255,255,255,0.04)'}, ticks:{color:'#9090a8',font:{size:10}, callback:v=>'£'+Math.round(v/1000)+'k'}, beginAtZero:true },
          y:{ grid:{display:false}, ticks:{color:'#e8e8f0',font:{size:11}} }
        }
      }
    });
  },50);
}

// ── Category breakdown ────────────────────────────────────────────────────────
function renderCategoryChart(snapshot) {
  const el = document.getElementById('analytics-category-chart');
  if (!el || !window.Chart) return;

  const catStats = snapshot?.categoryStats || [];
  if (!catStats.length) { el.innerHTML = emptyState('∴','No category data'); return; }

  const sorted = catStats.sort((a,b)=>(b.revenueLast365Days||0)-(a.revenueLast365Days||0)).slice(0,8);
  const colors = ['#e8ff47','#4db8ff','#4dff91','#ffaa00','#9b8aff','#ff4d4d','#ff8c00','#4db8ff'];

  el.innerHTML = `<div style="position:relative;height:180px"><canvas id="c-cat"></canvas></div>`;
  setTimeout(()=>{
    const c = document.getElementById('c-cat');
    if (!c) return;
    if (_charts.cat) _charts.cat.destroy();
    _charts.cat = new Chart(c, {
      type:'doughnut',
      data:{
        labels: sorted.map(s=>s.category||s.productGroup||'Other'),
        datasets:[{ data: sorted.map(s=>+(s.revenueLast365Days||0).toFixed(0)),
          backgroundColor: colors, borderColor:'#141418', borderWidth:2 }]
      },
      options:{
        responsive:true, maintainAspectRatio:false, cutout:'55%',
        plugins:{ legend:{ position:'right', labels:{ color:'#9090a8', font:{size:10}, boxWidth:10 } },
          tooltip:{ callbacks:{ label: ctx=>`${ctx.label}: ${fmtCur(ctx.parsed)}` } } }
      }
    });
  },50);
}

// ── ROI scatter chart ─────────────────────────────────────────────────────────
function renderROIChart(skuStats) {
  const el = document.getElementById('analytics-roi-chart');
  if (!el || !window.Chart) return;

  const data = skuStats
    .filter(s=>(s.totalRevenue||0)>0)
    .map(s=>({ x:+(s.utilisationPct||0).toFixed(1), y:+(s.roiPct||0).toFixed(1),
               label:s.name, rev:s.totalRevenue }));

  if (!data.length) { el.innerHTML=emptyState('∴','No data'); return; }
  el.innerHTML = `<div style="position:relative;height:200px"><canvas id="c-roi"></canvas></div>`;

  setTimeout(()=>{
    const c = document.getElementById('c-roi');
    if (!c) return;
    if (_charts.roi) _charts.roi.destroy();
    _charts.roi = new Chart(c, {
      type:'scatter',
      data:{ datasets:[{
        label:'SKU', data,
        backgroundColor: data.map(d=>d.y>100?'rgba(77,255,145,0.7)':d.y>0?'rgba(232,255,71,0.6)':'rgba(255,77,77,0.6)'),
        pointRadius: data.map(d=>Math.max(4,Math.min(12,Math.sqrt(d.rev/500)))),
        pointHoverRadius:8,
      }]},
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false},
          tooltip:{ callbacks:{ label: ctx=>`${ctx.raw.label}: Util ${ctx.raw.x}% · ROI ${ctx.raw.y}%` } }},
        scales:{
          x:{ title:{display:true,text:'Utilisation %',color:'#9090a8',font:{size:11}},
              grid:{color:'rgba(255,255,255,0.04)'}, ticks:{color:'#9090a8'}, min:0 },
          y:{ title:{display:true,text:'ROI %',color:'#9090a8',font:{size:11}},
              grid:{color:'rgba(255,255,255,0.04)'}, ticks:{color:'#9090a8'} }
        }
      }
    });
  },50);
}

// ── ABC classification table ──────────────────────────────────────────────────
function renderAbcTable(skuStats) {
  const el = document.getElementById('analytics-abc');
  if (!el) return;
  const sorted = [...skuStats].sort((a,b)=>(b.totalRevenue||0)-(a.totalRevenue||0));
  const total  = sorted.reduce((s,k)=>s+(+k.totalRevenue||0),0)||1;
  let cumRev = 0;

  el.innerHTML = `<div class="tbl-wrap"><table>
    <thead><tr><th>SKU</th><th>Class</th><th>Revenue</th><th>% of Total</th><th>Cumulative</th><th>ROI</th><th>Util</th></tr></thead>
    <tbody>${sorted.slice(0,20).map(s=>{
      const rev = +s.totalRevenue||0;
      const pct = rev/total*100;
      cumRev += pct;
      const abc = cumRev<=70?'A':cumRev<=90?'B':'C';
      const abcColor = abc==='A'?'var(--accent)':abc==='B'?'var(--info)':'var(--text3)';
      return `<tr>
        <td><div style="font-weight:500;font-size:13px">${esc(s.name)}</div>
            <div style="font-size:10px;color:var(--text3);font-family:var(--mono)">${esc(s.sku)}</div></td>
        <td><span style="font-family:var(--mono);font-weight:700;font-size:14px;color:${abcColor}">${abc}</span></td>
        <td class="td-num">${fmtCur(rev)}</td>
        <td class="td-num">${pct.toFixed(1)}%</td>
        <td>
          <div style="display:flex;align-items:center;gap:6px">
            <div style="flex:1;height:4px;background:var(--surface3);border-radius:2px">
              <div style="height:100%;width:${Math.min(100,cumRev)}%;background:${abcColor};border-radius:2px"></div>
            </div>
            <span style="font-family:var(--mono);font-size:10px;color:var(--text3);min-width:32px">${cumRev.toFixed(0)}%</span>
          </div>
        </td>
        <td class="td-num ${(s.roiPct||0)>0?'ok':'danger'}">${fmtPct(s.roiPct)}</td>
        <td class="td-num">${fmtPct(s.utilisationPct)}</td>
      </tr>`;
    }).join('')}
    </tbody></table></div>`;
}

// ── Dead stock ────────────────────────────────────────────────────────────────
function renderDeadStock(dead) {
  const el = document.getElementById('dead-stock-list');
  if (!el) return;
  if (!dead.length) { el.innerHTML=emptyState('✓','No dead stock detected'); return; }
  el.innerHTML = dead.slice(0,15).map(s=>{
    const daysSince = s.lastHiredDate
      ? Math.floor((Date.now()-new Date(s.lastHiredDate))/86400000)
      : 999;
    return `<div onclick="window.__openProductDetail('${esc(s.productId)}')"
      style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;
      border-radius:6px;background:var(--surface2);margin-bottom:5px;cursor:pointer;transition:background .15s"
      onmouseover="this.style.background='var(--surface3)'" onmouseout="this.style.background='var(--surface2)'">
      <div>
        <div style="font-weight:500;font-size:12px">${esc(s.name)}</div>
        <div style="font-size:10px;color:var(--text3);font-family:var(--mono)">${esc(s.sku)}</div>
      </div>
      <div style="text-align:right">
        <div style="font-family:var(--mono);font-size:12px;color:var(--warn)">${daysSince<999?daysSince+'d ago':'Never hired'}</div>
        <div style="font-size:10px;color:var(--text3)">${fmtCur(s.totalRevenue)} lifetime</div>
      </div>
    </div>`;
  }).join('');
}

// ── SKU table ─────────────────────────────────────────────────────────────────
export function renderSkuTable(stats) {
  const tbody = document.querySelector('#tbl-sku-stats tbody');
  if (!tbody) return;
  tbody.innerHTML = stats.map(s=>{
    const roi = +(s.roiPct||0);
    const util = +(s.utilisationPct||0);
    const utilBar = `<div style="display:flex;align-items:center;gap:5px">
      <div style="flex:1;height:4px;background:var(--surface3);border-radius:2px;min-width:40px">
        <div style="height:100%;width:${Math.min(100,util).toFixed(0)}%;background:${util>60?'var(--ok)':util>30?'var(--warn)':'var(--danger)'};border-radius:2px"></div>
      </div>
      <span style="font-size:10px;color:var(--text3);min-width:28px">${util.toFixed(0)}%</span>
    </div>`;
    return `<tr onclick="window.__openProductDetail('${esc(s.productId)}')" style="cursor:pointer">
      <td><div style="font-weight:500">${esc(s.name)}</div><div class="td-id">${esc(s.sku)}</div></td>
      <td><div style="font-size:11px;color:var(--text2)">${esc(s.category)}</div></td>
      <td class="td-num">${s.qtyOwned||0}</td>
      <td class="td-num">${fmtCur(s.totalRevenue)}</td>
      <td class="td-num">${fmtCur(s.revenueLast30Days)}</td>
      <td class="td-num">${fmtCur(s.revenueLast365Days)}</td>
      <td class="td-num">${fmtCur(s.totalMaintenanceCost)}</td>
      <td class="td-num ${roi>0?'ok':'danger'}">${fmtPct(roi)}</td>
      <td style="min-width:80px">${utilBar}</td>
      <td class="td-num">${s.paybackMonthsEstimate>0?s.paybackMonthsEstimate.toFixed(0)+'mo':'—'}</td>
    </tr>`;
  }).join('');
}

export function filterSkuTable() {
  const q = (document.getElementById('sku-search')?.value||'').toLowerCase();
  renderSkuTable((STATE.skuStats||[]).filter(s=>[s.sku,s.name,s.category].join(' ').toLowerCase().includes(q)));
}

export async function runAnalyticsRefresh() {
  showLoading('Rebuilding analytics… this may take 30-60 seconds');
  try {
    await rpc('refreshAllAnalytics');
    toast('Analytics refreshed','ok');
    await loadAnalytics();
  } catch(e) { toast('Refresh failed: '+e.message,'err'); }
  finally { hideLoading(); }
}

// ── Slow moving stock ─────────────────────────────────────────────────────────
function renderSlowMoving(items) {
  const el = document.getElementById('slow-moving-list');
  if (!el) return;
  if (!items.length) { el.innerHTML = emptyState('◌', 'No slow-moving stock identified'); return; }
  el.innerHTML = `<div class="tbl-wrap"><table>
    <thead><tr><th>Product</th><th>SKU</th><th>Last Hired</th><th class="right">Days Since Hire</th><th class="right">Revenue YTD</th></tr></thead>
    <tbody>${items.slice(0,15).map(i=>`<tr>
      <td class="td-name">${esc(i.productName||'—')}</td>
      <td class="td-id">${esc(i.sku||'—')}</td>
      <td style="color:var(--text3)">${i.lastHiredDate?new Date(i.lastHiredDate).toLocaleDateString('en-GB'):'Never'}</td>
      <td class="td-num" style="color:${(i.daysSinceHire||0)>90?'var(--danger)':'var(--warn)'}">${i.daysSinceHire||'∞'}d</td>
      <td class="td-num">${fmtCur(i.revenueYtd||0)}</td>
    </tr>`).join('')}
    </tbody></table></div>`;
}

// ── Top performing SKUs ───────────────────────────────────────────────────────
function renderTopSkus(items) {
  const el = document.getElementById('top-skus-list');
  if (!el) return;
  if (!items.length) { el.innerHTML = emptyState('◌', 'No SKU performance data'); return; }
  const max = Math.max(...items.map(i=>+i.totalRevenue||0), 1);
  el.innerHTML = items.slice(0,10).map((i,idx)=>{
    const pct = Math.round((+i.totalRevenue||0)/max*100);
    return `<div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px;font-size:12px">
        <span style="font-weight:600">${idx+1}. ${esc(i.productName||'—')}</span>
        <span style="font-family:var(--mono);color:var(--accent)">${fmtCur(i.totalRevenue||0)}</span>
      </div>
      <div style="height:4px;background:var(--surface3);border-radius:2px">
        <div style="height:100%;width:${pct}%;background:var(--accent);border-radius:2px"></div>
      </div>
      <div style="font-size:10px;color:var(--text3);margin-top:2px;font-family:var(--mono)">
        ${i.hireCount||0} hires · ${fmtCur(i.revenuePerHire||0)}/hire · ROI ${(+i.roiPct||0).toFixed(0)}%
      </div>
    </div>`;
  }).join('');
}

// ── Sales pipeline report ─────────────────────────────────────────────────────
function renderPipeline(pipeline) {
  const el = document.getElementById('pipeline-report');
  if (!el) return;
  if (!pipeline) { el.innerHTML = emptyState('◎', 'No pipeline data'); return; }
  const stages = pipeline.stages || [];
  const total  = pipeline.totalPipelineValue || 0;
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px">
      <span style="font-size:13px;color:var(--text2)">Total pipeline value</span>
      <span style="font-family:var(--mono);font-size:20px;font-weight:700;color:var(--accent)">${fmtCur(total)}</span>
    </div>
    ${stages.map(s=>{
      const pct=total>0?Math.round((s.value||0)/total*100):0;
      const colors={Draft:'var(--text3)',Sent:'var(--info)',Accepted:'var(--ok)',Declined:'var(--danger)'};
      return `<div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
          <span style="color:${colors[s.status]||'var(--text2)'}">${esc(s.status)} <span style="color:var(--text3)">(${s.count||0})</span></span>
          <span style="font-family:var(--mono)">${fmtCur(s.value||0)} <span style="color:var(--text3)">${pct}%</span></span>
        </div>
        <div style="height:6px;background:var(--surface3);border-radius:3px">
          <div style="height:100%;width:${pct}%;background:${colors[s.status]||'var(--text2)'};border-radius:3px"></div>
        </div>
      </div>`;
    }).join('')}
    ${pipeline.conversionRate!=null?`<div style="font-size:11px;color:var(--text3);margin-top:8px;font-family:var(--mono)">Conversion rate: ${(+pipeline.conversionRate||0).toFixed(1)}% · Avg deal: ${fmtCur(pipeline.avgDealValue||0)}</div>`:''}`;
}

// ── Worst performing SKUs ─────────────────────────────────────────────────────
function renderWorstSkus(items) {
  const el = document.getElementById('worst-skus-list');
  if (!el) return;
  if (!items.length) { el.innerHTML = emptyState('◌', 'No data'); return; }
  el.innerHTML = items.slice(0,8).map((i,idx) => `
    <div style="display:flex;justify-content:space-between;align-items:center;
      padding:7px 10px;border-radius:var(--r);margin-bottom:4px;font-size:12px;
      background:var(--surface2);border-left:3px solid var(--danger)22">
      <div>
        <div style="font-weight:500">${idx+1}. ${esc(i.productName||'—')}</div>
        <div style="font-size:10px;color:var(--text3);font-family:var(--mono)">
          ${i.hireCount||0} hires · ROI ${(+i.roiPct||0).toFixed(0)}%</div>
      </div>
      <div style="text-align:right">
        <div style="font-family:var(--mono);color:var(--danger)">${fmtCur(i.totalRevenue||0)}</div>
        <div style="font-size:10px;color:var(--text3)">${fmtCur(i.totalCost||0)} cost</div>
      </div>
    </div>`).join('');
}

// ── High utilisation ──────────────────────────────────────────────────────────
function renderHighUtil(items) {
  const el = document.getElementById('high-util-list');
  if (!el) return;
  if (!items.length) { el.innerHTML = emptyState('◌', 'No items above 70% utilisation'); return; }
  el.innerHTML = items.slice(0,8).map(i => {
    const pct = Math.round(i.utilisationPct||0);
    const color = pct>90?'var(--danger)':pct>80?'var(--warn)':'var(--ok)';
    return `<div style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
        <span style="font-weight:500">${esc(i.productName||'—')}</span>
        <span style="font-family:var(--mono);color:${color};font-weight:700">${pct}%</span>
      </div>
      <div style="height:5px;background:var(--surface3);border-radius:3px">
        <div style="height:100%;width:${Math.min(pct,100)}%;background:${color};border-radius:3px"></div>
      </div>
      <div style="font-size:10px;color:var(--text3);margin-top:2px">
        ${i.hireCount||0} hires · ${fmtCur(i.totalRevenue||0)} revenue</div>
    </div>`;
  }).join('');
}

// ── Repair vs Replace ─────────────────────────────────────────────────────────
function renderRepairReplace(items) {
  const el = document.getElementById('repair-replace-list');
  if (!el) return;
  // Show only items where maintenance cost > 30% of replacement cost
  const flagged = items.filter(i => (i.maintenanceTotalCost||0) > (i.replacementCost||0) * 0.3)
    .sort((a,b) => (b.maintenanceTotalCost/Math.max(b.replacementCost,1)) - (a.maintenanceTotalCost/Math.max(a.replacementCost,1)))
    .slice(0,8);
  if (!flagged.length) {
    el.innerHTML = `<div style="font-size:12px;color:var(--ok);padding:8px 0">✓ No items flagged for replacement review</div>`;
    return;
  }
  el.innerHTML = flagged.map(i => {
    const ratio = i.replacementCost>0 ? Math.round(i.maintenanceTotalCost/i.replacementCost*100) : 0;
    const color = ratio>80?'var(--danger)':ratio>50?'var(--warn)':'var(--info)';
    return `<div style="display:flex;justify-content:space-between;align-items:center;
      padding:8px 10px;background:var(--surface2);border-radius:var(--r);
      margin-bottom:5px;border-left:3px solid ${color};font-size:12px">
      <div>
        <div style="font-weight:500">${esc(i.productName||'—')}</div>
        <div style="font-size:10px;color:var(--text3)">
          Maint: ${fmtCurDec(i.maintenanceTotalCost||0)} · Replace: ${fmtCurDec(i.replacementCost||0)}</div>
      </div>
      <div style="text-align:right;font-family:var(--mono)">
        <div style="font-weight:700;color:${color}">${ratio}%</div>
        <div style="font-size:10px;color:var(--text3)">of rep. cost</div>
      </div>
    </div>`;
  }).join('');
}

// ── Revenue summary with date range ──────────────────────────────────────────
export async function loadRevenueSummary(startDate, endDate) {
  const revEl = document.getElementById('revenue-summary-content');
  if (!revEl) return;
  revEl.innerHTML = `<div style="color:var(--text3);font-size:12px">Loading…</div>`;
  try {
    const data = await rpc('getRevenueSummaryReport', startDate, endDate);
    if (!data) { revEl.innerHTML = emptyState('◌', 'No data for period'); return; }
    revEl.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px">
        ${[
          ['Total Revenue', fmtCur(data.totalRevenue||0), 'var(--accent)'],
          ['Job Count', data.jobCount||0, 'var(--info)'],
          ['Avg Job Value', fmtCur(data.avgJobValue||0), 'var(--ok)'],
        ].map(([l,v,c])=>`<div style="background:var(--surface2);border-radius:6px;padding:10px;text-align:center">
          <div style="font-size:9px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;margin-bottom:4px">${l}</div>
          <div style="font-size:16px;font-weight:700;color:${c};font-family:var(--mono)">${v}</div>
        </div>`).join('')}
      </div>
      ${(data.byCategory||[]).length ? `
      <div style="font-size:11px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;margin-bottom:6px">By Category</div>
      ${data.byCategory.slice(0,6).map(c=>`
        <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px">
          <span>${esc(c.category||'—')}</span>
          <span style="font-family:var(--mono)">${fmtCur(c.revenue||0)}</span>
        </div>`).join('')}` : ''}`;
  } catch(e) { revEl.innerHTML = `<div style="color:var(--danger);font-size:12px">${esc(e.message)}</div>`; }
}

// ── Executive summary report ──────────────────────────────────────────────────
export async function generateExecutiveReport() {
  showLoading('Generating executive report…');
  try {
    const report = await rpc('getExecutiveSummaryReport');
    hideLoading();
    const win = window.open('', '_blank');
    if (!win) { toast('Allow pop-ups to view report', 'warn'); return; }
    const kpis = report.kpis || {};
    win.document.write(`<!DOCTYPE html><html><head>
      <title>MAV Hire — Executive Summary</title>
      <style>
        body{font-family:system-ui,sans-serif;max-width:900px;margin:40px auto;padding:0 20px;color:#1a1a2e}
        h1{font-size:28px;font-weight:900;margin-bottom:4px}
        .sub{color:#666;font-size:13px;margin-bottom:24px}
        .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}
        .kpi{background:#f5f5fa;border-radius:8px;padding:14px;text-align:center}
        .kpi-v{font-size:22px;font-weight:700;color:#4a4af0}
        .kpi-l{font-size:11px;color:#666;margin-top:4px;text-transform:uppercase}
        h2{font-size:16px;font-weight:700;margin:20px 0 8px;border-bottom:2px solid #eee;padding-bottom:4px}
        .headline{font-size:14px;line-height:1.7;background:#f8f8ff;padding:14px;border-radius:6px;margin-bottom:20px}
        .alert{padding:8px 12px;border-radius:4px;margin-bottom:6px;font-size:13px}
        .alert-warn{background:#fff8e1;border-left:3px solid #f59e0b}
        @media print{body{margin:0}}
      </style>
    </head><body>
      <h1>MAV Hire — Executive Summary</h1>
      <div class="sub">Generated ${new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</div>
      ${report.headline ? `<div class="headline">${report.headline}</div>` : ''}
      <div class="kpis">
        ${[
          ['Total Revenue', '£'+(kpis.totalRevenue||0).toLocaleString('en-GB',{minimumFractionDigits:0})],
          ['Overall ROI', (kpis.overallRoiPct||0).toFixed(1)+'%'],
          ['Book Value', '£'+(kpis.totalBookValue||0).toLocaleString('en-GB',{minimumFractionDigits:0})],
          ['Maintenance Cost', '£'+(kpis.totalMaintenanceCost||0).toLocaleString('en-GB',{minimumFractionDigits:0})],
        ].map(([l,v])=>`<div class="kpi"><div class="kpi-v">${v}</div><div class="kpi-l">${l}</div></div>`).join('')}
      </div>
      ${(report.alerts||[]).length ? `
        <h2>Alerts</h2>
        ${report.alerts.slice(0,5).map(a=>`<div class="alert alert-warn">⚠ ${typeof a==='string'?a:(a.title||JSON.stringify(a))}</div>`).join('')}
      ` : ''}
      <h2>Operations</h2>
      <p>Active jobs: ${report.operations?.activeJobs??'—'} · Upcoming 7d: ${report.operations?.upcomingJobs?.length??'—'}</p>
      <h2>Finance</h2>
      <p>Total invoiced: £${((report.finance?.totalInvoiced)||0).toLocaleString()} · Outstanding: £${((report.finance?.outstandingBalance)||0).toLocaleString()}</p>
    </body></html>`);
    win.document.close();
    win.print();
    toast('Executive report opened', 'ok');
  } catch(e) { hideLoading(); toast(e.message, 'err'); }
}

// ── Analytics stat refreshes ──────────────────────────────────────────────────
export async function refreshAnalyticsStats() {
  showLoading('Refreshing stats (this may take 30–60 seconds)…');
  try {
    await Promise.all([
      rpc('refreshSkuStats').catch(()=>{}),
      rpc('refreshCategoryStats').catch(()=>{}),
      rpc('refreshSupplierStats').catch(()=>{}),
    ]);
    toast('Stats refreshed — reloading analytics…', 'ok');
    STATE.loadedPanes.delete('analytics');
    await loadAnalytics();
  } catch(e) { toast(e.message, 'err'); }
  finally { hideLoading(); }
}

// ── Category revenue breakdown ────────────────────────────────────────────────
function renderCategoryRevenue(items) {
  const el = document.getElementById('category-revenue-list');
  if (!el) return;
  if (!items.length) { el.innerHTML = emptyState('◌', 'No category data'); return; }
  const sorted = [...items].sort((a,b) => (b.revenueLifetime||0) - (a.revenueLifetime||0));
  const max = Math.max(...sorted.map(i => +i.revenueLifetime||0), 1);
  el.innerHTML = sorted.slice(0,10).map(i => {
    const pct = Math.round((+i.revenueLifetime||0)/max*100);
    const roi  = +i.roiPct||0;
    const roiColor = roi>100?'var(--ok)':roi>50?'var(--info)':'var(--warn)';
    return `<div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
        <span style="font-weight:600">${esc(i.category||'Uncategorised')}</span>
        <span>
          <span style="font-family:var(--mono);color:var(--accent)">${fmtCur(i.revenueLifetime||0)}</span>
          <span style="font-family:var(--mono);font-size:10px;color:${roiColor};margin-left:8px">ROI ${roi.toFixed(0)}%</span>
        </span>
      </div>
      <div style="height:5px;background:var(--surface3);border-radius:3px">
        <div style="height:100%;width:${pct}%;background:var(--accent);border-radius:3px"></div>
      </div>
      <div style="font-size:10px;color:var(--text3);margin-top:2px">
        ${i.skuCount||0} SKUs · ${i.hireCount||0} hires · Avg/hire ${fmtCur(i.avgRevenuePerHire||0)}
      </div>
    </div>`;
  }).join('');
}