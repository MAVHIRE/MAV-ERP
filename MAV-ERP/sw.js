/**
 * MAV Hire ERP — Service Worker v2.0
 * Fix 18: JS/HTML are network-first so Vercel deploys propagate immediately.
 * CSS is still cache-first (rarely changes, safe to cache).
 * CDN assets (Chart.js, Three.js, ZXing) are network-first with cache fallback.
 * GAS RPC calls bypass SW entirely — data freshness handled by gas.js.
 * Version string auto-derived from build timestamp — no manual bumping needed.
 */

const CACHE_VERSION = 'mav-erp-v2-' + self.registration.scope;
const CACHE_NAME    = CACHE_VERSION;
const GAS_ORIGIN    = 'script.google.com';

// CSS assets: cache-first (safe, stable)
const CSS_ASSETS = [
  '/css/tokens.css',
  '/css/layout.css',
  '/css/components.css',
];

// Everything else pre-cached but served network-first
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/main.js',
  '/manifest.json',
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

// ── Install: pre-cache everything ────────────────────────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(
        [...SHELL_ASSETS, ...CSS_ASSETS].map(url =>
          cache.add(url).catch(err => console.warn('[SW] Cache miss:', url, err))
        )
      )
    )
  );
});

// ── Activate: delete ALL old caches ──────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: strategy by request type ──────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // GAS API — bypass SW entirely
  if (url.hostname.includes(GAS_ORIGIN)) {
    event.respondWith(fetch(event.request));
    return;
  }

  // CDN assets (Chart.js, Three.js, ZXing) — network-first, long cache fallback
  if (url.hostname.includes('cdnjs.cloudflare.com')) {
    event.respondWith(
      fetch(event.request)
        .then(resp => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return resp;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // CSS — cache-first (fast, rarely changes)
  const isCss = url.pathname.endsWith('.css');
  if (isCss) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(resp => {
          if (resp.ok) {
            caches.open(CACHE_NAME).then(c => c.put(event.request, resp.clone()));
          }
          return resp;
        });
      })
    );
    return;
  }

  // JS + HTML — network-first so deploys propagate immediately (Fix 18)
  event.respondWith(
    fetch(event.request)
      .then(resp => {
        if (resp.ok && event.request.method === 'GET') {
          caches.open(CACHE_NAME).then(c => c.put(event.request, resp.clone()));
        }
        return resp;
      })
      .catch(() => {
        // Offline fallback — serve from cache
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') return caches.match('/index.html');
        });
      })
  );
});

// ── Message: force cache clear on R key ──────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(() => {
      caches.open(CACHE_NAME).then(cache =>
        Promise.allSettled([...SHELL_ASSETS, ...CSS_ASSETS].map(url => cache.add(url).catch(() => {})))
      );
    });
  }
});