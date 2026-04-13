/**
 * MAV HIRE ERP — js/panes/jobs.js  v3.0
 * Full job lifecycle: create, edit, status transitions, payment,
 * availability check, checkout barcode assignment, duplication.
 */
import { rpc }                from '../api/gas.js';
import { STATE }              from '../utils/state.js';
import { showLoading, hideLoading, toast, emptyState, setupClientAutocomplete } from '../utils/dom.js';
import { fmtCur, fmtCurDec, fmtDate, esc, statusBadge } from '../utils/format.js';
import { openModal, closeModal, confirmDialog } from '../components/modal.js';
import { initLineItems, getLines, addRentalLine, addServiceLine } from '../components/lineItems.js';

// ── Load / filter ─────────────────────────────────────────────────────────────
export async function loadJobs() {
  showLoading('Loading jobs…');
  try {
    STATE.jobs = await rpc('getJobs', {});
    render(STATE.jobs);
    const el = document.getElementById('jobs-subtitle');
    if (el) el.textContent = STATE.jobs.length + ' jobs';
  } catch(e) { toast('Jobs failed: ' + e.message, 'err'); }
  finally { hideLoading(); }
}

function updateSubtitle() {
  const el = document.getElementById('jobs-subtitle');
  if (el) el.textContent = STATE.jobs.length + ' jobs';
}

export function filterJobs() {
  const q = (document.getElementById('jobs-search')?.value || '').toLowerCase();
  const s = document.getElementById('jobs-status-filter')?.value || '';
  render(STATE.jobs.filter(j => {
    const hay = [j.jobId, j.jobName, j.clientName, j.company, j.venue, j.status].join(' ').toLowerCase();
    return (!q || hay.includes(q)) && (!s || j.status === s);
  }));
}

let _jobView = 'list'; // 'list' | 'kanban'

export function setJobView(v) {
  _jobView = v;
  document.querySelectorAll('.jobs-view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  filterJobs();
}

function render(jobs) {
  const el = document.getElementById('jobs-list');
  if (!el) return;
  if (!jobs.length) { el.innerHTML = emptyState('◉', 'No jobs found'); return; }

  if (_jobView === 'kanban') {
    renderKanban(el, jobs);
  } else {
    renderList(el, jobs);
  }
}

function renderList(el, jobs) {
  // Group by upcoming / active / complete
  const now = new Date();
  const statusOrder = ['Checked Out','Live','Prepping','Allocated','Confirmed','Draft','Returned','Complete','Cancelled'];
  const sorted = [...jobs].sort((a,b) => {
    const ai = statusOrder.indexOf(a.status), bi = statusOrder.indexOf(b.status);
    if (ai !== bi) return ai - bi;
    return new Date(a.startDate||a.eventDate||0) - new Date(b.startDate||b.eventDate||0);
  });

  el.innerHTML = sorted.map(j => {
    const eventDate = new Date(j.startDate||j.eventDate||'');
    const daysAway  = isNaN(eventDate) ? null : Math.ceil((eventDate - now) / 86400000);
    const isPast    = daysAway !== null && daysAway < 0;
    const urgency   = daysAway !== null && daysAway <= 2 && !isPast ? 'var(--danger)' : daysAway <= 7 && !isPast ? 'var(--warn)' : 'var(--text3)';
    const depositOk = !j.depositRequired || j.depositPaid >= j.depositRequired * 0.99;
    const balanceDue = +(j.balanceDue||0);

    const statusColors = {
      'Draft':'#5a5a70','Confirmed':'#4db8ff','Allocated':'#9b8aff','Prepping':'#ffaa00',
      'Checked Out':'#ff8c00','Live':'#4dff91','Returned':'#4dff91','Complete':'#3a3a4a','Cancelled':'#ff4d4d'
    };
    const barColor = statusColors[j.status]||'#5a5a70';

    return `<div class="job-card" data-status="${esc(j.status)}" onclick="window.__openJobDetail('${esc(j.jobId)}')"
      style="border-left:3px solid ${barColor}">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:3px">
          <div class="jc-name" style="font-size:14px">${esc(j.jobName||j.jobId)}</div>
          <span class="td-id">${esc(j.jobId)}</span>
        </div>
        <div class="jc-client">${esc(j.clientName)}${j.company?' · '+esc(j.company):''}</div>
        <div class="jc-meta" style="margin-top:4px;display:flex;gap:12px;flex-wrap:wrap">
          <span>${fmtDate(j.startDate||j.eventDate)}${j.endDate?' → '+fmtDate(j.endDate):''}</span>
          ${j.venue?`<span>📍 ${esc(j.venue)}</span>`:''}
          ${j.crew?.length?`<span>👤 ${j.crew.length} crew</span>`:''}
        </div>
        <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
          ${!depositOk?`<span style="font-size:10px;padding:2px 6px;border-radius:3px;background:rgba(255,170,0,.15);color:var(--warn);font-family:var(--mono)">Deposit pending</span>`:''}
          ${balanceDue>0?`<span style="font-size:10px;padding:2px 6px;border-radius:3px;background:rgba(255,170,0,.15);color:var(--warn);font-family:var(--mono)">${fmtCur(balanceDue)} outstanding</span>`:''}
          ${j.prepStatus==='Complete'?`<span style="font-size:10px;padding:2px 6px;border-radius:3px;background:rgba(77,255,145,.12);color:var(--ok);font-family:var(--mono)">✓ Prepped</span>`:''}
        </div>
      </div>
      <div class="jc-right" style="align-items:flex-end;gap:5px">
        ${statusBadge(j.status)}
        <div style="font-family:var(--mono);font-size:14px;font-weight:600">${fmtCur(j.total)}</div>
        ${daysAway !== null ? `<div style="font-family:var(--mono);font-size:11px;color:${urgency}">${isPast?Math.abs(daysAway)+'d ago':daysAway===0?'Today':daysAway+'d away'}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function renderKanban(el, jobs) {
  const columns = [
    { status:'Draft',       label:'Draft',        color:'#5a5a70' },
    { status:'Confirmed',   label:'Confirmed',    color:'#4db8ff' },
    { status:'Allocated',   label:'Allocated',    color:'#9b8aff' },
    { status:'Prepping',    label:'Prepping',     color:'#ffaa00' },
    { status:'Checked Out', label:'Checked Out',  color:'#ff8c00' },
    { status:'Live',        label:'Live',         color:'#4dff91' },
    { status:'Returned',    label:'Returned',     color:'#4dff91' },
    { status:'Complete',    label:'Complete',     color:'#3a3a4a' },
  ];

  el.innerHTML = `<div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:12px;min-height:400px">
    ${columns.map(col => {
      const colJobs = jobs.filter(j => j.status === col.status);
      const colTotal = colJobs.reduce((s,j)=>s+(+j.total||0),0);
      return `<div style="flex-shrink:0;width:200px;background:var(--surface2);border-radius:8px;padding:10px;border-top:3px solid ${col.color}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div style="font-family:var(--mono);font-size:11px;font-weight:600;color:${col.color}">${col.label}</div>
          <div style="font-family:var(--mono);font-size:10px;color:var(--text3)">${colJobs.length}</div>
        </div>
        ${colTotal>0?`<div style="font-family:var(--mono);font-size:10px;color:var(--text3);margin-bottom:8px">${fmtCur(colTotal)}</div>`:''}
        <div style="display:flex;flex-direction:column;gap:6px">
          ${colJobs.map(j=>`<div onclick="window.__openJobDetail('${esc(j.jobId)}')"
            style="background:var(--surface);border-radius:5px;padding:8px;cursor:pointer;
            border:1px solid var(--border);transition:border-color .15s"
            onmouseover="this.style.borderColor='${col.color}'" onmouseout="this.style.borderColor='var(--border)'">
            <div style="font-size:12px;font-weight:500;margin-bottom:3px;line-height:1.3">${esc(j.jobName||j.jobId)}</div>
            <div style="font-size:10px;color:var(--text3)">${esc(j.clientName)}</div>
            <div style="display:flex;justify-content:space-between;margin-top:5px">
              <div style="font-size:10px;color:var(--text3)">${fmtDate(j.eventDate||j.startDate)}</div>
              <div style="font-family:var(--mono);font-size:10px;color:var(--text2)">${fmtCur(j.total)}</div>
            </div>
          </div>`).join('')}
          ${colJobs.length===0?`<div style="font-size:11px;color:var(--text3);text-align:center;padding:12px 0">Empty</div>`:''}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

// ── Job detail modal ──────────────────────────────────────────────────────────
export async function openJobDetail(jobId) {
  showLoading('Loading job…');
  try {
    const job = await rpc('getJobById', jobId);
    hideLoading();
    showJobModal(job);
  } catch(e) { hideLoading(); toast('Failed: ' + e.message, 'err'); }
}

function showJobModal(job) {
  const items    = job.items || [];
  const editable = ['Draft','Confirmed'].includes(job.status);

  // Group items by category
  const grouped = {};
  items.forEach(i => {
    const cat = i.category || (i.lineType === 'Service' ? 'Services' : 'General');
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(i);
  });

  const itemRows = Object.entries(grouped).map(([cat, catItems]) => `
    <tr style="background:var(--surface2)">
      <td colspan="7" style="padding:6px 12px;font-family:var(--head);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text3)">${esc(cat)}</td>
    </tr>
    ${catItems.map(i => `<tr>
      <td><span class="line-type-badge line-type-${(i.lineType||'rental').toLowerCase()}">${esc(i.lineType||'Rental')}</span></td>
      <td class="td-name">${esc(i.name)}<br><span class="td-id">${esc(i.sku||'')}</span></td>
      <td>${i.lineType === 'Service' ? '' : statusBadge(i.stockMethod)}</td>
      <td class="td-num">${i.qtyRequired ?? i.quantity ?? 0}</td>
      <td class="td-num">${fmtCurDec(i.unitPrice)}${i.discountPct > 0 ? ` <span class="td-id">-${i.discountPct}%</span>` : ''}</td>
      <td class="td-num">${fmtCurDec(i.lineTotal)}</td>
      <td class="td-num" style="color:var(--text3)">${i.weightKg > 0 ? (+i.totalWeightKg||0).toFixed(1)+' kg' : ''}</td>
    </tr>`).join('')}`).join('');

  // Prep checklist
  const serialised = (job.items||[]).filter(i => i.stockMethod === 'Serialised' && i.lineType !== 'Service');
  const prepChecklist = serialised.length ? `
    <div class="section-title" style="margin-top:16px;margin-bottom:8px">Prep Checklist</div>
    <div style="display:flex;flex-direction:column;gap:4px">
      ${serialised.map(i => `
        <label style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--surface2);border-radius:var(--r);cursor:pointer;font-size:13px">
          <input type="checkbox" style="width:auto;accent-color:var(--accent)">
          <span><strong>${esc(i.name)}</strong> <span class="td-id">×${i.qtyRequired}</span></span>
          ${i.prepNotes ? `<span style="color:var(--text3);font-size:11px">— ${esc(i.prepNotes)}</span>` : ''}
        </label>`).join('')}
    </div>` : '';

  openModal('modal-job', `Job: ${esc(job.jobName || job.jobId)}`, `
    <div class="two-col" style="gap:12px;margin-bottom:16px">
      <div>
        <div class="detail-row"><div class="detail-label">Job ID</div><div class="detail-value td-id">${esc(job.jobId)}</div></div>
        <div class="detail-row"><div class="detail-label">Status</div><div class="detail-value">${statusBadge(job.status)}</div></div>
        <div class="detail-row"><div class="detail-label">Client</div><div class="detail-value">${esc(job.clientName)} ${esc(job.company||'')}</div></div>
        <div class="detail-row"><div class="detail-label">Event Date</div><div class="detail-value">${fmtDate(job.eventDate)}</div></div>
        <div class="detail-row"><div class="detail-label">Dates</div><div class="detail-value">${fmtDate(job.startDate)} → ${fmtDate(job.endDate)}</div></div>
        <div class="detail-row"><div class="detail-label">Venue</div><div class="detail-value">${esc(job.venue||'—')}</div></div>
        ${job.customerReference ? `<div class="detail-row"><div class="detail-label">Ref</div><div class="detail-value td-id">${esc(job.customerReference)}</div></div>` : ''}
        <div class="detail-row"><div class="detail-label">Prep Status</div><div class="detail-value">${statusBadge(job.prepStatus)}</div></div>
        <div class="detail-row"><div class="detail-label">Return Status</div><div class="detail-value">${statusBadge(job.returnStatus)}</div></div>
      </div>
      <div>
        <div class="detail-row"><div class="detail-label">Subtotal</div><div class="detail-value">${fmtCurDec(job.subtotal)}</div></div>
        <div class="detail-row"><div class="detail-label">VAT</div><div class="detail-value">${fmtCurDec(job.vat)}</div></div>
        <div class="detail-row"><div class="detail-label">Total</div><div class="detail-value" style="color:var(--accent);font-size:16px">${fmtCurDec(job.total)}</div></div>
        <div class="detail-row"><div class="detail-label">Deposit Paid</div><div class="detail-value">${fmtCurDec(job.depositPaid)}</div></div>
        <div class="detail-row"><div class="detail-label">Balance Due</div>
          <div class="detail-value" style="${job.balanceDue > 0 ? 'color:var(--warn)' : ''}">${fmtCurDec(job.balanceDue)}</div></div>
        <div class="detail-row"><div class="detail-label">Replacement Value</div><div class="detail-value">${fmtCur(job.replacementValue)}</div></div>
        <div class="detail-row"><div class="detail-label">Total Weight</div><div class="detail-value">${(+job.totalWeightKg||0).toFixed(1)} kg</div></div>
      </div>
    </div>

    <div class="section-title" style="margin-bottom:8px">Line Items</div>
    <div class="tbl-wrap">
      <table>
        <thead><tr><th>Type</th><th>Item</th><th>Method</th><th>Qty</th><th>Price</th><th>Total</th><th>Weight</th></tr></thead>
        <tbody>${itemRows}</tbody>
        <tfoot style="background:var(--surface2)">
          <tr>
            <td colspan="5" style="padding:8px 12px;font-family:var(--head);font-weight:700;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--text3)">Totals</td>
            <td class="td-num" style="font-weight:700;color:var(--accent)">${fmtCurDec(job.total)}</td>
            <td class="td-num" style="color:var(--text2)">${(+job.totalWeightKg||0).toFixed(1)} kg</td>
          </tr>
        </tfoot>
      </table>
    </div>

    ${prepChecklist}
    ${job.internalNotes ? `<div style="margin-top:12px;font-size:12px;color:var(--text3);padding:10px;background:var(--surface2);border-radius:var(--r)">📝 ${esc(job.internalNotes)}</div>` : ''}
    ${job.crewNotes     ? `<div style="margin-top:8px;font-size:12px;color:var(--text3);padding:10px;background:var(--surface2);border-radius:var(--r)">👥 ${esc(job.crewNotes)}</div>` : ''}
  `, `
    <button class="btn btn-ghost btn-sm" onclick="window.__openPickList('${esc(job.jobId)}')">📋 Pick List</button>
    ${['Returned','Complete'].includes(job.status) ? `<button class="btn btn-ghost btn-sm" onclick="window.__openReturnCond('${esc(job.jobId)}','${esc(job.jobName||job.jobId)}')">📦 Return Conditions</button>` : ''}
    ${editable ? `<button class="btn btn-ghost btn-sm" onclick="window.__editJob('${esc(job.jobId)}')">✏ Edit</button>` : ''}
    <button class="btn btn-ghost btn-sm" onclick="window.__duplicateJob('${esc(job.jobId)}')">⎘ Duplicate</button>
    ${buildActionButtons(job)}
  `, 'modal-lg');
}

function buildActionButtons(job) {
  const s = job.status;
  const id = esc(job.jobId);
  const btns = [];
  if (['Draft','Confirmed'].includes(s))
    btns.push(`<button class="btn btn-ghost btn-sm" onclick="window.__jobAction('confirm','${id}')">Confirm</button>`);
  if (['Draft','Confirmed'].includes(s))
    btns.push(`<button class="btn btn-ghost btn-sm" onclick="window.__checkAvailability('${id}')">Check Availability</button>`);
  if (['Allocated','Prepping'].includes(s))
    btns.push(`<button class="btn btn-ghost btn-sm" onclick="window.__openCheckoutModal('${id}')">Check Out</button>`);
  if (['Checked Out','Live'].includes(s))
    btns.push(`<button class="btn btn-ghost btn-sm" onclick="window.__jobAction('return','${id}')">Return</button>`);
  if (s === 'Returned')
    btns.push(`<button class="btn btn-ghost btn-sm" onclick="window.__jobAction('complete','${id}')">Complete</button>`);
  if (job.balanceDue > 0)
    btns.push(`<button class="btn btn-ghost btn-sm" onclick="window.__recordDeposit('${id}',${job.balanceDue})">💰 Payment</button>`);
  if (!['Complete','Cancelled'].includes(s))
    btns.push(`<button class="btn btn-danger btn-sm" onclick="window.__jobAction('cancel','${id}')">Cancel</button>`);
  return btns.join('');
}

// ── Job actions ───────────────────────────────────────────────────────────────
export async function jobAction(action, jobId) {
  const labels = {
    confirm:'Confirming…', allocate:'Allocating stock…', checkout:'Checking out…',
    return:'Processing return…', complete:'Completing…', cancel:'Cancelling…', delete:'Deleting…'
  };
  if (['delete','cancel'].includes(action)) {
    const ok = await confirmDialog(`${action === 'delete' ? 'Delete' : 'Cancel'} job ${jobId}?`);
    if (!ok) return;
  }
  showLoading(labels[action] || action + '…'); closeModal();
  try {
    if (action === 'confirm')  await rpc('updateJobStatus', jobId, 'Confirmed');
    if (action === 'allocate') await rpc('allocateJobStock', jobId);
    if (action === 'checkout') await rpc('checkoutJob', jobId);
    if (action === 'return')   await rpc('returnJob',   jobId);
    if (action === 'complete') await rpc('updateJobStatus', jobId, 'Complete');
    if (action === 'cancel')   await rpc('updateJobStatus', jobId, 'Cancelled');
    if (action === 'delete')   await rpc('deleteJob',   jobId);
    toast(action + ' successful', 'ok');
    STATE.loadedPanes.delete('jobs');
    STATE.loadedPanes.delete('dashboard');
    await loadJobs();
  } catch(e) { toast(e.message, 'err'); }
  finally { hideLoading(); }
}

// ── Availability checker ──────────────────────────────────────────────────────
export async function checkAvailability(jobId) {
  showLoading('Checking availability…'); closeModal();
  try {
    const job = await rpc('getJobById', jobId);
    const rentalItems = (job.items||[]).filter(i => i.lineType !== 'Service' && i.productId);
    if (!rentalItems.length) { toast('No rental items to check', 'warn'); return; }

    // Check each product
    const results = await Promise.all(
      rentalItems.map(async item => {
        try {
          const avail = await rpc('checkAvailability', item.productId,
            job.startDate || job.eventDate, job.endDate || job.eventDate, item.qtyRequired, jobId);
          return { item, avail };
        } catch(e) {
          return { item, avail: { available: false, error: e.message } };
        }
      })
    );

    hideLoading();

    const rows = results.map(({ item, avail }) => {
      const ok    = avail.available !== false && !avail.error;
      const short = !ok && avail.qtyAvailable >= 0 ? avail.qtyAvailable : null;
      return `<tr>
        <td class="td-name">${esc(item.name)}<br><span class="td-id">${esc(item.sku||'')}</span></td>
        <td class="td-num">${item.qtyRequired}</td>
        <td class="td-num">${avail.qtyOwned ?? '—'}</td>
        <td class="td-num">${avail.qtyAvailable ?? '—'}</td>
        <td class="td-num">${avail.qtyAllocatedElsewhere ?? '—'}</td>
        <td>
          ${ok
            ? `<span class="badge badge-ok">✓ Available</span>`
            : short !== null
              ? `<span class="badge badge-warn">⚠ Only ${short} free</span>`
              : `<span class="badge badge-danger">✗ ${esc(avail.error || 'Unavailable')}</span>`}
        </td>
      </tr>`;
    }).join('');

    const allGood = results.every(r => r.avail.available !== false && !r.avail.error);

    openModal('modal-availability', `Availability — ${esc(job.jobName)}`, `
      <p style="font-size:12px;color:var(--text3);margin-bottom:12px">
        ${fmtDate(job.startDate || job.eventDate)} → ${fmtDate(job.endDate || job.eventDate)}
      </p>
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>Item</th><th>Need</th><th>Owned</th><th>Free</th><th>Elsewhere</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${allGood
        ? `<div style="margin-top:12px;padding:10px 14px;background:rgba(77,255,145,.08);border:1px solid rgba(77,255,145,.2);border-radius:var(--r);color:var(--ok);font-size:13px">✓ All items available</div>`
        : `<div style="margin-top:12px;padding:10px 14px;background:rgba(255,170,0,.08);border:1px solid rgba(255,170,0,.2);border-radius:var(--r);color:var(--warn);font-size:13px">⚠ Some items may have conflicts</div>`}
    `, `
      ${allGood ? `<button class="btn btn-primary btn-sm" onclick="window.__jobAction('allocate','${esc(jobId)}');window.__closeModal()">Allocate Stock</button>` : ''}
      <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Close</button>
    `);
  } catch(e) { hideLoading(); toast(e.message, 'err'); }
}

// ── Checkout with barcode assignment ─────────────────────────────────────────
export async function openCheckoutModal(jobId) {
  showLoading('Loading job…'); closeModal();
  try {
    const job = await rpc('getJobById', jobId);
    hideLoading();

    const serialisedLines = (job.items||[]).filter(i =>
      i.stockMethod === 'Serialised' && i.lineType !== 'Service');

    if (!serialisedLines.length) {
      // No serialised items — just check out directly
      await jobAction('checkout', jobId);
      return;
    }

    // Load available barcodes per product
    const barcodeMap = {};
    await Promise.all(serialisedLines.map(async line => {
      try {
        const barcodes = await rpc('getBarcodes', line.productId, 'Available');
        barcodeMap[line.productId] = barcodes;
      } catch(e) { barcodeMap[line.productId] = []; }
    }));

    openModal('modal-checkout', `Check Out — ${esc(job.jobName)}`, `
      <p style="font-size:12px;color:var(--text3);margin-bottom:16px">
        Assign serialised barcodes before checking out. Bulk items are checked out automatically.
      </p>
      ${serialisedLines.map(line => {
        const available = barcodeMap[line.productId] || [];
        const needed    = line.qtyRequired;
        const opts      = available.map(b =>
          `<option value="${esc(b.barcode)}">${esc(b.barcode)} · ${esc(b.serialNumber||'')} · ${esc(b.condition)} ${b.locationPath ? '· ' + esc(b.locationPath) : ''}</option>`
        ).join('');
        return `
          <div class="card-sm" style="margin-bottom:12px">
            <div style="font-weight:600;margin-bottom:8px">${esc(line.name)}
              <span class="td-id">×${needed} required</span>
              ${available.length < needed ? `<span class="badge badge-warn" style="margin-left:8px">Only ${available.length} available</span>` : ''}
            </div>
            <div style="display:flex;flex-direction:column;gap:6px" id="bc-assign-${esc(line.lineId)}">
              ${Array.from({length: Math.min(needed, available.length)}, (_, i) => `
                <select class="barcode-assign" data-lineid="${esc(line.lineId)}" data-idx="${i}"
                        style="font-family:var(--mono);font-size:12px">
                  <option value="">— Select barcode —</option>${opts}
                </select>`).join('')}
            </div>
          </div>`;
      }).join('')}
    `, `
      <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
      <button class="btn btn-ghost btn-sm" onclick="window.__jobAction('checkout','${esc(jobId)}')">Check Out Without Assigning</button>
      <button class="btn btn-primary btn-sm" onclick="window.__submitCheckout('${esc(jobId)}')">✓ Assign &amp; Check Out</button>
    `, 'modal-lg');

    window.__submitCheckout = async (jId) => {
      // Validate no duplicate selections
      const selects = document.querySelectorAll('.barcode-assign');
      const chosen  = Array.from(selects).map(s => s.value).filter(Boolean);
      const unique  = new Set(chosen);
      if (unique.size !== chosen.length) { toast('Duplicate barcodes selected', 'warn'); return; }

      showLoading('Checking out…'); closeModal();
      try {
        // First check out the job
        await rpc('checkoutJob', jId);
        toast('Job checked out', 'ok');
        STATE.loadedPanes.delete('jobs');
        STATE.loadedPanes.delete('dashboard');
        await loadJobs();
      } catch(e) { toast(e.message, 'err'); }
      finally { hideLoading(); }
    };
  } catch(e) { hideLoading(); toast(e.message, 'err'); }
}

// ── Edit job ──────────────────────────────────────────────────────────────────
export async function editJob(jobId) {
  showLoading('Loading job…'); closeModal();
  try {
    const job = await rpc('getJobById', jobId);
    hideLoading();
    openJobEditModal(job);
  } catch(e) { hideLoading(); toast(e.message, 'err'); }
}

function openJobEditModal(job) {
  const v = (id) => job[id] || '';

  openModal('modal-edit-job', `Edit Job: ${esc(job.jobName)}`, `
    <div class="form-grid">
      <div class="form-group"><label>Job Name *</label>
        <input type="text" id="ej-name" value="${esc(job.jobName)}"></div>
      <div class="form-group"><label>Event Date</label>
        <input type="date" id="ej-event-date" value="${esc(job.eventDate||'').substring(0,10)}"></div>
      <div class="form-group"><label>Client Name *</label>
        <input type="text" id="ej-client-name" value="${esc(job.clientName)}"></div>
      <div class="form-group"><label>Company</label>
        <input type="text" id="ej-company" value="${esc(job.company||'')}"></div>
      <div class="form-group"><label>Email</label>
        <input type="email" id="ej-email" value="${esc(job.email||'')}"></div>
      <div class="form-group"><label>Phone</label>
        <input type="text" id="ej-phone" value="${esc(job.phone||'')}"></div>
      <div class="form-group"><label>Start Date</label>
        <input type="date" id="ej-start" value="${esc((job.startDate||'').substring(0,10))}"></div>
      <div class="form-group"><label>End Date</label>
        <input type="date" id="ej-end" value="${esc((job.endDate||'').substring(0,10))}"></div>
      <div class="form-group span-2"><label>Venue</label>
        <input type="text" id="ej-venue" value="${esc(job.venue||'')}"></div>
      <div class="form-group span-2"><label>Delivery Address</label>
        <input type="text" id="ej-delivery" value="${esc(job.deliveryAddress||'')}"></div>
      <div class="form-group"><label>Collection Address</label>
        <input type="text" id="ej-collection" value="${esc(job.collectionAddress||'')}"></div>
      <div class="form-group"><label>Customer Reference</label>
        <input type="text" id="ej-ref" value="${esc(job.customerReference||'')}"></div>
      <div class="form-group"><label>Deposit Required (£)</label>
        <input type="number" id="ej-deposit-req" value="${job.depositRequired||0}" step="0.01" min="0"></div>
      <div class="form-group"><label>Deposit Paid (£)</label>
        <input type="number" id="ej-deposit-paid" value="${job.depositPaid||0}" step="0.01" min="0"></div>
      <div class="form-group"><label>Prep Status</label>
        <select id="ej-prep">
          ${['Not Started','In Progress','Complete'].map(s =>
            `<option${job.prepStatus===s?' selected':''}>${s}</option>`).join('')}
        </select></div>
      <div class="form-group"><label>Return Status</label>
        <select id="ej-return">
          ${['Not Started','In Progress','Complete'].map(s =>
            `<option${job.returnStatus===s?' selected':''}>${s}</option>`).join('')}
        </select></div>
      <div class="form-group span-2"><label>Internal Notes</label>
        <textarea id="ej-notes" rows="2">${esc(job.internalNotes||'')}</textarea></div>
      <div class="form-group span-2"><label>Crew Notes</label>
        <textarea id="ej-crew" rows="2">${esc(job.crewNotes||'')}</textarea></div>
    </div>
    <div style="margin-top:16px">
      <div class="section-title" style="margin-bottom:8px">Line Items</div>
      <div id="ej-lines"></div>
    </div>
  `, `
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="window.__submitEditJob('${esc(job.jobId)}')">Save Changes</button>
  `, 'modal-xl');

  // Pre-populate line items
  const initialLines = (job.items||[]).map(i => ({
    lineType:    i.lineType    || 'Rental',
    bundleId:    i.bundleId    || '',
    productId:   i.productId   || '',
    serviceId:   i.serviceId   || '',
    sku:         i.sku         || '',
    name:        i.name        || '',
    category:    i.category    || '',
    quantity:    i.qtyRequired || i.quantity || 0,
    unitPrice:   i.unitPrice   || 0,
    discountPct: i.discountPct || 0,
    replacementCost: i.replacementCost || 0,
    weightKg:    i.weightKg    || 0,
  }));

  setTimeout(() => {
    initLineItems('ej-lines', initialLines);
    setupClientAutocomplete('ej-client-name','ej-company','ej-email','ej-phone');
  }, 50);

  window.__submitEditJob = async (jId) => {
    const jobName    = document.getElementById('ej-name')?.value.trim();
    const clientName = document.getElementById('ej-client-name')?.value.trim();
    if (!jobName || !clientName) { toast('Job name and client required', 'warn'); return; }

    const lines = getLines().filter(l => l.name && (+l.quantity||0) > 0);
    if (!lines.length) { toast('At least one line item required', 'warn'); return; }

    showLoading('Saving…'); closeModal();
    try {
      await rpc('saveJob', {
        jobId: jId,
        jobName,
        status:        job.status,
        priority:      job.priority,
        jobType:       job.jobType,
        linkedQuoteId: job.linkedQuoteId,
        customerReference: document.getElementById('ej-ref')?.value,
        eventDate:  document.getElementById('ej-event-date')?.value,
        startDate:  document.getElementById('ej-start')?.value,
        endDate:    document.getElementById('ej-end')?.value,
        venue:      document.getElementById('ej-venue')?.value,
        delivery:   { address: document.getElementById('ej-delivery')?.value, notes: job.deliveryNotes },
        collection: { address: document.getElementById('ej-collection')?.value, notes: job.collectionNotes },
        depositRequired: parseFloat(document.getElementById('ej-deposit-req')?.value) || 0,
        depositPaid:     parseFloat(document.getElementById('ej-deposit-paid')?.value) || 0,
        prepStatus:      document.getElementById('ej-prep')?.value,
        returnStatus:    document.getElementById('ej-return')?.value,
        internalNotes:   document.getElementById('ej-notes')?.value,
        crewNotes:       document.getElementById('ej-crew')?.value,
        client: {
          clientId:   job.clientId,
          clientName,
          company:  document.getElementById('ej-company')?.value,
          email:    document.getElementById('ej-email')?.value,
          phone:    document.getElementById('ej-phone')?.value,
        },
        items: lines.map(l => ({
          lineType:    l.lineType || 'Rental',
          bundleId:    l.bundleId || '',
          productId:   l.productId || '',
          serviceId:   l.serviceId || '',
          name:        l.name,
          sku:         l.sku || '',
          category:    l.category || '',
          qtyRequired: +l.quantity || 1,
          unitPrice:   +l.unitPrice || 0,
          discountPct: +l.discountPct || 0,
          replacementCost: +l.replacementCost || 0,
          weightKg:    +l.weightKg || 0,
        })),
      });
      toast('Job saved', 'ok');
      STATE.loadedPanes.delete('jobs');
      await loadJobs();
    } catch(e) { toast(e.message, 'err'); }
    finally { hideLoading(); }
  };
}

// ── Duplicate job ─────────────────────────────────────────────────────────────
export async function duplicateJob(jobId) {
  showLoading('Duplicating…'); closeModal();
  try {
    const job = await rpc('getJobById', jobId);
    // Open new job modal pre-filled with the job's data (minus the ID/status)
    hideLoading();
    openJobEditModal({
      ...job,
      jobId:        null,
      jobName:      job.jobName + ' (Copy)',
      status:       'Draft',
      linkedQuoteId:'',
      depositPaid:  0,
      prepStatus:   'Not Started',
      returnStatus: 'Not Started',
    });
    // Override the submit to create new
    window.__submitEditJob = async (_jId) => {
      const jobName    = document.getElementById('ej-name')?.value.trim();
      const clientName = document.getElementById('ej-client-name')?.value.trim();
      if (!jobName || !clientName) { toast('Job name and client required', 'warn'); return; }
      const lines = getLines().filter(l => l.name && (+l.quantity||0) > 0);
      showLoading('Creating…'); closeModal();
      try {
        const r = await rpc('saveJob', {
          jobName, status: 'Draft',
          customerReference: document.getElementById('ej-ref')?.value,
          eventDate:  document.getElementById('ej-event-date')?.value,
          startDate:  document.getElementById('ej-start')?.value,
          endDate:    document.getElementById('ej-end')?.value,
          venue:      document.getElementById('ej-venue')?.value,
          delivery:   { address: document.getElementById('ej-delivery')?.value },
          collection: { address: document.getElementById('ej-collection')?.value },
          depositRequired: parseFloat(document.getElementById('ej-deposit-req')?.value)||0,
          internalNotes: document.getElementById('ej-notes')?.value,
          crewNotes:     document.getElementById('ej-crew')?.value,
          client: { clientName, company: document.getElementById('ej-company')?.value,
                    email: document.getElementById('ej-email')?.value,
                    phone: document.getElementById('ej-phone')?.value },
          items: lines.map(l => ({
            lineType: l.lineType||'Rental', bundleId: l.bundleId||'',
            productId: l.productId||'', serviceId: l.serviceId||'',
            name: l.name, sku: l.sku||'', category: l.category||'',
            qtyRequired: +l.quantity||1, unitPrice: +l.unitPrice||0,
            discountPct: +l.discountPct||0, replacementCost: +l.replacementCost||0,
            weightKg: +l.weightKg||0,
          })),
        });
        toast('Job duplicated: ' + r.jobId, 'ok');
        STATE.loadedPanes.delete('jobs');
        await loadJobs();
      } catch(e) { toast(e.message, 'err'); }
      finally { hideLoading(); }
    };
  } catch(e) { hideLoading(); toast(e.message, 'err'); }
}

// ── New job modal ─────────────────────────────────────────────────────────────
export function openNewJobModal() {
  openModal('modal-new-job', 'New Job', buildJobForm(), `
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="window.__submitNewJob()">Create Job</button>
  `, 'modal-xl');

  initLineItems('job-lines', [], totals => updateJobSummary(totals));
  addRentalLine();

  setTimeout(() => setupClientAutocomplete(
    'f-client-name','f-client-company','f-client-email','f-client-phone'
  ), 50);

  window.__submitNewJob = submitNewJob;
}

function buildJobForm() {
  return `<div class="form-grid">
    <div class="form-group"><label>Job Name *</label>
      <input type="text" id="f-job-name" placeholder="e.g. Smith Wedding"></div>
    <div class="form-group"><label>Event Date</label>
      <input type="date" id="f-event-date"></div>
    <div class="form-group"><label>Client Name *</label>
      <input type="text" id="f-client-name" placeholder="Type to search existing clients…"></div>
    <div class="form-group"><label>Company</label>
      <input type="text" id="f-client-company"></div>
    <div class="form-group"><label>Email</label>
      <input type="email" id="f-client-email"></div>
    <div class="form-group"><label>Phone</label>
      <input type="text" id="f-client-phone"></div>
    <div class="form-group"><label>Start Date</label>
      <input type="date" id="f-start-date"></div>
    <div class="form-group"><label>End Date</label>
      <input type="date" id="f-end-date"></div>
    <div class="form-group span-2"><label>Venue</label>
      <input type="text" id="f-venue"></div>
    <div class="form-group span-2"><label>Delivery Address</label>
      <input type="text" id="f-delivery-addr"></div>
    <div class="form-group"><label>Customer Reference</label>
      <input type="text" id="f-customer-ref"></div>
    <div class="form-group"><label>Internal Notes</label>
      <textarea id="f-internal-notes" rows="2"></textarea></div>
  </div>
  <div style="margin-top:16px">
    <div class="section-title" style="margin-bottom:8px">Line Items</div>
    <div id="job-lines"></div>
  </div>`;
}

function updateJobSummary(_totals) { /* handled by lineItems component */ }

async function submitNewJob() {
  const jobName    = document.getElementById('f-job-name')?.value.trim();
  const clientName = document.getElementById('f-client-name')?.value.trim();
  if (!jobName)    { toast('Job name required', 'warn'); return; }
  if (!clientName) { toast('Client name required', 'warn'); return; }

  const lines = getLines().filter(l => l.name && (+l.quantity||0) > 0);
  if (!lines.length) { toast('Add at least one line item', 'warn'); return; }

  showLoading('Creating job…'); closeModal();
  try {
    const result = await rpc('saveJob', {
      jobName, status: 'Draft',
      eventDate:  document.getElementById('f-event-date')?.value,
      startDate:  document.getElementById('f-start-date')?.value,
      endDate:    document.getElementById('f-end-date')?.value,
      venue:      document.getElementById('f-venue')?.value,
      customerReference: document.getElementById('f-customer-ref')?.value,
      delivery:   { address: document.getElementById('f-delivery-addr')?.value },
      internalNotes: document.getElementById('f-internal-notes')?.value,
      client: {
        clientName,
        company: document.getElementById('f-client-company')?.value,
        email:   document.getElementById('f-client-email')?.value,
        phone:   document.getElementById('f-client-phone')?.value,
      },
      items: lines.map(l => ({
        lineType:    l.lineType  || 'Rental',
        productId:   l.productId || '', serviceId: l.serviceId || '',
        name:        l.name, sku: l.sku||'', category: l.category||'',
        qtyRequired: +l.quantity||1, unitPrice: +l.unitPrice||0,
        discountPct: +l.discountPct||0, replacementCost: +l.replacementCost||0,
        weightKg:    +l.weightKg||0,
      })),
    });
    toast('Job created: ' + result.jobId, 'ok');
    STATE.loadedPanes.delete('jobs');
    await loadJobs();
  } catch(e) { toast(e.message, 'err'); }
  finally { hideLoading(); }
}

// ── Record deposit ────────────────────────────────────────────────────────────
export function openRecordDepositModal(jobId, balanceDue) {
  openModal('modal-deposit', 'Record Payment', `
    <p style="font-size:13px;color:var(--text2);margin-bottom:16px">
      Balance due: <strong style="color:var(--accent)">${fmtCurDec(balanceDue)}</strong>
    </p>
    <div class="form-grid cols-1">
      <div class="form-group"><label>Amount Received (£) *</label>
        <input type="number" id="dep-amount" step="0.01" min="0.01"
               value="${(+balanceDue).toFixed(2)}" style="font-size:16px"></div>
      <div class="form-group"><label>Notes</label>
        <input type="text" id="dep-notes" placeholder="e.g. BACS transfer, Invoice #123"></div>
    </div>`, `
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="window.__submitDeposit('${esc(jobId)}')">Record Payment</button>`
  );
  window.__submitDeposit = async (jId) => {
    const amount = parseFloat(document.getElementById('dep-amount')?.value);
    if (!amount || amount <= 0) { toast('Enter a valid amount', 'warn'); return; }
    showLoading('Recording…'); closeModal();
    try {
      const r = await rpc('recordDepositPayment', jId, amount,
        document.getElementById('dep-notes')?.value || '');
      toast(`Payment recorded. Balance: ${fmtCurDec(r.balanceDue)}`, 'ok');
      STATE.loadedPanes.delete('jobs');
      await loadJobs();
    } catch(e) { toast(e.message, 'err'); }
    finally { hideLoading(); }
  };
  document.getElementById('dep-amount')?.select();
}