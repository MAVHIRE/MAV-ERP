/**
 * MAV HIRE ERP — js/panes/scan.js
 */
import { rpc }   from '../api/gas.js';
import { STATE } from '../utils/state.js';
import { showLoading, hideLoading, toast } from '../utils/dom.js';
import { esc, statusBadge, fmtDate } from '../utils/format.js';

export async function loadScanPane() {
  showLoading('Loading scan station…');
  try {
    const jobs   = await rpc('getJobs', {});
    STATE.jobs   = jobs;
    const active = jobs.filter(j => ['Confirmed','Allocated','Prepping','Checked Out','Live'].includes(j.status));
    const sel    = document.getElementById('scan-job-select');
    if (sel) {
      sel.innerHTML = '<option value="">— Select a job —</option>' +
        active.map(j => `<option value="${esc(j.jobId)}">${esc(j.jobId)} · ${esc(j.jobName)} · ${esc(j.clientName)} [${esc(j.status)}]</option>`).join('');
    }
    setScanMode('out');
  } catch(e) { toast('Scan station failed: ' + e.message, 'err'); }
  finally { hideLoading(); }
}

export async function onScanJobSelect() {
  const jobId = document.getElementById('scan-job-select')?.value;
  const infoEl = document.getElementById('scan-job-info');
  const lineEl = document.getElementById('scan-line-select');

  if (!jobId) {
    if (infoEl) infoEl.style.display = 'none';
    if (lineEl) lineEl.innerHTML = '<option value="">— Select line item —</option>';
    STATE.scanJobId = null; STATE.scanJobItems = [];
    return;
  }

  showLoading('Loading job…');
  try {
    const job = await rpc('getJobById', jobId);
    STATE.scanJobId    = jobId;
    STATE.scanJobItems = (job.items || []).filter(i => i.stockMethod === 'Serialised');

    const nameEl   = document.getElementById('scan-job-name');
    const clientEl = document.getElementById('scan-job-client');
    const statusEl = document.getElementById('scan-job-status');

    if (nameEl)   nameEl.textContent   = job.jobName || job.jobId;
    if (clientEl) clientEl.textContent = job.clientName + (job.company ? ' · ' + job.company : '');
    if (statusEl) statusEl.innerHTML   = statusBadge(job.status);
    if (infoEl)   infoEl.style.display = 'block';

    if (lineEl) {
      if (!STATE.scanJobItems.length) {
        lineEl.innerHTML = '<option value="">No serialised items on this job</option>';
      } else {
        lineEl.innerHTML = '<option value="">— Select line item —</option>' +
          STATE.scanJobItems.map(i => `<option value="${esc(i.lineId)}">${esc(i.name)} (${esc(i.sku)}) — need ${i.qtyRequired}, out ${i.qtyOut}, returned ${i.qtyReturned}</option>`).join('');
      }
    }
  } catch(e) { toast('Failed to load job: ' + e.message, 'err'); }
  finally { hideLoading(); }
}

export function setScanMode(mode) {
  STATE.scanMode = mode;
  const btnOut = document.getElementById('scan-mode-out');
  const btnIn  = document.getElementById('scan-mode-in');
  const wrap   = document.getElementById('scan-input-wrap');

  if (mode === 'out') {
    btnOut?.classList.replace('btn-ghost', 'btn-primary');
    btnIn?.classList.replace('btn-primary', 'btn-ghost');
    wrap?.classList.add('armed');
  } else {
    btnIn?.classList.replace('btn-ghost', 'btn-primary');
    btnOut?.classList.replace('btn-primary', 'btn-ghost');
    wrap?.classList.remove('armed');
  }
  document.getElementById('scan-barcode-input')?.focus();
}

export function onScanKeydown(e) {
  if (e.key === 'Enter') submitScan();
}

export async function submitScan() {
  const barcode = (document.getElementById('scan-barcode-input')?.value || '').trim();
  const lineId  = document.getElementById('scan-line-select')?.value;
  const jobId   = STATE.scanJobId;

  if (!barcode) { toast('Enter a barcode', 'warn'); return; }
  if (!jobId)   { toast('Select a job first', 'warn'); return; }
  if (!lineId)  { toast('Select a line item first', 'warn'); return; }

  const fnName = STATE.scanMode === 'out' ? 'scanBarcodeCheckout' : 'scanBarcodeReturn';

  try {
    await rpc(fnName, { jobId, lineId, barcode, scannedBy: '' });
    const mode = STATE.scanMode === 'out' ? 'OUT' : 'RETURN';
    toast('✓ ' + barcode, 'ok');
    addScanLog(barcode, lineId, mode, 'ok');

    const input = document.getElementById('scan-barcode-input');
    if (input) { input.value = ''; input.focus(); }

    const fb = document.getElementById('scan-feedback');
    if (fb) fb.innerHTML = `<span class="badge badge-ok" style="font-size:12px;padding:6px 12px">✓ ${esc(barcode)} — ${mode} OK</span>`;
  } catch(e) {
    toast('✗ ' + e.message, 'err');
    addScanLog(barcode, lineId, STATE.scanMode === 'out' ? 'OUT' : 'RETURN', 'FAIL: ' + e.message);
    const fb = document.getElementById('scan-feedback');
    if (fb) fb.innerHTML = `<span class="badge badge-danger" style="font-size:12px;padding:6px 12px">✗ ${esc(e.message)}</span>`;
  }
}

function addScanLog(barcode, lineId, mode, result) {
  const tbody = document.getElementById('scan-log-body');
  if (!tbody) return;
  const line = STATE.scanJobItems.find(i => i.lineId === lineId);
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td class="td-id">${new Date().toLocaleTimeString('en-GB')}</td>
    <td class="td-id">${esc(barcode)}</td>
    <td>${esc(line ? line.name : lineId)}</td>
    <td>${mode === 'OUT' ? '<span class="badge badge-warn">OUT</span>' : '<span class="badge badge-ok">RETURN</span>'}</td>
    <td style="font-family:var(--mono);font-size:11px;color:${result === 'ok' ? 'var(--ok)' : 'var(--danger)'}">${result === 'ok' ? '✓ OK' : esc(result)}</td>`;
  tbody.insertBefore(tr, tbody.firstChild);
}
