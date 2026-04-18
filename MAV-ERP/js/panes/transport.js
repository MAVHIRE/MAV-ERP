/**
 * MAV HIRE ERP — transport.js
 * Vehicle register, driver assignment, delivery & collection scheduling.
 * Links to jobs — every job can have one or more transport runs.
 */
import { rpc }   from '../api/gas.js';
import { STATE } from '../utils/state.js';
import { showLoading, hideLoading, toast, emptyState } from '../utils/dom.js';
import { fmtCurDec, fmtDate, esc, statusBadge , escAttr} from '../utils/format.js';
import { openModal, closeModal } from '../components/modal.js';

let _allTransports = [];
let _vehicles      = [];

// ── Load ──────────────────────────────────────────────────────────────────────
export async function loadTransport() {
  showLoading('Loading transport schedule…');
  try {
    const [transports, vehicles] = await Promise.all([
      rpc('getAllTransports', {}),
      rpc('getVehicles'),
    ]);
    _allTransports = transports || [];
    _vehicles      = vehicles  || [];
    render(_allTransports);
    updateSubtitle();
  } catch(e) { toast('Transport failed: ' + e.message, 'err'); }
  finally { hideLoading(); }
}

function updateSubtitle() {
  const el = document.getElementById('transport-subtitle');
  if (!el) return;
  const today = new Date().toISOString().substring(0,10);
  const todayRuns = _allTransports.filter(t =>
    (t.departTime||'').substring(0,10) === today
  );
  el.textContent = `${_allTransports.length} runs · ${todayRuns.length} today · ${_vehicles.length} vehicles`;
}

// ── Render ─────────────────────────────────────────────────────────────────────
export function filterTransport() {
  const q       = (document.getElementById('transport-search')?.value || '').toLowerCase();
  const vehicle = document.getElementById('transport-vehicle-filter')?.value || '';
  const date    = document.getElementById('transport-date-filter')?.value || '';
  render(_allTransports.filter(t => {
    const hay = [t.jobId, t.vehicle, t.driver, t.notes].join(' ').toLowerCase();
    return (!q || hay.includes(q))
      && (!vehicle || t.vehicle === vehicle)
      && (!date || (t.departTime||'').startsWith(date));
  }));
}

function render(runs) {
  const el = document.getElementById('transport-list');
  if (!el) return;
  if (!runs.length) { el.innerHTML = emptyState('🚚', 'No transport runs'); return; }

  // Group by date
  const byDate = {};
  runs.forEach(t => {
    const d = (t.departTime||'').substring(0,10) || 'Unscheduled';
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(t);
  });

  const today = new Date().toISOString().substring(0,10);

  el.innerHTML = Object.entries(byDate)
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([date, dayRuns]) => {
      const isToday = date === today;
      const label   = date === 'Unscheduled' ? 'Unscheduled' :
        new Date(date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'});
      const totalCost = dayRuns.reduce((s,t) => s+(+t.cost||0), 0);
      return `
        <div style="margin-bottom:20px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <div style="font-family:var(--mono);font-size:12px;font-weight:700;
              color:${isToday?'var(--accent)':'var(--text2)'}">
              ${isToday?'⬤ TODAY — ':''}${label}</div>
            <div style="font-size:11px;color:var(--text3)">${dayRuns.length} run${dayRuns.length!==1?'s':''}</div>
            ${totalCost>0?`<div style="font-size:11px;color:var(--text3);margin-left:auto;font-family:var(--mono)">${fmtCurDec(totalCost)}</div>`:''}
          </div>
          ${dayRuns.map(t => transportCard(t)).join('')}
        </div>`;
    }).join('');
}

function transportCard(t) {
  const deptTime = t.departTime ? new Date(t.departTime).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : '—';
  const retTime  = t.returnTime ? new Date(t.returnTime).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : '—';
  const job      = (STATE.jobs||[]).find(j => j.jobId === t.jobId);
  return `
    <div style="display:flex;gap:12px;align-items:center;padding:12px 14px;
      border-radius:var(--r2);background:var(--surface);border:1px solid var(--border);
      border-left:3px solid var(--info);margin-bottom:6px;transition:background var(--trans)"
      onmouseover="this.style.background='var(--surface2)'"
      onmouseout="this.style.background='var(--surface)'">
      <!-- Times -->
      <div style="text-align:center;min-width:52px">
        <div style="font-family:var(--mono);font-size:15px;font-weight:700;line-height:1">${deptTime}</div>
        <div style="font-size:9px;color:var(--text3);text-transform:uppercase">depart</div>
        ${t.returnTime?`<div style="font-family:var(--mono);font-size:12px;color:var(--text3);margin-top:2px">${retTime}</div>`:''}
      </div>
      <!-- Vehicle + Driver -->
      <div style="width:3px;height:44px;border-radius:2px;background:var(--info);flex-shrink:0"></div>
      <div style="min-width:120px">
        <div style="font-weight:600;font-size:13px">🚚 ${esc(t.vehicle||'Vehicle TBC')}</div>
        <div style="font-size:12px;color:var(--text3)">👤 ${esc(t.driver||'Driver TBC')}</div>
        ${t.mileage>0?`<div style="font-size:10px;color:var(--text3);font-family:var(--mono)">${t.mileage} mi</div>`:''}
      </div>
      <!-- Job -->
      <div style="flex:1;min-width:0">
        ${job?`<div style="font-weight:500;font-size:13px;cursor:pointer;color:var(--info)"
          onclick="window.__openJobDetail('${escAttr(t.jobId)}')">${esc(job.jobName||t.jobId)}</div>
          <div style="font-size:11px;color:var(--text3)">${esc(job.clientName||'')}${job.venue?' · '+esc(job.venue):''}</div>
          <div style="font-size:11px;color:var(--text3)">${job.deliveryAddress?'📍 '+esc(job.deliveryAddress.address||''):''}</div>
        `:
        `<div style="font-size:12px;color:var(--text3);font-family:var(--mono)">${esc(t.jobId||'—')}</div>`}
        ${t.notes?`<div style="font-size:11px;color:var(--text3);margin-top:3px;font-style:italic">${esc(t.notes)}</div>`:''}
      </div>
      <!-- Cost + Actions -->
      <div style="text-align:right;flex-shrink:0">
        ${t.cost>0?`<div style="font-family:var(--mono);font-size:13px;color:var(--text2)">${fmtCurDec(t.cost)}</div>`:''}
        <div style="display:flex;gap:4px;margin-top:6px" onclick="event.stopPropagation()">
          <button class="btn btn-ghost btn-sm" onclick="openTransportForm('${escAttr(t.transportId)}')">✏</button>
          <button class="btn btn-danger btn-sm" onclick="window.__deleteTransport('${escAttr(t.transportId)}')">✕</button>
        </div>
      </div>
    </div>`;
}

// ── Fleet summary ─────────────────────────────────────────────────────────────
export function renderFleet() {
  const el = document.getElementById('transport-fleet');
  if (!el) return;
  if (!_vehicles.length) {
    el.innerHTML = `<div style="color:var(--text3);font-size:12px;padding:12px">
      No vehicles registered. <button class="btn btn-ghost btn-sm" onclick="window.__openVehicleManager()">+ Add Vehicle</button>
    </div>`;
    return;
  }
  const today = new Date().toISOString().substring(0,10);
  el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px">
    ${_vehicles.map(v => {
      const todayRuns = _allTransports.filter(t =>
        t.vehicle === v.name && (t.departTime||'').startsWith(today)
      );
      const busy = todayRuns.length > 0;
      return `<div style="background:var(--surface2);border-radius:8px;padding:12px;
        border-top:3px solid ${busy?'var(--warn)':'var(--ok)'}">
        <div style="font-weight:600;margin-bottom:4px">🚚 ${esc(v.name)}</div>
        <div style="font-size:11px;color:var(--text3)">${esc(v.reg||'—')} · ${esc(v.type||'Van')}</div>
        <div style="font-size:11px;margin-top:6px;color:${busy?'var(--warn)':'var(--ok)'}">
          ${busy?`${todayRuns.length} run${todayRuns.length!==1?'s':''} today`:'Available today'}
        </div>
        ${v.mot?`<div style="font-size:10px;color:var(--text3);margin-top:3px">MOT: ${esc(v.mot)}</div>`:''}
        ${v.service?`<div style="font-size:10px;color:var(--text3)">Service: ${esc(v.service)}</div>`:''}
      </div>`;
    }).join('')}
  </div>`;
}

// ── Add / edit transport run ──────────────────────────────────────────────────
export function openNewTransportModal(preJobId) {
  openTransportForm(null, preJobId);
}

async function openTransportForm(transportId, preJobId) {
  let existing = null;
  if (transportId) {
    existing = _allTransports.find(t => t.transportId === transportId);
  }
  const t = existing || {};

  // Ensure jobs loaded
  if (!STATE.jobs?.length) STATE.jobs = await rpc('getJobs', {});
  const activeJobs = STATE.jobs.filter(j =>
    !['Complete','Cancelled'].includes(j.status)
  );
  const jobOpts = activeJobs.map(j =>
    `<option value="${esc(j.jobId)}"${(t.jobId||preJobId)===j.jobId?' selected':''}>${esc(j.jobId)} · ${esc(j.jobName)} · ${esc(j.clientName)}</option>`
  ).join('');
  const vehicleOpts = _vehicles.map(v =>
    `<option value="${esc(v.name)}"${t.vehicle===v.name?' selected':''}>${esc(v.name)}${v.reg?' ('+esc(v.reg)+')':''}</option>`
  ).join('');

  // Suggest depart from job event date if new
  const suggestDepart = preJobId && !transportId ? (() => {
    const j = activeJobs.find(j=>j.jobId===preJobId);
    if (j?.startDate) return j.startDate.substring(0,10)+'T08:00';
    if (j?.eventDate) return j.eventDate.substring(0,10)+'T08:00';
    return '';
  })() : '';

  openModal('modal-transport', transportId ? 'Edit Transport Run' : 'New Transport Run', `
    <div class="form-grid">
      <div class="form-group span-2">
        <label>Job *</label>
        <select id="tr-job"><option value="">— Select job —</option>${jobOpts}</select>
      </div>
      <div class="form-group">
        <label>Vehicle *</label>
        <select id="tr-vehicle">
          <option value="">— Select vehicle —</option>
          ${vehicleOpts}
          <option value="__other__">Other / Enter manually…</option>
        </select>
      </div>
      <div class="form-group" id="tr-vehicle-manual-wrap" style="display:none">
        <label>Vehicle (manual)</label>
        <input type="text" id="tr-vehicle-manual" placeholder="e.g. Transit Van">
      </div>
      <div class="form-group">
        <label>Driver *</label>
        <input type="text" id="tr-driver" value="${esc(t.driver||'')}" placeholder="Driver name">
      </div>
      <div class="form-group">
        <label>Depart Time</label>
        <input type="datetime-local" id="tr-depart" value="${esc(t.departTime?.substring?.(0,16)||suggestDepart)}">
      </div>
      <div class="form-group">
        <label>Return Time</label>
        <input type="datetime-local" id="tr-return" value="${esc(t.returnTime?.substring?.(0,16)||'')}">
      </div>
      <div class="form-group">
        <label>Mileage</label>
        <input type="number" id="tr-mileage" value="${t.mileage||0}" min="0" step="1" placeholder="0">
      </div>
      <div class="form-group">
        <label>Transport Cost (£)</label>
        <input type="number" id="tr-cost" value="${t.cost||0}" min="0" step="0.01" placeholder="0.00">
      </div>
      <div class="form-group span-2">
        <label>Notes</label>
        <input type="text" id="tr-notes" value="${esc(t.notes||'')}" placeholder="e.g. Collect cases from storage first">
      </div>
    </div>`, `
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="window.__submitTransport('${escAttr(t.transportId||'')}')">
      ${transportId ? 'Save Changes' : 'Add Run'}</button>`
  );

  // Wire vehicle manual toggle
  document.getElementById('tr-vehicle')?.addEventListener('change', function() {
    const wrap = document.getElementById('tr-vehicle-manual-wrap');
    if (wrap) wrap.style.display = this.value === '__other__' ? '' : 'none';
  });

  window.__submitTransport = async (tid) => {
    const jobId   = document.getElementById('tr-job')?.value;
    const vSelect = document.getElementById('tr-vehicle')?.value;
    const vehicle = vSelect === '__other__'
      ? (document.getElementById('tr-vehicle-manual')?.value.trim() || '')
      : vSelect;
    const driver  = document.getElementById('tr-driver')?.value.trim();
    if (!jobId)   { toast('Select a job', 'warn'); return; }
    if (!vehicle) { toast('Select a vehicle', 'warn'); return; }
    if (!driver)  { toast('Enter driver name', 'warn'); return; }

    showLoading('Saving…'); closeModal();
    try {
      await rpc('saveJobTransport', {
        transportId:  tid || null,
        jobId,
        vehicle,
        driver,
        departTime:   document.getElementById('tr-depart')?.value   || '',
        returnTime:   document.getElementById('tr-return')?.value   || '',
        mileage:      parseInt(document.getElementById('tr-mileage')?.value, 10) || 0,
        cost:         parseFloat(document.getElementById('tr-cost')?.value)      || 0,
        notes:        document.getElementById('tr-notes')?.value    || '',
      });
      toast(tid ? 'Transport updated' : 'Transport run added', 'ok');
      await loadTransport();
    } catch(e) { toast(e.message, 'err'); }
    finally { hideLoading(); }
  };
}

export async function deleteTransport(transportId) {
  if (!confirm('Delete this transport run?')) return;
  showLoading('Deleting…');
  try {
    await rpc('deleteJobTransport', transportId);
    toast('Deleted', 'ok');
    await loadTransport();
  } catch(e) { toast(e.message, 'err'); }
  finally { hideLoading(); }
}

// ── Vehicle manager modal ──────────────────────────────────────────────────────
export function openVehicleManager() {
  const rows = _vehicles.map((v, i) => `
    <tr>
      <td><input type="text" class="vm-name" value="${esc(v.name)}" placeholder="Transit Van"
        style="padding:4px 6px;background:var(--surface2);border:1px solid var(--border);
        border-radius:4px;color:var(--text);width:100%"></td>
      <td><input type="text" class="vm-reg" value="${esc(v.reg||'')}" placeholder="AB12 CDE"
        style="padding:4px 6px;background:var(--surface2);border:1px solid var(--border);
        border-radius:4px;color:var(--text);width:100%"></td>
      <td>
        <select class="vm-type" style="padding:4px 6px;background:var(--surface2);
          border:1px solid var(--border);border-radius:4px;color:var(--text)">
          ${['Van','Truck','Car','Trailer','Other'].map(tp=>
            `<option${v.type===tp?' selected':''}>${tp}</option>`).join('')}
        </select>
      </td>
      <td><input type="text" class="vm-mot" value="${esc(v.mot||'')}" placeholder="DD/MM/YYYY"
        style="padding:4px 6px;background:var(--surface2);border:1px solid var(--border);
        border-radius:4px;color:var(--text);width:90px"></td>
      <td><button class="btn btn-danger btn-sm" onclick="this.closest('tr').remove()">✕</button></td>
    </tr>`).join('');

  openModal('modal-vehicles', 'Vehicle Register', `
    <div style="margin-bottom:10px;font-size:12px;color:var(--text3)">
      Add your vehicles. They'll appear in the transport run dropdown.
    </div>
    <div class="tbl-wrap">
      <table id="vm-table">
        <thead><tr><th>Name</th><th>Reg</th><th>Type</th><th>MOT Due</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <button class="btn btn-ghost btn-sm" style="margin-top:8px"
      onclick="window.__addVehicleRow()">+ Add Vehicle</button>`, `
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="window.__saveVehicles()">Save Fleet</button>`
  );

  window.__addVehicleRow = () => {
    const tbody = document.querySelector('#vm-table tbody');
    if (!tbody) return;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" class="vm-name" placeholder="Transit Van"
        style="padding:4px 6px;background:var(--surface2);border:1px solid var(--border);border-radius:4px;color:var(--text);width:100%"></td>
      <td><input type="text" class="vm-reg" placeholder="AB12 CDE"
        style="padding:4px 6px;background:var(--surface2);border:1px solid var(--border);border-radius:4px;color:var(--text);width:100%"></td>
      <td><select class="vm-type" style="padding:4px 6px;background:var(--surface2);border:1px solid var(--border);border-radius:4px;color:var(--text)">
        <option>Van</option><option>Truck</option><option>Car</option><option>Trailer</option><option>Other</option>
      </select></td>
      <td><input type="text" class="vm-mot" placeholder="DD/MM/YYYY"
        style="padding:4px 6px;background:var(--surface2);border:1px solid var(--border);border-radius:4px;color:var(--text);width:90px"></td>
      <td><button class="btn btn-danger btn-sm" onclick="this.closest('tr').remove()">✕</button></td>`;
    tbody.appendChild(tr);
  };

  window.__saveVehicles = async () => {
    const vehicles = [];
    document.querySelectorAll('#vm-table tbody tr').forEach(tr => {
      const name = tr.querySelector('.vm-name')?.value.trim();
      if (name) vehicles.push({
        name, reg: tr.querySelector('.vm-reg')?.value.trim() || '',
        type: tr.querySelector('.vm-type')?.value || 'Van',
        mot:  tr.querySelector('.vm-mot')?.value.trim()  || '',
      });
    });
    showLoading('Saving fleet…'); closeModal();
    try {
      await rpc('saveVehicles', vehicles);
      _vehicles = vehicles;
      toast(`${vehicles.length} vehicles saved`, 'ok');
      renderFleet();
    } catch(e) { toast(e.message, 'err'); }
    finally { hideLoading(); }
  };
}