/**
 * MAV HIRE ERP — js/panes/calendar.js
 * Monthly job calendar — shows all jobs by event date, colour coded by status.
 * Click a job to open its detail modal.
 */
import { STATE } from '../utils/state.js';
import { showLoading, hideLoading, toast } from '../utils/dom.js';
import { esc, statusBadge, fmtDate } from '../utils/format.js';
import { rpc } from '../api/gas.js';

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
  if (!STATE.jobs.length) {
    showLoading('Loading jobs…');
    try {
      STATE.jobs = await rpc('getJobs', {});
    } catch(e) {
      toast(e.message, 'err');
    } finally {
      hideLoading();
    }
  }
  // Small delay ensures pane DOM is visible before we write to it
  setTimeout(() => renderCalendar(), 10);
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
  const today = new Date();
  today.setHours(0,0,0,0);

  STATE.jobs.forEach(j => {
    if (j.status === 'Cancelled') return;
    // Show on event date and start date
    const dates = [];
    if (j.eventDate) dates.push(j.eventDate.substring(0,10));
    if (j.startDate && j.startDate.substring(0,10) !== j.eventDate?.substring(0,10))
      dates.push(j.startDate.substring(0,10));

    dates.forEach(d => {
      if (!jobMap[d]) jobMap[d] = [];
      jobMap[d].push(j);
    });
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
    const cellDate = new Date(_year, _month, day);
    const isToday  = cellDate.getTime() === today.getTime();
    const isWeekend = ((day + startOffset - 1) % 7) >= 5;

    const jobPills = jobs.slice(0,4).map(j => {
      const color = STATUS_COLOR[j.status] || '#5a5a70';
      return `<div onclick="event.stopPropagation();window.__openJobDetail('${esc(j.jobId)}')"
        style="font-size:9px;padding:2px 5px;border-radius:2px;margin-bottom:2px;
               background:${color}22;border-left:2px solid ${color};
               color:var(--text2);cursor:pointer;white-space:nowrap;overflow:hidden;
               text-overflow:ellipsis;max-width:100%"
        title="${esc(j.jobName||j.jobId)} — ${esc(j.clientName||'')}">
        ${esc((j.jobName||j.jobId).substring(0,22))}
      </div>`;
    }).join('');

    const moreCount = jobs.length > 4 ? `<div style="font-size:9px;color:var(--text3);padding:1px 4px">+${jobs.length-4} more</div>` : '';

    html += `<div style="min-height:90px;background:${isWeekend?'var(--surface2)':'var(--surface)'};
                          border-radius:var(--r);padding:6px;cursor:default;
                          border:1px solid ${isToday?'var(--accent)':'var(--border)'};
                          ${isToday?'box-shadow:0 0 0 1px var(--accent)':''}"
      onclick="window.__calDayClick('${dateStr}')">
      <div style="font-family:var(--mono);font-size:11px;font-weight:${isToday?'700':'400'};
                  color:${isToday?'var(--accent)':'var(--text3)'};margin-bottom:4px">${day}</div>
      ${jobPills}${moreCount}
    </div>`;
  }

  el.innerHTML = html;

  // Update legend
  updateLegend(jobMap);
}

function updateLegend(jobMap) {
  const legendEl = document.getElementById('calendar-legend');
  if (!legendEl) return;

  // Count jobs this month
  let total = 0;
  const statusCount = {};
  Object.values(jobMap).forEach(jobs => {
    jobs.forEach(j => {
      total++;
      statusCount[j.status] = (statusCount[j.status] || 0) + 1;
    });
  });

  legendEl.innerHTML = Object.entries(statusCount)
    .sort((a,b) => b[1]-a[1])
    .map(([status, count]) => {
      const color = STATUS_COLOR[status] || '#5a5a70';
      return `<div style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text2)">
        <div style="width:10px;height:10px;border-radius:2px;background:${color};flex-shrink:0"></div>
        ${esc(status)} <span style="color:var(--text3)">(${count})</span>
      </div>`;
    }).join('');
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
                       onclick="window.__openJobDetail('${esc(j.jobId)}')">
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