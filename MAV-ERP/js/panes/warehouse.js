/**
 * MAV HIRE ERP — js/panes/warehouse.js
 * Warehouse floor plan designer.
 * Drag-and-drop canvas for placing zones, racks, shelving units.
 * All dimensions in metres. Saved to WarehouseLocations sheet.
 */
import { rpc }   from '../api/gas.js';
import { STATE } from '../utils/state.js';
import { showLoading, hideLoading, toast } from '../utils/dom.js';
import { esc } from '../utils/format.js';
import { openModal, closeModal } from '../components/modal.js';

// ── State ─────────────────────────────────────────────────────────────────────
let _canvas, _ctx;
let _floor    = { w: 20, d: 15, name: 'Main Warehouse' };
let _grid     = 0.5;       // metres per grid cell
let _scale    = 40;        // pixels per metre
let _items    = [];        // all placed items
let _selected = null;      // selected item id
let _drag     = null;      // { id, offX, offY }
let _resize   = null;      // { id, edge, startX, startY, origW, origD, origX, origY }
let _pan      = { x: 40, y: 40 };
let _panDrag  = null;
let _mode     = 'select';  // select | add-zone | add-rack | add-shelf | add-wall
let _dirty    = false;
let _occupancy= {};        // locationId → count

const ITEM_TYPES = {
  zone:  { label:'Zone / Area',    color:'#4db8ff', textColor:'#0a2a4a', defaultW:4, defaultD:3, defaultH:3   },
  rack:  { label:'Racking Unit',   color:'#e8ff47', textColor:'#2a2a00', defaultW:1, defaultD:0.6, defaultH:2.4 },
  shelf: { label:'Shelf Unit',     color:'#4dff91', textColor:'#003318', defaultW:1.5, defaultD:0.4, defaultH:2   },
  wall:  { label:'Wall / Divider', color:'#5a5a70', textColor:'#e8e8f0', defaultW:4, defaultD:0.2, defaultH:3   },
};

// ── Init ──────────────────────────────────────────────────────────────────────
export async function loadWarehouseDesigner() {
  // Ensure globals are set even if called before exposeGlobals
  exposeWarehouseGlobals();
  showLoading('Loading warehouse…');
  try {
    const [locations, config, occ] = await Promise.all([
      rpc('getWarehouseLocations', {}),
      rpc('getWarehouseConfig'),
      rpc('getLocationOccupancy'),
    ]);

    _floor = {
      w: config.floorW  || 20,
      d: config.floorD  || 15,
      name: config.name || 'Main Warehouse',
    };
    _grid = config.gridSize || 0.5;

    // Convert GAS locations to canvas items
    _items = locations
      .filter(l => l.locationType === 'Zone' || l.locationType === 'Bay')
      .map(l => ({
        id:       l.locationId,
        type:     l.locationType === 'Zone' ? 'zone' : 'rack',
        label:    l.fullPath || l.zone,
        zone:     l.zone,
        bay:      l.bay || '',
        desc:     l.description || '',
        capacity: l.capacity || 0,
        shelves:  l.layoutShelves || 4,
        x:        l.layoutX || 0,
        y:        l.layoutY || 0,
        w:        l.layoutW || ITEM_TYPES['rack'].defaultW,
        d:        l.layoutD || ITEM_TYPES['rack'].defaultD,
        h:        l.layoutH || ITEM_TYPES['rack'].defaultH,
        color:    l.layoutColor || ITEM_TYPES['rack'].color,
        rotation: l.layoutRotation || 0,
        locationId: l.locationId,
      }));

    // Build occupancy map
    _occupancy = {};
    (occ || []).forEach(o => { _occupancy[o.locationId] = o.itemCount || 0; });

    hideLoading();
    setTimeout(() => { initCanvas(); setTimeout(zoomFit, 100); }, 80);

  } catch(e) { hideLoading(); toast(e.message, 'err'); }
}

// ── Canvas init ───────────────────────────────────────────────────────────────
function initCanvas() {
  const container = document.getElementById('warehouse-canvas-wrap');
  if (!container) return;

  container.innerHTML = `<canvas id="warehouse-canvas" style="cursor:crosshair;touch-action:none"></canvas>`;
  _canvas = document.getElementById('warehouse-canvas');
  _ctx    = _canvas.getContext('2d');

  resizeCanvas();
  window.__warehouseResize = resizeCanvas;

  _canvas.addEventListener('mousedown',  onMouseDown);
  _canvas.addEventListener('mousemove',  onMouseMove);
  _canvas.addEventListener('mouseup',    onMouseUp);
  _canvas.addEventListener('dblclick',   onDblClick);
  _canvas.addEventListener('wheel',      onWheel, { passive: false });
  _canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  _canvas.addEventListener('touchmove',  onTouchMove,  { passive: false });
  _canvas.addEventListener('touchend',   onTouchEnd);
  _canvas.addEventListener('contextmenu', onContextMenu);

  draw();
  updateSidebar();
}

function resizeCanvas() {
  const wrap = document.getElementById('warehouse-canvas-wrap');
  if (!wrap || !_canvas) return;
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  if (w < 10 || h < 10) {
    // Container not visible yet — retry
    setTimeout(resizeCanvas, 50);
    return;
  }
  _canvas.width  = w;
  _canvas.height = h;
  draw();
}

// ── Coordinate helpers ────────────────────────────────────────────────────────
function toWorld(cx, cy) {
  return { x: (cx - _pan.x) / _scale, y: (cy - _pan.y) / _scale };
}
function toCanvas(wx, wy) {
  return { x: wx * _scale + _pan.x, y: wy * _scale + _pan.y };
}
function snapGrid(v) {
  return Math.round(v / _grid) * _grid;
}
function itemAt(wx, wy) {
  for (let i = _items.length - 1; i >= 0; i--) {
    const item = _items[i];
    if (wx >= item.x && wx <= item.x + item.w &&
        wy >= item.y && wy <= item.y + item.d) return item;
  }
  return null;
}
function resizeHandle(item, wx, wy) {
  const tol = 8 / _scale;
  if (Math.abs(wx - (item.x + item.w)) < tol && wy >= item.y && wy <= item.y + item.d) return 'right';
  if (Math.abs(wy - (item.y + item.d)) < tol && wx >= item.x && wx <= item.x + item.w) return 'bottom';
  if (Math.abs(wx - item.x) < tol && wy >= item.y && wy <= item.y + item.d) return 'left';
  if (Math.abs(wy - item.y) < tol && wx >= item.x && wx <= item.x + item.w) return 'top';
  return null;
}

// ── Draw ──────────────────────────────────────────────────────────────────────
function draw() {
  if (!_ctx || !_canvas) return;
  const ctx = _ctx;
  const W = _canvas.width, H = _canvas.height;

  // Background
  ctx.fillStyle = '#0d0d0f';
  ctx.fillRect(0, 0, W, H);

  // Grid
  ctx.strokeStyle = '#1c1c22';
  ctx.lineWidth   = 0.5;
  const startX = (_pan.x % (_grid * _scale));
  const startY = (_pan.y % (_grid * _scale));
  for (let x = startX; x < W; x += _grid * _scale) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = startY; y < H; y += _grid * _scale) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // Floor outline
  const fp = toCanvas(0, 0);
  ctx.strokeStyle = '#3a3a4a';
  ctx.lineWidth   = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(fp.x, fp.y, _floor.w * _scale, _floor.d * _scale);
  ctx.setLineDash([]);

  // Floor label
  ctx.fillStyle = '#3a3a4a';
  ctx.font = `bold ${Math.max(10, _scale * 0.3)}px "DM Mono", monospace`;
  ctx.fillText(_floor.name + ` (${_floor.w}m × ${_floor.d}m)`, fp.x + 6, fp.y - 6);

  // Items
  _items.forEach(item => drawItem(ctx, item));

  // Scale bar
  drawScaleBar(ctx, W, H);
}

function drawItem(ctx, item) {
  const cp = toCanvas(item.x, item.y);
  const cw = item.w * _scale;
  const cd = item.d * _scale;
  const type  = ITEM_TYPES[item.type] || ITEM_TYPES.rack;
  const color = item.color || type.color;
  const isSelected = _selected === item.id;
  const occ = _occupancy[item.locationId] || 0;
  const cap = item.capacity || 0;
  const utilPct = cap > 0 ? occ / cap : 0;

  // Shadow / glow for selected
  if (isSelected) {
    ctx.shadowColor = '#e8ff47';
    ctx.shadowBlur  = 12;
  }

  // Fill
  ctx.globalAlpha = item.type === 'zone' ? 0.15 : 0.85;
  ctx.fillStyle   = color;
  ctx.fillRect(cp.x, cp.y, cw, cd);
  ctx.globalAlpha = 1;
  ctx.shadowBlur  = 0;

  // Utilisation bar at bottom
  if (cap > 0 && cw > 20) {
    const barH = Math.min(4, cd * 0.1);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(cp.x + 1, cp.y + cd - barH - 1, cw - 2, barH);
    const barColor = utilPct > 0.9 ? '#ff4d4d' : utilPct > 0.7 ? '#ffaa00' : '#4dff91';
    ctx.fillStyle = barColor;
    ctx.fillRect(cp.x + 1, cp.y + cd - barH - 1, (cw - 2) * utilPct, barH);
  }

  // Border
  ctx.strokeStyle = isSelected ? '#e8ff47' : color;
  ctx.lineWidth   = isSelected ? 2 : 1;
  ctx.strokeRect(cp.x, cp.y, cw, cd);

  // Label
  if (cw > 30 && cd > 14) {
    ctx.fillStyle   = item.type === 'zone' ? color : type.textColor;
    ctx.font        = `${Math.max(9, Math.min(13, cw / item.label.length * 1.4))}px "DM Mono", monospace`;
    ctx.textAlign   = 'center';
    ctx.textBaseline= 'middle';
    // Clip text to item
    ctx.save();
    ctx.beginPath();
    ctx.rect(cp.x + 2, cp.y + 2, cw - 4, cd - 4);
    ctx.clip();
    ctx.fillText(item.label, cp.x + cw / 2, cp.y + cd / 2);
    if (cd > 28 && item.h) {
      ctx.font      = `9px "DM Mono", monospace`;
      ctx.fillStyle = item.type === 'zone' ? color : type.textColor;
      ctx.globalAlpha = 0.7;
      ctx.fillText(`${item.w.toFixed(1)}m × ${item.d.toFixed(1)}m × ${item.h.toFixed(1)}m H`, cp.x + cw / 2, cp.y + cd / 2 + 12);
      if (cap > 0) ctx.fillText(`${occ}/${cap}`, cp.x + cw / 2, cp.y + cd / 2 + 22);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // Resize handles for selected
  if (isSelected) {
    ctx.fillStyle = '#e8ff47';
    [[cp.x + cw, cp.y + cd/2], [cp.x + cw/2, cp.y + cd], [cp.x, cp.y + cd/2], [cp.x + cw/2, cp.y]].forEach(([hx, hy]) => {
      ctx.beginPath();
      ctx.arc(hx, hy, 5, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

function drawScaleBar(ctx, W, H) {
  const barM = 5; // 5 metres
  const barPx = barM * _scale;
  const x = 20, y = H - 24;
  ctx.fillStyle = '#3a3a4a';
  ctx.fillRect(x, y, barPx, 6);
  ctx.fillStyle = '#9090a8';
  ctx.font = '10px "DM Mono", monospace';
  ctx.fillText(`${barM}m`, x + barPx + 4, y + 6);
  ctx.fillText(`1:${(100 / _scale * 100).toFixed(0)}`, x, y - 3);
}

// ── Mouse / touch events ──────────────────────────────────────────────────────
function onMouseDown(e) {
  const rect = _canvas.getBoundingClientRect();
  const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
  const w  = toWorld(cx, cy);

  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    _panDrag = { startX: cx, startY: cy, origPanX: _pan.x, origPanY: _pan.y };
    return;
  }

  if (_mode === 'select') {
    const item = itemAt(w.x, w.y);
    if (item) {
      const edge = resizeHandle(item, w.x, w.y);
      if (edge) {
        _resize = { id: item.id, edge, startX: cx, startY: cy, origW: item.w, origD: item.d, origX: item.x, origY: item.y };
      } else {
        _drag = { id: item.id, offX: w.x - item.x, offY: w.y - item.y };
      }
      _selected = item.id;
    } else {
      _selected = null;
    }
    draw(); updateSidebar();
    return;
  }

  // Add modes
  const type = _mode.replace('add-', '');
  if (!ITEM_TYPES[type]) return;
  const t = ITEM_TYPES[type];
  const newItem = {
    id:       'new-' + Date.now(),
    type,
    label:    type === 'zone' ? 'Zone ' + String.fromCharCode(65 + _items.filter(i => i.type === 'zone').length) : 'Rack ' + (_items.filter(i=>i.type==='rack').length+1),
    zone:     '',
    bay:      '',
    desc:     '',
    capacity: type === 'rack' ? 20 : 0,
    shelves:  4,
    x:        snapGrid(Math.max(0, w.x - t.defaultW/2)),
    y:        snapGrid(Math.max(0, w.y - t.defaultD/2)),
    w:        t.defaultW,
    d:        t.defaultD,
    h:        t.defaultH,
    color:    t.color,
    rotation: 0,
    locationId: null,
  };
  newItem.x = Math.min(newItem.x, _floor.w - newItem.w);
  newItem.y = Math.min(newItem.y, _floor.d - newItem.d);
  _items.push(newItem);
  _selected = newItem.id;
  _dirty = true;
  draw(); updateSidebar();
  openItemProperties(newItem);
}

function onMouseMove(e) {
  const rect = _canvas.getBoundingClientRect();
  const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
  const w  = toWorld(cx, cy);

  if (_panDrag) {
    _pan.x = _panDrag.origPanX + (cx - _panDrag.startX);
    _pan.y = _panDrag.origPanY + (cy - _panDrag.startY);
    draw(); return;
  }

  if (_resize) {
    const item = _items.find(i => i.id === _resize.id);
    if (!item) return;
    const dx = (cx - _resize.startX) / _scale;
    const dy = (cy - _resize.startY) / _scale;
    const minSize = _grid;
    if (_resize.edge === 'right')  { item.w = Math.max(minSize, snapGrid(_resize.origW + dx)); }
    if (_resize.edge === 'bottom') { item.d = Math.max(minSize, snapGrid(_resize.origD + dy)); }
    if (_resize.edge === 'left')   { const nw = Math.max(minSize, snapGrid(_resize.origW - dx)); item.x = _resize.origX + (_resize.origW - nw); item.w = nw; }
    if (_resize.edge === 'top')    { const nd = Math.max(minSize, snapGrid(_resize.origD - dy)); item.y = _resize.origY + (_resize.origD - nd); item.d = nd; }
    _dirty = true; draw(); updateSidebar(); return;
  }

  if (_drag) {
    const item = _items.find(i => i.id === _drag.id);
    if (!item) return;
    item.x = snapGrid(Math.max(0, Math.min(_floor.w - item.w, w.x - _drag.offX)));
    item.y = snapGrid(Math.max(0, Math.min(_floor.d - item.d, w.y - _drag.offY)));
    _dirty = true; draw(); updateSidebar(); return;
  }

  // Cursor hints
  if (_mode === 'select') {
    const item = itemAt(w.x, w.y);
    if (item) {
      const edge = resizeHandle(item, w.x, w.y);
      _canvas.style.cursor = edge === 'right' || edge === 'left' ? 'ew-resize' :
                             edge === 'top'   || edge === 'bottom' ? 'ns-resize' : 'move';
    } else {
      _canvas.style.cursor = 'default';
    }
  }
}

function onMouseUp(e) {
  if (_panDrag) { _panDrag = null; return; }
  if (_resize || _drag) { _resize = null; _drag = null; updateSidebar(); }
}

function onDblClick(e) {
  const rect = _canvas.getBoundingClientRect();
  const w = toWorld(e.clientX - rect.left, e.clientY - rect.top);
  const item = itemAt(w.x, w.y);
  if (item) openItemProperties(item);
}

function onWheel(e) {
  e.preventDefault();
  const rect = _canvas.getBoundingClientRect();
  const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
  const factor = e.deltaY < 0 ? 1.1 : 0.9;
  const newScale = Math.max(10, Math.min(200, _scale * factor));
  _pan.x = cx - (cx - _pan.x) * (newScale / _scale);
  _pan.y = cy - (cy - _pan.y) * (newScale / _scale);
  _scale = newScale;
  draw();
}

function onContextMenu(e) {
  e.preventDefault();
  const rect = _canvas.getBoundingClientRect();
  const w = toWorld(e.clientX - rect.left, e.clientY - rect.top);
  const item = itemAt(w.x, w.y);
  if (item) { _selected = item.id; draw(); openItemProperties(item); }
}

let _lastTouchDist = 0;
function onTouchStart(e) {
  e.preventDefault();
  if (e.touches.length === 2) {
    _lastTouchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    return;
  }
  const rect = _canvas.getBoundingClientRect();
  const t = e.touches[0];
  onMouseDown({ button: 0, clientX: t.clientX, clientY: t.clientY, altKey: false, preventDefault: ()=>{} });
}
function onTouchMove(e) {
  e.preventDefault();
  if (e.touches.length === 2) {
    const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    const factor = dist / _lastTouchDist;
    const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    const rect = _canvas.getBoundingClientRect();
    const pcx = cx - rect.left, pcy = cy - rect.top;
    const newScale = Math.max(10, Math.min(200, _scale * factor));
    _pan.x = pcx - (pcx - _pan.x) * (newScale / _scale);
    _pan.y = pcy - (pcy - _pan.y) * (newScale / _scale);
    _scale = newScale;
    _lastTouchDist = dist;
    draw(); return;
  }
  const t = e.touches[0], rect = _canvas.getBoundingClientRect();
  onMouseMove({ clientX: t.clientX, clientY: t.clientY });
}
function onTouchEnd(e) { onMouseUp({}); }

// ── Sidebar ───────────────────────────────────────────────────────────────────
function updateSidebar() {
  const el = document.getElementById('wh-selected-panel');
  if (!el) return;
  const item = _items.find(i => i.id === _selected);
  if (!item) {
    el.innerHTML = `<div style="color:var(--text3);font-size:12px;padding:12px 0">
      Select an item to see its properties.<br>
      Double-click to edit. Right-click for options.
    </div>`;
    return;
  }
  const occ = _occupancy[item.locationId] || 0;
  const cap = item.capacity || 0;
  const pct = cap > 0 ? Math.round(occ / cap * 100) : 0;
  el.innerHTML = `
    <div style="font-family:var(--mono);font-size:11px;color:var(--text3);margin-bottom:6px">${esc(item.type.toUpperCase())}</div>
    <div style="font-size:14px;font-weight:600;margin-bottom:8px">${esc(item.label)}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:11px;margin-bottom:10px">
      <div style="color:var(--text3)">Width</div><div>${item.w.toFixed(2)}m</div>
      <div style="color:var(--text3)">Depth</div><div>${item.d.toFixed(2)}m</div>
      <div style="color:var(--text3)">Height</div><div>${item.h.toFixed(2)}m</div>
      ${item.shelves ? `<div style="color:var(--text3)">Shelves</div><div>${item.shelves}</div>` : ''}
      <div style="color:var(--text3)">Position</div><div>${item.x.toFixed(1)}, ${item.y.toFixed(1)}</div>
      ${cap > 0 ? `<div style="color:var(--text3)">Occupancy</div><div style="color:${pct>90?'var(--danger)':pct>70?'var(--warn)':'var(--ok)'}">${occ}/${cap} (${pct}%)</div>` : ''}
    </div>
    ${item.desc ? `<div style="font-size:11px;color:var(--text2);margin-bottom:10px">${esc(item.desc)}</div>` : ''}
    <div style="display:flex;flex-direction:column;gap:6px">
      <button class="btn btn-primary btn-sm" onclick="window.__whEditItem()">✏ Edit Properties</button>
      <button class="btn btn-ghost btn-sm" onclick="window.__whDuplicateItem()">⊕ Duplicate</button>
      <button class="btn btn-danger btn-sm" onclick="window.__whDeleteItem()">✕ Delete</button>
    </div>`;
}

// ── Item properties modal ─────────────────────────────────────────────────────
function openItemProperties(item) {
  const type = ITEM_TYPES[item.type] || ITEM_TYPES.rack;
  openModal('modal-wh-item', `${type.label} Properties`, `
    <div class="form-grid">
      <div class="form-group span-2"><label>Label / Name</label>
        <input type="text" id="wh-item-label" value="${esc(item.label)}"></div>
      <div class="form-group span-2"><label>Description</label>
        <input type="text" id="wh-item-desc" value="${esc(item.desc)}"></div>
      <div class="form-group"><label>Width (m)</label>
        <input type="number" id="wh-item-w" value="${item.w.toFixed(2)}" step="0.1" min="0.1"></div>
      <div class="form-group"><label>Depth (m)</label>
        <input type="number" id="wh-item-d" value="${item.d.toFixed(2)}" step="0.1" min="0.1"></div>
      <div class="form-group"><label>Height (m)</label>
        <input type="number" id="wh-item-h" value="${item.h.toFixed(2)}" step="0.1" min="0.1"></div>
      ${item.type !== 'zone' && item.type !== 'wall' ? `
      <div class="form-group"><label>Shelves / Levels</label>
        <input type="number" id="wh-item-shelves" value="${item.shelves||4}" min="1" max="20" step="1"></div>
      <div class="form-group span-2"><label>Capacity (items)</label>
        <input type="number" id="wh-item-cap" value="${item.capacity||0}" min="0" step="1"></div>` : ''}
      <div class="form-group"><label>Colour</label>
        <div style="display:flex;gap:8px;align-items:center">
          <input type="color" id="wh-item-color" value="${item.color||type.color}" style="width:48px;height:36px;padding:2px;border-radius:4px;cursor:pointer"
            oninput="document.getElementById('wh-item-color-hex').value=this.value">
          <input type="text" id="wh-item-color-hex" value="${item.color||type.color}" style="flex:1;font-family:var(--mono);font-size:12px"
            oninput="document.getElementById('wh-item-color').value=this.value">
        </div>
      </div>
      <div class="form-group"><label>X Position (m)</label>
        <input type="number" id="wh-item-x" value="${item.x.toFixed(2)}" step="0.5" min="0"></div>
      <div class="form-group"><label>Y Position (m)</label>
        <input type="number" id="wh-item-y" value="${item.y.toFixed(2)}" step="0.5" min="0"></div>
    </div>`, `
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-danger btn-sm" onclick="window.__whDeleteItem()">Delete</button>
    <button class="btn btn-primary btn-sm" onclick="window.__whApplyProperties('${esc(item.id)}')">Apply</button>`
  );
}

// ── Floor settings modal ──────────────────────────────────────────────────────
export function openFloorSettings() {
  openModal('modal-wh-floor', 'Warehouse Settings', `
    <div class="form-grid">
      <div class="form-group span-2"><label>Warehouse Name</label>
        <input type="text" id="wh-floor-name" value="${esc(_floor.name)}"></div>
      <div class="form-group"><label>Floor Width (m)</label>
        <input type="number" id="wh-floor-w" value="${_floor.w}" step="1" min="5" max="200"></div>
      <div class="form-group"><label>Floor Depth (m)</label>
        <input type="number" id="wh-floor-d" value="${_floor.d}" step="1" min="5" max="200"></div>
      <div class="form-group"><label>Grid Size (m)</label>
        <select id="wh-grid">
          <option value="0.25"${_grid===0.25?' selected':''}>0.25m (fine)</option>
          <option value="0.5"${_grid===0.5?' selected':''}>0.5m (default)</option>
          <option value="1"${_grid===1?' selected':''}>1m (coarse)</option>
        </select>
      </div>
    </div>`, `
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="window.__whApplyFloor()">Apply</button>`
  );
}

// ── Save to GAS ───────────────────────────────────────────────────────────────
export async function saveWarehouseLayout() {
  if (!_dirty) { toast('No changes to save', 'info'); return; }
  showLoading('Saving layout…');
  try {
    // Save floor config
    await rpc('saveWarehouseConfig', {
      floorW:  _floor.w,
      floorD:  _floor.d,
      gridSize: _grid,
      name:    _floor.name,
    });

    // Save all items as warehouse locations
    const payload = _items.map(item => ({
      locationId:   item.locationId || null,
      locationType: item.type === 'zone' ? 'Zone' : 'Bay',
      zone:         item.type === 'zone' ? item.label : (item.zone || item.label),
      bay:          item.type !== 'zone' ? (item.bay || item.label) : '',
      description:  item.desc,
      capacity:     item.capacity || 0,
      active:       true,
      layoutX:      item.x,
      layoutY:      item.y,
      layoutW:      item.w,
      layoutD:      item.d,
      layoutH:      item.h,
      layoutShelves: item.shelves || 4,
      layoutColor:  item.color,
      layoutRotation: item.rotation || 0,
    }));

    const result = await rpc('saveWarehouseLayout', payload);

    // Update locationIds from response
    if (result.results) {
      result.results.forEach((r, i) => {
        if (r.ok && r.locationId && _items[i]) {
          _items[i].locationId = r.locationId;
          if (!_items[i].zone) _items[i].zone = _items[i].label;
        }
      });
    }

    _dirty = false;
    toast(`Saved ${result.saved} locations`, 'ok');
  } catch(e) { toast(e.message, 'err'); }
  finally { hideLoading(); }
}

// ── Globals ───────────────────────────────────────────────────────────────────
export function setMode(mode) {
  _mode = mode;
  document.querySelectorAll('.wh-tool-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  _canvas.style.cursor = mode === 'select' ? 'default' : 'crosshair';
}

export function zoomFit() {
  if (!_canvas) return;
  const margin = 40;
  const scaleX = (_canvas.width  - margin*2) / _floor.w;
  const scaleY = (_canvas.height - margin*2) / _floor.d;
  _scale = Math.min(scaleX, scaleY, 80);
  _pan.x = margin;
  _pan.y = margin;
  draw();
}

export function exposeWarehouseGlobals() {
  window.__whSetMode        = setMode;
  window.__whZoomFit        = zoomFit;
  window.__whZoomIn         = () => { _scale = Math.min(200, _scale * 1.2); draw(); };
  window.__whZoomOut        = () => { _scale = Math.max(10, _scale / 1.2); draw(); };
  window.__whFloorSettings  = openFloorSettings;
  window.__whSave           = saveWarehouseLayout;
  window.__whEditItem       = () => { const item = _items.find(i=>i.id===_selected); if(item) openItemProperties(item); };
  window.__whDuplicateItem  = () => {
    const item = _items.find(i=>i.id===_selected);
    if (!item) return;
    const copy = { ...item, id: 'new-'+Date.now(), locationId: null, x: item.x + _grid, y: item.y + _grid };
    _items.push(copy); _selected = copy.id; _dirty = true; draw(); updateSidebar();
  };
  window.__whDeleteItem = () => {
    if (!_selected) return;
    if (!confirm('Delete this item?')) return;
    _items = _items.filter(i => i.id !== _selected);
    _selected = null; _dirty = true; draw(); updateSidebar();
    closeModal();
  };
  window.__whApplyProperties = (id) => {
    const item = _items.find(i => i.id === id);
    if (!item) return;
    item.label    = document.getElementById('wh-item-label')?.value || item.label;
    item.desc     = document.getElementById('wh-item-desc')?.value  || '';
    item.w        = parseFloat(document.getElementById('wh-item-w')?.value)     || item.w;
    item.d        = parseFloat(document.getElementById('wh-item-d')?.value)     || item.d;
    item.h        = parseFloat(document.getElementById('wh-item-h')?.value)     || item.h;
    item.shelves  = parseInt(document.getElementById('wh-item-shelves')?.value) || item.shelves;
    item.capacity = parseInt(document.getElementById('wh-item-cap')?.value)     || 0;
    item.color    = document.getElementById('wh-item-color')?.value             || item.color;
    item.x        = parseFloat(document.getElementById('wh-item-x')?.value)     || item.x;
    item.y        = parseFloat(document.getElementById('wh-item-y')?.value)     || item.y;
    _dirty = true; closeModal(); draw(); updateSidebar();
  };
  window.__whApplyFloor = () => {
    _floor.name = document.getElementById('wh-floor-name')?.value || _floor.name;
    _floor.w    = parseFloat(document.getElementById('wh-floor-w')?.value) || _floor.w;
    _floor.d    = parseFloat(document.getElementById('wh-floor-d')?.value) || _floor.d;
    _grid       = parseFloat(document.getElementById('wh-grid')?.value)    || _grid;
    _dirty = true; closeModal(); draw();
  };
}