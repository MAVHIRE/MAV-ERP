/**
 * MAV HIRE ERP — scan.js  v2.0
 * Barcode scan station: checkout / return / location / lookup.
 * Mobile-first: large touch targets, haptic feedback, audio cues.
 * Also hosts stocktake wizard.
 */
import { rpc }   from '../api/gas.js';
import { STATE } from '../utils/state.js';
import { showLoading, hideLoading, toast } from '../utils/dom.js';
import { esc, statusBadge, fmtDate, fmtCurDec, escAttr} from '../utils/format.js';
import { openModal, closeModal } from '../components/modal.js';

// ── Load ──────────────────────────────────────────────────────────────────────
export async function loadScanPane() {
  showLoading('Loading scan station…');
  try {
    const jobs = await rpc('getJobs', {});
    STATE.jobs  = jobs;
    renderScanPane(jobs);
  } catch(e) { toast('Scan station failed: ' + e.message, 'err'); }
  finally { hideLoading(); }
}

function renderScanPane(jobs) {
  const active = jobs.filter(j =>
    ['Confirmed','Allocated','Prepping','Checked Out','Live'].includes(j.status)
  ).sort((a,b) => new Date(a.eventDate||a.startDate||0) - new Date(b.eventDate||b.startDate||0));

  const el = document.getElementById('scan-pane-body');
  if (!el) return;

  const jobOpts = active.map(j =>
    `<option value="${esc(j.jobId)}">${esc(j.jobId)} · ${esc(j.jobName)} · ${esc(j.clientName)} [${esc(j.status)}]</option>`
  ).join('');

  el.innerHTML = `
    <!-- Tab bar -->
    <div style="display:flex;gap:0;border-bottom:1px solid var(--border);margin-bottom:20px">
      ${[['scan','⊡ Scan'],['stocktake','◈ Stocktake'],['lookup','⌕ Lookup']].map(([id,label],i)=>
        `<div class="scan-tab${i===0?' active':''}" data-tab="${id}"
          onclick="window.__scanSwitchTab('${id}')"
          style="padding:8px 16px;font-family:var(--mono);font-size:12px;cursor:pointer;
          border-bottom:2px solid transparent;color:var(--text3);transition:all .15s">
          ${label}</div>`
      ).join('')}
    </div>

    <!-- ── SCAN TAB ──────────────────────────────────────────────────────── -->
    <div id="scan-tab-scan">
      <!-- Job selector -->
      <div style="margin-bottom:16px">
        <label style="font-size:11px;color:var(--text3);font-family:var(--mono);
          text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:6px">
          Select Job</label>
        <select id="scan-job-select" onchange="window.__onScanJobSelect()"
          style="width:100%;max-width:540px;padding:10px 12px;font-size:14px;
          background:var(--surface2);border:1px solid var(--border);border-radius:var(--r2);
          color:var(--text);font-family:var(--mono)">
          <option value="">— Select a job —</option>
          ${jobOpts}
        </select>
      </div>

      <!-- Job info card -->
      <div id="scan-job-info" style="display:none;background:var(--surface2);border-radius:8px;
        padding:12px 16px;margin-bottom:16px;border-left:3px solid var(--accent)">
        <div style="font-weight:600;font-size:15px" id="scan-job-name"></div>
        <div style="font-size:12px;color:var(--text3);margin-top:2px" id="scan-job-client"></div>
        <div style="margin-top:6px" id="scan-job-status"></div>
      </div>

      <!-- Mode toggle -->
      <div style="display:flex;gap:0;margin-bottom:16px;border-radius:8px;overflow:hidden;
        border:1px solid var(--border);max-width:320px">
        <button id="scan-mode-out" onclick="window.__setScanMode('out')"
          style="flex:1;padding:12px;font-size:14px;font-weight:600;border:none;cursor:pointer;
          background:var(--accent);color:#000;font-family:var(--mono);transition:all .15s">
          ⬆ Checkout
        </button>
        <button id="scan-mode-in" onclick="window.__setScanMode('in')"
          style="flex:1;padding:12px;font-size:14px;font-weight:600;border:none;cursor:pointer;
          background:var(--surface2);color:var(--text2);font-family:var(--mono);transition:all .15s">
          ⬇ Return
        </button>
      </div>

      <!-- Line item selector (for serialised) -->
      <div id="scan-line-wrap" style="margin-bottom:16px;display:none">
        <label style="font-size:11px;color:var(--text3);font-family:var(--mono);
          text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:6px">
          Line Item (serialised products)</label>
        <select id="scan-line-select"
          style="width:100%;max-width:540px;padding:10px 12px;font-size:13px;
          background:var(--surface2);border:1px solid var(--border);border-radius:var(--r2);
          color:var(--text);font-family:var(--mono)">
          <option value="">— Select line item —</option>
        </select>
      </div>

      <!-- Barcode input — BIG for mobile -->
      <div id="scan-input-wrap" style="max-width:540px;margin-bottom:8px">
        <div style="display:flex;gap:8px;align-items:stretch">
          <div style="flex:1;display:flex;align-items:center;gap:10px;
            background:var(--surface2);border:2px solid var(--accent);border-radius:8px;
            padding:10px 16px">
            <span style="font-size:24px;opacity:.5">⊡</span>
            <input type="text" id="scan-barcode-input"
              placeholder="Scan or type barcode…"
              autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false"
              style="flex:1;background:none;border:none;outline:none;font-size:18px;
              color:var(--text);font-family:var(--mono);font-weight:600"
              onkeydown="window.__onScanKeydown(event)">
          </div>
          <button onclick="window.__submitScan()"
            style="padding:0 24px;background:var(--accent);color:#000;border:none;
            border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;
            font-family:var(--mono);white-space:nowrap">
            SCAN
          </button>
          <button id="btn-camera-scan" onclick="window.__openCameraScan()"
            title="Scan with camera"
            style="padding:0 16px;background:var(--surface2);color:var(--text);border:1px solid var(--border);
            border-radius:8px;font-size:20px;cursor:pointer;white-space:nowrap">
            📷
          </button>
        </div>
      </div>

      <!-- Camera viewfinder (hidden until activated) -->
      <div id="scan-camera-wrap" style="display:none;max-width:540px;margin-bottom:12px;
        position:relative;border-radius:12px;overflow:hidden;background:#000">
        <video id="scan-camera-video" autoplay playsinline muted
          style="width:100%;max-height:300px;object-fit:cover;display:block"></video>
        <!-- Targeting overlay -->
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none">
          <div style="width:200px;height:120px;border:2px solid var(--accent);border-radius:8px;
            box-shadow:0 0 0 9999px rgba(0,0,0,.45)"></div>
        </div>
        <div id="scan-camera-status" style="position:absolute;bottom:8px;left:0;right:0;
          text-align:center;font-size:12px;color:#fff;font-family:var(--mono);
          text-shadow:0 1px 3px rgba(0,0,0,.8)">
          Point at barcode…
        </div>
        <button onclick="window.__closeCameraScan()"
          style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,.6);
          color:#fff;border:none;border-radius:50%;width:32px;height:32px;cursor:pointer;
          font-size:16px;line-height:1">✕</button>
      </div>

      <!-- Feedback -->
      <div id="scan-feedback" style="min-height:48px;margin-bottom:20px;
        display:flex;align-items:center"></div>

      <!-- Progress for current job line -->
      <div id="scan-progress" style="display:none;margin-bottom:20px"></div>

      <!-- Scan log -->
      <div style="font-size:11px;color:var(--text3);font-family:var(--mono);
        text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">
        Session Log</div>
      <div class="tbl-wrap">
        <table style="font-size:12px">
          <thead><tr>
            <th>Time</th><th>Barcode</th><th>Item</th>
            <th>Mode</th><th>Result</th>
          </tr></thead>
          <tbody id="scan-log-body"></tbody>
        </table>
      </div>
    </div>

    <!-- ── STOCKTAKE TAB ──────────────────────────────────────────────────── -->
    <div id="scan-tab-stocktake" style="display:none;max-width:640px">
      <div style="background:var(--surface2);border-radius:8px;padding:16px;margin-bottom:16px">
        <div style="font-weight:600;margin-bottom:4px">Stocktake Wizard</div>
        <div style="font-size:12px;color:var(--text3)">
          Count physical stock and reconcile vs system quantities.
          Variances are recorded and stock levels updated automatically.
        </div>
      </div>

      <div style="margin-bottom:12px">
        <label style="font-size:11px;color:var(--text3);font-family:var(--mono);
          text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:6px">
          Filter by Category</label>
        <select id="stk-cat-filter" onchange="window.__filterStocktakeList()"
          style="padding:8px 12px;background:var(--surface2);border:1px solid var(--border);
          border-radius:var(--r);color:var(--text);font-size:13px;min-width:200px">
          <option value="">All Categories</option>
          ${[...new Set((STATE.products||[]).map(p=>p.category).filter(Boolean))].sort()
            .map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')}
        </select>
        <button class="btn btn-ghost btn-sm" style="margin-left:8px"
          onclick="window.__loadStocktakeList()">↺ Reload</button>
        <button class="btn btn-primary btn-sm" style="margin-left:4px"
          onclick="window.__submitStocktake()">✓ Submit All Counts</button>
      </div>

      <div id="stk-list">
        <div style="color:var(--text3);font-size:12px;padding:12px">
          Loading product list…</div>
      </div>
    </div>

    <!-- ── LOOKUP TAB ──────────────────────────────────────────────────────── -->
    <div id="scan-tab-lookup" style="display:none;max-width:540px">
      <div style="font-size:12px;color:var(--text3);margin-bottom:12px">
        Scan or enter a barcode to see its current status, location, and history.
      </div>
      <div style="display:flex;gap:8px;margin-bottom:16px">
        <input type="text" id="lookup-barcode-input"
          placeholder="Scan or type barcode…"
          autocomplete="off" autocorrect="off" autocapitalize="none"
          style="flex:1;padding:10px 14px;background:var(--surface2);border:1px solid var(--border);
          border-radius:var(--r2);color:var(--text);font-size:15px;font-family:var(--mono)"
          onkeydown="if(event.key==='Enter')window.__lookupBarcode()">
        <button class="btn btn-primary" onclick="window.__lookupBarcode()">⌕ Lookup</button>
      </div>
      <div id="lookup-result"></div>
    </div>
  `;

  // Init
  window.__scanSwitchTab = (tab) => {
    document.querySelectorAll('.scan-tab').forEach(t => {
      const active = t.dataset.tab === tab;
      t.classList.toggle('active', active);
      t.style.borderBottomColor = active ? 'var(--accent)' : 'transparent';
      t.style.color = active ? 'var(--text)' : 'var(--text3)';
    });
    ['scan','stocktake','lookup'].forEach(id => {
      const el2 = document.getElementById(`scan-tab-${id}`);
      if (el2) el2.style.display = id === tab ? '' : 'none';
    });
    if (tab === 'stocktake') window.__loadStocktakeList();
    if (tab === 'scan') setTimeout(() => document.getElementById('scan-barcode-input')?.focus(), 50);
    if (tab === 'lookup') setTimeout(() => document.getElementById('lookup-barcode-input')?.focus(), 50);
  };

  setScanMode('out');
  setTimeout(() => document.getElementById('scan-barcode-input')?.focus(), 100);
}

// ── Job select ────────────────────────────────────────────────────────────────
export async function onScanJobSelect() {
  const jobId  = document.getElementById('scan-job-select')?.value;
  const infoEl = document.getElementById('scan-job-info');
  const lineEl = document.getElementById('scan-line-select');
  const lineWrap = document.getElementById('scan-line-wrap');

  if (!jobId) {
    if (infoEl) infoEl.style.display = 'none';
    if (lineWrap) lineWrap.style.display = 'none';
    STATE.scanJobId = null; STATE.scanJobItems = [];
    return;
  }

  showLoading('Loading job…');
  try {
    const job = await rpc('getJobById', jobId);
    STATE.scanJobId    = jobId;
    STATE.scanJobItems = (job.items||[]).filter(i => i.stockMethod === 'Serialised');

    const nameEl   = document.getElementById('scan-job-name');
    const clientEl = document.getElementById('scan-job-client');
    const statusEl = document.getElementById('scan-job-status');
    if (nameEl)   nameEl.textContent  = job.jobName || job.jobId;
    if (clientEl) clientEl.textContent= job.clientName+(job.company?' · '+job.company:'');
    if (statusEl) statusEl.innerHTML  = statusBadge(job.status) +
      (job.status === 'Returned' ? `
        <button class="btn btn-ghost btn-sm" style="margin-left:10px;font-size:11px"
          onclick="window.__returnAllToStorage('${escAttr(job.jobId)}')">⬡ Return All to Storage</button>` : '');
    if (infoEl)   infoEl.style.display= 'block';

    if (lineEl && lineWrap) {
      if (!STATE.scanJobItems.length) {
        lineEl.innerHTML = '<option value="">No serialised items on this job</option>';
        lineWrap.style.display = 'block';
      } else {
        lineEl.innerHTML = '<option value="">— Select product line —</option>' +
          STATE.scanJobItems.map(i =>
            `<option value="${esc(i.lineId)}">${esc(i.name)} (${esc(i.sku)}) — need ${i.qtyRequired||0}, out ${i.qtyOut||0}</option>`
          ).join('');
        lineWrap.style.display = 'block';
      }
    }

    document.getElementById('scan-barcode-input')?.focus();
  } catch(e) { toast('Failed to load job: ' + e.message, 'err'); }
  finally { hideLoading(); }
}

// ── Mode toggle ───────────────────────────────────────────────────────────────
export function setScanMode(mode) {
  STATE.scanMode = mode;
  const btnOut = document.getElementById('scan-mode-out');
  const btnIn  = document.getElementById('scan-mode-in');
  if (btnOut) {
    btnOut.style.background = mode === 'out' ? 'var(--accent)' : 'var(--surface2)';
    btnOut.style.color      = mode === 'out' ? '#000' : 'var(--text2)';
  }
  if (btnIn) {
    btnIn.style.background = mode === 'in' ? 'var(--ok)' : 'var(--surface2)';
    btnIn.style.color      = mode === 'in' ? '#000' : 'var(--text2)';
  }
  document.getElementById('scan-barcode-input')?.focus();
}

export function onScanKeydown(e) {
  if (e.key === 'Enter') submitScan();
}

// ── Submit scan ───────────────────────────────────────────────────────────────
export async function submitScan() {
  const barcode = (document.getElementById('scan-barcode-input')?.value || '').trim();
  const lineId  = document.getElementById('scan-line-select')?.value;
  const jobId   = STATE.scanJobId;
  const fbEl    = document.getElementById('scan-feedback');

  if (!barcode) { toast('Enter a barcode', 'warn'); return; }
  if (!jobId)   { toast('Select a job first', 'warn'); return; }

  // For serialised items line is required; bulk items can scan without line
  const hasSerialisedItems = (STATE.scanJobItems||[]).length > 0;
  if (hasSerialisedItems && !lineId) { toast('Select a line item first', 'warn'); return; }

  const fnName = STATE.scanMode === 'out' ? 'scanBarcodeCheckout' : 'scanBarcodeReturn';
  const mode   = STATE.scanMode === 'out' ? 'OUT' : 'RETURN';

  // Visual: scanning state
  if (fbEl) fbEl.innerHTML = `<span style="color:var(--text3);font-family:var(--mono);font-size:13px">⟳ Scanning ${esc(barcode)}…</span>`;

  try {
    await rpc(fnName, { jobId, lineId: lineId||'', barcode, scannedBy: '' });

    // Success feedback
    const successColor = mode === 'OUT' ? 'var(--accent)' : 'var(--ok)';
    if (fbEl) fbEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;
        background:${successColor}22;border:1px solid ${successColor};border-radius:8px;
        animation:fadeIn .2s ease">
        <span style="font-size:28px">${mode === 'OUT' ? '⬆' : '⬇'}</span>
        <div style="flex:1">
          <div style="font-family:var(--mono);font-size:16px;font-weight:700;color:${successColor}">${esc(barcode)}</div>
          <div style="font-size:12px;color:var(--text2)">${mode === 'OUT' ? 'Checked out' : 'Returned'} successfully</div>
        </div>
        ${mode === 'RETURN' ? `
        <button class="btn btn-ghost btn-sm" style="font-size:11px;flex-shrink:0"
          onclick="window.__offerReturnToStorage('${escAttr(barcode)}')">
          ⬡ Assign Storage
        </button>` : ''}
      </div>`;

    // Haptic feedback (mobile)
    if (navigator.vibrate) navigator.vibrate(50);

    // Add to log
    addScanLog(barcode, lineId, mode, 'ok');

    // Update progress bar
    updateScanProgress(jobId, lineId);

    // Clear input and focus
    const inp = document.getElementById('scan-barcode-input');
    if (inp) { inp.value = ''; inp.focus(); inp.select(); }

  } catch(e) {
    if (fbEl) fbEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;
        background:var(--danger)22;border:1px solid var(--danger);border-radius:8px">
        <span style="font-size:28px">✗</span>
        <div>
          <div style="font-family:var(--mono);font-size:14px;font-weight:700;color:var(--danger)">${esc(barcode)}</div>
          <div style="font-size:12px;color:var(--danger)">${esc(e.message)}</div>
        </div>
      </div>`;
    if (navigator.vibrate) navigator.vibrate([100,50,100]);
    addScanLog(barcode, lineId, mode, 'FAIL: ' + e.message);
    document.getElementById('scan-barcode-input')?.select();
  }
}

function updateScanProgress(jobId, lineId) {
  const el = document.getElementById('scan-progress');
  if (!el || !lineId) return;
  const line = (STATE.scanJobItems||[]).find(i => i.lineId === lineId);
  if (!line) return;
  const out      = (line.qtyOut||0) + 1; // optimistic
  const required = line.qtyRequired||0;
  const pct      = required > 0 ? Math.min(100, Math.round(out/required*100)) : 0;
  const color    = pct >= 100 ? 'var(--ok)' : 'var(--accent)';
  el.style.display = 'block';
  el.innerHTML = `
    <div style="font-size:12px;color:var(--text3);margin-bottom:5px;font-family:var(--mono)">
      ${esc(line.name)} — ${out}/${required} scanned</div>
    <div style="height:6px;background:var(--surface3);border-radius:3px">
      <div style="height:100%;width:${pct}%;background:${color};border-radius:3px;transition:width .3s"></div>
    </div>`;
  if (pct >= 100) toast('✓ All '+required+' barcodes scanned for '+line.name, 'ok');
}

function addScanLog(barcode, lineId, mode, result) {
  const tbody = document.getElementById('scan-log-body');
  if (!tbody) return;
  const line = (STATE.scanJobItems||[]).find(i => i.lineId === lineId);
  const tr   = document.createElement('tr');
  const ok   = result === 'ok';
  tr.innerHTML = `
    <td style="font-family:var(--mono);color:var(--text3);white-space:nowrap">${new Date().toLocaleTimeString('en-GB')}</td>
    <td style="font-family:var(--mono);font-weight:600">${esc(barcode)}</td>
    <td style="font-size:12px">${esc(line ? line.name : lineId||'—')}</td>
    <td>${mode==='OUT'?'<span class="badge badge-warn">OUT</span>':'<span class="badge badge-ok">IN</span>'}</td>
    <td style="font-family:var(--mono);font-size:11px;color:${ok?'var(--ok)':'var(--danger)'}">${ok?'✓ OK':esc(result)}</td>`;
  tbody.insertBefore(tr, tbody.firstChild);
}

// ── Stocktake wizard ──────────────────────────────────────────────────────────
export async function loadStocktakeList() {
  const el = document.getElementById('stk-list');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--text3);font-size:12px;padding:8px">Loading…</div>';
  try {
    if (!STATE.products?.length) STATE.products = await rpc('getProducts', {});
    renderStocktakeList(STATE.products);
  } catch(e) { el.innerHTML = `<div style="color:var(--danger)">${e.message}</div>`; }
}

function renderStocktakeList(products) {
  const el = document.getElementById('stk-list');
  if (!el) return;
  const cat = document.getElementById('stk-cat-filter')?.value || '';
  const filtered = cat ? products.filter(p => p.category === cat) : products;

  if (!filtered.length) { el.innerHTML = '<div style="color:var(--text3);padding:12px">No products.</div>'; return; }

  el.innerHTML = `
    <div class="tbl-wrap">
      <table>
        <thead><tr>
          <th>Product</th><th>Category</th>
          <th style="text-align:right">System Qty</th>
          <th style="text-align:center;width:120px">Counted</th>
          <th style="text-align:right">Variance</th>
        </tr></thead>
        <tbody>
          ${filtered.map(p => `
            <tr>
              <td>
                <div style="font-weight:500;font-size:13px">${esc(p.name)}</div>
                <div style="font-size:10px;color:var(--text3);font-family:var(--mono)">${esc(p.sku)}</div>
              </td>
              <td style="font-size:12px;color:var(--text3)">${esc(p.category||'—')}</td>
              <td style="text-align:right;font-family:var(--mono);font-weight:600">${p.qtyAvailable??0}</td>
              <td style="text-align:center">
                <input type="number" class="stk-count" data-product-id="${esc(p.productId)}"
                  data-system-qty="${p.qtyAvailable??0}"
                  placeholder="${p.qtyAvailable??0}"
                  min="0" step="1"
                  style="width:80px;text-align:center;padding:5px;font-family:var(--mono);
                  font-size:14px;background:var(--surface2);border:1px solid var(--border);
                  border-radius:4px;color:var(--text)"
                  oninput="window.__updateStocktakeVariance(this)">
              </td>
              <td class="stk-variance-${esc(p.productId)}"
                style="text-align:right;font-family:var(--mono);font-size:13px;color:var(--text3)">
                —
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  window.__updateStocktakeVariance = (inp) => {
    const sysQty  = parseInt(inp.dataset.systemQty, 10) || 0;
    const counted = parseInt(inp.value, 10);
    const varEl   = document.querySelector(`.stk-variance-${inp.dataset.productId}`);
    if (!varEl) return;
    if (isNaN(counted)) { varEl.textContent = '—'; varEl.style.color = 'var(--text3)'; return; }
    const variance = counted - sysQty;
    varEl.textContent = (variance > 0 ? '+' : '') + variance;
    varEl.style.color = variance === 0 ? 'var(--ok)' : variance > 0 ? 'var(--info)' : 'var(--danger)';
  };
}

export async function submitStocktake() {
  const inputs = document.querySelectorAll('.stk-count');
  const toSubmit = [];
  inputs.forEach(inp => {
    const counted = parseInt(inp.value, 10);
    if (!isNaN(counted)) {
      toSubmit.push({
        productId:   inp.dataset.productId,
        expectedQty: parseInt(inp.dataset.systemQty, 10) || 0,
        countedQty:  counted,
        notes:       'Stocktake via scan station',
      });
    }
  });

  if (!toSubmit.length) { toast('No counts entered — fill in at least one row', 'warn'); return; }

  const variances = toSubmit.filter(s => s.countedQty !== s.expectedQty);
  if (variances.length) {
    const msg = `Submit stocktake?\n\n${toSubmit.length} product(s) counted\n${variances.length} variance(s) found\n\nStock levels will be updated.`;
    if (!confirm(msg)) return;
  }

  showLoading(`Submitting ${toSubmit.length} stocktake records…`);
  let success = 0, failed = 0;
  try {
    for (const item of toSubmit) {
      try {
        await rpc('recordStocktake', item);
        success++;
      } catch(e) { failed++; }
    }
    toast(`Stocktake complete: ${success} submitted, ${failed} failed`, failed ? 'warn' : 'ok');
    STATE.loadedPanes.delete('inventory');
    await loadStocktakeList();
  } catch(e) { toast(e.message, 'err'); }
  finally { hideLoading(); }
}

export function filterStocktakeList() {
  renderStocktakeList(STATE.products || []);
}

// ── Barcode lookup ────────────────────────────────────────────────────────────
export async function lookupBarcode() {
  const barcode = (document.getElementById('lookup-barcode-input')?.value || '').trim();
  const el = document.getElementById('lookup-result');
  if (!barcode || !el) return;

  el.innerHTML = '<div style="color:var(--text3);font-size:12px;padding:8px">Looking up…</div>';

  try {
    const [bc, history] = await Promise.all([
      rpc('getBarcodeByCode', barcode),
      rpc('getBarcodeLocationHistory', barcode),
    ]);

    if (!bc) { el.innerHTML = `<div style="color:var(--danger);padding:8px">Barcode not found: ${esc(barcode)}</div>`; return; }

    const statusColor = {
      Available:'var(--ok)', Out:'var(--warn)', Allocated:'var(--info)',
      'In Service':'var(--warn)', Damaged:'var(--danger)', Lost:'var(--danger)'
    }[bc.status] || 'var(--text3)';

    const histRows = (history||[]).slice(0,10).map(h => `
      <tr>
        <td style="font-size:11px;color:var(--text3)">${fmtDate(h.movedAt||h.createdAt)}</td>
        <td style="font-size:12px">${esc(h.fullPath||h.locationId||'—')}</td>
        <td style="font-size:11px;color:var(--text3)">${esc(h.notes||'—')}</td>
      </tr>`).join('');

    el.innerHTML = `
      <div style="background:var(--surface2);border-radius:8px;padding:16px;margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
          <div>
            <div style="font-family:var(--mono);font-size:18px;font-weight:700">${esc(bc.barcode)}</div>
            <div style="font-size:13px;margin-top:3px">${esc(bc.productName||'—')}</div>
            ${bc.serialNumber?`<div style="font-size:11px;color:var(--text3);font-family:var(--mono)">S/N: ${esc(bc.serialNumber)}</div>`:''}
          </div>
          <div style="text-align:right">
            <div style="font-size:13px;font-weight:700;color:${statusColor}">${esc(bc.status)}</div>
            ${bc.condition?`<div style="font-size:11px;color:var(--text3)">${esc(bc.condition)}</div>`:''}
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px">
          ${bc.currentJobId?`<div><span style="color:var(--text3)">Current Job:</span> <strong>${esc(bc.currentJobId)}</strong></div>`:''}
          ${bc.locationPath?`<div><span style="color:var(--text3)">Location:</span> ${esc(bc.locationPath)}</div>`:''}
          ${bc.purchaseDate?`<div><span style="color:var(--text3)">Purchased:</span> ${fmtDate(bc.purchaseDate)}</div>`:''}
          ${bc.warrantyEndDate?`<div><span style="color:var(--text3)">Warranty:</span> ${fmtDate(bc.warrantyEndDate)}</div>`:''}
        </div>
      </div>
      ${histRows ? `
        <div style="font-size:11px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;
          letter-spacing:.06em;margin-bottom:6px">Location History</div>
        <div class="tbl-wrap">
          <table style="font-size:12px">
            <thead><tr><th>Date</th><th>Location</th><th>Notes</th></tr></thead>
            <tbody>${histRows}</tbody>
          </table>
        </div>` : '<div style="color:var(--text3);font-size:12px">No location history.</div>'}
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" onclick="window.__offerReturnToStorage('${escAttr(barcode)}')">⬡ Assign Location</button>
        ${bc.locationPath?`<button class="btn btn-ghost btn-sm" onclick="window.__clearBarcodeLocation('${escAttr(barcode)}')">✕ Clear Location</button>`:''}
      </div>`;
  } catch(e) { el.innerHTML = `<div style="color:var(--danger);padding:8px">${esc(e.message)}</div>`; }
}

// ── Return to storage after scan return ────────────────────────────────────────
export async function offerReturnToStorage(barcode) {
  // Load warehouse locations for picker
  const locs = await rpc('getWarehouseLocations', {}).catch(() => []);
  const storeLocs = (locs||[]).filter(l => l.locationType !== 'Zone' && +l.layoutW > 0);
  if (!storeLocs.length) { toast('No storage locations configured', 'warn'); return; }

  const { openModal, closeModal } = await import('../components/modal.js');
  openModal('modal-return-storage', `⬡ Assign to Storage — ${esc(barcode)}`, `
    <p style="font-size:12px;color:var(--text2);margin-bottom:12px">
      Select the storage location for <strong style="font-family:var(--mono)">${esc(barcode)}</strong>
    </p>
    <div class="form-grid">
      <div class="form-group span-2"><label>Location *</label>
        <select id="rts-loc">
          <option value="">— Select location —</option>
          ${storeLocs.map(l => `<option value="${esc(l.locationId)}">${esc(l.fullPath||l.zone||l.locationId)}</option>`).join('')}
        </select></div>
      <div class="form-group span-2"><label>Notes</label>
        <input type="text" id="rts-notes" placeholder="e.g. Top shelf, back row"></div>
    </div>`, `
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Skip</button>
    <button class="btn btn-primary btn-sm" onclick="window.__submitReturnToStorage('${escAttr(barcode)}')">Assign Location</button>`
  );

  window.__submitReturnToStorage = async (bc) => {
    const locId = document.getElementById('rts-loc')?.value;
    const notes = document.getElementById('rts-notes')?.value || '';
    if (!locId) { toast('Select a location', 'warn'); return; }
    closeModal(); showLoading('Assigning location…');
    try {
      await rpc('assignBarcodeLocation', bc, locId, notes);
      toast(`${bc} → ${storeLocs.find(l=>l.locationId===locId)?.fullPath||locId}`, 'ok');
    } catch(e) { toast(e.message, 'err'); }
    finally { hideLoading(); }
  };
}

// ── Bulk assign barcodes from lookup tab ──────────────────────────────────────
export async function bulkAssignToLocation(barcodes, locationId, notes) {
  if (!barcodes?.length || !locationId) return;
  showLoading(`Assigning ${barcodes.length} barcodes…`);
  try {
    await rpc('assignBarcodeLocationBulk', barcodes.map(b => ({
      barcode: b, locationId, notes: notes || ''
    })));
    toast(`${barcodes.length} barcode${barcodes.length!==1?'s':''} assigned`, 'ok');
  } catch(e) { toast(e.message, 'err'); }
  finally { hideLoading(); }
}

// ── Clear barcode location ────────────────────────────────────────────────────
export async function clearBarcodeLocationFn(barcode) {
  if (!confirm(`Remove ${barcode} from its current location?`)) return;
  showLoading('Clearing location…');
  try {
    await rpc('clearBarcodeLocation', barcode, 'Cleared via scan station');
    toast(`${barcode} location cleared`, 'ok');
  } catch(e) { toast(e.message, 'err'); }
  finally { hideLoading(); }
}

// ── Camera scanning ───────────────────────────────────────────────────────────
// Strategy:
//   1. Try native BarcodeDetector API (Chrome 83+, Android Chrome, Edge)
//   2. Fall back to ZXing-js if BarcodeDetector unavailable
// Both paths call submitScanWithBarcode(value) on success.

let _cameraStream = null;
let _cameraDetectInterval = null;
let _zxingReader = null;

export async function openCameraScan() {
  const wrap    = document.getElementById('scan-camera-wrap');
  const video   = document.getElementById('scan-camera-video');
  const statusEl= document.getElementById('scan-camera-status');
  if (!wrap || !video) { toast('Camera UI not found', 'err'); return; }

  // Check we have a job selected
  if (!STATE.scanJobId) { toast('Select a job first', 'warn'); return; }

  try {
    _cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }
    });
    video.srcObject = _cameraStream;
    wrap.style.display = 'block';

    if (typeof BarcodeDetector !== 'undefined') {
      startNativeBarcodeDetector(video, statusEl);
    } else {
      startZxingDetector(video, statusEl);
    }
  } catch(err) {
    if (err.name === 'NotAllowedError') {
      toast('Camera permission denied — please allow camera access in browser settings', 'warn');
    } else if (err.name === 'NotFoundError') {
      toast('No camera found on this device', 'warn');
    } else {
      toast('Camera error: ' + err.message, 'err');
    }
  }
}

export function closeCameraScan() {
  const wrap = document.getElementById('scan-camera-wrap');
  if (wrap) wrap.style.display = 'none';
  clearInterval(_cameraDetectInterval); _cameraDetectInterval = null;
  if (_cameraStream) {
    _cameraStream.getTracks().forEach(t => t.stop());
    _cameraStream = null;
  }
  if (_zxingReader) { _zxingReader.reset?.(); _zxingReader = null; }
}

// ── Native BarcodeDetector (Chrome/Edge/Android) ──────────────────────────────
function startNativeBarcodeDetector(video, statusEl) {
  const formats = ['qr_code','ean_13','ean_8','code_128','code_39','itf','pdf417','data_matrix','aztec'];
  const detector = new BarcodeDetector({ formats });
  let lastScan = 0;

  if (statusEl) statusEl.textContent = 'Scanning with native detector…';

  _cameraDetectInterval = setInterval(async () => {
    if (video.readyState < 2) return;
    try {
      const barcodes = await detector.detect(video);
      if (barcodes.length && Date.now() - lastScan > 1500) {
        const value = barcodes[0].rawValue;
        lastScan = Date.now();
        if (statusEl) statusEl.textContent = '✓ Found: ' + value;
        await onCameraBarcode(value);
      }
    } catch(e) { /* frame decode error — ignore */ }
  }, 200);
}

// ── ZXing-js fallback ─────────────────────────────────────────────────────────
async function startZxingDetector(video, statusEl) {
  if (statusEl) statusEl.textContent = 'Loading ZXing scanner…';

  // Dynamically load ZXing from CDN
  if (!window.ZXing) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/zxing-js/0.20.0/index.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load ZXing'));
      document.head.appendChild(s);
    });
  }

  if (!window.ZXing) {
    if (statusEl) statusEl.textContent = 'ZXing unavailable — type barcode manually';
    toast('Barcode library unavailable — type barcode manually', 'warn');
    return;
  }

  try {
    const hints = new Map();
    const formats = [
      ZXing.BarcodeFormat.QR_CODE, ZXing.BarcodeFormat.EAN_13,
      ZXing.BarcodeFormat.EAN_8,   ZXing.BarcodeFormat.CODE_128,
      ZXing.BarcodeFormat.CODE_39, ZXing.BarcodeFormat.ITF,
      ZXing.BarcodeFormat.DATA_MATRIX,
    ];
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, formats);
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true);

    const reader = new ZXing.MultiFormatReader();
    reader.setHints(hints);
    _zxingReader = reader;

    const canvas = document.createElement('canvas');
    const ctx    = canvas.getContext('2d');
    let lastScan = 0;

    if (statusEl) statusEl.textContent = 'Scanning with ZXing…';

    _cameraDetectInterval = setInterval(() => {
      if (video.readyState < 2 || !video.videoWidth) return;
      canvas.width  = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);

      try {
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const luminance = new ZXing.RGBLuminanceSource(imgData.data, canvas.width, canvas.height);
        const bitmap    = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(luminance));
        const result    = reader.decode(bitmap);
        if (result && Date.now() - lastScan > 1500) {
          lastScan = Date.now();
          const value = result.getText();
          if (statusEl) statusEl.textContent = '✓ Found: ' + value;
          onCameraBarcode(value);
        }
      } catch(e) { /* not a barcode frame — ignore NotFoundException */ }
    }, 250);
  } catch(err) {
    if (statusEl) statusEl.textContent = 'ZXing error — type barcode manually';
    toast('ZXing: ' + err.message, 'err');
  }
}

// ── Common: handle a successfully scanned barcode ────────────────────────────
async function onCameraBarcode(value) {
  if (!value) return;

  // Haptic
  if (navigator.vibrate) navigator.vibrate(50);

  // Put value in the text input and trigger the normal scan flow
  const inp = document.getElementById('scan-barcode-input');
  if (inp) {
    inp.value = value;
    // Flash the input
    inp.style.color = 'var(--accent)';
    setTimeout(() => { inp.style.color = ''; }, 800);
  }

  // Close camera and submit
  closeCameraScan();
  await submitScan();
}