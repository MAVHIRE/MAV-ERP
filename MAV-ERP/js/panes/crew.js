/**
 * MAV HIRE ERP — js/panes/crew.js
 * Crew scheduling: assign staff to jobs with roles and day rates.
 */
import { rpc }   from '../api/gas.js';
import { STATE } from '../utils/state.js';
import { showLoading, hideLoading, toast, emptyState } from '../utils/dom.js';
import { fmtCurDec, fmtDate, esc, statusBadge, exportCsv, escAttr} from '../utils/format.js';
import { openModal, closeModal } from '../components/modal.js';

const ROLES = ['Engineer','Rigger','Driver','Crew Chief','Lighting Tech','Audio Tech',
               'Stage Manager','Production Manager','Junior Crew','Other'];

export async function loadCrew() {
  showLoading('Loading crew…');
  try {
    STATE.crew = await rpc('getCrewAssignments', {});
    render(STATE.crew);
    const el = document.getElementById('crew-subtitle');
    if (el) {
      const total = STATE.crew.reduce((s,c) => s + (+c.totalFee||0), 0);
      el.textContent = `${STATE.crew.length} assignments · ${fmtCurDec(total)} total fees`;
    }
  } catch(e) { toast('Crew failed: ' + e.message, 'err'); }
  finally { hideLoading(); }
}

export function filterCrew() {
  const q = (document.getElementById('crew-search')?.value || '').toLowerCase();
  const s = document.getElementById('crew-status-filter')?.value || '';
  render((STATE.crew||[]).filter(c => {
    const hay = [c.crewId, c.staffName, c.role, c.jobName, c.status].join(' ').toLowerCase();
    return (!q || hay.includes(q)) && (!s || c.status === s);
  }));
}

function render(items) {
  const el = document.getElementById('crew-list');
  if (!el) return;
  if (!items.length) { el.innerHTML = emptyState('◎', 'No crew assignments'); return; }

  // Group by job
  const byJob = {};
  items.forEach(c => {
    if (!byJob[c.jobId]) byJob[c.jobId] = { jobName: c.jobName, jobId: c.jobId, crew: [] };
    byJob[c.jobId].crew.push(c);
  });

  el.innerHTML = Object.values(byJob).map(group => {
    const jobTotal = group.crew.reduce((s,c) => s + (+c.totalFee||0), 0);
    return `
      <div class="section" style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div class="section-title" style="cursor:pointer" onclick="window.__openJobDetail('${escAttr(group.jobId)}')">${esc(group.jobName||group.jobId)}</div>
          <div style="font-family:var(--mono);font-size:12px;color:var(--text2)">${fmtCurDec(jobTotal)} crew fees</div>
        </div>
        <div class="tbl-wrap"><table>
          <thead><tr><th>Staff</th><th>Role</th><th>Days</th><th class="right">Day Rate</th><th class="right">Total</th><th>Dates</th><th>Status</th><th></th></tr></thead>
          <tbody>${group.crew.map(c => `<tr>
            <td style="font-weight:500">${esc(c.staffName)}</td>
            <td>${esc(c.role)}</td>
            <td class="td-num">${c.days}</td>
            <td class="td-num">${fmtCurDec(c.dayRate)}</td>
            <td class="td-num" style="font-weight:600">${fmtCurDec(c.totalFee)}</td>
            <td style="font-size:11px">${fmtDate(c.startDate)}${c.endDate&&c.endDate!==c.startDate?' → '+fmtDate(c.endDate):''}</td>
            <td>${statusBadge(c.status)}</td>
            <td style="display:flex;gap:4px">
              <button class="btn btn-ghost btn-sm" onclick="window.__editCrew('${escAttr(c.crewId)}')">Edit</button>
              <button class="btn btn-danger btn-sm" onclick="window.__deleteCrew('${escAttr(c.crewId)}')">✕</button>
            </td>
          </tr>`).join('')}
          </tbody>
        </table></div>
      </div>`;
  }).join('');
}

export function openNewCrewModal(prefillJobId) {
  openCrewForm(null, prefillJobId);
}

export async function editCrew(crewId) {
  showLoading('Loading…');
  try {
    const c = await rpc('getCrewById', crewId);
    hideLoading(); openCrewForm(c);
  } catch(e) { hideLoading(); toast(e.message, 'err'); }
}

function openCrewForm(existing, prefillJobId) {
  const c = existing || {}, isEdit = !!c.crewId;
  const v = (f,fb='') => esc(c[f]!=null?c[f]:fb);
  const n = (f,fb=0) => c[f]!=null?c[f]:fb;

  const jobOpts = (STATE.jobs||[])
    .filter(j => !['Cancelled','Complete'].includes(j.status))
    .map(j => `<option value="${esc(j.jobId)}"${(c.jobId||prefillJobId)===j.jobId?' selected':''}>${esc(j.jobName||j.jobId)}</option>`)
    .join('');

  const roleOpts = ROLES.map(r => `<option${c.role===r?' selected':''}>${r}</option>`).join('');

  openModal('modal-crew-form', isEdit ? 'Edit Crew Assignment' : 'Assign Crew', `
    <div class="form-grid">
      <div class="form-group span-2"><label>Job *</label>
        <select id="cr-job"><option value="">— Select job —</option>${jobOpts}</select></div>
      <div class="form-group"><label>Staff Name *</label>
        <input type="text" id="cr-name" value="${v('staffName')}" placeholder="e.g. Ben Taylor" list="crew-suggestions">
        <datalist id="crew-suggestions"></datalist></div>
      <div class="form-group"><label>Role</label>
        <select id="cr-role">${roleOpts}</select></div>
      <div class="form-group"><label>Day Rate (£)</label>
        <input type="number" id="cr-rate" value="${n('dayRate')}" step="0.01" min="0"
          oninput="window.__crCalcTotal()"></div>
      <div class="form-group"><label>Days</label>
        <input type="number" id="cr-days" value="${n('days',1)}" min="0.5" step="0.5"
          oninput="window.__crCalcTotal()"></div>
      <div class="form-group"><label>Total Fee (£)</label>
        <input type="number" id="cr-total" value="${n('totalFee')}" step="0.01" min="0"></div>
      <div class="form-group"><label>Status</label>
        <select id="cr-status">
          ${['Assigned','Confirmed','On Site','Complete','Cancelled'].map(s =>
            `<option${c.status===s?' selected':''}>${s}</option>`).join('')}
        </select></div>
      <div class="form-group"><label>Start Date</label>
        <input type="date" id="cr-start" value="${v('startDate','').substring(0,10)}"></div>
      <div class="form-group"><label>End Date</label>
        <input type="date" id="cr-end" value="${v('endDate','').substring(0,10)}"></div>
      <div class="form-group span-2"><label>Notes</label>
        <input type="text" id="cr-notes" value="${v('notes')}"></div>
    </div>`, `
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="window.__submitCrew('${escAttr(c.crewId||'')}')">
      ${isEdit ? 'Save Changes' : 'Assign'}</button>`
  );

  // Populate crew name suggestions
  rpc('getCrewMembers').then(members => {
    const dl = document.getElementById('crew-suggestions');
    if (dl) dl.innerHTML = members.map(m => `<option value="${esc(m.staffName)}">`).join('');
  }).catch(() => {});

  window.__crCalcTotal = () => {
    const rate  = parseFloat(document.getElementById('cr-rate')?.value) || 0;
    const days  = parseFloat(document.getElementById('cr-days')?.value) || 1;
    const el    = document.getElementById('cr-total');
    if (el) el.value = (rate * days).toFixed(2);
  };

  window.__submitCrew = async (cId) => {
    const jobId = document.getElementById('cr-job')?.value;
    const name  = document.getElementById('cr-name')?.value.trim();
    if (!jobId || !name) { toast('Job and staff name required', 'warn'); return; }
    showLoading('Saving…'); closeModal();
    try {
      await rpc('saveCrewAssignment', {
        crewId:    cId || null,
        jobId,
        staffName: name,
        role:      document.getElementById('cr-role')?.value || 'Crew',
        dayRate:   parseFloat(document.getElementById('cr-rate')?.value) || 0,
        days:      parseFloat(document.getElementById('cr-days')?.value) || 1,
        totalFee:  parseFloat(document.getElementById('cr-total')?.value) || 0,
        status:    document.getElementById('cr-status')?.value || 'Assigned',
        startDate: document.getElementById('cr-start')?.value || '',
        endDate:   document.getElementById('cr-end')?.value   || '',
        notes:     document.getElementById('cr-notes')?.value  || '',
      });
      toast(isEdit ? 'Assignment saved' : 'Crew assigned', 'ok');
      await loadCrew();
    } catch(e) { toast(e.message, 'err'); }
    finally { hideLoading(); }
  };
}

export async function deleteCrew(crewId) {
  if (!confirm('Remove this crew assignment?')) return;
  showLoading('Removing…');
  try {
    await rpc('deleteCrewAssignment', crewId);
    toast('Removed', 'ok');
    await loadCrew();
  } catch(e) { toast(e.message, 'err'); }
  finally { hideLoading(); }
}


export function exportCrewCsv() {
  const rows = (STATE.crew || []).map(c => ({
    'Job ID':     c.jobId,
    'Staff Name': c.staffName || c.crewName || '',
    'Role':       c.role || '',
    'Day Rate (£)': c.dayRate || 0,
    'Days':         c.days || 0,
    'Total Fee (£)': c.totalFee || 0,
    'Status':       c.status || '',
    'Start Date':   c.startDate ? String(c.startDate).substring(0,10) : '',
    'End Date':     c.endDate   ? String(c.endDate).substring(0,10)   : '',
  }));
  exportCsv(`MAV_Crew_${new Date().toISOString().substring(0,10)}.csv`, rows);
}