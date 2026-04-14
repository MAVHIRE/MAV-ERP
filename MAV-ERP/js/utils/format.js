/**
 * MAV HIRE ERP — js/utils/format.js
 * Currency, date, badge, escape helpers.
 */

const _cur = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
const _curDec = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 });

export const fmtCur    = v => _cur.format(+v    || 0);
export const fmtCurDec = v => _curDec.format(+v || 0);
export const fmtPct    = v => (+v || 0).toFixed(1) + '%';
export const fmtWeight = v => (+v || 0).toFixed(1) + ' kg';
export const fmtNum    = v => (+v || 0).toLocaleString('en-GB');

export function fmtDate(v) {
  if (!v) return '—';
  if (v instanceof Date && !isNaN(v)) return v.toLocaleDateString('en-GB');
  const d = new Date(v);
  return isNaN(d) ? String(v) : d.toLocaleDateString('en-GB');
}

export function fmtDateTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d) ? String(v) : d.toLocaleString('en-GB');
}

// HTML-escape user content
export function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Status → badge class mapping
const STATUS_BADGE = {
  Draft:          'neutral', Sent:         'info',    Accepted:    'ok',
  Declined:       'danger',  Expired:      'warn',
  Confirmed:      'info',    Allocated:    'accent',  Prepping:    'warn',
  'Checked Out':  'warn',    Live:         'ok',      Returned:    'ok',
  Complete:       'neutral', Cancelled:    'danger',
  Scheduled:      'info',    'In Progress':'warn',    'Awaiting Parts': 'warn',
  Available:      'ok',      Out:          'warn',    Damaged:     'danger',
  Lost:           'danger',  Retired:      'neutral', 'In Service':'info',
  High:           'danger',  Medium:       'warn',    Low:         'info',
  Serialised:     'info',    Bulk:         'neutral',
  Rental:         'info',    Service:      'warn',    Bundle:      'accent',
  Accessory:      'neutral',
};

export function statusBadge(status) {
  const cls = STATUS_BADGE[status] || 'neutral';
  return `<span class="badge badge-${cls}">${esc(status || '—')}</span>`;
}

export function lineTypeBadge(type) {
  const cls = {
    Rental:    'line-type-rental',
    Service:   'line-type-service',
    Bundle:    'line-type-bundle',
    Accessory: 'line-type-accessory',
  }[type] || 'line-type-rental';
  return `<span class="line-type-badge ${cls}">${esc(type || 'Rental')}</span>`;
}