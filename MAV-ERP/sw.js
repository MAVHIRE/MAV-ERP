/**
 * MAV Hire ERP — Service Worker v1.0
 * Caches all static shell assets (HTML, CSS, JS) so the app loads
 * instantly and renders offline even when GAS is unavailable.
 * Data fetches (GAS RPC calls) are network-first with no SW caching
 * — the sessionStorage layer in gas.js handles data fallback.
 */

const CACHE_NAME  = 'mav-erp-shell-v1';
const GAS_ORIGIN  = 'script.google.com';

// All static shell files to pre-cache on install
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/main.js',
  '/manifest.json',
  '/css/tokens.css',
  '/css/layout.css',
  '/css/components.css',
  '/js/api/gas.js',
  '/js/utils/state.js',
  '/js/utils/dom.js',
  '/js/utils/format.js',
  '/js/components/modal.js',
  '/js/components/lineItems.js',
  '/js/components/quotePdf.js',
  '/js/panes/analytics.js',
  '/js/panes/auditlog.js',
  '/js/panes/bundles.js',
  '/js/panes/calendar.js',
  '/js/panes/clients.js',
  '/js/panes/crew.js',
  '/js/panes/dashboard.js',
  '/js/panes/enquiries.js',
  '/js/panes/forecast.js',
  '/js/panes/inventory.js',
  '/js/panes/invoices.js',
  '/js/panes/jobs.js',
  '/js/panes/maintenance.js',
  '/js/panes/purchaseorders.js',
  '/js/panes/quotes.js',
  '/js/panes/scan.js',
  '/js/panes/settings.js',
  '/js/panes/storage.js',
  '/js/panes/subrentals.js',
  '/js/panes/suppliers.js',
  '/js/panes/transport.js',
  '/js/panes/warehouse.js',
];

// ── Install: pre-cache all shell assets ───────────────────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting(); // activate immediately
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Cache each file individually so one failure doesn't break everything
      return Promise.allSettled(
        SHELL_ASSETS.map(url =>
          cache.add(url).catch(err => console.warn('[SW] Failed to cache:', url, err))
        )
      );
    })
  );
});

// ── Activate: delete old caches ───────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: strategy depends on request type ───────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // GAS API calls — always network-only (data freshness is handled by gas.js sessionStorage)
  if (url.hostname.includes(GAS_ORIGIN)) {
    event.respondWith(fetch(event.request));
    return;
  }

  // External CDN (Chart.js, ZXing, Three.js) — network-first, cache fallback
  if (url.hostname.includes('cdnjs.cloudflare.com')) {
    event.respondWith(
      fetch(event.request)
        .then(resp => {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          return resp;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Shell assets — cache-first with network fallback
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(resp => {
        // Cache valid responses for shell assets
        if (resp.ok && event.request.method === 'GET') {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return resp;
      }).catch(() => {
        // If offline and no cache — return index.html for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});

// ── Message: force cache refresh (called from main.js on R key) ──────────────
self.addEventListener('message', event => {
  if (event.data === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(() => {
      // Re-cache after clear
      caches.open(CACHE_NAME).then(cache =>
        Promise.allSettled(SHELL_ASSETS.map(url => cache.add(url).catch(() => {})))
      );
    });
  }
});