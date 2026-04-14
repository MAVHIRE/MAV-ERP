/**
 * MAV HIRE ERP — warehouse.js  v3.0
 * Full 3D warehouse designer using Three.js.
 * Animated racking, bins, cases, real-time occupancy, floor plan editor.
 */
import { rpc }   from '../api/gas.js';
import { STATE } from '../utils/state.js';
import { showLoading, hideLoading, toast } from '../utils/dom.js';
import { esc } from '../utils/format.js';
import { openModal, closeModal } from '../components/modal.js';

// ── State ─────────────────────────────────────────────────────────────────────
let _three = null;   // three.js instance
let _floor = { w:20, d:15, h:6, name:'Main Warehouse' };
let _grid  = 0.5;
let _items = [];
let _occ   = {};
let _dirty = false;
let _mode  = '3d';   // '3d' | '2d' | 'edit'
let _selected = null;
let _animFrame = null;

// ── Load ──────────────────────────────────────────────────────────────────────
export async function loadWarehouseDesigner() {
  exposeWarehouseGlobals();
  showLoading('Loading warehouse…');
  try {
    const [locs, cfg, occ] = await Promise.all([
      rpc('getWarehouseLocations', {}),
      rpc('getWarehouseConfig'),
      rpc('getLocationOccupancy'),
    ]);
    _floor = { w:+cfg.floorW||20, d:+cfg.floorD||15, h:+cfg.floorH||6, name:cfg.name||'Main Warehouse' };
    _grid  = +cfg.gridSize||0.5;
    _occ   = {};
    (occ||[]).forEach(o => _occ[o.locationId] = +o.itemCount||0);
    _items = (locs||[]).filter(l => +l.layoutW>0).map(mapLocation);
    hideLoading();
    setTimeout(() => init3D(), 80);
  } catch(e) { hideLoading(); toast(e.message,'err'); }
}

function mapLocation(l) {
  return {
    id: l.locationId, locationId: l.locationId,
    type: l.locationType==='Zone'?'zone':l.layoutD<0.3?'wall':'rack',
    label: l.fullPath||l.zone||l.locationId,
    zone: l.zone||'', bay: l.bay||'', desc: l.description||'',
    capacity: +l.capacity||0, shelves: +l.layoutShelves||4,
    x:+l.layoutX||0, y:+l.layoutY||0,
    w:+l.layoutW||1, d:+l.layoutD||1, h:+l.layoutH||2.4,
    color: l.layoutColor||null,
  };
}

// ── Three.js 3D Scene ─────────────────────────────────────────────────────────
function init3D() {
  const wrap = document.getElementById('warehouse-canvas-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';

  // Load Three.js from CDN
  const script = document.createElement('script');
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  script.onload = () => buildScene(wrap);
  script.onerror = () => { toast('3D engine failed to load','err'); fallback2D(wrap); };
  document.head.appendChild(script);
}

function buildScene(wrap) {
  if (!window.THREE) { fallback2D(wrap); return; }
  const THREE = window.THREE;

  const W = wrap.offsetWidth||900, H = wrap.offsetHeight||650;

  // Renderer
  const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  renderer.setSize(W,H);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x0a0a0f);
  wrap.appendChild(renderer.domElement);

  // Camera — isometric-ish perspective
  const camera = new THREE.PerspectiveCamera(45, W/H, 0.1, 1000);
  const cx = _floor.w/2, cz = _floor.d/2;
  camera.position.set(cx+_floor.w*0.8, _floor.h*1.8, cz+_floor.d*0.8);
  camera.lookAt(cx, 0, cz);

  // Scene
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0a0a0f, 30, 120);

  // Lighting
  const ambient = new THREE.AmbientLight(0x334466, 0.8);
  scene.add(ambient);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(cx+_floor.w, _floor.h*2, cz-_floor.d);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width  = 2048;
  dirLight.shadow.mapSize.height = 2048;
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far  = 200;
  dirLight.shadow.camera.left = -_floor.w*1.5;
  dirLight.shadow.camera.right= _floor.w*1.5;
  dirLight.shadow.camera.top  = _floor.d*1.5;
  dirLight.shadow.camera.bottom=-_floor.d*1.5;
  scene.add(dirLight);

  // Fill lights for depth
  scene.add(new THREE.PointLight(0x4499ff, 0.4, 50).position.set(0,_floor.h,0) && new THREE.PointLight(0x4499ff,0.4,50));
  const fillA = new THREE.PointLight(0x4488ff, 0.3, 60); fillA.position.set(0,_floor.h,0); scene.add(fillA);
  const fillB = new THREE.PointLight(0xff8844, 0.2, 40); fillB.position.set(_floor.w,_floor.h*0.5,_floor.d); scene.add(fillB);

  // Ceiling strip lights
  const stripMat = new THREE.MeshBasicMaterial({color:0xffffee});
  for (let i=2; i<_floor.w; i+=4) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.15,0.05,_floor.d*0.7), stripMat);
    strip.position.set(i, _floor.h-0.05, _floor.d/2);
    scene.add(strip);
    const stripLight = new THREE.PointLight(0xffffcc, 0.6, 12);
    stripLight.position.set(i, _floor.h-0.3, _floor.d/2);
    scene.add(stripLight);
  }

  // Floor
  buildFloor(scene, THREE);

  // Walls & ceiling
  buildRoom(scene, THREE);

  // Items
  const meshMap = {};
  _items.forEach(item => {
    const mesh = buildItemMesh(scene, THREE, item);
    if (mesh) meshMap[item.id] = mesh;
  });

  // Grid lines on floor
  buildFloorGrid(scene, THREE);

  // Mouse orbit controls (manual implementation)
  let isDragging=false, prevMX=0, prevMY=0;
  let phi=0.8, theta=Math.PI/4, radius=Math.hypot(_floor.w,_floor.d)*1.4;
  let target = new THREE.Vector3(cx, 0, cz);
  let isPanning=false;

  renderer.domElement.addEventListener('mousedown', e => {
    if (e.button===2) isPanning=true;
    else isDragging=true;
    prevMX=e.clientX; prevMY=e.clientY;
  });
  renderer.domElement.addEventListener('mousemove', e => {
    const dx=(e.clientX-prevMX)*0.008, dy=(e.clientY-prevMY)*0.008;
    if (isDragging) {
      theta -= dx; phi = Math.max(0.1, Math.min(Math.PI/2-0.05, phi+dy));
      updateCamera();
    }
    if (isPanning) {
      const right = new THREE.Vector3(); right.crossVectors(camera.getWorldDirection(new THREE.Vector3()), camera.up).normalize();
      const up_   = new THREE.Vector3(0,1,0);
      target.addScaledVector(right, -dx*radius*0.5);
      target.addScaledVector(up_, dy*radius*0.3);
      updateCamera();
    }
    prevMX=e.clientX; prevMY=e.clientY;
  });
  renderer.domElement.addEventListener('mouseup', ()=>{ isDragging=false; isPanning=false; });
  renderer.domElement.addEventListener('contextmenu', e=>e.preventDefault());
  renderer.domElement.addEventListener('wheel', e => {
    e.preventDefault();
    radius = Math.max(3, Math.min(80, radius*(e.deltaY>0?1.12:0.89)));
    updateCamera();
  }, { passive:false });

  // Touch
  let lastPinchDist = 0;
  renderer.domElement.addEventListener('touchstart', e => {
    e.preventDefault();
    if (e.touches.length===1) { isDragging=true; prevMX=e.touches[0].clientX; prevMY=e.touches[0].clientY; }
    if (e.touches.length===2) { isDragging=false; lastPinchDist=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY); }
  },{ passive:false });
  renderer.domElement.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length===1&&isDragging) {
      const dx=(e.touches[0].clientX-prevMX)*0.01, dy=(e.touches[0].clientY-prevMY)*0.01;
      theta-=dx; phi=Math.max(0.1,Math.min(Math.PI/2-0.05,phi+dy));
      updateCamera(); prevMX=e.touches[0].clientX; prevMY=e.touches[0].clientY;
    }
    if (e.touches.length===2) {
      const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
      radius=Math.max(3,Math.min(80,radius*(lastPinchDist/d))); lastPinchDist=d; updateCamera();
    }
  },{ passive:false });
  renderer.domElement.addEventListener('touchend', ()=>{ isDragging=false; });

  function updateCamera() {
    camera.position.set(
      target.x + radius*Math.sin(phi)*Math.sin(theta),
      target.y + radius*Math.cos(phi),
      target.z + radius*Math.sin(phi)*Math.cos(theta)
    );
    camera.lookAt(target);
  }

  // Resize
  const ro = new ResizeObserver(() => {
    const nw=wrap.offsetWidth, nh=wrap.offsetHeight;
    camera.aspect=nw/nh; camera.updateProjectionMatrix();
    renderer.setSize(nw,nh);
  });
  ro.observe(wrap);

  // Animation loop
  let tick = 0;
  if (_animFrame) cancelAnimationFrame(_animFrame);

  function animate() {
    _animFrame = requestAnimationFrame(animate);
    tick += 0.016;

    // Animate rack items (subtle breathing)
    scene.traverse(obj => {
      if (obj.userData.animType==='box') {
        obj.position.y = obj.userData.baseY + Math.sin(tick*1.5 + obj.userData.phase)*0.003;
      }
      if (obj.userData.animType==='indicator') {
        obj.material.opacity = 0.6 + Math.sin(tick*2 + obj.userData.phase)*0.4;
      }
    });

    renderer.render(scene, camera);
  }
  animate();

  _three = { renderer, scene, camera, meshMap, THREE };

  // Expose reset view
  window.__whResetView = () => {
    radius = Math.hypot(_floor.w,_floor.d)*1.4;
    theta  = Math.PI/4; phi = 0.8;
    target = new THREE.Vector3(_floor.w/2,0,_floor.d/2);
    updateCamera();
  };
  window.__whTopView = () => {
    radius=Math.max(_floor.w,_floor.d)*1.2; phi=0.05; theta=Math.PI/4; updateCamera();
  };
  window.__whFrontView = () => {
    radius=_floor.d*2; phi=Math.PI/3; theta=Math.PI/2; updateCamera();
  };
}

// ── Build floor ───────────────────────────────────────────────────────────────
function buildFloor(scene, THREE) {
  // Concrete floor with subtle tile pattern
  const geo  = new THREE.PlaneGeometry(_floor.w, _floor.d, Math.ceil(_floor.w), Math.ceil(_floor.d));
  const mat  = new THREE.MeshStandardMaterial({
    color: 0x1a1a24, roughness:0.9, metalness:0.05,
  });
  const floor = new THREE.Mesh(geo, mat);
  floor.rotation.x = -Math.PI/2;
  floor.position.set(_floor.w/2, 0, _floor.d/2);
  floor.receiveShadow = true;
  scene.add(floor);

  // Yellow safety lines
  const lineMat = new THREE.MeshBasicMaterial({ color:0xe8ff47 });
  // Border
  addLine(scene, THREE, lineMat, 0,0,0, _floor.w,0,0);
  addLine(scene, THREE, lineMat, _floor.w,0,0, _floor.w,0,_floor.d);
  addLine(scene, THREE, lineMat, _floor.w,0,_floor.d, 0,0,_floor.d);
  addLine(scene, THREE, lineMat, 0,0,_floor.d, 0,0,0);
}

function addLine(scene, THREE, mat, x1,y1,z1,x2,y2,z2) {
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(x1,y1+0.01,z1),
    new THREE.Vector3(x2,y2+0.01,z2),
  ]);
  scene.add(new THREE.Line(geo, mat));
}

// ── Build room ────────────────────────────────────────────────────────────────
function buildRoom(scene, THREE) {
  const mat = new THREE.MeshStandardMaterial({ color:0x1c1c28, roughness:0.8, side:THREE.BackSide });
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(_floor.w+0.2, _floor.h, _floor.d+0.2),
    mat
  );
  room.position.set(_floor.w/2, _floor.h/2, _floor.d/2);
  room.receiveShadow = true;
  scene.add(room);

  // Ceiling grid
  const cgMat = new THREE.MeshBasicMaterial({ color:0x252535 });
  for (let x=0; x<=_floor.w; x+=4) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.1,0.1,_floor.d), cgMat);
    b.position.set(x,_floor.h-0.1,_floor.d/2); scene.add(b);
  }
}

// ── Build floor grid ──────────────────────────────────────────────────────────
function buildFloorGrid(scene, THREE) {
  const mat = new THREE.LineBasicMaterial({ color:0x1e1e2e, transparent:true, opacity:0.6 });
  for (let x=_grid; x<_floor.w; x+=_grid) {
    addLine(scene, THREE, mat, x,0.005,0, x,0.005,_floor.d);
  }
  for (let z=_grid; z<_floor.d; z+=_grid) {
    addLine(scene, THREE, mat, 0,0.005,z, _floor.w,0.005,z);
  }
}

// ── Build item meshes ─────────────────────────────────────────────────────────
function buildItemMesh(scene, THREE, item) {
  if (item.type==='zone') { buildZoneMarker(scene,THREE,item); return null; }
  if (item.type==='wall') { buildWall(scene,THREE,item); return null; }
  if (item.type==='rack'||item.type==='shelf') { buildRack(scene,THREE,item); }
  return null;
}

function buildZoneMarker(scene, THREE, item) {
  // Translucent zone floor marker
  const geo = new THREE.PlaneGeometry(item.w, item.d);
  const col = item.color ? parseInt(item.color.replace('#',''), 16) : 0x4488ff;
  const mat = new THREE.MeshBasicMaterial({ color:col, transparent:true, opacity:0.08, depthWrite:false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI/2;
  mesh.position.set(item.x+item.w/2, 0.01, item.y+item.d/2);
  scene.add(mesh);

  // Zone border
  const borderMat = new THREE.LineBasicMaterial({ color:col, transparent:true, opacity:0.5 });
  const bx=item.x, bz=item.y, bw=item.w, bd=item.d;
  addLine(scene,THREE,borderMat, bx,0.02,bz, bx+bw,0.02,bz);
  addLine(scene,THREE,borderMat, bx+bw,0.02,bz, bx+bw,0.02,bz+bd);
  addLine(scene,THREE,borderMat, bx+bw,0.02,bz+bd, bx,0.02,bz+bd);
  addLine(scene,THREE,borderMat, bx,0.02,bz+bd, bx,0.02,bz);

  // Zone label (sprite)
  addTextSprite(scene, THREE, item.label, item.x+item.w/2, 0.3, item.y+item.d/2, col, 0.8);
}

function buildWall(scene, THREE, item) {
  const mat = new THREE.MeshStandardMaterial({ color:0x3a3a52, roughness:0.8 });
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(item.w, item.h, item.d),
    mat
  );
  mesh.position.set(item.x+item.w/2, item.h/2, item.y+item.d/2);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
}

function buildRack(scene, THREE, item) {
  const occ = _occ[item.locationId]||0;
  const cap = item.capacity||0;
  const col = item.color ? parseInt(item.color.replace('#',''), 16) : 0xe8ff47;

  // Frame material
  const frameMat = new THREE.MeshStandardMaterial({ color:0x888888, roughness:0.4, metalness:0.8 });
  const frameH   = item.h;
  const shelfCount = item.shelves||4;

  // Uprights
  [[item.x+0.03, item.y+0.03],[item.x+item.w-0.03,item.y+0.03],
   [item.x+0.03, item.y+item.d-0.03],[item.x+item.w-0.03,item.y+item.d-0.03]].forEach(([px,pz]) => {
    const upright = new THREE.Mesh(new THREE.BoxGeometry(0.05,frameH,0.05), frameMat);
    upright.position.set(px, frameH/2, pz);
    upright.castShadow = true;
    scene.add(upright);
  });

  // Shelf boards
  const shelfMat = new THREE.MeshStandardMaterial({ color:0x666677, roughness:0.6, metalness:0.3 });
  for (let s=0; s<=shelfCount; s++) {
    const sy = (frameH/shelfCount)*s;
    const shelf = new THREE.Mesh(
      new THREE.BoxGeometry(item.w, 0.03, item.d),
      s===0?new THREE.MeshStandardMaterial({color:0x444455,roughness:0.7}):shelfMat
    );
    shelf.position.set(item.x+item.w/2, sy, item.y+item.d/2);
    shelf.castShadow = shelf.receiveShadow = true;
    scene.add(shelf);

    // Cross braces
    if (s>0) {
      const brace = new THREE.Mesh(new THREE.BoxGeometry(item.w*0.9, 0.02, 0.02), frameMat);
      brace.position.set(item.x+item.w/2, sy-frameH/shelfCount*0.5, item.y+0.03);
      scene.add(brace);
    }
  }

  // Stored items on shelves (boxes/cases based on occupancy)
  if (cap>0 && occ>0) {
    const itemsPerShelf = Math.ceil(occ/shelfCount);
    let placed = 0;
    for (let s=0; s<shelfCount && placed<occ; s++) {
      const sy = (frameH/shelfCount)*s + frameH/shelfCount*0.15;
      const rowCount = Math.min(itemsPerShelf, occ-placed);
      for (let b=0; b<rowCount; b++) {
        const bw = Math.min((item.w-0.1)/rowCount, 0.35);
        const bh = (frameH/shelfCount)*0.65;
        const bd_ = item.d*0.8;
        const phase = s*2.1+b*0.7;

        // Random box type: flat case or upright box
        const isCase = Math.random()>0.4;
        const boxGeo = isCase
          ? new THREE.BoxGeometry(bw*0.9, bh*0.3, bd_*0.9)
          : new THREE.BoxGeometry(bw*0.9, bh*0.85, bd_*0.85);

        const hue = (phase*40)%360;
        const boxMat = new THREE.MeshStandardMaterial({
          color: boxColor(placed, cap),
          roughness:0.6, metalness:0.1
        });
        const box = new THREE.Mesh(boxGeo, boxMat);
        const baseY = sy + (isCase?bh*0.15:bh*0.425);
        box.position.set(
          item.x + 0.05 + bw*0.5 + b*(item.w-0.1)/rowCount,
          baseY,
          item.y + item.d/2
        );
        box.castShadow = true;
        box.userData = { animType:'box', baseY, phase };
        scene.add(box);

        // Label strip on box
        const labelMat = new THREE.MeshBasicMaterial({ color:0xffffff });
        const label = new THREE.Mesh(new THREE.BoxGeometry(bw*0.7, 0.02, 0.01), labelMat);
        label.position.set(box.position.x, box.position.y, item.y+item.d-0.02);
        scene.add(label);

        placed++;
      }
    }
  }

  // Occupancy indicator light on rack
  const pct = cap>0?occ/cap:0;
  const indColor = pct>0.9?0xff2222:pct>0.7?0xff8800:0x00ff88;
  const indMat = new THREE.MeshBasicMaterial({ color:indColor, transparent:true, opacity:0.9 });
  const indicator = new THREE.Mesh(new THREE.SphereGeometry(0.06,8,8), indMat);
  indicator.position.set(item.x+item.w/2, frameH+0.15, item.y+item.d/2);
  indicator.userData = { animType:'indicator', phase: item.x*0.5+item.y*0.3 };
  scene.add(indicator);

  // Glow under indicator
  const glowMat = new THREE.MeshBasicMaterial({ color:indColor, transparent:true, opacity:0.15, depthWrite:false });
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.3,16), glowMat);
  glow.rotation.x = -Math.PI/2;
  glow.position.set(item.x+item.w/2, 0.02, item.y+item.d/2);
  scene.add(glow);

  // Rack label
  addTextSprite(scene, THREE, item.label, item.x+item.w/2, frameH+0.4, item.y+item.d/2, col, 0.6);
}

function boxColor(placed, cap) {
  const colors = [0x4488ff,0xff8844,0x44ff88,0xffaa00,0xff4488,0x88aaff,0xffee44,0x44ffcc];
  return colors[placed % colors.length];
}

// ── Text sprite ───────────────────────────────────────────────────────────────
function addTextSprite(scene, THREE, text, x, y, z, color=0xffffff, scale=1) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillRect(0,0,256,64);
  ctx.font = 'bold 20px "DM Mono",monospace';
  ctx.fillStyle = '#'+color.toString(16).padStart(6,'0');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text.substring(0,22), 128, 32);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map:tex, transparent:true, depthWrite:false });
  const sprite = new THREE.Sprite(mat);
  sprite.position.set(x, y, z);
  sprite.scale.set(scale*2, scale*0.5, 1);
  scene.add(sprite);
}

// ── Fallback 2D canvas ────────────────────────────────────────────────────────
function fallback2D(wrap) {
  wrap.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text2);font-size:14px;font-family:var(--mono)">
    3D engine unavailable — use Floor Plan view
  </div>`;
}

// ── Save ──────────────────────────────────────────────────────────────────────
export async function saveWarehouseLayout() {
  if (!_dirty) { toast('No changes to save','info'); return; }
  showLoading('Saving…');
  try {
    await rpc('saveWarehouseConfig', { floorW:_floor.w, floorD:_floor.d, floorH:_floor.h, gridSize:_grid, name:_floor.name });
    const payload = _items.filter(i=>i.type!=='zone'||i.locationId).map(i=>({
      locationId: i.locationId||null,
      locationType: i.type==='zone'?'Zone':'Bay',
      zone: i.type==='zone'?i.label:(i.zone||i.label),
      bay:  i.type!=='zone'?(i.bay||i.label):'',
      description:i.desc, capacity:+i.capacity||0, active:true,
      layoutX:i.x, layoutY:i.y, layoutW:i.w, layoutD:i.d, layoutH:i.h,
      layoutShelves:+i.shelves||4, layoutColor:i.color||'', layoutRotation:0,
    }));
    const r = await rpc('saveWarehouseLayout', payload);
    _dirty=false;
    toast(`Saved ${r.saved} locations`,'ok');
  } catch(e) { toast(e.message,'err'); }
  finally { hideLoading(); }
}

// ── Floor settings modal ──────────────────────────────────────────────────────
export function openFloorSettings() {
  openModal('modal-wh-floor','Warehouse Dimensions',`
    <div class="form-grid">
      <div class="form-group span-2"><label>Warehouse Name</label>
        <input type="text" id="wf-name" value="${esc(_floor.name)}"></div>
      <div class="form-group"><label>Floor Width (m)</label>
        <input type="number" id="wf-w" value="${_floor.w}" step="1" min="5" max="500"
          placeholder="e.g. 20"></div>
      <div class="form-group"><label>Floor Depth (m)</label>
        <input type="number" id="wf-d" value="${_floor.d}" step="1" min="5" max="500"
          placeholder="e.g. 15"></div>
      <div class="form-group"><label>Ceiling Height (m)</label>
        <input type="number" id="wf-h" value="${_floor.h||6}" step="0.5" min="2" max="30"
          placeholder="e.g. 6"></div>
      <div class="form-group"><label>Grid Snap</label>
        <select id="wf-grid">
          <option value="0.25"${_grid===0.25?' selected':''}>0.25m — fine</option>
          <option value="0.5"${_grid===0.5?' selected':''}>0.5m — default</option>
          <option value="1"${_grid===1?' selected':''}>1m — coarse</option>
        </select></div>
    </div>
    <p style="font-size:11px;color:var(--text3);margin-top:12px">Changes rebuild the 3D scene.</p>`,`
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="window.__whApplyFloor()">Rebuild Scene</button>`);
}

// ── Add item modal ────────────────────────────────────────────────────────────
function openAddItemModal(type) {
  const defs = {
    rack:  { w:0.9, d:0.5, h:2.4, shelves:4, cap:20 },
    shelf: { w:1.8, d:0.4, h:2.0, shelves:3, cap:30 },
    zone:  { w:6,   d:4,   h:3,   shelves:0, cap:0  },
    wall:  { w:4,   d:0.15,h:3,   shelves:0, cap:0  },
  };
  const def = defs[type]||defs.rack;
  openModal('modal-wh-add','Add '+type.charAt(0).toUpperCase()+type.slice(1),`
    <div class="form-grid">
      <div class="form-group span-2"><label>Name / Label</label>
        <input type="text" id="wa-label" value="${type.charAt(0).toUpperCase()+type.slice(1)} ${_items.filter(i=>i.type===type).length+1}"></div>
      <div class="form-group span-2"><label>Description</label>
        <input type="text" id="wa-desc" value=""></div>
      <div class="form-group"><label>X Position (m)</label>
        <input type="number" id="wa-x" value="1" step="${_grid}" min="0"></div>
      <div class="form-group"><label>Y Position (m)</label>
        <input type="number" id="wa-y" value="1" step="${_grid}" min="0"></div>
      <div class="form-group"><label>Width (m)</label>
        <input type="number" id="wa-w" value="${def.w}" step="0.1" min="0.1"></div>
      <div class="form-group"><label>Depth (m)</label>
        <input type="number" id="wa-d" value="${def.d}" step="0.1" min="0.1"></div>
      <div class="form-group"><label>Height (m)</label>
        <input type="number" id="wa-h" value="${def.h}" step="0.1" min="0.1"></div>
      ${type==='rack'||type==='shelf'?`
      <div class="form-group"><label>Shelf Levels</label>
        <input type="number" id="wa-shelves" value="${def.shelves}" min="1" max="20"></div>
      <div class="form-group span-2"><label>Capacity (items)</label>
        <input type="number" id="wa-cap" value="${def.cap}" min="0"></div>`:''}
      <div class="form-group"><label>Colour</label>
        <input type="color" id="wa-color" value="${type==='rack'?'#e8ff47':type==='zone'?'#4db8ff':'#5a5a70'}"></div>
    </div>`,`
    <button class="btn btn-ghost btn-sm" onclick="window.__closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="window.__whAddItem('${type}')">Add to Warehouse</button>`);
}

// ── Export globals ────────────────────────────────────────────────────────────
export function setMode(m) { _mode=m; }
export function zoomFit() { if(window.__whResetView) window.__whResetView(); }

export function exposeWarehouseGlobals() {
  window.__whSetMode       = setMode;
  window.__whZoomFit       = zoomFit;
  window.__whZoomIn        = () => { if(_three){} };
  window.__whZoomOut       = () => { if(_three){} };
  window.__whFloorSettings = openFloorSettings;
  window.__whSave          = saveWarehouseLayout;
  window.__whToggleGrid    = () => toast('Use Floor Plan view to toggle grid','info');
  window.__whToggleMeasure = () => toast('Measurements shown in Floor Plan view','info');
  window.__whUndo          = () => toast('Undo: rebuild with floor plan editor','info');
  window.__whRedo          = () => {};
  window.__whRebuild       = () => {
    if(_animFrame) cancelAnimationFrame(_animFrame);
    _three=null;
    setTimeout(()=>init3D(),50);
  };
  window.__whOpenAdd       = openAddItemModal;
  window.__whAddItem       = (type) => {
    const item = {
      id:       'new-'+Date.now(),
      locationId: null, type,
      label:    document.getElementById('wa-label')?.value||type,
      desc:     document.getElementById('wa-desc')?.value||'',
      zone:     '', bay:'',
      x:        parseFloat(document.getElementById('wa-x')?.value)||1,
      y:        parseFloat(document.getElementById('wa-y')?.value)||1,
      w:        parseFloat(document.getElementById('wa-w')?.value)||1,
      d:        parseFloat(document.getElementById('wa-d')?.value)||0.5,
      h:        parseFloat(document.getElementById('wa-h')?.value)||2.4,
      shelves:  parseInt(document.getElementById('wa-shelves', 10)?.value, 10)||4,
      capacity: parseInt(document.getElementById('wa-cap', 10)?.value, 10)||0,
      color:    document.getElementById('wa-color')?.value||null,
    };
    _items.push(item); _dirty=true; closeModal();
    if(_animFrame) cancelAnimationFrame(_animFrame);
    _three=null; setTimeout(()=>init3D(),50);
    toast('Added '+item.label+' — scene rebuilding','ok');
  };
  window.__whDeleteItem    = () => {
    if(!_selected) return;
    _items=_items.filter(i=>i.id!==_selected);
    _selected=null; _dirty=true;
    if(_animFrame) cancelAnimationFrame(_animFrame);
    _three=null; setTimeout(()=>init3D(),50);
    closeModal();
  };
  window.__whApplyFloor    = () => {
    _floor.name = document.getElementById('wf-name')?.value||_floor.name;
    _floor.w    = parseFloat(document.getElementById('wf-w')?.value)||_floor.w;
    _floor.d    = parseFloat(document.getElementById('wf-d')?.value)||_floor.d;
    _floor.h    = parseFloat(document.getElementById('wf-h')?.value)||_floor.h;
    _grid       = parseFloat(document.getElementById('wf-grid')?.value)||_grid;
    _dirty=true; closeModal();
    if(_animFrame) cancelAnimationFrame(_animFrame);
    _three=null; setTimeout(()=>init3D(),80);
    toast('Rebuilding 3D scene…','info');
  };
  window.__whSwitchView    = (view) => {
    const designer = document.getElementById('wh-designer-view');
    const list     = document.getElementById('wh-list-view');
    if (designer) designer.style.display = view==='designer'?'flex':'none';
    if (list)     list.style.display     = view==='list'?'block':'none';
    document.querySelectorAll('.wh-view-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
    // loadStorage is wired in main.js __whSwitchView override — no-op here
    if (view==='designer' && !_three) setTimeout(()=>init3D(),80);
  };
}