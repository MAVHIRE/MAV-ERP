/**
 * MAV HIRE ERP — js/api/gas.js
 * Fetch wrapper for Google Apps Script web app.
 * Calls the deployed GAS URL with ?fn=functionName&args=[] as JSON.
 *
 * GAS web app must have doGet() that reads URLSearchParams and calls
 * the named function with parsed args, then returns JSON.
 *
 * See 08_webapp.gs for the doGet handler that supports this.
 */

// ── Config ────────────────────────────────────────────────────────────────────
// Paste your deployed GAS web app URL here.
// The URL looks like: https://script.google.com/macros/s/AKfy.../exec
export const GAS_URL = localStorage.getItem('mav_gas_url') || '';

export function setGasUrl(url) {
  localStorage.setItem('mav_gas_url', url);
  location.reload();
}

// ── Core fetch ────────────────────────────────────────────────────────────────
/**
 * Call a GAS server function by name with arguments.
 * Returns parsed JSON from the response.
 * Throws on network error, GAS error, or null response.
 */
export async function rpc(fnName, ...args) {
  if (!GAS_URL) {
    throw new Error('GAS_URL not configured. Click ⚙ Settings to set your deployment URL.');
  }

  const url = new URL(GAS_URL);
  url.searchParams.set('fn',   fnName);
  url.searchParams.set('args', JSON.stringify(args));

  let response;
  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      mode:   'cors',
    });
  } catch (networkErr) {
    throw new Error('Network error calling ' + fnName + ': ' + networkErr.message);
  }

  if (!response.ok) {
    throw new Error('HTTP ' + response.status + ' calling ' + fnName);
  }

  let data;
  try {
    data = await response.json();
  } catch (parseErr) {
    throw new Error('Invalid JSON from ' + fnName + ': ' + parseErr.message);
  }

  // GAS error envelope
  if (data && data.__error) {
    throw new Error(data.__error);
  }

  // GAS returns null when server throws without catching
  if (data === null || data === undefined) {
    throw new Error('Server returned null for ' + fnName + ' — check GAS Executions log');
  }

  return data;
}

/**
 * Same as rpc() but allows null returns (e.g. getById when not found).
 */
export async function rpcNullable(fnName, ...args) {
  if (!GAS_URL) throw new Error('GAS_URL not configured.');

  const url = new URL(GAS_URL);
  url.searchParams.set('fn',   fnName);
  url.searchParams.set('args', JSON.stringify(args));

  const response = await fetch(url.toString(), { method: 'GET', mode: 'cors' });
  if (!response.ok) throw new Error('HTTP ' + response.status);

  const data = await response.json();
  if (data && data.__error) throw new Error(data.__error);
  return data;
}
