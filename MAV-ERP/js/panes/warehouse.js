/**
 * MAV HIRE ERP — warehouse.js  v4.0
 * Dual-view warehouse designer:
 *   • 3D — Three.js immersive scene with click-to-select raycasting
 *   • 2D — Canvas floor plan with drag-to-move, click-to-select, grid snap
 * Plus: properties panel, barcode lookup, occupancy details
 */
import { rpc }   from '../api/gas.js';
import { STATE } from '../utils/state.js';
import { showLoading, hideLoading, toast, emptyState } from '../utils/dom.js';
import { esc, fmtCurDec } from '../utils/format.js';
import { openModal, closeModal } from '../components/modal.js';

// ── Module state ──────────────────────────────────────────────────────────────
let _floor    = { w:20, d:15, h:6, name:'Main Warehouse' };
let _grid     = 0.5;
let _items    = [];
let _occ      = {};
let _contents = {}; // locationId → array of barcodes
let _dirty    = false;
let _selected = null;
let _animFrame= null;
let _view     = '3d';   // '3d' | '2d' | 'list'
let _three    = null;
let _2d       = null;   // { canvas, ctx, scale, pan }

// ── Load ──────────────────────────────────────────────────────────────────────
export async function loadWarehouseDesigner() {
  exposeWarehouseGlobals();
  showLoading('Loading warehouse…');
  try {
    const [locs, cfg, occ] = await Promise.all([
      rpc('getWarehouseLocations', {}),
      rpc('getWarehouseConfig'),
      rpc('getLocationOccupancy').catch(() => []),
    ]);
    _floor = { w:+cfg.floorW||20, d:+cfg.floorD||15, h:+cfg.floorH||6, name:cfg.name||'Main Warehouse' };
    _grid  = +cfg.gridSize||0.5;
    _occ   = {};
    (occ||[]).forEach(o => _occ[o.locationId] = +o.itemCount||0);
    _items = (locs||[]).filter(l => +l.layoutW > 0).map(mapLocation);
    hideLoading();
    updateStats();
    if (_view === '3d') setTimeout(() => init3D(), 80);
    else if (_view === '2d') setTimeout(() => init2D(), 80);
  } catch(e) { hideLoading(); toast(e.message, 'err'); }
}

function mapLocation(l) {
  return {
    id:         l.locationId,
    locationId: l.locationId,
    fullPath:   l.fullPath || l.locationId,
    type:       l.locationType === 'Zone' ? 'zone' : (l.layoutD < 0.25 ? 'wall' : 'rack'),
    label:      l.name || l.fullPath || l.locationId,
    desc:       l.description || '',
    capacity:   +l.capacity || 0,
    shelves:    +l.layoutShelves || 4,
    x: +l.layoutX || 0,   y: +l.layoutY || 0,
    w: +l.layoutW || 1,   d: +l.layoutD || 1,  h: +l.layoutH || 2.4,
    color: l.layoutColor || null,
    rot: 0,
  };
}

// ── Stats panel ───────────────────────────────────────────────────────────────
function updateStats() {
  const el = document.getElementById('wh-stats');
  if (!el) return;
  const racks = _items.filter(i => i.type === 'rack' || i.type === 'shelf');
  const totalCap = racks.reduce((s,i) => s + (i.capacity||0), 0);
  const totalOcc = racks.reduce((s,i) => s + (_occ[i.locationId]||0), 0);
  const pct = totalCap > 0 ? Math.round(totalOcc/totalCap*100) : 0;
  el.innerHTML = `
    <div style="font-family:var(--mono);font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">Stats</div>
    <div style="display:flex;flex-direction:column;gap:5px;font-size:11px">
      <div style="display:flex;justify-content:space-between"><span style="color:var(--text3)">Locations</span><span style="font-family:var(--mono)">${_items.length}</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:var(--text3)">Storage units</span><span style="font-family:var(--mono)">${racks.length}</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:var(--text3)">Capacity</span><span style="font-family:var(--mono)">${totalCap}</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:var(--text3)">Occupied</span><span style="font-family:var(--mono);color:${pct>85?'var(--danger)':pct>60?'var(--warn)':'var(--ok)'}">${totalOcc} (${pct}%)</span></div>
    </div>
    <div style="margin-top:8px;height:4px;background:var(--surface3);border-radius:2px;overflow:hidden">
      <div style="height:100%;width:${pct}%;background:${pct>85?'var(--danger)':pct>60?'var(--warn)':'var(--ok)'};border-radius:2px;transition:width .4s ease"></div>
    </div>`;
}

// ── Properties panel ──────────────────────────────────────────────────────────
function showProperties(item) {
  _selected = item ? item.id : null;
  const el = document.getElementById('wh-props-panel');
  if (!el) return;

  if (!item) {
    el.innerHTML = `
      <div style="color:var(--text3);font-size:11px;line-height:2">
        <strong style="color:var(--text2)">Navigate (3D)</strong><br>
        Drag — rotate<br>Right-drag — pan<br>Scroll — zoom<br><br>
        <strong style="color:var(--text2)">Navigate (2D)</strong><br>
        Click — select<br>Drag item — move<br>Scroll — zoom<br><br>
        <strong style="color:var(--text2)">Add items</strong><br>
        Use + buttons in toolbar
      </div>`;
    return;
  }

  const occ = _occ[item.locationId] || 0;
  const cap = item.capacity || 0;
  const pct = cap > 0 ? Math.round(occ/cap*100) : 0;

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div style="font-family:var(--head);font-size:14px;font-weight:800;color:var(--text)">${esc(item.label)}</div>
      <button class="btn btn-danger btn-sm" onclick="window.__whDeleteSelected()">✕</button>
    </div>
    ${item.desc ? `<div style="font-size:11px;color:var(--text3);margin-bottom:10px">${esc(item.desc)}</div>` : ''}

    <div style="display:flex;flex-direction:column;gap:4px;font-size:11px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between">
        <span style="color:var(--text3)">Type</span>
        <span style="font-family:var(--mono)">${item.type}</span>
      </div>
      <div style="display:flex;justify-content:space-between">
        <span style="color:var(--text3)">Position</span>
        <span style="font-family:var(--mono)">${item.x.toFixed(1)}m, ${item.y.toFixed(1)}m</span>
      </div>
      <div style="display:flex;justify-content:space-between">
        <span style="color:var(--text3)">Size</span>
        <span style="font-family:var(--mono)">${item.w.toFixed(1)}×${item.d.toFixed(1)}×${item.h.toFixed(1)}m</span>
      </div>
      ${cap > 0 ? `
      <div style="display:flex;justify-content:space-between">
        <span style="color:var(--text3)">Occupancy</span>
        <span style="font-family:var(--mono);color:${pct>85?'var(--danger)':pct>60?'var(--warn)':'var(--ok)'}">${occ}/${cap} (${pct}%)</span>
      </div>
      <div style="height:3px;background:var(--surface3);border-radius:2px;overflow:hidden;margin-top:2px">
        <div style="height:100%;width:${pct}%;background:${pct>85?'var(--danger)':pct>60?'var(--warn)':'var(--ok)'};border-radius:2px"></div>
      </div>` : ''}
    </div>

    ${cap > 0 ? `
    <button class="btn btn-ghost btn-sm" style="width:100%;margin-bottom:8px;font-size:11px"
      onclick="window.__whViewContents('${esc(item.locationId)}','${esc(item.label)}')">
      📦 View Contents
    </button>` : ''}

    <button class="btn btn-ghost btn-sm" style="width:100%;font-size:11px"
      onclick="window.__whEditItem('${esc(item.id)}')">
      ✏ Edit Properties
    </button>`;
}

// ── View contents modal ───────────────────────────────────────────────────────
async function viewLocationContents(locationId, label) {
  showLoading('Loading contents…');
  try {
    const items = await rpc('getBarcodesByLocation', locationId);
    hideLoading();
    const rows = (items || []);
    openModal('modal-wh-contents', `📦 ${esc(label)}`, `
      ${rows.length === 0 ? emptyState('◌', 'No items assigned to this location') : `
      <div style="font-size:11px;color:var(--text3);margin-bottom:10px;font-family:var(--mono)">${rows.length} item${rows.length!==1?'s':''} in this location</div>
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>Barcode</th><th>Product</th><th>Serial</th><th>Condition</th></tr></thead>
          <tbody>
            ${rows.map(b => `<tr>
              <td class="td-id">${esc(b.barcode)}</td>
              <td class="td-name">${esc(b.productName||b.productId)}</td>
              <td class="td-id">${esc(b.serialNumber||'—')}</td>
              <td>${b.condition||'—'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`}`, `
      <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Close</button>
    `);
  } catch(e) { hideLoading(); toast(e.message, 'err'); }
}

// ── Barcode lookup ────────────────────────────────────────────────────────────
async function lookupBarcodeLocation(barcode) {
  if (!barcode) return;
  showLoading('Looking up barcode…');
  try {
    const result = await rpc('findProductByBarcode', barcode);
    hideLoading();
    if (!result) { toast('Barcode not found: ' + barcode, 'warn'); return; }

    const loc = result.currentLocation || '—';
    // Highlight the location in the scene if found
    if (result.locationId) {
      const item = _items.find(i => i.locationId === result.locationId);
      if (item) {
        showProperties(item);
        if (_view === '2d' && _2d) draw2D();
        if (_view === '3d' && _three) highlightItem3D(result.locationId);
        _selected = item.id;
      }
    }

    toast(`${barcode}: ${esc(result.productName||'Unknown')} → ${loc}`, 'ok');
  } catch(e) { hideLoading(); toast(e.message, 'err'); }
}

function highlightItem3D(locationId) {
  if (!_three) return;
  // Flash the matched meshes
  _three.scene.traverse(obj => {
    if (obj.userData.locationId === locationId && obj.material) {
      const orig = obj.material.emissive ? obj.material.emissive.getHex() : 0;
      obj.material.emissive = new _three.THREE.Color(0xc8ff00);
      obj.material.emissiveIntensity = 0.8;
      setTimeout(() => {
        if (obj.material) { obj.material.emissiveIntensity = 0; }
      }, 2000);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3D VIEW — Three.js scene with raycasting
// ═══════════════════════════════════════════════════════════════════════════════
function init3D() {
  const wrap = document.getElementById('warehouse-canvas-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';

  if (window.THREE) { build3DScene(wrap); return; }
  const script = document.createElement('script');
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  script.onload  = () => build3DScene(wrap);
  script.onerror = () => { toast('3D engine unavailable — switching to Floor Plan', 'warn'); switchView('2d'); };
  document.head.appendChild(script);
}

function build3DScene(wrap) {
  if (!window.THREE) { switchView('2d'); return; }
  const THREE = window.THREE;

  // Measure after layout has settled — offsetWidth can be 0 if measured too early
  const measure = () => {
    const W = wrap.offsetWidth  || wrap.parentElement?.offsetWidth  || 900;
    const H = wrap.offsetHeight || wrap.parentElement?.offsetHeight || 600;
    return { W: W || 900, H: H || 600 };
  };

  // If the container has no size yet, defer one frame
  if (!wrap.offsetWidth || !wrap.offsetHeight) {
    requestAnimationFrame(() => build3DScene(wrap));
    return;
  }

  const { W, H } = measure();

  const renderer = new THREE.WebGLRenderer({ antialias:true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(W, H);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x080810);
  // Force canvas to fill wrap — prevents partial render
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;';
  wrap.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(45, W/H, 0.1, 500);
  const cx = _floor.w/2, cz = _floor.d/2;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x080810, 0.018);

  // Lighting
  scene.add(new THREE.AmbientLight(0x334466, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(cx + _floor.w, _floor.h * 2, cz - _floor.d);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -_floor.w * 1.5; sun.shadow.camera.right  = _floor.w * 1.5;
  sun.shadow.camera.top  = _floor.d * 1.5;  sun.shadow.camera.bottom = -_floor.d * 1.5;
  sun.shadow.camera.far  = 200;
  scene.add(sun);

  // Coloured fill lights
  const fa = new THREE.PointLight(0x4488ff, 0.35, 60); fa.position.set(0, _floor.h, 0); scene.add(fa);
  const fb = new THREE.PointLight(0xff6644, 0.2,  40); fb.position.set(_floor.w, _floor.h*0.5, _floor.d); scene.add(fb);

  // Ceiling strip lights
  const stripMat = new THREE.MeshBasicMaterial({ color: 0xffffee });
  for (let i = 2; i < _floor.w; i += 4) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, _floor.d * 0.7), stripMat);
    strip.position.set(i, _floor.h - 0.05, _floor.d / 2);
    scene.add(strip);
    const sl = new THREE.PointLight(0xffffcc, 0.5, 10);
    sl.position.set(i, _floor.h - 0.3, _floor.d / 2);
    scene.add(sl);
  }

  // Floor
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x181822, roughness:0.9, metalness:0.05 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(_floor.w, _floor.d), floorMat);
  floor.rotation.x = -Math.PI/2;
  floor.position.set(cx, 0, cz);
  floor.receiveShadow = true;
  scene.add(floor);

  // Safety border lines (yellow)
  const yMat = new THREE.LineBasicMaterial({ color: 0xe8ff47 });
  const bx = 0, bz = 0, bw = _floor.w, bd = _floor.d;
  addLine3D(scene, THREE, yMat, bx,0.01,bz, bx+bw,0.01,bz);
  addLine3D(scene, THREE, yMat, bx+bw,0.01,bz, bx+bw,0.01,bz+bd);
  addLine3D(scene, THREE, yMat, bx+bw,0.01,bz+bd, bx,0.01,bz+bd);
  addLine3D(scene, THREE, yMat, bx,0.01,bz+bd, bx,0.01,bz);

  // Grid
  const gMat = new THREE.LineBasicMaterial({ color: 0x1a1a2a, transparent:true, opacity:0.7 });
  for (let x = _grid; x < _floor.w; x += _grid) addLine3D(scene, THREE, gMat, x,0.005,0, x,0.005,_floor.d);
  for (let z = _grid; z < _floor.d; z += _grid) addLine3D(scene, THREE, gMat, 0,0.005,z, _floor.w,0.005,z);

  // Walls/ceiling (BackSide box)
  const wallMat = new THREE.MeshStandardMaterial({ color:0x1a1a26, roughness:0.85, side:THREE.BackSide });
  const room = new THREE.Mesh(new THREE.BoxGeometry(_floor.w+0.2, _floor.h, _floor.d+0.2), wallMat);
  room.position.set(cx, _floor.h/2, cz);
  scene.add(room);

  // Ceiling beams
  const beamMat = new THREE.MeshBasicMaterial({ color: 0x222232 });
  for (let x = 0; x <= _floor.w; x += 4) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, _floor.d), beamMat);
    beam.position.set(x, _floor.h - 0.06, _floor.d/2);
    scene.add(beam);
  }

  // Pickable meshes for raycasting
  const pickables = [];

  // Items
  _items.forEach(item => {
    const meshes = buildItem3D(scene, THREE, item);
    meshes.forEach(m => {
      m.userData.locationId = item.locationId;
      m.userData.itemId     = item.id;
      m.userData.itemRef    = item;
      pickables.push(m);
    });
  });

  // Camera orbit
  let isDragging = false, isPanning = false, prevMX = 0, prevMY = 0;
  let phi = 0.75, theta = Math.PI/4;
  let radius = Math.hypot(_floor.w, _floor.d) * 1.4;
  let target = new THREE.Vector3(cx, 0, cz);

  function updateCamera() {
    camera.position.set(
      target.x + radius * Math.sin(phi) * Math.sin(theta),
      target.y + radius * Math.cos(phi),
      target.z + radius * Math.sin(phi) * Math.cos(theta)
    );
    camera.lookAt(target);
  }
  updateCamera();

  // Raycaster for click-to-select
  const raycaster = new THREE.Raycaster();
  const mouse     = new THREE.Vector2();
  let mouseDownX  = 0, mouseDownY = 0;

  renderer.domElement.addEventListener('mousedown', e => {
    mouseDownX = e.clientX; mouseDownY = e.clientY;
    if (e.button === 2) isPanning = true;
    else isDragging = true;
    prevMX = e.clientX; prevMY = e.clientY;
  });

  renderer.domElement.addEventListener('mousemove', e => {
    const dx = (e.clientX - prevMX) * 0.007;
    const dy = (e.clientY - prevMY) * 0.007;
    if (isDragging) {
      theta -= dx;
      phi = Math.max(0.08, Math.min(Math.PI/2 - 0.05, phi + dy));
      updateCamera();
    }
    if (isPanning) {
      const right = new THREE.Vector3();
      right.crossVectors(camera.getWorldDirection(new THREE.Vector3()), camera.up).normalize();
      target.addScaledVector(right, -dx * radius * 0.5);
      target.y += dy * radius * 0.25;
      updateCamera();
    }
    prevMX = e.clientX; prevMY = e.clientY;
  });

  renderer.domElement.addEventListener('mouseup', e => {
    // Only register as click if mouse didn't move much
    const moved = Math.abs(e.clientX - mouseDownX) + Math.abs(e.clientY - mouseDownY);
    isDragging = isPanning = false;
    if (moved < 5 && e.button === 0) {
      // Raycast pick
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(pickables);
      if (hits.length > 0) {
        const hit   = hits[0].object;
        const item  = hit.userData.itemRef;
        if (item) {
          _selected = item.id;
          showProperties(item);
          // Flash the hit object
          if (hit.material && hit.material.emissive) {
            hit.material.emissive.setHex(0xc8ff00);
            hit.material.emissiveIntensity = 0.6;
            setTimeout(() => { if (hit.material) hit.material.emissiveIntensity = 0; }, 1200);
          }
        }
      } else {
        _selected = null;
        showProperties(null);
      }
    }
  });

  renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
  renderer.domElement.addEventListener('wheel', e => {
    e.preventDefault();
    radius = Math.max(2, Math.min(100, radius * (e.deltaY > 0 ? 1.1 : 0.9)));
    updateCamera();
  }, { passive: false });

  // Touch
  let lastPinch = 0;
  renderer.domElement.addEventListener('touchstart', e => {
    e.preventDefault();
    if (e.touches.length === 1) { isDragging=true; prevMX=e.touches[0].clientX; prevMY=e.touches[0].clientY; mouseDownX=prevMX; mouseDownY=prevMY; }
    if (e.touches.length === 2) { isDragging=false; lastPinch=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY); }
  }, { passive:false });
  renderer.domElement.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length===1 && isDragging) {
      const dx=(e.touches[0].clientX-prevMX)*0.009, dy=(e.touches[0].clientY-prevMY)*0.009;
      theta-=dx; phi=Math.max(0.08,Math.min(Math.PI/2-0.05,phi+dy)); updateCamera();
      prevMX=e.touches[0].clientX; prevMY=e.touches[0].clientY;
    }
    if (e.touches.length===2) {
      const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
      radius=Math.max(2,Math.min(100,radius*(lastPinch/d))); lastPinch=d; updateCamera();
    }
  }, { passive:false });
  renderer.domElement.addEventListener('touchend', () => { isDragging=false; });

  // Resize
  new ResizeObserver(() => {
    const nw=wrap.offsetWidth, nh=wrap.offsetHeight;
    if (!nw||!nh) return;
    camera.aspect=nw/nh; camera.updateProjectionMatrix(); renderer.setSize(nw,nh);
  }).observe(wrap);

  // Animate
  let tick = 0;
  if (_animFrame) cancelAnimationFrame(_animFrame);
  function animate() {
    _animFrame = requestAnimationFrame(animate);
    tick += 0.016;
    scene.traverse(o => {
      if (o.userData.animType==='box') o.position.y = o.userData.baseY + Math.sin(tick*1.5+o.userData.phase)*0.003;
      if (o.userData.animType==='indicator') o.material.opacity = 0.6 + Math.sin(tick*2+o.userData.phase)*0.35;
    });
    renderer.render(scene, camera);
  }
  animate();

  _three = { renderer, scene, camera, THREE };

  // Camera presets
  window.__whResetView = () => { radius=Math.hypot(_floor.w,_floor.d)*1.4; theta=Math.PI/4; phi=0.75; target.set(_floor.w/2,0,_floor.d/2); updateCamera(); };
  window.__whTopView   = () => { radius=Math.max(_floor.w,_floor.d)*1.3; phi=0.05; theta=Math.PI/4; updateCamera(); };
  window.__whFrontView = () => { radius=_floor.d*2.2; phi=Math.PI/3; theta=Math.PI/2; updateCamera(); };
}

function addLine3D(scene, THREE, mat, x1,y1,z1,x2,y2,z2) {
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(x1,y1,z1), new THREE.Vector3(x2,y2,z2)
  ]);
  scene.add(new THREE.Line(geo, mat));
}

function buildItem3D(scene, THREE, item) {
  const meshes = [];
  if (item.type === 'zone')  { meshes.push(...buildZone3D(scene,THREE,item)); return meshes; }
  if (item.type === 'wall')  { meshes.push(...buildWall3D(scene,THREE,item)); return meshes; }
  meshes.push(...buildRack3D(scene,THREE,item));
  return meshes;
}

function buildZone3D(scene, THREE, item) {
  const col = item.color ? parseInt(item.color.replace('#',''), 16) : 0x4488ff;
  const mat = new THREE.MeshBasicMaterial({ color:col, transparent:true, opacity:0.06, depthWrite:false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(item.w, item.d), mat);
  mesh.rotation.x = -Math.PI/2;
  mesh.position.set(item.x+item.w/2, 0.01, item.y+item.d/2);
  scene.add(mesh);
  const bMat = new THREE.LineBasicMaterial({ color:col, transparent:true, opacity:0.4 });
  addLine3D(scene,THREE,bMat, item.x,0.02,item.y, item.x+item.w,0.02,item.y);
  addLine3D(scene,THREE,bMat, item.x+item.w,0.02,item.y, item.x+item.w,0.02,item.y+item.d);
  addLine3D(scene,THREE,bMat, item.x+item.w,0.02,item.y+item.d, item.x,0.02,item.y+item.d);
  addLine3D(scene,THREE,bMat, item.x,0.02,item.y+item.d, item.x,0.02,item.y);
  addSprite3D(scene,THREE,item.label,item.x+item.w/2,0.25,item.y+item.d/2,col,0.9);
  return [mesh];
}

function buildWall3D(scene, THREE, item) {
  const mat = new THREE.MeshStandardMaterial({ color:0x2e2e44, roughness:0.8 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(item.w, item.h||3, item.d), mat);
  mesh.position.set(item.x+item.w/2, (item.h||3)/2, item.y+item.d/2);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  return [mesh];
}

function buildRack3D(scene, THREE, item) {
  const meshes = [];
  const col = item.color ? parseInt(item.color.replace('#',''), 16) : 0xe8ff47;
  const occ = _occ[item.locationId] || 0;
  const cap = item.capacity || 0;
  const frameH = item.h;
  const shelves = item.shelves || 4;

  const fMat = new THREE.MeshStandardMaterial({ color:0x777788, roughness:0.4, metalness:0.8 });

  // 4 uprights
  [[item.x+0.03,item.y+0.03],[item.x+item.w-0.03,item.y+0.03],
   [item.x+0.03,item.y+item.d-0.03],[item.x+item.w-0.03,item.y+item.d-0.03]].forEach(([px,pz])=>{
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.05,frameH,0.05), fMat);
    m.position.set(px, frameH/2, pz);
    m.castShadow=true; scene.add(m); meshes.push(m);
  });

  // Shelf boards
  const sMat = new THREE.MeshStandardMaterial({ color:0x555566, roughness:0.6, metalness:0.2 });
  for (let s=0; s<=shelves; s++) {
    const sy = (frameH/shelves)*s;
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(item.w, 0.04, item.d),
      s===0 ? new THREE.MeshStandardMaterial({color:0x3a3a4a}) : sMat);
    shelf.position.set(item.x+item.w/2, sy, item.y+item.d/2);
    shelf.castShadow=shelf.receiveShadow=true;
    scene.add(shelf); meshes.push(shelf);

    // Back brace
    if (s>0) {
      const br = new THREE.Mesh(new THREE.BoxGeometry(item.w*0.88,0.02,0.02), fMat);
      br.position.set(item.x+item.w/2, sy-frameH/shelves*0.5, item.y+0.04);
      scene.add(br);
    }
  }

  // Boxes if occupied
  if (cap>0 && occ>0) {
    const perShelf = Math.ceil(occ/shelves);
    let placed = 0;
    for (let s=0; s<shelves && placed<occ; s++) {
      const sy = (frameH/shelves)*s + frameH/shelves*0.12;
      const rowCount = Math.min(perShelf, occ-placed);
      for (let b=0; b<rowCount; b++) {
        const bw = Math.min((item.w-0.1)/rowCount, 0.38);
        const bh = (frameH/shelves)*0.72;
        const isCase = (placed+b)%3 !== 0;
        const boxGeo = isCase
          ? new THREE.BoxGeometry(bw*0.88, bh*0.28, item.d*0.82)
          : new THREE.BoxGeometry(bw*0.88, bh*0.82, item.d*0.82);
        const colors = [0x3366cc,0xcc6633,0x33aa66,0xaa6633,0x9933cc,0x33aacc,0xcc9933,0x33ccaa];
        const bMat = new THREE.MeshStandardMaterial({
          color: colors[placed%colors.length], roughness:0.65, metalness:0.08
        });
        const box = new THREE.Mesh(boxGeo, bMat);
        const baseY = sy + (isCase ? bh*0.14 : bh*0.41);
        box.position.set(
          item.x + 0.05 + bw*0.5 + b*(item.w-0.1)/rowCount,
          baseY,
          item.y + item.d/2
        );
        box.castShadow = true;
        box.userData = { animType:'box', baseY, phase: s*2.1+b*0.7 };
        scene.add(box); meshes.push(box);
      }
      placed += rowCount;
    }
  }

  // Occupancy indicator LED
  const pct = cap>0?occ/cap:0;
  const ledCol = pct>0.9?0xff2222:pct>0.7?0xff8800:0x00ee88;
  const iMat = new THREE.MeshBasicMaterial({ color:ledCol, transparent:true, opacity:0.95 });
  const ind = new THREE.Mesh(new THREE.SphereGeometry(0.07,8,8), iMat);
  ind.position.set(item.x+item.w/2, frameH+0.18, item.y+item.d/2);
  ind.userData = { animType:'indicator', phase:item.x*0.4+item.y*0.3 };
  scene.add(ind); meshes.push(ind);

  // Glow ring
  const gMat = new THREE.MeshBasicMaterial({ color:ledCol, transparent:true, opacity:0.12, depthWrite:false });
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.28,16), gMat);
  glow.rotation.x = -Math.PI/2;
  glow.position.set(item.x+item.w/2, 0.02, item.y+item.d/2);
  scene.add(glow);

  addSprite3D(scene, THREE, item.label, item.x+item.w/2, frameH+0.45, item.y+item.d/2, col, 0.65);
  return meshes;
}

function addSprite3D(scene, THREE, text, x, y, z, color=0xffffff, scale=1) {
  const canvas = document.createElement('canvas');
  canvas.width=256; canvas.height=64;
  const ctx=canvas.getContext('2d');
  ctx.clearRect(0,0,256,64);
  // Pill background
  ctx.fillStyle='rgba(8,8,16,0.7)';
  ctx.beginPath(); ctx.roundRect(4,12,248,40,8); ctx.fill();
  ctx.font = 'bold 18px monospace';
  ctx.fillStyle='#'+color.toString(16).padStart(6,'0');
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(text.substring(0,24), 128, 32);
  const tex=new THREE.CanvasTexture(canvas);
  const mat=new THREE.SpriteMaterial({ map:tex, transparent:true, depthWrite:false });
  const sp=new THREE.Sprite(mat);
  sp.position.set(x, y, z);
  sp.scale.set(scale*2.2, scale*0.55, 1);
  scene.add(sp);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2D FLOOR PLAN — canvas with drag-to-move and click-to-select
// ═══════════════════════════════════════════════════════════════════════════════
function init2D() {
  const wrap = document.getElementById('warehouse-canvas-wrap');
  if (!wrap) return;
  if (_animFrame) { cancelAnimationFrame(_animFrame); _animFrame=null; }
  wrap.innerHTML = '';

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:100%;display:block;cursor:crosshair';
  wrap.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  let scale = Math.min(
    (wrap.offsetWidth  - 80) / _floor.w,
    (wrap.offsetHeight - 60) / _floor.d
  );
  scale = Math.max(10, Math.min(80, scale));
  let panX = 40, panY = 30;

  // Dragging state
  let dragging     = null;  // item being dragged
  let dragOffX     = 0, dragOffY = 0;
  let isPanDrag    = false;
  let lastPanX     = 0, lastPanY = 0;

  _2d = { canvas, ctx, get scale(){return scale;}, set scale(v){scale=v;}, get panX(){return panX;} };

  function worldToScreen(wx, wy) { return [panX + wx*scale, panY + wy*scale]; }
  function screenToWorld(sx, sy) { return [(sx-panX)/scale, (sy-panY)/scale]; }
  function snap(v) { return Math.round(v/_grid)*_grid; }

  function draw2D() {
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0,0,W,H);

    // Dark background
    ctx.fillStyle = '#080810';
    ctx.fillRect(0,0,W,H);

    // Grid
    ctx.strokeStyle = '#1a1a2a'; ctx.lineWidth=0.5;
    for (let x=0; x<=_floor.w; x+=_grid) {
      const [sx]=worldToScreen(x,0), [,sy2]=worldToScreen(x,_floor.d);
      ctx.beginPath(); ctx.moveTo(sx,panY); ctx.lineTo(sx,panY+_floor.d*scale); ctx.stroke();
    }
    for (let y=0; y<=_floor.d; y+=_grid) {
      const [,sy]=worldToScreen(0,y);
      ctx.beginPath(); ctx.moveTo(panX,sy); ctx.lineTo(panX+_floor.w*scale,sy); ctx.stroke();
    }

    // Floor rect
    ctx.strokeStyle='#e8ff47'; ctx.lineWidth=2;
    ctx.strokeRect(panX, panY, _floor.w*scale, _floor.d*scale);

    // Dimension labels
    ctx.fillStyle='#e8ff4788'; ctx.font=`${Math.max(10,scale*0.45)}px "DM Mono",monospace`;
    ctx.textAlign='center'; ctx.textBaseline='bottom';
    ctx.fillText(`${_floor.w}m`, panX+_floor.w*scale/2, panY-4);
    ctx.textAlign='right'; ctx.textBaseline='middle';
    ctx.save(); ctx.translate(panX-6, panY+_floor.d*scale/2); ctx.rotate(-Math.PI/2);
    ctx.fillText(`${_floor.d}m`,0,0); ctx.restore();

    // Items
    _items.forEach(item => {
      const [sx,sy]=worldToScreen(item.x, item.y);
      const sw=item.w*scale, sh=item.d*scale;
      const isSelected = _selected===item.id;
      const occ=_occ[item.locationId]||0, cap=item.capacity||0;
      const pct=cap>0?occ/cap:0;

      if (item.type==='zone') {
        const col=item.color||'#4488ff';
        ctx.fillStyle=col+'22'; ctx.fillRect(sx,sy,sw,sh);
        ctx.strokeStyle=col+'aa'; ctx.lineWidth=isSelected?2.5:1.5; ctx.setLineDash([6,4]);
        ctx.strokeRect(sx,sy,sw,sh); ctx.setLineDash([]);
        // Zone label
        ctx.fillStyle=col; ctx.font=`bold ${Math.max(9,Math.min(14,sw/item.label.length*1.2))}px "DM Mono",monospace`;
        ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(item.label.substring(0,18), sx+sw/2, sy+sh/2);
      } else if (item.type==='wall') {
        ctx.fillStyle='#3a3a55';
        ctx.fillRect(sx,sy,Math.max(sw,2),Math.max(sh,2));
        if(isSelected){ctx.strokeStyle='#c8ff00';ctx.lineWidth=2;ctx.strokeRect(sx,sy,sw,sh);}
      } else {
        // Rack/shelf fill — colour by occupancy
        const fillCol = pct>0.9?'#ff222244':pct>0.7?'#ff880044':'#e8ff4722';
        const borderCol = isSelected?'#c8ff00':(item.color||'#e8ff47');

        ctx.fillStyle=fillCol; ctx.fillRect(sx,sy,sw,sh);
        ctx.strokeStyle=borderCol; ctx.lineWidth=isSelected?2.5:1.5;
        ctx.strokeRect(sx,sy,sw,sh);

        // Shelf lines inside
        if (item.shelves && sw>16) {
          ctx.strokeStyle=borderCol+'55'; ctx.lineWidth=0.5;
          const shelfGap=sh/(item.shelves||4);
          for(let s=1;s<(item.shelves||4);s++){
            ctx.beginPath();ctx.moveTo(sx,sy+s*shelfGap);ctx.lineTo(sx+sw,sy+s*shelfGap);ctx.stroke();
          }
        }

        // Occupancy bar at bottom
        if(cap>0) {
          ctx.fillStyle='#ffffff22'; ctx.fillRect(sx+2,sy+sh-5,sw-4,3);
          const barCol=pct>0.9?'#ff2222':pct>0.7?'#ff8800':'#00ee88';
          ctx.fillStyle=barCol; ctx.fillRect(sx+2,sy+sh-5,(sw-4)*pct,3);
        }

        // Label
        if(sw>20 && sh>12) {
          ctx.fillStyle=isSelected?'#c8ff00':'#e8e8f0';
          ctx.font=`${Math.max(8,Math.min(11,sw/6))}px "DM Mono",monospace`;
          ctx.textAlign='center'; ctx.textBaseline='middle';
          const maxChars=Math.floor(sw/6);
          ctx.fillText(item.label.substring(0,maxChars||8), sx+sw/2, sy+sh/2);
        }

        // LED dot (top right)
        const ledCol=pct>0.9?'#ff2222':pct>0.7?'#ff8800':'#00ee88';
        ctx.fillStyle=ledCol;
        ctx.beginPath(); ctx.arc(sx+sw-4,sy+4,3,0,Math.PI*2); ctx.fill();
      }

      // Selection ring
      if(isSelected) {
        ctx.strokeStyle='#c8ff00'; ctx.lineWidth=2.5;
        ctx.shadowColor='#c8ff00'; ctx.shadowBlur=8;
        ctx.strokeRect(sx-2,sy-2,sw+4,sh+4);
        ctx.shadowBlur=0;
      }
    });

    // Compass / north indicator
    ctx.fillStyle='#ffffff33'; ctx.font='11px monospace';
    ctx.textAlign='left'; ctx.textBaseline='top';
    ctx.fillText('N ↑', panX+4, panY+4);

    // Scale bar
    const barM=5; // 5 metres
    ctx.fillStyle='#ffffff55'; ctx.fillRect(panX+_floor.w*scale-barM*scale-4,panY+_floor.d*scale+8,barM*scale,4);
    ctx.fillStyle='#ffffff88'; ctx.font='9px monospace'; ctx.textAlign='center';
    ctx.fillText(`${barM}m`, panX+_floor.w*scale-barM*scale/2-4, panY+_floor.d*scale+18);
  }

  // Resize canvas to match container
  function resize() {
    canvas.width  = wrap.offsetWidth  || 800;
    canvas.height = wrap.offsetHeight || 600;
    // Re-fit on resize
    scale = Math.max(10, Math.min(80,
      Math.min((canvas.width-80)/_floor.w, (canvas.height-60)/_floor.d)
    ));
    panX = Math.max(40, (canvas.width  - _floor.w*scale) / 2);
    panY = Math.max(30, (canvas.height - _floor.d*scale) / 2);
    draw2D();
  }

  new ResizeObserver(resize).observe(wrap);
  resize();

  // ── Mouse events ─────────────────────────────────────────────────────────────
  let clickStartX=0, clickStartY=0;

  canvas.addEventListener('mousedown', e => {
    clickStartX=e.offsetX; clickStartY=e.offsetY;
    const [wx,wy]=screenToWorld(e.offsetX,e.offsetY);

    if(e.button===1||e.button===2||(e.button===0&&e.altKey)) {
      // Middle/right/alt+left = pan
      isPanDrag=true; lastPanX=e.offsetX; lastPanY=e.offsetY; canvas.style.cursor='grab';
      e.preventDefault(); return;
    }

    // Check if clicking an item
    const hit = findItemAt(wx,wy);
    if(hit) {
      dragging=hit; dragOffX=wx-hit.x; dragOffY=wy-hit.y;
      _selected=hit.id; showProperties(hit); draw2D();
      canvas.style.cursor='move';
    }
  });

  canvas.addEventListener('mousemove', e => {
    if(isPanDrag) {
      panX+=e.offsetX-lastPanX; panY+=e.offsetY-lastPanY;
      lastPanX=e.offsetX; lastPanY=e.offsetY;
      draw2D(); return;
    }
    if(dragging) {
      const [wx,wy]=screenToWorld(e.offsetX,e.offsetY);
      dragging.x=Math.max(0, Math.min(_floor.w-dragging.w, snap(wx-dragOffX)));
      dragging.y=Math.max(0, Math.min(_floor.d-dragging.d, snap(wy-dragOffY)));
      _dirty=true; draw2D();
      // Update properties panel position live
      const el=document.getElementById('wh-props-panel');
      if(el) {
        const posEl=el.querySelector('.prop-pos');
        if(posEl) posEl.textContent=`${dragging.x.toFixed(1)}m, ${dragging.y.toFixed(1)}m`;
      }
    }
  });

  canvas.addEventListener('mouseup', e => {
    isPanDrag=false; dragging=null; canvas.style.cursor='crosshair';
    const moved=Math.abs(e.offsetX-clickStartX)+Math.abs(e.offsetY-clickStartY);
    if(moved<5&&e.button===0) {
      const [wx,wy]=screenToWorld(e.offsetX,e.offsetY);
      const hit=findItemAt(wx,wy);
      _selected=hit?hit.id:null;
      showProperties(hit||null);
      draw2D();
    }
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const factor=e.deltaY>0?0.88:1.13;
    const oldScale=scale; scale=Math.max(8,Math.min(120,scale*factor));
    // Zoom toward cursor
    panX=e.offsetX-(e.offsetX-panX)*scale/oldScale;
    panY=e.offsetY-(e.offsetY-panY)*scale/oldScale;
    draw2D();
  },{passive:false});

  canvas.addEventListener('contextmenu',e=>e.preventDefault());

  // Touch pan/pinch
  let touches={}, lastTouchPinch=0;
  canvas.addEventListener('touchstart',e=>{
    e.preventDefault();
    Array.from(e.changedTouches).forEach(t=>touches[t.identifier]=t);
    if(Object.keys(touches).length===2) {
      const ts=Object.values(touches);
      lastTouchPinch=Math.hypot(ts[0].clientX-ts[1].clientX,ts[0].clientY-ts[1].clientY);
    }
  },{passive:false});
  canvas.addEventListener('touchmove',e=>{
    e.preventDefault();
    const prevTouches={...touches};
    Array.from(e.changedTouches).forEach(t=>touches[t.identifier]=t);
    const ts=Object.values(touches);
    if(ts.length===1) {
      const prev=prevTouches[ts[0].identifier];
      if(prev){panX+=ts[0].clientX-prev.clientX;panY+=ts[0].clientY-prev.clientY;draw2D();}
    }
    if(ts.length===2) {
      const d=Math.hypot(ts[0].clientX-ts[1].clientX,ts[0].clientY-ts[1].clientY);
      const midX=(ts[0].clientX+ts[1].clientX)/2-canvas.getBoundingClientRect().left;
      const midY=(ts[0].clientY+ts[1].clientY)/2-canvas.getBoundingClientRect().top;
      const factor=d/lastTouchPinch; const oldScale=scale;
      scale=Math.max(8,Math.min(120,scale*factor));
      panX=midX-(midX-panX)*scale/oldScale; panY=midY-(midY-panY)*scale/oldScale;
      lastTouchPinch=d; draw2D();
    }
  },{passive:false});
  canvas.addEventListener('touchend',e=>{
    Array.from(e.changedTouches).forEach(t=>delete touches[t.identifier]);
  });

  // Expose redraw for external updates
  window.__wh2DRedraw = draw2D;
  window.__whFitFloor = () => {
    scale=Math.max(10,Math.min(80,Math.min((canvas.width-80)/_floor.w,(canvas.height-60)/_floor.d)));
    panX=(canvas.width-_floor.w*scale)/2; panY=(canvas.height-_floor.d*scale)/2; draw2D();
  };
}

function findItemAt(wx, wy) {
  // Search in reverse order so top items get picked first
  for(let i=_items.length-1; i>=0; i--) {
    const it=_items[i];
    if(wx>=it.x&&wx<=it.x+it.w&&wy>=it.y&&wy<=it.y+it.d) return it;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// VIEW SWITCHING
// ═══════════════════════════════════════════════════════════════════════════════
function switchView(view) {
  _view=view;
  const wrap=document.getElementById('warehouse-canvas-wrap');
  if(_animFrame){cancelAnimationFrame(_animFrame);_animFrame=null;}
  _three=null; _2d=null;

  // Update toolbar buttons
  document.querySelectorAll('.wh-view-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===view));

  // Show/hide views
  const designer=document.getElementById('wh-designer-view');
  const list=document.getElementById('wh-list-view');
  if(designer) designer.style.display=view==='list'?'none':'flex';
  if(list)     list.style.display    =view==='list'?'block':'none';

  // Toggle 3D/2D toolbar buttons
  const cam3d=document.getElementById('wh-cam-buttons');
  if(cam3d) cam3d.style.display=view==='3d'?'flex':'none';
  const fit2d=document.getElementById('wh-fit-button');
  if(fit2d) fit2d.style.display=view==='2d'?'flex':'none';

  if(view==='3d') setTimeout(()=>init3D(),80);
  else if(view==='2d') setTimeout(()=>init2D(),50);
}

// ── Save ──────────────────────────────────────────────────────────────────────
export async function saveWarehouseLayout() {
  if(!_dirty){toast('No unsaved changes','info');return;}
  showLoading('Saving…');
  try {
    await rpc('saveWarehouseConfig',{floorW:_floor.w,floorD:_floor.d,floorH:_floor.h,gridSize:_grid,name:_floor.name});
    const payload=_items.filter(i=>i.locationId||i.id).map(i=>({
      locationId:   i.locationId||null,
      locationType: i.type==='zone'?'Zone':'Bay',
      fullPath:     i.fullPath||i.label,
      name:         i.label,
      description:  i.desc,
      capacity:     +i.capacity||0,
      active:       true,
      layoutX:i.x, layoutY:i.y, layoutW:i.w, layoutD:i.d, layoutH:i.h,
      layoutShelves:+i.shelves||4,
      layoutColor:  i.color||'',
      layoutRotation:i.rot||0,
    }));
    const r=await rpc('saveWarehouseLayout',payload);
    _dirty=false;
    toast(`Saved ${r.saved||payload.length} locations`,'ok');
  } catch(e){toast(e.message,'err');}
  finally{hideLoading();}
}

// ── Floor settings ────────────────────────────────────────────────────────────
export function openFloorSettings() {
  openModal('modal-wh-floor','Warehouse Dimensions',`
    <div class="form-grid">
      <div class="form-group span-2"><label>Warehouse Name</label>
        <input type="text" id="wf-name" value="${esc(_floor.name)}"></div>
      <div class="form-group"><label>Width (m) →</label>
        <input type="number" id="wf-w" value="${_floor.w}" step="1" min="5" max="500"></div>
      <div class="form-group"><label>Depth (m) ↓</label>
        <input type="number" id="wf-d" value="${_floor.d}" step="1" min="5" max="500"></div>
      <div class="form-group"><label>Ceiling Height (m)</label>
        <input type="number" id="wf-h" value="${_floor.h||6}" step="0.5" min="2" max="30"></div>
      <div class="form-group"><label>Grid Snap</label>
        <select id="wf-grid">
          <option value="0.25"${_grid===0.25?' selected':''}>0.25m — fine</option>
          <option value="0.5"${_grid===0.5?' selected':''}>0.5m — default</option>
          <option value="1"${_grid===1?' selected':''}>1m — coarse</option>
          <option value="2"${_grid===2?' selected':''}>2m — rough</option>
        </select></div>
    </div>
    <p style="font-size:11px;color:var(--text3);margin-top:10px">Changes will rebuild the view.</p>`,`
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="window.__whApplyFloor()">Apply & Rebuild</button>`);
}

// ── Add item modal ────────────────────────────────────────────────────────────
function openAddItemModal(type) {
  const defs={
    rack:  {w:0.9, d:0.5, h:2.4, shelves:4, cap:20},
    shelf: {w:1.8, d:0.4, h:2.0, shelves:3, cap:30},
    zone:  {w:6,   d:4,   h:0.1, shelves:0, cap:0},
    wall:  {w:4,   d:0.15,h:3,   shelves:0, cap:0},
  };
  const def=defs[type]||defs.rack;
  const defaultColors={rack:'#e8ff47',shelf:'#4db8ff',zone:'#ff8844',wall:'#5a5a70'};
  openModal('modal-wh-add', `Add ${type.charAt(0).toUpperCase()+type.slice(1)}`,`
    <div class="form-grid">
      <div class="form-group span-2"><label>Name / Label *</label>
        <input type="text" id="wa-label" value="${type.charAt(0).toUpperCase()+type.slice(1)} ${_items.filter(i=>i.type===type).length+1}" autofocus></div>
      <div class="form-group span-2"><label>Description</label>
        <input type="text" id="wa-desc" placeholder="e.g. Audio equipment, wireless systems"></div>
      <div class="form-group"><label>X Position (m)</label>
        <input type="number" id="wa-x" value="1" step="${_grid}" min="0" max="${_floor.w}"></div>
      <div class="form-group"><label>Y Position (m)</label>
        <input type="number" id="wa-y" value="1" step="${_grid}" min="0" max="${_floor.d}"></div>
      <div class="form-group"><label>Width (m)</label>
        <input type="number" id="wa-w" value="${def.w}" step="0.1" min="0.1" max="${_floor.w}"></div>
      <div class="form-group"><label>Depth (m)</label>
        <input type="number" id="wa-d" value="${def.d}" step="0.1" min="0.05" max="${_floor.d}"></div>
      <div class="form-group"><label>Height (m)</label>
        <input type="number" id="wa-h" value="${def.h}" step="0.1" min="0.1" max="20"></div>
      ${type==='rack'||type==='shelf'?`
      <div class="form-group"><label>Shelf Levels</label>
        <input type="number" id="wa-shelves" value="${def.shelves}" min="1" max="20"></div>
      <div class="form-group span-2"><label>Capacity (items)</label>
        <input type="number" id="wa-cap" value="${def.cap}" min="0"></div>`:''}
      <div class="form-group"><label>Colour</label>
        <input type="color" id="wa-color" value="${defaultColors[type]||'#888888'}"></div>
    </div>`,`
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="window.__whAddItem('${type}')">Add to Warehouse</button>`);
}

// ── Edit item modal ───────────────────────────────────────────────────────────
function openEditItemModal(itemId) {
  const item=_items.find(i=>i.id===itemId);
  if(!item){toast('Item not found','warn');return;}
  openModal('modal-wh-edit',`Edit: ${esc(item.label)}`,`
    <div class="form-grid">
      <div class="form-group span-2"><label>Label</label>
        <input type="text" id="we-label" value="${esc(item.label)}"></div>
      <div class="form-group span-2"><label>Description</label>
        <input type="text" id="we-desc" value="${esc(item.desc||'')}"></div>
      <div class="form-group"><label>X (m)</label>
        <input type="number" id="we-x" value="${item.x}" step="${_grid}" min="0"></div>
      <div class="form-group"><label>Y (m)</label>
        <input type="number" id="we-y" value="${item.y}" step="${_grid}" min="0"></div>
      <div class="form-group"><label>Width (m)</label>
        <input type="number" id="we-w" value="${item.w}" step="0.1" min="0.1"></div>
      <div class="form-group"><label>Depth (m)</label>
        <input type="number" id="we-d" value="${item.d}" step="0.05" min="0.05"></div>
      <div class="form-group"><label>Height (m)</label>
        <input type="number" id="we-h" value="${item.h}" step="0.1" min="0.1"></div>
      ${item.type==='rack'||item.type==='shelf'?`
      <div class="form-group"><label>Shelf Levels</label>
        <input type="number" id="we-shelves" value="${item.shelves||4}" min="1" max="20"></div>
      <div class="form-group"><label>Capacity</label>
        <input type="number" id="we-cap" value="${item.capacity||0}" min="0"></div>`:''}
      <div class="form-group"><label>Colour</label>
        <input type="color" id="we-color" value="${item.color||'#e8ff47'}"></div>
    </div>`,`
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="window.__whApplyEdit('${itemId}')">Save Changes</button>`);
}

// ── Expose globals ─────────────────────────────────────────────────────────────
export function setMode(m) { _view=m; }
export function zoomFit()  { if(window.__whFitFloor) window.__whFitFloor(); else if(window.__whResetView) window.__whResetView(); }

export function exposeWarehouseGlobals() {
  window.__whSwitchView   = switchView;
  window.__whSetMode      = setMode;
  window.__whZoomFit      = zoomFit;
  window.__whFloorSettings= openFloorSettings;
  window.__whSave         = saveWarehouseLayout;
  window.__whOpenAdd      = openAddItemModal;
  window.__whEditItem     = openEditItemModal;
  window.__whViewContents = viewLocationContents;
  window.__whLookupBarcode= lookupBarcodeLocation;

  window.__whRebuild = () => {
    if(_animFrame){cancelAnimationFrame(_animFrame);_animFrame=null;}
    _three=null; _2d=null;
    setTimeout(()=>_view==='2d'?init2D():init3D(), 50);
  };

  window.__whDeleteSelected = async () => {
    if (!_selected) { toast('Nothing selected', 'warn'); return; }
    const item = _items.find(i => i.id === _selected);
    if (!confirm(`Remove "${item?.label || _selected}" from warehouse plan?`)) return;
    showLoading('Removing…');
    try {
      // Delete from GAS sheet if it has a real locationId
      if (item?.locationId) {
        await rpc('deleteWarehouseLocation', item.locationId);
      }
      _items = _items.filter(i => i.id !== _selected);
      _selected = null; _dirty = false; // already persisted
      showProperties(null);
      window.__whRebuild();
      toast('Location removed', 'ok');
    } catch(e) { toast(e.message, 'err'); }
    finally { hideLoading(); }
  };

  window.__whAddItem = (type) => {
    const item = {
      id:       'new-'+Date.now(),
      locationId: null, type,
      label:    document.getElementById('wa-label')?.value||type,
      desc:     document.getElementById('wa-desc')?.value||'',
      x: parseFloat(document.getElementById('wa-x')?.value)||1,
      y: parseFloat(document.getElementById('wa-y')?.value)||1,
      w: parseFloat(document.getElementById('wa-w')?.value)||1,
      d: parseFloat(document.getElementById('wa-d')?.value)||0.5,
      h: parseFloat(document.getElementById('wa-h')?.value)||2.4,
      shelves:  parseInt(document.getElementById('wa-shelves')?.value||4, 10),
      capacity: parseInt(document.getElementById('wa-cap')?.value||0, 10),
      color:    document.getElementById('wa-color')?.value||null,
      rot: 0,
    };
    _items.push(item); _dirty=true; closeModal();
    showProperties(item); _selected=item.id;
    window.__whRebuild();
    toast(`${item.label} added`,'ok');
  };

  window.__whApplyEdit = (itemId) => {
    const item=_items.find(i=>i.id===itemId);
    if(!item) return;
    item.label   = document.getElementById('we-label')?.value||item.label;
    item.desc    = document.getElementById('we-desc')?.value||'';
    item.x       = parseFloat(document.getElementById('we-x')?.value)||item.x;
    item.y       = parseFloat(document.getElementById('we-y')?.value)||item.y;
    item.w       = parseFloat(document.getElementById('we-w')?.value)||item.w;
    item.d       = parseFloat(document.getElementById('we-d')?.value)||item.d;
    item.h       = parseFloat(document.getElementById('we-h')?.value)||item.h;
    item.shelves = parseInt(document.getElementById('we-shelves')?.value||item.shelves||4, 10);
    item.capacity= parseInt(document.getElementById('we-cap')?.value||0, 10);
    item.color   = document.getElementById('we-color')?.value||item.color;
    _dirty=true; closeModal(); showProperties(item);
    window.__whRebuild();
    toast('Changes saved — click 💾 to persist','ok');
  };

  window.__whApplyFloor = () => {
    _floor.name=document.getElementById('wf-name')?.value||_floor.name;
    _floor.w   =parseFloat(document.getElementById('wf-w')?.value)||_floor.w;
    _floor.d   =parseFloat(document.getElementById('wf-d')?.value)||_floor.d;
    _floor.h   =parseFloat(document.getElementById('wf-h')?.value)||_floor.h;
    _grid      =parseFloat(document.getElementById('wf-grid')?.value)||_grid;
    _dirty=true; closeModal();
    window.__whRebuild();
    toast('Dimensions updated','info');
  };
}