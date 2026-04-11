/**
 * MAV HIRE ERP — main.js
 * Entry point. Tab routing, global wiring, settings modal.
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
         editProduct, openStockAdjustModal,
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

import { loadSettings, saveSettings, updateLogoPreview }
  from './js/panes/settings.js';

import { loadScanPane, onScanJobSelect, setScanMode, onScanKeydown, submitScan }
  from './js/panes/scan.js';

// ── Init ──────────────────────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  if (!GAS_URL) { showSettingsModal(); return; }
  setupTabs();
  exposeGlobals();
  await initDashboard();
});

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

  if (!STATE.loadedPanes.has(paneName)) {
    STATE.loadedPanes.add(paneName);
    loadPane(paneName);
  }
}

async function loadPane(name) {
  if (['jobs','quotes','maintenance','scan','bundles'].includes(name))
    await ensureProductsLoaded();
  if (['quotes','jobs','bundles'].includes(name))
    await ensureServicesLoaded();
  if (['quotes','jobs','bundles'].includes(name) && !STATE.bundles.length) {
    try { STATE.bundles = await rpc('getBundles', {}); } catch(e) {}
  }
  if (['jobs','quotes'].includes(name) && !STATE.clients.length) {
    try { STATE.clients = await rpc('getClients', {}); } catch(e) {}
  }

  switch (name) {
    case 'dashboard':   return initDashboard();
    case 'jobs':        return loadJobs();
    case 'quotes':      return loadQuotes();
    case 'inventory':   return loadProducts();
    case 'clients':     return loadClients();
    case 'suppliers':   return loadSuppliers();
    case 'maintenance': return loadMaintenance();
    case 'analytics':   return loadAnalytics();
    case 'forecast':    return loadForecast();
    case 'bundles':     return loadBundles();
    case 'storage':     return loadStorage();
    case 'invoices':    return loadInvoices();
    case 'settings':    return loadSettings();
    case 'scan':        return loadScanPane();
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
  if (!confirm('Seed demo data? This runs in 4 stages — each takes 30–90s. Don\'t close the tab.')) return;

  const stages = [
    { fn: 'seedDemoStage1',  label: 'Stage 1/4: Seeding suppliers, products & barcodes…' },
    { fn: 'seedDemoStage2',  label: 'Stage 2/4: Seeding clients & quotes…' },
    { fn: 'seedDemoStage3',  label: 'Stage 3/4: Seeding active jobs…' },
    { fn: 'seedDemoStage3b', label: 'Stage 3b/4: Seeding historical jobs…' },
    { fn: 'seedDemoStage4',  label: 'Stage 4/4: Seeding maintenance & rebuilding analytics…' },
  ];

  for (const stage of stages) {
    showLoading(stage.label);
    try {
      const r = await rpc(stage.fn);
      if (!r.ok) {
        toast(r.message || 'Stage failed', 'err');
        hideLoading();
        return;
      }
      toast(r.message, 'ok');
    } catch(e) {
      toast('Demo seed failed at ' + stage.fn + ': ' + e.message, 'err');
      hideLoading();
      return;
    }
  }

  hideLoading();
  toast('Demo data fully seeded!', 'ok');
  STATE.loadedPanes.clear();
  STATE.clients = [];
  await initDashboard();
}

async function runClearDemo() {
  if (!confirm('Delete all DEMO- rows from every sheet?')) return;
  showLoading('Clearing demo data…');
  try {
    const r = await rpc('clearDemoData');
    toast(r.message, 'ok');
    STATE.loadedPanes.clear();
    STATE.clients = [];
    await initDashboard();
  } catch(e) { toast('Clear failed: ' + e.message, 'err'); }
  finally { hideLoading(); }
}

// ── GAS URL settings modal ────────────────────────────────────────────────────
function showSettingsModal() {
  openModal('modal-gas-settings', '⚙ Connect to Google Apps Script', `
    <p style="font-size:13px;color:var(--text2);margin-bottom:16px">
      Paste your Google Apps Script web app deployment URL below.<br>
      <span class="td-id">Apps Script → Deploy → Manage deployments → copy /exec URL</span>
    </p>
    <div class="form-group">
      <label>Deployment URL</label>
      <input type="url" id="gas-url-input" value="${esc(GAS_URL)}"
        placeholder="https://script.google.com/macros/s/.../exec"
        style="font-family:var(--mono);font-size:12px">
    </div>
    <p style="font-size:12px;color:var(--text3);margin-top:12px">
      Stored in localStorage. Change anytime via the ⚙ button in the topbar.
    </p>
  `, `
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="window.__saveGasUrl()">Save &amp; Connect</button>
  `);
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
  window.__showSettings  = showSettingsModal;
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

  // Inventory
  window.__openProductDetail        = openProductDetail;
  window.__openNewProductModal      = openNewProductModal;
  window.__editProduct              = editProduct;
  window.__openAddBarcodeModal      = openAddBarcodeModal;
  window.__openBulkBarcodeImport    = openBulkBarcodeImport;
  window.__openProductCsvImport     = openProductCsvImport;
  window.__logMaintenanceForProduct = openLogMaintenanceForProduct;
  window.__stockAdjust              = openStockAdjustModal;
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
  window.__filterInvoices    = filterInvoices;

  // Settings
  window.__saveSettings      = saveSettings;
  window.__updateLogoPreview = updateLogoPreview;

  // Scan
  window.__onScanJobSelect   = onScanJobSelect;
  window.__setScanMode       = setScanMode;
  window.__onScanKeydown     = onScanKeydown;
  window.__submitScan        = submitScan;

  // Filters
  window.__filterJobs        = filterJobs;
  window.__filterQuotes      = filterQuotes;
  window.__filterProducts    = filterProducts;
  window.__filterClients     = filterClients;
  window.__filterMaintenance = filterMaintenance;
}