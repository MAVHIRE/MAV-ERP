/**
 * MAV HIRE ERP — js/panes/purchaseorders.js
 * Purchase orders: raise POs to suppliers, track delivery.
 */
import { rpc }   from '../api/gas.js';
import { STATE } from '../utils/state.js';
import { showLoading, hideLoading, toast, emptyState } from '../utils/dom.js';
import { fmtCurDec, fmtDate, esc, statusBadge } from '../utils/format.js';
import { openModal, closeModal } from '../components/modal.js';

export async function loadPurchaseOrders() {
  showLoading('Loading purchase orders…');
  try {
    STATE.purchaseOrders = await rpc('getPurchaseOrders', {});
    render(STATE.purchaseOrders);
    const el = document.getElementById('po-subtitle');
    if (el) {
      const open = STATE.purchaseOrders.filter(p => !['Received','Cancelled'].includes(p.status)).length;
      el.textContent = `${STATE.purchaseOrders.length} orders · ${open} open`;
    }
  } catch(e) { toast('Purchase orders failed: ' + e.message, 'err'); }
  finally { hideLoading(); }
}

export function filterPurchaseOrders() {
  const q = (document.getElementById('po-search')?.value || '').toLowerCase();
  const s = document.getElementById('po-status-filter')?.value || '';
  render((STATE.purchaseOrders||[]).filter(p => {
    const hay = [p.poId, p.supplierName, p.status, p.notes].join(' ').toLowerCase();
    return (!q || hay.includes(q)) && (!s || p.status === s);
  }));
}

function render(orders) {
  const el = document.getElementById('po-list');
  if (!el) return;
  if (!orders.length) { el.innerHTML = emptyState('◎', 'No purchase orders'); return; }

  el.innerHTML = `<div class="tbl-wrap"><table>
    <thead><tr>
      <th>PO ID</th><th>Supplier</th><th>Status</th>
      <th>Order Date</th><th>Expected</th>
      <th class="right">Total</th><th>Actions</th>
    </tr></thead>
    <tbody>${orders.map(p => `<tr style="cursor:pointer" onclick="window.__openPODetail('${esc(p.poId)}')">
      <td class="td-id">${esc(p.poId)}</td>
      <td class="td-name">${esc(p.supplierName||'—')}</td>
      <td>${statusBadge(p.status)}</td>
      <td>${fmtDate(p.orderDate)}</td>
      <td>${fmtDate(p.expectedDate)}</td>
      <td class="td-num" style="font-weight:600">${fmtCurDec(p.totalValue)}</td>
      <td onclick="event.stopPropagation()" style="display:flex;gap:4px">
        ${p.status === 'Draft' ? `<button class="btn btn-primary btn-sm" onclick="window.__updatePOStatus('${esc(p.poId)}','Ordered')">Send Order</button>` : ''}
        ${p.status === 'Ordered' ? `<button class="btn btn-primary btn-sm" onclick="window.__updatePOStatus('${esc(p.poId)}','Received')">Mark Received</button>` : ''}
        ${!['Received','Cancelled'].includes(p.status) ? `<button class="btn btn-ghost btn-sm" onclick="window.__editPO('${esc(p.poId)}')">Edit</button>` : ''}
        ${p.status === 'Draft' ? `<button class="btn btn-danger btn-sm" onclick="window.__deletePO('${esc(p.poId)}')">✕</button>` : ''}
      </td>
    </tr>`).join('')}
    </tbody></table></div>`;
}

export async function openPODetail(poId) {
  showLoading('Loading PO…');
  try {
    const po = await rpc('getPurchaseOrderById', poId);
    hideLoading();
    showPOModal(po);
  } catch(e) { hideLoading(); toast(e.message, 'err'); }
}

function showPOModal(po) {
  const itemRows = (po.items||[]).map(i => `<tr>
    <td class="td-id">${esc(i.sku||'—')}</td>
    <td>${esc(i.productName||'—')}</td>
    <td class="td-num">${i.quantity}</td>
    <td class="td-num">${fmtCurDec(i.unitCost)}</td>
    <td class="td-num" style="font-weight:600">${fmtCurDec(i.lineTotal)}</td>
    <td class="td-num">${i.received}</td>
  </tr>`).join('');

  openModal('modal-po-detail', `PO: ${esc(po.poId)}`, `
    <div class="two-col" style="gap:12px;margin-bottom:16px">
      <div>
        <div class="detail-row"><div class="detail-label">Supplier</div><div class="detail-value">${esc(po.supplierName||'—')}</div></div>
        <div class="detail-row"><div class="detail-label">Status</div><div class="detail-value">${statusBadge(po.status)}</div></div>
        <div class="detail-row"><div class="detail-label">Order Date</div><div class="detail-value">${fmtDate(po.orderDate)}</div></div>
        <div class="detail-row"><div class="detail-label">Expected</div><div class="detail-value">${fmtDate(po.expectedDate)}</div></div>
        ${po.deliveryDate ? `<div class="detail-row"><div class="detail-label">Delivered</div><div class="detail-value ok">${fmtDate(po.deliveryDate)}</div></div>` : ''}
      </div>
      <div>
        <div class="detail-row"><div class="detail-label">Total Value</div><div class="detail-value accent" style="font-size:16px">${fmtCurDec(po.totalValue)}</div></div>
        ${po.notes ? `<div class="detail-row"><div class="detail-label">Notes</div><div class="detail-value" style="font-size:12px">${esc(po.notes)}</div></div>` : ''}
      </div>
    </div>
    ${(po.items||[]).length ? `
      <div class="section-title" style="margin-bottom:8px">Line Items</div>
      <div class="tbl-wrap">
        <table><thead><tr><th>SKU</th><th>Product</th><th>Qty</th><th>Unit Cost</th><th>Total</th><th>Received</th></tr></thead>
        <tbody>${itemRows}</tbody></table>
      </div>` : ''}`, `
    ${!['Received','Cancelled'].includes(po.status) ? `<button class="btn btn-ghost btn-sm" onclick="window.__editPO('${esc(po.poId)}')">✏ Edit</button>` : ''}
    ${po.status === 'Draft' ? `<button class="btn btn-primary btn-sm" onclick="window.__updatePOStatus('${esc(po.poId)}','Ordered')">Send Order</button>` : ''}
    ${po.status === 'Ordered' ? `<button class="btn btn-primary btn-sm" onclick="window.__updatePOStatus('${esc(po.poId)}','Received')">Mark Received</button>` : ''}
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Close</button>`
  );
}

export function openNewPOModal() { openPOForm(null); }

export async function editPO(poId) {
  showLoading('Loading PO…'); closeModal();
  try {
    const po = await rpc('getPurchaseOrderById', poId);
    hideLoading(); openPOForm(po);
  } catch(e) { hideLoading(); toast(e.message, 'err'); }
}

function openPOForm(existing) {
  const po = existing || {}, isEdit = !!po.poId;
  const v = (f,fb='') => esc(po[f]!=null?po[f]:fb);

  const supOpts = (STATE.suppliers||[])
    .map(s => `<option value="${esc(s.supplierId)}"${po.supplierId===s.supplierId?' selected':''}>${esc(s.supplierName)}</option>`)
    .join('');

  const items = po.items || [{}];

  openModal('modal-po-form', isEdit ? `Edit PO: ${esc(po.poId)}` : 'New Purchase Order', `
    <div class="form-grid" style="margin-bottom:16px">
      <div class="form-group span-2"><label>Supplier *</label>
        <select id="po-supplier"><option value="">— Select supplier —</option>${supOpts}</select></div>
      <div class="form-group"><label>Order Date</label>
        <input type="date" id="po-order-date" value="${v('orderDate','').substring(0,10)||new Date().toISOString().substring(0,10)}"></div>
      <div class="form-group"><label>Expected Delivery</label>
        <input type="date" id="po-expected-date" value="${v('expectedDate','').substring(0,10)}"></div>
      <div class="form-group span-2"><label>Notes</label>
        <input type="text" id="po-notes" value="${v('notes')}"></div>
    </div>
    <div class="section-title" style="margin-bottom:8px">Line Items</div>
    <div id="po-items">
      ${items.map((item, i) => buildPOItemRow(item, i)).join('')}
    </div>
    <button class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="window.__addPOItem()">+ Add Item</button>`, `
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="window.__submitPO('${esc(po.poId||'')}')">
      ${isEdit ? 'Save Changes' : 'Create PO'}</button>`
  );

  let rowCount = items.length;
  window.__addPOItem = () => {
    const container = document.getElementById('po-items');
    if (container) {
      const div = document.createElement('div');
      div.innerHTML = buildPOItemRow({}, rowCount++);
      container.appendChild(div.firstElementChild);
    }
  };

  window.__submitPO = async (pId) => {
    const supEl = document.getElementById('po-supplier');
    const supId = supEl?.value;
    if (!supId) { toast('Supplier required', 'warn'); return; }

    // Collect items
    const poItems = [];
    document.querySelectorAll('.po-item-row').forEach(row => {
      const productId = row.querySelector('.po-item-product')?.value;
      const qty       = parseFloat(row.querySelector('.po-item-qty')?.value) || 0;
      const cost      = parseFloat(row.querySelector('.po-item-cost')?.value) || 0;
      const name      = row.querySelector('.po-item-name')?.value || '';
      if (qty > 0) poItems.push({ productId, productName: name, quantity: qty, unitCost: cost });
    });
    if (!poItems.length) { toast('Add at least one item', 'warn'); return; }

    showLoading('Saving PO…'); closeModal();
    try {
      const r = await rpc('savePurchaseOrder', {
        poId:          pId || null,
        supplierId:    supId,
        supplierName:  supEl.options[supEl.selectedIndex]?.text || '',
        orderDate:     document.getElementById('po-order-date')?.value || '',
        expectedDate:  document.getElementById('po-expected-date')?.value || '',
        notes:         document.getElementById('po-notes')?.value || '',
        status:        po.status || 'Draft',
        items:         poItems,
      });
      toast(isEdit ? 'PO saved' : 'PO created: ' + r.poId, 'ok');
      await loadPurchaseOrders();
    } catch(e) { toast(e.message, 'err'); }
    finally { hideLoading(); }
  };
}

function buildPOItemRow(item, idx) {
  const productOpts = (STATE.products||[])
    .map(p => `<option value="${esc(p.productId)}"${item.productId===p.productId?' selected':''}>${esc(p.name)} (${esc(p.sku)})</option>`)
    .join('');
  return `<div class="po-item-row" style="display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:6px;margin-bottom:6px;align-items:center">
    <select class="po-item-product" onchange="
      const opt=this.options[this.selectedIndex];
      this.closest('.po-item-row').querySelector('.po-item-name').value=opt.text.split(' (')[0]">
      <option value="">— Select product —</option>${productOpts}
    </select>
    <input type="hidden" class="po-item-name" value="${esc(item.productName||'')}">
    <input type="number" class="po-item-qty" placeholder="Qty" value="${item.quantity||1}" min="1" step="1">
    <input type="number" class="po-item-cost" placeholder="Unit cost £" value="${item.unitCost||0}" step="0.01" min="0">
    <button class="btn btn-danger btn-sm" onclick="this.closest('.po-item-row').remove()" style="padding:4px 8px">✕</button>
  </div>`;
}

export async function updatePOStatus(poId, status) {
  if (status === 'Received' && !confirm('Mark this PO as Received? This will add stock for all items.')) return;
  showLoading('Updating…'); closeModal();
  try {
    await rpc('updatePOStatus', poId, status);
    toast('PO ' + status.toLowerCase(), 'ok');
    await loadPurchaseOrders();
  } catch(e) { toast(e.message, 'err'); }
  finally { hideLoading(); }
}

export async function deletePO(poId) {
  if (!confirm('Delete this purchase order?')) return;
  showLoading('Deleting…');
  try {
    await rpc('deletePurchaseOrder', poId);
    toast('Deleted', 'ok');
    await loadPurchaseOrders();
  } catch(e) { toast(e.message, 'err'); }
  finally { hideLoading(); }
}