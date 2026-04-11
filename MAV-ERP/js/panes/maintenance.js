/**
 * MAV HIRE ERP — js/panes/maintenance.js  v2.0
 * Full maintenance CRUD: detail view, start, complete with costs,
 * add parts, edit record.
 */
import { rpc }       from '../api/gas.js';
import { STATE }     from '../utils/state.js';
import { showLoading, hideLoading, toast, emptyState } from '../utils/dom.js';
import { fmtCurDec, fmtDate, esc, statusBadge } from '../utils/format.js';
import { openModal, closeModal, confirmDialog } from '../components/modal.js';
import { ensureProductsLoaded } from './inventory.js';

export async function loadMaintenance() {
  showLoading('Loading maintenance…');
  try {
    STATE.maintenance = await rpc('getMaintenanceRecords', {});
    render(STATE.maintenance);
    const el = document.getElementById('maint-subtitle');
    if (el) {
      const open = STATE.maintenance.filter(m => !['Complete','Cancelled'].includes(m.status)).length;
      el.textContent = `${STATE.maintenance.length} records · ${open} open`;
    }
  } catch(e) { toast('Maintenance failed: ' + e.message, 'err'); }
  finally { hideLoading(); }
}

export function filterMaintenance() {
  const q = (document.getElementById('maint-search')?.value || '').toLowerCase();
  const s = document.getElementById('maint-status-filter')?.value || '';
  render(STATE.maintenance.filter(m => {
    const hay = [m.maintenanceId, m.sku, m.barcode, m.technician, m.faultDescription, m.status, m.type].join(' ').toLowerCase();
    return (!q || hay.includes(q)) && (!s || m.status === s);
  }));
}

function render(records) {
  const el = document.getElementById('maint-list');
  if (!el) return;
  if (!records.length) { el.innerHTML = emptyState('⟳', 'No records found'); return; }

  el.innerHTML = `<div class="tbl-wrap"><table>
    <thead><tr>
      <th>ID</th><th>Product</th><th>Barcode</th><th>Type</th>
      <th>Status</th><th>Priority</th><th>Scheduled</th><th>Technician</th>
      <th class="right">Cost</th><th>Actions</th>
    </tr></thead>
    <tbody>${records.map(m => `<tr style="cursor:pointer" onclick="window.__openMaintDetail('${esc(m.maintenanceId)}')">
      <td class="td-id">${esc(m.maintenanceId)}</td>
      <td class="td-name">${esc(m.productName||m.sku||'—')}</td>
      <td class="td-id">${esc(m.barcode||'—')}</td>
      <td>${esc(m.type||'—')}</td>
      <td>${statusBadge(m.status)}</td>
      <td>${statusBadge(m.priority)}</td>
      <td>${fmtDate(m.scheduledDate)}</td>
      <td>${esc(m.technician||'—')}</td>
      <td class="td-num">${m.totalCost > 0 ? fmtCurDec(m.totalCost) : '—'}</td>
      <td onclick="event.stopPropagation()" style="display:flex;gap:4px;flex-wrap:wrap">
        ${m.status === 'Scheduled'
          ? `<button class="btn btn-ghost btn-sm" onclick="window.__maintStart('${esc(m.maintenanceId)}')">Start</button>`  : ''}
        ${['In Progress','Awaiting Parts'].includes(m.status)
          ? `<button class="btn btn-primary btn-sm" onclick="window.__maintComplete('${esc(m.maintenanceId)}')">Complete</button>` : ''}
        ${!['Complete','Cancelled'].includes(m.status)
          ? `<button class="btn btn-danger btn-sm" onclick="window.__maintCancel('${esc(m.maintenanceId)}')">Cancel</button>` : ''}
      </td>
    </tr>`).join('')}
    </tbody></table></div>`;
}

// ── Detail modal ──────────────────────────────────────────────────────────────
export async function openMaintDetail(maintenanceId) {
  showLoading('Loading record…');
  try {
    const record = await rpc('getMaintenanceById', maintenanceId);
    hideLoading();
    showMaintModal(record);
  } catch(e) { hideLoading(); toast(e.message, 'err'); }
}

function showMaintModal(m) {
  const parts = m.parts || [];
  const partRows = parts.map(p => `<tr>
    <td>${esc(p.partName||'—')}</td>
    <td class="td-id">${esc(p.partNumber||'—')}</td>
    <td class="td-id">${esc(p.supplier||'—')}</td>
    <td class="td-num">${p.quantity}</td>
    <td class="td-num">${fmtCurDec(p.unitCost)}</td>
    <td class="td-num">${fmtCurDec((+p.quantity||0) * (+p.unitCost||0))}</td>
  </tr>`).join('');

  const canStart    = m.status === 'Scheduled';
  const canComplete = ['In Progress','Awaiting Parts'].includes(m.status);
  const canAddPart  = !['Complete','Cancelled'].includes(m.status);
  const canCancel   = !['Complete','Cancelled'].includes(m.status);

  openModal('modal-maint-detail', `${esc(m.type)} — ${esc(m.maintenanceId)}`, `
    <div class="two-col" style="gap:12px;margin-bottom:16px">
      <div>
        <div class="detail-row"><div class="detail-label">Status</div><div class="detail-value">${statusBadge(m.status)}</div></div>
        <div class="detail-row"><div class="detail-label">Priority</div><div class="detail-value">${statusBadge(m.priority)}</div></div>
        <div class="detail-row"><div class="detail-label">Product</div><div class="detail-value">${esc(m.productName||m.sku||'—')}</div></div>
        <div class="detail-row"><div class="detail-label">Barcode</div><div class="detail-value td-id">${esc(m.barcode||'—')}</div></div>
        <div class="detail-row"><div class="detail-label">Scheduled</div><div class="detail-value">${fmtDate(m.scheduledDate)}</div></div>
        ${m.startedDate ? `<div class="detail-row"><div class="detail-label">Started</div><div class="detail-value">${fmtDate(m.startedDate)}</div></div>` : ''}
        ${m.completedDate ? `<div class="detail-row"><div class="detail-label">Completed</div><div class="detail-value">${fmtDate(m.completedDate)}</div></div>` : ''}
        <div class="detail-row"><div class="detail-label">Technician</div><div class="detail-value">${esc(m.technician||'—')}</div></div>
      </div>
      <div>
        <div class="detail-row"><div class="detail-label">Parts Cost</div><div class="detail-value">${fmtCurDec(m.partsCost)}</div></div>
        <div class="detail-row"><div class="detail-label">Labour Cost</div><div class="detail-value">${fmtCurDec(m.labourCost)}</div></div>
        <div class="detail-row"><div class="detail-label">Other Cost</div><div class="detail-value">${fmtCurDec(m.otherCost)}</div></div>
        <div class="detail-row"><div class="detail-label">Total Cost</div><div class="detail-value accent" style="font-size:15px">${fmtCurDec(m.totalCost)}</div></div>
        ${m.faultDescription ? `<div class="detail-row"><div class="detail-label">Fault</div><div class="detail-value" style="font-size:12px">${esc(m.faultDescription)}</div></div>` : ''}
        ${m.resolution ? `<div class="detail-row"><div class="detail-label">Resolution</div><div class="detail-value" style="font-size:12px">${esc(m.resolution)}</div></div>` : ''}
        ${m.notes ? `<div class="detail-row"><div class="detail-label">Notes</div><div class="detail-value" style="font-size:12px">${esc(m.notes)}</div></div>` : ''}
      </div>
    </div>

    ${parts.length ? `
      <div class="section-title" style="margin-bottom:8px">Parts Used (${parts.length})</div>
      <div class="tbl-wrap" style="margin-bottom:12px">
        <table><thead><tr><th>Part</th><th>Part No.</th><th>Supplier</th><th>Qty</th><th>Unit Cost</th><th>Total</th></tr></thead>
        <tbody>${partRows}</tbody></table>
      </div>` : ''}
  `, `
    ${canStart    ? `<button class="btn btn-ghost btn-sm" onclick="window.__maintStart('${esc(m.maintenanceId)}')">▶ Start</button>` : ''}
    ${canAddPart  ? `<button class="btn btn-ghost btn-sm" onclick="window.__maintAddPart('${esc(m.maintenanceId)}')">+ Part</button>` : ''}
    ${canAddPart  ? `<button class="btn btn-ghost btn-sm" onclick="window.__maintEditCosts('${esc(m.maintenanceId)}',${+m.partsCost||0},${+m.labourCost||0},${+m.otherCost||0})">£ Costs</button>` : ''}
    ${canComplete ? `<button class="btn btn-primary btn-sm" onclick="window.__maintComplete('${esc(m.maintenanceId)}')">✓ Complete</button>` : ''}
    ${canCancel   ? `<button class="btn btn-danger btn-sm" onclick="window.__maintCancel('${esc(m.maintenanceId)}')">✕ Cancel</button>` : ''}
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Close</button>
  `);
}

// ── Actions ───────────────────────────────────────────────────────────────────
export async function maintStart(id) {
  openModal('modal-maint-start', 'Start Maintenance', `
    <div class="form-grid cols-1">
      <div class="form-group"><label>Technician</label>
        <input type="text" id="ms-tech" placeholder="Who is doing this?"></div>
      <div class="form-group"><label>Notes</label>
        <input type="text" id="ms-notes" placeholder="Any initial notes…"></div>
    </div>`, `
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="window.__submitMaintStart('${esc(id)}')">Start</button>`);

  window.__submitMaintStart = async (mId) => {
    showLoading('Starting…'); closeModal();
    try {
      await rpc('startMaintenance', mId,
        document.getElementById('ms-tech')?.value  || '',
        document.getElementById('ms-notes')?.value || '');
      toast('Maintenance started', 'ok');
      await refreshMaintenance();
    } catch(e) { toast(e.message, 'err'); }
    finally { hideLoading(); }
  };
}

export async function maintComplete(id) {
  openModal('modal-maint-complete', 'Complete Maintenance', `
    <div class="form-grid">
      <div class="form-group"><label>Labour Cost (£)</label>
        <input type="number" id="mc-labour" value="0" step="0.01" min="0"></div>
      <div class="form-group"><label>Other Cost (£)</label>
        <input type="number" id="mc-other" value="0" step="0.01" min="0"></div>
      <div class="form-group span-2"><label>Resolution / Work Done *</label>
        <textarea id="mc-resolution" rows="3" placeholder="Describe what was done…"></textarea></div>
      <div class="form-group span-2"><label>Completion Notes</label>
        <input type="text" id="mc-notes"></div>
    </div>`, `
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="window.__submitMaintComplete('${esc(id)}')">Mark Complete</button>`);

  window.__submitMaintComplete = async (mId) => {
    const resolution = document.getElementById('mc-resolution')?.value.trim();
    if (!resolution) { toast('Resolution required', 'warn'); return; }
    showLoading('Completing…'); closeModal();
    try {
      await rpc('completeMaintenance', mId, {
        labourCost:  parseFloat(document.getElementById('mc-labour')?.value) || 0,
        otherCost:   parseFloat(document.getElementById('mc-other')?.value)  || 0,
        resolution,
        notes:       document.getElementById('mc-notes')?.value || '',
      });
      toast('Maintenance completed', 'ok');
      await refreshMaintenance();
    } catch(e) { toast(e.message, 'err'); }
    finally { hideLoading(); }
  };
}

export async function maintCancel(id) {
  const ok = await confirmDialog('Cancel maintenance record ' + id + '?');
  if (!ok) return;
  showLoading('Cancelling…'); closeModal();
  try {
    await rpc('cancelMaintenance', id, 'Cancelled by user');
    toast('Maintenance cancelled', 'ok');
    await refreshMaintenance();
  } catch(e) { toast(e.message, 'err'); }
  finally { hideLoading(); }
}

export function maintAddPart(maintenanceId) {
  openModal('modal-add-part', 'Add Part', `
    <div class="form-grid">
      <div class="form-group span-2"><label>Part Name *</label>
        <input type="text" id="ap-name" placeholder="e.g. Capacitor 100µF"></div>
      <div class="form-group"><label>Part Number</label>
        <input type="text" id="ap-number" placeholder="SKU/reference"></div>
      <div class="form-group"><label>Supplier</label>
        <input type="text" id="ap-supplier"></div>
      <div class="form-group"><label>Quantity</label>
        <input type="number" id="ap-qty" value="1" min="1"></div>
      <div class="form-group"><label>Unit Cost (£)</label>
        <input type="number" id="ap-cost" value="0" step="0.01" min="0"></div>
    </div>`, `
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="window.__submitAddPart('${esc(maintenanceId)}')">Add Part</button>`);

  window.__submitAddPart = async (mId) => {
    const name = document.getElementById('ap-name')?.value.trim();
    if (!name) { toast('Part name required', 'warn'); return; }
    showLoading('Adding part…'); closeModal();
    try {
      await rpc('addMaintenancePart', {
        maintenanceId: mId,
        partName:   name,
        partNumber: document.getElementById('ap-number')?.value || '',
        supplier:   document.getElementById('ap-supplier')?.value || '',
        quantity:   parseInt(document.getElementById('ap-qty')?.value)  || 1,
        unitCost:   parseFloat(document.getElementById('ap-cost')?.value) || 0,
      });
      toast('Part added', 'ok');
      // Reopen the detail modal with fresh data
      const record = await rpc('getMaintenanceById', mId);
      showMaintModal(record);
    } catch(e) { toast(e.message, 'err'); }
    finally { hideLoading(); }
  };
}

export function maintEditCosts(maintenanceId, partsCost, labourCost, otherCost) {
  openModal('modal-edit-costs', 'Update Costs', `
    <div class="form-grid cols-1">
      <div class="form-group"><label>Parts Cost (£) — from parts added above</label>
        <input type="number" id="ec-parts" value="${partsCost}" step="0.01" min="0" readonly style="opacity:.6"></div>
      <div class="form-group"><label>Labour Cost (£)</label>
        <input type="number" id="ec-labour" value="${labourCost}" step="0.01" min="0"></div>
      <div class="form-group"><label>Other Cost (£)</label>
        <input type="number" id="ec-other" value="${otherCost}" step="0.01" min="0"></div>
    </div>`, `
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="window.__submitEditCosts('${esc(maintenanceId)}')">Save Costs</button>`);

  window.__submitEditCosts = async (mId) => {
    showLoading('Saving…'); closeModal();
    try {
      await rpc('updateMaintenanceCosts', mId,
        parseFloat(document.getElementById('ec-parts')?.value)  || 0,
        parseFloat(document.getElementById('ec-labour')?.value) || 0,
        parseFloat(document.getElementById('ec-other')?.value)  || 0);
      toast('Costs updated', 'ok');
      const record = await rpc('getMaintenanceById', mId);
      showMaintModal(record);
    } catch(e) { toast(e.message, 'err'); }
    finally { hideLoading(); }
  };
}

// Alias for backwards compatibility (called from main.js)
export async function maintAction(action, id) {
  if (action === 'start')    return maintStart(id);
  if (action === 'complete') return maintComplete(id);
  if (action === 'cancel')   return maintCancel(id);
}

async function refreshMaintenance() {
  STATE.loadedPanes.delete('maintenance');
  STATE.loadedPanes.delete('dashboard');
  await loadMaintenance();
}

// ── New maintenance record ────────────────────────────────────────────────────
export function openNewMaintenanceModal() {
  ensureProductsLoaded().then(() => {
    const opts = STATE.products.map(p =>
      `<option value="${esc(p.productId)}">${esc(p.name)} (${esc(p.sku)})</option>`).join('');
    openModal('modal-new-maint', 'New Maintenance Record', `
      <div class="form-grid">
        <div class="form-group span-2"><label>Product *</label>
          <select id="fm-product"><option value="">— Select product —</option>${opts}</select></div>
        <div class="form-group"><label>Barcode (serialised unit)</label>
          <input type="text" id="fm-barcode" placeholder="Leave blank = all units"></div>
        <div class="form-group"><label>Type *</label>
          <select id="fm-type">
            <option>Routine Service</option><option>Repair</option><option>PAT Test</option>
            <option>Calibration</option><option>Inspection</option><option>Cleaning</option><option>Other</option>
          </select></div>
        <div class="form-group"><label>Priority</label>
          <select id="fm-priority"><option>Low</option><option selected>Normal</option><option>High</option><option>Urgent</option></select></div>
        <div class="form-group"><label>Scheduled Date</label>
          <input type="date" id="fm-date" value="${new Date().toISOString().substring(0,10)}"></div>
        <div class="form-group"><label>Technician</label>
          <input type="text" id="fm-tech"></div>
        <div class="form-group"><label>Labour Cost (£)</label>
          <input type="number" id="fm-labour" step="0.01" min="0" value="0"></div>
        <div class="form-group"><label>Estimated Cost (£)</label>
          <input type="number" id="fm-estimated" step="0.01" min="0" value="0"></div>
        <div class="form-group span-2"><label>Fault Description</label>
          <textarea id="fm-fault" rows="2"></textarea></div>
        <div class="form-group span-2"><label>Notes</label>
          <textarea id="fm-notes" rows="2"></textarea></div>
      </div>`, `
      <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
      <button class="btn btn-primary btn-sm" onclick="window.__submitNewMaintenance()">Create Record</button>`);
    window.__submitNewMaintenance = submitNewMaintenance;
  });
}

async function submitNewMaintenance() {
  const productId = document.getElementById('fm-product')?.value;
  if (!productId) { toast('Product required', 'warn'); return; }
  showLoading('Creating…'); closeModal();
  try {
    const r = await rpc('createMaintenanceRecord', {
      productId,
      barcode:          document.getElementById('fm-barcode')?.value,
      type:             document.getElementById('fm-type')?.value,
      priority:         document.getElementById('fm-priority')?.value,
      scheduledDate:    document.getElementById('fm-date')?.value,
      technician:       document.getElementById('fm-tech')?.value,
      labourCost:       parseFloat(document.getElementById('fm-labour')?.value)    || 0,
      estimatedCost:    parseFloat(document.getElementById('fm-estimated')?.value) || 0,
      faultDescription: document.getElementById('fm-fault')?.value,
      notes:            document.getElementById('fm-notes')?.value,
      status:           'Scheduled',
    });
    toast('Created: ' + r.maintenanceId, 'ok');
    STATE.loadedPanes.delete('maintenance');
    await loadMaintenance();
  } catch(e) { toast(e.message, 'err'); }
  finally { hideLoading(); }
}