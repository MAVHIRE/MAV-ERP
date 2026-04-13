/**
 * MAV HIRE ERP — main.js
 * Bootstrap-first architecture.
 */

import { STATE }                    from './js/utils/state.js';
import { showLoading, hideLoading, toast } from './js/utils/dom.js';
import { rpc, GAS_URL, setGasUrl }  from './js/api/gas.js';
import { closeModal, openModal }    from './js/components/modal.js';
import { esc }                      from './js/utils/format.js';

import { initDashboard }            from './js/panes/dashboard.js';

import { loadJobs, filterJobs, openJobDetail, jobAction,
         openNewJobModal, openRecordDepositModal,
         editJob, duplicateJob, checkAvailability, openCheckoutModal }
  from './js/panes/jobs.js';

import { loadQuotes, filterQuotes, openQuoteDetail, openNewQuoteModal,
         editQuote, convertQuoteToJob, duplicateQuote,
         downloadQuotePdf, updateQuoteStatus, emailQuote }
  from './js/panes/quotes.js';

import { loadProducts, filterProducts, openProductDetail,
         openNewProductModal, openAddBarcodeModal,
         openBulkBarcodeImport, openProductCsvImport,
         openLogMaintenanceForProduct, openReturnConditionModal,
         editProduct, openStockAdjustModal, openBarcodeLabelModal,
         ensureProductsLoaded, ensureServicesLoaded }
  from './js/panes/inventory.js';

import { loadClients, filterClients, openNewClientModal, openClientHistory }
  from './js/panes/clients.js';

import { loadSuppliers, filterSuppliers, openNewSupplierModal,
         openSupplierDetail, editSupplier }
  from './js/panes/suppliers.js';

import { loadMaintenance, filterMaintenance, maintAction,
         openNewMaintenanceModal, openMaintDetail,
         maintStart, maintComplete, maintCancel,
         maintAddPart, maintEditCosts }
  from './js/panes/maintenance.js';

import { loadAnalytics, filterSkuTable, runAnalyticsRefresh }
  from './js/panes/analytics.js';

import { loadForecast, runForecastRefresh }
  from './js/panes/forecast.js';

import { loadBundles, filterBundles, openBundleDetail, openNewBundleModal,
         editBundle, deleteBundle, loadAccessories,
         openAddAccessoryModal, deleteAccessoryLink }
  from './js/panes/bundles.js';

import { loadStorage, openAddLocationModal, openMoveBarcodeModal,
         openAssignToBinModal, viewBinContents, openPickList, seedWarehouse }
  from './js/panes/storage.js';

import { loadInvoices, filterInvoices }
  from './js/panes/invoices.js';

import { loadCalendar, calPrev, calNext, calToday, calDayClick }
  from './js/panes/calendar.js';

import { loadSubRentals, filterSubRentals, openNewSubRentalModal,
         editSubRental, deleteSubRental }
  from './js/panes/subrentals.js';

import { loadCrew, filterCrew, openNewCrewModal, editCrew, deleteCrew }
  from './js/panes/crew.js';

import { loadPurchaseOrders, filterPurchaseOrders, openNewPOModal,
         editPO, deletePO, updatePOStatus, openPODetail }
  from './js/panes/purchaseorders.js';

import { loadSettings, saveSettings, updateLogoPreview,
         activateSettingsTab, updatePdfPreview }
  from './js/panes/settings.js';

import { loadScanPane, onScanJobSelect, setScanMode, onScanKeydown, submitScan }
  from './js/panes/scan.js';

// ── Theme ─────────────────────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('mav_theme');
  if (saved === 'light') document.documentElement.classList.add('light');
  updateThemeToggle();
}

function toggleTheme() {
  const isLight = document.documentElement.classList.toggle('light');
  localStorage.setItem('mav_theme', isLight ? 'light' : 'dark');
  updateThemeToggle();
}

function updateThemeToggle() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const isLight = document.documentElement.classList.contains('light');
  btn.textContent = isLight ? '☀' : '◑';
  btn.title = isLight ? 'Switch to dark mode' : 'Switch to light mode';
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  initTheme();
  if (!GAS_URL) { showGasModal(); return; }
  setupTabs();
  exposeGlobals();
  await bootstrap();
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(init, 0);
} else {
  window.addEventListener('load', init);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function bootstrap() {
  showLoading('Connecting to MAV Hire…');
  try {
    const data = await rpc('bootstrapApp');

    if (data.products?.length)  STATE.products  = data.products;
    if (data.clients?.length)   STATE.clients   = data.clients;
    if (data.suppliers?.length) STATE.suppliers = data.suppliers;
    if (data.jobs?.length)      STATE.jobs      = data.jobs;
    if (data.quotes?.length)    STATE.quotes    = data.quotes;
    if (data.bundles?.length)   STATE.bundles   = data.bundles;
    if (data.services?.length)  STATE.services  = data.services;
    if (data.settings)          STATE.settings  = data.settings;
    if (data.dashboard)         STATE.dashboard = data.dashboard;

    hideLoading();
    await initDashboard();

    if (data._fromCache) {
      const el = document.getElementById('cache-indicator');
      if (el) { el.textContent = '⚡ cached'; el.style.display = 'inline'; }
    }
  } catch(e) {
    hideLoading();
    toast('Failed to connect: ' + e.message, 'err');
  }
}

async function refreshAll() {
  STATE.loadedPanes.clear();
  STATE.products = []; STATE.clients = []; STATE.suppliers = [];
  STATE.jobs = []; STATE.quotes = []; STATE.bundles = [];
  STATE.services = []; STATE.dashboard = null;
  await bootstrap();
  const active = STATE.activePane;
  if (active && active !== 'dashboard') {
    STATE.loadedPanes.delete(active);
    await loadPane(active);
  }
}

// ── Tab routing ───────────────────────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.tab[data-pane]').forEach(tab => {
    tab.addEventListener('click', () => switchPane(tab.dataset.pane));
  });
}

function switchPane(paneName) {
  STATE.activePane = paneName;
  document.querySelectorAll('.tab[data-pane]').forEach(t =>
    t.classList.toggle('active', t.dataset.pane === paneName));
  document.querySelectorAll('.pane').forEach(p =>
    p.classList.toggle('active', p.id === 'pane-' + paneName));
  setTimeout(() => loadPane(paneName), 0);
}

async function loadPane(name) {
  switch (name) {
    case 'dashboard':      return initDashboard();
    case 'jobs':           return loadJobs();
    case 'calendar':       return loadCalendar();
    case 'quotes':         return loadQuotes();
    case 'inventory':      return loadProducts();
    case 'clients':        return loadClients();
    case 'suppliers':      return loadSuppliers();
    case 'subrentals':     return loadSubRentals();
    case 'crew':           return loadCrew();
    case 'purchaseorders': return loadPurchaseOrders();
    case 'maintenance':    return loadMaintenance();
    case 'analytics':      return loadAnalytics();
    case 'forecast':       return loadForecast();
    case 'bundles':        return loadBundles();
    case 'storage':        return loadStorage();
    case 'invoices':       return loadInvoices();
    case 'settings':       return loadSettings();
    case 'scan':           return loadScanPane();
  }
}

// ── Bundles sub-tabs ──────────────────────────────────────────────────────────
function switchBundlesTab(tab) {
  const bc = document.getElementById('bundles-content');
  const ac = document.getElementById('accessories-content');
  const tb = document.getElementById('btab-bundles');
  const ta = document.getElementById('btab-accessories');
  if (tab === 'bundles') {
    if (bc) bc.style.display = 'block';
    if (ac) ac.style.display = 'none';
    tb?.classList.add('active'); ta?.classList.remove('active');
  } else {
    if (bc) bc.style.display = 'none';
    if (ac) ac.style.display = 'block';
    tb?.classList.remove('active'); ta?.classList.add('active');
    loadAccessories();
  }
}

// ── Demo helpers ──────────────────────────────────────────────────────────────
async function runSeedDemo() {
  if (!confirm('Seed demo data? Runs in 5 stages — each ~30-90s.')) return;
  const stages = [
    { fn: 'seedDemoStage1',  label: 'Stage 1/5: Suppliers, products & barcodes…' },
    { fn: 'seedDemoStage2',  label: 'Stage 2/5: Clients & quotes…' },
    { fn: 'seedDemoStage3',  label: 'Stage 3/5: Active jobs…' },
    { fn: 'seedDemoStage3b', label: 'Stage 4/5: Historical jobs…' },
    { fn: 'seedDemoStage4',  label: 'Stage 5/5: Maintenance & analytics…' },
  ];
  for (const stage of stages) {
    showLoading(stage.label);
    try {
      const r = await rpc(stage.fn);
      if (!r.ok) { toast(r.message, 'err'); hideLoading(); return; }
      toast(r.message, 'ok');
    } catch(e) { toast('Failed: ' + e.message, 'err'); hideLoading(); return; }
  }
  hideLoading();
  toast('Demo data seeded!', 'ok');
  await refreshAll();
}

async function runClearDemo() {
  if (!confirm('Delete all DEMO- rows?')) return;
  showLoading('Clearing…');
  try {
    const r = await rpc('clearDemoData');
    toast(r.message, 'ok');
    await refreshAll();
  } catch(e) { toast(e.message, 'err'); }
  finally { hideLoading(); }
}

// ── GAS URL modal ─────────────────────────────────────────────────────────────
function showGasModal() {
  openModal('modal-gas-settings', '⚙ Connect to Google Apps Script', `
    <p style="font-size:13px;color:var(--text2);margin-bottom:16px">
      Paste your Google Apps Script web app deployment URL.<br>
      <span class="td-id">Apps Script → Deploy → Manage deployments → copy /exec URL</span>
    </p>
    <div class="form-group">
      <label>Deployment URL</label>
      <input type="url" id="gas-url-input" value="${esc(GAS_URL)}"
        placeholder="https://script.google.com/macros/s/.../exec"
        style="font-family:var(--mono);font-size:12px">
    </div>`, `
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="window.__saveGasUrl()">Save &amp; Connect</button>`
  );
  window.__saveGasUrl = () => {
    const url = document.getElementById('gas-url-input')?.value.trim();
    if (!url) { toast('URL required', 'warn'); return; }
    setGasUrl(url);
  };
  setTimeout(() => document.getElementById('gas-url-input')?.focus(), 50);
}

// ── Expose all globals ────────────────────────────────────────────────────────
function exposeGlobals() {
  // Core
  window.__switchPane    = switchPane;
  window.__closeModal    = closeModal;
  window.__initDashboard = initDashboard;
  window.__showSettings  = showGasModal;
  window.__refreshAll    = refreshAll;
  window.__toggleTheme   = toggleTheme;
  window.__toast         = toast;
  window.__reloadPane    = async (name) => {
    STATE.loadedPanes.delete(name);
    await loadPane(name);
  };

  // Dashboard
  window.__runSeedDemo         = runSeedDemo;
  window.__runClearDemo        = runClearDemo;
  window.__runAnalyticsRefresh = runAnalyticsRefresh;

  // Jobs
  window.__openJobDetail      = openJobDetail;
  window.__jobAction          = jobAction;
  window.__openNewJobModal    = openNewJobModal;
  window.__editJob            = editJob;
  window.__duplicateJob       = duplicateJob;
  window.__checkAvailability  = checkAvailability;
  window.__openCheckoutModal  = openCheckoutModal;
  window.__openPickList       = openPickList;
  window.__recordDeposit      = openRecordDepositModal;
  window.__openReturnCond     = openReturnConditionModal;

  // Quotes
  window.__openQuoteDetail    = openQuoteDetail;
  window.__openNewQuoteModal  = openNewQuoteModal;
  window.__editQuote          = editQuote;
  window.__convertQuoteToJob  = convertQuoteToJob;
  window.__duplicateQuote     = duplicateQuote;
  window.__downloadQuotePdf   = downloadQuotePdf;
  window.__updateQuoteStatus  = updateQuoteStatus;
  window.__emailQuote         = emailQuote;
  window.__generateApprovalLink = async (quoteId) => {
    showLoading('Generating approval link…');
    try {
      const r = await rpc('generateQuoteApprovalLink', quoteId);
      hideLoading();
      openModal('modal-approval-link', '🔗 Quote Approval Link', `
        <p style="font-size:13px;color:var(--text2);margin-bottom:14px">
          Share this link with your client. They can view the quote and accept or decline online.
          The link expires after 90 days or once they respond.
        </p>
        <div style="display:flex;gap:8px;align-items:center">
          <input type="url" id="approval-link-input" value="${esc(r.link)}" readonly
            style="flex:1;font-family:var(--mono);font-size:11px;color:var(--text2)">
          <button class="btn btn-primary btn-sm" onclick="
            navigator.clipboard.writeText(document.getElementById('approval-link-input').value);
            window.__toast('Link copied!','ok')">Copy</button>
        </div>
        <p style="font-size:11px;color:var(--text3);margin-top:10px">
          Include this link in the quote email for easy client response.
        </p>`, `
        <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Close</button>`);
    } catch(e) { hideLoading(); toast(e.message, 'err'); }
  };

  // Inventory
  window.__openProductDetail        = openProductDetail;
  window.__openNewProductModal      = openNewProductModal;
  window.__editProduct              = editProduct;
  window.__openAddBarcodeModal      = openAddBarcodeModal;
  window.__openBulkBarcodeImport    = openBulkBarcodeImport;
  window.__openProductCsvImport     = openProductCsvImport;
  window.__logMaintenanceForProduct = openLogMaintenanceForProduct;
  window.__stockAdjust              = openStockAdjustModal;
  window.__printLabels              = openBarcodeLabelModal;
  window.__previewProductImg        = (url) => {
    const el = document.getElementById('fp-img-preview');
    if (el) el.innerHTML = url
      ? `<img src="${esc(url)}" style="max-height:56px;max-width:80px;object-fit:contain;border-radius:4px"
           onerror="this.style.display='none'">`
      : '';
  };

  // Clients
  window.__openNewClientModal = openNewClientModal;
  window.__openClientHistory  = openClientHistory;

  // Suppliers
  window.__openNewSupplierModal = openNewSupplierModal;
  window.__openSupplierDetail   = openSupplierDetail;
  window.__editSupplier         = editSupplier;
  window.__filterSuppliers      = filterSuppliers;

  // Maintenance
  window.__maintAction             = maintAction;
  window.__openNewMaintenanceModal = openNewMaintenanceModal;
  window.__openMaintDetail         = openMaintDetail;
  window.__maintStart              = maintStart;
  window.__maintComplete           = maintComplete;
  window.__maintCancel             = maintCancel;
  window.__maintAddPart            = maintAddPart;
  window.__maintEditCosts          = maintEditCosts;

  // Analytics
  window.__filterSkuTable      = filterSkuTable;
  window.__runAnalyticsRefresh = runAnalyticsRefresh;

  // Forecast
  window.__runForecastRefresh = runForecastRefresh;

  // Bundles
  window.__openBundleDetail    = openBundleDetail;
  window.__openNewBundleModal  = openNewBundleModal;
  window.__editBundle          = editBundle;
  window.__deleteBundle        = deleteBundle;
  window.__filterBundles       = filterBundles;
  window.__switchBundlesTab    = switchBundlesTab;
  window.__addAccessoryModal   = openAddAccessoryModal;
  window.__deleteAccessoryLink = deleteAccessoryLink;

  // Storage
  window.__addLocationModal  = openAddLocationModal;
  window.__moveBarcodeModal  = openMoveBarcodeModal;
  window.__assignToBinModal  = openAssignToBinModal;
  window.__viewBinContents   = viewBinContents;
  window.__seedWarehouse     = seedWarehouse;

  // Invoices
  window.__filterInvoices = filterInvoices;

  // Calendar
  window.__calPrev     = calPrev;
  window.__calNext     = calNext;
  window.__calToday    = calToday;
  window.__calDayClick = calDayClick;

  // Sub-rentals
  window.__openNewSubRentalModal = openNewSubRentalModal;
  window.__editSubRental         = editSubRental;
  window.__deleteSubRental       = deleteSubRental;
  window.__filterSubRentals      = filterSubRentals;

  // Crew
  window.__openNewCrewModal = openNewCrewModal;
  window.__editCrew         = editCrew;
  window.__deleteCrew       = deleteCrew;
  window.__filterCrew       = filterCrew;

  // Purchase Orders
  window.__openNewPOModal = openNewPOModal;
  window.__editPO         = editPO;
  window.__deletePO       = deletePO;
  window.__updatePOStatus = updatePOStatus;
  window.__openPODetail   = openPODetail;
  window.__filterPOs      = filterPurchaseOrders;

  // Settings
  window.__saveSettings        = saveSettings;
  window.__updateLogoPreview   = updateLogoPreview;
  window.__activateSettingsTab = activateSettingsTab;
  window.__updatePdfPreview    = updatePdfPreview;
  window.__setTheme = (t) => {
    if (t === 'light') document.documentElement.classList.add('light');
    else document.documentElement.classList.remove('light');
    localStorage.setItem('mav_theme', t);
    updateThemeToggle();
  };

  // Scan
  window.__onScanJobSelect = onScanJobSelect;
  window.__setScanMode     = setScanMode;
  window.__onScanKeydown   = onScanKeydown;
  window.__submitScan      = submitScan;

  // Filters
  window.__filterJobs        = filterJobs;
  window.__filterQuotes      = filterQuotes;
  window.__filterProducts    = filterProducts;
  window.__filterClients     = filterClients;
  window.__filterMaintenance = filterMaintenance;
}