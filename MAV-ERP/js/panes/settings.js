/**
 * MAV HIRE ERP — js/panes/settings.js  v2.0
 * Full system settings: company, branding, financials, quote/job defaults,
 * email templates, PDF template designer, notifications, system preferences.
 */
import { rpc }   from '../api/gas.js';
import { STATE } from '../utils/state.js';
import { showLoading, hideLoading, toast } from '../utils/dom.js';
import { esc } from '../utils/format.js';

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
  setVal('s-vat-rate',         s.vatRate * 100);
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

  // System
  setVal('s-date-format',      s.dateFormat);
  setVal('s-timezone',         s.timezone);
}

// ── Collect + save ────────────────────────────────────────────────────────────
export async function saveSettings() {
  const gv  = id => document.getElementById(id)?.value ?? '';
  const gc  = id => document.getElementById(id)?.checked ? 'true' : 'false';
  const gn  = (id, fb=0) => parseFloat(document.getElementById(id)?.value) || fb;
  const gi  = (id, fb=0) => parseInt(document.getElementById(id)?.value) || fb;

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
      dateFormat:           gv('s-date-format'),
      timezone:             gv('s-timezone'),
    });
    toast('Settings saved', 'ok');
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