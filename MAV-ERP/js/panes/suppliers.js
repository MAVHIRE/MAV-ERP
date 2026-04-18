/**
 * MAV HIRE ERP — js/panes/suppliers.js
 * Supplier management: list, create, edit, view products per supplier.
 */
import { rpc }   from '../api/gas.js';
import { STATE } from '../utils/state.js';
import { showLoading, hideLoading, toast, emptyState } from '../utils/dom.js';
import { fmtCurDec, esc, statusBadge , escAttr} from '../utils/format.js';
import { openModal, closeModal } from '../components/modal.js';

export async function loadSuppliers() {
  showLoading('Loading suppliers…');
  try {
    STATE.suppliers = await rpc('getSuppliers', {});
    render(STATE.suppliers);
    const el = document.getElementById('suppliers-subtitle');
    if (el) el.textContent = STATE.suppliers.length + ' suppliers';
  } catch(e) { toast('Suppliers failed: ' + e.message, 'err'); }
  finally { hideLoading(); }
}

let _searchTimer = null;
export function filterSuppliers() {
  const q = (document.getElementById('sup-search')?.value || '').toLowerCase();
  // Client-side filter on cached data (instant)
  const filtered = (STATE.suppliers || []).filter(s =>
    [s.supplierId, s.supplierName, s.contactName, s.email, s.phone, s.category].join(' ').toLowerCase().includes(q)
  );
  render(filtered);
  // If query is 3+ chars and result set is small, also hit server for accuracy
  if (q.length >= 3 && filtered.length < 5) {
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(async () => {
      try {
        const results = await rpc('searchSuppliers', q);
        if (results && results.length) render(results);
      } catch(e) { /* silent — client-side result already shown */ }
    }, 400);
  }
}

function render(suppliers) {
  const el = document.getElementById('suppliers-list');
  if (!el) return;
  if (!suppliers.length) { el.innerHTML = emptyState('◎', 'No suppliers found'); return; }

  el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px">
    ${suppliers.map(s => {
      const initials = s.supplierName.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
      return `<div onclick="window.__openSupplierDetail('${escAttr(s.supplierId)}')"
        style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r2);
        padding:14px;cursor:pointer;transition:all var(--trans)"
        onmouseover="this.style.borderColor='var(--border2)';this.style.background='var(--surface2)'"
        onmouseout="this.style.borderColor='var(--border)';this.style.background='var(--surface)'">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <div style="width:38px;height:38px;border-radius:8px;background:var(--surface3);
            display:flex;align-items:center;justify-content:center;
            font-family:var(--mono);font-size:12px;font-weight:700;color:var(--text2);flex-shrink:0">
            ${initials}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.supplierName)}</div>
            ${s.contactName?`<div style="font-size:11px;color:var(--text3)">${esc(s.contactName)}</div>`:''}
          </div>
          ${s.productCount>0?`<div style="font-family:var(--mono);font-size:11px;color:var(--text3);flex-shrink:0">${s.productCount} SKUs</div>`:''}
        </div>
        <div style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--text3);margin-bottom:10px">
          ${s.email?`<div><span style="color:var(--info)">${esc(s.email)}</span></div>`:''}
          ${s.phone?`<div>${esc(s.phone)}</div>`:''}
          <div style="display:flex;gap:12px;margin-top:2px">
            ${s.category?`<span>${esc(s.category)}</span>`:''}
            ${s.leadTimeDays>0?`<span>Lead: ${s.leadTimeDays}d</span>`:''}
            ${s.paymentTerms?`<span>${esc(s.paymentTerms)}</span>`:''}
          </div>
        </div>
        <div style="display:flex;gap:6px" onclick="event.stopPropagation()">
          <button class="btn btn-ghost btn-sm" onclick="window.__editSupplier('${escAttr(s.supplierId)}')">✏ Edit</button>
          <button class="btn btn-ghost btn-sm" onclick="window.__openNewPOModal()">+ PO</button>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

// ── Supplier detail modal ─────────────────────────────────────────────────────
export async function openSupplierDetail(supplierId) {
  showLoading('Loading supplier…');
  try {
    const [supplier, products, stats] = await Promise.all([
      rpc('getSupplierById', supplierId),
      rpc('getProducts').then(ps => ps.filter(p => p.supplierId === supplierId)),
      rpc('getSupplierStats', supplierId).catch(() => []),
    ]);
    hideLoading();
    showSupplierModal(supplier, products, stats);
  } catch(e) { hideLoading(); toast(e.message, 'err'); }
}

function showSupplierModal(s, products, stats) {
  const st = (stats||[])[0] || {};
  const productRows = products.slice(0, 20).map(p => `<tr>
    <td class="td-id">${esc(p.sku)}</td>
    <td class="td-name">${esc(p.name)}</td>
    <td>${esc(p.category||'—')}</td>
    <td class="td-num">${fmtCurDec(p.baseHireRate)}/day</td>
    <td class="td-num">${fmtCurDec(p.purchasePrice)}</td>
    <td class="td-num">${p.qtyOwned}</td>
  </tr>`).join('');

  const statsSection = st.totalPurchaseValue ? `
    <div class="section-title" style="margin-bottom:8px">Supplier Performance</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;margin-bottom:16px">
      ${[
        ['Total Spent', fmtCurDec(st.totalPurchaseValue), 'var(--text2)'],
        ['Revenue Generated', fmtCurDec(st.totalRevenue), 'var(--accent)'],
        ['ROI', (st.roiPct||0).toFixed(1)+'%', (st.roiPct||0)>0?'var(--ok)':'var(--danger)'],
        ['SKUs Supplied', st.productCount||products.length, 'var(--info)'],
      ].map(([l,v,c])=>`
        <div style="background:var(--surface2);border-radius:6px;padding:10px;text-align:center">
          <div style="font-size:10px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;margin-bottom:4px">${l}</div>
          <div style="font-family:var(--mono);font-size:15px;font-weight:700;color:${c}">${v}</div>
        </div>`).join('')}
    </div>` : '';

  openModal('modal-supplier', esc(s.supplierName), `
    ${statsSection}
    <div class="two-col" style="gap:12px;margin-bottom:16px">
      <div>
        <div class="detail-row"><div class="detail-label">Supplier ID</div><div class="detail-value td-id">${esc(s.supplierId)}</div></div>
        <div class="detail-row"><div class="detail-label">Contact</div><div class="detail-value">${esc(s.contactName||'—')}</div></div>
        <div class="detail-row"><div class="detail-label">Email</div><div class="detail-value">${esc(s.email||'—')}</div></div>
        <div class="detail-row"><div class="detail-label">Phone</div><div class="detail-value">${esc(s.phone||'—')}</div></div>
        <div class="detail-row"><div class="detail-label">Website</div><div class="detail-value">${esc(s.website||'—')}</div></div>
      </div>
      <div>
        <div class="detail-row"><div class="detail-label">Category</div><div class="detail-value">${esc(s.category||'—')}</div></div>
        <div class="detail-row"><div class="detail-label">Lead Time</div><div class="detail-value">${s.leadTimeDays > 0 ? s.leadTimeDays + ' days' : '—'}</div></div>
        <div class="detail-row"><div class="detail-label">Payment Terms</div><div class="detail-value">${esc(s.paymentTerms||'—')}</div></div>
        <div class="detail-row"><div class="detail-label">Currency</div><div class="detail-value">${esc(s.currency||'GBP')}</div></div>
        ${s.notes ? `<div class="detail-row"><div class="detail-label">Notes</div><div class="detail-value" style="font-size:12px">${esc(s.notes)}</div></div>` : ''}
      </div>
    </div>
    ${s.address ? `<div style="font-size:12px;color:var(--text2);margin-bottom:12px;padding:8px 12px;background:var(--surface2);border-radius:var(--r)">${esc(s.address)}</div>` : ''}
    ${products.length ? `
      <div class="section-title" style="margin-bottom:8px">Products from this supplier (${products.length})</div>
      <div class="tbl-wrap">
        <table><thead><tr><th>SKU</th><th>Name</th><th>Category</th><th>Day Rate</th><th>Purchase</th><th>Owned</th></tr></thead>
        <tbody>${productRows}</tbody></table>
      </div>` : `<p style="font-size:13px;color:var(--text3)">No products linked to this supplier.</p>`}
  `, `
    <button class="btn btn-ghost btn-sm" onclick="window.__editSupplier('${escAttr(s.supplierId)}')">✏ Edit</button>
    <button class="btn btn-ghost btn-sm" onclick="window.__openNewPOModal()">+ PO</button>
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Close</button>
  `);
}

// ── New / edit supplier ───────────────────────────────────────────────────────
export function openNewSupplierModal() { openSupplierForm(null); }

export async function editSupplier(supplierId) {
  showLoading('Loading supplier…'); closeModal();
  try {
    const s = await rpc('getSupplierById', supplierId);
    hideLoading(); openSupplierForm(s);
  } catch(e) { hideLoading(); toast(e.message, 'err'); }
}

function openSupplierForm(existing) {
  const s = existing || {}, isEdit = !!s.supplierId;
  const v = (f, fb='') => esc(s[f] != null ? s[f] : fb);
  const n = (f, fb=0)  => s[f] != null ? s[f] : fb;

  openModal('modal-supplier-form', isEdit ? `Edit: ${esc(s.supplierName)}` : 'New Supplier', `
    <div class="form-grid">
      <div class="form-group"><label>Supplier Name *</label>
        <input type="text" id="fs-name" value="${v('supplierName')}"></div>
      <div class="form-group"><label>Category</label>
        <input type="text" id="fs-cat" value="${v('category')}" placeholder="e.g. Audio, Lighting, Rigging"></div>
      <div class="form-group"><label>Contact Name</label>
        <input type="text" id="fs-contact" value="${v('contactName')}"></div>
      <div class="form-group"><label>Phone</label>
        <input type="text" id="fs-phone" value="${v('phone')}"></div>
      <div class="form-group"><label>Email</label>
        <input type="email" id="fs-email" value="${v('email')}"></div>
      <div class="form-group"><label>Website</label>
        <input type="url" id="fs-website" value="${v('website')}" placeholder="https://"></div>
      <div class="form-group span-2"><label>Address</label>
        <input type="text" id="fs-address" value="${v('address')}"></div>
      <div class="form-group"><label>Lead Time (days)</label>
        <input type="number" id="fs-lead" value="${n('leadTimeDays')}" min="0"></div>
      <div class="form-group"><label>Payment Terms</label>
        <input type="text" id="fs-terms" value="${v('paymentTerms')}" placeholder="e.g. 30 days"></div>
      <div class="form-group"><label>Currency</label>
        <input type="text" id="fs-currency" value="${v('currency','GBP')}" maxlength="3"></div>
      <div class="form-group"><label>Account Number</label>
        <input type="text" id="fs-account" value="${v('accountNumber')}"></div>
      <div class="form-group span-2"><label>Notes</label>
        <textarea id="fs-notes" rows="2">${v('notes')}</textarea></div>
    </div>`, `
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="window.__submitSupplierForm('${escAttr(s.supplierId||'')}')">
      ${isEdit ? 'Save Changes' : 'Save Supplier'}</button>`
  );

  window.__submitSupplierForm = async (sId) => {
    const name = document.getElementById('fs-name')?.value.trim();
    if (!name) { toast('Supplier name required', 'warn'); return; }
    showLoading('Saving…'); closeModal();
    try {
      const r = await rpc('saveSupplier', {
        supplierId:    sId || null,
        supplierName:  name,
        category:      document.getElementById('fs-cat')?.value,
        contactName:   document.getElementById('fs-contact')?.value,
        phone:         document.getElementById('fs-phone')?.value,
        email:         document.getElementById('fs-email')?.value,
        website:       document.getElementById('fs-website')?.value,
        address:       document.getElementById('fs-address')?.value,
        leadTimeDays:  parseInt(document.getElementById('fs-lead', 10)?.value, 10) || 0,
        paymentTerms:  document.getElementById('fs-terms')?.value,
        currency:      document.getElementById('fs-currency')?.value || 'GBP',
        accountNumber: document.getElementById('fs-account')?.value,
        notes:         document.getElementById('fs-notes')?.value,
      });
      toast(isEdit ? 'Supplier saved' : 'Supplier created: ' + r.supplierId, 'ok');
      STATE.loadedPanes.delete('suppliers');
      await loadSuppliers();
    } catch(e) { toast(e.message, 'err'); }
    finally { hideLoading(); }
  };
}