/**
 * MAV HIRE ERP — js/panes/settings.js  v2.0
 * Full system settings: company, branding, financials, quote/job defaults,
 * email templates, PDF template designer, notifications, system preferences.
 * Includes: Services catalogue CRUD.
 */
import { rpc }   from '../api/gas.js';
import { STATE } from '../utils/state.js';
import { showLoading, hideLoading, toast, emptyState } from '../utils/dom.js';
import { esc, fmtCurDec } from '../utils/format.js';
import { openModal, closeModal } from '../components/modal.js';

export async function loadSettings() {
  showLoading('Loading settings…');
  try {
    STATE.settings = await rpc('getSettings');
    renderSettings(STATE.settings);
    activateSettingsTab('company');
  } catch(e) { toast('Settings failed: ' + e.message, 'err'); }
  finally { hideLoading(); }
}

// ── Tab navigation ────────────────────────────────────────────────────────────
export function activateSettingsTab(tab) {
  document.querySelectorAll('.settings-tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.settings-section').forEach(s =>
    s.style.display = s.dataset.section === tab ? 'block' : 'none');
}

// ── Render all fields ─────────────────────────────────────────────────────────
function renderSettings(s) {
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) { if (el.type === 'checkbox') el.checked = String(v) === 'true'; else el.value = v ?? ''; } };

  // Company
  setVal('s-business-name',    s.businessName);
  setVal('s-address',          s.businessAddress);
  setVal('s-phone',            s.businessPhone);
  setVal('s-email',            s.businessEmail);
  setVal('s-website',          s.businessWebsite);
  setVal('s-reg-number',       s.businessRegNumber);
  setVal('s-vat-number',       s.businessVatNumber);
  setVal('s-logo-url',         s.logoUrl);
  updateLogoPreview(s.logoUrl);

  // Financial
  setVal('s-vat-rate',         +(s.vatRate * 100).toFixed(4));
  setVal('s-vat-enabled',      s.vatEnabled);
  setVal('s-currency',         s.currency);
  setVal('s-currency-symbol',  s.currencySymbol);

  // Quote / Job
  setVal('s-quote-prefix',     s.quotePrefix);
  setVal('s-job-prefix',       s.jobPrefix);
  setVal('s-valid-days',       s.defaultQuoteValidDays);
  setVal('s-deposit-pct',      s.defaultDepositPct);
  setVal('s-require-deposit',  s.requireDepositBeforeCheckout);

  // Email templates
  setVal('s-payment-terms',    s.defaultPaymentTerms);
  setVal('s-quote-terms',      s.defaultQuoteTerms);
  setVal('s-email-greeting',   s.defaultEmailGreeting);
  setVal('s-email-signoff',    s.defaultEmailSignoff);
  setVal('s-email-footer',     s.defaultEmailFooter);

  // PDF
  setVal('s-pdf-show-logo',        s.pdfShowLogo);
  setVal('s-pdf-show-address',     s.pdfShowAddress);
  setVal('s-pdf-show-replacement', s.pdfShowReplacement);
  setVal('s-pdf-show-weight',      s.pdfShowWeight);
  setVal('s-pdf-show-signature',   s.pdfShowSignature);
  setVal('s-pdf-header-color',     s.pdfHeaderColor);
  setVal('s-pdf-accent-color',     s.pdfAccentColor);
  setVal('s-pdf-footer-text',      s.pdfFooterText);
  setVal('s-pdf-terms-text',       s.pdfTermsText);
  updatePdfPreview(s);

  // Notifications
  setVal('s-notify-job-created',    s.notifyJobCreated);
  setVal('s-notify-job-out',        s.notifyJobCheckedOut);
  setVal('s-notify-job-returned',   s.notifyJobReturned);
  setVal('s-notify-low-stock',      s.notifyLowStock);
  setVal('s-notify-maintenance',    s.notifyMaintenanceDue);
  setVal('s-notify-email',          s.notifyEmail);
  // Enquiries
  setVal('s-home-postcode',   s.homePostcode);
  setVal('s-triage-rules',    s.triageRulesJson);
  // Auth — prefer localStorage (what gas.js actually uses), but seed from GAS if empty
  const gasAuthToken    = s.authToken || '';
  const localAuthToken  = localStorage.getItem('mav_auth_token') || '';
  const effectiveToken  = localAuthToken || gasAuthToken;
  if (gasAuthToken && !localAuthToken) {
    // GAS has a token but browser doesn't — sync it down
    localStorage.setItem('mav_auth_token', gasAuthToken);
  }
  const tokenEl = document.getElementById('s-auth-token');
  if (tokenEl) tokenEl.value = effectiveToken;
  // Show/hide token toggle
  const showCb = document.getElementById('s-show-token');
  if (showCb) {
    showCb.onchange = () => {
      if (tokenEl) tokenEl.type = showCb.checked ? 'text' : 'password';
    };
  }

  // System
  setVal('s-date-format',      s.dateFormat);
  setVal('s-timezone',         s.timezone);
}

// ── Collect + save ────────────────────────────────────────────────────────────
export async function saveSettings() {
  const gv  = id => document.getElementById(id)?.value ?? '';
  const gc  = id => document.getElementById(id)?.checked ? 'true' : 'false';
  const gn  = (id, fb=0) => parseFloat(document.getElementById(id)?.value) || fb;
  const gi  = (id, fb=0) => parseInt(document.getElementById(id, 10)?.value, 10) || fb;

  showLoading('Saving settings…');
  try {
    await rpc('saveSettings', {
      businessName:         gv('s-business-name'),
      businessAddress:      gv('s-address'),
      businessPhone:        gv('s-phone'),
      businessEmail:        gv('s-email'),
      businessWebsite:      gv('s-website'),
      businessRegNumber:    gv('s-reg-number'),
      businessVatNumber:    gv('s-vat-number'),
      logoUrl:              gv('s-logo-url'),
      vatRate:              gn('s-vat-rate', 20) / 100,
      vatEnabled:           gc('s-vat-enabled'),
      currency:             gv('s-currency') || 'GBP',
      currencySymbol:       gv('s-currency-symbol') || '£',
      quotePrefix:          gv('s-quote-prefix') || 'MAV-Q',
      jobPrefix:            gv('s-job-prefix') || 'MAV-J',
      defaultQuoteValidDays: gi('s-valid-days', 30),
      defaultDepositPct:    gi('s-deposit-pct', 50),
      requireDepositBeforeCheckout: gc('s-require-deposit'),
      defaultPaymentTerms:  gv('s-payment-terms'),
      defaultQuoteTerms:    gv('s-quote-terms'),
      defaultEmailGreeting: gv('s-email-greeting'),
      defaultEmailSignoff:  gv('s-email-signoff'),
      defaultEmailFooter:   gv('s-email-footer'),
      pdfShowLogo:          gc('s-pdf-show-logo'),
      pdfShowAddress:       gc('s-pdf-show-address'),
      pdfShowReplacement:   gc('s-pdf-show-replacement'),
      pdfShowWeight:        gc('s-pdf-show-weight'),
      pdfShowSignature:     gc('s-pdf-show-signature'),
      pdfHeaderColor:       gv('s-pdf-header-color'),
      pdfAccentColor:       gv('s-pdf-accent-color'),
      pdfFooterText:        gv('s-pdf-footer-text'),
      pdfTermsText:         gv('s-pdf-terms-text'),
      notifyJobCreated:     gc('s-notify-job-created'),
      notifyJobCheckedOut:  gc('s-notify-job-out'),
      notifyJobReturned:    gc('s-notify-job-returned'),
      notifyLowStock:       gc('s-notify-low-stock'),
      notifyMaintenanceDue: gc('s-notify-maintenance'),
      notifyEmail:          gv('s-notify-email'),
      homePostcode:         gv('s-home-postcode').toUpperCase().trim(),
      triageRulesJson:      gv('s-triage-rules').trim(),
      dateFormat:           gv('s-date-format'),
      timezone:             gv('s-timezone'),
    });
    toast('Settings saved', 'ok');
    // Persist auth token to localStorage so gas.js sends it on every request
    const newToken = document.getElementById('s-auth-token')?.value.trim() || '';
    if (newToken !== (localStorage.getItem('mav_auth_token') || '')) {
      localStorage.setItem('mav_auth_token', newToken);
      toast('Auth token updated — will apply to all future requests', 'info');
    }
    STATE.settings = await rpc('getSettings');
    renderSettings(STATE.settings);
  } catch(e) { toast(e.message, 'err'); }
  finally { hideLoading(); }
}

// ── Logo preview ──────────────────────────────────────────────────────────────
export function updateLogoPreview(url) {
  const el = document.getElementById('s-logo-preview');
  if (!el) return;
  if (url) {
    el.innerHTML = `<img src="${esc(url)}" alt="Logo"
      style="max-height:80px;max-width:240px;object-fit:contain;border-radius:4px;background:var(--surface2);padding:8px"
      onerror="this.parentElement.innerHTML='<span style=color:var(--danger);font-size:12px>⚠ Could not load image</span>'">`;
  } else {
    el.innerHTML = `<span style="font-size:12px;color:var(--text3)">No logo set</span>`;
  }
}

// ── Live PDF preview ──────────────────────────────────────────────────────────
export function updatePdfPreview(s) {
  const el = document.getElementById('s-pdf-preview');
  if (!el) return;

  s = s || STATE.settings || {};
  const headerColor = document.getElementById('s-pdf-header-color')?.value || s.pdfHeaderColor || '#111111';
  const accentColor = document.getElementById('s-pdf-accent-color')?.value || s.pdfAccentColor || '#e8ff47';
  const showLogo    = document.getElementById('s-pdf-show-logo')?.checked ?? (s.pdfShowLogo !== 'false');
  const showAddr    = document.getElementById('s-pdf-show-address')?.checked ?? (s.pdfShowAddress !== 'false');
  const showSig     = document.getElementById('s-pdf-show-signature')?.checked ?? (s.pdfShowSignature !== 'false');
  const footerText  = document.getElementById('s-pdf-footer-text')?.value || s.pdfFooterText || '';
  const logoUrl     = document.getElementById('s-logo-url')?.value || s.logoUrl || '';
  const bizName     = document.getElementById('s-business-name')?.value || s.businessName || 'MAV Hire';
  const bizAddr     = document.getElementById('s-address')?.value || s.businessAddress || '';

  el.innerHTML = `
    <div style="font-family:Arial,sans-serif;font-size:10px;background:#fff;color:#222;
                padding:16px;border-radius:4px;border:1px solid var(--border)">
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;
                  background:${esc(headerColor)};padding:12px;border-radius:3px;margin-bottom:8px">
        <div>
          ${showLogo && logoUrl
            ? `<img src="${esc(logoUrl)}" style="max-height:36px;max-width:120px;object-fit:contain" onerror="this.style.display='none'">`
            : `<div style="font-size:16px;font-weight:bold;color:#fff">${esc(bizName)}</div>`}
          <div style="color:#aaa;font-size:9px;margin-top:2px">Equipment Hire</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:14px;font-weight:bold;color:#fff">Quotation</div>
          <div style="color:#aaa;font-size:9px">MAV-Q-001</div>
        </div>
      </div>
      <!-- Accent bar -->
      <div style="height:3px;background:${esc(accentColor)};margin-bottom:8px;border-radius:2px"></div>
      <!-- Line items preview -->
      <table style="width:100%;border-collapse:collapse;font-size:9px;margin-bottom:6px">
        <thead><tr style="background:${esc(headerColor)}">
          <th style="padding:4px 6px;text-align:left;color:#fff">Item</th>
          <th style="padding:4px 6px;text-align:center;color:#fff">Qty</th>
          <th style="padding:4px 6px;text-align:right;color:#fff">Total</th>
        </tr></thead>
        <tbody>
          <tr><td style="padding:3px 6px;border-bottom:1px solid #eee">QSC K12.2 PA Speaker</td><td style="text-align:center;border-bottom:1px solid #eee">4</td><td style="text-align:right;border-bottom:1px solid #eee">£240.00</td></tr>
          <tr><td style="padding:3px 6px;border-bottom:1px solid #eee">Allen & Heath SQ-5</td><td style="text-align:center;border-bottom:1px solid #eee">1</td><td style="text-align:right;border-bottom:1px solid #eee">£180.00</td></tr>
        </tbody>
        <tfoot>
          <tr style="background:${esc(headerColor)}">
            <td colspan="2" style="padding:4px 6px;text-align:right;font-weight:bold;color:#fff">Total</td>
            <td style="padding:4px 6px;text-align:right;font-weight:bold;color:${esc(accentColor)}">£504.00</td>
          </tr>
        </tfoot>
      </table>
      ${showSig ? `
      <div style="border:1px solid #ddd;padding:6px;font-size:8px;color:#666;border-radius:2px;margin-bottom:6px">
        <div style="margin-bottom:12px">Signed: _______________________</div>
        <div>Date: _______________________</div>
      </div>` : ''}
      ${showAddr || footerText ? `
      <div style="font-size:8px;color:#aaa;border-top:1px solid #eee;padding-top:4px">
        ${showAddr && bizAddr ? esc(bizAddr) + ' · ' : ''}
        ${footerText ? esc(footerText) : esc(bizName)}
      </div>` : ''}
    </div>`;
}

// ── Services management ───────────────────────────────────────────────────────

export async function loadServicesTab() {
  const el = document.getElementById('services-list');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--text3);font-size:12px">Loading…</div>';
  try {
    const services = await rpc('getServices', {});
    STATE.services = services;
    renderServicesList(services);
  } catch(e) { el.innerHTML = `<div style="color:var(--danger);font-size:12px">${esc(e.message)}</div>`; }
}

function renderServicesList(services) {
  const el = document.getElementById('services-list');
  if (!el) return;
  const active   = (services||[]).filter(s => s.active !== false);
  const inactive = (services||[]).filter(s => s.active === false);

  if (!services?.length) { el.innerHTML = emptyState('◎', 'No services configured yet'); return; }

  const typeColors = {
    Labour:'var(--info)', Delivery:'var(--ok)', 'Damage Waiver':'var(--warn)',
    Insurance:'var(--warn)', Other:'var(--text3)'
  };

  const renderRow = s => {
    const c = typeColors[s.serviceType] || 'var(--text3)';
    return `<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;
      border-radius:var(--r2);background:var(--surface);border:1px solid var(--border);
      border-left:3px solid ${c};margin-bottom:6px;
      ${s.active===false?'opacity:.55':''}">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:baseline;gap:8px">
          <span style="font-weight:600;font-size:13px">${esc(s.serviceName)}</span>
          <span style="font-size:10px;font-family:var(--mono);padding:1px 6px;border-radius:3px;
            background:${c}22;color:${c}">${esc(s.serviceType||'Other')}</span>
          ${s.active===false?'<span style="font-size:10px;color:var(--text3)">(inactive)</span>':''}
        </div>
        ${s.description?`<div style="font-size:11px;color:var(--text3);margin-top:2px">${esc(s.description)}</div>`:''}
        <div style="font-size:11px;color:var(--text3);margin-top:2px">
          ${s.unit||'Per Job'} · ${s.taxable!==false?'inc. VAT':'ex. VAT'}
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-family:var(--mono);font-size:15px;font-weight:700;color:var(--accent)">
          ${fmtCurDec(s.defaultPrice||0)}</div>
        <div style="font-size:10px;color:var(--text3)">default rate</div>
      </div>
      <div style="display:flex;gap:4px;flex-shrink:0">
        <button class="btn btn-ghost btn-sm" onclick="window.__editService('${esc(s.serviceId)}')">✏</button>
        <button class="btn btn-ghost btn-sm" onclick="window.__toggleServiceActive('${esc(s.serviceId)}','${s.active===false?'true':'false'}')"
          title="${s.active===false?'Activate':'Deactivate'}">
          ${s.active===false?'▶':'⏸'}
        </button>
      </div>
    </div>`;
  };

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text3);margin-bottom:10px">
      <span>${active.length} active · ${inactive.length} inactive</span>
    </div>
    ${active.map(renderRow).join('')}
    ${inactive.length ? `
      <div style="font-size:11px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;
        letter-spacing:.06em;margin:14px 0 8px">Inactive</div>
      ${inactive.map(renderRow).join('')}` : ''}`;
}

export function openNewServiceModal() {
  openServiceForm(null);
}

export async function editService(serviceId) {
  showLoading('Loading service…');
  try {
    const s = await rpc('getServiceById', serviceId);
    hideLoading();
    openServiceForm(s);
  } catch(e) { hideLoading(); toast(e.message, 'err'); }
}

function openServiceForm(existing) {
  const s = existing || {};
  const isEdit = !!s.serviceId;
  const serviceTypes = ['Labour','Delivery','Damage Waiver','Insurance','Other'];
  const units = ['Per Job','Per Day','Per Hour','Per Item','Per Person','Flat Rate'];

  openModal('modal-service-form', isEdit ? `Edit Service — ${esc(s.serviceName)}` : 'New Service', `
    <div class="form-grid">
      <div class="form-group span-2">
        <label>Service Name *</label>
        <input type="text" id="sv-name" value="${esc(s.serviceName||'')}" placeholder="e.g. Delivery & Collection, Damage Waiver" autofocus>
      </div>
      <div class="form-group">
        <label>Type</label>
        <select id="sv-type">
          ${serviceTypes.map(t => `<option${(s.serviceType||'Other')===t?' selected':''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Unit</label>
        <select id="sv-unit">
          ${units.map(u => `<option${(s.unit||'Per Job')===u?' selected':''}>${u}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Default Price (£)</label>
        <input type="number" id="sv-price" value="${+s.defaultPrice||0}" step="0.01" min="0">
      </div>
      <div class="form-group">
        <label>Sort Order</label>
        <input type="number" id="sv-sort" value="${+s.sortOrder||9999}" min="1">
      </div>
      <div class="form-group span-2">
        <label>Description</label>
        <input type="text" id="sv-desc" value="${esc(s.description||'')}" placeholder="Optional description shown on quotes">
      </div>
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="sv-taxable"${s.taxable!==false?' checked':''}> Include VAT
        </label>
      </div>
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="sv-active"${s.active!==false?' checked':''}> Active
        </label>
      </div>
    </div>`, `
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="window.__submitService('${esc(s.serviceId||'')}')">
      ${isEdit ? 'Save Changes' : 'Create Service'}
    </button>`
  );

  window.__submitService = async (sId) => {
    const name = document.getElementById('sv-name')?.value.trim();
    if (!name) { toast('Service name is required', 'warn'); return; }
    showLoading('Saving…'); closeModal();
    try {
      await rpc('saveService', {
        serviceId:    sId || null,
        serviceName:  name,
        serviceType:  document.getElementById('sv-type')?.value,
        description:  document.getElementById('sv-desc')?.value,
        defaultPrice: parseFloat(document.getElementById('sv-price')?.value||0),
        unit:         document.getElementById('sv-unit')?.value,
        taxable:      document.getElementById('sv-taxable')?.checked !== false,
        active:       document.getElementById('sv-active')?.checked !== false,
        sortOrder:    parseInt(document.getElementById('sv-sort')?.value||9999, 10),
      });
      toast(sId ? 'Service updated' : 'Service created', 'ok');
      await loadServicesTab();
      // Refresh STATE.services so new service appears in line items
      STATE.loadedPanes.delete('inventory');
    } catch(e) { toast(e.message, 'err'); }
    finally { hideLoading(); }
  };
}

export async function toggleServiceActive(serviceId, newActive) {
  showLoading('Updating…');
  try {
    const s = await rpc('getServiceById', serviceId);
    if (!s) { toast('Service not found', 'warn'); return; }
    await rpc('saveService', { ...s, active: newActive === 'true' });
    toast(`Service ${newActive === 'true' ? 'activated' : 'deactivated'}`, 'ok');
    await loadServicesTab();
  } catch(e) { toast(e.message, 'err'); }
  finally { hideLoading(); }
}

// ── Category management ───────────────────────────────────────────────────────
export async function loadCategoriesTab() {
  const el = document.getElementById('categories-list');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--text3);font-size:12px">Loading…</div>';
  try {
    const cats = await rpc('getProductCategories');
    STATE.productCategories = cats;
    renderCategoriesList(cats);
  } catch(e) { el.innerHTML = `<div style="color:var(--danger);font-size:12px">${esc(e.message)}</div>`; }
}

function renderCategoriesList(cats) {
  const el = document.getElementById('categories-list');
  if (!el) return;
  if (!cats?.length) { el.innerHTML = '<div style="color:var(--text3);font-size:12px;padding:12px 0">No categories yet. Click + New Category to add one.</div>'; return; }

  // Group by productGroup
  const byGroup = {};
  cats.forEach(c => {
    const g = c.productGroup || 'Ungrouped';
    if (!byGroup[g]) byGroup[g] = [];
    byGroup[g].push(c);
  });

  el.innerHTML = Object.entries(byGroup).map(([group, items]) => `
    <div style="margin-bottom:16px">
      <div style="font-size:10px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">${esc(group)}</div>
      ${items.map(c => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;
          background:var(--surface);border:1px solid var(--border);border-radius:var(--r2);
          margin-bottom:5px;${c.active===false?'opacity:.55':''}">
          <div style="flex:1">
            <div style="font-weight:600;font-size:13px">${esc(c.category)}
              ${c.subcategory?`<span style="font-size:11px;color:var(--text3);font-weight:400"> / ${esc(c.subcategory)}</span>`:''}
              ${c.active===false?'<span style="font-size:10px;color:var(--text3)"> (inactive)</span>':''}
            </div>
            <div style="font-size:10px;color:var(--text3);font-family:var(--mono)">${esc(c.categoryId)}</div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="window.__editCategory('${esc(c.categoryId)}')">✏</button>
          <button class="btn btn-ghost btn-sm" onclick="window.__deleteCategory('${esc(c.categoryId)}','${esc(c.category)}')"
            style="color:var(--danger)">✕</button>
        </div>`).join('')}
    </div>`).join('');
}

export function openNewCategoryModal() { openCategoryForm(null); }

export async function editCategory(categoryId) {
  const c = STATE.productCategories?.find(x => x.categoryId === categoryId);
  if (c) { openCategoryForm(c); return; }
  showLoading('Loading…');
  try { openCategoryForm(await rpc('getProductCategoryById', categoryId)); }
  catch(e) { toast(e.message,'err'); }
  finally { hideLoading(); }
}

function openCategoryForm(existing) {
  const c = existing || {};
  const isEdit = !!c.categoryId;
  // Gather known groups from existing categories
  const groups = [...new Set((STATE.productCategories||[]).map(x=>x.productGroup).filter(Boolean))].sort();

  openModal('modal-cat-form', isEdit ? `Edit — ${esc(c.category)}` : 'New Category', `
    <div class="form-grid">
      <div class="form-group"><label>Category *</label>
        <input type="text" id="cat-name" value="${esc(c.category||'')}" autofocus placeholder="e.g. PA Systems"></div>
      <div class="form-group"><label>Subcategory</label>
        <input type="text" id="cat-sub" value="${esc(c.subcategory||'')}" placeholder="e.g. Line Arrays"></div>
      <div class="form-group span-2"><label>Product Group</label>
        <input type="text" id="cat-group" value="${esc(c.productGroup||'')}" placeholder="e.g. Audio"
          list="cat-group-list">
        <datalist id="cat-group-list">${groups.map(g=>`<option value="${esc(g)}">`).join('')}</datalist>
      </div>
      <div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="cat-active" ${c.active!==false?'checked':''}> Active
      </label></div>
    </div>`, `
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="window.__submitCategory('${esc(c.categoryId||'')}')">
      ${isEdit?'Save Changes':'Create Category'}
    </button>`
  );

  window.__submitCategory = async (id) => {
    const name = document.getElementById('cat-name')?.value.trim();
    if (!name) { toast('Category name is required','warn'); return; }
    showLoading('Saving…'); closeModal();
    try {
      await rpc('saveProductCategory', {
        categoryId:   id||null,
        category:     name,
        subcategory:  document.getElementById('cat-sub')?.value.trim(),
        productGroup: document.getElementById('cat-group')?.value.trim(),
        active:       document.getElementById('cat-active')?.checked!==false,
      });
      toast(id?'Category updated':'Category created','ok');
      await loadCategoriesTab();
      STATE.loadedPanes.delete('inventory'); // force inventory filter refresh
    } catch(e) { toast(e.message,'err'); }
    finally { hideLoading(); }
  };
}

export async function deleteCategory(categoryId, name) {
  if (!confirm(`Delete category "${name}"? Products using it will keep the value but it won't appear in filters.`)) return;
  showLoading('Deleting…');
  try {
    await rpc('deleteProductCategory', categoryId);
    toast('Category deleted','ok');
    await loadCategoriesTab();
    STATE.loadedPanes.delete('inventory');
  } catch(e) { toast(e.message,'err'); }
  finally { hideLoading(); }
}