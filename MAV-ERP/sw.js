/**
 * MAV Hire ERP — Service Worker v3.0
 * - Network-first for JS/HTML (deploys propagate immediately)
 * - Cache-first for CSS (stable, fast)
 * - Network-first with cache fallback for CDN assets
 * - GAS API bypasses SW entirely
 * - Never caches non-ok or opaque responses (fixes "body already used" error)
 * - Ignores manifest.json (let browser fetch directly — bypasses Vercel preview auth)
 */

const CACHE_NAME = 'mav-erp-v3';
const GAS_ORIGIN = 'script.google.com';

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/main.js',
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

const CSS_ASSETS = [
  '/css/tokens.css',
  '/css/layout.css',
  '/css/components.css',
];

// Safe cache-put: only cache ok, non-opaque responses
function safeCachePut(cache, request, response) {
  if (response && response.ok && response.status !== 0 && response.type !== 'opaque') {
    cache.put(request, response).catch(() => {});
  }
}

// ── Install ───────────────────────────────────────────────────────────────────
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

// ── Activate ──────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  // Only handle GET
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // GAS API — bypass SW entirely
  if (url.hostname.includes(GAS_ORIGIN)) return;

  // manifest.json — bypass SW (Vercel preview auth returns 401, don't cache it)
  if (url.pathname === '/manifest.json') return;

  // favicon — bypass SW (404, don't waste cache space)
  if (url.pathname === '/favicon.ico') return;

  // CDN assets — network-first, cache on success
  if (url.hostname.includes('cdnjs.cloudflare.com')) {
    event.respondWith(
      fetch(event.request)
        .then(resp => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(c => safeCachePut(c, event.request, clone));
          }
          return resp;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // CSS — cache-first (stable)
  if (url.pathname.endsWith('.css')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(resp => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(c => safeCachePut(c, event.request, clone));
          }
          return resp;
        });
      })
    );
    return;
  }

  // JS + HTML — network-first, cache on success for offline fallback
  event.respondWith(
    fetch(event.request)
      .then(resp => {
        // Only cache successful same-origin responses
        if (resp.ok && resp.status < 400) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => safeCachePut(c, event.request, clone));
        }
        return resp;
      })
      .catch(() => {
        // Offline: serve from cache or fall back to index.html for navigation
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') return caches.match('/index.html');
        });
      })
  );
});

// ── Message ───────────────────────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(() => {
      caches.open(CACHE_NAME).then(cache =>
        Promise.allSettled([...SHELL_ASSETS, ...CSS_ASSETS].map(url =>
          cache.add(url).catch(() => {})
        ))
      );
    });
  }
});