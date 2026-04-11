/**
 * MAV HIRE ERP — js/components/lineItems.js  v2.0
 * Line item editor: Rental · Service · Bundle · Accessory lines.
 * Features: product autocomplete search, accessory auto-suggest,
 *           bundle apply button, discount per line, live totals bar.
 */

import { esc, fmtCurDec }  from '../utils/format.js';
import { STATE }            from '../utils/state.js';
import { rpc }              from '../api/gas.js';
import { toast }            from '../utils/dom.js';

// ── Module state ──────────────────────────────────────────────────────────────
let _lines       = [];
let _containerId = '';
let _onChange    = null;

// ── Public API ────────────────────────────────────────────────────────────────
export function initLineItems(containerId, initialLines = [], onChange = null) {
  _containerId = containerId;
  _onChange    = onChange;
  _lines       = (initialLines || []).map((l, i) => Object.assign({ _id: i + 1 }, normaliseItem(l)));
  render();
}

export function getLines()  { return _lines; }
export function getTotals() { return calcTotals(_lines); }

export function addRentalLine() {
  _lines.push({ _id: Date.now(), lineType: 'Rental', productId: '', serviceId: '',
    name: '', sku: '', category: '', quantity: 1, unitPrice: 0, discountPct: 0,
    replacementCost: 0, weightKg: 0 });
  render();
}

export function addServiceLine() {
  _lines.push({ _id: Date.now(), lineType: 'Service', productId: '', serviceId: '',
    name: '', category: '', quantity: 1, unitPrice: 0, discountPct: 0,
    replacementCost: 0, weightKg: 0 });
  render();
}

export function removeLine(id) {
  _lines = _lines.filter(l => l._id !== id);
  render();
}

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  const container = document.getElementById(_containerId);
  if (!container) return;

  const serviceOpts = (STATE.services || []).map(s =>
    `<option value="${esc(s.serviceId)}" data-price="${s.defaultPrice}"
      data-name="${esc(s.serviceName)}" data-cat="${esc(s.serviceType)}"
    >${esc(s.serviceName)}</option>`
  ).join('');

  const bundleOpts = (STATE.bundles || []).map(b =>
    `<option value="${esc(b.bundleId)}">${esc(b.bundleName)}</option>`
  ).join('');

  container.innerHTML = `
    <div class="line-items-wrap">
      <div class="line-item-row header"
           style="grid-template-columns:2.5fr .55fr .9fr .55fr .9fr 36px">
        <div>Item</div><div>Qty</div><div>Unit Price</div><div>Disc %</div><div>Total</div><div></div>
      </div>
      ${_lines.map(l => renderLine(l, serviceOpts)).join('')}
    </div>

    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center">
      <button class="btn btn-ghost btn-sm" onclick="window.__liAddRental()">+ Rental Item</button>
      <button class="btn btn-ghost btn-sm" onclick="window.__liAddService()">+ Service</button>
      ${bundleOpts ? `
        <select id="li-apply-bundle"
          style="font-size:12px;padding:5px 8px;background:var(--surface2);border:1px solid var(--border);
                 border-radius:var(--r);color:var(--text2)">
          <option value="">Apply bundle…</option>${bundleOpts}
        </select>
        <button class="btn btn-ghost btn-sm" onclick="window.__liApplyBundle()">Apply</button>` : ''}
    </div>

    ${renderSummary()}`;

  // Restore service select values
  _lines.forEach(l => {
    if (l.lineType === 'Service' && l.serviceId) {
      const sel = document.getElementById('li-svc-' + l._id);
      if (sel) sel.value = l.serviceId;
    }
  });

  // Globals
  window.__liAddRental   = addRentalLine;
  window.__liAddService  = addServiceLine;
  window.__liRemove      = removeLine;
  window.__liChange      = updateField;
  window.__liSvcChange   = onServiceChange;
  window.__liSearchKey   = onProductSearchKey;
  window.__liPickProduct = pickProduct;
  window.__liApplyBundle = applyBundle;
  window.__liClearProduct = clearProductOnLine;

  if (_onChange) _onChange(calcTotals(_lines));
}

function renderLine(l, serviceOpts) {
  const id    = l._id;
  const qty   = +l.quantity   || 0;
  const price = +l.unitPrice  || 0;
  const disc  = +l.discountPct|| 0;
  const total = Math.round(qty * price * (1 - disc / 100) * 100) / 100;

  if (l.lineType === 'Service') {
    return `<div class="line-item-row"
               style="grid-template-columns:2.5fr .55fr .9fr .55fr .9fr 36px"
               id="li-row-${id}">
      <div style="display:flex;gap:6px;align-items:center">
        <span class="line-type-badge line-type-service">Service</span>
        <select id="li-svc-${id}" onchange="window.__liSvcChange(${id})"
                style="flex:1;font-size:12px">
          <option value="">— Select service —</option>${serviceOpts}
        </select>
      </div>
      <input type="number" min="1" value="${qty}"
             onchange="window.__liChange(${id},'quantity',this.value)">
      <input type="number" min="0" step="0.01" value="${price}" id="li-price-${id}"
             onchange="window.__liChange(${id},'unitPrice',this.value)">
      <input type="number" min="0" max="100" value="${disc}"
             onchange="window.__liChange(${id},'discountPct',this.value)">
      <div class="line-total">${fmtCurDec(total)}</div>
      <button class="line-item-remove" onclick="window.__liRemove(${id})">×</button>
    </div>`;
  }

  // Rental / Accessory / Bundle — product autocomplete
  const nameBlock = l.name
    ? `<div style="flex:1">
         <div style="font-size:12px;font-weight:500;color:var(--text)">${esc(l.name)}</div>
         <div style="font-family:var(--mono);font-size:10px;color:var(--text3)">
           ${esc(l.sku || '')}${l.category ? ' · ' + esc(l.category) : ''}
           ${l.weightKg > 0 ? ' · ' + (+l.weightKg).toFixed(1) + ' kg' : ''}
         </div>
         <button style="font-size:10px;color:var(--text3);background:none;border:none;
                        cursor:pointer;padding:0;margin-top:1px"
                 onclick="window.__liClearProduct(${id})">✕ change</button>
       </div>`
    : `<input type="text" placeholder="Search product…" id="li-search-${id}"
              oninput="window.__liSearchKey(${id},event)"
              style="flex:1;font-size:12px" autocomplete="off">`;

  return `<div class="line-item-row"
             style="grid-template-columns:2.5fr .55fr .9fr .55fr .9fr 36px"
             id="li-row-${id}">
    <div style="position:relative">
      <div style="display:flex;gap:5px;align-items:center">
        <span class="line-type-badge line-type-${(l.lineType||'rental').toLowerCase()}">
          ${l.lineType || 'Rental'}</span>
        ${nameBlock}
      </div>
      <div id="li-results-${id}" class="autocomplete-dropdown" style="display:none"></div>
    </div>
    <input type="number" min="1" value="${qty}"
           onchange="window.__liChange(${id},'quantity',this.value)">
    <input type="number" min="0" step="0.01" value="${price}" id="li-price-${id}"
           onchange="window.__liChange(${id},'unitPrice',this.value)">
    <input type="number" min="0" max="100" value="${disc}"
           onchange="window.__liChange(${id},'discountPct',this.value)">
    <div class="line-total">${fmtCurDec(total)}</div>
    <button class="line-item-remove" onclick="window.__liRemove(${id})">×</button>
  </div>`;
}

function renderSummary() {
  const t = calcTotals(_lines);
  return `<div class="quote-summary">
    <div class="quote-summary-item">
      <div class="quote-summary-label">Subtotal</div>
      <div class="quote-summary-value">${fmtCurDec(t.subtotal)}</div>
    </div>
    <div class="quote-summary-item">
      <div class="quote-summary-label">VAT (20%)</div>
      <div class="quote-summary-value">${fmtCurDec(t.vat)}</div>
    </div>
    <div class="quote-summary-item">
      <div class="quote-summary-label">Total</div>
      <div class="quote-summary-value accent">${fmtCurDec(t.total)}</div>
    </div>
    <div class="quote-summary-item">
      <div class="quote-summary-label">Replacement</div>
      <div class="quote-summary-value">${fmtCurDec(t.replacementValue)}</div>
    </div>
    <div class="quote-summary-item">
      <div class="quote-summary-label">Weight</div>
      <div class="quote-summary-value">${t.totalWeightKg.toFixed(1)} kg</div>
    </div>
  </div>`;
}

// ── Product autocomplete ──────────────────────────────────────────────────────
function onProductSearchKey(id, e) {
  const q        = (e.target.value || '').toLowerCase().trim();
  const dropdown = document.getElementById('li-results-' + id);
  if (!dropdown) return;

  if (!q || q.length < 2) { dropdown.style.display = 'none'; return; }

  const matches = (STATE.products || [])
    .filter(p => [p.name, p.sku, p.brand, p.model, p.category].join(' ').toLowerCase().includes(q))
    .slice(0, 8);

  if (!matches.length) { dropdown.style.display = 'none'; return; }

  dropdown.style.display = 'block';
  dropdown.innerHTML = matches.map(p =>
    `<div class="autocomplete-item" onmousedown="window.__liPickProduct(${id},'${esc(p.productId)}')">
      <div style="font-weight:500;font-size:12px">${esc(p.name)}</div>
      <div style="font-family:var(--mono);font-size:10px;color:var(--text3)">
        ${esc(p.sku)} · ${esc(p.category || '')} · ${fmtCurDec(p.baseHireRate)}/day
        ${p.weightKg > 0 ? ' · ' + (+p.weightKg).toFixed(1) + ' kg' : ''}
      </div>
    </div>`).join('');
}

async function pickProduct(id, productId) {
  const product = (STATE.products || []).find(p => p.productId === productId);
  if (!product) return;

  const line = _lines.find(l => l._id === id);
  if (!line) return;

  Object.assign(line, {
    productId:       product.productId,
    name:            product.name,
    sku:             product.sku,
    category:        product.category       || '',
    unitPrice:       product.baseHireRate   || 0,
    replacementCost: product.replacementCost|| 0,
    weightKg:        product.weightKg       || 0,
    stockMethod:     product.stockMethod,
  });

  render();

  // Suggest accessories if any
  try {
    const accessories = await rpc('getProductAccessories', productId);
    if (accessories && accessories.length) {
      suggestAccessories(accessories, productId, product.name);
    }
  } catch(e) { /* non-fatal */ }
}

function clearProductOnLine(id) {
  const line = _lines.find(l => l._id === id);
  if (!line) return;
  Object.assign(line, { productId: '', name: '', sku: '', category: '',
    unitPrice: 0, replacementCost: 0, weightKg: 0 });
  render();
}

function suggestAccessories(accessories, parentProductId, parentName) {
  const container = document.getElementById(_containerId);
  if (!container) return;
  document.getElementById('li-accessory-suggest')?.remove();

  const banner = document.createElement('div');
  banner.id    = 'li-accessory-suggest';
  banner.style.cssText = `background:rgba(77,184,255,.08);border:1px solid rgba(77,184,255,.2);
    border-radius:var(--r);padding:10px 14px;margin-top:10px;font-size:12px`;
  banner.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <span style="color:var(--info);font-weight:500">
        💡 Accessories for <strong>${esc(parentName)}</strong>
      </span>
      <button onclick="document.getElementById('li-accessory-suggest')?.remove()"
              style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:16px">×</button>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:6px">
      ${accessories.map(a => `
        <button class="btn btn-ghost btn-sm" style="font-size:11px"
                onclick="window.__liAddAccessory('${esc(a.accessoryProductId)}','${esc(a.accessoryName)}',${a.defaultQuantity})">
          + ${esc(a.accessoryName)} ×${a.defaultQuantity}${a.optional ? ' (optional)' : ''}
        </button>`).join('')}
      <button class="btn btn-ghost btn-sm" style="font-size:11px;opacity:.5"
              onclick="document.getElementById('li-accessory-suggest')?.remove()">Dismiss</button>
    </div>`;

  container.appendChild(banner);

  window.__liAddAccessory = (productId, name, qty) => {
    const p = (STATE.products || []).find(x => x.productId === productId);
    _lines.push({
      _id:             Date.now(),
      lineType:        'Accessory',
      productId,
      serviceId:       '',
      name,
      sku:             p?.sku              || '',
      category:        p?.category         || '',
      quantity:        qty,
      unitPrice:       p?.baseHireRate     || 0,
      discountPct:     0,
      replacementCost: p?.replacementCost  || 0,
      weightKg:        p?.weightKg         || 0,
    });
    document.getElementById('li-accessory-suggest')?.remove();
    render();
  };
}

// ── Apply bundle ──────────────────────────────────────────────────────────────
async function applyBundle() {
  const bundleId = document.getElementById('li-apply-bundle')?.value;
  if (!bundleId) { toast('Select a bundle first', 'warn'); return; }
  try {
    const lines = await rpc('expandBundleToLines', bundleId, {});
    (lines || []).forEach(l => {
      _lines.push(Object.assign({ _id: Date.now() + Math.random() }, normaliseItem(l)));
    });
    toast('Bundle applied', 'ok');
    render();
  } catch(e) { toast('Failed: ' + e.message, 'err'); }
}

// ── Service change ────────────────────────────────────────────────────────────
function onServiceChange(id) {
  const sel  = document.getElementById('li-svc-' + id);
  const opt  = sel?.selectedOptions[0];
  if (!opt?.value) return;
  const line = _lines.find(l => l._id === id);
  if (!line) return;
  line.serviceId = opt.value;
  line.name      = opt.dataset.name  || '';
  line.category  = opt.dataset.cat   || '';
  line.unitPrice = parseFloat(opt.dataset.price) || 0;
  const priceEl  = document.getElementById('li-price-' + id);
  if (priceEl) priceEl.value = line.unitPrice;
  updateField(id, 'unitPrice', line.unitPrice);
}

// ── Field update (partial re-render — just total cell + summary) ──────────────
function updateField(id, field, value) {
  const line = _lines.find(l => l._id === id);
  if (!line) return;
  line[field] = (value === true || value === false) ? value : (isNaN(+value) || value === '' ? value : +value);

  const qty   = +line.quantity    || 0;
  const price = +line.unitPrice   || 0;
  const disc  = +line.discountPct || 0;
  const total = Math.round(qty * price * (1 - disc / 100) * 100) / 100;

  const totalEl = document.querySelector(`#li-row-${id} .line-total`);
  if (totalEl) totalEl.textContent = fmtCurDec(total);

  const container  = document.getElementById(_containerId);
  const summaryEl  = container?.querySelector('.quote-summary');
  if (summaryEl) summaryEl.outerHTML = renderSummary();

  if (_onChange) _onChange(calcTotals(_lines));
}

// ── Totals ────────────────────────────────────────────────────────────────────
function calcTotals(lines) {
  let subtotal = 0, replacement = 0, weight = 0;
  (lines || []).forEach(l => {
    const qty    = +l.quantity    || 0;
    const price  = +l.unitPrice   || 0;
    const disc   = +l.discountPct || 0;
    const dPrice = price * (1 - disc / 100);
    const lt     = l.lineType || 'Rental';
    const isSvc  = lt === 'Service';
    const isBHdr = lt === 'Bundle';
    if (!isBHdr || price > 0) subtotal   += qty * dPrice;
    if (!isSvc && !isBHdr)  { replacement += qty * (+l.replacementCost || 0);
                              weight      += qty * (+l.weightKg         || 0); }
  });
  subtotal = Math.round(subtotal * 100) / 100;
  const vat   = Math.round(subtotal * 0.2 * 100) / 100;
  const total = Math.round((subtotal + vat)       * 100) / 100;
  return {
    subtotal, vat, total,
    replacementValue: Math.round(replacement * 100) / 100,
    totalWeightKg:    Math.round(weight      * 100) / 100,
  };
}

function normaliseItem(l) {
  return {
    lineType:        l.lineType        || 'Rental',
    bundleId:        l.bundleId        || '',
    productId:       l.productId       || '',
    serviceId:       l.serviceId       || '',
    sku:             l.sku             || '',
    name:            l.name            || '',
    category:        l.category        || '',
    description:     l.description     || '',
    quantity:        +(l.quantity || l.qtyRequired || 0),
    unitPrice:       +(l.unitPrice       || 0),
    discountPct:     +(l.discountPct     || 0),
    replacementCost: +(l.replacementCost || 0),
    weightKg:        +(l.weightKg        || 0),
    imageUrl:        l.imageUrl          || '',
    stockMethod:     l.stockMethod       || '',
  };
}