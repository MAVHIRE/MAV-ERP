/**
 * MAV HIRE ERP — js/panes/calendar.js
 * Monthly job calendar — shows all jobs by event date, colour coded by status.
 * Click a job to open its detail modal.
 */
import { STATE } from '../utils/state.js';
import { showLoading, hideLoading, toast } from '../utils/dom.js';
import { esc, statusBadge, fmtDate, escAttr} from '../utils/format.js';
import { rpc, rpcWithFallback } from '../api/gas.js';

let _year  = new Date().getFullYear();
let _month = new Date().getMonth(); // 0-based

const STATUS_COLOR = {
  'Draft':       '#5a5a70',
  'Confirmed':   '#4db8ff',
  'Allocated':   '#9b8aff',
  'Prepping':    '#ffaa00',
  'Checked Out': '#ff8c00',
  'Live':        '#4dff91',
  'Returned':    '#4dff91',
  'Complete':    '#3a3a4a',
  'Cancelled':   '#ff4d4d',
};

export async function loadCalendar() {
  showLoading('Loading calendar…');
  try {
    const [jobs, enquiries] = await Promise.all([
      STATE.jobs.length ? Promise.resolve(STATE.jobs) : rpcWithFallback('getJobs', {}),
      STATE.enquiries?.length ? Promise.resolve(STATE.enquiries) : rpc('getEnquiries', {}).catch(() => []),
    ]);
    STATE.jobs      = jobs;
    STATE.enquiries = enquiries;
  } catch(e) {
    toast(e.message, 'err');
  } finally {
    hideLoading();
  }
  requestAnimationFrame(() => { renderCalendar(); setupPaneEvents(); });
}

export function calPrev() {
  _month--;
  if (_month < 0) { _month = 11; _year--; }
  renderCalendar();
}

export function calNext() {
  _month++;
  if (_month > 11) { _month = 0; _year++; }
  renderCalendar();
}

export function calToday() {
  _year  = new Date().getFullYear();
  _month = new Date().getMonth();
  renderCalendar();
}

function renderCalendar() {
  const el = document.getElementById('calendar-grid');
  const titleEl = document.getElementById('calendar-title');
  if (!el) return;

  const monthName = new Date(_year, _month, 1)
    .toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  if (titleEl) titleEl.textContent = monthName;

  const firstDay = new Date(_year, _month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(_year, _month + 1, 0).getDate();
  const startOffset = (firstDay + 6) % 7; // Mon=0

  // Build job map: date string → jobs[]
  const jobMap = {};
  const enqMap = {};
  const today = new Date();
  today.setHours(0,0,0,0);

  STATE.jobs.forEach(j => {
    if (j.status === 'Cancelled') return;
    const dates = [];
    if (j.eventDate) dates.push(j.eventDate.substring(0,10));
    if (j.startDate && j.startDate.substring(0,10) !== j.eventDate?.substring(0,10))
      dates.push(j.startDate.substring(0,10));
    dates.forEach(d => {
      if (!jobMap[d]) jobMap[d] = [];
      jobMap[d].push(j);
    });
  });

  // Build enquiry map: only active enquiries with an event date
  (STATE.enquiries||[]).forEach(e => {
    if (['Won','Lost','Spam'].includes(e.status)) return;
    const d = (e.eventDate||'').substring(0,10);
    if (!d || d.length < 10) return;
    if (!enqMap[d]) enqMap[d] = [];
    enqMap[d].push(e);
  });

  // Day headers
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  let html = days.map(d =>
    `<div style="text-align:center;font-family:var(--mono);font-size:10px;
                 color:var(--text3);padding:6px 0;font-weight:500">${d}</div>`
  ).join('');

  // Empty cells before month start
  for (let i = 0; i < startOffset; i++) {
    html += `<div style="min-height:90px;background:var(--surface);border-radius:var(--r);
                          opacity:.3"></div>`;
  }

  // Day cells
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${_year}-${String(_month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const jobs    = jobMap[dateStr] || [];
    const enqs    = enqMap[dateStr] || [];
    const cellDate = new Date(_year, _month, day);
    const isToday  = cellDate.getTime() === today.getTime();
    const isWeekend = ((day + startOffset - 1) % 7) >= 5;

    const jobPills = jobs.slice(0,3).map(j => {
      const color = STATUS_COLOR[j.status] || '#5a5a70';
      return `<div onclick="event.stopPropagation();window.__openJobDetail('${escAttr(j.jobId)}')"
        style="font-size:9px;padding:2px 5px;border-radius:2px;margin-bottom:2px;
               background:${color}22;border-left:2px solid ${color};
               color:var(--text2);cursor:pointer;white-space:nowrap;overflow:hidden;
               text-overflow:ellipsis;max-width:100%"
        title="${esc(j.jobName||j.jobId)} — ${esc(j.clientName||'')}">
        ${esc((j.jobName||j.jobId).substring(0,22))}
      </div>`;
    }).join('');

    const enqPills = enqs.slice(0,2).map(e => {
      const prioColor = e.priority==='High'?'#ffaa00':e.priority==='Low'?'#888':'#cc8800';
      return `<div onclick="event.stopPropagation();window.__openEnquiryDetail('${escAttr(e.enquiryId)}')"
        style="font-size:9px;padding:2px 5px;border-radius:2px;margin-bottom:2px;
               background:#ffaa0018;border-left:2px solid ${prioColor};
               color:var(--text3);cursor:pointer;white-space:nowrap;overflow:hidden;
               text-overflow:ellipsis;max-width:100%;font-style:italic"
        title="Enquiry: ${esc(e.name||'')} — ${esc(e.eventType||'')}">
        ◈ ${esc((e.name||e.enquiryId).substring(0,18))}
      </div>`;
    }).join('');

    const totalExtra = (jobs.length > 3 ? jobs.length - 3 : 0) + (enqs.length > 2 ? enqs.length - 2 : 0);
    const moreCount = totalExtra > 0 ? `<div style="font-size:9px;color:var(--text3);padding:1px 4px">+${totalExtra} more</div>` : '';

    html += `<div style="min-height:90px;background:${isWeekend?'var(--surface2)':'var(--surface)'};
                          border-radius:var(--r);padding:6px;cursor:default;
                          border:1px solid ${isToday?'var(--accent)':'var(--border)'};
                          ${isToday?'box-shadow:0 0 0 1px var(--accent)':''}"
      onclick="window.__calDayClick('${dateStr}')">
      <div style="font-family:var(--mono);font-size:11px;font-weight:${isToday?'700':'400'};
                  color:${isToday?'var(--accent)':'var(--text3)'};margin-bottom:4px">${day}</div>
      ${jobPills}${enqPills}${moreCount}
    </div>`;
  }

  el.innerHTML = html;
  updateLegend(jobMap, enqMap);
}

function updateLegend(jobMap) {
  const legendEl = document.getElementById('calendar-legend');
  if (!legendEl) return;

  const statusCount = {};
  Object.values(jobMap).forEach(jobs => {
    jobs.forEach(j => { statusCount[j.status] = (statusCount[j.status] || 0) + 1; });
  });
  const enqTotal = (STATE.enquiries||[]).filter(e =>
    !['Won','Lost','Spam'].includes(e.status) && (e.eventDate||'').length >= 10
  ).length;

  legendEl.innerHTML = Object.entries(statusCount)
    .sort((a,b) => b[1]-a[1])
    .map(([status, count]) => {
      const color = STATUS_COLOR[status] || '#5a5a70';
      return `<div style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text2)">
        <div style="width:10px;height:10px;border-radius:2px;background:${color};flex-shrink:0"></div>
        ${esc(status)} <span style="color:var(--text3)">(${count})</span>
      </div>`;
    }).join('') +
    (enqTotal > 0 ? `
    <div style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text2);margin-left:8px;padding-left:8px;border-left:1px solid var(--border)">
      <div style="width:10px;height:10px;border-radius:2px;background:#ffaa00;flex-shrink:0"></div>
      Enquiries <span style="color:var(--text3)">(${enqTotal})</span>
    </div>` : '');
}

export function calDayClick(dateStr) {
  const jobs = STATE.jobs.filter(j => {
    if (j.status === 'Cancelled') return false;
    return j.eventDate?.substring(0,10) === dateStr ||
           j.startDate?.substring(0,10) === dateStr;
  });
  if (!jobs.length) return;
  if (jobs.length === 1) { window.__openJobDetail(jobs[0].jobId); return; }

  // Multiple jobs on this day — show a picker
  const { openModal } = window;
  if (!openModal) return;

  const d = new Date(dateStr);
  const label = d.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long' });

  import('../components/modal.js').then(({ openModal, closeModal }) => {
    openModal('modal-cal-day', label, `
      <div style="display:flex;flex-direction:column;gap:8px">
        ${jobs.map(j => {
          const color = STATUS_COLOR[j.status] || '#5a5a70';
          return `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;
                               background:var(--surface2);border-radius:var(--r);cursor:pointer;
                               border-left:3px solid ${color}"
                       data-action="openJobDetail" data-id="${escAttr(j.jobId)}">
            <div style="flex:1">
              <div style="font-weight:500;font-size:13px">${esc(j.jobName||j.jobId)}</div>
              <div style="font-size:11px;color:var(--text3)">${esc(j.clientName||'')} · ${esc(j.venue||'')}</div>
            </div>
            <span class="badge badge-${j.status==='Checked Out'?'warn':j.status==='Complete'?'neutral':'info'}">${esc(j.status)}</span>
          </div>`;
        }).join('')}
      </div>`, `
      <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Close</button>`);
  });
}

// ── Week view ─────────────────────────────────────────────────────────────────
let _calView = 'month';
let _weekStart = null; // Monday of current week

export function calSetView(view) {
  _calView = view;
  document.querySelectorAll('.cal-view-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.view === view));
  if (view === 'week') {
    if (!_weekStart) {
      const today = new Date();
      const dow = (today.getDay() + 6) % 7; // Mon=0
      _weekStart = new Date(today.getTime() - dow * 86400000);
      _weekStart.setHours(0,0,0,0);
    }
    renderWeek();
  } else {
    renderCalendar();
  }
}

function renderWeek() {
  const el = document.getElementById('calendar-grid');
  const titleEl = document.getElementById('calendar-title');
  if (!el) return;

  const ws = _weekStart || new Date();
  const we = new Date(ws.getTime() + 6 * 86400000);

  if (titleEl) {
    titleEl.textContent = ws.toLocaleDateString('en-GB', { day:'numeric', month:'short' }) +
      ' – ' + we.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
  }

  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const today = new Date(); today.setHours(0,0,0,0);

  // Build job map for the week
  const jobMap = {};
  STATE.jobs.forEach(j => {
    if (j.status === 'Cancelled') return;
    // Show across full date range (startDate → endDate)
    const start = j.startDate ? new Date(j.startDate) : (j.eventDate ? new Date(j.eventDate) : null);
    const end   = j.endDate   ? new Date(j.endDate)   : start;
    if (!start) return;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().substring(0,10);
      if (!jobMap[key]) jobMap[key] = [];
      if (!jobMap[key].find(x => x.jobId === j.jobId)) jobMap[key].push(j);
    }
  });

  // Render 7-column week grid
  el.style.gridTemplateColumns = 'repeat(7,1fr)';
  let html = days.map((d, i) => {
    const date = new Date(ws.getTime() + i * 86400000);
    const isToday = date.getTime() === today.getTime();
    return `<div style="text-align:center;font-family:var(--mono);font-size:10px;
      color:${isToday?'var(--accent)':'var(--text3)'};padding:6px 0;font-weight:${isToday?'700':'400'}">
      ${d} ${date.getDate()}</div>`;
  }).join('');

  for (let i = 0; i < 7; i++) {
    const date = new Date(ws.getTime() + i * 86400000);
    const dateStr = date.toISOString().substring(0,10);
    const jobs = jobMap[dateStr] || [];
    const isToday = date.getTime() === today.getTime();
    const isWeekend = i >= 5;

    const pills = jobs.map(j => {
      const color = STATUS_COLOR[j.status] || '#5a5a70';
      return `<div data-action="openJobDetail" data-id="${escAttr(j.jobId)}"
        style="font-size:10px;padding:4px 6px;border-radius:3px;margin-bottom:3px;
          background:${color}22;border-left:3px solid ${color};
          color:var(--text);cursor:pointer;line-height:1.3"
        title="${esc(j.jobName||j.jobId)}">
        <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc((j.jobName||j.jobId).substring(0,18))}</div>
        <div style="font-size:9px;color:var(--text3)">${esc(j.clientName||'')}</div>
      </div>`;
    }).join('');

    html += `<div style="min-height:160px;background:${isWeekend?'var(--surface2)':'var(--surface)'};
      border-radius:var(--r);padding:6px;
      border:1px solid ${isToday?'var(--accent)':'var(--border)'};
      ${isToday?'box-shadow:0 0 0 1px var(--accent)':''}">
      ${pills || '<div style="font-size:10px;color:var(--text4);padding-top:8px;text-align:center">—</div>'}
    </div>`;
  }
  el.innerHTML = html;
  setupPaneEvents();
}

// Override nav functions to support week view
const _origCalPrev = calPrev;
const _origCalNext = calNext;
const _origCalToday = calToday;

// Patch calPrev/Next to handle week view
export function calPrevWeekAware() {
  if (_calView === 'week') {
    _weekStart = new Date((_weekStart||new Date()).getTime() - 7*86400000);
    renderWeek();
  } else { calPrev(); }
}
export function calNextWeekAware() {
  if (_calView === 'week') {
    _weekStart = new Date((_weekStart||new Date()).getTime() + 7*86400000);
    renderWeek();
  } else { calNext(); }
}
export function calTodayWeekAware() {
  if (_calView === 'week') {
    const t = new Date(); const dow = (t.getDay()+6)%7;
    _weekStart = new Date(t.getTime()-dow*86400000); _weekStart.setHours(0,0,0,0);
    renderWeek();
  } else { calToday(); }
}

// ── Pane-level event delegation ───────────────────────────────────────────────
// Called after render. Listens on container divs so rendered cards don't need
// individual onclick handlers — they use data-action + data-id instead.
function setupPaneEvents() {
  const containerIds = ['calendar-grid'];
  containerIds.forEach(cid => {
    const container = document.getElementById(cid);
    if (!container || container._delegated) return;
    container._delegated = true; // prevent double-binding on re-render
    container.addEventListener('click', e => {
      const el = e.target.closest('[data-action]');
      if (!el || !container.contains(el)) return;
      e.stopPropagation();
      const action = el.dataset.action;
      const id     = el.dataset.id  || '';
      switch (action) {
        case 'openJobDetail': window.__openJobDetail(id); break;
        default: break;
      }
    });
  });
}