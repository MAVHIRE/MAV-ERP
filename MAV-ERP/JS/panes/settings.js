/**
 * MAV HIRE ERP — js/panes/settings.js
 * Company settings: branding, VAT, prefixes, defaults, terms.
 */
import { rpc }   from '../api/gas.js';
import { STATE } from '../utils/state.js';
import { showLoading, hideLoading, toast } from '../utils/dom.js';
import { esc } from '../utils/format.js';

export async function loadSettings() {
  showLoading('Loading settings…');
  try {
    STATE.settings = await rpc('getSettings');
    render(STATE.settings);
  } catch(e) { toast('Settings failed: ' + e.message, 'err'); }
  finally { hideLoading(); }
}

function val(id) { return document.getElementById(id)?.value ?? ''; }
function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v ?? ''; }

function render(s) {
  setVal('s-business-name',    s.businessName);
  setVal('s-address',          s.businessAddress);
  setVal('s-phone',            s.businessPhone);
  setVal('s-email',            s.businessEmail);
  setVal('s-website',          s.businessWebsite);
  setVal('s-logo-url',         s.logoUrl);
  setVal('s-vat-rate',         s.vatRate);
  setVal('s-currency',         s.currency);
  setVal('s-quote-prefix',     s.quotePrefix);
  setVal('s-job-prefix',       s.jobPrefix);
  setVal('s-valid-days',       s.defaultQuoteValidDays);
  setVal('s-deposit-pct',      s.defaultDepositPct);
  setVal('s-payment-terms',    s.defaultPaymentTerms);
  setVal('s-quote-terms',      s.defaultQuoteTerms);
  setVal('s-email-footer',     s.defaultEmailFooter);

  // Live logo preview
  updateLogoPreview(s.logoUrl);
}

export function updateLogoPreview(url) {
  const el = document.getElementById('s-logo-preview');
  if (!el) return;
  if (url) {
    el.innerHTML = `<img src="${esc(url)}" alt="Logo preview"
      style="max-height:80px;max-width:240px;object-fit:contain;border-radius:4px"
      onerror="this.parentElement.innerHTML='<span style=color:var(--danger);font-size:12px>⚠ Could not load image</span>'">`;
  } else {
    el.innerHTML = `<span style="font-size:12px;color:var(--text3)">No logo set — paste a URL above</span>`;
  }
}

export async function saveSettings() {
  showLoading('Saving settings…');
  try {
    await rpc('saveSettings', {
      businessName:          val('s-business-name'),
      businessAddress:       val('s-address'),
      businessPhone:         val('s-phone'),
      businessEmail:         val('s-email'),
      businessWebsite:       val('s-website'),
      logoUrl:               val('s-logo-url'),
      vatRate:               parseFloat(val('s-vat-rate')) || 20,
      currency:              val('s-currency') || 'GBP',
      quotePrefix:           val('s-quote-prefix') || 'MAV-Q',
      jobPrefix:             val('s-job-prefix')   || 'MAV-J',
      defaultQuoteValidDays: parseInt(val('s-valid-days'))   || 30,
      defaultDepositPct:     parseInt(val('s-deposit-pct'))  || 50,
      defaultPaymentTerms:   val('s-payment-terms'),
      defaultQuoteTerms:     val('s-quote-terms'),
      defaultEmailFooter:    val('s-email-footer'),
    });
    toast('Settings saved', 'ok');
    // Reload so quotePdf.js picks up new branding
    STATE.settings = await rpc('getSettings');
  } catch(e) { toast(e.message, 'err'); }
  finally { hideLoading(); }
}