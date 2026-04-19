/**
 * MAV HIRE ERP — js/panes/subrentals.js
 * Sub-rental tracking: equipment hired from other suppliers for a job.
 */
import { rpc }   from '../api/gas.js';
import { STATE } from '../utils/state.js';
import { showLoading, hideLoading, toast, emptyState } from '../utils/dom.js';
import { fmtCurDec, fmtDate, esc, statusBadge, escAttr} from '../utils/format.js';
import { openModal, closeModal } from '../components/modal.js';

export async function loadSubRentals() {
  showLoading('Loading sub-rentals…');
  try {
    STATE.subRentals = await rpc('getSubRentals', {});
    render(STATE.subRentals);
    const el = document.getElementById('sr-subtitle');
    if (el) {
      const total = STATE.subRentals.reduce((s,r) => s + (+r.totalCost||0), 0);
      el.textContent = `${STATE.subRentals.length} items · ${fmtCurDec(total)} total cost`;
    }
  } catch(e) { toast('Sub-rentals failed: ' + e.message, 'err'); }
  finally { hideLoading(); }
}

export function filterSubRentals() {
  const q = (document.getElementById('sr-search')?.value || '').toLowerCase();
  const s = document.getElementById('sr-status-filter')?.value || '';
  render((STATE.subRentals||[]).filter(r => {
    const hay = [r.subRentalId, r.jobName, r.supplierName, r.itemName, r.status].join(' ').toLowerCase();
    return (!q || hay.includes(q)) && (!s || r.status === s);
  }));
}

function render(items) {
  const el = document.getElementById('sr-list');
  if (!el) return;
  if (!items.length) { el.innerHTML = emptyState('◎', 'No sub-rentals found'); return; }

  const total = items.reduce((s,r) => s + (+r.totalCost||0), 0);

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;padding:10px 14px;
                background:var(--surface2);border-radius:var(--r);margin-bottom:12px;font-size:13px">
      <span style="color:var(--text2)">${items.length} item${items.length!==1?'s':''}</span>
      <span style="font-family:var(--mono);font-weight:600;color:var(--warn)">${fmtCurDec(total)} total cost</span>
    </div>
    <div class="tbl-wrap"><table>
      <thead><tr>
        <th>ID</th><th>Job</th><th>Supplier</th><th>Item</th>
        <th>Qty</th><th>Rate/day</th><th>Days</th>
        <th class="right">Total</th><th>Delivery</th><th>Status</th><th>Actions</th>
      </tr></thead>
      <tbody>${items.map(r => `<tr>
        <td class="td-id">${esc(r.subRentalId)}</td>
        <td>
          <div class="td-name" style="cursor:pointer" data-action="openJobDetail" data-id="${escAttr(r.jobId)}">${esc(r.jobName||r.jobId)}</div>
          <div class="td-id">${esc(r.jobId)}</div>
        </td>
        <td>${esc(r.supplierName||'—')}</td>
        <td>${esc(r.itemName)}</td>
        <td class="td-num">${r.quantity} ${esc(r.unit)}</td>
        <td class="td-num">${fmtCurDec(r.dailyRate)}</td>
        <td class="td-num">${r.hireDays}</td>
        <td class="td-num" style="font-weight:600">${fmtCurDec(r.totalCost)}</td>
        <td>${fmtDate(r.deliveryDate)}</td>
        <td>
          <select onchange="window.__updateSubRentalStatus('${esc(r.subRentalId)}',this.value)"
            style="font-size:11px;padding:2px 6px;background:var(--surface2);
            border:1px solid var(--border);border-radius:3px;color:var(--text)">
            ${['Ordered','Confirmed','Delivered','Returned','Cancelled'].map(s =>
              `<option${r.status===s?' selected':''}>${s}</option>`).join('')}
          </select>
        </td>
        <td style="display:flex;gap:4px">
          <button class="btn btn-ghost btn-sm" data-action="editSubRental" data-id="${escAttr(r.subRentalId)}">Edit</button>
          <button class="btn btn-danger btn-sm" data-action="deleteSubRental" data-id="${escAttr(r.subRentalId)}">✕</button>
        </td>
      </tr>`).join('')}
      </tbody>
    </table></div>`;
}

// ── New / edit sub-rental ─────────────────────────────────────────────────────
export function openNewSubRentalModal(prefillJobId) {
  openSubRentalForm(null, prefillJobId);
}

export async function editSubRental(subRentalId) {
  showLoading('Loading…');
  try {
    const r = await rpc('getSubRentalById', subRentalId);
    hideLoading(); openSubRentalForm(r);
  } catch(e) { hideLoading(); toast(e.message, 'err'); }
}

function openSubRentalForm(existing, prefillJobId) {
  const r = existing || {}, isEdit = !!r.subRentalId;
  const v = (f,fb='') => esc(r[f]!=null?r[f]:fb);
  const n = (f,fb=0) => r[f]!=null?r[f]:fb;

  // Job options
  const jobOpts = (STATE.jobs||[])
    .filter(j => !['Cancelled','Complete'].includes(j.status))
    .map(j => `<option value="${esc(j.jobId)}"${(r.jobId||prefillJobId)===j.jobId?' selected':''}>${esc(j.jobName||j.jobId)}</option>`)
    .join('');

  // Supplier options
  const supOpts = (STATE.suppliers||[])
    .map(s => `<option value="${esc(s.supplierId)}"${r.supplierId===s.supplierId?' selected':''}>${esc(s.supplierName)}</option>`)
    .join('');

  openModal('modal-sr-form', isEdit ? 'Edit Sub-Rental' : 'New Sub-Rental', `
    <div class="form-grid">
      <div class="form-group span-2"><label>Job *</label>
        <select id="sr-job"><option value="">— Select job —</option>${jobOpts}</select></div>
      <div class="form-group"><label>Supplier</label>
        <select id="sr-supplier"><option value="">— Select supplier —</option>${supOpts}</select></div>
      <div class="form-group"><label>Item Name *</label>
        <input type="text" id="sr-item" value="${v('itemName')}" placeholder="e.g. Martin MAC Viper x4"></div>
      <div class="form-group"><label>Quantity</label>
        <input type="number" id="sr-qty" value="${n('quantity',1)}" min="1"></div>
      <div class="form-group"><label>Unit</label>
        <input type="text" id="sr-unit" value="${v('unit','Each')}"></div>
      <div class="form-group"><label>Daily Rate (£)</label>
        <input type="number" id="sr-rate" value="${n('dailyRate')}" step="0.01" min="0"
          oninput="window.__srCalcTotal()"></div>
      <div class="form-group"><label>Hire Days</label>
        <input type="number" id="sr-days" value="${n('hireDays',1)}" min="1"
          oninput="window.__srCalcTotal()"></div>
      <div class="form-group"><label>Total Cost (£)</label>
        <input type="number" id="sr-total" value="${n('totalCost')}" step="0.01" min="0"></div>
      <div class="form-group"><label>Delivery Date</label>
        <input type="date" id="sr-delivery" value="${v('deliveryDate','').substring(0,10)}"></div>
      <div class="form-group"><label>Return Date</label>
        <input type="date" id="sr-return" value="${v('returnDate','').substring(0,10)}"></div>
      <div class="form-group"><label>Status</label>
        <select id="sr-status">
          ${['Ordered','Confirmed','Delivered','Returned','Cancelled'].map(s =>
            `<option${r.status===s?' selected':''}>${s}</option>`).join('')}
        </select></div>
      <div class="form-group span-2"><label>Notes</label>
        <textarea id="sr-notes" rows="2">${v('notes')}</textarea></div>
    </div>`, `
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" data-action="submitSubRental" data-id="${escAttr(r.subRentalId||'')}">
      ${isEdit ? 'Save Changes' : 'Add Sub-Rental'}</button>`
  );

  window.__srCalcTotal = () => {
    const rate = parseFloat(document.getElementById('sr-rate')?.value) || 0;
    const days = parseInt(document.getElementById('sr-days', 10)?.value, 10) || 1;
    const qty  = parseInt(document.getElementById('sr-qty', 10)?.value, 10) || 1;
    const el   = document.getElementById('sr-total');
    if (el) el.value = (rate * days * qty).toFixed(2);
  };

  window.__submitSubRental = async (sId) => {
    const jobId    = document.getElementById('sr-job')?.value;
    const itemName = document.getElementById('sr-item')?.value.trim();
    if (!jobId || !itemName) { toast('Job and item name required', 'warn'); return; }
    showLoading('Saving…'); closeModal();
    try {
      const supEl = document.getElementById('sr-supplier');
      const supOpt = supEl?.options[supEl.selectedIndex];
      await rpc('saveSubRental', {
        subRentalId:  sId || null,
        jobId,
        supplierId:   supEl?.value || '',
        supplierName: supOpt?.text || '',
        itemName,
        quantity:     parseInt(document.getElementById('sr-qty', 10)?.value, 10) || 1,
        unit:         document.getElementById('sr-unit')?.value || 'Each',
        dailyRate:    parseFloat(document.getElementById('sr-rate')?.value) || 0,
        hireDays:     parseInt(document.getElementById('sr-days', 10)?.value, 10) || 1,
        totalCost:    parseFloat(document.getElementById('sr-total')?.value) || 0,
        deliveryDate: document.getElementById('sr-delivery')?.value || '',
        returnDate:   document.getElementById('sr-return')?.value   || '',
        status:       document.getElementById('sr-status')?.value   || 'Ordered',
        notes:        document.getElementById('sr-notes')?.value    || '',
      });
      toast(isEdit ? 'Sub-rental saved' : 'Sub-rental added', 'ok');
      await loadSubRentals();
    } catch(e) { toast(e.message, 'err'); }
    finally { hideLoading(); }
  };
}

export async function deleteSubRental(subRentalId) {
  if (!confirm('Delete this sub-rental?')) return;
  showLoading('Deleting…');
  try {
    await rpc('deleteSubRental', subRentalId);
    toast('Deleted', 'ok');
    await loadSubRentals();
  } catch(e) { toast(e.message, 'err'); }
  finally { hideLoading(); }
}

// ── Quick status update ───────────────────────────────────────────────────────
export async function updateSubRentalStatusFn(subRentalId, status) {
  try {
    await rpc('updateSubRentalStatus', subRentalId, status);
    toast(`Status → ${status}`, 'ok');
    STATE.loadedPanes.delete('subrentals');
    STATE.subRentals = (STATE.subRentals||[]).map(r =>
      r.subRentalId === subRentalId ? {...r, status} : r
    );
  } catch(e) { toast(e.message, 'err'); }
}

// ── Pane-level event delegation ───────────────────────────────────────────────
// Called after render. Listens on container divs so rendered cards don't need
// individual onclick handlers — they use data-action + data-id instead.
function setupPaneEvents() {
  const containerIds = ['subrentals-list'];
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
        case 'deleteSubRental': window.__deleteSubRental(id); break;
        case 'editSubRental': window.__editSubRental(id); break;
        case 'openJobDetail': window.__openJobDetail(id); break;
        default: break;
      }
    });
  });
}