/**
 * MAV HIRE ERP — auditlog.js
 * Full audit trail viewer: who changed what, when.
 * Filterable by entity type, action, user, date range.
 */
import { rpc }   from '../api/gas.js';
import { STATE } from '../utils/state.js';
import { showLoading, hideLoading, toast, emptyState } from '../utils/dom.js';
import { esc, exportCsv } from '../utils/format.js';

let _logs = [];

export async function loadAuditLog() {
  showLoading('Loading audit trail…');
  try {
    _logs = await rpc('getAuditLog', { limit: 500 });
    populateAuditFilters();
    renderLogs(_logs);
    const el = document.getElementById('auditlog-subtitle');
    if (el) el.textContent = `${_logs.length} entries (latest 500)`;
  } catch(e) { toast('Audit log failed: ' + e.message, 'err'); }
  finally { hideLoading(); }
}

export function filterAuditLog() {
  const q      = (document.getElementById('al-search')?.value || '').toLowerCase();
  const type   = document.getElementById('al-type-filter')?.value   || '';
  const action = document.getElementById('al-action-filter')?.value || '';
  const user   = document.getElementById('al-user-filter')?.value   || '';
  const from   = document.getElementById('al-date-from')?.value || '';
  const to     = document.getElementById('al-date-to')?.value   || '';

  renderLogs(_logs.filter(l => {
    const hay = [l.entityType, l.entityId, l.action, l.user, l.notes, l.newValue, l.oldValue, l.field]
      .join(' ').toLowerCase();
    if (q      && !hay.includes(q))       return false;
    if (type   && l.entityType !== type)  return false;
    if (action && l.action     !== action)return false;
    if (user   && l.user       !== user)  return false;
    if (from || to) {
      const ts = l.timestamp ? new Date(l.timestamp) : null;
      if (!ts) return false;
      if (from && ts < new Date(from))               return false;
      if (to   && ts > new Date(to + 'T23:59:59'))   return false;
    }
    return true;
  }));
}

export function exportAuditLogCsv() {
  const q      = (document.getElementById('al-search')?.value || '').toLowerCase();
  const type   = document.getElementById('al-type-filter')?.value   || '';
  const action = document.getElementById('al-action-filter')?.value || '';
  const user   = document.getElementById('al-user-filter')?.value   || '';
  const from   = document.getElementById('al-date-from')?.value || '';
  const to     = document.getElementById('al-date-to')?.value   || '';

  const filtered = _logs.filter(l => {
    const hay = [l.entityType, l.entityId, l.action, l.user, l.notes, l.newValue, l.oldValue, l.field]
      .join(' ').toLowerCase();
    if (q      && !hay.includes(q))       return false;
    if (type   && l.entityType !== type)  return false;
    if (action && l.action     !== action)return false;
    if (user   && l.user       !== user)  return false;
    if (from || to) {
      const ts = l.timestamp ? new Date(l.timestamp) : null;
      if (!ts) return false;
      if (from && ts < new Date(from))               return false;
      if (to   && ts > new Date(to + 'T23:59:59'))   return false;
    }
    return true;
  });

  const rows = filtered.map(l => ({
    'Timestamp':   l.timestamp ? new Date(l.timestamp).toISOString() : '',
    'Entity Type': l.entityType || '',
    'Entity ID':   l.entityId   || '',
    'Action':      l.action     || '',
    'Field':       l.field      || '',
    'Old Value':   l.oldValue   || '',
    'New Value':   l.newValue   || '',
    'User':        l.user       || '',
    'Notes':       l.notes      || '',
  }));
  exportCsv(`MAV_AuditLog_${new Date().toISOString().substring(0,10)}.csv`, rows);
  toast(`Exported ${rows.length} entries`, 'ok');
}

function renderLogs(logs) {
  const el = document.getElementById('auditlog-list');
  if (!el) return;
  if (!logs.length) { el.innerHTML = emptyState('◉', 'No audit entries match filters'); return; }

  const actionColors = {
    CREATE: 'var(--ok)',    UPDATE: 'var(--info)',
    DELETE: 'var(--danger)', SEND: 'var(--accent)',
    CHECKOUT: 'var(--warn)', RETURN: 'var(--ok)',
    GENERATE: 'var(--info)', RECEIVE: 'var(--ok)',
  };

  el.innerHTML = `<div class="tbl-wrap">
    <table style="font-size:12px">
      <thead><tr>
        <th style="white-space:nowrap">Time</th>
        <th>Entity</th>
        <th>ID</th>
        <th>Action</th>
        <th>Field</th>
        <th>Old</th>
        <th>New</th>
        <th>User</th>
        <th>Notes</th>
      </tr></thead>
      <tbody>
        ${logs.map(l => {
          const actionColor = actionColors[l.action] || 'var(--text3)';
          const ts = l.timestamp ? new Date(l.timestamp).toLocaleString('en-GB',{
            day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'
          }) : '—';
          // Truncate long values
          const trunc = (s, n=40) => s && s.length > n ? s.substring(0,n)+'…' : s;
          return `<tr style="border-bottom:1px solid var(--border)">
            <td style="color:var(--text3);white-space:nowrap;font-family:var(--mono);font-size:10px">${ts}</td>
            <td style="font-family:var(--mono);font-size:10px;color:var(--text2)">${esc(l.entityType||'—')}</td>
            <td style="font-family:var(--mono);font-size:10px;color:var(--text3);max-width:80px;
              overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(l.entityId)}">${esc(l.entityId?.substring?.(0,12)||'—')}</td>
            <td><span style="font-family:var(--mono);font-size:10px;padding:1px 6px;border-radius:3px;
              background:${actionColor}22;color:${actionColor};white-space:nowrap">${esc(l.action||'—')}</span></td>
            <td style="font-size:11px;color:var(--text3);max-width:80px;overflow:hidden;text-overflow:ellipsis">${esc(l.field||'')}</td>
            <td style="font-size:11px;color:var(--danger);max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(l.oldValue)}">${esc(trunc(l.oldValue))}</td>
            <td style="font-size:11px;color:var(--ok);max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(l.newValue)}">${esc(trunc(l.newValue))}</td>
            <td style="font-size:11px;color:var(--text3);white-space:nowrap">${esc(l.user||'—')}</td>
            <td style="font-size:11px;color:var(--text3);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(l.notes)}">${esc(l.notes||'')}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>`;
}

// Populate filter dropdowns from log data
export function populateAuditFilters() {
  const types   = [...new Set(_logs.map(l=>l.entityType).filter(Boolean))].sort();
  const actions = [...new Set(_logs.map(l=>l.action).filter(Boolean))].sort();
  const users   = [...new Set(_logs.map(l=>l.user).filter(Boolean))].sort();

  const setOpts = (id, values) => {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = el.value;
    el.innerHTML = `<option value="">All</option>` +
      values.map(v=>`<option${v===cur?' selected':''}>${esc(v)}</option>`).join('');
  };
  setOpts('al-type-filter', types);
  setOpts('al-action-filter', actions);
  setOpts('al-user-filter', users);
}