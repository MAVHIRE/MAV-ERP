/**
 * MAV HIRE ERP — main.js
 * Bootstrap-first architecture.
 */

import { STATE }                    from './js/utils/state.js';
import { showLoading, hideLoading, toast } from './js/utils/dom.js';
import { rpc, rpcWithFallback, GAS_URL, setGasUrl, getAuthToken, setAuthToken, clearRpcCache }  from './js/api/gas.js';
import { closeModal, openModal }    from './js/components/modal.js';
import { esc, escAttr }               from './js/utils/format.js';

import { initDashboard }            from './js/panes/dashboard.js';

import { loadEnquiries, filterEnquiries, filterEnquiryStatus,
         openNewEnquiryModal, openEnquiryDetail, openEnquiryEdit,
         setEnquiryStatus, enqConvertToClient, enqConvertToQuote,
         deleteEnquiryFn, syncShopifyEnquiries, setEnquiryView, exportEnquiriesCsv,
         triageAllEnquiries, enrichEnquiry }
  from './js/panes/enquiries.js';

import { loadJobs, filterJobs, openJobDetail, jobAction,
         openNewJobModal, openRecordDepositModal,
         editJob, duplicateJob, checkAvailability, openCheckoutModal,
         openAddItemToJob, deallocateJob, exportJobsCsv,
         openApplyBundleToJob,
         setJobView, openJobProfitability }
  from './js/panes/jobs.js';

import { loadQuotes, filterQuotes, openQuoteDetail, openNewQuoteModal,
         editQuote, convertQuoteToJob, duplicateQuote, deleteQuote,
         downloadQuotePdf, updateQuoteStatus, emailQuote, openApplyBundleToQuote,
         quoteCheckDate }
  from './js/panes/quotes.js';

import { loadProducts, filterProducts, openProductDetail,
         openNewProductModal, openAddBarcodeModal,
         openBulkBarcodeImport, openProductCsvImport,
         openLogMaintenanceForProduct, openReturnConditionModal,
         editProduct, openStockAdjustModal, openBarcodeLabelModal,
         ensureProductsLoaded, ensureServicesLoaded, openRateCards,
         exportInventoryCsv, setInventoryView }
  from './js/panes/inventory.js';

import { loadClients, filterClients, openNewClientModal, openClientHistory,
         exportClientsCsv, openClientPortal, revokeClientPortal }
  from './js/panes/clients.js';

import { loadSuppliers, filterSuppliers, openNewSupplierModal,
         openSupplierDetail, editSupplier }
  from './js/panes/suppliers.js';

import { loadMaintenance, filterMaintenance, maintAction,
         openNewMaintenanceModal, openMaintDetail,
         maintStart, maintComplete, maintCancel,
         maintAddPart, maintEditCosts, exportMaintenanceCsv,
         openMaintEdit, setMaintenanceStatus, printMaintenanceReport }
  from './js/panes/maintenance.js';

import { loadAnalytics, filterSkuTable, runAnalyticsRefresh, loadRevenueSummary,
         generateExecutiveReport, refreshAnalyticsStats }
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

import { loadWarehouseDesigner, saveWarehouseLayout, openFloorSettings,
         setMode as whSetMode, zoomFit as whZoomFit, exposeWarehouseGlobals }
  from './js/panes/warehouse.js';

import { loadInvoices, filterInvoices, sendPaymentReminder, generateJobInvoice,
         openInvoiceDetail, batchPaymentReminder, exportInvoicesCsv }
  from './js/panes/invoices.js';

import { loadTransport, filterTransport, openNewTransportModal,
         deleteTransport, openVehicleManager, renderFleet }
  from './js/panes/transport.js';

import { loadAuditLog, filterAuditLog, populateAuditFilters, exportAuditLogCsv }
  from './js/panes/auditlog.js';

import { loadCalendar, calPrev, calNext, calToday, calDayClick,
         calSetView, calPrevWeekAware, calNextWeekAware, calTodayWeekAware }
  from './js/panes/calendar.js';

import { loadSubRentals, filterSubRentals, openNewSubRentalModal,
         editSubRental, deleteSubRental, updateSubRentalStatusFn }
  from './js/panes/subrentals.js';

import { loadCrew, filterCrew, openNewCrewModal, editCrew, deleteCrew, exportCrewCsv }
  from './js/panes/crew.js';

import { loadPurchaseOrders, filterPurchaseOrders, openNewPOModal,
         editPO, deletePO, updatePOStatus, openPODetail, exportPOsCsv }
  from './js/panes/purchaseorders.js';

import { loadSettings, saveSettings, updateLogoPreview,
         activateSettingsTab, updatePdfPreview,
         loadServicesTab, openNewServiceModal, editService, toggleServiceActive,
         openNewCategoryModal, editCategory, deleteCategory }
  from './js/panes/settings.js';

import { loadScanPane, onScanJobSelect, setScanMode, onScanKeydown, submitScan,
         loadStocktakeList, submitStocktake, filterStocktakeList, lookupBarcode,
         offerReturnToStorage, bulkAssignToLocation, clearBarcodeLocationFn,
         openCameraScan, closeCameraScan }
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
  const lbl = document.getElementById('theme-label');
  const isLight = document.documentElement.classList.contains('light');
  if (btn) { btn.textContent = isLight ? '☀' : '◑'; btn.title = isLight ? 'Switch to dark mode' : 'Switch to light mode'; }
  if (lbl) lbl.textContent = isLight ? 'Dark Mode' : 'Light Mode';
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  initTheme();

  // Inject manifest only on non-preview deployments.
  // Vercel preview URLs contain a random hash segment (e.g. mav-abc123xyz-org.vercel.app).
  // Fetching manifest.json on those returns 401 (Deployment Protection), polluting the console.
  const isVercelPreview = /\.vercel\.app$/.test(location.hostname) &&
                          /^[a-z]+-[a-z0-9]+-[a-z0-9]+-projects\.vercel\.app$/.test(location.hostname);
  if (!isVercelPreview) {
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = '/manifest.json';
    document.head.appendChild(link);
  }

  // Register service worker for offline shell caching
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(reg => {
        // When user hits R (refreshAll), tell SW to re-cache
        window.__clearSwCache = () => reg.active?.postMessage('CLEAR_CACHE');
      })
      .catch(err => console.warn('[SW] Registration failed:', err));
  }

  if (!GAS_URL) { showGasModal(); return; }
  setupTabs();
  setupDelegation();
  setupTabKeyNav();
  exposeGlobals();
  await bootstrap();
  // Handle ?pane= deep links (PWA shortcuts)
  const urlPane = new URLSearchParams(window.location.search).get('pane');
  if (urlPane && urlPane !== 'dashboard') switchPane(urlPane);
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  requestAnimationFrame(init);
} else {
  window.addEventListener('load', init);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function bootstrap() {
  showLoading('Connecting to MAV Hire…');
  try {
    const data = await rpcWithFallback('bootstrapApp');

    // Fix 17: use Array.isArray so an empty [] from server clears stale state
    if (Array.isArray(data.products))      STATE.products      = data.products;
    if (Array.isArray(data.clients))       STATE.clients       = data.clients;
    if (Array.isArray(data.suppliers))     STATE.suppliers     = data.suppliers;
    if (Array.isArray(data.jobs))          STATE.jobs          = data.jobs;
    if (Array.isArray(data.quotes))        STATE.quotes        = data.quotes;
    if (Array.isArray(data.bundles))       STATE.bundles       = data.bundles;
    if (Array.isArray(data.services))      STATE.services      = data.services;
    if (data.settings)                     STATE.settings      = data.settings;
    if (data.dashboard)                    STATE.dashboard     = data.dashboard;
    if (Array.isArray(data.invoices))      STATE.invoices      = data.invoices;
    if (Array.isArray(data.subRentals))    STATE.subRentals    = data.subRentals;
    if (Array.isArray(data.crew))          STATE.crew          = data.crew;
    if (Array.isArray(data.purchaseOrders))STATE.purchaseOrders= data.purchaseOrders;

    hideLoading();
    await initDashboard();
    updateNavBadges();

    if (data._fromCache) {
      const el = document.getElementById('cache-indicator');
      if (el) { el.textContent = '⚡ cached'; el.style.display = 'inline'; }
    }
  } catch(e) {
    hideLoading();
    toast('Failed to connect: ' + e.message, 'err');
  }
}

function updateNavBadges() {
  // Enquiries badge — new unactioned leads
  const now        = new Date();
  const newEnq     = (STATE.enquiries||[]).filter(e => e.status === 'New').length;
  const followUpDue= (STATE.enquiries||[]).filter(e => {
    if (!e.followUpDate || ['Won','Lost','Spam'].includes(e.status)) return false;
    return new Date(e.followUpDate) <= now;
  }).length;
  const enqBadge = newEnq + followUpDue;
  setBadge('badge-enquiries', enqBadge, enqBadge > 0);

  // Jobs badge — active (Checked Out / Live / Prepping)
  const activeJobs = (STATE.jobs||[]).filter(j =>
    ['Checked Out','Live','Prepping'].includes(j.status)).length;
  setBadge('badge-jobs', activeJobs, activeJobs > 0);

  // Maintenance badge — high-priority open records
  const highMaint = (STATE.maintenance||[]).filter(m =>
    m.priority === 'High' && !['Complete','Cancelled'].includes(m.status)).length;
  setBadge('badge-maintenance', highMaint, highMaint > 0);

  // Invoices badge — jobs with outstanding balance
  const outstandingInv = (STATE.jobs||[]).filter(j =>
    (+j.balanceDue||0) > 0 && !['Cancelled'].includes(j.status)).length;
  setBadge('badge-invoices', outstandingInv, outstandingInv > 0);

  // Forecast badge — shortage predictions
  const shortages = (STATE.forecasts||[]).filter(f =>
    (f.predictedShortageQty||0) > 0).length;
  setBadge('badge-forecast', shortages, shortages > 0);

  // Alert pill — overdue returns
  const overdue = (STATE.jobs||[]).filter(j => j.status === 'Returned' &&
    j.eventDate && Math.floor((Date.now()-new Date(j.eventDate))/86400000) > 2).length;
  const pill = document.getElementById('alert-pill');
  const cnt  = document.getElementById('alert-count');
  if (pill && cnt) {
    cnt.textContent = overdue;
    pill.classList.toggle('hidden', overdue === 0);
  }
}

function setBadge(id, count, show) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = count > 99 ? '99+' : String(count);
  el.style.display = show ? '' : 'none';
}

async function refreshAll() {
  clearRpcCache();
  window.__clearSwCache?.();   // tell SW to re-cache shell assets
  STATE.loadedPanes.clear();
  STATE.products = []; STATE.clients  = []; STATE.suppliers = [];
  STATE.jobs     = []; STATE.quotes   = []; STATE.bundles   = [];
  STATE.services = []; STATE.dashboard= null; STATE.invoices = [];
  STATE.subRentals = []; STATE.crew   = []; STATE.purchaseOrders = [];
  STATE.maintenance= []; STATE.skuStats= []; STATE.forecasts= [];
  // Fix 16: reset previously missed state keys
  STATE.enquiries = []; STATE.productCategories = [];
  await bootstrap();
  updateNavBadges();
  const active = STATE.activePane;
  if (active && active !== 'dashboard') {
    STATE.loadedPanes.delete(active);
    await loadPane(active);
  }
}

// ── Tab routing ───────────────────────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.nav-item[data-pane]').forEach(item => {
    item.addEventListener('click', () => switchPane(item.dataset.pane));
  });
}

const PANE_LABELS = {
  dashboard:'Dashboard', jobs:'Jobs', calendar:'Calendar', quotes:'Quotes',
  enquiries:'Enquiries', inventory:'Products', clients:'Clients', suppliers:'Suppliers',
  subrentals:'Sub-Rentals', crew:'Crew', purchaseorders:'Purchase Orders',
  maintenance:'Maintenance', analytics:'Analytics', forecast:'Forecast',
  bundles:'Bundles', storage:'Warehouse', invoices:'Invoices',
  transport:'Transport', scan:'Scan Station', auditlog:'Audit Log', settings:'Settings',
};

function switchPane(paneName) {
  STATE.activePane = paneName;
  document.querySelectorAll('.nav-item[data-pane]').forEach(t => {
    const isActive = t.dataset.pane === paneName;
    t.classList.toggle('active', isActive);
    // Maintain aria-current for accessibility
    if (isActive) t.setAttribute('aria-current', 'page');
    else          t.removeAttribute('aria-current');
  });
  document.querySelectorAll('.pane').forEach(p =>
    p.classList.toggle('active', p.id === 'pane-' + paneName));
  const bc = document.getElementById('topbar-breadcrumb');
  if (bc) bc.textContent = PANE_LABELS[paneName] || paneName;
  // Update theme label
  const tl = document.getElementById('theme-label');
  if (tl) {
    const isLight = document.documentElement.classList.contains('light');
    tl.textContent = isLight ? 'Dark Mode' : 'Light Mode';
  }
  requestAnimationFrame(() => loadPane(paneName));
}

async function loadPane(name) {
  switch (name) {
    case 'enquiries':     return loadEnquiries();
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
    case 'storage':        return loadWarehouseDesigner();
    case 'invoices':       return loadInvoices();
    case 'settings':       return loadSettings();
    case 'scan':           return loadScanPane();
    case 'transport':      return loadTransport();
    case 'auditlog':       return loadAuditLog().then(() => populateAuditFilters());
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
    </div>
    <div class="form-group" style="margin-top:12px">
      <label>Access Token <span style="font-size:11px;color:var(--text3)">(optional — set in Settings → System if GAS auth is enabled)</span></label>
      <input type="password" id="gas-token-input" value="${esc(getAuthToken())}"
        placeholder="Leave blank if AUTH_TOKEN not set in GAS Settings"
        style="font-family:var(--mono);font-size:12px">
    </div>`, `
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="window.__saveGasUrl()">Save &amp; Connect</button>`
  );
  window.__saveGasUrl = () => {
    const url   = document.getElementById('gas-url-input')?.value.trim();
    const token = document.getElementById('gas-token-input')?.value.trim();
    if (!url) { toast('URL required', 'warn'); return; }
    if (token !== getAuthToken()) setAuthToken(token);
    setGasUrl(url);
  };
  requestAnimationFrame(() => document.getElementById('gas-url-input')?.focus());
}

function showAuthPrompt() {
  openModal('modal-auth-prompt', '🔒 Access Token Required', `
    <p style="font-size:13px;color:var(--text2);margin-bottom:16px">
      The GAS backend requires an access token. Enter it below to continue.
    </p>
    <div class="form-group">
      <label>Access Token</label>
      <input type="password" id="auth-token-input" placeholder="Enter token…"
        style="font-family:var(--mono);font-size:14px" autofocus>
    </div>`, `
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="window.__submitAuthToken()">Connect</button>`
  );
  window.__submitAuthToken = async () => {
    const token = document.getElementById('auth-token-input')?.value.trim();
    if (!token) { toast('Enter token', 'warn'); return; }
    setAuthToken(token);
    closeModal();
    toast('Token saved — retrying…', 'info');
    await bootstrap();
  };
}

// ── Expose all globals ────────────────────────────────────────────────────────
function exposeGlobals() {
  // Core
  window.__switchPane     = switchPane;
  window.__closeModal     = closeModal;
  window.__initDashboard  = initDashboard;
  window.__showSettings   = showGasModal;
  window.__showAuthPrompt = showAuthPrompt;
  window.__refreshAll     = refreshAll;
  window.__toggleTheme    = toggleTheme;
  window.__toast          = toast;
  window.__reloadPane     = async (name) => {
    STATE.loadedPanes.delete(name);
    await loadPane(name);
  };

  // Dashboard
  window.__runAnalyticsRefresh = runAnalyticsRefresh;

  // Enquiries
  window.__loadEnquiries        = loadEnquiries;
  window.__filterEnquiries      = filterEnquiries;
  window.__filterEnquiryStatus  = filterEnquiryStatus;
  window.__openNewEnquiryModal  = openNewEnquiryModal;
  window.__openEnquiryDetail    = openEnquiryDetail;
  window.__openEnquiryEdit      = openEnquiryEdit;
  window.__setEnquiryStatus     = setEnquiryStatus;
  window.__enqConvertToClient   = enqConvertToClient;
  window.__enqConvertToQuote    = enqConvertToQuote;
  window.__deleteEnquiry        = deleteEnquiryFn;
  window.__syncShopifyEnquiries = syncShopifyEnquiries;
  window.__setEnquiryView       = setEnquiryView;
  window.__exportEnquiriesCsv   = exportEnquiriesCsv;
  window.__triageAllEnquiries   = triageAllEnquiries;
  window.__enrichEnquiry        = enrichEnquiry;

  // Jobs
  window.__openJobDetail      = openJobDetail;
  window.__jobAction          = jobAction;
  window.__openNewJobModal    = openNewJobModal;
  window.__editJob            = editJob;
  window.__duplicateJob       = duplicateJob;
  window.__checkAvailability  = checkAvailability;
  window.__openCheckoutModal  = openCheckoutModal;
  window.__openAddItemToJob   = openAddItemToJob;
  window.__deallocateJob      = deallocateJob;
  window.__openApplyBundleToJob = openApplyBundleToJob;
  window.__openPickList       = openPickList;
  window.__recordDeposit      = openRecordDepositModal;
  window.__openReturnCond     = openReturnConditionModal;
  window.__setJobView         = setJobView;
  window.__openJobProfitability = openJobProfitability;

  // Quotes
  window.__openQuoteDetail    = openQuoteDetail;
  window.__openNewQuoteModal  = openNewQuoteModal;
  window.__editQuote          = editQuote;
  window.__convertQuoteToJob  = convertQuoteToJob;
  window.__duplicateQuote     = duplicateQuote;
  window.__deleteQuote        = deleteQuote;
  window.__downloadQuotePdf   = downloadQuotePdf;
  window.__updateQuoteStatus  = updateQuoteStatus;
  window.__emailQuote         = emailQuote;
  window.__openApplyBundleToQuote = openApplyBundleToQuote;
  window.__quoteCheckDate         = quoteCheckDate;
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
  window.__setInventoryView         = setInventoryView;

  // Clients
  window.__openNewClientModal = openNewClientModal;
  window.__openClientHistory   = openClientHistory;
  window.__openClientPortal    = openClientPortal;
  window.__revokeClientPortal  = revokeClientPortal;

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
  window.__openMaintEdit           = openMaintEdit;
  window.__setMaintenanceStatus    = setMaintenanceStatus;
  window.__printMaintenanceReport  = printMaintenanceReport;
  window.__maintEditCosts          = maintEditCosts;

  // Analytics
  window.__filterSkuTable      = filterSkuTable;
  window.__runAnalyticsRefresh = runAnalyticsRefresh;
  window.__loadRevenueSummary  = loadRevenueSummary;
  window.__generateExecReport  = generateExecutiveReport;
  window.__refreshAnalyticsStats = refreshAnalyticsStats;

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

  // Storage (list view)
  window.__addLocationModal  = openAddLocationModal;
  window.__moveBarcodeModal  = openMoveBarcodeModal;
  window.__assignToBinModal  = openAssignToBinModal;
  window.__viewBinContents   = viewBinContents;
  window.__seedWarehouse     = seedWarehouse;

  // Warehouse designer
  exposeWarehouseGlobals();  // sets __whFloorSettings, __whSave, __whOpenAdd, __whLookupBarcode, __whRebuild etc.
  // Explicit top-level aliases so static analysis sees them
  window.__whFloorSettings = window.__whFloorSettings;
  window.__whSave          = window.__whSave;
  window.__whOpenAdd       = window.__whOpenAdd;
  window.__whLookupBarcode = window.__whLookupBarcode;
  window.__whRebuild       = window.__whRebuild;
  window.__whSwitchView = (view) => {
    const designer = document.getElementById('wh-designer-view');
    const list     = document.getElementById('wh-list-view');
    if (designer) designer.style.display = view === 'designer' ? 'flex' : 'none';
    if (list)     list.style.display     = view === 'list'     ? 'block' : 'none';
    document.querySelectorAll('.wh-view-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.view === view));
    if (view === 'list') loadStorage();
    // 80ms gives the layout engine time to set container dimensions before Three.js reads them
          if (view === 'designer') setTimeout(() => window.__whRebuild?.(), 80);
  };
  // Camera preset views — set as safe stubs; overwritten by init3D()/init2D() when scene loads
  window.__whResetView  = window.__whResetView  || (() => {});
  window.__whTopView    = window.__whTopView    || (() => {});
  window.__whFrontView  = window.__whFrontView  || (() => {});
  window.__whFitFloor   = window.__whFitFloor   || (() => {});

  // Invoices
  window.__filterInvoices        = filterInvoices;
  window.__sendPaymentReminder   = sendPaymentReminder;
  window.__generateJobInvoice    = generateJobInvoice;
  window.__openInvoiceDetail     = openInvoiceDetail;
  window.__batchPaymentReminder  = batchPaymentReminder;
  window.__exportInvoicesCsv     = exportInvoicesCsv;

  // Transport
  window.__filterTransport       = filterTransport;
  window.__openNewTransportModal = openNewTransportModal;
  window.__deleteTransport       = deleteTransport;
  window.__openVehicleManager    = openVehicleManager;

  // Audit Log
  window.__filterAuditLog        = filterAuditLog;
  window.__exportAuditLogCsv     = exportAuditLogCsv;

  // Inventory rate cards
  window.__openRateCards         = openRateCards;

  // Calendar
  window.__calPrev     = calPrevWeekAware;
  window.__calNext     = calNextWeekAware;
  window.__calToday    = calTodayWeekAware;
  window.__calSetView  = calSetView;
  window.__calDayClick = calDayClick;

  // Sub-rentals
  window.__openNewSubRentalModal = openNewSubRentalModal;
  window.__editSubRental         = editSubRental;
  window.__deleteSubRental       = deleteSubRental;
  window.__updateSubRentalStatus = updateSubRentalStatusFn;
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
  window.__activateSettingsTab = (tab) => {
    activateSettingsTab(tab);
    if (tab === 'services') loadServicesTab();
  };
  window.__updatePdfPreview    = updatePdfPreview;
  window.__openNewServiceModal = openNewServiceModal;
  window.__openNewCategoryModal = openNewCategoryModal;
  window.__editCategory        = editCategory;
  window.__deleteCategory      = deleteCategory;
  window.__editService         = editService;
  window.__toggleServiceActive = toggleServiceActive;
  window.__generateAuthToken   = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const arr   = new Uint8Array(32);
    crypto.getRandomValues(arr);
    const token = Array.from(arr).map(b => chars[b % chars.length]).join('');
    const el = document.getElementById('s-auth-token');
    if (el) { el.value = token; el.type = 'text'; }
    toast('Token generated — save settings to apply', 'info');
  };
  window.__setTheme = (t) => {
    if (t === 'light') document.documentElement.classList.add('light');
    else document.documentElement.classList.remove('light');
    localStorage.setItem('mav_theme', t);
    updateThemeToggle();
  };

  // Scan
  window.__onScanJobSelect    = onScanJobSelect;
  window.__setScanMode        = setScanMode;
  window.__onScanKeydown      = onScanKeydown;
  window.__submitScan         = submitScan;
  window.__loadStocktakeList  = loadStocktakeList;
  window.__submitStocktake    = submitStocktake;
  window.__filterStocktakeList= filterStocktakeList;
  window.__lookupBarcode      = lookupBarcode;
  window.__offerReturnToStorage  = offerReturnToStorage;
  window.__bulkAssignToLocation  = bulkAssignToLocation;
  window.__clearBarcodeLocation  = clearBarcodeLocationFn;
  window.__openCameraScan        = openCameraScan;
  window.__closeCameraScan       = closeCameraScan;
  window.__returnAllToStorage    = async (jobId) => {
    showLoading('Returning barcodes to storage…');
    try {
      const result = await rpc('returnBarcodesToStorage', jobId);
      toast(`${result?.returned||0} barcode${(result?.returned||0)!==1?'s':''} returned to last known locations`, 'ok');
    } catch(e) { toast(e.message, 'err'); }
    finally { hideLoading(); }
  };

  // Filters
  window.__filterJobs        = filterJobs;
  window.__filterQuotes      = filterQuotes;
  window.__filterProducts    = filterProducts;
  window.__filterClients     = filterClients;
  window.__filterMaintenance = filterMaintenance;

  // CSV exports
  window.__exportJobsCsv        = exportJobsCsv;
  window.__exportInventoryCsv   = exportInventoryCsv;
  window.__exportClientsCsv     = exportClientsCsv;
  window.__exportMaintenanceCsv = exportMaintenanceCsv;
  window.__exportCrewCsv        = exportCrewCsv;
  window.__exportPOsCsv         = exportPOsCsv;

  // ── Global search ────────────────────────────────────────────────────────
  let _searchTimer = null;
  window.__globalSearch = (q) => {
    clearTimeout(_searchTimer);
    const el = document.getElementById('global-search-results');
    if (!el) return;
    if (!q || q.length < 2) { el.style.display = 'none'; return; }
    _searchTimer = setTimeout(async () => {
      el.style.display = 'block';
      el.innerHTML = `<div style="padding:12px;color:var(--text3);font-size:12px;font-family:var(--mono)">Searching…</div>`;
      try {
        const [jobs, clients, products, quotes, enquiries, maintenance] = await Promise.all([
          rpc('getJobs', { search: q }),
          rpc('searchClients', q),
          rpc('searchProducts', q),
          rpc('getQuotes', { search: q }).catch(() => []),
          rpc('getEnquiries', {}).then(all => {
            const ql = q.toLowerCase();
            return all.filter(e => [e.name,e.email,e.company,e.eventType,e.venuePostcode,e.enquiryDetails].join(' ').toLowerCase().includes(ql));
          }).catch(() => []),
          rpc('getMaintenanceRecords', {}).then(all => {
            const ql = q.toLowerCase();
            return all.filter(m => [m.productName,m.barcode,m.faultDescription,m.technicianName,m.maintenanceId].join(' ').toLowerCase().includes(ql));
          }).catch(() => []),
        ]);
        const sections = [];
        const item = (icon, label, sub, pane, id, fn) => {
          const safeId   = escAttr(id);
          const safePane = escAttr(pane);
          const safeFn   = fn ? escAttr(fn) : '';
          return `<div onclick="this.closest('#global-search-results').style.display='none';window.__switchPane('${safePane}');${safeFn?`setTimeout(()=>window.${safeFn}('${safeId}'),300)`:''}"
            style="display:flex;gap:10px;align-items:center;padding:8px 12px;cursor:pointer;
            border-radius:4px;transition:background .12s"
            onmouseover="this.style.background='var(--surface2)'"
            onmouseout="this.style.background=''"
          >
            <span style="font-size:16px;width:20px;text-align:center">${icon}</span>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(label)}</div>
              ${sub?`<div style="font-size:11px;color:var(--text3)">${esc(sub)}</div>`:''}
            </div>
          </div>`;
        };

        if (enquiries?.length) {
          sections.push(`<div style="padding:6px 12px 2px;font-size:10px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;letter-spacing:.08em">Enquiries</div>`);
          sections.push(...enquiries.slice(0,4).map(e => item('◈', e.name||'—', `${e.eventType||''} · ${e.status} · ${e.venuePostcode||''}`.trim().replace(/^·\s*/,'').replace(/\s*·\s*$/,''), 'enquiries', e.enquiryId, '__openEnquiryDetail')));
        }
        if (jobs?.length) {
          sections.push(`<div style="padding:6px 12px 2px;font-size:10px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;letter-spacing:.08em">Jobs</div>`);
          sections.push(...jobs.slice(0,4).map(j => item('◉', j.jobName||j.jobId, `${j.clientName} · ${j.status}`, 'jobs', j.jobId, '__openJobDetail')));
        }
        if (quotes?.length) {
          sections.push(`<div style="padding:6px 12px 2px;font-size:10px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;letter-spacing:.08em">Quotes</div>`);
          sections.push(...quotes.slice(0,4).map(q2 => item('◧', q2.quoteName||q2.quoteId, `${q2.clientName||''} · ${q2.status}`, 'quotes', q2.quoteId, '__openQuoteDetail')));
        }
        if (clients?.length) {
          sections.push(`<div style="padding:6px 12px 2px;font-size:10px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;letter-spacing:.08em">Clients</div>`);
          sections.push(...clients.slice(0,4).map(c => item('◑', c.clientName, `${c.company||''} ${c.email||''}`.trim(), 'clients', c.clientId, '__openClientHistory')));
        }
        if (products?.length) {
          sections.push(`<div style="padding:6px 12px 2px;font-size:10px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;letter-spacing:.08em">Inventory</div>`);
          sections.push(...products.slice(0,4).map(p => item('▦', p.name, `${p.sku} · ${p.category||''}`, 'inventory', p.productId, '__openProductDetail')));
        }
        if (maintenance?.length) {
          sections.push(`<div style="padding:6px 12px 2px;font-size:10px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;letter-spacing:.08em">Maintenance</div>`);
          sections.push(...maintenance.slice(0,4).map(m => item('⚙', m.productName||m.maintenanceId, `${m.barcode||''} · ${m.status||''} · ${m.priority||''}`.replace(/^·\s*/,'').replace(/\s*·\s*$/,''), 'maintenance', m.maintenanceId, '__openMaintenanceDetail')));
        }
        if (!sections.length) {
          el.innerHTML = `<div style="padding:16px;text-align:center;color:var(--text3);font-size:12px">No results for "<strong>${esc(q)}</strong>"</div>`;
        } else {
          el.innerHTML = sections.join('');
        }
      } catch(e) {
        el.innerHTML = `<div style="padding:12px;color:var(--danger);font-size:12px">${e.message}</div>`;
      }
    }, 280);
  };

  window.__globalSearchKey = (e) => {
    if (e.key === 'Escape') {
      document.getElementById('global-search-results').style.display = 'none';
      document.getElementById('global-search-input').blur();
    }
    if (e.key === 'Enter') {
      const first = document.querySelector('#global-search-results [onclick]');
      if (first) { first.click(); window.__hideGlobalResults(); }
    }
  };

  window.__hideGlobalResults = () => {
    const el = document.getElementById('global-search-results');
    if (el) el.style.display = 'none';
  };

  // ── Mobile search toggle ─────────────────────────────────────────────────
  // Show the ⌕ icon button in topbar only on small screens
  const _mobileSearchBtn = document.getElementById('mobile-search-btn');
  const _mq = window.matchMedia('(max-width: 768px)');
  const _syncMobileSearchBtn = () => {
    if (_mobileSearchBtn) _mobileSearchBtn.style.display = _mq.matches ? 'flex' : 'none';
  };
  _mq.addEventListener('change', _syncMobileSearchBtn);
  _syncMobileSearchBtn();

  window.__toggleMobileSearch = () => {
    const overlay = document.getElementById('mobile-search-overlay');
    if (!overlay) return;
    const isOpen = overlay.style.display === 'flex';
    overlay.style.display = isOpen ? 'none' : 'flex';
    if (!isOpen) {
      const inp = document.getElementById('mobile-search-input');
      if (inp) { inp.value = ''; inp.focus(); }
      // Wire global search to populate mobile results too
      const mobileResults = document.getElementById('mobile-search-results');
      // Temporarily redirect search results to mobile container
      const desktopResults = document.getElementById('global-search-results');
      if (mobileResults && desktopResults) {
        // Mirror search results to mobile container
        const observer = new MutationObserver(() => {
          mobileResults.innerHTML = desktopResults.innerHTML;
          // Fix onclick references so they close the mobile overlay too
          mobileResults.querySelectorAll('[onclick]').forEach(el => {
            const orig = el.getAttribute('onclick');
            el.setAttribute('onclick', `document.getElementById('mobile-search-overlay').style.display='none';${orig}`);
          });
        });
        observer.observe(desktopResults, { childList: true, subtree: true });
        overlay._observer = observer;
      }
    } else {
      overlay._observer?.disconnect();
    }
  };

  window.__mobileSearchKey = (e) => {
    if (e.key === 'Escape') window.__toggleMobileSearch();
  };

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    // Escape closes modal
    if (e.key === 'Escape') { closeModal(); return; }
    const key = e.key;
    const noMod = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (key === '/' ) { e.preventDefault(); document.getElementById('global-search-input')?.focus(); return; }
    // Navigation
    if (key === 'd' && noMod) { switchPane('dashboard');      return; }
    if (key === 'e' && noMod) { switchPane('enquiries');      return; }
    if (key === 'n' && noMod) { switchPane('enquiries');      requestAnimationFrame(() => window.__openNewEnquiryModal?.()); return; }
    if (key === 'j' && noMod) { switchPane('jobs');           window.__openNewJobModal?.();   return; }
    if (key === 'q' && noMod) { switchPane('quotes');         window.__openNewQuoteModal?.(); return; }
    if (key === 'i' && noMod) { switchPane('inventory');      return; }
    if (key === 'c' && noMod) { switchPane('clients');        return; }
    if (key === 'm' && noMod) { switchPane('maintenance');    return; }
    if (key === 'f' && noMod) { switchPane('forecast');       return; }
    if (key === 'a' && noMod) { switchPane('analytics');      return; }
    if (key === 't' && noMod) { switchPane('transport');      return; }
    if (key === 's' && noMod) { switchPane('scan');           return; }
    if (key === 'r' && noMod) { window.__refreshAll?.();      return; }
    if (key === '?' ) {
      e.preventDefault();
      openModal('modal-shortcuts', '⌨ Keyboard Shortcuts', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 24px;font-size:12px">
          ${[
            ['/', 'Global search'],
            ['D', 'Dashboard'],
            ['E', 'Enquiries'],
            ['N', 'New Enquiry'],
            ['J', 'New Job'],
            ['Q', 'New Quote'],
            ['I', 'Products'],
            ['C', 'Clients'],
            ['M', 'Maintenance'],
            ['F', 'Forecast'],
            ['A', 'Analytics'],
            ['T', 'Transport'],
            ['S', 'Scan Station'],
            ['R', 'Refresh data'],
            ['Esc', 'Close modal'],
            ['?', 'This help'],
          ].map(([k,l]) => `
            <div style="display:flex;gap:10px;align-items:center;padding:6px 0;
              border-bottom:1px solid var(--border)">
              <kbd style="font-family:var(--mono);background:var(--surface3);
                border:1px solid var(--border2);padding:2px 8px;border-radius:4px;
                font-size:11px;min-width:28px;text-align:center;flex-shrink:0">${k}</kbd>
              <span style="color:var(--text2)">${l}</span>
            </div>`).join('')}
        </div>
        <p style="font-size:11px;color:var(--text3);margin-top:12px">
          Shortcuts are disabled when typing in a field.
        </p>`, `<button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Close</button>`
      );
    }
  });
}

// ── Centralised event delegation ──────────────────────────────────────────────
// All data-action buttons route through here instead of inline onclick handlers.
// This is the single source of truth for button behaviour — no globals needed.
function setupDelegation() {
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    switch (action) {
      // ── Pane navigation ──────────────────────────────────────────────────
      case 'switch-pane':
        switchPane(btn.dataset.pane); break;

      // ── Pane reload ──────────────────────────────────────────────────────
      case 'reload-pane':
        STATE.loadedPanes.delete(btn.dataset.pane);
        await loadPane(btn.dataset.pane); break;

      // ── Open new entity modals ───────────────────────────────────────────
      case 'open-new': {
        const openFn = {
          job:         window.__openNewJobModal,
          quote:       window.__openNewQuoteModal,
          client:      window.__openNewClientModal,
          supplier:    window.__openNewSupplierModal,
          crew:        window.__openNewCrewModal,
          enquiry:     window.__openNewEnquiryModal,
          maintenance: window.__openNewMaintenanceModal,
          po:          window.__openNewPOModal,
          subrental:   window.__openNewSubRentalModal,
          transport:   window.__openNewTransportModal,
          bundle:      window.__openNewBundleModal,
          service:     window.__openNewServiceModal,
          category:    window.__openNewCategoryModal,
          product:     window.__openNewProductModal,
        }[btn.dataset.entity];
        openFn?.(); break;
      }

      // ── CSV exports ──────────────────────────────────────────────────────
      case 'export-csv': {
        const exportFn = {
          inventory:   window.__exportInventoryCsv,
          jobs:        window.__exportJobsCsv,
          clients:     window.__exportClientsCsv,
          enquiries:   window.__exportEnquiriesCsv,
          crew:        window.__exportCrewCsv,
          maintenance: window.__exportMaintenanceCsv,
          invoices:    window.__exportInvoicesCsv,
          pos:         window.__exportPOsCsv,
          auditlog:    window.__exportAuditLogCsv,
        }[btn.dataset.pane];
        exportFn?.(); break;
      }

      // ── View toggles ─────────────────────────────────────────────────────
      case 'set-view': {
        const pane = btn.dataset.pane;
        const view = btn.dataset.view;
        if (pane === 'jobs')      window.__setJobView?.(view);
        else if (pane === 'enquiries') window.__setEnquiryView?.(view);
        break;
      }

      // ── Calendar nav ─────────────────────────────────────────────────────
      case 'cal-view':  window.__calSetView?.(btn.dataset.view); break;
      case 'cal-nav': {
        const dir = btn.dataset.dir;
        if (dir === 'next')  window.__calNext?.();
        else if (dir === 'prev')  window.__calPrev?.();
        else if (dir === 'today') window.__calToday?.();
        break;
      }

      // ── Settings / bundles tabs ──────────────────────────────────────────
      case 'settings-tab': window.__activateSettingsTab?.(btn.dataset.tab); break;
      case 'bundles-tab':  window.__switchBundlesTab?.(btn.dataset.tab); break;

      // ── Warehouse ────────────────────────────────────────────────────────
      case 'wh-view':        window.__whSwitchView?.(btn.dataset.view); break;
      case 'wh-add':         window.__whOpenAdd?.(btn.dataset.type); break;
      case 'wh-save':        window.__whSave?.(); break;
      case 'wh-floor-settings': window.__whFloorSettings?.(); break;
      case 'wh-fit-floor':   window.__whFitFloor?.(); break;
      case 'wh-reset-view':  window.__whResetView?.(); break;
      case 'wh-top-view':    window.__whTopView?.(); break;
      case 'wh-front-view':  window.__whFrontView?.(); break;
      case 'wh-rebuild':     window.__whRebuild?.(); break;
      case 'seed-warehouse': window.__seedWarehouse?.(); break;

      // ── App chrome ───────────────────────────────────────────────────────
      case 'refresh-all':          refreshAll(); break;
      case 'toggle-theme':         toggleTheme(); break;
      case 'toggle-mobile-search': window.__toggleMobileSearch?.(); break;
      case 'show-settings':        showGasModal(); break;
      case 'set-theme':            window.__setTheme?.(btn.dataset.theme); break;

      // ── Settings ─────────────────────────────────────────────────────────
      case 'save-settings':        window.__saveSettings?.(); break;
      case 'generate-auth-token':  window.__generateAuthToken?.(); break;

      // ── Analytics / Forecast ─────────────────────────────────────────────
      case 'analytics-refresh':    window.__runAnalyticsRefresh?.(); break;
      case 'forecast-refresh':     window.__runForecastRefresh?.(); break;
      case 'generate-exec-report': window.__generateExecReport?.(); break;
      case 'load-revenue-summary': window.__loadRevenueSummary?.(); break;

      // ── Operations ───────────────────────────────────────────────────────
      case 'triage-enquiries':    window.__triageAllEnquiries?.(); break;
      case 'sync-shopify':        window.__syncShopifyEnquiries?.(); break;
      case 'print-maintenance':   window.__printMaintenanceReport?.(); break;
      case 'open-vehicle-manager':window.__openVehicleManager?.(); break;

      // ── Inventory ─────────────────────────────────────────────────────────
      case 'open-add-barcode':    window.__openAddBarcodeModal?.(); break;
      case 'open-bulk-barcode':   window.__openBulkBarcodeImport?.(); break;
      case 'open-product-csv':    window.__openProductCsvImport?.(); break;
      case 'inv-view':            window.__setInventoryView?.(btn.dataset.view); break;

      default:
        // Unknown action — ignore silently
        break;
    }
  });
}

// ── Accessible tab keyboard navigation ───────────────────────────────────────
// Adds Left/Right/Home/End arrow key support to any element with role="tablist".
// Also keeps aria-selected in sync when tabs are clicked via delegation.
function setupTabKeyNav() {
  document.addEventListener('keydown', (e) => {
    const tab = e.target.closest('[role="tab"]');
    if (!tab) return;
    const list = tab.closest('[role="tablist"]');
    if (!list) return;
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    const idx  = tabs.indexOf(tab);
    if (idx === -1) return;

    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown')  next = (idx + 1) % tabs.length;
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')    next = (idx - 1 + tabs.length) % tabs.length;
    if (e.key === 'Home')                                  next = 0;
    if (e.key === 'End')                                   next = tabs.length - 1;
    if (next === -1) return;

    e.preventDefault();
    tabs[next].focus();
    tabs[next].click(); // activate the tab
  });

  // Sync aria-selected on tab click (for tabs that use data-action delegation)
  document.addEventListener('click', (e) => {
    const tab = e.target.closest('[role="tab"]');
    if (!tab) return;
    const list = tab.closest('[role="tablist"]');
    if (!list) return;
    list.querySelectorAll('[role="tab"]').forEach(t => {
      t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
    });
  });
}