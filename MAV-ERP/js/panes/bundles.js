/**
 * MAV HIRE ERP — js/panes/bundles.js
 * Bundles management: saved templates + accessories catalogue.
 * Lets users create/edit bundles and apply them to quotes/jobs.
 */
import { rpc }   from '../api/gas.js';
import { STATE } from '../utils/state.js';
import { showLoading, hideLoading, toast, emptyState } from '../utils/dom.js';
import { fmtCurDec, esc, statusBadge, escAttr} from '../utils/format.js';
import { openModal, closeModal, confirmDialog } from '../components/modal.js';

export async function loadBundles() {
  showLoading('Loading bundles…');
  try {
    STATE.bundles  = await rpc('getBundles', {});
    STATE.services = STATE.services.length ? STATE.services : await rpc('getServices', {});
    render(STATE.bundles);
    const el = document.getElementById('bundles-subtitle');
    if (el) el.textContent = STATE.bundles.length + ' bundles';
  } catch(e) { toast('Bundles failed: ' + e.message, 'err'); }
  finally { hideLoading(); }
}

export function filterBundles() {
  const q = (document.getElementById('bundles-search')?.value || '').toLowerCase();
  const f = STATE.bundles.filter(b =>
    [b.bundleId, b.bundleName, b.category, b.productGroup].join(' ').toLowerCase().includes(q)
  );
  render(f);
}

function render(bundles) {
  const el = document.getElementById('bundles-list');
  if (!el) return;
  if (!bundles.length) { el.innerHTML = emptyState('◫', 'No bundles yet'); return; }
  el.innerHTML = bundles.map(b => {
    const items   = b.items || [];
    const preview = items.slice(0, 4).map(i => esc(i.name)).join(', ');
    const more    = items.length > 4 ? ` +${items.length - 4} more` : '';
    return `<div class="bundle-card" data-action="openBundleDetail" data-id="${escAttr(b.bundleId)}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div class="bundle-name">${esc(b.bundleName)}</div>
          ${b.category ? `<div class="bundle-meta">${esc(b.productGroup || '')} · ${esc(b.category)}</div>` : ''}
          <div class="bundle-meta" style="margin-top:4px;color:var(--text3)">${preview}${more}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
          ${b.basePrice > 0 ? `<div style="font-family:var(--mono);font-size:13px;color:var(--accent)">${fmtCurDec(b.basePrice)}</div>` : ''}
          <div style="font-family:var(--mono);font-size:11px;color:var(--text3)">${items.length} items</div>
          <div style="display:flex;gap:4px">
            <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();window.__editBundle('${escAttr(b.bundleId)}')">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();window.__deleteBundle('${escAttr(b.bundleId)}')">Delete</button>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}

export async function openBundleDetail(bundleId) {
  showLoading('Loading bundle…');
  try {
    const [bundle, items] = await Promise.all([
      rpc('getBundleById', bundleId),
      rpc('getBundleItems', bundleId).catch(() => null),
    ]);
    // Merge items from dedicated call if richer
    if (items && items.length > (bundle.items||[]).length) bundle.items = items;
    hideLoading();
    showBundleModal(bundle);
  } catch(e) { hideLoading(); toast(e.message, 'err'); }
}

function showBundleModal(b) {
  const items = b.items || [];
  const itemRows = items.map(i => `<tr>
    <td class="td-id">${esc(i.itemType || 'Product')}</td>
    <td class="td-name">${esc(i.name)}</td>
    <td class="td-num">${i.quantity}</td>
    <td class="td-num">${i.unitPrice > 0 ? fmtCurDec(i.unitPrice) : 'Base rate'}</td>
    <td>${i.isAccessory ? '<span class="badge badge-neutral">Accessory</span>' : ''}</td>
    <td>${i.optional ? '<span class="badge badge-info">Optional</span>' : ''}</td>
  </tr>`).join('');

  openModal('modal-bundle-detail', esc(b.bundleName), `
    <div style="display:flex;gap:20px;margin-bottom:16px">
      <div>
        <div class="detail-row"><div class="detail-label">Bundle ID</div><div class="detail-value td-id">${esc(b.bundleId)}</div></div>
        <div class="detail-row"><div class="detail-label">Category</div><div class="detail-value">${esc(b.category || '—')}</div></div>
        <div class="detail-row"><div class="detail-label">Group</div><div class="detail-value">${esc(b.productGroup || '—')}</div></div>
        ${b.basePrice > 0 ? `<div class="detail-row"><div class="detail-label">Fixed Price</div><div class="detail-value accent">${fmtCurDec(b.basePrice)}</div></div>` : ''}
        ${b.description ? `<div class="detail-row"><div class="detail-label">Description</div><div class="detail-value">${esc(b.description)}</div></div>` : ''}
      </div>
    </div>
    <div class="section-title" style="margin-bottom:8px">Bundle Items (${items.length})</div>
    <div class="tbl-wrap">
      <table><thead><tr><th>Type</th><th>Item</th><th>Qty</th><th>Price</th><th>Accessory</th><th>Optional</th></tr></thead>
      <tbody>${itemRows || '<tr><td colspan="6" style="color:var(--text3);padding:16px">No items</td></tr>'}</tbody></table>
    </div>
  `, `
    <button class="btn btn-ghost btn-sm" data-action="editBundle" data-id="${escAttr(b.bundleId)}";window.__closeModal()">Edit</button>
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Close</button>
  `);
}

export function openNewBundleModal(existingBundle = null) {
  const b       = existingBundle || {};
  const isEdit  = !!b.bundleId;
  const items   = b.items || [];

  // Build item rows for the editor
  let bundleItemsState = items.map((i, idx) => Object.assign({}, i, { _id: idx }));

  openModal('modal-bundle-form', isEdit ? 'Edit Bundle' : 'New Bundle', buildBundleForm(b), `
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="window.__submitBundle()">Save Bundle</button>
  `, 'modal-lg');

  renderBundleItems(bundleItemsState);

  window.__addBundleItem    = () => {
    bundleItemsState.push({ _id: Date.now(), itemType: 'Product', productId: '', serviceId: '', name: '', quantity: 1, unitPrice: 0, isAccessory: false, optional: false });
    renderBundleItems(bundleItemsState);
  };
  window.__addBundleService = () => {
    bundleItemsState.push({ _id: Date.now(), itemType: 'Service', productId: '', serviceId: '', name: '', quantity: 1, unitPrice: 0, isAccessory: false, optional: false });
    renderBundleItems(bundleItemsState);
  };
  window.__removeBundleItem = (id) => {
    bundleItemsState = bundleItemsState.filter(i => i._id !== id);
    renderBundleItems(bundleItemsState);
  };
  window.__bundleItemChange = (id, field, value) => {
    const item = bundleItemsState.find(i => i._id === id);
    if (item) item[field] = value;
  };
  window.__bundleProductChange = (id) => {
    const sel     = document.getElementById('bi-prod-' + id);
    const opt     = sel?.selectedOptions[0];
    const item    = bundleItemsState.find(i => i._id === id);
    if (!opt?.value || !item) return;
    item.productId = opt.value;
    item.name      = opt.dataset.name || '';
    item.unitPrice = parseFloat(opt.dataset.price) || 0;
    const priceEl = document.getElementById('bi-price-' + id);
    if (priceEl) priceEl.value = item.unitPrice;
  };
  window.__bundleServiceChange = (id) => {
    const sel  = document.getElementById('bi-svc-' + id);
    const opt  = sel?.selectedOptions[0];
    const item = bundleItemsState.find(i => i._id === id);
    if (!opt?.value || !item) return;
    item.serviceId = opt.value;
    item.name      = opt.dataset.name || '';
    item.unitPrice = parseFloat(opt.dataset.price) || 0;
    const priceEl = document.getElementById('bi-price-' + id);
    if (priceEl) priceEl.value = item.unitPrice;
  };

  window.__submitBundle = async () => {
    const bundleName = document.getElementById('fb-bundle-name')?.value.trim();
    if (!bundleName) { toast('Bundle name required', 'warn'); return; }
    if (!bundleItemsState.length) { toast('Add at least one item', 'warn'); return; }

    showLoading('Saving bundle…'); closeModal();
    try {
      const result = await rpc('saveBundle', {
        bundleId:     b.bundleId || null,
        bundleName,
        description:  document.getElementById('fb-bundle-desc')?.value,
        category:     document.getElementById('fb-bundle-cat')?.value,
        productGroup: document.getElementById('fb-bundle-group')?.value,
        basePrice:    parseFloat(document.getElementById('fb-bundle-price')?.value) || 0,
        active:       true,
        items:        bundleItemsState.map((item, i) => ({
          itemType:    item.itemType  || 'Product',
          productId:   item.productId || '',
          serviceId:   item.serviceId || '',
          name:        item.name      || '',
          quantity:    +item.quantity || 1,
          unitPrice:   +item.unitPrice|| 0,
          isAccessory: !!item.isAccessory,
          optional:    !!item.optional,
          sortOrder:   (i + 1) * 10,
        })),
      });
      toast('Bundle saved: ' + result.bundleId, 'ok');
      STATE.loadedPanes.delete('bundles');
      await loadBundles();
    } catch(e) { toast(e.message, 'err'); }
    finally { hideLoading(); }
  };
}

export async function editBundle(bundleId) {
  showLoading('Loading bundle…');
  try {
    const bundle = await rpc('getBundleById', bundleId);
    hideLoading();
    openNewBundleModal(bundle);
  } catch(e) { hideLoading(); toast(e.message, 'err'); }
}

export async function deleteBundle(bundleId) {
  const ok = await confirmDialog('Delete bundle ' + bundleId + '? This cannot be undone.');
  if (!ok) return;
  showLoading('Deleting…');
  try {
    await rpc('deleteBundle', bundleId);
    toast('Bundle deleted', 'ok');
    STATE.loadedPanes.delete('bundles');
    await loadBundles();
  } catch(e) { toast(e.message, 'err'); }
  finally { hideLoading(); }
}

function buildBundleForm(b = {}) {
  return `<div class="form-grid" style="margin-bottom:16px">
    <div class="form-group span-2"><label>Bundle Name *</label><input type="text" id="fb-bundle-name" value="${esc(b.bundleName||'')}"></div>
    <div class="form-group"><label>Category</label><input type="text" id="fb-bundle-cat" value="${esc(b.category||'')}" placeholder="e.g. PA Systems"></div>
    <div class="form-group"><label>Product Group</label><input type="text" id="fb-bundle-group" value="${esc(b.productGroup||'')}" placeholder="e.g. Audio"></div>
    <div class="form-group"><label>Fixed Price (£) — 0 = sum of items</label><input type="number" id="fb-bundle-price" value="${b.basePrice||0}" step="0.01" min="0"></div>
    <div class="form-group span-2"><label>Description</label><textarea id="fb-bundle-desc" rows="2">${esc(b.description||'')}</textarea></div>
  </div>
  <div class="section-title" style="margin-bottom:8px">Items</div>
  <div id="bundle-items-editor"></div>
  <div style="display:flex;gap:8px;margin-top:10px">
    <button class="btn btn-ghost btn-sm" onclick="window.__addBundleItem()">+ Product</button>
    <button class="btn btn-ghost btn-sm" onclick="window.__addBundleService()">+ Service</button>
  </div>`;
}

function renderBundleItems(items) {
  const el = document.getElementById('bundle-items-editor');
  if (!el) return;

  const productOpts = (STATE.products || []).map(p =>
    `<option value="${esc(p.productId)}" data-name="${esc(p.name)}" data-price="${p.baseHireRate}">${esc(p.name)} (${esc(p.sku)})</option>`
  ).join('');
  const serviceOpts = (STATE.services || []).map(s =>
    `<option value="${esc(s.serviceId)}" data-name="${esc(s.serviceName)}" data-price="${s.defaultPrice}">${esc(s.serviceName)}</option>`
  ).join('');

  if (!items.length) { el.innerHTML = `<div style="color:var(--text3);font-size:12px;padding:12px">No items added yet</div>`; return; }

  el.innerHTML = `<div class="line-items-wrap">
    <div class="line-item-row header" style="grid-template-columns:2fr 1fr 1fr auto auto 30px">
      <div>Item</div><div>Qty</div><div>Price Override</div><div>Accessory</div><div>Optional</div><div></div>
    </div>
    ${items.map(item => {
      const isService = item.itemType === 'Service';
      return `<div class="line-item-row" style="grid-template-columns:2fr 1fr 1fr auto auto 30px" id="bi-row-${item._id}">
        <div>
          ${isService
            ? `<select id="bi-svc-${item._id}" onchange="window.__bundleServiceChange(${item._id})" style="width:100%">
                <option value="">— Service —</option>${serviceOpts}
               </select>`
            : `<select id="bi-prod-${item._id}" onchange="window.__bundleProductChange(${item._id})" style="width:100%">
                <option value="">— Product —</option>${productOpts}
               </select>`
          }
        </div>
        <input type="number" min="1" value="${item.quantity||1}" style="width:60px" onchange="window.__bundleItemChange(${item._id},'quantity',this.value)">
        <input type="number" id="bi-price-${item._id}" min="0" step="0.01" value="${item.unitPrice||0}" placeholder="0 = base rate" style="width:100px" onchange="window.__bundleItemChange(${item._id},'unitPrice',this.value)">
        <input type="checkbox" title="Accessory" ${item.isAccessory?'checked':''} onchange="window.__bundleItemChange(${item._id},'isAccessory',this.checked)">
        <input type="checkbox" title="Optional"  ${item.optional  ?'checked':''} onchange="window.__bundleItemChange(${item._id},'optional',this.checked)">
        <button class="line-item-remove" onclick="window.__removeBundleItem(${item._id})">×</button>
      </div>`;
    }).join('')}
  </div>`;

  // Re-set select values
  items.forEach(item => {
    if (item.itemType === 'Service' && item.serviceId) {
      const s = document.getElementById('bi-svc-' + item._id);
      if (s) s.value = item.serviceId;
    } else if (item.productId) {
      const p = document.getElementById('bi-prod-' + item._id);
      if (p) p.value = item.productId;
    }
  });
}

// ── Product Accessories tab ───────────────────────────────────────────────────
export async function loadAccessories() {
  showLoading('Loading accessories…');
  try {
    if (!STATE.products.length) STATE.products = await rpc('getProducts');
    // Show per-product accessory links
    const el = document.getElementById('accessories-list');
    if (!el) return;

    // Build a summary: for each product that has accessories, show them
    const withAccessories = [];
    for (const p of STATE.products.slice(0, 30)) { // limit for performance
      const links = await rpc('getProductAccessories', p.productId);
      if (links.length) withAccessories.push({ product: p, links });
    }

    if (!withAccessories.length) {
      el.innerHTML = emptyState('◎', 'No accessories configured');
      return;
    }

    el.innerHTML = withAccessories.map(({ product: p, links }) => `
      <div class="card" style="margin-bottom:10px">
        <div style="font-weight:600;margin-bottom:8px">${esc(p.name)} <span class="td-id">${esc(p.sku)}</span></div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${links.map(l => `
            <div style="display:flex;align-items:center;gap:6px;padding:4px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--r)">
              <span style="font-size:12px">${esc(l.accessoryName)}</span>
              <span class="td-id">×${l.defaultQuantity}</span>
              ${l.optional ? '<span class="badge badge-info" style="font-size:9px">optional</span>' : ''}
              <button class="line-item-remove" style="font-size:12px" data-action="deleteAccessoryLink" data-id="${escAttr(l.linkId)}" data-id2="${escAttr(p.productId)}">×</button>
            </div>`).join('')}
          <button class="btn btn-ghost btn-sm" data-action="addAccessoryModal" data-id="${escAttr(p.productId)}" data-id2="${escAttr(p.name)}">+ Add</button>
        </div>
      </div>`).join('');
  } catch(e) { toast('Accessories failed: ' + e.message, 'err'); }
  finally { hideLoading(); }
}

export function openAddAccessoryModal(parentProductId, parentName) {
  const productOpts = STATE.products
    .filter(p => p.productId !== parentProductId)
    .map(p => `<option value="${esc(p.productId)}">${esc(p.name)} (${esc(p.sku)})</option>`).join('');

  openModal('modal-add-accessory', `Add Accessory to ${esc(parentName)}`, `
    <div class="form-grid">
      <div class="form-group span-2"><label>Accessory Product *</label><select id="fa-product">${productOpts}</select></div>
      <div class="form-group"><label>Default Quantity</label><input type="number" id="fa-qty" value="1" min="1"></div>
      <div class="form-group"><label>Optional?</label><input type="checkbox" id="fa-optional" style="width:auto;margin-top:8px"></div>
    </div>`, `
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" data-action="submitAddAccessory" data-id="${escAttr(parentProductId)}">Add Accessory</button>`);

  window.__submitAddAccessory = async (parentId) => {
    const accessoryProductId = document.getElementById('fa-product')?.value;
    if (!accessoryProductId) { toast('Select a product', 'warn'); return; }
    showLoading('Saving…'); closeModal();
    try {
      await rpc('saveProductAccessory', {
        parentProductId: parentId, accessoryProductId,
        defaultQuantity: parseInt(document.getElementById('fa-qty', 10)?.value, 10) || 1,
        optional: document.getElementById('fa-optional')?.checked || false,
      });
      toast('Accessory added', 'ok');
      await loadAccessories();
    } catch(e) { toast(e.message, 'err'); }
    finally { hideLoading(); }
  };
}

export async function deleteAccessoryLink(linkId) {
  showLoading('Removing…');
  try {
    await rpc('deleteProductAccessory', linkId);
    toast('Removed', 'ok');
    await loadAccessories();
  } catch(e) { toast(e.message, 'err'); }
  finally { hideLoading(); }
}

// ── Pane-level event delegation ───────────────────────────────────────────────
// Called after render. Listens on container divs so rendered cards don't need
// individual onclick handlers — they use data-action + data-id instead.
function setupPaneEvents() {
  const containerIds = ['bundles-list', 'accessories-list'];
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
        case 'addAccessoryModal': window.__addAccessoryModal(id); break;
        case 'deleteAccessoryLink': window.__deleteAccessoryLink(id, el.dataset.id2||''); break;
        case 'editBundle': window.__editBundle(id); break;
        case 'openBundleDetail': window.__openBundleDetail(id); break;
        default: break;
      }
    });
  });
}