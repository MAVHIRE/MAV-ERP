/**
 * MAV HIRE ERP — warehouse.js  v2.0
 * Professional warehouse floor plan designer.
 * Canvas-based with snap-to-grid, measurement labels, rack elevation,
 * multi-select, keyboard shortcuts, undo/redo.
 */
import { rpc }   from '../api/gas.js';
import { STATE } from '../utils/state.js';
import { showLoading, hideLoading, toast } from '../utils/dom.js';
import { esc } from '../utils/format.js';
import { openModal, closeModal } from '../components/modal.js';

// ── Constants ─────────────────────────────────────────────────────────────────
const COLORS = {
  bg:        '#0a0a0c',
  grid:      '#141418',
  gridMajor: '#1e1e26',
  floor:     '#12121a',
  floorBorder:'#2a2a3a',
  text:      '#e8e8f0',
  textMuted: '#5a5a70',
  accent:    '#e8ff47',
  selection: '#e8ff47',
  handle:    '#e8ff47',
};

const ITEM_DEFS = {
  zone:  { label:'Zone',    bg:'rgba(77,184,255,0.12)',  border:'#4db8ff', text:'#4db8ff',  defaultW:6,   defaultD:4,   defaultH:3,   icon:'◻' },
  rack:  { label:'Rack',    bg:'rgba(232,255,71,0.88)',  border:'#b8cc00', text:'#1a1a00',  defaultW:0.9, defaultD:0.5, defaultH:2.4, icon:'▦' },
  shelf: { label:'Shelf',   bg:'rgba(77,255,145,0.85)',  border:'#00cc55', text:'#001a0a',  defaultW:1.8, defaultD:0.4, defaultH:2.0, icon:'▤' },
  desk:  { label:'Desk',    bg:'rgba(180,180,220,0.85)', border:'#8888bb', text:'#0a0a20',  defaultW:1.6, defaultD:0.8, defaultH:0.75,icon:'▭' },
  wall:  { label:'Wall',    bg:'rgba(90,90,112,0.95)',   border:'#5a5a70', text:'#e8e8f0',  defaultW:4,   defaultD:0.15,defaultH:3,   icon:'█' },
  pillar:{ label:'Pillar',  bg:'rgba(120,90,60,0.9)',    border:'#7a5a3a', text:'#fff0cc',  defaultW:0.3, defaultD:0.3, defaultH:3,   icon:'■' },
  door:  { label:'Door',    bg:'rgba(255,160,77,0.3)',   border:'#ffa04d', text:'#ff8000',  defaultW:1.2, defaultD:0.1, defaultH:2.1, icon:'⊡' },
};

// ── State ─────────────────────────────────────────────────────────────────────
let _canvas, _ctx;
let _dpr    = window.devicePixelRatio || 1;
let _floor  = { w:20, d:15, name:'Main Warehouse' };
let _grid   = 0.5;
let _scale  = 40;
let _pan    = { x:60, y:60 };
let _items  = [];
let _selected= new Set();
let _hover  = null;
let _drag   = null;
let _resize = null;
let _panDrag= null;
let _marquee= null;
let _mode   = 'select';
let _dirty  = false;
let _occ    = {};
let _undoStack = [], _redoStack = [];
let _showMeasure = true;
let _showGrid    = true;
let _showElevation = false;
let _view   = '2d';  // '2d' | 'elevation'

// ── Init / load ───────────────────────────────────────────────────────────────
export async function loadWarehouseDesigner() {
  exposeWarehouseGlobals();
  showLoading('Loading warehouse…');
  try {
    const [locs, cfg, occ] = await Promise.all([
      rpc('getWarehouseLocations', {}),
      rpc('getWarehouseConfig'),
      rpc('getLocationOccupancy'),
    ]);
    _floor = { w: +cfg.floorW||20, d: +cfg.floorD||15, name: cfg.name||'Main Warehouse' };
    _grid  = +cfg.gridSize || 0.5;
    _occ   = {};
    (occ||[]).forEach(o => _occ[o.locationId] = +o.itemCount||0);
    _items = (locs||[])
      .filter(l => l.layoutW > 0)
      .map(l => ({
        id:         l.locationId,
        locationId: l.locationId,
        type:       l.locationType === 'Zone' ? 'zone' : (l.layoutW < 0.5 ? 'wall' : 'rack'),
        label:      l.fullPath || l.zone || l.locationId,
        zone:       l.zone||'', bay: l.bay||'', desc: l.description||'',
        capacity:   +l.capacity||0, shelves: +l.layoutShelves||4,
        x: +l.layoutX||0, y: +l.layoutY||0,
        w: +l.layoutW||1, d: +l.layoutD||1, h: +l.layoutH||2.4,
        color:    l.layoutColor||null,
        rotation: +l.layoutRotation||0,
      }));
    hideLoading();
    setTimeout(() => { initCanvas(); setTimeout(zoomFit, 150); }, 100);
  } catch(e) { hideLoading(); toast(e.message,'err'); }
}

// ── Canvas setup ──────────────────────────────────────────────────────────────
function initCanvas() {
  const wrap = document.getElementById('warehouse-canvas-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';
  _canvas = document.createElement('canvas');
  _canvas.style.cssText = 'display:block;width:100%;height:100%;cursor:default;touch-action:none';
  wrap.appendChild(_canvas);
  _ctx = _canvas.getContext('2d');
  sizeCanvas();
  if (window.ResizeObserver) {
    new ResizeObserver(() => { sizeCanvas(); draw(); }).observe(wrap);
  }
  attachEvents();
  draw();
  updateUI();
}

function sizeCanvas() {
  const wrap = document.getElementById('warehouse-canvas-wrap');
  if (!wrap || !_canvas) return;
  _dpr = window.devicePixelRatio || 1;
  const w = wrap.offsetWidth || 900;
  const h = wrap.offsetHeight || 650;
  _canvas.width  = w * _dpr;
  _canvas.height = h * _dpr;
  _canvas.style.width  = w + 'px';
  _canvas.style.height = h + 'px';
  _ctx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
}

function cw() { return _canvas.width  / _dpr; }
function ch() { return _canvas.height / _dpr; }

// ── Coordinate helpers ────────────────────────────────────────────────────────
function toWorld(cx, cy) { return { x:(cx-_pan.x)/_scale, y:(cy-_pan.y)/_scale }; }
function toCanvas(wx,wy) { return { x:wx*_scale+_pan.x, y:wy*_scale+_pan.y }; }
function snap(v) { return Math.round(v/_grid)*_grid; }

function itemsAt(wx, wy) {
  return _items.filter(i => wx>=i.x && wx<=i.x+i.w && wy>=i.y && wy<=i.y+i.d)
               .sort((a,b) => ITEM_DEFS[b.type]?.defaultW - ITEM_DEFS[a.type]?.defaultW);
}
function topItemAt(wx, wy) { return itemsAt(wx,wy)[0] || null; }

function getHandle(item, wx, wy) {
  const tol = 7/_scale;
  const mx = item.x+item.w/2, my = item.y+item.d/2;
  const handles = [
    { id:'tr', x:item.x+item.w, y:item.y },
    { id:'br', x:item.x+item.w, y:item.y+item.d },
    { id:'bl', x:item.x,        y:item.y+item.d },
    { id:'tl', x:item.x,        y:item.y },
    { id:'r',  x:item.x+item.w, y:my },
    { id:'b',  x:mx,             y:item.y+item.d },
    { id:'l',  x:item.x,        y:my },
    { id:'t',  x:mx,             y:item.y },
  ];
  return handles.find(h => Math.hypot(h.x-wx, h.y-wy) < tol) || null;
}

// ── Draw ──────────────────────────────────────────────────────────────────────
function draw() {
  if (!_ctx) return;
  const W = cw(), H = ch();
  const ctx = _ctx;
  ctx.clearRect(0,0,W,H);

  // Background
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0,0,W,H);

  // Grid
  if (_showGrid) drawGrid(ctx, W, H);

  // Floor
  drawFloor(ctx);

  // Items (zones first, then others)
  _items.filter(i=>i.type==='zone').forEach(i=>drawItem(ctx,i));
  _items.filter(i=>i.type!=='zone').forEach(i=>drawItem(ctx,i));

  // Marquee select
  if (_marquee) drawMarquee(ctx);

  // Measurements
  if (_showMeasure) drawMeasurements(ctx, W, H);

  // Scale bar + info
  drawHUD(ctx, W, H);
}

function drawGrid(ctx, W, H) {
  const minor = _grid * _scale;
  const major = minor * (1/_grid % 1 === 0 ? 5 : 2);

  // Minor grid
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 0.5;
  const ox = _pan.x % minor, oy = _pan.y % minor;
  for (let x = ox; x < W; x += minor) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for (let y = oy; y < H; y += minor) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

  // Major grid
  if (_scale > 15) {
    ctx.strokeStyle = COLORS.gridMajor;
    ctx.lineWidth = 1;
    const oxm = _pan.x % major, oym = _pan.y % major;
    for (let x = oxm; x < W; x += major) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for (let y = oym; y < H; y += major) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
  }
}

function drawFloor(ctx) {
  const fp = toCanvas(0,0);
  const fw = _floor.w*_scale, fd = _floor.d*_scale;

  // Floor fill
  ctx.fillStyle = COLORS.floor;
  ctx.fillRect(fp.x, fp.y, fw, fd);

  // Floor border
  ctx.strokeStyle = COLORS.floorBorder;
  ctx.lineWidth = 2;
  ctx.setLineDash([8,5]);
  ctx.strokeRect(fp.x, fp.y, fw, fd);
  ctx.setLineDash([]);

  // Floor label
  ctx.fillStyle = COLORS.textMuted;
  ctx.font = `bold ${Math.max(11,_scale*0.35)}px "DM Mono",monospace`;
  ctx.textAlign = 'left';
  ctx.fillText(_floor.name, fp.x+6, fp.y-8);

  // Dimension labels on edges
  if (_scale > 20) {
    ctx.fillStyle = COLORS.textMuted;
    ctx.font = `${Math.max(9,_scale*0.25)}px "DM Mono",monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(_floor.w+'m', fp.x+fw/2, fp.y+fd+14);
    ctx.save(); ctx.translate(fp.x-14, fp.y+fd/2);
    ctx.rotate(-Math.PI/2); ctx.fillText(_floor.d+'m', 0, 0);
    ctx.restore();
    ctx.textAlign = 'left';
  }
}

function drawItem(ctx, item) {
  const def   = ITEM_DEFS[item.type] || ITEM_DEFS.rack;
  const cp    = toCanvas(item.x, item.y);
  const cw_   = item.w*_scale, cd_ = item.d*_scale;
  const isSel = _selected.has(item.id);
  const isHov = _hover === item.id;
  const occ   = _occ[item.locationId]||0;
  const cap   = item.capacity||0;

  ctx.save();

  // Drop shadow for selected
  if (isSel) {
    ctx.shadowColor = COLORS.selection;
    ctx.shadowBlur  = 16;
  }

  // Fill
  ctx.fillStyle = item.color || def.bg;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(cp.x, cp.y, cw_, cd_, 3) : ctx.rect(cp.x, cp.y, cw_, cd_);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Hover highlight
  if (isHov && !isSel) {
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(cp.x, cp.y, cw_, cd_);
  }

  // Rack shelf lines (if big enough)
  if ((item.type==='rack'||item.type==='shelf') && cd_>20 && item.shelves>1) {
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 0.5;
    for (let s=1; s<item.shelves; s++) {
      const sy = cp.y + (cd_/item.shelves)*s;
      ctx.beginPath(); ctx.moveTo(cp.x+2,sy); ctx.lineTo(cp.x+cw_-2,sy); ctx.stroke();
    }
  }

  // Occupancy bar
  if (cap>0 && cw_>16) {
    const pct  = Math.min(1, occ/cap);
    const barH = Math.max(3, Math.min(6, cd_*0.1));
    const barY = cp.y+cd_-barH-1;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(cp.x+1, barY, cw_-2, barH);
    ctx.fillStyle = pct>0.9?'#ff4d4d':pct>0.7?'#ffaa00':'#4dff91';
    ctx.fillRect(cp.x+1, barY, (cw_-2)*pct, barH);
  }

  // Border
  ctx.strokeStyle = isSel ? COLORS.selection : (item.color ? lighten(item.color) : def.border);
  ctx.lineWidth   = isSel ? 2 : 1;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(cp.x, cp.y, cw_, cd_, 3) : ctx.rect(cp.x, cp.y, cw_, cd_);
  ctx.stroke();

  // Label
  if (cw_>18 && cd_>12) {
    ctx.fillStyle = def.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.save();
    ctx.beginPath();
    ctx.rect(cp.x+2, cp.y+2, cw_-4, cd_-4);
    ctx.clip();
    const fontSize = Math.max(8, Math.min(13, cw_*0.18, cd_*0.5));
    ctx.font = `600 ${fontSize}px "DM Mono",monospace`;
    const shortLabel = item.label.length>20 ? item.label.substring(0,18)+'…' : item.label;
    ctx.fillText(shortLabel, cp.x+cw_/2, cp.y+cd_/2);
    if (cd_>30 && _scale>25) {
      ctx.font = `${Math.max(7,fontSize*0.75)}px "DM Mono",monospace`;
      ctx.fillStyle = def.text;
      ctx.globalAlpha = 0.6;
      ctx.fillText(`${item.w.toFixed(1)}×${item.d.toFixed(1)}×${item.h.toFixed(1)}m`, cp.x+cw_/2, cp.y+cd_/2+fontSize+2);
      if (cap>0) {
        ctx.fillText(`${occ}/${cap}`, cp.x+cw_/2, cp.y+cd_/2+fontSize*2+4);
      }
    }
    ctx.restore();
  }

  // Resize handles
  if (isSel) {
    const handles = [
      [cp.x+cw_, cp.y], [cp.x+cw_, cp.y+cd_], [cp.x, cp.y+cd_], [cp.x, cp.y],
      [cp.x+cw_, cp.y+cd_/2], [cp.x+cw_/2, cp.y+cd_], [cp.x, cp.y+cd_/2], [cp.x+cw_/2, cp.y],
    ];
    handles.forEach(([hx,hy]) => {
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.arc(hx,hy,5,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = COLORS.handle;
      ctx.beginPath(); ctx.arc(hx,hy,4,0,Math.PI*2); ctx.fill();
    });
  }

  ctx.restore();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function drawMarquee(ctx) {
  const m = _marquee;
  const x = Math.min(m.x0,m.x1)*_scale+_pan.x, y = Math.min(m.y0,m.y1)*_scale+_pan.y;
  const w = Math.abs(m.x1-m.x0)*_scale, h = Math.abs(m.y1-m.y0)*_scale;
  ctx.fillStyle = 'rgba(232,255,71,0.08)';
  ctx.fillRect(x,y,w,h);
  ctx.strokeStyle = COLORS.accent;
  ctx.lineWidth = 1;
  ctx.setLineDash([4,3]);
  ctx.strokeRect(x,y,w,h);
  ctx.setLineDash([]);
}

function drawMeasurements(ctx, W, H) {
  if (_selected.size !== 1) return;
  const item = _items.find(i=>_selected.has(i.id));
  if (!item) return;
  const cp = toCanvas(item.x, item.y);
  const cw_= item.w*_scale, cd_=item.d*_scale;

  ctx.fillStyle = COLORS.accent;
  ctx.font = '10px "DM Mono",monospace';
  ctx.textAlign = 'center';

  // Width
  const wLabel = item.w.toFixed(2)+'m';
  ctx.fillText(wLabel, cp.x+cw_/2, cp.y-5);
  drawArrow(ctx, cp.x+4, cp.y-4, cp.x+cw_-4, cp.y-4);

  // Depth
  const dLabel = item.d.toFixed(2)+'m';
  ctx.save();
  ctx.translate(cp.x+cw_+14, cp.y+cd_/2);
  ctx.rotate(Math.PI/2);
  ctx.fillText(dLabel, 0, 0);
  ctx.restore();
  drawArrow(ctx, cp.x+cw_+4, cp.y+4, cp.x+cw_+4, cp.y+cd_-4);

  ctx.textAlign = 'left';
}

function drawArrow(ctx, x1, y1, x2, y2) {
  const len = Math.hypot(x2-x1, y2-y1);
  if (len < 6) return;
  const angle = Math.atan2(y2-y1, x2-x1);
  const as = 5;
  ctx.strokeStyle = COLORS.accent;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x1,y1); ctx.lineTo(x2,y2);
  ctx.moveTo(x2,y2);
  ctx.lineTo(x2-as*Math.cos(angle-0.5), y2-as*Math.sin(angle-0.5));
  ctx.moveTo(x2,y2);
  ctx.lineTo(x2-as*Math.cos(angle+0.5), y2-as*Math.sin(angle+0.5));
  ctx.moveTo(x1,y1);
  ctx.lineTo(x1+as*Math.cos(angle-0.5+Math.PI), y1+as*Math.sin(angle-0.5+Math.PI));
  ctx.moveTo(x1,y1);
  ctx.lineTo(x1+as*Math.cos(angle+0.5+Math.PI), y1+as*Math.sin(angle+0.5+Math.PI));
  ctx.stroke();
}

function drawHUD(ctx, W, H) {
  // Scale bar
  const barM   = Math.pow(2, Math.round(Math.log2(4/_scale*_scale/1)));
  const barPx  = barM*_scale;
  const bx=16, by=H-18;
  ctx.fillStyle = COLORS.accent;
  ctx.fillRect(bx, by-3, barPx, 3);
  ctx.fillRect(bx, by-8, 2, 8);
  ctx.fillRect(bx+barPx-2, by-8, 2, 8);
  ctx.font = '10px "DM Mono",monospace';
  ctx.fillStyle = COLORS.textMuted;
  ctx.fillText(barM+'m', bx+barPx+5, by);

  // Zoom level
  ctx.fillStyle = COLORS.textMuted;
  ctx.font = '10px "DM Mono",monospace';
  ctx.fillText(Math.round(_scale*5)+'%  |  '+_items.length+' items', W-110, H-8);

  // Mode indicator
  if (_mode !== 'select') {
    ctx.fillStyle = COLORS.accent;
    ctx.font = 'bold 11px "DM Mono",monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Click to place '+_mode.replace('add-','').toUpperCase()+' — Esc to cancel', W/2, H-10);
    ctx.textAlign = 'left';
  }

  // Dirty indicator
  if (_dirty) {
    ctx.fillStyle = '#ffaa00';
    ctx.font = '10px "DM Mono",monospace';
    ctx.fillText('● unsaved', 16, H-32);
  }
}

function lighten(hex) {
  try {
    const r = parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
    return `rgba(${Math.min(255,r+60)},${Math.min(255,g+60)},${Math.min(255,b+60)},0.9)`;
  } catch(e) { return hex; }
}

// ── Events ────────────────────────────────────────────────────────────────────
function attachEvents() {
  _canvas.addEventListener('mousedown',   onDown);
  _canvas.addEventListener('mousemove',   onMove);
  _canvas.addEventListener('mouseup',     onUp);
  _canvas.addEventListener('dblclick',    onDbl);
  _canvas.addEventListener('wheel',       onWheel, { passive:false });
  _canvas.addEventListener('contextmenu', onCtx);
  _canvas.addEventListener('touchstart',  onTouchStart, { passive:false });
  _canvas.addEventListener('touchmove',   onTouchMove,  { passive:false });
  _canvas.addEventListener('touchend',    onTouchEnd);
  document.addEventListener('keydown',    onKey);
}

function rect_(e) { return _canvas.getBoundingClientRect(); }
function pos(e) {
  const r = rect_(e);
  return { cx: e.clientX-r.left, cy: e.clientY-r.top };
}

function onDown(e) {
  const {cx,cy} = pos(e);
  const w = toWorld(cx,cy);

  // Middle mouse or alt+drag = pan
  if (e.button===1 || (e.button===0&&e.altKey)) {
    _panDrag = { cx, cy, px:_pan.x, py:_pan.y };
    _canvas.style.cursor = 'grabbing';
    return;
  }

  if (_mode !== 'select') {
    placeItem(_mode.replace('add-',''), w);
    return;
  }

  const item = topItemAt(w.x, w.y);

  if (item) {
    const handle = getHandle(item, w.x, w.y);
    if (handle) {
      pushUndo();
      _resize = { id:item.id, handle:handle.id, wx:w.x, wy:w.y,
                  origX:item.x, origY:item.y, origW:item.w, origD:item.d };
      return;
    }

    if (!_selected.has(item.id)) {
      if (!e.shiftKey) _selected.clear();
      _selected.add(item.id);
    }

    pushUndo();
    const origPositions = {};
    _selected.forEach(id => {
      const it = _items.find(i=>i.id===id);
      if (it) origPositions[id] = { x:it.x, y:it.y };
    });
    _drag = { wx:w.x, wy:w.y, origPositions };
  } else {
    if (!e.shiftKey) _selected.clear();
    _marquee = { x0:w.x, y0:w.y, x1:w.x, y1:w.y };
  }

  draw(); updateUI();
}

function onMove(e) {
  const {cx,cy} = pos(e);
  const w = toWorld(cx,cy);

  if (_panDrag) {
    _pan.x = _panDrag.px + (cx-_panDrag.cx);
    _pan.y = _panDrag.py + (cy-_panDrag.cy);
    draw(); return;
  }

  if (_resize) {
    const item = _items.find(i=>i.id===_resize.id);
    if (!item) return;
    const dx = w.x-_resize.wx, dy = w.y-_resize.wy;
    const h  = _resize.handle;
    const min = _grid;
    if (h.includes('r')) { item.w = Math.max(min, snap(_resize.origW+dx)); }
    if (h.includes('b')) { item.d = Math.max(min, snap(_resize.origD+dy)); }
    if (h.includes('l')) { const nw=Math.max(min,snap(_resize.origW-dx)); item.x=_resize.origX+_resize.origW-nw; item.w=nw; }
    if (h.includes('t')) { const nd=Math.max(min,snap(_resize.origD-dy)); item.y=_resize.origY+_resize.origD-nd; item.d=nd; }
    _dirty=true; draw(); updateUI(); return;
  }

  if (_drag) {
    const dx = snap(w.x-_drag.wx), dy = snap(w.y-_drag.wy);
    _selected.forEach(id => {
      const item = _items.find(i=>i.id===id);
      const orig = _drag.origPositions[id];
      if (item && orig) {
        item.x = Math.max(0, Math.min(_floor.w-item.w, orig.x+dx));
        item.y = Math.max(0, Math.min(_floor.d-item.d, orig.y+dy));
      }
    });
    _dirty=true; draw(); updateUI(); return;
  }

  if (_marquee) {
    _marquee.x1 = w.x; _marquee.y1 = w.y;
    // Update selection
    const mx0=Math.min(_marquee.x0,w.x), mx1=Math.max(_marquee.x0,w.x);
    const my0=Math.min(_marquee.y0,w.y), my1=Math.max(_marquee.y0,w.y);
    _selected.clear();
    _items.forEach(i => {
      if (i.x+i.w>mx0 && i.x<mx1 && i.y+i.d>my0 && i.y<my1) _selected.add(i.id);
    });
    draw(); updateUI(); return;
  }

  // Hover
  const item = topItemAt(w.x, w.y);
  const newHov = item ? item.id : null;
  if (newHov !== _hover) { _hover=newHov; draw(); }

  // Cursor
  if (item && _mode==='select') {
    const handle = getHandle(item, w.x, w.y);
    if (handle) {
      const cur = { tr:'nesw-resize', br:'nwse-resize', bl:'nesw-resize', tl:'nwse-resize',
                    r:'ew-resize', l:'ew-resize', t:'ns-resize', b:'ns-resize' };
      _canvas.style.cursor = cur[handle.id]||'pointer';
    } else { _canvas.style.cursor = 'move'; }
  } else if (_mode==='select') {
    _canvas.style.cursor = 'default';
  }
}

function onUp(e) {
  if (_panDrag) { _panDrag=null; _canvas.style.cursor='default'; return; }
  _drag=null; _resize=null; _marquee=null;
  draw(); updateUI();
}

function onDbl(e) {
  const {cx,cy} = pos(e);
  const w = toWorld(cx,cy);
  const item = topItemAt(w.x,w.y);
  if (item) openItemProps(item);
}

function onWheel(e) {
  e.preventDefault();
  const {cx,cy} = pos(e);
  const factor = e.deltaY<0?1.12:0.88;
  const ns = Math.max(8, Math.min(250, _scale*factor));
  _pan.x = cx-(cx-_pan.x)*(ns/_scale);
  _pan.y = cy-(cy-_pan.y)*(ns/_scale);
  _scale = ns;
  draw();
}

function onCtx(e) {
  e.preventDefault();
  const {cx,cy} = pos(e);
  const w = toWorld(cx,cy);
  const item = topItemAt(w.x,w.y);
  if (item) { if (!_selected.has(item.id)) { _selected.clear(); _selected.add(item.id); } draw(); openItemProps(item); }
}

function onKey(e) {
  if (e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
  if (e.key==='Escape')  { setMode('select'); _selected.clear(); draw(); updateUI(); }
  if (e.key==='Delete'||e.key==='Backspace') { deleteSelected(); }
  if (e.key==='z'&&(e.ctrlKey||e.metaKey)&&!e.shiftKey) { undo(); }
  if (e.key==='z'&&(e.ctrlKey||e.metaKey)&&e.shiftKey)  { redo(); }
  if (e.key==='y'&&(e.ctrlKey||e.metaKey)) { redo(); }
  if (e.key==='a'&&(e.ctrlKey||e.metaKey)) { e.preventDefault(); _selected=new Set(_items.map(i=>i.id)); draw(); updateUI(); }
  if (e.key==='d'&&(e.ctrlKey||e.metaKey)) { e.preventDefault(); duplicateSelected(); }
  if (e.key==='f') { zoomFit(); }
  if (e.key==='g') { _showGrid=!_showGrid; draw(); }
  if (e.key==='m') { _showMeasure=!_showMeasure; draw(); }
  // Arrow nudge
  if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key) && _selected.size>0) {
    e.preventDefault();
    const step = e.shiftKey ? _grid*2 : _grid;
    const dx = e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0;
    const dy = e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0;
    pushUndo();
    _selected.forEach(id => {
      const item=_items.find(i=>i.id===id);
      if (item) { item.x=Math.max(0,Math.min(_floor.w-item.w,item.x+dx)); item.y=Math.max(0,Math.min(_floor.d-item.d,item.y+dy)); }
    });
    _dirty=true; draw(); updateUI();
  }
}

// Touch pinch-zoom
let _lastTouches = [];
function onTouchStart(e) {
  e.preventDefault();
  _lastTouches = Array.from(e.touches);
  if (e.touches.length===1) {
    const t=e.touches[0], r=rect_(e);
    onDown({ button:0, clientX:t.clientX, clientY:t.clientY, altKey:false, shiftKey:false });
  }
}
function onTouchMove(e) {
  e.preventDefault();
  if (e.touches.length===2 && _lastTouches.length===2) {
    const d0=Math.hypot(_lastTouches[0].clientX-_lastTouches[1].clientX, _lastTouches[0].clientY-_lastTouches[1].clientY);
    const d1=Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY);
    const cx=(e.touches[0].clientX+e.touches[1].clientX)/2 - rect_(e).left;
    const cy=(e.touches[0].clientY+e.touches[1].clientY)/2 - rect_(e).top;
    const f=d1/d0, ns=Math.max(8,Math.min(250,_scale*f));
    _pan.x=cx-(cx-_pan.x)*(ns/_scale); _pan.y=cy-(cy-_pan.y)*(ns/_scale); _scale=ns;
    draw();
  } else if (e.touches.length===1) {
    const t=e.touches[0];
    onMove({ clientX:t.clientX, clientY:t.clientY });
  }
  _lastTouches = Array.from(e.touches);
}
function onTouchEnd(e) { onUp({}); }

// ── Place item ────────────────────────────────────────────────────────────────
function placeItem(type, w) {
  const def = ITEM_DEFS[type]||ITEM_DEFS.rack;
  const item = {
    id:       'new-'+Date.now(),
    locationId: null, type,
    label:    autoLabel(type),
    zone:'', bay:'', desc:'', capacity: type==='rack'?20:0, shelves:4,
    x: Math.max(0,Math.min(_floor.w-def.defaultW, snap(w.x-def.defaultW/2))),
    y: Math.max(0,Math.min(_floor.d-def.defaultD, snap(w.y-def.defaultD/2))),
    w:def.defaultW, d:def.defaultD, h:def.defaultH,
    color:null, rotation:0,
  };
  pushUndo();
  _items.push(item);
  _selected.clear(); _selected.add(item.id);
  _dirty=true; draw(); updateUI();
  // Auto-open props for zones/racks
  if (type==='zone'||type==='rack') setTimeout(()=>openItemProps(item), 50);
}

function autoLabel(type) {
  const count = _items.filter(i=>i.type===type).length+1;
  const names = { zone:'Zone', rack:'Rack', shelf:'Shelf', desk:'Desk', wall:'Wall', pillar:'Pillar', door:'Door' };
  return (names[type]||type)+' '+count;
}

// ── Item properties modal ─────────────────────────────────────────────────────
function openItemProps(item) {
  const def = ITEM_DEFS[item.type]||ITEM_DEFS.rack;
  const occ = _occ[item.locationId]||0;
  const cap = item.capacity||0;
  openModal('modal-wh-props', `${def.label} — ${esc(item.label)}`, `
    <div class="form-grid">
      <div class="form-group span-2"><label>Name / Label</label>
        <input type="text" id="wp-label" value="${esc(item.label)}"></div>
      <div class="form-group span-2"><label>Description</label>
        <input type="text" id="wp-desc" value="${esc(item.desc)}"></div>
      <div class="form-group"><label>Width (m)</label>
        <input type="number" id="wp-w" value="${item.w.toFixed(2)}" step="0.1" min="0.1" max="50"></div>
      <div class="form-group"><label>Depth (m)</label>
        <input type="number" id="wp-d" value="${item.d.toFixed(2)}" step="0.1" min="0.1" max="50"></div>
      <div class="form-group"><label>Height (m)</label>
        <input type="number" id="wp-h" value="${item.h.toFixed(2)}" step="0.1" min="0.1" max="10"></div>
      ${item.type!=='zone'&&item.type!=='wall'&&item.type!=='door'&&item.type!=='pillar'?`
      <div class="form-group"><label>Shelves / Levels</label>
        <input type="number" id="wp-shelves" value="${item.shelves||4}" min="1" max="20" step="1"></div>
      <div class="form-group span-2"><label>Capacity (items)</label>
        <input type="number" id="wp-cap" value="${cap}" min="0" step="1"></div>
      ${cap>0?`<div class="form-group span-2" style="font-size:12px;color:var(--text2)">
        Currently: ${occ}/${cap} items (${Math.round(occ/cap*100)}% full)</div>`:''}
      `:''}
      <div class="form-group"><label>Colour</label>
        <div style="display:flex;gap:8px;align-items:center">
          <input type="color" id="wp-color" value="${item.color||def.border}"
            style="width:48px;height:36px;padding:2px;border-radius:4px;cursor:pointer">
          <button class="btn btn-ghost btn-sm" onclick="document.getElementById('wp-color').value='${def.border}'">Reset</button>
        </div>
      </div>
      <div class="form-group"><label>X Position (m)</label>
        <input type="number" id="wp-x" value="${item.x.toFixed(2)}" step="${_grid}"></div>
      <div class="form-group"><label>Y Position (m)</label>
        <input type="number" id="wp-y" value="${item.y.toFixed(2)}" step="${_grid}"></div>
    </div>`, `
    <button class="btn btn-danger btn-sm" onclick="window.__whDeleteItem()">✕ Delete</button>
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="window.__whApplyProps('${esc(item.id)}')">Apply</button>`
  );
}

// ── Undo/redo ─────────────────────────────────────────────────────────────────
function pushUndo() {
  _undoStack.push(JSON.stringify(_items));
  if (_undoStack.length>50) _undoStack.shift();
  _redoStack = [];
}
function undo() {
  if (!_undoStack.length) return;
  _redoStack.push(JSON.stringify(_items));
  _items = JSON.parse(_undoStack.pop());
  _selected.clear(); _dirty=true; draw(); updateUI(); toast('Undo','info');
}
function redo() {
  if (!_redoStack.length) return;
  _undoStack.push(JSON.stringify(_items));
  _items = JSON.parse(_redoStack.pop());
  _selected.clear(); _dirty=true; draw(); updateUI(); toast('Redo','info');
}

// ── Operations ────────────────────────────────────────────────────────────────
function deleteSelected() {
  if (!_selected.size) return;
  if (!confirm(`Delete ${_selected.size} item${_selected.size>1?'s':''}?`)) return;
  pushUndo();
  _items = _items.filter(i=>!_selected.has(i.id));
  _selected.clear(); _dirty=true; draw(); updateUI();
}

function duplicateSelected() {
  if (!_selected.size) return;
  pushUndo();
  const newIds = new Set();
  _selected.forEach(id => {
    const item=_items.find(i=>i.id===id);
    if (item) {
      const copy = {...item, id:'new-'+Date.now()+Math.random(), locationId:null,
                    x:Math.min(_floor.w-item.w, item.x+_grid), y:Math.min(_floor.d-item.d, item.y+_grid)};
      _items.push(copy); newIds.add(copy.id);
    }
  });
  _selected = newIds; _dirty=true; draw(); updateUI();
}

// ── Zoom / pan ────────────────────────────────────────────────────────────────
export function zoomFit() {
  if (!_canvas) return;
  const margin=60, W=cw(), H=ch();
  const sx=(W-margin*2)/_floor.w, sy=(H-margin*2)/_floor.d;
  _scale=Math.min(sx,sy,80);
  _pan.x=margin; _pan.y=margin;
  draw();
}

export function setMode(mode) {
  _mode = mode;
  document.querySelectorAll('.wh-tool-btn').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
  if (_canvas) _canvas.style.cursor = mode==='select'?'default':'crosshair';
}

// ── Sidebar UI ────────────────────────────────────────────────────────────────
function updateUI() {
  updateSidebar();
  updateStats();
}

function updateSidebar() {
  const el = document.getElementById('wh-props-panel');
  if (!el) return;
  if (_selected.size===0) {
    el.innerHTML = `<div style="color:var(--text3);font-size:12px;line-height:1.8">
      Click to select<br>Drag to move<br>Dbl-click to edit<br>Scroll to zoom<br>Alt+drag to pan<br><br>
      <kbd>Del</kbd> delete &nbsp; <kbd>Ctrl+Z</kbd> undo<br>
      <kbd>Ctrl+D</kbd> duplicate &nbsp; <kbd>F</kbd> fit<br>
      <kbd>G</kbd> grid &nbsp; <kbd>M</kbd> measure<br>
      <kbd>Arrows</kbd> nudge item</div>`;
    return;
  }
  if (_selected.size>1) {
    el.innerHTML = `<div style="font-size:13px;font-weight:500;margin-bottom:8px">${_selected.size} items selected</div>
      <button class="btn btn-ghost btn-sm" style="width:100%;margin-bottom:6px" onclick="window.__whDuplicate()">⊕ Duplicate</button>
      <button class="btn btn-danger btn-sm" style="width:100%" onclick="window.__whDeleteSelected()">✕ Delete all</button>`;
    return;
  }
  const item = _items.find(i=>_selected.has(i.id));
  if (!item) return;
  const def = ITEM_DEFS[item.type]||ITEM_DEFS.rack;
  const occ = _occ[item.locationId]||0;
  const cap = item.capacity||0;
  const pct = cap>0?Math.round(occ/cap*100):0;
  const vol = (item.w*item.d*item.h).toFixed(2);
  el.innerHTML = `
    <div style="font-size:10px;color:var(--text3);font-family:var(--mono);margin-bottom:4px">${def.label.toUpperCase()}</div>
    <div style="font-size:14px;font-weight:600;margin-bottom:10px;word-break:break-word">${esc(item.label)}</div>
    <div style="display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:11px;margin-bottom:12px">
      <span style="color:var(--text3)">W</span><span>${item.w.toFixed(2)}m</span>
      <span style="color:var(--text3)">D</span><span>${item.d.toFixed(2)}m</span>
      <span style="color:var(--text3)">H</span><span>${item.h.toFixed(2)}m</span>
      <span style="color:var(--text3)">Vol</span><span>${vol}m³</span>
      <span style="color:var(--text3)">Pos</span><span>${item.x.toFixed(1)}, ${item.y.toFixed(1)}</span>
      ${item.shelves?`<span style="color:var(--text3)">Shelves</span><span>${item.shelves}</span>`:''}
      ${cap>0?`<span style="color:var(--text3)">Stock</span><span style="color:${pct>90?'var(--danger)':pct>70?'var(--warn)':'var(--ok)'}">${occ}/${cap} (${pct}%)</span>`:''}
    </div>
    ${cap>0?`<div style="height:4px;background:var(--surface3);border-radius:2px;margin-bottom:12px">
      <div style="height:100%;width:${pct}%;background:${pct>90?'var(--danger)':pct>70?'var(--warn)':'var(--ok)'};border-radius:2px"></div>
    </div>`:''}
    ${item.desc?`<div style="font-size:11px;color:var(--text2);margin-bottom:10px">${esc(item.desc)}</div>`:''}
    <div style="display:flex;flex-direction:column;gap:5px">
      <button class="btn btn-primary btn-sm" onclick="window.__whEditItem()">✏ Edit</button>
      <button class="btn btn-ghost btn-sm" onclick="window.__whDuplicate()">⊕ Duplicate</button>
      <button class="btn btn-danger btn-sm" onclick="window.__whDeleteSelected()">✕ Delete</button>
    </div>`;
}

function updateStats() {
  const el = document.getElementById('wh-stats');
  if (!el) return;
  const racks  = _items.filter(i=>i.type==='rack'||i.type==='shelf').length;
  const zones  = _items.filter(i=>i.type==='zone').length;
  const totCap = _items.reduce((s,i)=>s+(+i.capacity||0),0);
  const totOcc = _items.reduce((s,i)=>s+(_occ[i.locationId]||0),0);
  el.innerHTML = `
    <div style="font-size:10px;color:var(--text3);margin-bottom:6px">WAREHOUSE STATS</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px">
      <div><div style="color:var(--text3)">Zones</div><div style="font-weight:600">${zones}</div></div>
      <div><div style="color:var(--text3)">Racks</div><div style="font-weight:600">${racks}</div></div>
      <div><div style="color:var(--text3)">Capacity</div><div style="font-weight:600">${totCap}</div></div>
      <div><div style="color:var(--text3)">Stored</div><div style="font-weight:600;color:${totCap>0&&totOcc/totCap>0.8?'var(--warn)':'var(--ok)'}">${totOcc}</div></div>
    </div>`;
}

// ── Save ──────────────────────────────────────────────────────────────────────
export async function saveWarehouseLayout() {
  if (!_dirty) { toast('No changes to save','info'); return; }
  showLoading('Saving…');
  try {
    await rpc('saveWarehouseConfig', { floorW:_floor.w, floorD:_floor.d, gridSize:_grid, name:_floor.name });
    const payload = _items
      .filter(i=>i.type==='zone'||i.type==='rack'||i.type==='shelf')
      .map(i=>({
        locationId:  i.locationId||null,
        locationType:i.type==='zone'?'Zone':'Bay',
        zone:        i.type==='zone'?i.label:(i.zone||i.label),
        bay:         i.type!=='zone'?(i.bay||i.label):'',
        description: i.desc, capacity:+i.capacity||0, active:true,
        layoutX:i.x, layoutY:i.y, layoutW:i.w, layoutD:i.d, layoutH:i.h,
        layoutShelves:+i.shelves||4, layoutColor:i.color||'', layoutRotation:0,
      }));
    const r = await rpc('saveWarehouseLayout', payload);
    // Update locationIds
    if (r.results) r.results.forEach((res,idx)=>{
      if (res.ok&&res.locationId&&payload[idx]) {
        const it = _items.find(i=>(i.zone||i.label)===payload[idx].zone);
        if (it&&!it.locationId) it.locationId=res.locationId;
      }
    });
    _dirty=false; draw();
    toast(`Saved ${r.saved} locations`,'ok');
  } catch(e) { toast(e.message,'err'); }
  finally { hideLoading(); }
}

// ── Floor settings ────────────────────────────────────────────────────────────
export function openFloorSettings() {
  openModal('modal-wh-floor','Floor Settings',`
    <div class="form-grid">
      <div class="form-group span-2"><label>Warehouse Name</label>
        <input type="text" id="wf-name" value="${esc(_floor.name)}"></div>
      <div class="form-group"><label>Width (m)</label>
        <input type="number" id="wf-w" value="${_floor.w}" step="1" min="5" max="500"></div>
      <div class="form-group"><label>Depth (m)</label>
        <input type="number" id="wf-d" value="${_floor.d}" step="1" min="5" max="500"></div>
      <div class="form-group span-2"><label>Grid Snap</label>
        <select id="wf-grid">
          <option value="0.1"${_grid===0.1?' selected':''}>0.1m — very fine</option>
          <option value="0.25"${_grid===0.25?' selected':''}>0.25m — fine</option>
          <option value="0.5"${_grid===0.5?' selected':''}>0.5m — default</option>
          <option value="1"${_grid===1?' selected':''}>1m — coarse</option>
        </select>
      </div>
    </div>`,`
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="window.__whApplyFloor()">Apply</button>`);
}

// ── Globals ───────────────────────────────────────────────────────────────────
export function exposeWarehouseGlobals() {
  window.__whSetMode       = setMode;
  window.__whZoomFit       = zoomFit;
  window.__whZoomIn        = () => { const c=toWorld(cw()/2,ch()/2); _scale=Math.min(250,_scale*1.2); _pan.x=cw()/2-c.x*_scale; _pan.y=ch()/2-c.y*_scale; draw(); };
  window.__whZoomOut       = () => { const c=toWorld(cw()/2,ch()/2); _scale=Math.max(8,_scale/1.2); _pan.x=cw()/2-c.x*_scale; _pan.y=ch()/2-c.y*_scale; draw(); };
  window.__whFloorSettings = openFloorSettings;
  window.__whSave          = saveWarehouseLayout;
  window.__whToggleGrid    = () => { _showGrid=!_showGrid; draw(); };
  window.__whToggleMeasure = () => { _showMeasure=!_showMeasure; draw(); };
  window.__whUndo          = undo;
  window.__whRedo          = redo;
  window.__whEditItem      = () => { const item=_items.find(i=>_selected.has(i.id)); if(item) openItemProps(item); };
  window.__whDeleteItem    = () => { closeModal(); deleteSelected(); };
  window.__whDeleteSelected= deleteSelected;
  window.__whDuplicate     = duplicateSelected;
  window.__whApplyProps    = (id) => {
    const item=_items.find(i=>i.id===id);
    if (!item) return;
    item.label   = document.getElementById('wp-label')?.value||item.label;
    item.desc    = document.getElementById('wp-desc')?.value||'';
    item.w       = parseFloat(document.getElementById('wp-w')?.value)||item.w;
    item.d       = parseFloat(document.getElementById('wp-d')?.value)||item.d;
    item.h       = parseFloat(document.getElementById('wp-h')?.value)||item.h;
    item.shelves = parseInt(document.getElementById('wp-shelves')?.value)||item.shelves;
    item.capacity= parseInt(document.getElementById('wp-cap')?.value)||0;
    item.color   = document.getElementById('wp-color')?.value||null;
    item.x       = parseFloat(document.getElementById('wp-x')?.value)??item.x;
    item.y       = parseFloat(document.getElementById('wp-y')?.value)??item.y;
    _dirty=true; closeModal(); draw(); updateUI();
  };
  window.__whApplyFloor = () => {
    _floor.name = document.getElementById('wf-name')?.value||_floor.name;
    _floor.w    = parseFloat(document.getElementById('wf-w')?.value)||_floor.w;
    _floor.d    = parseFloat(document.getElementById('wf-d')?.value)||_floor.d;
    _grid       = parseFloat(document.getElementById('wf-grid')?.value)||_grid;
    _dirty=true; closeModal(); draw();
  };
}