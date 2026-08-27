/** The self-contained 3D "office" viewer served at GET /. */
export const VIEWER_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>OxCode Swarm — Office</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; overflow: hidden; background: #0b0e14; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #e6edf3; }
  #app { position: fixed; inset: 0; }
  canvas { display: block; }
  .panel { position: fixed; background: rgba(15,19,28,.82); border: 1px solid #223; border-radius: 10px; backdrop-filter: blur(6px); }
  #hud { top: 12px; left: 12px; padding: 10px 14px; max-width: 320px; }
  #hud h1 { margin: 0 0 2px; font-size: 15px; letter-spacing: .5px; }
  #hud h1 span { color: #38bdf8; }
  #hud .sub { font-size: 11px; color: #8b98a5; }
  #hud .stat { margin-top: 8px; font-size: 12px; display: flex; gap: 14px; }
  #hud .stat b { color: #4ade80; }
  #hud .hint { margin-top: 6px; font-size: 10px; color: #64748b; }
  #board { top: 12px; right: 12px; width: 300px; max-height: 42vh; padding: 10px 12px; overflow: auto; }
  #board h2 { margin: 0 0 6px; font-size: 12px; color: #fbbf24; text-transform: uppercase; letter-spacing: 1px; }
  #board .note { font-size: 11px; line-height: 1.4; padding: 5px 7px; margin-bottom: 5px; background: rgba(251,191,36,.08); border-left: 2px solid #fbbf24; border-radius: 3px; white-space: pre-wrap; word-break: break-word; }
  #board .note .who { color: #fbbf24; font-weight: bold; }
  #log { bottom: 12px; right: 12px; width: 300px; max-height: 30vh; padding: 10px 12px; overflow: auto; font-size: 11px; }
  #log h2 { margin: 0 0 6px; font-size: 12px; color: #60a5fa; text-transform: uppercase; letter-spacing: 1px; }
  #log .row { padding: 2px 0; color: #a9b6c3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #log .row .who { color: #e6edf3; font-weight: bold; }
  #legend { bottom: 12px; left: 12px; padding: 8px 12px; font-size: 11px; }
  #legend .row { display: flex; align-items: center; gap: 6px; margin: 3px 0; }
  #legend .dot { width: 10px; height: 10px; border-radius: 50%; }
  .bubble { position: fixed; transform: translate(-50%, -100%); pointer-events: none; background: #e6edf3; color: #0b0e14; font-size: 11px; font-weight: 600; padding: 4px 8px; border-radius: 8px; max-width: 200px; box-shadow: 0 4px 14px rgba(0,0,0,.5); transition: opacity .3s; z-index: 5; }
  .bubble::after { content: ""; position: absolute; left: 50%; bottom: -5px; transform: translateX(-50%); border: 5px solid transparent; border-top-color: #e6edf3; border-bottom: 0; }
  .tag { position: fixed; transform: translate(-50%, -50%); pointer-events: none; font-size: 10px; color: #cbd5e1; text-shadow: 0 1px 3px #000; white-space: nowrap; z-index: 4; }
  #customize { top: 50%; left: 12px; transform: translateY(-50%); width: 232px; padding: 12px 14px; display: none; z-index: 10; }
  #customize h2 { margin: 0 0 2px; font-size: 13px; }
  #customize .who { font-size: 11px; color: #38bdf8; margin-bottom: 8px; }
  #customize .grp { margin-bottom: 9px; }
  #customize .grp label { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #8b98a5; margin-bottom: 4px; }
  #customize .sw { display: flex; flex-wrap: wrap; gap: 5px; }
  #customize .sw button { width: 22px; height: 22px; border-radius: 5px; border: 2px solid transparent; cursor: pointer; padding: 0; }
  #customize .sw button.on { border-color: #e6edf3; }
  #customize .toggles { display: flex; gap: 8px; }
  #customize .toggles button { flex: 1; font: inherit; font-size: 11px; padding: 5px; border-radius: 6px; border: 1px solid #334; background: #131a24; color: #cbd5e1; cursor: pointer; }
  #customize .toggles button.on { background: #234; border-color: #38bdf8; color: #fff; }
  #customize .actions { display: flex; gap: 8px; margin-top: 4px; }
  #customize .actions button { flex: 1; font: inherit; font-size: 11px; padding: 6px; border-radius: 6px; border: 1px solid #334; background: #1e2733; color: #e6edf3; cursor: pointer; }
  #empty { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 10px; color: #64748b; font-size: 14px; text-align: center; pointer-events: none; }
  #empty .big { font-size: 20px; color: #94a3b8; }
</style>
<script type="importmap">
{ "imports": {
  "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
  "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
} }
</script>
</head>
<body>
<div id="app"></div>
<div class="panel" id="hud">
  <h1>Ox<span>Code</span> Swarm</h1>
  <div class="sub">hive-mind &middot; live office</div>
  <div class="stat"><span>agents <b id="s-agents">0</b></span><span>active <b id="s-active">0</b></span><span>done <b id="s-done">0</b></span></div>
  <div class="hint">drag to orbit &middot; scroll to zoom &middot; click a worker to dress them</div>
</div>
<div class="panel" id="board"><h2>Blackboard</h2><div id="board-list"></div></div>
<div class="panel" id="log"><h2>Activity</h2><div id="log-list"></div></div>
<div class="panel" id="legend">
  <div class="row"><span class="dot" style="background:#fbbf24"></span> thinking</div>
  <div class="row"><span class="dot" style="background:#4ade80"></span> working</div>
  <div class="row"><span class="dot" style="background:#f87171"></span> blocked / error</div>
  <div class="row"><span class="dot" style="background:#64748b"></span> done</div>
</div>
<div class="panel" id="customize">
  <h2>Wardrobe</h2>
  <div class="who" id="cz-who"></div>
  <div class="grp"><label>Shirt</label><div class="sw" id="cz-shirt"></div></div>
  <div class="grp"><label>Pants</label><div class="sw" id="cz-pants"></div></div>
  <div class="grp"><label>Hair</label><div class="sw" id="cz-hair"></div></div>
  <div class="grp"><label>Skin</label><div class="sw" id="cz-skin"></div></div>
  <div class="grp"><label>Accessories</label><div class="toggles"><button id="cz-glasses">Glasses</button><button id="cz-hat">Cap</button></div></div>
  <div class="actions"><button id="cz-random">Randomize</button><button id="cz-close">Close</button></div>
</div>
<div id="empty"><div class="big">Waiting for the swarm&hellip;</div><div>Run a task with <code>/swarm</code> active &mdash; workers appear here.</div></div>

<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const ROLE_SHIRT = {
  orchestrator: 0x2563eb, explorer: 0x7c3aed, coder: 0x16a34a,
  reviewer: 0xdb2777, tester: 0xca8a04, security: 0xdc2626, worker: 0x475569,
};
const STATUS_COLORS = {
  spawning: 0x64748b, thinking: 0xfbbf24, working: 0x4ade80,
  blocked: 0xf87171, done: 0x64748b, error: 0xf87171,
};
const SHIRTS = [0x2563eb,0x16a34a,0xdc2626,0xca8a04,0x7c3aed,0xdb2777,0x0891b2,0xe6edf3,0x1e293b,0xf97316];
const PANTS = [0x1f2937,0x334155,0x475569,0x3f3f46,0x5b4636,0x0f172a,0x64748b];
const HAIR = [0x1c1917,0x3f2a14,0x6b4423,0xb45309,0x9ca3af,0xe5e7eb,0x111827,0x7c2d12];
const SKIN = [0xffe0bd,0xf1c27d,0xe0ac69,0xc68642,0x8d5524,0x5c3a21];

const app = document.getElementById('app');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e14);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 400);
camera.position.set(26, 34, 40);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0, 1);
controls.maxPolarAngle = Math.PI / 2.15;
controls.minDistance = 14;
controls.maxDistance = 110;

scene.add(new THREE.HemisphereLight(0xffffff, 0x2a3040, 1.15));
const sun = new THREE.DirectionalLight(0xfff4e0, 1.5);
sun.position.set(24, 46, 20); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 140;
sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
scene.add(sun);

// ---------- materials ----------
const M = (c, o={}) => new THREE.MeshStandardMaterial({ color: c, roughness: o.r ?? 0.85, metalness: o.m ?? 0.05, ...o });
const MAT = {
  slab: M(0x0b0e14, { r: 1 }),
  carpet: M(0x8b929c, { r: 1 }),
  woodFloor: M(0xb98a5a, { r: 0.9 }),
  tile: M(0xdfe4ea, { r: 0.4 }),
  wall: M(0xf3f4f6, { r: 0.95 }),
  wallBase: M(0x334155, { r: 0.9 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x9fd0e6, transparent: true, opacity: 0.28, roughness: 0.1, metalness: 0.1 }),
  deskTop: M(0xd9b892, { r: 0.6 }),
  deskLeg: M(0x9c7b52, { r: 0.7 }),
  divider: M(0xeceff3, { r: 0.9 }),
  chair: M(0x24272e, { r: 0.6 }),
  monitor: new THREE.MeshStandardMaterial({ color: 0x0f172a, emissive: 0x1e3a5f, emissiveIntensity: 0.7, roughness: 0.4 }),
  cabinet: M(0xb08a5e, { r: 0.7 }),
  potSoil: M(0x3b2a1a, { r: 1 }),
  pot: M(0x64748b, { r: 0.6 }),
  leaf: M(0x2f8f4e, { r: 0.8 }),
  rug: M(0x475569, { r: 1 }),
  sofa: M(0x3b4657, { r: 0.85 }),
  reception: M(0xf8fafc, { r: 0.5 }),
  sign: new THREE.MeshStandardMaterial({ color: 0x24344d, roughness: 0.6 }),
  counter: M(0xe2e8f0, { r: 0.4 }),
  steel: M(0xcbd5e1, { r: 0.3, m: 0.6 }),
  tableWood: M(0xc79a68, { r: 0.6 }),
};

// ---------- building shell ----------
const HALF_W = 20, HALF_D = 14, WALL_H = 3.2, WT = 0.3;
const floor = new THREE.Mesh(new THREE.BoxGeometry(HALF_W*2, 0.3, HALF_D*2), MAT.slab);
floor.position.y = -0.15; floor.receiveShadow = true; scene.add(floor);

function region(x, z, w, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), mat);
  m.position.set(x, 0.02, z); m.receiveShadow = true; scene.add(m); return m;
}
region(0, 0, HALF_W*2, HALF_D*2, MAT.carpet);            // whole floor carpet
region(11, 9, 15, 8, MAT.woodFloor);                      // kitchen wood
region(9.5, -9.5, 16, 8, MAT.woodFloor);                  // meeting wood
region(-15.5, -9, 8, 8, MAT.tile);                        // bathroom tile

const gridT = new THREE.GridHelper(HALF_W*2, 40, 0x6b7280, 0x7c8695);
gridT.material.opacity = 0.25; gridT.material.transparent = true; gridT.position.y = 0.05; scene.add(gridT);

function wall(x1, z1, x2, z2, h, t) {
  h = h ?? WALL_H; t = t ?? WT;
  const dx = x2 - x1, dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  const g = new THREE.Mesh(new THREE.BoxGeometry(len, h, t), MAT.wall);
  g.position.set((x1+x2)/2, h/2, (z1+z2)/2);
  g.rotation.y = -Math.atan2(dz, dx);
  g.castShadow = true; g.receiveShadow = true; scene.add(g);
  // dark skirting
  const base = new THREE.Mesh(new THREE.BoxGeometry(len, 0.25, t*1.15), MAT.wallBase);
  base.position.set((x1+x2)/2, 0.12, (z1+z2)/2); base.rotation.y = g.rotation.y; scene.add(base);
  return g;
}
function glassWall(x1, z1, x2, z2, h) {
  h = h ?? WALL_H;
  const dx = x2-x1, dz = z2-z1, len = Math.hypot(dx,dz);
  const g = new THREE.Mesh(new THREE.BoxGeometry(len, h, 0.08), MAT.glass);
  g.position.set((x1+x2)/2, h/2, (z1+z2)/2); g.rotation.y = -Math.atan2(dz,dx); scene.add(g);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, 0.12), MAT.steel);
  frame.position.set((x1+x2)/2, h, (z1+z2)/2); frame.rotation.y = g.rotation.y; scene.add(frame);
}

// perimeter (with a front gap for the entrance around x=-17..-13 on +Z side)
wall(-HALF_W, -HALF_D, HALF_W, -HALF_D);      // back
wall(-HALF_W, HALF_D, -17, HALF_D);           // front-left
wall(-13, HALF_D, HALF_W, HALF_D);            // front-right
wall(-HALF_W, -HALF_D, -HALF_W, HALF_D);      // left
wall(HALF_W, -HALF_D, HALF_W, HALF_D);        // right
glassWall(-17, HALF_D, -13, HALF_D, 2.6);     // entrance glass doors

// entrance steps outside
const steps = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.3, 3), MAT.wallBase);
steps.position.set(-15, 0.0, HALF_D + 1.6); steps.receiveShadow = true; scene.add(steps);

// interior partitions
// bathrooms (top-left room)
wall(-HALF_W+0.1, -5, -11.5, -5);
wall(-11.5, -5, -11.5, -HALF_D+0.1);
wall(-14.5, -5, -14.5, -8.5);                  // stall divider
// reception / lounge separation from open floor
wall(-11.5, -3, -11.5, 4);
// private offices (back-center): two rooms
wall(-9, -HALF_D+0.1, -9, -6.5);
wall(-9, -6.5, -1.5, -6.5);
wall(-1.5, -HALF_D+0.1, -1.5, -6.5);
wall(-5.25, -6.5, -5.25, -HALF_D+0.1);         // split into 2 offices (door gaps implied)
// meeting room (top-right)
wall(1.5, -6.5, 1.5, -HALF_D+0.1);
wall(1.5, -6.5, 6, -6.5);
wall(9.5, -6.5, HALF_W-0.1, -6.5);
// right-side small offices
wall(13, -5, 13, 6.5);
wall(13, -5, HALF_W-0.1, -5);
wall(13, 1, HALF_W-0.1, 1);
// kitchen (bottom-right)
wall(3.5, 5, 3.5, HALF_D-0.1);
wall(3.5, 5, 13, 5);
wall(13, 5, 13, 8.5);

// ---------- furniture builders ----------
function label3D(text, w, colorBg, colorFg) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = colorBg || 'rgba(0,0,0,0)'; g.fillRect(0,0,256,64);
  g.fillStyle = colorFg || '#e6edf3'; g.font = 'bold 34px Menlo, monospace';
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(c); tex.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: !colorBg });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w*0.25), mat);
  return m;
}
function roomTag(text, x, z) {
  const m = label3D(text, 3.4);
  m.rotation.x = -Math.PI/2; m.position.set(x, 0.07, z); scene.add(m);
}

function desk(x, z, rot) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot || 0;
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.09, 0.95), MAT.deskTop);
  top.position.y = 0.74; top.castShadow = true; top.receiveShadow = true; g.add(top);
  for (const sx of [-0.75, 0.75]) for (const sz of [-0.4, 0.4]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.74, 0.07), MAT.deskLeg);
    leg.position.set(sx, 0.37, sz); g.add(leg);
  }
  const mon = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.05), MAT.monitor);
  mon.position.set(0, 1.12, -0.32); g.add(mon);
  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.08,0.18,0.08), MAT.chair);
  stand.position.set(0,0.86,-0.32); g.add(stand);
  const kb = new THREE.Mesh(new THREE.BoxGeometry(0.5,0.03,0.16), MAT.steel);
  kb.position.set(0,0.79,0.02); g.add(kb);
  scene.add(g); return g;
}
function chair(x, z, rot) {
  const g = new THREE.Group(); g.position.set(x,0,z); g.rotation.y = rot||0;
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5,0.09,0.5), MAT.chair);
  seat.position.y = 0.48; seat.castShadow = true; g.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.5,0.55,0.08), MAT.chair);
  back.position.set(0,0.75,-0.24); g.add(back);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.05,0.42,8), MAT.chair);
  post.position.y=0.24; g.add(post);
  const bs = new THREE.Mesh(new THREE.CylinderGeometry(0.28,0.28,0.04,12), MAT.chair);
  bs.position.y=0.04; g.add(bs);
  scene.add(g); return g;
}
function divider(x, z, len, rot) {
  const g = new THREE.Mesh(new THREE.BoxGeometry(len, 0.55, 0.06), MAT.divider);
  g.position.set(x, 1.05, z); g.rotation.y = rot||0; g.castShadow = true; scene.add(g);
}
function cabinet(x, z, rot) {
  const g = new THREE.Mesh(new THREE.BoxGeometry(1.4,0.9,0.5), MAT.cabinet);
  g.position.set(x,0.45,z); g.rotation.y=rot||0; g.castShadow=true; scene.add(g);
}
function plant(x, z) {
  const g = new THREE.Group(); g.position.set(x,0,z);
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22,0.16,0.4,10), MAT.pot);
  pot.position.y=0.2; pot.castShadow=true; g.add(pot);
  for (let i=0;i<5;i++){
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.12,0.7,6), MAT.leaf);
    leaf.position.set((Math.random()-0.5)*0.2,0.7,(Math.random()-0.5)*0.2);
    leaf.rotation.set((Math.random()-0.5)*0.6,Math.random()*6,(Math.random()-0.5)*0.6);
    leaf.castShadow=true; g.add(leaf);
  }
  scene.add(g);
}

// ---------- rooms & decor ----------
// reception desk + WELCOME sign
(function reception(){
  const g = new THREE.Group(); g.position.set(-16.5, 0, 5.5);
  const body = new THREE.Mesh(new THREE.BoxGeometry(3.4,1.1,1.6), MAT.reception);
  body.position.y=0.55; body.castShadow=true; g.add(body);
  const top = new THREE.Mesh(new THREE.BoxGeometry(3.7,0.1,1.9), MAT.deskTop);
  top.position.y=1.12; g.add(top);
  scene.add(g);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(3.6,1.1,0.15), MAT.sign);
  sign.position.set(-16.5,2.0,3.2); scene.add(sign);
  const txt = label3D('WELCOME', 3.2, null, '#dbe5f0');
  txt.position.set(-16.5,2.05,3.29); scene.add(txt);
})();
// lounge
(function lounge(){
  const rug = new THREE.Mesh(new THREE.BoxGeometry(5,0.05,4), MAT.rug);
  rug.position.set(-16.5,0.05,10.5); scene.add(rug);
  const table = new THREE.Mesh(new THREE.CylinderGeometry(0.7,0.7,0.4,16), MAT.tableWood);
  table.position.set(-16.5,0.2,10.5); table.castShadow=true; scene.add(table);
  const sofaGeo = [[-18.3,10.5,Math.PI/2],[-14.7,10.5,-Math.PI/2],[-16.5,12.4,0]];
  for (const [sx,sz,r] of sofaGeo){
    const s = new THREE.Group(); s.position.set(sx,0,sz); s.rotation.y=r;
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.4,0.4,1.2), MAT.sofa); seat.position.y=0.3; seat.castShadow=true; s.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.4,0.7,0.25), MAT.sofa); back.position.set(0,0.6,-0.5); s.add(back);
    scene.add(s);
  }
})();
// bathrooms: toilets + sinks + stall walls
(function bath(){
  for (const [tx,tz] of [[-18.5,-11.5],[-18.5,-7.5]]){
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.28,0.22,0.5,12), MAT.reception);
    bowl.position.set(tx,0.25,tz); bowl.castShadow=true; scene.add(bowl);
    const tank = new THREE.Mesh(new THREE.BoxGeometry(0.5,0.6,0.2), MAT.reception);
    tank.position.set(tx-0.35,0.5,tz); scene.add(tank);
  }
  for (const sz of [-11.5,-9.5,-7.5]){
    const sink = new THREE.Mesh(new THREE.BoxGeometry(0.6,0.2,0.45), MAT.counter);
    sink.position.set(-12.4,0.8,sz); scene.add(sink);
  }
})();
// meeting room: long table + chairs + wall screen
(function meeting(){
  const t = new THREE.Mesh(new THREE.BoxGeometry(7.5,0.15,2.2), MAT.tableWood);
  t.position.set(10,0.8,-9.5); t.castShadow=true; t.receiveShadow=true; scene.add(t);
  for (const sx of [-3,-1.8,-0.6,0.6,1.8,3]) { chair(10+sx,-8.0,Math.PI); chair(10+sx,-11.0,0); }
  const screen = new THREE.Mesh(new THREE.BoxGeometry(3.4,1.7,0.1), new THREE.MeshStandardMaterial({color:0x0b1220,emissive:0x14324f,emissiveIntensity:0.5}));
  screen.position.set(10,2.0,-13.7); scene.add(screen);
  roomTag('MEETING', 10, -9.5);
})();
// private offices (back-center)
cabinet(-8.4,-13.2,0); cabinet(-2,-13.2,0);
desk(-6.7,-9.4,Math.PI*0.15); chair(-6.7,-8.2,Math.PI*1.15);
desk(-3.7,-9.4,-Math.PI*0.15); chair(-3.7,-8.2,Math.PI*0.85);
plant(-9.6,-12.6); plant(-1.9,-8.0);
roomTag('OFFICE', -7.2, -10.5); roomTag('OFFICE', -3.4, -10.5);
// right offices
desk(16.5,-2.5,-Math.PI/2); chair(15.3,-2.5,Math.PI/2); cabinet(18.8,-3.4,Math.PI/2); plant(18.7,-0.2);
desk(16.5,3.5,-Math.PI/2); chair(15.3,3.5,Math.PI/2); cabinet(18.8,4.4,Math.PI/2);
roomTag('OFFICE', 16.8, 0.5);
// kitchen
(function kitchen(){
  const counter = new THREE.Mesh(new THREE.BoxGeometry(7,0.9,0.7), MAT.counter);
  counter.position.set(10,0.45,12.6); counter.castShadow=true; scene.add(counter);
  const sink = new THREE.Mesh(new THREE.BoxGeometry(0.6,0.1,0.45), MAT.steel); sink.position.set(12,0.92,12.6); scene.add(sink);
  const t = new THREE.Mesh(new THREE.BoxGeometry(2.4,0.12,1.3), MAT.reception); t.position.set(8.5,0.78,9.2); t.castShadow=true; scene.add(t);
  for (const [cx,cz,r] of [[7.2,9.2,-Math.PI/2],[9.8,9.2,Math.PI/2]]) chair(cx,cz,r);
  plant(4.4,12.4); roomTag('KITCHEN', 9.5, 10.8);
})();
// scattered plants in the open floor
for (const [px,pz] of [[-10.5,-4.5],[0.5,-4.5],[6.2,-4.2],[-10.5,7.5],[2,12.5],[-3.5,12.5]]) plant(px,pz);

// ---------- seats (where workers sit) ----------
const seats = [];
// central open-plan pods: 2 rows x 3 cols, 4 seats each
const podCX = [-8.5, -3.0, 4.5];
const podCZ = [-1.5, 8.0];
for (const cz of podCZ) for (const cx of podCX) {
  desk(cx-1.0, cz-1.05, 0); desk(cx+1.0, cz-1.05, 0);
  desk(cx-1.0, cz+1.05, Math.PI); desk(cx+1.0, cz+1.05, Math.PI);
  divider(cx, cz, 3.6, 0);
  seats.push({ x: cx-1.0, z: cz-2.0, rot: 0 });
  seats.push({ x: cx+1.0, z: cz-2.0, rot: 0 });
  seats.push({ x: cx-1.0, z: cz+2.0, rot: Math.PI });
  seats.push({ x: cx+1.0, z: cz+2.0, rot: Math.PI });
}
// office / meeting overflow seats
const overflow = [
  { x:-6.7, z:-8.2, rot: Math.PI }, { x:-3.7, z:-8.2, rot: Math.PI },
  { x:15.3, z:-2.5, rot: Math.PI/2 }, { x:15.3, z:3.5, rot: Math.PI/2 },
  { x:7.0, z:-8.0, rot: Math.PI }, { x:8.2, z:-8.0, rot: Math.PI },
  { x:11.8, z:-8.0, rot: Math.PI }, { x:13.0, z:-8.0, rot: Math.PI },
];
for (const s of overflow) seats.push(s);
// orchestrator's spot: head of the meeting table
const ORCH_SEAT = { x: 5.6, z: -9.5, rot: -Math.PI/2 };

// walkable hangout spots in the open aisles — workers wander here and back
const WALK_POI = [
  { x: -11.5, z: 3.5 },  // reception aisle
  { x: -14.5, z: 10.5 }, // lounge
  { x: -2.0, z: 3.0 },   // central aisle
  { x: 6.0, z: 3.0 },    // central aisle right
  { x: 8.5, z: 9.2 },    // kitchen table
  { x: 0.0, z: 11.5 },   // front aisle
  { x: -2.0, z: -4.5 },  // near back offices
];
const rand = (a,b) => a + Math.random()*(b-a);
function scheduleWander(a, now){ a.nextWander = now + rand(7000, 18000); }

// ---------- outfits ----------
function hash(s){ let h=2166136261; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619);} return h>>>0; }
function pick(arr, n){ return arr[n % arr.length]; }
function defaultOutfit(label, role){
  const h = hash(label + role);
  return {
    shirt: ROLE_SHIRT[role] ?? ROLE_SHIRT.worker,
    pants: pick(PANTS, h>>3),
    hair: pick(HAIR, h>>7),
    skin: pick(SKIN, h>>11),
    glasses: ((h>>13)&3) === 0,
    hat: ((h>>15)&7) === 0,
  };
}
function loadOutfit(label, role){
  const base = defaultOutfit(label, role);
  try { const raw = localStorage.getItem('ox-outfit:'+label); if (raw) return Object.assign(base, JSON.parse(raw)); } catch {}
  return base;
}
function saveOutfit(label, o){ try { localStorage.setItem('ox-outfit:'+label, JSON.stringify(o)); } catch {} }

// ---------- worker avatar (single body block, floating face + hands) ----------
const EYE_MAT = new THREE.MeshStandardMaterial({ color: 0x1b1b1f, roughness: 0.35 });
const MOUTH_MAT = new THREE.MeshStandardMaterial({ color: 0x7a2b2b, roughness: 0.5 });
function buildWorker(outfit){
  const g = new THREE.Group();
  const shirtMat = M(outfit.shirt, { r: 0.5, m: 0.1 });
  const pantsMat = M(outfit.pants, { r: 0.7 }); // kept for wardrobe compat (belt stripe)
  const skinMat = M(outfit.skin, { r: 0.45 });
  const hairMat = M(outfit.hair, { r: 0.6 });

  // one simple body block = torso + legs together
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6,1.12,0.44), shirtMat);
  torso.position.y=0.6; torso.castShadow=true; g.add(torso);
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.62,0.16,0.46), pantsMat);
  belt.position.y=0.24; g.add(belt);

  // floating head cube with a FACE (clear gap above the body)
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.54,0.54,0.54), skinMat);
  head.position.y=1.62; head.castShadow=true; head.userData.baseY=1.62; g.add(head);
  const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.1,0.13,0.04), EYE_MAT); eyeL.position.set(-0.13,0.05,0.275); head.add(eyeL);
  const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.1,0.13,0.04), EYE_MAT); eyeR.position.set(0.13,0.05,0.275); head.add(eyeR);
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.2,0.05,0.04), MOUTH_MAT); mouth.position.set(0,-0.13,0.275); head.add(mouth);
  // hair slab, glasses and cap ride the head (children -> move together)
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.58,0.16,0.58), hairMat);
  hair.position.y=0.31; head.add(hair);
  const glasses = new THREE.Mesh(new THREE.BoxGeometry(0.48,0.11,0.05), MAT.chair);
  glasses.position.set(0,0.05,0.28); glasses.visible = !!outfit.glasses; head.add(glasses);
  const hatG = new THREE.Group(); hatG.position.y=0.31; hatG.visible = !!outfit.hat;
  const crown = new THREE.Mesh(new THREE.BoxGeometry(0.52,0.26,0.52), M(outfit.shirt,{r:0.6})); crown.position.y=0.13; hatG.add(crown);
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.68,0.05,0.32), M(outfit.shirt,{r:0.6})); brim.position.set(0,0.02,0.31); hatG.add(brim);
  head.add(hatG);

  // floating hands (little cubes, no arms)
  const handL = new THREE.Mesh(new THREE.BoxGeometry(0.18,0.18,0.18), skinMat);
  handL.position.set(-0.52,0.78,0.18); handL.castShadow=true; handL.userData.baseY=0.78; handL.userData.baseX=-0.52; g.add(handL);
  const handR = new THREE.Mesh(new THREE.BoxGeometry(0.18,0.18,0.18), skinMat);
  handR.position.set(0.52,0.78,0.18); handR.castShadow=true; handR.userData.baseY=0.78; handR.userData.baseX=0.52; g.add(handR);

  g.userData.parts = { shirtMat, pantsMat, skinMat, hairMat, glasses, hatG, crown, brim, torso, head, handL, handR, eyeL, eyeR, mouth };
  return g;
}
function applyOutfit(worker, o){
  const p = worker.root.userData.parts;
  p.shirtMat.color.setHex(o.shirt); p.pantsMat.color.setHex(o.pants);
  p.skinMat.color.setHex(o.skin); p.hairMat.color.setHex(o.hair);
  p.crown.material.color.setHex(o.shirt); p.brim.material.color.setHex(o.shirt);
  p.glasses.visible = !!o.glasses; p.hatG.visible = !!o.hat;
}

// ---------- agents ----------
const agents = new Map();
let nextSeat = 0;
const overlay = document.body;
const projV = new THREE.Vector3();
function toScreen(obj, y){ obj.getWorldPosition(projV); projV.y += (y||0); projV.project(camera);
  return { x:(projV.x*0.5+0.5)*innerWidth, y:(-projV.y*0.5+0.5)*innerHeight, vis:projV.z<1 }; }

function makeAgent(ev){
  const isOrch = ev.role === 'orchestrator';
  const seat = isOrch ? ORCH_SEAT : (seats[nextSeat++ % seats.length]);
  const outfit = loadOutfit(ev.label, ev.role);
  const root = buildWorker(outfit);
  root.position.set(seat.x, 0, seat.z); root.rotation.y = seat.rot;
  root.userData.agentId = ev.id;
  scene.add(root);
  if (!isOrch) chair(seat.x, seat.z + (seat.rot === 0 ? 0.15 : -0.15), seat.rot);

  const tag = document.createElement('div'); tag.className='tag'; tag.textContent = ev.label; overlay.appendChild(tag);
  const a = { id: ev.id, label: ev.label, role: ev.role, seat, root, outfit, status:'spawning',
    tag, bubble:null, bubbleUntil:0, phase: Math.random()*6, intensity:0.5, done:false,
    state:'sit', queue:[], pauseUntil:0, walkPhase:0, blinkAt: performance.now()+rand(1500,5000), nextWander: performance.now()+rand(6000,14000) };
  agents.set(ev.id, a);
  document.getElementById('empty').style.display='none';
  refreshStats();
  return a;
}
function setStatus(a, status){
  a.status = status;
  const c = STATUS_COLORS[status] ?? 0x94a3b8;
  const t = a.root.userData.parts.torso;
  t.material.emissive.setHex(c); t.material.emissiveIntensity = status==='working'?0.35:0.15;
  a.intensity = status==='working'?1.5 : status==='thinking'?0.8 : 0.3;
  refreshStats();
}
function speak(a, text){
  if (!a.bubble){ a.bubble=document.createElement('div'); a.bubble.className='bubble'; overlay.appendChild(a.bubble); }
  a.bubble.textContent = text.length>120 ? text.slice(0,117)+'…' : text;
  a.bubble.style.opacity='1'; a.bubbleUntil = performance.now()+4500;
}

const links = [];
function link(fromId, toId, text){
  const a = agents.get(fromId); if (!a) return;
  const targets = toId==='all' ? [...agents.values()].filter(x=>x!==a) : [agents.get(toId)].filter(Boolean);
  for (const b of targets){
    const s = a.root.position.clone(); s.y=1.7;
    const e = b.root.position.clone(); e.y=1.7;
    const mid = s.clone().add(e).multiplyScalar(0.5); mid.y += 2.6 + s.distanceTo(e)*0.08;
    const curve = new THREE.QuadraticBezierCurve3(s, mid, e);
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve,20,0.035,6,false), new THREE.MeshBasicMaterial({color:0x38bdf8,transparent:true,opacity:0.9}));
    scene.add(mesh); links.push({ mesh, mat: mesh.material, until: performance.now()+1600 });
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.12,8,8), new THREE.MeshBasicMaterial({color:0x7dd3fc}));
    scene.add(dot); links.push({ mesh: dot, mat: dot.material, until: performance.now()+1600, curve, born: performance.now(), dur: 1600, dot });
  }
  if (text) speak(a, text);
}

function refreshStats(){
  const all=[...agents.values()];
  document.getElementById('s-agents').textContent=all.length;
  document.getElementById('s-active').textContent=all.filter(a=>!a.done && a.status!=='done').length;
  document.getElementById('s-done').textContent=all.filter(a=>a.done||a.status==='done').length;
}
function addBoard(who, note){
  const list=document.getElementById('board-list'); const el=document.createElement('div'); el.className='note';
  const w=document.createElement('span'); w.className='who'; w.textContent=(agents.get(who)?.label ?? who)+':'; el.appendChild(w);
  el.appendChild(document.createTextNode(' '+note)); list.prepend(el);
  while(list.children.length>40) list.lastChild.remove();
}
function addLog(who, msg){
  const list=document.getElementById('log-list'); const el=document.createElement('div'); el.className='row';
  const w=document.createElement('span'); w.className='who'; w.textContent=(agents.get(who)?.label ?? who)+' '; el.appendChild(w);
  el.appendChild(document.createTextNode(msg)); list.prepend(el);
  while(list.children.length>60) list.lastChild.remove();
}

function handle(ev){
  switch(ev.type){
    case 'agent_spawned': if(!agents.has(ev.id)){ makeAgent(ev); addLog(ev.id,'joined as '+ev.role); } break;
    case 'agent_status': { const a=agents.get(ev.id); if(a) setStatus(a, ev.status); break; }
    case 'agent_tool': { const a=agents.get(ev.id); if(a && ev.phase==='start'){ setStatus(a,'working'); addLog(ev.id, ev.tool+' '+ev.summary); } break; }
    case 'agent_message': { const a=agents.get(ev.id); if(a){ speak(a,ev.text); addLog(ev.id,ev.text); } break; }
    case 'communication': link(ev.from, ev.to, ev.text); addLog(ev.from, '→ '+(ev.to==='all'?'everyone':(agents.get(ev.to)?.label ?? ev.to))+(ev.text?': '+ev.text:'')); break;
    case 'blackboard': addBoard(ev.id, ev.note); { const a=agents.get(ev.id); if(a) link(ev.id,'all'); } break;
    case 'agent_done': { const a=agents.get(ev.id); if(a){ setStatus(a, ev.status==='error'?'error':'done'); a.done=true; addLog(ev.id,'finished ('+ev.status+')'); } break; }
  }
}

// ---------- SSE ----------
const es = new EventSource('/events');
es.addEventListener('snapshot', (e)=>{ const snap=JSON.parse(e.data); for(const ev of snap.events) handle(ev); });
es.onmessage = (e)=>{ try{ handle(JSON.parse(e.data)); }catch{} };

// ---------- click to customize ----------
const ray = new THREE.Raycaster(); const ptr = new THREE.Vector2();
let downX=0, downY=0, selected=null;
renderer.domElement.addEventListener('pointerdown', (e)=>{ downX=e.clientX; downY=e.clientY; });
renderer.domElement.addEventListener('pointerup', (e)=>{
  if (Math.hypot(e.clientX-downX, e.clientY-downY) > 5) return; // was a drag
  ptr.x=(e.clientX/innerWidth)*2-1; ptr.y=-(e.clientY/innerHeight)*2+1;
  ray.setFromCamera(ptr, camera);
  const roots=[...agents.values()].map(a=>a.root);
  const hits=ray.intersectObjects(roots, true);
  if (hits.length){ let o=hits[0].object; while(o && o.userData.agentId===undefined) o=o.parent; if(o) openCustomize(o.userData.agentId); }
});

const CZ = document.getElementById('customize');
function swatches(hostId, colors, get, set){
  const host=document.getElementById(hostId); host.innerHTML='';
  for(const c of colors){ const b=document.createElement('button');
    b.style.background='#'+c.toString(16).padStart(6,'0');
    if(get()===c) b.classList.add('on');
    b.onclick=()=>{ set(c); renderCustomize(); }; host.appendChild(b); }
}
function openCustomize(id){ selected=id; renderCustomize(); CZ.style.display='block'; }
function renderCustomize(){
  const a=agents.get(selected); if(!a){ CZ.style.display='none'; return; }
  document.getElementById('cz-who').textContent=a.label+' · '+a.role;
  const o=a.outfit; const commit=()=>{ applyOutfit(a,o); saveOutfit(a.label,o); };
  swatches('cz-shirt', SHIRTS, ()=>o.shirt, v=>{o.shirt=v;commit();});
  swatches('cz-pants', PANTS, ()=>o.pants, v=>{o.pants=v;commit();});
  swatches('cz-hair', HAIR, ()=>o.hair, v=>{o.hair=v;commit();});
  swatches('cz-skin', SKIN, ()=>o.skin, v=>{o.skin=v;commit();});
  const gb=document.getElementById('cz-glasses'), hb=document.getElementById('cz-hat');
  gb.classList.toggle('on', !!o.glasses); hb.classList.toggle('on', !!o.hat);
  gb.onclick=()=>{ o.glasses=!o.glasses; commit(); renderCustomize(); };
  hb.onclick=()=>{ o.hat=!o.hat; commit(); renderCustomize(); };
}
document.getElementById('cz-close').onclick=()=>{ CZ.style.display='none'; selected=null; };
document.getElementById('cz-random').onclick=()=>{ const a=agents.get(selected); if(!a) return;
  const r=()=>Math.floor(Math.random()*1e9);
  a.outfit={ shirt:SHIRTS[r()%SHIRTS.length], pants:PANTS[r()%PANTS.length], hair:HAIR[r()%HAIR.length], skin:SKIN[r()%SKIN.length], glasses:r()%2===0, hat:r()%3===0 };
  applyOutfit(a,a.outfit); saveOutfit(a.label,a.outfit); renderCustomize(); };

// ---------- animation ----------
const clock = new THREE.Clock();
function animate(){
  requestAnimationFrame(animate);
  const dt=clock.getDelta(); const now=performance.now();
  for(const a of agents.values()){
    a.phase += dt*(1+a.intensity);
    const pt=a.root.userData.parts;

    // ---- walk / sit state machine ----
    if (a.state==='sit'){
      a.root.position.y = Math.sin(a.phase*4)*0.02*a.intensity;
      if (!a.done && now > a.nextWander){
        const poi = WALK_POI[Math.floor(Math.random()*WALK_POI.length)];
        a.queue = [ {x:poi.x,z:poi.z}, {x:a.seat.x,z:a.seat.z,seatRot:a.seat.rot} ];
        a.state='walk'; a.pauseUntil=0;
      }
    }
    if (a.state==='walk'){
      if (now < a.pauseUntil){
        // standing at a hangout spot, gentle idle
        a.root.position.y = Math.sin(a.phase*3)*0.01;
      } else {
        const tgt=a.queue[0];
        const dx=tgt.x-a.root.position.x, dz=tgt.z-a.root.position.z;
        const d=Math.hypot(dx,dz);
        if (d < 0.1){
          a.queue.shift();
          if (a.queue.length===0){ a.state='sit'; a.root.rotation.y = tgt.seatRot ?? a.seat.rot; a.root.position.y=0; scheduleWander(a, now); }
          else { a.pauseUntil = now + rand(2500,5000); } // chat at the spot
        } else {
          const step=Math.min(2.4*dt, d);
          a.root.position.x += dx/d*step; a.root.position.z += dz/d*step;
          a.root.rotation.y = Math.atan2(dx, dz);          // face heading (model faces +Z)
          a.walkPhase += dt*10;
          a.root.position.y = Math.abs(Math.sin(a.walkPhase))*0.07; // little hop
        }
      }
    }

    // ---- floating head + hands ----
    pt.head.position.y = pt.head.userData.baseY + Math.sin(a.phase*2.5)*0.05;
    pt.head.rotation.z = Math.sin(a.phase*1.7)*0.06;
    const walking = a.state==='walk' && now>=a.pauseUntil;
    const hb = walking ? 0.14 : (0.03 + 0.05*a.intensity);
    const hs = walking ? a.walkPhase*1.2 : a.phase*6;
    pt.handL.position.y = pt.handL.userData.baseY + Math.sin(hs)*hb;
    pt.handR.position.y = pt.handR.userData.baseY + Math.sin(hs+Math.PI)*hb;

    // ---- blink ----
    if (now > a.blinkAt){
      const t = (now - a.blinkAt);
      const s = t < 120 ? Math.max(0.1, 1 - t/120) : Math.min(1, (t-120)/120);
      pt.eyeL.scale.y = s; pt.eyeR.scale.y = s;
      if (t > 240){ pt.eyeL.scale.y=1; pt.eyeR.scale.y=1; a.blinkAt = now + rand(2000,6000); }
    }

    const p=toScreen(a.root, 2.05);
    a.tag.style.left=p.x+'px'; a.tag.style.top=(p.y-6)+'px'; a.tag.style.display=p.vis?'block':'none';
    if(a.bubble){ if(now>a.bubbleUntil) a.bubble.style.opacity='0';
      const bp=toScreen(a.root,2.3); a.bubble.style.left=bp.x+'px'; a.bubble.style.top=(bp.y-8)+'px'; a.bubble.style.display=p.vis?'block':'none'; }
  }
  for(let i=links.length-1;i>=0;i--){ const l=links[i];
    if(l.dot&&l.curve){ const tt=Math.min(1,(now-l.born)/l.dur); l.dot.position.copy(l.curve.getPoint(tt)); }
    const life=l.until-now; if(life<=0){ scene.remove(l.mesh); l.mesh.geometry?.dispose?.(); links.splice(i,1); continue; }
    l.mat.opacity=Math.min(0.9, life/1600*0.9);
  }
  controls.update(); renderer.render(scene,camera);
}
animate();
addEventListener('resize', ()=>{ camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth,innerHeight); });
</script>
</body>
</html>`;
