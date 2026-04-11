/**
 * MAV HIRE ERP — js/api/gas.js
 * Fetch wrapper for Google Apps Script web app.
 * Hardcoded default URL — override via ⚙ settings.
 */

const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbxRPaLDRIbQ2fCoC_lnwUJHwExXqaM4LuwuqVUBX3yZmV3amorcf7m66biBc73hEFRSMg/exec';

export const GAS_URL = localStorage.getItem('mav_gas_url') || DEFAULT_GAS_URL;

export function setGasUrl(url) {
  localStorage.setItem('mav_gas_url', url);
  location.reload();
}

// ── Core RPC ──────────────────────────────────────────────────────────────────
export async function rpc(fnName, ...args) {
  if (!GAS_URL) throw new Error('GAS URL not configured. Click ⚙ to set it.');

  const url = new URL(GAS_URL);
  url.searchParams.set('fn',   fnName);
  url.searchParams.set('args', JSON.stringify(args));

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
  const response = await fetch(url.toString(), { method: 'GET', mode: 'cors' });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const data = await response.json();
  if (data && data.__error) throw new Error(data.__error);
  return data;
}