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
    const [skuStats, snapshot] = await Promise.all([
      rpc('getSkuStats'),
      rpc('getExecutiveAnalyticsSnapshot'),
    ]);
    STATE.skuStats = skuStats;
    await loadChartJs();
    render(skuStats, snapshot);
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

function render(skuStats, snapshot) {
  const totals = snapshot?.totals || {};
  renderKPIs(totals, skuStats);
  renderRevenueBySkuChart(skuStats);
  renderCategoryChart(snapshot);
  renderROIChart(skuStats);
  renderAbcTable(skuStats);
  renderDeadStock(snapshot?.deadStock||[]);
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