/**
 * MAV HIRE ERP — js/components/modal.js
 * Reusable modal engine with:
 * - aria-modal, role=dialog, aria-labelledby
 * - Focus trap (Tab/Shift+Tab cycle within modal)
 * - ESC to close
 * - Focus restore to prior active element
 * - Backdrop click to close
 */

import { esc } from '../utils/format.js';

// Track the element that had focus before modal opened
let _priorFocus = null;
let _trapHandler = null;
let _escHandler  = null;

// All focusable element selectors
const FOCUSABLE = 'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function openModal(id, title, bodyHtml, footerHtml = '', extraClass = '') {
  closeModal();
  const container = document.getElementById('modal-container');
  if (!container) return;

  // Save current focus to restore on close
  _priorFocus = document.activeElement;

  const titleId = `${id}-title`;

  container.innerHTML = `
    <div class="modal-outer" id="overlay-${id}">
      <div class="modal ${extraClass}" id="${id}"
           role="dialog"
           aria-modal="true"
           aria-labelledby="${titleId}">
        <div class="modal-header">
          <div class="modal-title" id="${titleId}">${title}</div>
          <button class="modal-close" onclick="window.__closeModal()" aria-label="Close dialog">×</button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
        ${footerHtml ? `<div class="modal-footer">${footerHtml}</div>` : ''}
      </div>
    </div>`;

  // Close on backdrop click
  document.getElementById('overlay-' + id)?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });

  // Move focus into modal — deferred one frame so the element is painted and focusable
  const modal = document.getElementById(id);
  const firstFocusable = modal?.querySelector(FOCUSABLE);
  requestAnimationFrame(() => (firstFocusable || modal)?.focus());

  // Focus trap — keep Tab cycling within modal
  _trapHandler = (e) => {
    if (e.key !== 'Tab') return;
    const focusable = [...(modal?.querySelectorAll(FOCUSABLE) || [])].filter(el => !el.closest('[hidden]'));
    if (!focusable.length) return;
    const first = focusable[0];
    const last  = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
    }
  };

  // ESC to close
  _escHandler = (e) => {
    if (e.key === 'Escape') closeModal();
  };

  document.addEventListener('keydown', _trapHandler);
  document.addEventListener('keydown', _escHandler);

  // Expose globally for inline onclick handlers
  window.__closeModal = closeModal;
}

export function closeModal() {
  // Remove event handlers
  if (_trapHandler) { document.removeEventListener('keydown', _trapHandler); _trapHandler = null; }
  if (_escHandler)  { document.removeEventListener('keydown', _escHandler);  _escHandler  = null; }

  const container = document.getElementById('modal-container');
  if (container) container.innerHTML = '';

  // Restore prior focus
  try { _priorFocus?.focus(); } catch(e) {}
  _priorFocus = null;
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