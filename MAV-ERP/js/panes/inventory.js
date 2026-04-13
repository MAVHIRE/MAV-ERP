/**
 * MAV HIRE ERP — js/panes/inventory.js  v4.0
 * Products + barcodes: images, deep filter, edit, maintenance link,
 * return condition logging, bulk barcode CSV, product CSV import.
 */
import { rpc }            from '../api/gas.js';
import { STATE }          from '../utils/state.js';
import { showLoading, hideLoading, toast, emptyState } from '../utils/dom.js';
import { fmtCurDec, fmtDate, esc, statusBadge } from '../utils/format.js';
import { openModal, closeModal } from '../components/modal.js';

// ── Load / ensure ─────────────────────────────────────────────────────────────
export async function loadProducts() {
  showLoading('Loading inventory…');
  try {
    STATE.products = await rpc('getProducts');
    populateFilters();
    render(STATE.products);
    const el = document.getElementById('inv-subtitle');
    if (el) el.textContent = STATE.products.length + ' products';
  } catch(e) { toast('Inventory failed: ' + e.message, 'err'); }
  finally { hideLoading(); }
}

export async function ensureProductsLoaded() {
  if (!STATE.products.length) await loadProducts();
}

export async function ensureServicesLoaded() {
  if (!STATE.services.length) {
    try { STATE.services = await rpc('getServices', {}); } catch(e) {}
  }
}

// ── Filters ───────────────────────────────────────────────────────────────────
function populateFilters() {
  const cats   = [...new Set(STATE.products.map(p => p.category).filter(Boolean))].sort();
  const groups = [...new Set(STATE.products.map(p => p.productGroup).filter(Boolean))].sort();
  const brands = [...new Set(STATE.products.map(p => p.brand).filter(Boolean))].sort();
  const setOpts = (id, arr) => {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = el.value;
    el.innerHTML = `<option value="">All</option>` +
      arr.map(v => `<option${v===cur?' selected':''}>${esc(v)}</option>`).join('');
  };
  setOpts('inv-category-filter', cats);
  setOpts('inv-group-filter', groups);
  setOpts('inv-brand-filter', brands);
}

export function filterProducts() {
  const q      = (document.getElementById('inv-search')?.value || '').toLowerCase();
  const cat    = document.getElementById('inv-category-filter')?.value || '';
  const group  = document.getElementById('inv-group-filter')?.value   || '';
  const brand  = document.getElementById('inv-brand-filter')?.value   || '';
  const method = document.getElementById('inv-method-filter')?.value  || '';
  const avail  = document.getElementById('inv-avail-filter')?.value   || '';

  const filtered = STATE.products.filter(p => {
    if (q && ![p.name,p.sku,p.brand,p.model,p.category,p.productGroup,p.description,p.tags,p.productId]
      .join(' ').toLowerCase().includes(q)) return false;
    if (cat    && p.category     !== cat)    return false;
    if (group  && p.productGroup !== group)  return false;
    if (brand  && p.brand        !== brand)  return false;
    if (method && p.stockMethod  !== method) return false;
    if (avail === 'available' && (+p.qtyAvailable||0) <= 0) return false;
    if (avail === 'low'  && (p.minStockLevel<=0 || (+p.qtyAvailable||0) >= p.minStockLevel)) return false;
    if (avail === 'out'  && (+p.qtyOut||0) <= 0) return false;
    return true;
  });
  render(filtered);
  const sub = document.getElementById('inv-subtitle');
  if (sub) sub.textContent = `${filtered.length} of ${STATE.products.length} products`;
}

// ── Render ────────────────────────────────────────────────────────────────────
function render(products) {
  const el = document.getElementById('products-list');
  if (!el) return;
  if (!products.length) { el.innerHTML = emptyState('▦', 'No products match filters'); return; }
  el.innerHTML = products.map(p => {
    const avail    = +p.qtyAvailable || 0;
    const owned    = +p.qtyOwned     || 0;
    const pct      = owned > 0 ? Math.round((avail / owned) * 100) : 100;
    const alertLow = p.minStockLevel > 0 && avail < p.minStockLevel;
    const img = p.imageUrl
      ? `<img src="${esc(p.imageUrl)}" alt=""
           style="width:52px;height:52px;object-fit:contain;border-radius:4px;background:var(--surface2);flex-shrink:0"
           onerror="this.style.display='none'">`
      : `<div style="width:52px;height:52px;border-radius:4px;background:var(--surface2);display:flex;align-items:center;justify-content:center;color:var(--text3);font-size:20px;flex-shrink:0">▦</div>`;
    return `<div class="product-card" onclick="window.__openProductDetail('${esc(p.productId)}')">
      <div style="display:flex;gap:10px;align-items:flex-start">
        ${img}
        <div style="flex:1;min-width:0">
          <div class="pc-name">${esc(p.name)} ${alertLow?'<span class="badge badge-danger">Low</span>':''}</div>
          <div class="pc-sku">${esc(p.sku)}${p.brand?' · '+esc(p.brand):''}${p.category?' · '+esc(p.category):''}</div>
          <div style="margin-top:6px;max-width:200px">
            <div class="progress-bar"><div class="progress-fill"
              style="width:${pct}%;${alertLow?'background:var(--danger)':''}"></div></div>
          </div>
        </div>
      </div>
      <div class="pc-stock">
        <div style="text-align:right">
          <div class="pc-qty" style="${alertLow?'color:var(--danger)':''}">${avail}
            <span style="color:var(--text3);font-size:11px">/ ${owned}</span></div>
          <div style="font-family:var(--mono);font-size:10px;color:var(--text3)">${esc(p.stockMethod)}</div>
          <div style="font-family:var(--mono);font-size:11px;color:var(--text2)">${fmtCurDec(p.baseHireRate)}/day</div>
          ${p.weightKg>0?`<div class="td-id">${(+p.weightKg).toFixed(1)} kg</div>`:''}
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── Product detail ────────────────────────────────────────────────────────────
export async function openProductDetail(productId) {
  showLoading('Loading product…');
  try {
    const [product, summary, maintenance] = await Promise.all([
      rpc('getProductById', productId),
      rpc('getProductAssetSummary', productId),
      rpc('getMaintenanceRecords', { productId }),
    ]);
    hideLoading();
    showProductModal(product, summary, maintenance);
  } catch(e) { hideLoading(); toast(e.message, 'err'); }
}

function showProductModal(p, s, maint) {
  const maintRows = (maint||[]).slice(0,10).map(m => `<tr>
    <td class="td-id">${esc(m.maintenanceId)}</td>
    <td>${esc(m.type||'—')}</td>
    <td class="td-id">${esc(m.barcode||'—')}</td>
    <td>${statusBadge(m.status)}</td>
    <td>${fmtDate(m.scheduledDate)}</td>
    <td class="td-num">${m.totalCost>0?fmtCurDec(m.totalCost):'—'}</td>
  </tr>`).join('');

  openModal('modal-product', esc(p.name), `
    ${p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt=""
      style="width:100%;max-height:160px;object-fit:contain;border-radius:6px;
             background:var(--surface2);margin-bottom:12px"
      onerror="this.style.display='none'">` : ''}
    <div class="two-col" style="gap:12px;margin-bottom:16px">
      <div>
        <div class="detail-row"><div class="detail-label">SKU</div><div class="detail-value td-id">${esc(p.sku)}</div></div>
        <div class="detail-row"><div class="detail-label">Category</div><div class="detail-value">${esc(p.category||'—')} ${p.productGroup?'· '+esc(p.productGroup):''}</div></div>
        <div class="detail-row"><div class="detail-label">Brand / Model</div><div class="detail-value">${esc(p.brand||'')} ${esc(p.model||'')}</div></div>
        <div class="detail-row"><div class="detail-label">Stock Method</div><div class="detail-value">${statusBadge(p.stockMethod)}</div></div>
        <div class="detail-row"><div class="detail-label">Base Rate</div><div class="detail-value">${fmtCurDec(p.baseHireRate)}/day</div></div>
        <div class="detail-row"><div class="detail-label">Replacement</div><div class="detail-value">${fmtCurDec(p.replacementCost)}</div></div>
        <div class="detail-row"><div class="detail-label">Weight</div><div class="detail-value">${(+p.weightKg||0).toFixed(1)} kg</div></div>
        <div class="detail-row"><div class="detail-label">Supplier</div><div class="detail-value">${esc(p.supplierName||'—')}</div></div>
        ${p.tags?`<div class="detail-row"><div class="detail-label">Tags</div><div class="detail-value td-id">${esc(p.tags)}</div></div>`:''}
      </div>
      <div>
        <div class="detail-row"><div class="detail-label">Owned</div><div class="detail-value">${p.qtyOwned}</div></div>
        <div class="detail-row"><div class="detail-label">Available</div><div class="detail-value ok">${p.qtyAvailable}</div></div>
        <div class="detail-row"><div class="detail-label">Allocated</div><div class="detail-value">${p.qtyAllocated}</div></div>
        <div class="detail-row"><div class="detail-label">Out</div><div class="detail-value warn">${p.qtyOut}</div></div>
        <div class="detail-row"><div class="detail-label">In Service</div><div class="detail-value">${p.qtyInService}</div></div>
        <div class="detail-row"><div class="detail-label">Damaged</div><div class="detail-value danger">${p.qtyDamaged}</div></div>
        <div class="detail-row"><div class="detail-label">Lost</div><div class="detail-value danger">${p.qtyLost}</div></div>
        <div class="detail-row"><div class="detail-label">Purchase Spend</div><div class="detail-value">${fmtCurDec(s?.totalPurchaseCost||0)}</div></div>
        <div class="detail-row"><div class="detail-label">Maint Cost</div><div class="detail-value">${fmtCurDec(s?.totalMaintenanceCost||0)}</div></div>
      </div>
    </div>
    ${p.description?`<p style="font-size:13px;color:var(--text2);margin-bottom:12px">${esc(p.description)}</p>`:''}
    ${(maint||[]).length ? `
      <div class="section-title" style="margin-bottom:8px">Maintenance History (${maint.length})</div>
      <div class="tbl-wrap">
        <table><thead><tr><th>ID</th><th>Type</th><th>Barcode</th><th>Status</th><th>Date</th><th>Cost</th></tr></thead>
        <tbody>${maintRows}</tbody></table>
      </div>` : ''}
  `, `
    <button class="btn btn-ghost btn-sm" onclick="window.__editProduct('${esc(p.productId)}')">✏ Edit</button>
    <button class="btn btn-ghost btn-sm" onclick="window.__stockAdjust('${esc(p.productId)}','${esc(p.name)}')">± Stock</button>
    <button class="btn btn-ghost btn-sm" onclick="window.__printLabels('${esc(p.productId)}','${esc(p.name)}')">🏷 Labels</button>
    <button class="btn btn-ghost btn-sm" onclick="window.__logMaintenanceForProduct('${esc(p.productId)}','${esc(p.name)}')">+ Maintenance</button>
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Close</button>
  `);
}

// ── Edit / new product ────────────────────────────────────────────────────────
export async function editProduct(productId) {
  showLoading('Loading product…'); closeModal();
  try {
    const p = await rpc('getProductById', productId);
    hideLoading(); openProductForm(p);
  } catch(e) { hideLoading(); toast(e.message, 'err'); }
}

export function openNewProductModal() { openProductForm(null); }

function openProductForm(existing) {
  const p = existing || {}, isEdit = !!p.productId;
  const v = (f,fb='') => esc(p[f]!=null?p[f]:fb);
  const n = (f,fb=0) => p[f]!=null?p[f]:fb;

  openModal('modal-product-form', isEdit ? `Edit: ${esc(p.name)}` : 'New Product', `
    <div class="form-grid">
      <div class="form-group"><label>Name *</label><input type="text" id="fp-name" value="${v('name')}"></div>
      <div class="form-group"><label>SKU</label><input type="text" id="fp-sku" value="${v('sku')}"></div>
      <div class="form-group"><label>Brand</label><input type="text" id="fp-brand" value="${v('brand')}"></div>
      <div class="form-group"><label>Model</label><input type="text" id="fp-model" value="${v('model')}"></div>
      <div class="form-group"><label>Category</label><input type="text" id="fp-category" value="${v('category')}"></div>
      <div class="form-group"><label>Product Group</label><input type="text" id="fp-group" value="${v('productGroup')}"></div>
      <div class="form-group"><label>Stock Method</label>
        <select id="fp-method">
          <option value="Bulk"${p.stockMethod==='Bulk'?' selected':''}>Bulk</option>
          <option value="Serialised"${p.stockMethod==='Serialised'?' selected':''}>Serialised</option>
        </select></div>
      <div class="form-group"><label>Unit</label><input type="text" id="fp-unit" value="${v('unit','Each')}"></div>
      <div class="form-group"><label>Base Hire Rate (£/day)</label>
        <input type="number" id="fp-rate" value="${n('baseHireRate')}" step="0.01" min="0"></div>
      <div class="form-group"><label>Replacement Cost (£)</label>
        <input type="number" id="fp-replacement" value="${n('replacementCost')}" step="0.01" min="0"></div>
      <div class="form-group"><label>Purchase Price (£)</label>
        <input type="number" id="fp-purchase" value="${n('purchasePrice')}" step="0.01" min="0"></div>
      <div class="form-group"><label>Weight (kg)</label>
        <input type="number" id="fp-weight" value="${n('weightKg')}" step="0.01" min="0"></div>
      <div class="form-group"><label>Min Stock Level</label>
        <input type="number" id="fp-min-stock" value="${n('minStockLevel')}" min="0"></div>
      <div class="form-group"><label>Reorder Level</label>
        <input type="number" id="fp-reorder" value="${n('reorderLevel')}" min="0"></div>
      <div class="form-group"><label>Finance Method</label>
        <select id="fp-finance">
          ${['Owned','Financed','Leased','Rented'].map(o=>`<option${p.financeMethod===o?' selected':''}>${o}</option>`).join('')}
        </select></div>
      <div class="form-group"><label>Depreciation</label>
        <select id="fp-dep">
          ${['Straight Line','Reducing Balance','None'].map(o=>`<option${p.depreciationMethod===o?' selected':''}>${o}</option>`).join('')}
        </select></div>
      <div class="form-group span-2">
        <label>Image URL</label>
        <div style="display:flex;gap:10px;align-items:flex-start">
          <input type="url" id="fp-image-url" value="${v('imageUrl')}" placeholder="https://…" style="flex:1"
            oninput="window.__previewProductImg(this.value)">
          <div id="fp-img-preview" style="min-width:60px;min-height:40px"></div>
        </div>
      </div>
      <div class="form-group span-2"><label>Description</label>
        <textarea id="fp-description">${v('description')}</textarea></div>
      <div class="form-group span-2"><label>Tags (comma separated)</label>
        <input type="text" id="fp-tags" value="${v('tags')}"></div>
      <div class="form-group"><label>Prep Notes</label>
        <input type="text" id="fp-prep-notes" value="${v('defaultPrepNotes')}"></div>
      <div class="form-group"><label>Return Notes</label>
        <input type="text" id="fp-return-notes" value="${v('defaultReturnNotes')}"></div>
    </div>`, `
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="window.__submitProductForm('${esc(p.productId||'')}')">
      ${isEdit?'Save Changes':'Save Product'}</button>`
  );

  window.__previewProductImg = (url) => {
    const el = document.getElementById('fp-img-preview');
    if (!el) return;
    el.innerHTML = url
      ? `<img src="${esc(url)}" style="max-height:56px;max-width:80px;object-fit:contain;border-radius:4px"
           onerror="this.style.display='none'">`
      : '';
  };
  if (p.imageUrl) window.__previewProductImg(p.imageUrl);

  window.__submitProductForm = async (pId) => {
    const name = document.getElementById('fp-name')?.value.trim();
    if (!name) { toast('Name required', 'warn'); return; }
    showLoading('Saving…'); closeModal();
    try {
      const r = await rpc('saveProduct', {
        productId:       pId || null, name,
        sku:             document.getElementById('fp-sku')?.value,
        brand:           document.getElementById('fp-brand')?.value,
        model:           document.getElementById('fp-model')?.value,
        category:        document.getElementById('fp-category')?.value,
        productGroup:    document.getElementById('fp-group')?.value,
        stockMethod:     document.getElementById('fp-method')?.value,
        unit:            document.getElementById('fp-unit')?.value || 'Each',
        baseHireRate:    parseFloat(document.getElementById('fp-rate')?.value)        || 0,
        replacementCost: parseFloat(document.getElementById('fp-replacement')?.value) || 0,
        purchasePrice:   parseFloat(document.getElementById('fp-purchase')?.value)    || 0,
        weightKg:        parseFloat(document.getElementById('fp-weight')?.value)      || 0,
        minStockLevel:   parseInt(document.getElementById('fp-min-stock')?.value)     || 0,
        reorderLevel:    parseInt(document.getElementById('fp-reorder')?.value)       || 0,
        financeMethod:   document.getElementById('fp-finance')?.value,
        depreciationMethod: document.getElementById('fp-dep')?.value,
        description:     document.getElementById('fp-description')?.value,
        tags:            document.getElementById('fp-tags')?.value,
        imageUrl:        document.getElementById('fp-image-url')?.value,
        defaultPrepNotes:   document.getElementById('fp-prep-notes')?.value,
        defaultReturnNotes: document.getElementById('fp-return-notes')?.value,
      });
      toast(isEdit ? 'Product saved' : 'Product created: ' + r.productId, 'ok');
      if (!isEdit) await rpc('syncStockFromProducts');
      STATE.loadedPanes.delete('inventory');
      await loadProducts();
    } catch(e) { toast(e.message, 'err'); }
    finally { hideLoading(); }
  };
}

// ── Log maintenance from product ──────────────────────────────────────────────
export function openLogMaintenanceForProduct(productId, productName) {
  closeModal();
  rpc('getBarcodes', productId).then(barcodes => {
    const bcOpts = barcodes.map(b =>
      `<option value="${esc(b.barcode)}">${esc(b.barcode)} ${esc(b.serialNumber||'')} · ${esc(b.condition||'')}</option>`
    ).join('');
    openModal('modal-log-maint', `Log Maintenance — ${esc(productName)}`, `
      <div class="form-grid">
        <div class="form-group"><label>Type *</label>
          <select id="lm-type">
            <option>Routine Service</option><option>Repair</option><option>PAT Test</option>
            <option>Calibration</option><option>Inspection</option><option>Other</option>
          </select></div>
        <div class="form-group"><label>Priority</label>
          <select id="lm-priority"><option>Normal</option><option>High</option><option>Urgent</option><option>Low</option></select></div>
        ${barcodes.length ? `<div class="form-group span-2"><label>Specific Unit</label>
          <select id="lm-barcode">
            <option value="">— All units —</option>${bcOpts}
          </select></div>` : ''}
        <div class="form-group"><label>Scheduled Date</label>
          <input type="date" id="lm-date" value="${new Date().toISOString().substring(0,10)}"></div>
        <div class="form-group"><label>Estimated Cost (£)</label>
          <input type="number" id="lm-cost" value="0" step="0.01" min="0"></div>
        <div class="form-group span-2"><label>Notes</label>
          <textarea id="lm-notes" rows="2"></textarea></div>
      </div>`, `
      <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
      <button class="btn btn-primary btn-sm" onclick="window.__submitLogMaint('${esc(productId)}')">Create Record</button>`
    );
    window.__submitLogMaint = async (pId) => {
      showLoading('Creating…'); closeModal();
      try {
        const r = await rpc('createMaintenanceRecord', {
          productId: pId,
          barcode:   document.getElementById('lm-barcode')?.value || '',
          type:      document.getElementById('lm-type')?.value,
          priority:  document.getElementById('lm-priority')?.value,
          scheduledDate: document.getElementById('lm-date')?.value,
          estimatedCost: parseFloat(document.getElementById('lm-cost')?.value) || 0,
          notes:     document.getElementById('lm-notes')?.value,
          status:    'Scheduled',
        });
        toast('Maintenance created: ' + r.maintenanceId, 'ok');
        STATE.loadedPanes.delete('maintenance');
      } catch(e) { toast(e.message, 'err'); }
      finally { hideLoading(); }
    };
  }).catch(() => toast('Failed to load barcodes', 'err'));
}

// ── Return condition logging ──────────────────────────────────────────────────
export function openReturnConditionModal(jobId, jobName) {
  showLoading('Loading returned items…');
  rpc('getJobBarcodes', jobId).then(barcodes => {
    hideLoading();
    if (!barcodes.length) { toast('No serialised items on this job', 'warn'); return; }
    openModal('modal-return-cond', `Return Condition — ${esc(jobName)}`, `
      <p style="font-size:12px;color:var(--text3);margin-bottom:12px">
        Mark condition of each item. Damaged/Lost items will auto-create a maintenance record.
      </p>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${barcodes.map(b => `
          <div style="display:grid;grid-template-columns:1fr 110px 140px;gap:8px;align-items:center;
                      padding:8px 10px;background:var(--surface2);border-radius:var(--r)">
            <div>
              <div style="font-weight:500;font-size:13px">${esc(b.productName||b.productId)}</div>
              <div class="td-id">${esc(b.barcode)} ${esc(b.serialNumber||'')}</div>
            </div>
            <select id="rc-${esc(b.barcode)}" style="font-size:12px"
              onchange="this.style.color=this.value==='Damaged'||this.value==='Lost'?'var(--danger)':'inherit'">
              <option>Good</option><option>Fair</option><option>Damaged</option><option>Lost</option>
            </select>
            <input type="text" id="rn-${esc(b.barcode)}" placeholder="Notes…" style="font-size:12px">
          </div>`).join('')}
      </div>`, `
      <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
      <button class="btn btn-primary btn-sm" onclick="window.__submitReturnConds('${esc(jobId)}')">Save Conditions</button>
    `, 'modal-lg');

    window.__submitReturnConds = async (jId) => {
      showLoading('Saving…'); closeModal();
      let damaged = 0;
      try {
        for (const b of barcodes) {
          const cond  = document.getElementById(`rc-${b.barcode}`)?.value || 'Good';
          const notes = document.getElementById(`rn-${b.barcode}`)?.value || '';
          if (['Damaged','Lost'].includes(cond)) {
            damaged++;
            await rpc('createMaintenanceRecord', {
              productId: b.productId, barcode: b.barcode,
              type: cond === 'Lost' ? 'Investigation' : 'Repair',
              priority: 'High', status: 'Scheduled',
              scheduledDate: new Date().toISOString().substring(0,10),
              notes: `Return condition: ${cond}. ${notes}`.trim(),
            });
          }
        }
        toast(damaged > 0
          ? `Conditions saved · ${damaged} maintenance record${damaged>1?'s':''} auto-created`
          : 'Return conditions saved', damaged > 0 ? 'warn' : 'ok');
        STATE.loadedPanes.delete('maintenance');
        STATE.loadedPanes.delete('jobs');
      } catch(e) { toast(e.message, 'err'); }
      finally { hideLoading(); }
    };
  }).catch(e => { hideLoading(); toast(e.message, 'err'); });
}

// ── Add barcode ───────────────────────────────────────────────────────────────
export function openAddBarcodeModal() {
  ensureProductsLoaded().then(() => {
    const opts = STATE.products.filter(p => p.stockMethod === 'Serialised')
      .map(p => `<option value="${esc(p.productId)}">${esc(p.name)} (${esc(p.sku)})</option>`).join('');
    openModal('modal-add-barcode', 'Add Barcode', `
      <div class="form-grid">
        <div class="form-group span-2"><label>Product *</label>
          <select id="fb-product"><option value="">— Select product —</option>${opts}</select></div>
        <div class="form-group"><label>Barcode *</label><input type="text" id="fb-barcode"></div>
        <div class="form-group"><label>Serial Number</label><input type="text" id="fb-serial"></div>
        <div class="form-group"><label>Asset Tag</label><input type="text" id="fb-asset-tag"></div>
        <div class="form-group"><label>Condition</label>
          <select id="fb-condition"><option>Good</option><option>Fair</option><option>New</option><option>Damaged</option></select></div>
        <div class="form-group"><label>Purchase Price (£)</label>
          <input type="number" id="fb-price" value="0" step="0.01" min="0"></div>
        <div class="form-group"><label>Notes</label><input type="text" id="fb-notes"></div>
      </div>`, `
      <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
      <button class="btn btn-primary btn-sm" onclick="window.__submitAddBarcode()">Add Barcode</button>`);
    window.__submitAddBarcode = async () => {
      const barcode = document.getElementById('fb-barcode')?.value.trim();
      const pId     = document.getElementById('fb-product')?.value;
      if (!barcode || !pId) { toast('Barcode and product required', 'warn'); return; }
      showLoading('Adding…'); closeModal();
      try {
        await rpc('addBarcode', { barcode, productId: pId,
          serialNumber: document.getElementById('fb-serial')?.value,
          assetTag: document.getElementById('fb-asset-tag')?.value,
          condition: document.getElementById('fb-condition')?.value,
          purchasePrice: parseFloat(document.getElementById('fb-price')?.value) || 0,
          notes: document.getElementById('fb-notes')?.value,
        });
        toast('Barcode added: ' + barcode, 'ok');
        STATE.loadedPanes.delete('inventory');
        await loadProducts();
      } catch(e) { toast(e.message, 'err'); }
      finally { hideLoading(); }
    };
  });
}

// ── Bulk barcode CSV ──────────────────────────────────────────────────────────
export function openBulkBarcodeImport() {
  openModal('modal-bulk-bc', 'Bulk Barcode Import', `
    <div style="font-size:12px;color:var(--text3);margin-bottom:10px">
      Columns: <span class="td-id">barcode, productId, serialNumber, assetTag, condition, purchasePrice, notes</span>
    </div>
    <div class="form-group"><label>CSV File</label>
      <input type="file" id="csv-bc-file" accept=".csv" style="color:var(--text2)"></div>
    <div id="csv-bc-preview" style="display:none;margin-top:10px">
      <div id="csv-bc-table"></div>
      <div id="csv-bc-status" style="font-family:var(--mono);font-size:12px;color:var(--text3);margin-top:6px"></div>
    </div>`, `
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-ghost btn-sm" onclick="window.__csvBcPreview()">Preview</button>
    <button class="btn btn-primary btn-sm" id="btn-bc-imp" disabled onclick="window.__csvBcImport()">Import</button>`);
  let rows = [];
  window.__csvBcPreview = () => {
    const file = document.getElementById('csv-bc-file')?.files[0];
    if (!file) { toast('Select a file', 'warn'); return; }
    const fr = new FileReader();
    fr.onload = e => {
      const lines = e.target.result.split('\n').filter(l=>l.trim());
      const hdrs  = lines[0].split(',').map(h=>h.trim().replace(/"/g,'').toLowerCase());
      rows = lines.slice(1).map(l => { const o={}; l.split(',').forEach((v,i)=>{o[hdrs[i]]=(v||'').trim().replace(/"/g,'');}); return o; }).filter(r=>r.barcode);
      document.getElementById('csv-bc-table').innerHTML = `<div class="tbl-wrap"><table>
        <thead><tr>${hdrs.map(h=>`<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${rows.slice(0,5).map(r=>`<tr>${hdrs.map(h=>`<td class="td-id">${r[h]||''}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>`;
      document.getElementById('csv-bc-status').textContent = rows.length + ' rows ready';
      document.getElementById('csv-bc-preview').style.display = 'block';
      document.getElementById('btn-bc-imp').disabled = false;
    };
    fr.readAsText(file);
  };
  window.__csvBcImport = async () => {
    if (!rows.length) { toast('Preview first', 'warn'); return; }
    showLoading(`Importing ${rows.length} barcodes…`); closeModal();
    let ok=0,fail=0;
    for (const r of rows) {
      try {
        await rpc('addBarcode', { barcode:r.barcode, productId:r.productid||r['product id']||r.productId||'',
          serialNumber:r.serialnumber||r['serial number']||'', assetTag:r.assettag||r['asset tag']||'',
          condition:r.condition||'Good', purchasePrice:parseFloat(r.purchaseprice||0)||0, notes:r.notes||'' });
        ok++;
      } catch(e) { fail++; }
    }
    toast(`Imported ${ok}${fail>0?`, ${fail} failed`:''}`, fail>0?'warn':'ok');
    STATE.loadedPanes.delete('inventory'); await loadProducts(); hideLoading();
  };
}

// ── Product CSV import ────────────────────────────────────────────────────────
export function openProductCsvImport() {
  const HDRS = ['name','sku','category','productGroup','brand','model','stockMethod',
    'baseHireRate','replacementCost','purchasePrice','weightKg','minStockLevel',
    'unit','description','tags','imageUrl'];
  openModal('modal-prod-csv', 'Product CSV Import', `
    <div style="font-size:12px;color:var(--text3);margin-bottom:8px">
      Columns: <span class="td-id">${HDRS.join(', ')}</span><br>
      <strong>name</strong> required. stockMethod: Bulk or Serialised.
    </div>
    <div style="margin-bottom:10px">
      <button class="btn btn-ghost btn-sm" onclick="window.__dlProdTemplate()">⬇ Template CSV</button>
    </div>
    <div class="form-group"><label>CSV File</label>
      <input type="file" id="csv-pr-file" accept=".csv" style="color:var(--text2)"></div>
    <div id="csv-pr-prev" style="display:none;margin-top:10px">
      <div id="csv-pr-table"></div>
      <div id="csv-pr-status" style="font-family:var(--mono);font-size:12px;color:var(--text3);margin-top:6px"></div>
    </div>`, `
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-ghost btn-sm" onclick="window.__csvPrPreview()">Preview</button>
    <button class="btn btn-primary btn-sm" id="btn-pr-imp" disabled onclick="window.__csvPrImport()">Import</button>`);

  let rows = [];
  window.__dlProdTemplate = () => {
    const csv = HDRS.join(',') + '\n"Example Subwoofer","AUD-001","Audio","Audio","QSC","KS112","Bulk","85","1200","950","25.5","2","Each","18-inch sub","audio,bass",""\n';
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    a.download = 'mav-product-template.csv'; a.click();
  };
  window.__csvPrPreview = () => {
    const file = document.getElementById('csv-pr-file')?.files[0];
    if (!file) { toast('Select a file', 'warn'); return; }
    const fr = new FileReader();
    fr.onload = e => {
      const lines = e.target.result.split('\n').filter(l=>l.trim());
      const hdrs  = lines[0].split(',').map(h=>h.trim().replace(/"/g,'').toLowerCase());
      rows = lines.slice(1).map(l=>{const o={};l.split(',').forEach((v,i)=>{o[hdrs[i]]=(v||'').trim().replace(/"/g,'');});return o;}).filter(r=>r.name);
      document.getElementById('csv-pr-table').innerHTML = `<div class="tbl-wrap"><table>
        <thead><tr>${hdrs.slice(0,6).map(h=>`<th>${h}</th>`).join('')}<th>…</th></tr></thead>
        <tbody>${rows.slice(0,5).map(r=>`<tr>${hdrs.slice(0,6).map(h=>`<td class="td-id">${r[h]||''}</td>`).join('')}<td class="td-id">+${hdrs.length-6}</td></tr>`).join('')}</tbody>
      </table></div>`;
      document.getElementById('csv-pr-status').textContent = rows.length + ' products ready';
      document.getElementById('csv-pr-prev').style.display = 'block';
      document.getElementById('btn-pr-imp').disabled = false;
    };
    fr.readAsText(file);
  };
  window.__csvPrImport = async () => {
    if (!rows.length) { toast('Preview first', 'warn'); return; }
    showLoading(`Importing ${rows.length} products…`); closeModal();
    let ok=0,fail=0;
    for (const r of rows) {
      try {
        await rpc('saveProduct', { name:r.name, sku:r.sku||'', category:r.category||'',
          productGroup:r.productgroup||r.productGroup||'', brand:r.brand||'', model:r.model||'',
          stockMethod:r.stockmethod||r.stockMethod||'Bulk',
          baseHireRate:parseFloat(r.basehirerate||r.baseHireRate||0)||0,
          replacementCost:parseFloat(r.replacementcost||r.replacementCost||0)||0,
          purchasePrice:parseFloat(r.purchaseprice||r.purchasePrice||0)||0,
          weightKg:parseFloat(r.weightkg||r.weightKg||0)||0,
          minStockLevel:parseInt(r.minstocklevel||r.minStockLevel||0)||0,
          unit:r.unit||'Each', description:r.description||'',
          tags:r.tags||'', imageUrl:r.imageurl||r.imageUrl||'' });
        ok++;
      } catch(e) { fail++; }
    }
    await rpc('syncStockFromProducts');
    toast(`Imported ${ok}${fail>0?`, ${fail} failed`:''}`, fail>0?'warn':'ok');
    STATE.loadedPanes.delete('inventory'); await loadProducts(); hideLoading();
  };
}

// ── Stock adjustment modal ────────────────────────────────────────────────────
export function openStockAdjustModal(productId, productName) {
  closeModal();
  openModal('modal-stock-adj', `Stock Adjustment — ${esc(productName)}`, `
    <div class="form-grid">
      <div class="form-group span-2">
        <label>Adjustment Type *</label>
        <select id="sa-type" onchange="window.__saTypeChange()">
          <option value="in">+ Stock In (received / found)</option>
          <option value="out">− Stock Out (used / consumed)</option>
          <option value="lost">✗ Write Off Lost</option>
          <option value="service_out">→ Send to Service</option>
          <option value="service_in">← Return from Service</option>
        </select>
      </div>
      <div class="form-group">
        <label>Quantity *</label>
        <input type="number" id="sa-qty" value="1" min="1">
      </div>
      <div class="form-group" id="sa-barcode-wrap">
        <label>Barcode (serialised units)</label>
        <input type="text" id="sa-barcode" placeholder="Leave blank for bulk">
      </div>
      <div class="form-group span-2">
        <label>Notes</label>
        <input type="text" id="sa-notes" placeholder="Reason for adjustment">
      </div>
    </div>`, `
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="window.__submitStockAdj('${esc(productId)}')">Apply Adjustment</button>`
  );

  window.__saTypeChange = () => {
    const type = document.getElementById('sa-type')?.value;
    const barcodeWrap = document.getElementById('sa-barcode-wrap');
    if (barcodeWrap) {
      barcodeWrap.style.display = ['lost','service_out','service_in'].includes(type) ? 'block' : 'none';
    }
  };
  window.__saTypeChange();

  window.__submitStockAdj = async (pId) => {
    const type    = document.getElementById('sa-type')?.value;
    const qty     = parseInt(document.getElementById('sa-qty')?.value) || 0;
    const barcode = document.getElementById('sa-barcode')?.value.trim() || '';
    const notes   = document.getElementById('sa-notes')?.value.trim()   || '';

    if (!qty || qty < 1) { toast('Quantity must be at least 1', 'warn'); return; }
    showLoading('Applying adjustment…'); closeModal();
    try {
      if (type === 'in')          await rpc('adjustStockPositive',    pId, qty, notes);
      else if (type === 'out')    await rpc('adjustStockNegative',    pId, qty, notes);
      else if (type === 'lost')   await rpc('writeOffLostStock',      pId, qty, barcode, notes);
      else if (type === 'service_out') await rpc('sendStockToService',    pId, qty, barcode, notes);
      else if (type === 'service_in')  await rpc('returnStockFromService', pId, qty, barcode, notes);
      toast('Adjustment applied', 'ok');
      STATE.loadedPanes.delete('inventory');
      await loadProducts();
    } catch(e) { toast(e.message, 'err'); }
    finally { hideLoading(); }
  };
}

// ── Barcode label printing ────────────────────────────────────────────────────
export async function openBarcodeLabelModal(productId, productName) {
  showLoading('Loading barcodes…');
  try {
    const barcodes = await rpc('getBarcodes', productId);
    hideLoading();
    if (!barcodes.length) { toast('No barcodes for this product', 'warn'); return; }

    openModal('modal-barcode-labels', `Print Labels — ${esc(productName)}`, `
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px;flex-wrap:wrap">
        <label style="font-size:13px">Label size:</label>
        <select id="lbl-size" style="font-size:12px;padding:4px 8px">
          <option value="small">Small (50×25mm)</option>
          <option value="medium" selected>Medium (70×35mm)</option>
          <option value="large">Large (100×50mm)</option>
        </select>
        <label style="font-size:13px">Per row:</label>
        <select id="lbl-cols" style="font-size:12px;padding:4px 8px">
          <option value="2">2</option>
          <option value="3" selected>3</option>
          <option value="4">4</option>
        </select>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
          <input type="checkbox" id="lbl-show-name" checked> Show product name
        </label>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
          <input type="checkbox" id="lbl-show-serial" checked> Show serial
        </label>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
        ${barcodes.map(b => `
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;
                         background:var(--surface2);padding:6px 10px;border-radius:var(--r)">
            <input type="checkbox" class="lbl-bc-check" value="${esc(b.barcode)}"
              data-serial="${esc(b.serialNumber||'')}" data-name="${esc(productName)}" checked>
            ${esc(b.barcode)} ${b.serialNumber ? '· '+esc(b.serialNumber) : ''}
          </label>`).join('')}
      </div>
      <div style="font-size:11px;color:var(--text3)">
        ${barcodes.length} unit${barcodes.length!==1?'s':''} · select which to include
      </div>`, `
      <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
      <button class="btn btn-ghost btn-sm" onclick="document.querySelectorAll('.lbl-bc-check').forEach(c=>c.checked=true)">Select All</button>
      <button class="btn btn-primary btn-sm" onclick="window.__printBarcodeLabels()">🖨 Print Labels</button>`
    );

    window.__printBarcodeLabels = () => {
      const checked = [...document.querySelectorAll('.lbl-bc-check:checked')];
      if (!checked.length) { toast('Select at least one barcode', 'warn'); return; }

      const size  = document.getElementById('lbl-size')?.value || 'medium';
      const cols  = parseInt(document.getElementById('lbl-cols')?.value) || 3;
      const showName   = document.getElementById('lbl-show-name')?.checked ?? true;
      const showSerial = document.getElementById('lbl-show-serial')?.checked ?? true;

      const dims = { small: [50,25], medium: [70,35], large: [100,50] }[size];
      const [w, h] = dims;

      const labelStyle = `
        width:${w}mm;height:${h}mm;display:inline-flex;flex-direction:column;
        align-items:center;justify-content:center;gap:2px;
        border:0.5px solid #ccc;padding:3mm;box-sizing:border-box;
        font-family:Arial,sans-serif;page-break-inside:avoid;vertical-align:top;`;

      const labels = checked.map(cb => {
        const barcode = cb.value;
        const serial  = cb.dataset.serial;
        const name    = cb.dataset.name;
        // Generate QR code using Google Charts API
        const qrUrl   = `https://chart.googleapis.com/chart?cht=qr&chs=120x120&chl=${encodeURIComponent(barcode)}&choe=UTF-8`;
        return `<div style="${labelStyle}">
          <img src="${qrUrl}" style="width:${Math.round(h*0.55)}mm;height:${Math.round(h*0.55)}mm;object-fit:contain">
          <div style="font-size:${size==='small'?6:size==='large'?9:7}pt;font-weight:bold;text-align:center;word-break:break-all;max-width:100%">${barcode}</div>
          ${showSerial && serial ? `<div style="font-size:${size==='small'?5:6}pt;color:#666;text-align:center">${serial}</div>` : ''}
          ${showName ? `<div style="font-size:${size==='small'?5:6}pt;color:#666;text-align:center;word-break:break-all;max-width:100%">${name}</div>` : ''}
        </div>`;
      }).join('');

      const win = window.open('', '_blank');
      win.document.write(`<!DOCTYPE html><html><head><title>Barcode Labels — ${productName}</title>
        <style>
          @page { margin: 10mm; }
          body { margin:0;padding:0;background:#fff; }
          .grid { display:grid;grid-template-columns:repeat(${cols},${w}mm);gap:3mm; }
          @media print { body { -webkit-print-color-adjust:exact; } }
        </style></head><body>
        <div class="grid">${labels}</div>
        <script>window.onload=()=>{ setTimeout(()=>window.print(),500); }<\/script>
      </body></html>`);
      win.document.close();
      closeModal();
    };
  } catch(e) { hideLoading(); toast(e.message, 'err'); }
}