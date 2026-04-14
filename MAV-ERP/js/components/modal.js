/**
 * MAV HIRE ERP — js/components/modal.js
 * Reusable modal engine. Call openModal() / closeModal() from anywhere.
 */

import { esc } from '../utils/format.js';

export function openModal(id, title, bodyHtml, footerHtml = '', extraClass = '') {
  closeModal();
  const container = document.getElementById('modal-container');
  if (!container) return;

  container.innerHTML = `
    <div class="modal-overlay" id="overlay-${id}">
      <div class="modal ${extraClass}" id="${id}">
        <div class="modal-header">
          <div class="modal-title">${title}</div>
          <button class="modal-close" onclick="window.__closeModal()">×</button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
        ${footerHtml ? `<div class="modal-footer">${footerHtml}</div>` : ''}
      </div>
    </div>`;

  // Close on backdrop click
  document.getElementById('overlay-' + id)?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });

  // Expose globally for inline onclick handlers
  window.__closeModal = closeModal;
}

export function closeModal() {
  const container = document.getElementById('modal-container');
  if (container) container.innerHTML = '';
}

export function confirmDialog(message) {
  return new Promise(resolve => {
    const id = 'confirm-dialog';
    openModal(id, 'Confirm', `<p style="color:var(--text2);font-size:14px">${esc(message)}</p>`,
      `<button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
       <button class="btn btn-danger btn-sm" id="confirm-yes">Confirm</button>`
    );
    document.getElementById('confirm-yes')?.addEventListener('click', () => {
      closeModal();
      resolve(true);
    });
    // Resolve false if modal closes without confirm
    const observer = new MutationObserver(() => {
      if (!document.getElementById(id)) { observer.disconnect(); resolve(false); }
    });
    observer.observe(document.getElementById('modal-container'), { childList: true });
  });
}