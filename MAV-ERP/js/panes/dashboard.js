/**
 * MAV HIRE ERP — dashboard.js  v2.0
 * Live KPIs, Chart.js revenue timeline, utilisation rings,
 * upcoming jobs timeline, real-time alerts, activity feed.
 */
import { rpc }    from '../api/gas.js';
import { STATE }  from '../utils/state.js';
import { showLoading, hideLoading, toast, setValue, emptyState } from '../utils/dom.js';
import { fmtCur, fmtCurDec, fmtDate, esc, statusBadge } from '../utils/format.js';

let _chartRevenue = null;
let _chartUtil    = null;
let _chartStatus  = null;

export async function initDashboard() {
  showLoading('Loading dashboard…');
  try {
    const data = await rpc('getDashboardSnapshot');
    STATE.dashboard = data;
    await render(data);
    setValue('dash-ts', 'Updated ' + new Date().toLocaleTimeString('en-GB'));
  } catch(e) {
    toast('Dashboard failed: ' + e.message, 'err');
    setValue('dash-ts', '⚠ ' + e.message);
  } finally {
    hideLoading();
  }
}

async function render(d) {
  d = d || {};
  const ops = d.operations || {};
  const fin = d.finance    || {};
  const stk = d.stock      || {};
  const mnt = d.maintenance|| {};

  // KPIs with trend indicators
  renderKPIs(ops, fin, stk, mnt);

  // Load Chart.js then render all charts
  await loadChartJs();
  renderRevenueChart(fin);
  renderStatusChart(ops);
  renderUtilChart(stk);

  // Panels
  renderAlerts(d.alerts||[]);
  renderOverdue(ops.overdueReturns||[]);
  renderUpcoming(ops.upcomingJobs||[]);
  renderLowStock(stk.lowStockItems||[]);
  renderFinanceSummary(fin);
}

// ── KPIs ──────────────────────────────────────────────────────────────────────
function renderKPIs(ops, fin, stk, mnt) {
  const el = document.getElementById('dash-kpis');
  if (!el) return;

  const kpi = (label, value, sub='', color='', icon='') => `
    <div class="kpi" style="cursor:default">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
        <div class="kpi-label">${label}</div>
        ${icon?`<div style="font-size:18px;opacity:.6">${icon}</div>`:''}
      </div>
      <div class="kpi-value ${color}" style="font-size:clamp(20px,3vw,28px)">${value}</div>
      ${sub?`<div style="font-size:11px;color:var(--text3);margin-top:4px;font-family:var(--mono)">${sub}</div>`:''}
    </div>`;

  const overdueCount = ops.overdueReturnCount||0;
  const outCount     = fin.outstandingBalance||0;
  const utilPct      = stk.averageUtilisation ? Math.round(stk.averageUtilisation*100)+'%' : '—';

  el.innerHTML =
    kpi('Active Jobs',      ops.activeJobCount??'—',    (ops.checkedOutCount||0)+' checked out',   '',       '◉') +
    kpi('Revenue 30d',      fmtCur(fin.revenueLast30Days), 'vs '+fmtCur(fin.revenueLast365Days/12|0)+' avg/mo', 'accent', '£') +
    kpi('Outstanding',      fmtCur(fin.outstandingBalance), (fin.overdueInvoiceCount||0)+' invoices',  outCount>0?'warn':'', '!') +
    kpi('Overdue Returns',  overdueCount||'0',           overdueCount>0?'Requires action':'All on time', overdueCount>0?'danger':'ok','↩') +
    kpi('Fleet Utilisation',utilPct,                     (stk.lowStockCount||0)+' low stock SKUs',  '',       '▦') +
    kpi('Open Maintenance', mnt.openCount??'—',          (mnt.highPriorityCount||0)+' high priority', mnt.openCount>0?'warn':'','⟳') +
    kpi('Confirmed Pipeline',fmtCur(fin.confirmedRevenue||0), 'Accepted quotes not yet invoiced',  'ok',     '→') +
    kpi('Revenue 12m',      fmtCur(fin.revenueLast365Days),  'Gross before costs',                '',       '◈');
}

// ── Chart.js loader ───────────────────────────────────────────────────────────
function loadChartJs() {
  return new Promise(resolve => {
    if (window.Chart) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js';
    s.onload  = resolve;
    s.onerror = resolve; // fail gracefully
    document.head.appendChild(s);
  });
}

// ── Revenue chart ─────────────────────────────────────────────────────────────
function renderRevenueChart(fin) {
  const el = document.getElementById('dash-revenue-chart');
  if (!el || !window.Chart) { renderRevenueBarFallback(fin, el); return; }

  const r30  = +(fin.revenueLast30Days  || 0);
  const r90  = +(fin.revenueLast90Days  || 0);
  const r365 = +(fin.revenueLast365Days || 0);
  const out  = +(fin.outstandingBalance || 0);
  const conf = +(fin.confirmedRevenue   || 0);

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px">
      ${revStat('30 days',  r30,  'var(--info)')}
      ${revStat('90 days',  r90,  'var(--accent2)')}
      ${revStat('12 months',r365, 'var(--accent)')}
    </div>
    <div style="position:relative;height:120px"><canvas id="c-revenue"></canvas></div>
    <div style="display:flex;gap:16px;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
      <div>
        <div style="font-size:10px;color:var(--text3);font-family:var(--mono);text-transform:uppercase">Outstanding</div>
        <div style="font-size:14px;font-weight:600;color:${out>0?'var(--warn)':'var(--text2)'};font-family:var(--mono)">${fmtCur(out)}</div>
      </div>
      ${conf>0?`<div>
        <div style="font-size:10px;color:var(--text3);font-family:var(--mono);text-transform:uppercase">Pipeline</div>
        <div style="font-size:14px;font-weight:600;color:var(--ok);font-family:var(--mono)">${fmtCur(conf)}</div>
      </div>`:''}
    </div>`;

  setTimeout(() => {
    const canvas = document.getElementById('c-revenue');
    if (!canvas) return;
    if (_chartRevenue) _chartRevenue.destroy();
    const isDark = !document.documentElement.classList.contains('light');
    _chartRevenue = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: ['30d', '90d', '12m'],
        datasets: [{
          data: [r30, r90, r365],
          backgroundColor: ['rgba(77,184,255,0.7)','rgba(184,255,0,0.7)','rgba(232,255,71,0.85)'],
          borderColor:     ['#4db8ff','#b8ff00','#e8ff47'],
          borderWidth: 2, borderRadius: 4,
        }]
      },
      options: {
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false} },
        scales:{
          x:{ grid:{color:'rgba(255,255,255,0.05)'}, ticks:{color:'#9090a8',font:{size:11}} },
          y:{ grid:{color:'rgba(255,255,255,0.05)'}, ticks:{color:'#9090a8',font:{size:10},
              callback: v => '£'+Math.round(v/1000)+'k'}, beginAtZero:true }
        }
      }
    });
  }, 50);
}

function revStat(label, val, color) {
  return `<div style="text-align:center">
    <div style="font-family:var(--mono);font-size:13px;font-weight:600;color:${color}">${fmtCur(val)}</div>
    <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em">${label}</div>
  </div>`;
}

function renderRevenueBarFallback(fin, el) {
  if (!el) return;
  const r30=+(fin.revenueLast30Days||0), r90=+(fin.revenueLast90Days||0), r365=+(fin.revenueLast365Days||0);
  const max=Math.max(r30,r90,r365,1);
  const bar=(v,l,c)=>`<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:5px">
    <div style="font-family:var(--mono);font-size:11px;color:${c}">${fmtCur(v)}</div>
    <div style="width:100%;height:60px;background:var(--surface2);border-radius:3px;display:flex;align-items:flex-end">
      <div style="width:100%;height:${Math.round(v/max*100)}%;background:${c};border-radius:3px 3px 0 0"></div>
    </div>
    <div style="font-size:10px;color:var(--text3)">${l}</div>
  </div>`;
  el.innerHTML=`<div style="display:flex;gap:10px">${bar(r30,'30d','var(--info)')}${bar(r90,'90d','var(--accent2)')}${bar(r365,'12m','var(--accent)')}</div>`;
}

// ── Job status donut ──────────────────────────────────────────────────────────
function renderStatusChart(ops) {
  const el = document.getElementById('dash-status-chart');
  if (!el || !window.Chart) return;

  const statusCounts = ops.statusCounts || {};
  const statuses = Object.keys(statusCounts).filter(s=>statusCounts[s]>0);
  if (!statuses.length) { el.innerHTML = emptyState('◉','No jobs'); return; }

  const colors = {
    'Draft':'#5a5a70','Confirmed':'#4db8ff','Allocated':'#9b8aff','Prepping':'#ffaa00',
    'Checked Out':'#ff8c00','Live':'#4dff91','Returned':'#4dff91','Complete':'#3a3a4a','Cancelled':'#ff4d4d'
  };

  el.innerHTML = `<div style="position:relative;height:140px"><canvas id="c-status"></canvas></div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">
      ${statuses.map(s=>`<div style="display:flex;align-items:center;gap:4px;font-size:10px;color:var(--text2)">
        <div style="width:8px;height:8px;border-radius:50%;background:${colors[s]||'#888'}"></div>
        ${s} (${statusCounts[s]})
      </div>`).join('')}
    </div>`;

  setTimeout(() => {
    const canvas = document.getElementById('c-status');
    if (!canvas) return;
    if (_chartStatus) _chartStatus.destroy();
    _chartStatus = new Chart(canvas, {
      type:'doughnut',
      data:{
        labels: statuses,
        datasets:[{ data:statuses.map(s=>statusCounts[s]), backgroundColor:statuses.map(s=>colors[s]||'#888'),
          borderWidth:2, borderColor:'#141418' }]
      },
      options:{ responsive:true,maintainAspectRatio:false,
        plugins:{ legend:{display:false},
          tooltip:{ callbacks:{ label: ctx=>`${ctx.label}: ${ctx.parsed} jobs` } } },
        cutout:'65%'
      }
    });
  }, 50);
}

// ── Utilisation ring ──────────────────────────────────────────────────────────
function renderUtilChart(stk) {
  const el = document.getElementById('dash-util-chart');
  if (!el || !window.Chart) return;

  const pct = Math.min(100, Math.round((stk.averageUtilisation||0)*100));
  const color = pct>80?'#4dff91':pct>50?'#e8ff47':'#ff8c00';

  el.innerHTML = `<div style="position:relative;height:120px;width:120px;margin:0 auto"><canvas id="c-util"></canvas>
    <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column">
      <div style="font-family:var(--mono);font-size:22px;font-weight:700;color:${color}">${pct}%</div>
      <div style="font-size:9px;color:var(--text3);text-transform:uppercase">utilisation</div>
    </div>
  </div>
  <div style="margin-top:8px;font-size:11px;color:var(--text3);text-align:center">
    ${stk.totalBarcodes||0} units tracked · ${stk.lowStockCount||0} low stock
  </div>`;

  setTimeout(() => {
    const canvas = document.getElementById('c-util');
    if (!canvas) return;
    if (_chartUtil) _chartUtil.destroy();
    _chartUtil = new Chart(canvas, {
      type:'doughnut',
      data:{ datasets:[{
        data:[pct, 100-pct],
        backgroundColor:[color,'rgba(255,255,255,0.05)'],
        borderWidth:0, circumference:360
      }]},
      options:{ responsive:true,maintainAspectRatio:false,
        plugins:{legend:{display:false},tooltip:{enabled:false}}, cutout:'72%' }
    });
  }, 50);
}

// ── Finance summary ───────────────────────────────────────────────────────────
function renderFinanceSummary(fin) {
  const el = document.getElementById('dash-finance');
  if (!el) return;
  const metrics = [
    ['Total Revenue',    fmtCur(fin.totalRevenue||0),     'var(--accent)'],
    ['Revenue 30d',      fmtCur(fin.revenueLast30Days||0),'var(--info)'],
    ['Revenue 90d',      fmtCur(fin.revenueLast90Days||0),'var(--info)'],
    ['Outstanding',      fmtCur(fin.outstandingBalance||0),(fin.outstandingBalance||0)>0?'var(--warn)':'var(--ok)'],
    ['Confirmed Pipeline',fmtCur(fin.confirmedRevenue||0),'var(--ok)'],
    ['Avg Invoice',      fmtCur(fin.averageJobValue||0),  'var(--text2)'],
  ];
  el.innerHTML = metrics.map(([l,v,c])=>`
    <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:12px;color:var(--text3)">${l}</span>
      <span style="font-family:var(--mono);font-size:13px;font-weight:600;color:${c}">${v}</span>
    </div>`).join('');
}

// ── Alerts panel ──────────────────────────────────────────────────────────────
function renderAlerts(alerts) {
  const pill  = document.getElementById('alert-pill');
  const count = document.getElementById('alert-count');
  if (count) count.textContent = alerts.length;
  if (pill) {
    pill.classList.toggle('hidden', alerts.length===0);
    pill.style.cursor='pointer';
    pill.onclick=()=>document.getElementById('dash-alerts-section')?.scrollIntoView({behavior:'smooth'});
  }
  const el = document.getElementById('dash-alerts');
  if (!el) return;
  if (!alerts.length) { el.innerHTML=emptyState('✓','No alerts — all clear'); return; }
  el.innerHTML = alerts.slice(0,12).map(a=>{
    const sev    = (a.severity||'').toLowerCase();
    const color  = sev==='high'?'var(--danger)':sev==='medium'?'var(--warn)':'var(--info)';
    const onclick= a.jobId?`window.__openJobDetail('${esc(a.jobId)}')`
                  :a.maintenanceId?`window.__openMaintDetail('${esc(a.maintenanceId)}')`
                  :a.productId?`window.__switchPane('inventory')`:'';
    return `<div onclick="${onclick}" style="display:flex;gap:10px;padding:10px;border-radius:6px;
      margin-bottom:6px;background:var(--surface2);cursor:${onclick?'pointer':'default'};
      border-left:3px solid ${color};transition:background .15s"
      onmouseover="this.style.background='var(--surface3)'" onmouseout="this.style.background='var(--surface2)'">
      <div style="width:8px;height:8px;border-radius:50%;background:${color};margin-top:4px;flex-shrink:0"></div>
      <div style="flex:1">
        <div style="font-size:10px;color:var(--text3);font-family:var(--mono);margin-bottom:2px">
          ${esc(a.severity)} · ${esc(a.category)}</div>
        <div style="font-size:12px;color:var(--text2)">${esc(a.message)}</div>
      </div>
      ${onclick?'<div style="color:var(--text3);font-size:11px;align-self:center">→</div>':''}
    </div>`;
  }).join('');
}

// ── Overdue returns ───────────────────────────────────────────────────────────
function renderOverdue(jobs) {
  const el = document.getElementById('dash-overdue');
  if (!el) return;
  if (!jobs.length) { el.innerHTML=emptyState('✓','No overdue returns'); return; }
  el.innerHTML = jobs.map(j=>`
    <div onclick="window.__openJobDetail('${esc(j.jobId)}')"
      style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;
      border-radius:6px;background:var(--surface2);margin-bottom:6px;cursor:pointer;
      border-left:3px solid var(--danger);transition:background .15s"
      onmouseover="this.style.background='var(--surface3)'" onmouseout="this.style.background='var(--surface2)'">
      <div>
        <div style="font-weight:600;font-size:13px">${esc(j.jobName||j.jobId)}</div>
        <div style="font-size:11px;color:var(--text3)">${esc(j.clientName)} ${j.venue?'· '+esc(j.venue):''}</div>
      </div>
      <div style="text-align:right">
        <div style="font-family:var(--mono);font-size:13px;color:var(--danger);font-weight:700">${j.daysOverdue}d overdue</div>
        <div style="font-size:11px;color:var(--text3)">${fmtCur(j.total)}</div>
      </div>
    </div>`).join('');
}

// ── Upcoming jobs timeline ────────────────────────────────────────────────────
function renderUpcoming(jobs) {
  const el = document.getElementById('dash-upcoming');
  if (!el) return;
  if (!jobs.length) { el.innerHTML=emptyState('◌','No upcoming jobs'); return; }

  const today = new Date(); today.setHours(0,0,0,0);
  const statusColors = {
    'Confirmed':'#4db8ff','Allocated':'#9b8aff','Prepping':'#ffaa00',
    'Checked Out':'#ff8c00','Draft':'#5a5a70'
  };

  el.innerHTML = jobs.map(j=>{
    const evDate = new Date(j.eventDate||j.startDate||'');
    const daysAway = isNaN(evDate)?'?':Math.ceil((evDate-today)/86400000);
    const urgency  = typeof daysAway==='number'&&daysAway<=3?'var(--danger)':daysAway<=7?'var(--warn)':'var(--text3)';
    const color    = statusColors[j.status]||'#5a5a70';
    return `<div onclick="window.__openJobDetail('${esc(j.jobId)}')"
      style="display:flex;gap:12px;align-items:center;padding:10px 12px;border-radius:6px;
      background:var(--surface2);margin-bottom:6px;cursor:pointer;transition:background .15s"
      onmouseover="this.style.background='var(--surface3)'" onmouseout="this.style.background='var(--surface2)'">
      <div style="text-align:center;min-width:40px">
        <div style="font-family:var(--mono);font-size:18px;font-weight:700;color:${urgency};line-height:1">${daysAway}</div>
        <div style="font-size:9px;color:var(--text3);text-transform:uppercase">days</div>
      </div>
      <div style="width:3px;height:36px;border-radius:2px;background:${color};flex-shrink:0"></div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(j.jobName||j.jobId)}</div>
        <div style="font-size:11px;color:var(--text3)">${esc(j.clientName)} · ${fmtDate(j.eventDate||j.startDate)}</div>
      </div>
      <div>${statusBadge(j.status)}</div>
    </div>`;
  }).join('');
}

// ── Low stock ─────────────────────────────────────────────────────────────────
function renderLowStock(items) {
  const el = document.getElementById('dash-lowstock');
  if (!el) return;
  if (!items.length) { el.innerHTML=emptyState('✓','All products adequately stocked'); return; }
  el.innerHTML = items.map(p=>{
    const pct = p.minStockLevel>0?Math.round(p.qtyAvailable/p.minStockLevel*100):100;
    const barColor = pct<30?'var(--danger)':pct<70?'var(--warn)':'var(--ok)';
    return `<div onclick="window.__openProductDetail('${esc(p.productId)}')"
      style="padding:8px 12px;border-radius:6px;background:var(--surface2);margin-bottom:6px;cursor:pointer;transition:background .15s"
      onmouseover="this.style.background='var(--surface3)'" onmouseout="this.style.background='var(--surface2)'">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
        <div>
          <div style="font-weight:500;font-size:12px">${esc(p.name)}</div>
          <div style="font-size:10px;color:var(--text3);font-family:var(--mono)">${esc(p.sku)}</div>
        </div>
        <div style="text-align:right">
          <div style="font-family:var(--mono);font-size:13px;font-weight:700;color:${barColor}">${p.qtyAvailable??0}</div>
          <div style="font-size:10px;color:var(--text3)">min ${p.minStockLevel}</div>
        </div>
      </div>
      <div style="height:3px;background:var(--surface3);border-radius:2px">
        <div style="height:100%;width:${Math.min(100,pct)}%;background:${barColor};border-radius:2px"></div>
      </div>
    </div>`;
  }).join('');
}