/**
 * MAV HIRE ERP — js/api/gas.js
 * Fetch wrapper for Google Apps Script web app.
 * Sends auth token on every request if configured.
 * Handles 401 Unauthorized → shows PIN/token re-auth prompt.
 */

const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbxRPaLDRIbQ2fCoC_lnwUJHwExXqaM4LuwuqVUBX3yZmV3amorcf7m66biBc73hEFRSMg/exec';

export const GAS_URL = localStorage.getItem('mav_gas_url') || DEFAULT_GAS_URL;

export function setGasUrl(url) {
  localStorage.setItem('mav_gas_url', url);
  location.reload();
}

/** Returns the current auth token from localStorage (may be empty string). */
export function getAuthToken() {
  return localStorage.getItem('mav_auth_token') || '';
}

/** Persist a new auth token — called from the PIN/token setup flow. */
export function setAuthToken(token) {
  localStorage.setItem('mav_auth_token', token);
}

// ── Core RPC ──────────────────────────────────────────────────────────────────
export async function rpc(fnName, ...args) {
  if (!GAS_URL) throw new Error('GAS URL not configured. Click ⚙ to set it.');

  const url = new URL(GAS_URL);
  url.searchParams.set('fn',    fnName);
  url.searchParams.set('args',  JSON.stringify(args));

  const token = getAuthToken();
  if (token) url.searchParams.set('token', token);

  let response;
  try {
    response = await fetch(url.toString(), { method: 'GET', mode: 'cors' });
  } catch(networkErr) {
    throw new Error('Network error: ' + networkErr.message);
  }

  if (!response.ok) throw new Error('HTTP ' + response.status + ' from ' + fnName);

  let data;
  try { data = await response.json(); }
  catch(e) { throw new Error('Invalid JSON from ' + fnName); }

  // Auth failure — prompt for token
  if (data && data.__code === 401) {
    window.__showAuthPrompt?.();
    throw new Error('Unauthorized — check your access token');
  }

  if (data && data.__error) throw new Error(data.__error);
  if (data === null || data === undefined) {
    throw new Error('Server returned null for ' + fnName + ' — check GAS logs');
  }

  return data;
}

export async function rpcNullable(fnName, ...args) {
  if (!GAS_URL) throw new Error('GAS URL not configured.');
  const url = new URL(GAS_URL);
  url.searchParams.set('fn',   fnName);
  url.searchParams.set('args', JSON.stringify(args));
  const token = getAuthToken();
  if (token) url.searchParams.set('token', token);
  const response = await fetch(url.toString(), { method: 'GET', mode: 'cors' });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const data = await response.json();
  if (data && data.__error) throw new Error(data.__error);
  return data;
}

// ── Session cache (offline resilience) ───────────────────────────────────────
// Cache read-only GAS responses in sessionStorage so that if GAS is slow or
// unavailable, panes can still render stale data with a banner warning.

const CACHEABLE = new Set([
  'getProducts','getClients','getJobs','getQuotes','getDashboardSnapshot',
  'getEnquiries','getEnquirySummary','getServices','getBundles',
  'getMaintenanceRecords','getForecasts','getWarehouseLocations',
  'getAuditLog','getSuppliers','getCrew','getSubRentals',
  'getPurchaseOrders','getTransportRuns','getSkuStats','getInventorySnapshot',
]);

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function cacheKey(fnName, args) {
  return `mav_cache:${fnName}:${JSON.stringify(args)}`;
}

function readCache(fnName, args) {
  try {
    const raw = sessionStorage.getItem(cacheKey(fnName, args));
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL_MS) { sessionStorage.removeItem(cacheKey(fnName, args)); return null; }
    return data;
  } catch { return null; }
}

function writeCache(fnName, args, data) {
  try {
    sessionStorage.setItem(cacheKey(fnName, args), JSON.stringify({ ts: Date.now(), data }));
  } catch { /* sessionStorage full — ignore */ }
}

/** Same as rpc() but serves stale cached data on network failure and shows a banner */
export async function rpcWithFallback(fnName, ...args) {
  try {
    const data = await rpc(fnName, ...args);
    if (CACHEABLE.has(fnName)) writeCache(fnName, args, data);
    hideStaleBanner();
    return data;
  } catch (err) {
    const cached = CACHEABLE.has(fnName) ? readCache(fnName, args) : null;
    if (cached !== null) {
      showStaleBanner('Using cached data — GAS may be unavailable');
      return cached;
    }
    throw err;
  }
}

function showStaleBanner(msg) {
  let el = document.getElementById('stale-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'stale-banner';
    el.style.cssText = `position:fixed;top:0;left:0;right:0;z-index:9999;
      background:var(--warn);color:#000;font-size:12px;font-family:var(--mono);
      text-align:center;padding:6px 12px;cursor:pointer`;
    el.onclick = () => el.remove();
    document.body.prepend(el);
  }
  el.textContent = `⚠ ${msg} — click to dismiss`;
}

function hideStaleBanner() {
  document.getElementById('stale-banner')?.remove();
}

/** Clear all cached entries (call after mutations) */
export function clearRpcCache() {
  Object.keys(sessionStorage)
    .filter(k => k.startsWith('mav_cache:'))
    .forEach(k => sessionStorage.removeItem(k));
}