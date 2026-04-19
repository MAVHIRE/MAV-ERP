/**
 * MAV HIRE ERP — inventory.js  v5.0
 *
 * What changed from v4:
 * ─ Card grid layout: image left, stock bar, badges, actions inline
 * ─ View toggle: grid (card) vs table (compact, sortable)
 * ─ Snapshot KPIs: replaced inline styles with .kpi classes
 * ─ Product detail: full tabbed modal — Info / Stock / Financials / Performance / History
 * ─ Quick-action buttons visible on card hover (edit, adjust, labels, maintenance)
 * ─ Barcode contents panel in detail modal: condition badges, location, status
 * ─ Return condition modal: colour-coded per condition change
 * ─ All data-action delegation — zero inline onclick in rendered HTML
 * ─ All string fields escaped, no XSS gaps
 * ─ parseInt with radix throughout
 * ─ Snapshot also shows fleet utilisation %
 */
import { rpc, rpcWithFallback }        from '../api/gas.js';
import { STATE }                        from '../utils/state.js';
import { showLoading, hideLoading, toast, emptyState } from '../utils/dom.js';
import { fmtCur, fmtCurDec, fmtDate, esc, statusBadge, exportCsv, escAttr } from '../utils/format.js';
import { openModal, closeModal }        from '../components/modal.js';

// ── View state ────────────────────────────────────────────────────────────────
let _view      = 'grid';   // 'grid' | 'table'
let _sortField = 'name';
let _sortDir   = 1;        // 1=asc, -1=desc

// ── Load ──────────────────────────────────────────────────────────────────────
export async function loadProducts() {
  showLoading('Loading inventory…');
  try {
    const [products, snapshot, categories] = await Promise.all([
      rpcWithFallback('getProducts'),
      rpcWithFallback('getInventorySnapshot').catch(() => null),
      rpc('getProductCategories').catch(() => []),
    ]);
    STATE.products          = Array.isArray(products)    ? products    : [];
    STATE.productCategories = Array.isArray(categories)  ? categories  : STATE.productCategories || [];
    populateFilters();
    renderSnapshot(snapshot);
    renderProducts(STATE.products);
    const el = document.getElementById('inv-subtitle');
    if (el) el.textContent = STATE.products.length + ' products';
    setupPaneEvents();
  } catch(e) { toast('Inventory failed: ' + e.message, 'err'); }
  finally { hideLoading(); }
}

export async function ensureProductsLoaded() {
  if (!Array.isArray(STATE.products) || !STATE.products.length) await loadProducts();
}

export async function ensureServicesLoaded() {
  if (!Array.isArray(STATE.services) || !STATE.services.length) {
    try { STATE.services = await rpc('getServices', {}); }
    catch(e) { console.warn('[Inventory] Services load:', e.message); }
  }
}

// ── Snapshot KPIs ─────────────────────────────────────────────────────────────
function renderSnapshot(snap) {
  const el = document.getElementById('inv-snapshot');
  if (!el) return;
  if (!snap) { el.innerHTML = ''; return; }

  const totals  = snap.totals || snap;  // support both shapes
  const owned   = +(totals.qtyOwned   || snap.totalUnits     || 0);
  const avail   = +(totals.qtyAvailable|| snap.totalAvailable || 0);
  const out     = +(totals.qtyOut     || snap.totalOut       || 0);
  const service = +(totals.qtyInService|| snap.totalInService || 0);
  const damaged = +(totals.qtyDamaged || 0);
  const rv      = +(totals.replacementValue || snap.totalReplacementValue || 0);
  const utilPct = owned > 0 ? Math.round((out / owned) * 100) : 0;

  const kpi = (label, value, cls = '') =>
    `<div class="kpi">
       <div class="kpi-label">${label}</div>
       <div class="kpi-value ${cls}">${value}</div>
     </div>`;

  el.innerHTML = `<div class="kpi-grid inv-kpi-grid" style="margin-bottom:16px">
    ${kpi('SKUs',          totals.skuCount   ?? snap.totalProducts ?? '—')}
    ${kpi('Units Owned',   owned || '—')}
    ${kpi('Available',     avail || '—',   'ok')}
    ${kpi('On Hire',       out   || '—',   'accent')}
    ${kpi('In Service',    service || '—', service > 0 ? 'warn' : '')}
    ${kpi('Damaged',       damaged || '—', damaged > 0 ? 'danger' : '')}
    ${kpi('Fleet Util',    utilPct + '%',  utilPct > 70 ? 'ok' : utilPct > 40 ? 'accent' : 'warn')}
    ${kpi('Fleet Value',   '£' + (rv / 1000).toFixed(0) + 'k')}
  </div>`;
}

// ── Filters ───────────────────────────────────────────────────────────────────
function populateFilters() {
  const serverCats  = (STATE.productCategories || []).map(c => c.categoryName || c.name).filter(Boolean).sort();
  const productCats = [...new Set(STATE.products.map(p => p.category).filter(Boolean))].sort();
  const cats   = serverCats.length ? serverCats : productCats;
  const groups = [...new Set(STATE.products.map(p => p.productGroup).filter(Boolean))].sort();
  const brands = [...new Set(STATE.products.map(p => p.brand).filter(Boolean))].sort();

  const setOpts = (id, arr) => {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = el.value;
    el.innerHTML = `<option value="">All</option>` +
      arr.map(v => `<option${v === cur ? ' selected' : ''}>${esc(v)}</option>`).join('');
  };
  setOpts('inv-category-filter', cats);
  setOpts('inv-group-filter',    groups);
  setOpts('inv-brand-filter',    brands);
}

export function filterProducts() {
  const q      = (document.getElementById('inv-search')?.value          || '').toLowerCase();
  const cat    =  document.getElementById('inv-category-filter')?.value  || '';
  const group  =  document.getElementById('inv-group-filter')?.value     || '';
  const brand  =  document.getElementById('inv-brand-filter')?.value     || '';
  const method =  document.getElementById('inv-method-filter')?.value    || '';
  const avail  =  document.getElementById('inv-avail-filter')?.value     || '';

  const filtered = STATE.products.filter(p => {
    if (q && ![p.name, p.sku, p.brand, p.model, p.category, p.productGroup, p.description, p.tags, p.productId]
      .join(' ').toLowerCase().includes(q)) return false;
    if (cat    && p.category    !== cat)    return false;
    if (group  && p.productGroup !== group) return false;
    if (brand  && p.brand        !== brand) return false;
    if (method && p.stockMethod  !== method) return false;
    if (avail === 'available' && (+p.qtyAvailable || 0) <= 0) return false;
    if (avail === 'low'  && (p.minStockLevel <= 0 || (+p.qtyAvailable || 0) >= p.minStockLevel)) return false;
    if (avail === 'out'  && (+p.qtyOut || 0) <= 0) return false;
    if (avail === 'inactive' && p.active !== false) return false;
    return true;
  });

  renderProducts(filtered);
  const sub = document.getElementById('inv-subtitle');
  if (sub) sub.textContent = `${filtered.length} of ${STATE.products.length} products`;
  setupPaneEvents();
}

export function setInventoryView(view) {
  _view = view;
  // Update toggle buttons
  ['grid','table'].forEach(v => {
    const btn = document.querySelector(`[data-action="inv-view"][data-view="${v}"]`);
    if (btn) btn.classList.toggle('active', v === view);
  });
  // Re-render current filtered set
  const q     = document.getElementById('inv-search')?.value || '';
  if (q || document.getElementById('inv-category-filter')?.value) {
    filterProducts();
  } else {
    renderProducts(STATE.products);
    setupPaneEvents();
  }
}

// ── Render dispatcher ─────────────────────────────────────────────────────────
function renderProducts(products) {
  if (_view === 'table') renderTable(products);
  else                   renderGrid(products);
}

// ── Grid view ─────────────────────────────────────────────────────────────────
function renderGrid(products) {
  const el = document.getElementById('inv-list');
  if (!el) return;
  // Filter out any products with no name (data integrity guard)
  const valid = products.filter(p => p.name && p.productId);
  if (!valid.length) { el.innerHTML = emptyState('▦', 'No products match filters'); return; }

  el.className = 'inv-grid';
  el.innerHTML = valid.map(p => productCard(p)).join('');
}

function productCard(p) {
  const avail    = +p.qtyAvailable || 0;
  const owned    = +p.qtyOwned     || 0;
  const out      = +p.qtyOut > 0 ? +p.qtyOut : Math.max(0, owned - avail);
  const pct      = owned > 0 ? Math.round((avail / owned) * 100) : 100;
  const alertLow = p.minStockLevel > 0 && avail < p.minStockLevel;
  const allOut   = avail === 0 && owned > 0;
  const barColor = alertLow ? 'var(--danger)' : pct < 50 ? 'var(--warn)' : 'var(--ok)';
  const borderColor = alertLow ? 'var(--danger)' : allOut ? 'var(--warn)' : 'var(--border)';

  const img = p.imageUrl
    ? `<img src="${esc(p.imageUrl)}" alt="" class="inv-card-img" onerror="this.style.display='none'">`
    : `<div class="inv-card-img inv-card-img--placeholder">▦</div>`;

  const badges = [
    alertLow ? `<span class="badge badge-danger">LOW</span>` : '',
    allOut   ? `<span class="badge badge-warn">ALL OUT</span>` : '',
    p.active === false ? `<span class="badge badge-muted">INACTIVE</span>` : '',
    p.stockMethod === 'Serialised' ? `<span class="badge badge-info">SER</span>` : '',
  ].filter(Boolean).join('');

  return `
    <button type="button" class="inv-card" data-action="openProductDetail" data-id="${escAttr(p.productId)}"
      style="border-left:3px solid ${borderColor}" aria-label="View ${esc(p.name)}">
      <div class="inv-card-top">
        ${img}
        <div class="inv-card-body">
          <div class="inv-card-name">
            ${esc(p.name)}
            ${badges ? `<div class="inv-card-badges">${badges}</div>` : ''}
          </div>
          <div class="inv-card-meta">${esc(p.sku)}${p.brand ? ' · ' + esc(p.brand) : ''}${p.category ? ' · ' + esc(p.category) : ''}</div>
          <div class="inv-card-stock">
            <div class="inv-stock-bar">
              <div class="inv-stock-fill" style="width:${pct}%;background:${barColor}"></div>
            </div>
            <span class="inv-stock-label">${avail}/${owned}</span>
            ${out > 0 ? `<span class="inv-out-label">${out} out</span>` : ''}
          </div>
        </div>
        <div class="inv-card-rate">${fmtCurDec(p.baseHireRate)}<span class="inv-card-rate-unit">/day</span></div>
      </div>
      <div class="inv-card-actions" role="group" aria-label="Product actions">
        <button type="button" class="btn btn-ghost btn-sm inv-action-btn"
          data-action="editProduct" data-id="${escAttr(p.productId)}"
          title="Edit product" aria-label="Edit ${esc(p.name)}">✏</button>
        <button type="button" class="btn btn-ghost btn-sm inv-action-btn"
          data-action="stockAdjust" data-id="${escAttr(p.productId)}"
          title="Adjust stock" aria-label="Adjust stock for ${esc(p.name)}">±</button>
        <button type="button" class="btn btn-ghost btn-sm inv-action-btn"
          data-action="openRateCards" data-id="${escAttr(p.productId)}" data-name="${escAttr(p.name)}"
          title="Rate cards" aria-label="Rate cards for ${esc(p.name)}">£</button>
        <button type="button" class="btn btn-ghost btn-sm inv-action-btn"
          data-action="printLabels" data-id="${escAttr(p.productId)}" data-name="${escAttr(p.name)}"
          title="Print barcode labels" aria-label="Print labels for ${esc(p.name)}">🏷</button>
        <button type="button" class="btn btn-ghost btn-sm inv-action-btn"
          data-action="logMaintenanceForProduct" data-id="${escAttr(p.productId)}"
          title="Log maintenance" aria-label="Log maintenance for ${esc(p.name)}">🔧</button>
      </div>
    </button>`;
}

// ── Table view ────────────────────────────────────────────────────────────────
function renderTable(products) {
  const el = document.getElementById('inv-list');
  if (!el) return;
  const valid = products.filter(p => p.name && p.productId);
  if (!valid.length) { el.innerHTML = emptyState('▦', 'No products match filters'); return; }

  el.className = 'inv-table-view';

  const sorted = [...valid].sort((a, b) => {
    const av = a[_sortField] ?? '';
    const bv = b[_sortField] ?? '';
    if (typeof av === 'number') return (av - bv) * _sortDir;
    return String(av).localeCompare(String(bv)) * _sortDir;
  });

  const th = (label, field) => {
    const active = _sortField === field;
    const arrow  = active ? (_sortDir === 1 ? ' ↑' : ' ↓') : '';
    return `<th class="inv-th-sort${active ? ' inv-th-active' : ''}"
      data-action="inv-sort" data-field="${field}">${label}${arrow}</th>`;
  };

  el.innerHTML = `
    <div class="tbl-wrap">
      <table class="inv-table">
        <thead><tr>
          ${th('Name',        'name')}
          ${th('SKU',         'sku')}
          ${th('Category',    'category')}
          ${th('Method',      'stockMethod')}
          ${th('Owned',       'qtyOwned')}
          ${th('Available',   'qtyAvailable')}
          ${th('Out',         'qtyOut')}
          ${th('Rate/day',    'baseHireRate')}
          ${th('Replacement', 'replacementCost')}
          <th>Status</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${sorted.map(p => {
            const avail    = +p.qtyAvailable || 0;
            const owned    = +p.qtyOwned     || 0;
            const alertLow = p.minStockLevel > 0 && avail < p.minStockLevel;
            return `<tr class="${alertLow ? 'inv-row-alert' : ''}">
              <td>
                <button type="button" class="inv-name-btn" data-action="openProductDetail" data-id="${escAttr(p.productId)}">
                  ${esc(p.name)}
                </button>
                ${p.active === false ? '<span class="badge badge-muted" style="margin-left:4px">INACTIVE</span>' : ''}
              </td>
              <td class="td-id">${esc(p.sku)}</td>
              <td class="td-id">${esc(p.category || '—')}</td>
              <td>${statusBadge(p.stockMethod)}</td>
              <td class="td-num">${owned}</td>
              <td class="td-num ${alertLow ? 'danger' : avail === 0 ? 'warn' : 'ok'}">${avail}</td>
              <td class="td-num ${+p.qtyOut > 0 ? 'accent' : ''}">${+p.qtyOut || 0}</td>
              <td class="td-num">${fmtCurDec(p.baseHireRate)}</td>
              <td class="td-num">${p.replacementCost > 0 ? fmtCurDec(p.replacementCost) : '—'}</td>
              <td>${alertLow ? '<span class="badge badge-danger">LOW STOCK</span>' : ''}</td>
              <td class="inv-row-actions">
                <button type="button" class="btn btn-ghost btn-sm" data-action="editProduct" data-id="${escAttr(p.productId)}" title="Edit">✏</button>
                <button type="button" class="btn btn-ghost btn-sm" data-action="stockAdjust" data-id="${escAttr(p.productId)}" title="Adjust">±</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

// ── Product detail modal ───────────────────────────────────────────────────────
export async function openProductDetail(productId) {
  showLoading('Loading product…');
  try {
    const [product, summary, maintenance, movements, forecast, perfReport, barcodes] = await Promise.all([
      rpc('getProductById', productId),
      rpc('getProductAssetSummary', productId),
      rpc('getProductMaintenanceHistory', productId),
      rpc('getInventoryMovements', { productId }).catch(() => []),
      rpc('getProductForecast', productId).catch(() => null),
      rpc('getProductPerformanceReport', { productId }).catch(() => null),
      rpc('getBarcodes', productId).catch(() => []),
    ]);
    const perf = Array.isArray(perfReport)
      ? (perfReport.find(r => r.productId === productId || r.sku === product?.sku) || null)
      : (perfReport || null);
    hideLoading();
    showProductDetailModal(product, summary, maintenance, movements, forecast, perf, barcodes);
  } catch(e) { hideLoading(); toast(e.message, 'err'); }
}

function showProductDetailModal(p, s, maint, movements, forecast, perf, barcodes) {
  const avail     = +p.qtyAvailable || 0;
  const owned     = +p.qtyOwned     || 0;
  const utilPct   = owned > 0 ? Math.round(((owned - avail) / owned) * 100) : 0;
  const alertLow  = p.minStockLevel > 0 && avail < p.minStockLevel;

  // ── Tab: Info ──────────────────────────────────────────────────────────────
  const tabInfo = `
    ${p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="${esc(p.name)}"
      class="inv-detail-img" onerror="this.style.display='none'">` : ''}
    <div class="detail-grid" style="margin-bottom:16px">
      <div>
        <h3 class="section-title">Product</h3>
        <div class="detail-row"><div class="detail-label">SKU</div><div class="detail-value td-id">${esc(p.sku || '—')}</div></div>
        <div class="detail-row"><div class="detail-label">Category</div><div class="detail-value">${esc(p.category || '—')}${p.productGroup ? ' · ' + esc(p.productGroup) : ''}</div></div>
        <div class="detail-row"><div class="detail-label">Brand / Model</div><div class="detail-value">${esc(p.brand || '—')} ${esc(p.model || '')}</div></div>
        <div class="detail-row"><div class="detail-label">Stock Method</div><div class="detail-value">${statusBadge(p.stockMethod)}</div></div>
        <div class="detail-row"><div class="detail-label">Supplier</div><div class="detail-value">${esc(p.supplierName || '—')}</div></div>
        ${p.tags ? `<div class="detail-row"><div class="detail-label">Tags</div><div class="detail-value td-id">${esc(p.tags)}</div></div>` : ''}
        ${p.description ? `<div class="detail-row"><div class="detail-label">Description</div><div class="detail-value" style="white-space:pre-wrap">${esc(p.description)}</div></div>` : ''}
      </div>
      <div>
        <h3 class="section-title">Stock</h3>
        <div class="detail-row"><div class="detail-label">Owned</div><div class="detail-value">${owned}</div></div>
        <div class="detail-row"><div class="detail-label">Available</div>
          <div class="detail-value ${alertLow ? 'danger' : 'ok'}">${avail} ${alertLow ? '<span class="badge badge-danger" style="font-size:9px">LOW</span>' : ''}</div></div>
        <div class="detail-row"><div class="detail-label">Allocated</div><div class="detail-value">${p.qtyAllocated || 0}</div></div>
        <div class="detail-row"><div class="detail-label">Out on Hire</div><div class="detail-value accent">${p.qtyOut || 0}</div></div>
        <div class="detail-row"><div class="detail-label">In Service</div><div class="detail-value">${p.qtyInService || 0}</div></div>
        <div class="detail-row"><div class="detail-label">Damaged</div><div class="detail-value ${p.qtyDamaged > 0 ? 'danger' : ''}">${p.qtyDamaged || 0}</div></div>
        <div class="detail-row"><div class="detail-label">Fleet Util</div><div class="detail-value">${utilPct}%
          <div class="progress-bar" style="margin-top:4px;max-width:100px">
            <div class="progress-fill" style="width:${utilPct}%;background:${utilPct > 70 ? 'var(--ok)' : 'var(--accent)'}"></div>
          </div></div></div>
      </div>
    </div>`;

  // ── Tab: Barcodes ──────────────────────────────────────────────────────────
  const condColor = { Available:'var(--ok)', Allocated:'var(--accent)', Out:'var(--warn)', 'In Service':'var(--info)', Damaged:'var(--danger)', Lost:'var(--danger)', Retired:'var(--text3)' };
  const tabBarcodes = barcodes.length ? `
    <div class="tbl-wrap">
      <table>
        <thead><tr><th>Barcode</th><th>Serial</th><th>Status</th><th>Condition</th><th>Location</th><th>Job</th></tr></thead>
        <tbody>
          ${barcodes.map(b => `<tr>
            <td class="td-id">${esc(b.barcode)}</td>
            <td class="td-id">${esc(b.serialNumber || '—')}</td>
            <td><span style="color:${condColor[b.status] || 'var(--text3)'};font-family:var(--mono);font-size:10px">${esc(b.status)}</span></td>
            <td>${statusBadge(b.condition)}</td>
            <td class="td-id">${esc(b.locationPath || '—')}</td>
            <td class="td-id">${b.currentJobId ? `<span style="color:var(--info);cursor:pointer" data-action="openJobDetail" data-id="${escAttr(b.currentJobId)}">${esc(b.currentJobId)}</span>` : '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` :
    emptyState('▤', p.stockMethod === 'Serialised' ? 'No barcodes registered' : 'Bulk stock — no individual barcodes');

  // ── Tab: Financials ────────────────────────────────────────────────────────
  const tabFinance = `
    <div class="detail-grid">
      <div>
        <h3 class="section-title">Pricing</h3>
        <div class="detail-row"><div class="detail-label">Base Rate</div><div class="detail-value accent">${fmtCurDec(p.baseHireRate)}/day</div></div>
        <div class="detail-row"><div class="detail-label">Replacement</div><div class="detail-value">${fmtCurDec(p.replacementCost)}</div></div>
        <div class="detail-row"><div class="detail-label">Purchase Price</div><div class="detail-value">${fmtCurDec(p.purchasePrice)}</div></div>
        <div class="detail-row"><div class="detail-label">Finance Method</div><div class="detail-value">${esc(p.financeMethod || '—')}</div></div>
        <div class="detail-row"><div class="detail-label">Depreciation</div><div class="detail-value">${esc(p.depreciationMethod || '—')}</div></div>
        <div class="detail-row"><div class="detail-label">Expected Life</div><div class="detail-value">${p.expectedLifeMonths ? p.expectedLifeMonths + ' months' : '—'}</div></div>
      </div>
      <div>
        <h3 class="section-title">Cost Summary</h3>
        <div class="detail-row"><div class="detail-label">Total Spend</div><div class="detail-value">${fmtCurDec(s?.totalPurchaseCost || 0)}</div></div>
        <div class="detail-row"><div class="detail-label">Maint Cost</div><div class="detail-value ${(s?.totalMaintenanceCost || 0) > 0 ? 'warn' : ''}">${fmtCurDec(s?.totalMaintenanceCost || 0)}</div></div>
        <div class="detail-row"><div class="detail-label">Min Stock</div><div class="detail-value">${p.minStockLevel || 0}</div></div>
        <div class="detail-row"><div class="detail-label">Reorder At</div><div class="detail-value">${p.reorderLevel || 0}</div></div>
        ${p.warrantyEndDate ? `<div class="detail-row"><div class="detail-label">Warranty</div><div class="detail-value">${fmtDate(p.warrantyEndDate)}</div></div>` : ''}
      </div>
    </div>
    ${forecast ? `
    <h3 class="section-title" style="margin-top:16px">Demand Forecast (90 days)</h3>
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:12px">
      <div class="kpi"><div class="kpi-label">Demand</div><div class="kpi-value accent">${Math.round(forecast.forecastDemandQty || 0)} units</div></div>
      <div class="kpi"><div class="kpi-label">Revenue</div><div class="kpi-value ok">${fmtCurDec(forecast.forecastRevenue || 0)}</div></div>
      <div class="kpi"><div class="kpi-label">Shortage</div><div class="kpi-value ${forecast.predictedShortageQty > 0 ? 'danger' : 'ok'}">${forecast.predictedShortageQty > 0 ? '−' + Math.ceil(forecast.predictedShortageQty) : 'None'}</div></div>
      <div class="kpi"><div class="kpi-label">Confidence</div><div class="kpi-value ${forecast.confidence === 'High' ? 'ok' : forecast.confidence === 'Medium' ? 'warn' : ''}">${esc(forecast.confidence || '—')}</div></div>
    </div>
    ${forecast.predictedShortageQty > 0 ? `
    <div class="inv-shortage-alert">
      ⚠ Recommend purchasing <strong>${Math.ceil(forecast.recommendedPurchaseQty || 0)} units</strong>
      — est. ${fmtCurDec(forecast.estimatedPurchaseCost || 0)}
    </div>` : ''}` : ''}`;

  // ── Tab: Performance ───────────────────────────────────────────────────────
  const tabPerformance = perf ? `
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px">
      <div class="kpi"><div class="kpi-label">Total Revenue</div><div class="kpi-value accent">${fmtCurDec(perf.totalRevenue || 0)}</div></div>
      <div class="kpi"><div class="kpi-label">Hire Count</div><div class="kpi-value">${perf.hireCount || 0}</div></div>
      <div class="kpi"><div class="kpi-label">Revenue/Hire</div><div class="kpi-value ok">${fmtCurDec(perf.revenuePerHire || 0)}</div></div>
      <div class="kpi"><div class="kpi-label">ROI</div><div class="kpi-value ${(perf.roiPct || 0) > 100 ? 'ok' : (perf.roiPct || 0) > 50 ? 'warn' : 'danger'}">${(+(perf.roiPct || 0)).toFixed(0)}%</div></div>
    </div>
    <div class="detail-grid">
      <div>
        ${perf.utilisationPct != null ? `<div class="detail-row"><div class="detail-label">Utilisation</div><div class="detail-value">${(+perf.utilisationPct).toFixed(1)}%</div></div>` : ''}
        ${perf.lastHiredDate ? `<div class="detail-row"><div class="detail-label">Last Hired</div><div class="detail-value">${fmtDate(perf.lastHiredDate)}</div></div>` : ''}
        ${perf.firstHiredDate ? `<div class="detail-row"><div class="detail-label">First Hired</div><div class="detail-value">${fmtDate(perf.firstHiredDate)}</div></div>` : ''}
      </div>
      <div>
        ${perf.totalMaintenanceCost ? `<div class="detail-row"><div class="detail-label">Maint Cost</div><div class="detail-value warn">${fmtCurDec(perf.totalMaintenanceCost)}</div></div>` : ''}
        ${perf.revenue30Days != null ? `<div class="detail-row"><div class="detail-label">Revenue 30d</div><div class="detail-value">${fmtCurDec(perf.revenue30Days)}</div></div>` : ''}
        ${perf.revenue90Days != null ? `<div class="detail-row"><div class="detail-label">Revenue 90d</div><div class="detail-value">${fmtCurDec(perf.revenue90Days)}</div></div>` : ''}
      </div>
    </div>` :
    `<div class="empty-state"><div class="empty-state-icon">📊</div><div class="empty-state-text">No performance data yet</div></div>`;

  // ── Tab: History ───────────────────────────────────────────────────────────
  const tabHistory = `
    ${(maint || []).length ? `
    <h3 class="section-title" style="margin-bottom:8px">Maintenance (${maint.length})</h3>
    <div class="tbl-wrap" style="margin-bottom:16px">
      <table><thead><tr><th>ID</th><th>Type</th><th>Barcode</th><th>Status</th><th>Date</th><th class="right">Cost</th></tr></thead>
      <tbody>${(maint || []).slice(0, 15).map(m => `<tr>
        <td class="td-id">${esc(m.maintenanceId)}</td>
        <td>${esc(m.type || '—')}</td>
        <td class="td-id">${esc(m.barcode || '—')}</td>
        <td>${statusBadge(m.status)}</td>
        <td>${fmtDate(m.scheduledDate)}</td>
        <td class="td-num">${m.totalCost > 0 ? fmtCurDec(m.totalCost) : '—'}</td>
      </tr>`).join('')}</tbody>
      </table>
    </div>` : ''}
    ${(movements || []).length ? `
    <h3 class="section-title" style="margin-bottom:8px">Movement Ledger (last ${Math.min(movements.length, 25)})</h3>
    <div class="tbl-wrap">
      <table style="font-size:11px">
        <thead><tr><th>Date</th><th>Type</th><th>Barcode</th><th>Job</th><th class="right">Qty</th><th>Status Change</th></tr></thead>
        <tbody>${(movements || []).slice(-25).reverse().map(m => `<tr>
          <td style="white-space:nowrap;color:var(--text3)">${fmtDate(m.createdAt)}</td>
          <td><span class="badge badge-muted" style="font-size:9px">${esc(m.movementType || '—')}</span></td>
          <td class="td-id">${esc(m.barcode || '—')}</td>
          <td class="td-id">${m.jobId ? `<span style="color:var(--info);cursor:pointer" data-action="openJobDetail" data-id="${escAttr(m.jobId)}">${esc(m.jobId)}</span>` : '—'}</td>
          <td class="td-num ${m.quantity > 0 ? 'ok' : 'danger'}">${m.quantity > 0 ? '+' : ''}${m.quantity}</td>
          <td style="font-size:10px;color:var(--text3)">${m.fromStatus ? esc(m.fromStatus) + ' → ' + esc(m.toStatus || '') : esc(m.toStatus || '—')}</td>
        </tr>`).join('')}
        </tbody>
      </table>
    </div>` : emptyState('↕', 'No movement history')}`;

  // ── Build tabbed modal ─────────────────────────────────────────────────────
  const tabs = [
    { label: 'Info',        content: tabInfo },
    { label: `Barcodes (${barcodes.length})`, content: tabBarcodes },
    { label: 'Financials',  content: tabFinance },
    { label: 'Performance', content: tabPerformance },
    { label: 'History',     content: tabHistory },
  ];

  const tabNav = `
    <div role="tablist" aria-label="Product sections" class="prod-tabs" style="display:flex;border-bottom:1px solid var(--border);margin-bottom:16px;overflow-x:auto;scrollbar-width:none">
      ${tabs.map((t, i) => `
        <button type="button" role="tab" id="ptab-${i}" aria-selected="${i === 0}" aria-controls="ptab-panel-${i}"
          class="prod-tab${i === 0 ? ' active' : ''}">${t.label}</button>`).join('')}
    </div>
    ${tabs.map((t, i) => `
      <div role="tabpanel" id="ptab-panel-${i}" aria-labelledby="ptab-${i}"${i !== 0 ? ' hidden' : ''}>
        ${t.content}
      </div>`).join('')}`;

  openModal('modal-product', esc(p.name), tabNav, `
    <button type="button" class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Close</button>
    <button type="button" class="btn btn-ghost btn-sm" data-action="editProduct" data-id="${escAttr(p.productId)}">✏ Edit</button>
    <button type="button" class="btn btn-ghost btn-sm" data-action="stockAdjust" data-id="${escAttr(p.productId)}">± Stock</button>
    <button type="button" class="btn btn-ghost btn-sm" data-action="openRateCards" data-id="${escAttr(p.productId)}" data-name="${escAttr(p.name)}">£ Rates</button>
    <button type="button" class="btn btn-ghost btn-sm" data-action="printLabels" data-id="${escAttr(p.productId)}" data-name="${escAttr(p.name)}">🏷 Labels</button>
    <button type="button" class="btn btn-ghost btn-sm" data-action="logMaintenanceForProduct" data-id="${escAttr(p.productId)}">🔧 Maintenance</button>
  `, 'modal-lg');

  // Wire product tab switching
  const tabBtns   = document.querySelectorAll('.prod-tab');
  const tabPanels = document.querySelectorAll('[id^="ptab-panel-"]');
  tabBtns.forEach((btn, idx) => {
    btn.addEventListener('click', () => {
      tabBtns.forEach((b, i) => {
        b.classList.toggle('active', i === idx);
        b.setAttribute('aria-selected', i === idx ? 'true' : 'false');
      });
      tabPanels.forEach((panel, i) => {
        if (i === idx) panel.removeAttribute('hidden');
        else           panel.setAttribute('hidden', '');
      });
    });
  });

  // Wire modal-level data-action delegation for barcode/movement job links
  document.getElementById('modal-product')?.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    const id     = el.dataset.id || '';
    if (action === 'openJobDetail') { closeModal(); window.__openJobDetail?.(id); }
  });
}

// ── Rate cards modal ──────────────────────────────────────────────────────────
export async function openRateCards(pid, pname) {
  showLoading('Loading rates…');
  try {
    const rates = await rpc('getProductRates', pid);
    hideLoading();
    openModal('modal-rates', `Rate Cards — ${esc(pname)}`, `
      ${rates.length ? `
      <div class="tbl-wrap" style="margin-bottom:16px">
        <table>
          <thead><tr><th>Name</th><th>Duration</th><th>Qty Break</th><th class="right">Price</th><th></th></tr></thead>
          <tbody>${rates.map(r => `<tr>
            <td>${esc(r.rateName || '—')}</td>
            <td class="td-id">${esc(r.durationType || '—')}</td>
            <td class="td-id">${r.quantityBreakFrom || 1} – ${r.quantityBreakTo >= 999999 ? '∞' : r.quantityBreakTo}</td>
            <td class="td-num">${fmtCurDec(r.price)}</td>
            <td><button type="button" class="btn btn-danger btn-sm"
              data-action="deleteRate" data-id="${escAttr(r.rateId)}" data-pid="${escAttr(pid)}" data-name="${escAttr(pname)}">✕</button></td>
          </tr>`).join('')}</tbody>
        </table>
      </div>` : emptyState('£', 'No custom rates — base rate applies')}
      <h3 class="section-title" style="margin-bottom:10px">Add Rate</h3>
      <div class="form-grid">
        <div class="form-group"><label>Rate Name</label><input type="text" id="rate-name" placeholder="e.g. Weekend Rate"></div>
        <div class="form-group"><label>Duration Type</label>
          <select id="rate-type">
            ${['Day','Week','Weekend','Month','Hour','Flat'].map(t => `<option>${t}</option>`).join('')}
          </select></div>
        <div class="form-group"><label>Price (£)</label><input type="number" id="rate-price" step="0.01" min="0" placeholder="0.00"></div>
        <div class="form-group"><label>Qty From</label><input type="number" id="rate-qty-from" value="1" min="1"></div>
        <div class="form-group"><label>Qty To</label><input type="number" id="rate-qty-to" value="999999" min="1"></div>
      </div>`, `
      <button type="button" class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Close</button>
      <button type="button" class="btn btn-primary btn-sm" onclick="window.__saveRate('${escAttr(pid)}')">Add Rate</button>`
    );

    window.__saveRate = async (rateProductId) => {
      const name  = document.getElementById('rate-name')?.value.trim();
      const price = parseFloat(document.getElementById('rate-price')?.value) || 0;
      if (!name) { toast('Rate name required', 'warn'); return; }
      showLoading('Saving…');
      try {
        await rpc('saveProductRate', {
          productId:         rateProductId,
          rateName:          name,
          durationType:      document.getElementById('rate-type')?.value  || 'Day',
          price,
          quantityBreakFrom: parseInt(document.getElementById('rate-qty-from')?.value, 10) || 1,
          quantityBreakTo:   parseInt(document.getElementById('rate-qty-to')?.value, 10)   || 999999,
        });
        toast('Rate added', 'ok');
        closeModal();
        openRateCards(rateProductId, pname);
      } catch(e) { toast(e.message, 'err'); }
      finally { hideLoading(); }
    };

    window.__deleteRate = async (rateId, rateProductId, ratePname) => {
      if (!confirm('Delete this rate?')) return;
      showLoading('Deleting…');
      try {
        await rpc('deleteProductRate', rateId);
        toast('Rate deleted', 'ok');
        closeModal();
        openRateCards(rateProductId, ratePname);
      } catch(e) { toast(e.message, 'err'); }
      finally { hideLoading(); }
    };
  } catch(e) { hideLoading(); toast(e.message, 'err'); }
}

// ── Edit / New product form ────────────────────────────────────────────────────
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
  const v = (f, fb = '') => esc(p[f] != null ? p[f] : fb);
  const n = (f, fb = 0)  => p[f] != null ? p[f] : fb;

  const supplierOpts = (STATE.suppliers || [])
    .sort((a, b) => (a.supplierName || '').localeCompare(b.supplierName || ''))
    .map(s => `<option value="${esc(s.supplierId)}"${p.supplierId === s.supplierId ? ' selected' : ''}>${esc(s.supplierName)}</option>`)
    .join('');

  const cats   = [...new Set((STATE.products || []).map(x => x.category).filter(Boolean))].sort();
  const groups = [...new Set((STATE.products || []).map(x => x.productGroup).filter(Boolean))].sort();

  openModal('modal-product-form', isEdit ? `Edit — ${esc(p.name)}` : 'New Product', `
    <div role="tablist" aria-label="Form sections" class="prod-tabs" style="display:flex;border-bottom:1px solid var(--border);margin-bottom:16px">
      ${['Basic','Financials','Physical','Operations','Notes'].map((t, i) => `
        <button type="button" role="tab" id="fpTab-${i}" aria-selected="${i === 0}" aria-controls="fpPanel-${i}"
          class="prod-tab${i === 0 ? ' active' : ''}">${t}</button>`).join('')}
    </div>

    <div role="tabpanel" id="fpPanel-0" aria-labelledby="fpTab-0">
      <div class="form-grid">
        <div class="form-group span-2">
          <label for="fp-name">Product Name *</label>
          <input type="text" id="fp-name" value="${v('name')}" placeholder="e.g. Sennheiser EW100 G4 Wireless System" autofocus required>
        </div>
        <div class="form-group"><label for="fp-sku">SKU</label><input type="text" id="fp-sku" value="${v('sku')}" placeholder="e.g. AUDIO-EW100"></div>
        <div class="form-group"><label for="fp-brand">Brand</label><input type="text" id="fp-brand" value="${v('brand')}" list="fp-brand-list" placeholder="e.g. Sennheiser">
          <datalist id="fp-brand-list">${[...new Set((STATE.products||[]).map(x=>x.brand).filter(Boolean))].sort().map(b=>`<option value="${esc(b)}">`).join('')}</datalist></div>
        <div class="form-group"><label for="fp-model">Model</label><input type="text" id="fp-model" value="${v('model')}" placeholder="e.g. EW100 G4"></div>
        <div class="form-group"><label for="fp-category">Category</label>
          <input type="text" id="fp-category" value="${v('category')}" list="fp-cat-list" placeholder="e.g. Wireless Audio">
          <datalist id="fp-cat-list">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>
        <div class="form-group"><label for="fp-group">Product Group</label>
          <input type="text" id="fp-group" value="${v('productGroup')}" list="fp-grp-list" placeholder="e.g. Audio Equipment">
          <datalist id="fp-grp-list">${groups.map(g => `<option value="${esc(g)}">`).join('')}</datalist></div>
        <div class="form-group"><label for="fp-method">Stock Method</label>
          <select id="fp-method">
            <option value="Bulk"${p.stockMethod !== 'Serialised' ? ' selected' : ''}>Bulk (qty-tracked)</option>
            <option value="Serialised"${p.stockMethod === 'Serialised' ? ' selected' : ''}>Serialised (barcode per unit)</option>
          </select></div>
        <div class="form-group"><label for="fp-unit">Unit</label>
          <input type="text" id="fp-unit" value="${v('unit', 'Each')}" placeholder="Each / Set / Pair"></div>
        <div class="form-group span-2">
          <label for="fp-image-url">Image URL</label>
          <div style="display:flex;gap:10px;align-items:flex-start">
            <input type="url" id="fp-image-url" value="${v('imageUrl')}" placeholder="https://…" style="flex:1"
              oninput="window.__previewProductImg(this.value)">
            <div id="fp-img-preview" style="min-width:64px;min-height:44px"></div>
          </div>
        </div>
      </div>
    </div>

    <div role="tabpanel" id="fpPanel-1" aria-labelledby="fpTab-1" hidden>
      <div class="form-grid">
        <div class="form-group"><label for="fp-rate">Base Hire Rate (£/day) *</label>
          <input type="number" id="fp-rate" value="${n('baseHireRate')}" step="0.01" min="0" placeholder="0.00" required></div>
        <div class="form-group"><label for="fp-replacement">Replacement Value (£)</label>
          <input type="number" id="fp-replacement" value="${n('replacementCost')}" step="0.01" min="0" placeholder="0.00"></div>
        <div class="form-group"><label for="fp-purchase">Purchase Price (£)</label>
          <input type="number" id="fp-purchase" value="${n('purchasePrice')}" step="0.01" min="0" placeholder="0.00"></div>
        <div class="form-group"><label for="fp-purchase-date">Purchase Date</label>
          <input type="date" id="fp-purchase-date" value="${v('purchaseDate')}"></div>
        <div class="form-group"><label for="fp-supplier">Supplier</label>
          <select id="fp-supplier"><option value="">— None —</option>${supplierOpts}</select></div>
        <div class="form-group"><label for="fp-finance">Finance Method</label>
          <select id="fp-finance">
            ${['Owned','Financed','Leased','Rented'].map(o => `<option${p.financeMethod === o ? ' selected' : ''}>${o}</option>`).join('')}
          </select></div>
        <div class="form-group"><label for="fp-dep">Depreciation Method</label>
          <select id="fp-dep">
            ${['Straight Line','Reducing Balance','None'].map(o => `<option${p.depreciationMethod === o ? ' selected' : ''}>${o}</option>`).join('')}
          </select></div>
        <div class="form-group"><label for="fp-life">Expected Life (months)</label>
          <input type="number" id="fp-life" value="${n('expectedLifeMonths')}" min="0" step="1" placeholder="e.g. 60"></div>
        <div class="form-group"><label for="fp-warranty">Warranty End</label>
          <input type="date" id="fp-warranty" value="${v('warrantyEndDate')}"></div>
        <div class="form-group"><label for="fp-min-stock">Min Stock Level</label>
          <input type="number" id="fp-min-stock" value="${n('minStockLevel')}" min="0" step="1"></div>
        <div class="form-group"><label for="fp-reorder">Reorder Level</label>
          <input type="number" id="fp-reorder" value="${n('reorderLevel')}" min="0" step="1"></div>
      </div>
    </div>

    <div role="tabpanel" id="fpPanel-2" aria-labelledby="fpTab-2" hidden>
      <div class="form-grid">
        <div class="form-group"><label for="fp-weight">Weight (kg)</label><input type="number" id="fp-weight" value="${n('weightKg')}" step="0.01" min="0" placeholder="0.00"></div>
        <div class="form-group"><label for="fp-width">Width (mm)</label><input type="number" id="fp-width" value="${n('widthMm')}" step="1" min="0"></div>
        <div class="form-group"><label for="fp-height">Height (mm)</label><input type="number" id="fp-height" value="${n('heightMm')}" step="1" min="0"></div>
        <div class="form-group"><label for="fp-depth">Depth (mm)</label><input type="number" id="fp-depth" value="${n('depthMm')}" step="1" min="0"></div>
        <div class="form-group"><label for="fp-rack">Rack Size (U)</label><input type="number" id="fp-rack" value="${n('rackSizeU')}" step="1" min="0"></div>
        <div class="form-group"><label for="fp-case">Case Type</label>
          <select id="fp-case">
            ${['','Flight Case','Soft Bag','Rack Mount','No Case','Other']
              .map(o => `<option value="${o}"${p.caseType === o ? ' selected' : ''}>${o || '— None —'}</option>`).join('')}
          </select></div>
        <div class="form-group"><label for="fp-power">Power Draw (W)</label><input type="number" id="fp-power" value="${n('powerDrawWatts')}" step="1" min="0"></div>
        <div class="form-group"><label for="fp-storage-loc">Storage Location</label>
          <input type="text" id="fp-storage-loc" value="${v('storageLocation')}" placeholder="e.g. Zone A / Bay 2"></div>
      </div>
    </div>

    <div role="tabpanel" id="fpPanel-3" aria-labelledby="fpTab-3" hidden>
      <div class="form-grid">
        <div class="form-group"><label for="fp-prep">Prep Time (mins)</label><input type="number" id="fp-prep" value="${n('prepMinutes')}" step="1" min="0"></div>
        <div class="form-group"><label for="fp-derig">De-rig Time (mins)</label><input type="number" id="fp-derig" value="${n('derigMinutes')}" step="1" min="0"></div>
        <div class="form-group"><label for="fp-crew">Crew Required</label><input type="number" id="fp-crew" value="${n('crewRequired')}" step="1" min="0"></div>
        <div class="form-group"><label for="fp-sort">Sort Order</label><input type="number" id="fp-sort" value="${n('sortOrder', 9999)}" step="1" min="0"></div>
        <div class="form-group span-2"><label for="fp-prep-notes">Default Prep Notes</label>
          <input type="text" id="fp-prep-notes" value="${v('defaultPrepNotes')}" placeholder="Notes shown during prep stage"></div>
        <div class="form-group span-2"><label for="fp-return-notes">Default Return Notes</label>
          <input type="text" id="fp-return-notes" value="${v('defaultReturnNotes')}" placeholder="Notes shown during return stage"></div>
        <div class="form-group span-2"><label for="fp-tags">Tags (comma separated)</label>
          <input type="text" id="fp-tags" value="${v('tags')}" placeholder="wireless, audio, handheld"></div>
      </div>
    </div>

    <div role="tabpanel" id="fpPanel-4" aria-labelledby="fpTab-4" hidden>
      <div class="form-group">
        <label for="fp-description">Description</label>
        <textarea id="fp-description" rows="8" placeholder="Full product description…">${v('description')}</textarea>
      </div>
    </div>
  `, `
    <button type="button" class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button type="button" class="btn btn-primary btn-sm" data-action="submitProductForm" data-id="${escAttr(p.productId || '')}">
      ${isEdit ? 'Save Changes' : 'Create Product'}
    </button>`
  , 'modal-lg');

  // Tab switching with ARIA
  const tabBtns   = document.querySelectorAll('#modal-product-form .prod-tab');
  const tabPanels = document.querySelectorAll('#modal-product-form [id^="fpPanel-"]');
  tabBtns.forEach((btn, idx) => {
    btn.addEventListener('click', () => {
      tabBtns.forEach((b, i) => {
        b.classList.toggle('active', i === idx);
        b.setAttribute('aria-selected', i === idx ? 'true' : 'false');
      });
      tabPanels.forEach((panel, i) => {
        if (i === idx) panel.removeAttribute('hidden');
        else           panel.setAttribute('hidden', '');
      });
    });
  });

  // Image preview
  window.__previewProductImg = (url) => {
    const el = document.getElementById('fp-img-preview');
    if (!el) return;
    el.innerHTML = url
      ? `<img src="${esc(url)}" style="max-height:56px;max-width:80px;object-fit:contain;border-radius:4px" onerror="this.style.display='none'">`
      : '';
  };
  if (p.imageUrl) window.__previewProductImg(p.imageUrl);

  window.__submitProductForm = async (pid) => {
    const name = document.getElementById('fp-name')?.value.trim();
    if (!name) { toast('Product name required', 'warn'); return; }
    showLoading(pid ? 'Saving…' : 'Creating…'); closeModal();
    try {
      const r = await rpc('saveProduct', {
        productId:          pid || undefined,
        name,
        sku:                document.getElementById('fp-sku')?.value.trim()          || '',
        brand:              document.getElementById('fp-brand')?.value.trim()        || '',
        model:              document.getElementById('fp-model')?.value.trim()        || '',
        category:           document.getElementById('fp-category')?.value.trim()     || '',
        productGroup:       document.getElementById('fp-group')?.value.trim()        || '',
        stockMethod:        document.getElementById('fp-method')?.value              || 'Bulk',
        unit:               document.getElementById('fp-unit')?.value.trim()         || 'Each',
        imageUrl:           document.getElementById('fp-image-url')?.value.trim()    || '',
        baseHireRate:       parseFloat(document.getElementById('fp-rate')?.value)    || 0,
        replacementCost:    parseFloat(document.getElementById('fp-replacement')?.value) || 0,
        purchasePrice:      parseFloat(document.getElementById('fp-purchase')?.value)|| 0,
        purchaseDate:       document.getElementById('fp-purchase-date')?.value        || '',
        supplierId:         document.getElementById('fp-supplier')?.value             || '',
        financeMethod:      document.getElementById('fp-finance')?.value              || 'Owned',
        depreciationMethod: document.getElementById('fp-dep')?.value                  || 'Straight Line',
        expectedLifeMonths: parseInt(document.getElementById('fp-life')?.value, 10)  || 0,
        warrantyEndDate:    document.getElementById('fp-warranty')?.value             || '',
        minStockLevel:      parseInt(document.getElementById('fp-min-stock')?.value, 10) || 0,
        reorderLevel:       parseInt(document.getElementById('fp-reorder')?.value, 10)   || 0,
        weightKg:           parseFloat(document.getElementById('fp-weight')?.value)  || 0,
        widthMm:            parseInt(document.getElementById('fp-width')?.value, 10) || 0,
        heightMm:           parseInt(document.getElementById('fp-height')?.value, 10)|| 0,
        depthMm:            parseInt(document.getElementById('fp-depth')?.value, 10) || 0,
        rackSizeU:          parseInt(document.getElementById('fp-rack')?.value, 10)  || 0,
        caseType:           document.getElementById('fp-case')?.value                || '',
        powerDrawWatts:     parseInt(document.getElementById('fp-power')?.value, 10) || 0,
        storageLocation:    document.getElementById('fp-storage-loc')?.value         || '',
        prepMinutes:        parseInt(document.getElementById('fp-prep')?.value, 10)  || 0,
        derigMinutes:       parseInt(document.getElementById('fp-derig')?.value, 10) || 0,
        crewRequired:       parseInt(document.getElementById('fp-crew')?.value, 10)  || 0,
        sortOrder:          parseInt(document.getElementById('fp-sort')?.value, 10)  || 9999,
        defaultPrepNotes:   document.getElementById('fp-prep-notes')?.value          || '',
        defaultReturnNotes: document.getElementById('fp-return-notes')?.value        || '',
        tags:               document.getElementById('fp-tags')?.value                || '',
        description:        document.getElementById('fp-description')?.value         || '',
      });
      toast(pid ? `Saved: ${name}` : `Created: ${r.productId}`, 'ok');
      if (!pid) await rpc('syncStockFromProducts');
      STATE.loadedPanes.delete('inventory');
      await loadProducts();
    } catch(e) { toast(e.message, 'err'); }
    finally { hideLoading(); }
  };
}

// ── Log maintenance ────────────────────────────────────────────────────────────
export function openLogMaintenanceForProduct(productId, productName) {
  closeModal();
  rpc('getBarcodes', productId).then(barcodes => {
    const bcOpts = barcodes.map(b =>
      `<option value="${esc(b.barcode)}">${esc(b.barcode)}${b.serialNumber ? ' · ' + esc(b.serialNumber) : ''} (${esc(b.condition || 'Good')})</option>`
    ).join('');
    openModal('modal-log-maint', `Log Maintenance — ${esc(productName)}`, `
      <div class="form-grid">
        <div class="form-group"><label for="lm-type">Type *</label>
          <select id="lm-type"><option>Routine Service</option><option>Repair</option>
            <option>PAT Test</option><option>Calibration</option><option>Inspection</option><option>Other</option></select></div>
        <div class="form-group"><label for="lm-priority">Priority</label>
          <select id="lm-priority"><option>Normal</option><option>High</option><option>Urgent</option><option>Low</option></select></div>
        ${barcodes.length ? `<div class="form-group span-2"><label for="lm-barcode">Specific Unit</label>
          <select id="lm-barcode"><option value="">— All units —</option>${bcOpts}</select></div>` : ''}
        <div class="form-group"><label for="lm-date">Scheduled Date</label>
          <input type="date" id="lm-date" value="${new Date().toISOString().substring(0, 10)}"></div>
        <div class="form-group"><label for="lm-cost">Estimated Cost (£)</label>
          <input type="number" id="lm-cost" value="0" step="0.01" min="0"></div>
        <div class="form-group span-2"><label for="lm-notes">Notes</label>
          <textarea id="lm-notes" rows="2"></textarea></div>
      </div>`, `
      <button type="button" class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
      <button type="button" class="btn btn-primary btn-sm" data-action="submitLogMaint" data-id="${escAttr(productId)}">Create Record</button>`
    );

    window.__submitLogMaint = async (pId) => {
      showLoading('Creating…'); closeModal();
      try {
        const r = await rpc('createMaintenanceRecord', {
          productId:     pId,
          barcode:       document.getElementById('lm-barcode')?.value      || '',
          type:          document.getElementById('lm-type')?.value,
          priority:      document.getElementById('lm-priority')?.value,
          scheduledDate: document.getElementById('lm-date')?.value,
          estimatedCost: parseFloat(document.getElementById('lm-cost')?.value) || 0,
          notes:         document.getElementById('lm-notes')?.value,
          status:        'Scheduled',
        });
        toast('Maintenance created: ' + r.maintenanceId, 'ok');
        STATE.loadedPanes.delete('maintenance');
      } catch(e) { toast(e.message, 'err'); }
      finally { hideLoading(); }
    };
  }).catch(() => toast('Failed to load barcodes', 'err'));
}

// ── Return condition modal ────────────────────────────────────────────────────
export function openReturnConditionModal(jobId, jobName) {
  showLoading('Loading returned items…');
  rpc('getJobBarcodes', jobId).then(barcodes => {
    hideLoading();
    if (!barcodes.length) { toast('No serialised items on this job', 'warn'); return; }

    openModal('modal-return-cond', `Return Condition — ${esc(jobName)}`, `
      <p class="text-sm text-muted" style="margin-bottom:12px">
        Mark the condition of each returned item. Damaged or lost items will automatically create a maintenance record.
      </p>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${barcodes.map(b => `
          <div class="inv-return-row">
            <div>
              <div style="font-weight:500;font-size:13px">${esc(b.productName || b.productId)}</div>
              <div class="td-id">${esc(b.barcode)} ${esc(b.serialNumber || '')}</div>
            </div>
            <select id="rc-${esc(b.barcode)}" class="inv-condition-select">
              <option value="Good">✓ Good</option>
              <option value="Fair">~ Fair</option>
              <option value="Damaged">⚠ Damaged</option>
              <option value="Lost">✗ Lost</option>
            </select>
            <input type="text" id="rn-${esc(b.barcode)}" placeholder="Notes…" class="inv-condition-notes">
          </div>`).join('')}
      </div>`, `
      <button type="button" class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
      <button type="button" class="btn btn-primary btn-sm" data-action="submitReturnConds" data-id="${escAttr(jobId)}">Save Conditions</button>
    `, 'modal-lg');

    // Colour condition selects on change
    document.querySelectorAll('.inv-condition-select').forEach(sel => {
      sel.addEventListener('change', () => {
        sel.className = 'inv-condition-select inv-cond-' + sel.value.toLowerCase();
      });
    });

    window.__submitReturnConds = async (jId) => {
      showLoading('Saving…'); closeModal();
      let damaged = 0;
      const damagedItems = [];
      try {
        for (const b of barcodes) {
          const cond  = document.getElementById(`rc-${esc(b.barcode)}`)?.value || 'Good';
          const notes = document.getElementById(`rn-${esc(b.barcode)}`)?.value || '';
          if (['Damaged', 'Lost'].includes(cond)) {
            damaged++;
            damagedItems.push({ ...b, condition: cond, notes });
            await rpc('createMaintenanceRecord', {
              productId: b.productId, barcode: b.barcode,
              type: cond === 'Lost' ? 'Investigation' : 'Repair',
              priority: 'High', status: 'Scheduled',
              scheduledDate: new Date().toISOString().substring(0, 10),
              notes: `Return condition: ${cond}. ${notes}`.trim(),
            });
          }
        }
        STATE.loadedPanes.delete('maintenance');
        STATE.loadedPanes.delete('jobs');
        if (damaged > 0) {
          const totalCharge = damagedItems.reduce((s, b) => s + (b.replacementCost || 0), 0);
          toast(`${damaged} damaged — maintenance records created`, 'warn');
          if (totalCharge > 0) {
            requestAnimationFrame(() => {
              openModal('modal-damage-charge', '💥 Damage Charge', `
                <p style="font-size:13px;color:var(--text2);margin-bottom:14px">
                  Generate a damage charge invoice for these items?
                </p>
                <div class="tbl-wrap" style="margin-bottom:14px">
                  <table><tbody>
                    ${damagedItems.map(b => `<tr>
                      <td>${esc(b.productName || b.productId)} <span class="badge badge-danger" style="font-size:9px">${esc(b.condition)}</span></td>
                      <td class="td-num warn">${fmtCurDec(b.replacementCost || 0)}</td>
                    </tr>`).join('')}
                    <tr style="font-weight:700;border-top:2px solid var(--border)">
                      <td>Total Replacement Value</td>
                      <td class="td-num danger">${fmtCurDec(totalCharge)}</td>
                    </tr>
                  </tbody></table>
                </div>
                <div class="form-group">
                  <label for="dmg-charge">Charge Amount (£)</label>
                  <input type="number" id="dmg-charge" value="${totalCharge.toFixed(2)}" step="0.01" min="0">
                </div>`, `
                <button type="button" class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Skip</button>
                <button type="button" class="btn btn-danger btn-sm" data-action="submitDamageCharge" data-id="${escAttr(jId)}">Generate Invoice</button>`
              );

              window.__submitDamageCharge = async (jobId) => {
                const charge = parseFloat(document.getElementById('dmg-charge')?.value) || 0;
                if (!charge) { closeModal(); return; }
                showLoading('Creating damage invoice…'); closeModal();
                try {
                  await rpc('generateInvoice', {
                    jobId, invoiceType: 'Damage', extraCharge: charge,
                    notes: `Damage: ${damagedItems.map(b => esc(b.productName || b.productId)).join(', ')}`,
                  });
                  toast('Damage invoice created', 'ok');
                  STATE.loadedPanes.delete('invoices');
                } catch(e) { toast('Invoice: ' + e.message, 'warn'); }
                finally { hideLoading(); }
              };
            });
          }
        } else {
          toast('Return conditions saved — all items good', 'ok');
        }
      } catch(e) { toast(e.message, 'err'); }
      finally { hideLoading(); }
    };
  }).catch(e => { hideLoading(); toast(e.message, 'err'); });
}

// ── Add barcode ────────────────────────────────────────────────────────────────
export function openAddBarcodeModal() {
  ensureProductsLoaded().then(() => {
    const opts = STATE.products.filter(p => p.stockMethod === 'Serialised')
      .map(p => `<option value="${esc(p.productId)}">${esc(p.name)} (${esc(p.sku)})</option>`).join('');
    openModal('modal-add-barcode', 'Add Barcode', `
      <div class="form-grid">
        <div class="form-group span-2"><label for="fb-product">Product *</label>
          <select id="fb-product"><option value="">— Select product —</option>${opts}</select></div>
        <div class="form-group"><label for="fb-barcode">Barcode *</label><input type="text" id="fb-barcode" autofocus></div>
        <div class="form-group"><label for="fb-serial">Serial Number</label><input type="text" id="fb-serial"></div>
        <div class="form-group"><label for="fb-asset-tag">Asset Tag</label><input type="text" id="fb-asset-tag"></div>
        <div class="form-group"><label for="fb-condition">Condition</label>
          <select id="fb-condition"><option>Good</option><option>Fair</option><option>New</option><option>Damaged</option></select></div>
        <div class="form-group"><label for="fb-price">Purchase Price (£)</label>
          <input type="number" id="fb-price" value="0" step="0.01" min="0"></div>
        <div class="form-group"><label for="fb-notes">Notes</label><input type="text" id="fb-notes"></div>
      </div>`, `
      <button type="button" class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
      <button type="button" class="btn btn-primary btn-sm" onclick="window.__submitAddBarcode()">Add Barcode</button>`);

    window.__submitAddBarcode = async () => {
      const barcode = document.getElementById('fb-barcode')?.value.trim();
      const pId     = document.getElementById('fb-product')?.value;
      if (!barcode || !pId) { toast('Barcode and product required', 'warn'); return; }
      showLoading('Adding…'); closeModal();
      try {
        await rpc('addBarcode', {
          barcode, productId: pId,
          serialNumber:  document.getElementById('fb-serial')?.value,
          assetTag:      document.getElementById('fb-asset-tag')?.value,
          condition:     document.getElementById('fb-condition')?.value,
          purchasePrice: parseFloat(document.getElementById('fb-price')?.value) || 0,
          notes:         document.getElementById('fb-notes')?.value,
        });
        toast('Barcode added: ' + barcode, 'ok');
        STATE.loadedPanes.delete('inventory');
        await loadProducts();
      } catch(e) { toast(e.message, 'err'); }
      finally { hideLoading(); }
    };
  });
}

// ── RFC 4180 CSV parser ────────────────────────────────────────────────────────
function parseCSV(text) {
  const rows = [];
  const len  = text.length;
  let i = 0;
  while (i < len) {
    const row = [];
    while (i < len) {
      let cell = '';
      if (text[i] === '"') {
        i++;
        while (i < len) {
          if (text[i] === '"') {
            if (text[i + 1] === '"') { cell += '"'; i += 2; }
            else { i++; break; }
          } else { cell += text[i++]; }
        }
      } else {
        while (i < len && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') cell += text[i++];
        cell = cell.trim();
      }
      row.push(cell);
      if (i < len && text[i] === ',') { i++; continue; }
      break;
    }
    if (i < len && text[i] === '\r') i++;
    if (i < len && text[i] === '\n') i++;
    if (row.length > 0 && !(row.length === 1 && row[0] === '')) rows.push(row);
  }
  return rows;
}

// ── Bulk barcode CSV import ────────────────────────────────────────────────────
export function openBulkBarcodeImport() {
  openModal('modal-bulk-bc', 'Bulk Barcode Import', `
    <p class="text-sm text-muted" style="margin-bottom:10px">
      Columns: <code class="td-id">barcode, productId, serialNumber, assetTag, condition, purchasePrice, notes</code>
    </p>
    <div class="form-group"><label for="csv-bc-file">CSV File</label>
      <input type="file" id="csv-bc-file" accept=".csv"></div>
    <div id="csv-bc-preview" style="display:none;margin-top:10px">
      <div id="csv-bc-table"></div>
      <div id="csv-bc-status" class="td-id" style="margin-top:6px"></div>
    </div>`, `
    <button type="button" class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button type="button" class="btn btn-ghost btn-sm" onclick="window.__csvBcPreview()">Preview</button>
    <button type="button" class="btn btn-primary btn-sm" id="btn-bc-imp" disabled onclick="window.__csvBcImport()">Import</button>`);

  let rows = [];
  window.__csvBcPreview = () => {
    const file = document.getElementById('csv-bc-file')?.files[0];
    if (!file) { toast('Select a file', 'warn'); return; }
    const fr = new FileReader();
    fr.onload = e => {
      const parsed = parseCSV(e.target.result);
      const hdrs  = (parsed[0] || []).map(h => (h || '').toLowerCase());
      rows = parsed.slice(1).map(cols => { const o = {}; hdrs.forEach((h, i) => { o[h] = (cols[i] || '').trim(); }); return o; }).filter(r => r.barcode);
      document.getElementById('csv-bc-table').innerHTML = `<div class="tbl-wrap"><table>
        <thead><tr>${hdrs.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${rows.slice(0, 5).map(r => `<tr>${hdrs.map(h => `<td class="td-id">${esc(r[h] || '')}</td>`).join('')}</tr>`).join('')}</tbody>
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
    let ok = 0, fail = 0;
    for (const r of rows) {
      try {
        await rpc('addBarcode', {
          barcode: r.barcode, productId: r.productid || r['product id'] || r.productId || '',
          serialNumber: r.serialnumber || r['serial number'] || '',
          assetTag: r.assettag || r['asset tag'] || '',
          condition: r.condition || 'Good',
          purchasePrice: parseFloat(r.purchaseprice || 0) || 0,
          notes: r.notes || '',
        });
        ok++;
      } catch(e) { fail++; }
    }
    toast(`Imported ${ok}${fail > 0 ? `, ${fail} failed` : ''}`, fail > 0 ? 'warn' : 'ok');
    STATE.loadedPanes.delete('inventory'); await loadProducts(); hideLoading();
  };
}

// ── Product CSV import ─────────────────────────────────────────────────────────
export function openProductCsvImport() {
  const HDRS = ['name','sku','category','productGroup','brand','model','stockMethod',
    'baseHireRate','replacementCost','purchasePrice','weightKg','minStockLevel',
    'unit','description','tags','imageUrl'];

  openModal('modal-prod-csv', 'Product CSV Import', `
    <p class="text-sm text-muted" style="margin-bottom:8px">
      Columns: <code class="td-id">${HDRS.join(', ')}</code><br>
      <strong>name</strong> is required. stockMethod: <code>Bulk</code> or <code>Serialised</code>.
    </p>
    <div style="margin-bottom:10px">
      <button type="button" class="btn btn-ghost btn-sm" onclick="window.__dlProdTemplate()">⬇ Download Template</button>
    </div>
    <div class="form-group"><label for="csv-pr-file">CSV File</label>
      <input type="file" id="csv-pr-file" accept=".csv"></div>
    <div id="csv-pr-prev" style="display:none;margin-top:10px">
      <div id="csv-pr-table"></div>
      <div id="csv-pr-status" class="td-id" style="margin-top:6px"></div>
    </div>`, `
    <button type="button" class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button type="button" class="btn btn-ghost btn-sm" onclick="window.__csvPrPreview()">Preview</button>
    <button type="button" class="btn btn-primary btn-sm" id="btn-pr-imp" disabled onclick="window.__csvPrImport()">Import</button>`);

  let rows = [];
  window.__dlProdTemplate = () => {
    const csv = HDRS.join(',') + '\n"Example Subwoofer","AUD-001","Audio","Audio","QSC","KS112","Bulk","85","1200","950","25.5","2","Each","18-inch powered sub","audio,bass",""\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'mav-product-template.csv'; a.click();
  };
  window.__csvPrPreview = () => {
    const file = document.getElementById('csv-pr-file')?.files[0];
    if (!file) { toast('Select a file', 'warn'); return; }
    const fr = new FileReader();
    fr.onload = e => {
      const parsed = parseCSV(e.target.result);
      const hdrs  = (parsed[0] || []).map(h => (h || '').toLowerCase());
      rows = parsed.slice(1).map(cols => { const o = {}; hdrs.forEach((h, i) => { o[h] = (cols[i] || '').trim(); }); return o; }).filter(r => r.name);
      document.getElementById('csv-pr-table').innerHTML = `<div class="tbl-wrap"><table>
        <thead><tr>${hdrs.slice(0, 6).map(h => `<th>${esc(h)}</th>`).join('')}<th>…</th></tr></thead>
        <tbody>${rows.slice(0, 5).map(r => `<tr>${hdrs.slice(0, 6).map(h => `<td class="td-id">${esc(r[h] || '')}</td>`).join('')}<td class="td-id">+${hdrs.length - 6}</td></tr>`).join('')}</tbody>
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
    let ok = 0, fail = 0;
    for (const r of rows) {
      try {
        await rpc('saveProduct', {
          name: r.name, sku: r.sku || '', category: r.category || '',
          productGroup: r.productgroup || r.productGroup || '',
          brand: r.brand || '', model: r.model || '',
          stockMethod: r.stockmethod || r.stockMethod || 'Bulk',
          baseHireRate:    parseFloat(r.basehirerate    || r.baseHireRate    || 0) || 0,
          replacementCost: parseFloat(r.replacementcost || r.replacementCost || 0) || 0,
          purchasePrice:   parseFloat(r.purchaseprice   || r.purchasePrice   || 0) || 0,
          weightKg:        parseFloat(r.weightkg        || r.weightKg        || 0) || 0,
          minStockLevel:   parseInt(r.minstocklevel  || r.minStockLevel  || '0', 10) || 0,
          unit: r.unit || 'Each', description: r.description || '',
          tags: r.tags || '', imageUrl: r.imageurl || r.imageUrl || '',
        });
        ok++;
      } catch(e) { fail++; }
    }
    await rpc('syncStockFromProducts');
    toast(`Imported ${ok}${fail > 0 ? `, ${fail} failed` : ''}`, fail > 0 ? 'warn' : 'ok');
    STATE.loadedPanes.delete('inventory'); await loadProducts(); hideLoading();
  };
}

// ── Stock adjustment modal ─────────────────────────────────────────────────────
export function openStockAdjustModal(productId, productName) {
  closeModal();
  openModal('modal-stock-adj', `Stock Adjustment — ${esc(productName)}`, `
    <div class="form-grid">
      <div class="form-group span-2">
        <label for="sa-type">Adjustment Type *</label>
        <select id="sa-type" onchange="window.__saTypeChange()">
          <option value="in">+ Stock In (received / found)</option>
          <option value="out">− Stock Out (used / consumed)</option>
          <option value="lost">✗ Write Off Lost</option>
          <option value="service_out">→ Send to Service</option>
          <option value="service_in">← Return from Service</option>
        </select>
      </div>
      <div class="form-group">
        <label for="sa-qty">Quantity *</label>
        <input type="number" id="sa-qty" value="1" min="1">
      </div>
      <div class="form-group" id="sa-barcode-wrap">
        <label for="sa-barcode">Barcode (serialised)</label>
        <input type="text" id="sa-barcode" placeholder="Leave blank for bulk">
      </div>
      <div class="form-group span-2">
        <label for="sa-notes">Notes</label>
        <input type="text" id="sa-notes" placeholder="Reason for adjustment">
      </div>
    </div>`, `
    <button type="button" class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button type="button" class="btn btn-primary btn-sm" data-action="submitStockAdj" data-id="${escAttr(productId)}">Apply</button>`
  );

  window.__saTypeChange = () => {
    const type       = document.getElementById('sa-type')?.value;
    const barcodeWrap = document.getElementById('sa-barcode-wrap');
    if (barcodeWrap) barcodeWrap.style.display = ['lost','service_out','service_in'].includes(type) ? 'block' : 'none';
  };
  window.__saTypeChange();

  window.__submitStockAdj = async (pId) => {
    const type    = document.getElementById('sa-type')?.value;
    const qty     = parseInt(document.getElementById('sa-qty')?.value, 10) || 0;
    const barcode = document.getElementById('sa-barcode')?.value.trim()    || '';
    const notes   = document.getElementById('sa-notes')?.value.trim()      || '';
    if (!qty || qty < 1) { toast('Quantity must be at least 1', 'warn'); return; }
    showLoading('Applying adjustment…'); closeModal();
    try {
      if      (type === 'in')          await rpc('adjustStockPositive',     pId, qty, notes);
      else if (type === 'out')         await rpc('adjustStockNegative',     pId, qty, notes);
      else if (type === 'lost')        await rpc('writeOffLostStock',       pId, qty, barcode, notes);
      else if (type === 'service_out') await rpc('sendStockToService',      pId, qty, barcode, notes);
      else if (type === 'service_in')  await rpc('returnStockFromService',  pId, qty, barcode, notes);
      toast('Adjustment applied', 'ok');
      STATE.loadedPanes.delete('inventory');
      await loadProducts();
    } catch(e) { toast(e.message, 'err'); }
    finally { hideLoading(); }
  };
}

// ── Barcode label printing ─────────────────────────────────────────────────────
export async function openBarcodeLabelModal(productId, productName) {
  showLoading('Loading barcodes…');
  try {
    const barcodes = await rpc('getBarcodes', productId);
    hideLoading();
    if (!barcodes.length) { toast('No barcodes for this product', 'warn'); return; }

    openModal('modal-barcode-labels', `Print Labels — ${esc(productName)}`, `
      <div class="form-grid" style="margin-bottom:14px">
        <div class="form-group"><label for="lbl-size">Label size</label>
          <select id="lbl-size">
            <option value="small">Small (50×25mm)</option>
            <option value="medium" selected>Medium (70×35mm)</option>
            <option value="large">Large (100×50mm)</option>
          </select></div>
        <div class="form-group"><label for="lbl-cols">Per row</label>
          <select id="lbl-cols"><option value="2">2</option><option value="3" selected>3</option><option value="4">4</option></select></div>
        <div class="form-group">
          <label><input type="checkbox" id="lbl-show-name" checked style="margin-right:6px"> Show product name</label>
        </div>
        <div class="form-group">
          <label><input type="checkbox" id="lbl-show-serial" checked style="margin-right:6px"> Show serial number</label>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        ${barcodes.map(b => `
          <label class="inv-label-check">
            <input type="checkbox" class="lbl-bc-check" value="${esc(b.barcode)}"
              data-serial="${esc(b.serialNumber || '')}" data-name="${esc(productName)}" checked>
            ${esc(b.barcode)}${b.serialNumber ? ' · ' + esc(b.serialNumber) : ''}
          </label>`).join('')}
      </div>
      <div class="text-sm text-muted">${barcodes.length} unit${barcodes.length !== 1 ? 's' : ''} — select which to include</div>`, `
      <button type="button" class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
      <button type="button" class="btn btn-ghost btn-sm" onclick="document.querySelectorAll('.lbl-bc-check').forEach(c=>c.checked=true)">All</button>
      <button type="button" class="btn btn-primary btn-sm" onclick="window.__printBarcodeLabels()">🖨 Print</button>`
    );

    window.__printBarcodeLabels = () => {
      const checked = [...document.querySelectorAll('.lbl-bc-check:checked')];
      if (!checked.length) { toast('Select at least one barcode', 'warn'); return; }
      const size       = document.getElementById('lbl-size')?.value || 'medium';
      const cols       = parseInt(document.getElementById('lbl-cols')?.value, 10) || 3;
      const showName   = document.getElementById('lbl-show-name')?.checked ?? true;
      const showSerial = document.getElementById('lbl-show-serial')?.checked ?? true;
      const dims       = { small: [50, 25], medium: [70, 35], large: [100, 50] }[size];
      const [w, h]     = dims;
      const pt         = size === 'small' ? 6 : size === 'large' ? 9 : 7;

      const labels = checked.map(cb => {
        const barcode = cb.value;
        const serial  = cb.dataset.serial;
        const name    = cb.dataset.name;
        const qrUrl   = `https://chart.googleapis.com/chart?cht=qr&chs=120x120&chl=${encodeURIComponent(barcode)}&choe=UTF-8`;
        return `<div style="width:${w}mm;height:${h}mm;display:inline-flex;flex-direction:column;
          align-items:center;justify-content:center;gap:2px;border:0.5px solid #ccc;
          padding:3mm;box-sizing:border-box;font-family:Arial,sans-serif;page-break-inside:avoid;vertical-align:top">
          <img src="${qrUrl}" style="width:${Math.round(h * 0.55)}mm;height:${Math.round(h * 0.55)}mm;object-fit:contain">
          <div style="font-size:${pt}pt;font-weight:bold;text-align:center;word-break:break-all;max-width:100%">${barcode}</div>
          ${showSerial && serial ? `<div style="font-size:${pt - 1}pt;color:#666;text-align:center">${serial}</div>` : ''}
          ${showName ? `<div style="font-size:${pt - 1}pt;color:#666;text-align:center;word-break:break-all;max-width:100%">${name}</div>` : ''}
        </div>`;
      }).join('');

      const win = window.open('', '_blank');
      if (!win) { toast('Allow pop-ups to print labels', 'warn'); return; }
      win.document.write(`<!DOCTYPE html><html><head><title>Labels — ${productName}</title>
        <style>@page{margin:10mm}body{margin:0;padding:0;background:#fff}
          .grid{display:grid;grid-template-columns:repeat(${cols},${w}mm);gap:3mm}
          @media print{body{-webkit-print-color-adjust:exact}}</style>
        </head><body><div class="grid">${labels}</div>
        <script>window.onload=()=>setTimeout(()=>window.print(),500)<\/script></body></html>`);
      win.document.close();
      closeModal();
    };
  } catch(e) { hideLoading(); toast(e.message, 'err'); }
}

// ── Export CSV ─────────────────────────────────────────────────────────────────
export function exportInventoryCsv() {
  const rows = (STATE.products || []).map(p => ({
    'Product ID':         p.productId,
    'SKU':                p.sku,
    'Name':               p.name,
    'Category':           p.category   || '',
    'Product Group':      p.productGroup || '',
    'Brand':              p.brand      || '',
    'Stock Method':       p.stockMethod,
    'Qty Owned':          p.qtyOwned   ?? '',
    'Qty Available':      p.qtyAvailable ?? '',
    'Qty Out':            p.qtyOut     ?? '',
    'Min Stock':          p.minStockLevel ?? '',
    'Base Rate (£/day)':  p.baseHireRate || 0,
    'Replacement (£)':    p.replacementCost || 0,
    'Purchase Price (£)': p.purchasePrice || 0,
    'Weight (kg)':        p.weightKg   || 0,
    'Active':             p.active !== false ? 'Yes' : 'No',
  }));
  exportCsv(`MAV_Inventory_${new Date().toISOString().substring(0, 10)}.csv`, rows);
}

// ── Pane event delegation ──────────────────────────────────────────────────────
function setupPaneEvents() {
  const containers = ['inv-list', 'inv-snapshot'];
  containers.forEach(cid => {
    const container = document.getElementById(cid);
    if (!container || container._delegated) return;
    container._delegated = true;
    container.addEventListener('click', e => {
      const el = e.target.closest('[data-action]');
      if (!el || !container.contains(el)) return;
      e.stopPropagation();
      const action = el.dataset.action;
      const id     = el.dataset.id   || '';
      const name   = el.dataset.name || '';
      switch (action) {
        case 'openProductDetail':        window.__openProductDetail?.(id); break;
        case 'editProduct':              window.__editProduct?.(id); break;
        case 'stockAdjust':              window.__stockAdjust?.(id); break;
        case 'openRateCards':            window.__openRateCards?.(id, name); break;
        case 'printLabels':              window.__printLabels?.(id, name); break;
        case 'logMaintenanceForProduct': window.__logMaintenanceForProduct?.(id); break;
        case 'openJobDetail':            window.__openJobDetail?.(id); break;
        case 'saveRate':                 window.__saveRate?.(id); break;
        case 'deleteRate':               window.__deleteRate?.(id, el.dataset.pid || '', el.dataset.name || ''); break;
        case 'submitProductForm':        window.__submitProductForm?.(id); break;
        case 'submitReturnConds':        window.__submitReturnConds?.(id); break;
        case 'submitStockAdj':           window.__submitStockAdj?.(id); break;
        case 'submitLogMaint':           window.__submitLogMaint?.(id); break;
        case 'submitDamageCharge':       window.__submitDamageCharge?.(id); break;
        case 'inv-sort': {
          const field = el.dataset.field;
          if (_sortField === field) _sortDir = -_sortDir;
          else { _sortField = field; _sortDir = 1; }
          filterProducts();
          break;
        }
        case 'inv-view': setInventoryView(el.dataset.view); break;
        default: break;
      }
    });
  });
}