/**
 * MAV HIRE ERP — js/panes/storage.js
 * Warehouse Zone→Bay→Shelf→Bin management.
 * Barcode location assignment. Pick list generation. Occupancy view.
 */
import { rpc }   from '../api/gas.js';
import { STATE } from '../utils/state.js';
import { showLoading, hideLoading, toast, emptyState } from '../utils/dom.js';
import { esc, statusBadge, fmtDate, escAttr} from '../utils/format.js';
import { openModal, closeModal, confirmDialog } from '../components/modal.js';

// ── Main load ─────────────────────────────────────────────────────────────────
export async function loadStorage() {
  showLoading('Loading warehouse…');
  try {
    const [tree, occupancy, unlocated] = await Promise.all([
      rpc('getWarehouseLocationTree'),
      rpc('getLocationOccupancy'),
      rpc('getUnlocatedBarcodes'),
    ]);
    renderTree(tree, occupancy);
    renderUnlocated(unlocated);
    renderOccupancy(occupancy);
    const el = document.getElementById('storage-subtitle');
    if (el) el.textContent = occupancy.length + ' locations';
  } catch(e) { toast('Storage failed: ' + e.message, 'err'); }
  finally { hideLoading(); }
}

// ── Tree view ─────────────────────────────────────────────────────────────────
function renderTree(tree, occupancy) {
  const el = document.getElementById('warehouse-tree');
  if (!el) return;
  if (!tree.length) { el.innerHTML = emptyState('▦', 'No locations configured — click Seed Warehouse to create the default structure'); return; }

  const occMap = {};
  occupancy.forEach(o => { occMap[o.locationId] = o; });

  el.innerHTML = tree.map(zone => `
    <div class="card" style="margin-bottom:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="font-family:var(--head);font-weight:700;font-size:16px;letter-spacing:.04em">
          Zone ${esc(zone.zone)} <span style="color:var(--text3);font-size:13px;font-family:var(--body)">${esc(zone.description||'')}</span>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="window.__addLocationModal('${escAttr(zone.locationId)}','Bay','${escAttr(zone.zone)}')">+ Bay</button>
      </div>
      ${(zone.bays||[]).map(bay => `
        <div style="margin-left:16px;margin-bottom:8px;border-left:2px solid var(--border);padding-left:12px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <div style="font-weight:600;color:var(--text2)">Bay ${esc(bay.bay)} ${bay.description ? `<span style="color:var(--text3);font-weight:400">· ${esc(bay.description)}</span>` : ''}</div>
            <button class="btn btn-ghost btn-sm" onclick="window.__addLocationModal('${escAttr(bay.locationId)}','Shelf','${escAttr(zone.zone)}','${escAttr(bay.bay)}')">+ Shelf</button>
          </div>
          ${(bay.shelves||[]).map(shelf => `
            <div style="margin-left:16px;margin-bottom:6px;border-left:2px solid var(--border2);padding-left:12px">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
                <div style="color:var(--text2);font-size:13px">Shelf ${esc(shelf.shelf)} ${shelf.description ? `<span style="color:var(--text3)">· ${esc(shelf.description)}</span>` : ''}</div>
                <button class="btn btn-ghost btn-sm" onclick="window.__addLocationModal('${escAttr(shelf.locationId)}','Bin','${escAttr(zone.zone)}','${escAttr(bay.bay)}','${escAttr(shelf.shelf)}')">+ Bin</button>
              </div>
              <div style="display:flex;flex-wrap:wrap;gap:6px;margin-left:8px">
                ${(shelf.bins||[]).map(bin => {
                  const occ = occMap[bin.locationId] || {};
                  const pct = occ.utilPct || 0;
                  const col = pct > 90 ? 'var(--danger)' : pct > 60 ? 'var(--warn)' : 'var(--ok)';
                  return `<div class="card-sm" style="min-width:140px;cursor:pointer" onclick="window.__viewBinContents('${escAttr(bin.locationId)}','${escAttr(bin.fullPath)}')">
                    <div style="font-family:var(--mono);font-size:11px;color:var(--text3)">Bin ${esc(bin.bin)}</div>
                    ${bin.description ? `<div style="font-size:11px;color:var(--text2)">${esc(bin.description)}</div>` : ''}
                    <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
                      <div class="progress-bar" style="flex:1"><div class="progress-fill" style="width:${pct}%;background:${col}"></div></div>
                      <span style="font-family:var(--mono);font-size:10px;color:${col}">${occ.count||0}${occ.capacity ? '/'+occ.capacity : ''}</span>
                    </div>
                  </div>`;
                }).join('')}
                ${!(shelf.bins||[]).length ? '<div style="color:var(--text3);font-size:11px;padding:4px">No bins</div>' : ''}
              </div>
            </div>`).join('')}
          ${!(bay.shelves||[]).length ? '<div style="color:var(--text3);font-size:11px;padding:4px 16px">No shelves</div>' : ''}
        </div>`).join('')}
      ${!(zone.bays||[]).length ? '<div style="color:var(--text3);font-size:12px;padding:4px">No bays</div>' : ''}
    </div>`).join('');
}

export async function viewBinContents(locationId, path) {
  showLoading('Loading…');
  try {
    const barcodes = await rpc('getBarcodesAtLocation', locationId);
    hideLoading();
    openModal('modal-bin', esc(path), `
      <div style="margin-bottom:12px;font-family:var(--mono);font-size:11px;color:var(--text3)">${barcodes.length} item${barcodes.length !== 1 ? 's' : ''} stored here</div>
      ${barcodes.length === 0 ? emptyState('▦', 'Empty') : `
        <div class="tbl-wrap"><table>
          <thead><tr><th>Barcode</th><th>Product</th><th>Serial</th><th>Status</th><th>Condition</th><th>Actions</th></tr></thead>
          <tbody>${barcodes.map(b => `<tr>
            <td class="td-id">${esc(b.barcode)}</td>
            <td>${esc(b.productName || b.productId)}</td>
            <td class="td-id">${esc(b.serialNumber||'—')}</td>
            <td>${statusBadge(b.status)}</td>
            <td>${esc(b.condition||'—')}</td>
            <td><button class="btn btn-ghost btn-sm" onclick="window.__moveBarcodeModal('${escAttr(b.barcode)}')">Move</button></td>
          </tr>`).join('')}</tbody>
        </table></div>`}
      <div style="margin-top:12px">
        <button class="btn btn-ghost btn-sm" onclick="window.__assignToBinModal('${escAttr(locationId)}','${escAttr(path)}')">+ Assign Barcode Here</button>
      </div>
    `, `<button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Close</button>`);
  } catch(e) { hideLoading(); toast(e.message, 'err'); }
}

// ── Unlocated barcodes ────────────────────────────────────────────────────────
function renderUnlocated(barcodes) {
  const el = document.getElementById('unlocated-list');
  if (!el) return;
  if (!barcodes.length) { el.innerHTML = emptyState('✓', 'All serialised stock located'); return; }
  el.innerHTML = `<div class="tbl-wrap"><table>
    <thead><tr><th>Barcode</th><th>Product</th><th>Serial</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>${barcodes.map(b => `<tr>
      <td class="td-id">${esc(b.barcode)}</td>
      <td>${esc(b.productName || b.productId)}</td>
      <td class="td-id">${esc(b.serialNumber||'—')}</td>
      <td>${statusBadge(b.status)}</td>
      <td><button class="btn btn-primary btn-sm" onclick="window.__moveBarcodeModal('${escAttr(b.barcode)}')">Assign Location</button></td>
    </tr>`).join('')}</tbody></table></div>`;
}

// ── Occupancy summary ─────────────────────────────────────────────────────────
function renderOccupancy(occupancy) {
  const el = document.getElementById('occupancy-summary');
  if (!el) return;
  const bins     = occupancy.filter(o => o.locationType === 'Bin');
  const total    = bins.reduce((s, o) => s + o.count, 0);
  const capacity = bins.filter(o => o.capacity > 0).reduce((s, o) => s + o.capacity, 0);

  el.innerHTML = `
    <div class="kpi"><div class="kpi-label">Total Locations</div><div class="kpi-value">${occupancy.length}</div></div>
    <div class="kpi"><div class="kpi-label">Items Stored</div><div class="kpi-value accent">${total}</div></div>
    <div class="kpi"><div class="kpi-label">Capacity</div><div class="kpi-value">${capacity > 0 ? capacity : '—'}</div></div>
    <div class="kpi"><div class="kpi-label">Utilisation</div><div class="kpi-value ${total/capacity > .8 ? 'warn' : ''}">${capacity > 0 ? Math.round(total/capacity*100) + '%' : '—'}</div></div>`;
}

// ── Add location modal ────────────────────────────────────────────────────────
export function openAddLocationModal(parentId, type, zone, bay, shelf) {
  openModal('modal-add-location', `Add ${type}`, `
    <div class="form-grid">
      <div class="form-group"><label>Zone *</label><input type="text" id="fl-zone" value="${esc(zone||'')}" ${type !== 'Zone' ? 'readonly' : ''}></div>
      ${type !== 'Zone' ? `<div class="form-group"><label>Bay ${type === 'Bay' ? '*' : ''}</label><input type="text" id="fl-bay" value="${esc(bay||'')}" ${type !== 'Bay' ? 'readonly' : ''}></div>` : '<div></div>'}
      ${['Shelf','Bin'].includes(type) ? `<div class="form-group"><label>Shelf ${type === 'Shelf' ? '*' : ''}</label><input type="text" id="fl-shelf" value="${esc(shelf||'')}" ${type !== 'Shelf' ? 'readonly' : ''}></div>` : '<div></div>'}
      ${type === 'Bin' ? `<div class="form-group"><label>Bin *</label><input type="text" id="fl-bin"></div>` : '<div></div>'}
      <div class="form-group span-2"><label>Description</label><input type="text" id="fl-desc" placeholder="e.g. Wireless mics"></div>
      <div class="form-group"><label>Capacity (items)</label><input type="number" id="fl-capacity" value="0" min="0"></div>
    </div>`, `
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="window.__submitAddLocation('${escAttr(parentId)}','${escAttr(type)}')">Create ${type}</button>`);

  window.__submitAddLocation = async (pId, locType) => {
    showLoading('Creating…'); closeModal();
    try {
      await rpc('saveWarehouseLocation', {
        parentId:     pId || null,
        locationType: locType,
        zone:         document.getElementById('fl-zone')?.value.trim(),
        bay:          document.getElementById('fl-bay')?.value.trim()    || '',
        shelf:        document.getElementById('fl-shelf')?.value.trim()  || '',
        bin:          document.getElementById('fl-bin')?.value.trim()    || '',
        description:  document.getElementById('fl-desc')?.value.trim(),
        capacity:     parseInt(document.getElementById('fl-capacity', 10)?.value, 10) || 0,
        active:       true,
      });
      toast(locType + ' created', 'ok');
      STATE.loadedPanes.delete('storage');
      await loadStorage();
    } catch(e) { toast(e.message, 'err'); }
    finally { hideLoading(); }
  };
}

// ── Move barcode modal ────────────────────────────────────────────────────────
export async function openMoveBarcodeModal(barcode) {
  showLoading('Loading locations…');
  try {
    const leaves = await rpc('getLeafLocations');
    hideLoading();
    const opts = leaves.map(l => `<option value="${esc(l.locationId)}">${esc(l.fullPath)}</option>`).join('');

    openModal('modal-move-barcode', `Assign Location: ${esc(barcode)}`, `
      <div class="form-grid">
        <div class="form-group span-2"><label>Location *</label>
          <select id="fm-location" style="font-family:var(--mono);font-size:12px">
            <option value="">— Select location —</option>${opts}
          </select>
        </div>
        <div class="form-group span-2"><label>Notes</label><input type="text" id="fm-notes" placeholder="e.g. Post-return check"></div>
      </div>`, `
      <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
      <button class="btn btn-primary btn-sm" onclick="window.__submitMoveBarcode('${escAttr(barcode)}')">Assign</button>`);

    window.__submitMoveBarcode = async (bc) => {
      const locId = document.getElementById('fm-location')?.value;
      if (!locId) { toast('Select a location', 'warn'); return; }
      showLoading('Assigning…'); closeModal();
      try {
        const r = await rpc('assignBarcodeLocation', bc, locId, document.getElementById('fm-notes')?.value || '');
        toast(`${bc} → ${r.fullPath}`, 'ok');
        STATE.loadedPanes.delete('storage');
        await loadStorage();
      } catch(e) { toast(e.message, 'err'); }
      finally { hideLoading(); }
    };
  } catch(e) { hideLoading(); toast(e.message, 'err'); }
}

// ── Assign to bin modal ───────────────────────────────────────────────────────
export async function openAssignToBinModal(locationId, path) {
  openModal('modal-assign-bin', `Assign to ${esc(path)}`, `
    <div class="form-group">
      <label>Barcode *</label>
      <input type="text" id="fab-barcode" placeholder="Scan or type barcode" autofocus>
    </div>
    <div class="form-group" style="margin-top:10px">
      <label>Notes</label>
      <input type="text" id="fab-notes">
    </div>`, `
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="window.__submitAssignToBin('${escAttr(locationId)}')">Assign</button>`);

  window.__submitAssignToBin = async (locId) => {
    const barcode = document.getElementById('fab-barcode')?.value.trim();
    if (!barcode) { toast('Barcode required', 'warn'); return; }
    showLoading('Assigning…'); closeModal();
    try {
      const r = await rpc('assignBarcodeLocation', barcode, locId, document.getElementById('fab-notes')?.value || '');
      toast(`${barcode} → ${r.fullPath}`, 'ok');
      STATE.loadedPanes.delete('storage');
      await loadStorage();
    } catch(e) { toast(e.message, 'err'); }
    finally { hideLoading(); }
  };
}

// ── Pick list ─────────────────────────────────────────────────────────────────
export async function openPickList(jobId) {
  showLoading('Building pick list…');
  try {
    const pick = await rpc('getPickList', jobId);
    hideLoading();

    const groupHtml = (pick.groups || []).map(g => `
      <div style="margin-bottom:16px">
        <div class="section-title" style="margin-bottom:6px">
          <span style="font-family:var(--mono);font-size:11px">${esc(g.locationPath)}</span>
        </div>
        <div class="tbl-wrap"><table>
          <thead><tr><th>Item</th><th>SKU</th><th>Barcode</th><th>Serial</th><th>Condition</th><th>✓</th></tr></thead>
          <tbody>${g.items.map(i => `<tr>
            <td class="td-name">${esc(i.name)}</td>
            <td class="td-id">${esc(i.sku)}</td>
            <td class="td-id">${esc(i.barcode || (i.isBulk ? `Bulk ×${i.qtyRequired}` : ''))}</td>
            <td class="td-id">${esc(i.serialNumber||'')}</td>
            <td>${esc(i.condition||'')}</td>
            <td><input type="checkbox" style="width:auto"></td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>`).join('');

    openModal('modal-picklist', `Pick List — ${esc(pick.jobName || pick.jobId)}`, `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div class="page-subtitle">Start: ${fmtDate(pick.startDate)} · ${pick.totalItems} items</div>
        <button class="btn btn-ghost btn-sm no-print" onclick="window.print()">🖨 Print</button>
      </div>
      ${groupHtml || emptyState('▦', 'No serialised items on this job')}
    `, `<button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Close</button>`, 'modal-lg');
  } catch(e) { hideLoading(); toast(e.message, 'err'); }
}

export async function seedWarehouse() {
  if (!confirm('Create default warehouse structure (Zones A, B, C with bays/shelves/bins)?')) return;
  showLoading('Building warehouse…');
  try {
    const r = await rpc('seedWarehouseLocations');
    toast(r.message, 'ok');
    STATE.loadedPanes.delete('storage');
    await loadStorage();
  } catch(e) { toast(e.message, 'err'); }
  finally { hideLoading(); }
}