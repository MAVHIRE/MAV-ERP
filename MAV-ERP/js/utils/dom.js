/**
 * MAV HIRE ERP — js/utils/dom.js
 * Lightweight DOM utility functions.
 */

export function $(sel, ctx = document) { return ctx.querySelector(sel); }
export function $$(sel, ctx = document) { return [...ctx.querySelectorAll(sel)]; }

export function setValue(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}

export function showLoading(msg) {
  const el = document.getElementById('loading');
  if (el) el.classList.remove('hidden');
  const msgEl = document.getElementById('loading-msg');
  if (msgEl) msgEl.textContent = msg || 'Loading…';
}

export function hideLoading() {
  const el = document.getElementById('loading');
  if (el) el.classList.add('hidden');
}

export function toast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3500);
}

export function emptyState(icon, msg) {
  return `<div class="empty">
    <div class="empty-icon">${icon}</div>
    <div class="empty-msg">${msg}</div>
  </div>`;
}

/**
 * Wire client name autocomplete on a form.
 * Searches STATE.clients and fills in company/email/phone on pick.
 */
export function setupClientAutocomplete(nameId, companyId, emailId, phoneId) {
  const input = document.getElementById(nameId);
  if (!input) return;

  // Create dropdown
  const dropdown = document.createElement('div');
  dropdown.className = 'autocomplete-dropdown';
  dropdown.style.display = 'none';
  input.parentElement.style.position = 'relative';
  input.parentElement.appendChild(dropdown);

  input.addEventListener('input', () => {
    const q = input.value.toLowerCase().trim();
    if (!q || q.length < 2) { dropdown.style.display = 'none'; return; }

    // Import STATE lazily to avoid circular deps
    import('./state.js').then(({ STATE }) => {
      const matches = (STATE.clients || []).filter(c =>
        [c.clientName, c.company, c.email].join(' ').toLowerCase().includes(q)
      ).slice(0, 6);

      if (!matches.length) { dropdown.style.display = 'none'; return; }

      dropdown.style.display = 'block';
      dropdown.innerHTML = matches.map(c => `
        <div class="autocomplete-item" data-id="${c.clientId}">
          <div style="font-weight:500;font-size:12px">${c.clientName}</div>
          <div style="font-family:var(--mono);font-size:10px;color:var(--text3)">
            ${c.company ? c.company + ' · ' : ''}${c.email || ''}
          </div>
        </div>`).join('');

      dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
        item.addEventListener('mousedown', () => {
          const client = matches.find(c => c.clientId === item.dataset.id);
          if (!client) return;
          const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
          set(nameId,    client.clientName);
          set(companyId, client.company);
          set(emailId,   client.email);
          set(phoneId,   client.phone);
          dropdown.style.display = 'none';
        });
      });
    });
  });

  input.addEventListener('blur', () => setTimeout(() => { dropdown.style.display = 'none'; }, 150));
}