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
  #board { top: 12px; right: 12px; width: 300px; max-height: 46vh; padding: 10px 12px; overflow: auto; }
  #board h2 { margin: 0 0 6px; font-size: 12px; color: #fbbf24; text-transform: uppercase; letter-spacing: 1px; }
  #board .note { font-size: 11px; line-height: 1.4; padding: 5px 7px; margin-bottom: 5px; background: rgba(251,191,36,.08); border-left: 2px solid #fbbf24; border-radius: 3px; white-space: pre-wrap; word-break: break-word; }
  #board .note .who { color: #fbbf24; font-weight: bold; }
  #log { bottom: 12px; right: 12px; width: 300px; max-height: 32vh; padding: 10px 12px; overflow: auto; font-size: 11px; }
  #log h2 { margin: 0 0 6px; font-size: 12px; color: #60a5fa; text-transform: uppercase; letter-spacing: 1px; }
  #log .row { padding: 2px 0; color: #a9b6c3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #log .row .who { color: #e6edf3; font-weight: bold; }
  #legend { bottom: 12px; left: 12px; padding: 8px 12px; font-size: 11px; }
  #legend .row { display: flex; align-items: center; gap: 6px; margin: 3px 0; }
  #legend .dot { width: 10px; height: 10px; border-radius: 50%; }
  .bubble { position: fixed; transform: translate(-50%, -100%); pointer-events: none; background: #e6edf3; color: #0b0e14; font-size: 11px; font-weight: 600; padding: 4px 8px; border-radius: 8px; max-width: 200px; box-shadow: 0 4px 14px rgba(0,0,0,.5); transition: opacity .3s; }
  .bubble::after { content: ""; position: absolute; left: 50%; bottom: -5px; transform: translateX(-50%); border: 5px solid transparent; border-top-color: #e6edf3; border-bottom: 0; }
  .tag { position: fixed; transform: translate(-50%, -50%); pointer-events: none; font-size: 10px; color: #cbd5e1; text-shadow: 0 1px 3px #000; white-space: nowrap; }
  #empty { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 10px; color: #64748b; font-size: 14px; text-align: center; }
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
  <div class="sub">hive-mind · live office view</div>
  <div class="stat"><span>agents <b id="s-agents">0</b></span><span>active <b id="s-active">0</b></span><span>done <b id="s-done">0</b></span></div>
</div>
<div class="panel" id="board"><h2>Blackboard</h2><div id="board-list"></div></div>
<div class="panel" id="log"><h2>Activity</h2><div id="log-list"></div></div>
<div class="panel" id="legend">
  <div class="row"><span class="dot" style="background:#fbbf24"></span> thinking</div>
  <div class="row"><span class="dot" style="background:#4ade80"></span> working</div>
  <div class="row"><span class="dot" style="background:#f87171"></span> blocked / error</div>
  <div class="row"><span class="dot" style="background:#64748b"></span> done</div>
</div>
<div id="empty"><div class="big">Waiting for the swarm…</div><div>Run a task with <code>/swarm</code> active — workers appear here.</div></div>

<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const ROLE_COLORS = {
  orchestrator: 0x38bdf8, explorer: 0xa78bfa, coder: 0x4ade80,
  reviewer: 0xf472b6, tester: 0xfbbf24, security: 0xf87171, worker: 0x94a3b8,
};
const STATUS_COLORS = {
  spawning: 0x64748b, thinking: 0xfbbf24, working: 0x4ade80,
  blocked: 0xf87171, done: 0x64748b, error: 0xf87171,
};

const app = document.getElementById('app');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e14);
scene.fog = new THREE.Fog(0x0b0e14, 22, 60);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 200);
camera.position.set(14, 13, 18);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
app.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 1, 0);
controls.maxPolarAngle = Math.PI / 2.1;

scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x141821, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 1.4);
key.position.set(10, 18, 8); key.castShadow = true;
key.shadow.mapSize.set(1024, 1024); key.shadow.camera.far = 60;
scene.add(key);

// Floor
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.MeshStandardMaterial({ color: 0x141a24, roughness: 0.95 })
);
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.GridHelper(60, 30, 0x1f2937, 0x161c26);
grid.position.y = 0.01; scene.add(grid);

// Central "meeting table" — the shared blackboard
const table = new THREE.Mesh(
  new THREE.CylinderGeometry(2.2, 2.2, 0.3, 24),
  new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.6 })
);
table.position.y = 0.9; table.castShadow = true; table.receiveShadow = true;
scene.add(table);
const board = new THREE.Mesh(
  new THREE.BoxGeometry(3, 1.8, 0.12),
  new THREE.MeshStandardMaterial({ color: 0x0f172a, emissive: 0xfbbf24, emissiveIntensity: 0.12 })
);
board.position.set(0, 2.4, 0); scene.add(board);

const overlay = document.body;
const projV = new THREE.Vector3();
function toScreen(obj, yOffset = 0) {
  obj.getWorldPosition(projV); projV.y += yOffset;
  projV.project(camera);
  return { x: (projV.x * 0.5 + 0.5) * innerWidth, y: (-projV.y * 0.5 + 0.5) * innerHeight, vis: projV.z < 1 };
}

// ---- Agents ----
const agents = new Map();
let ring = 0, ringPos = 0, ringCap = 6;
function deskSlot() {
  // Spiral desks outward around the meeting table.
  const radius = 5 + ring * 3;
  const cap = ringCap + ring * 4;
  const angle = (ringPos / cap) * Math.PI * 2 + ring * 0.4;
  ringPos++;
  if (ringPos >= cap) { ring++; ringPos = 0; }
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, angle };
}

function makeAgent(ev) {
  const slot = deskSlot();
  const g = new THREE.Group();
  g.position.set(slot.x, 0, slot.z);
  g.lookAt(0, 0, 0);

  // Desk
  const desk = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.12, 0.9),
    new THREE.MeshStandardMaterial({ color: 0x263243, roughness: 0.7 })
  );
  desk.position.set(0, 0.75, -0.7); desk.castShadow = true; desk.receiveShadow = true;
  g.add(desk);
  const monitor = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.55, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x0f172a, emissive: 0x1e3a5f, emissiveIntensity: 0.6 })
  );
  monitor.position.set(0, 1.15, -1.0); g.add(monitor);

  // Worker
  const roleColor = ROLE_COLORS[ev.role] ?? ROLE_COLORS.worker;
  const bodyMat = new THREE.MeshStandardMaterial({ color: roleColor, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.6, 6, 12), bodyMat);
  body.position.y = 0.95; body.castShadow = true;
  const headMat = new THREE.MeshStandardMaterial({ color: 0xf1d3b2, emissive: 0x000000 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 16), headMat);
  head.position.y = 1.55; head.castShadow = true;
  const worker = new THREE.Group();
  worker.add(body); worker.add(head);
  worker.position.set(0, 0, 0.1);
  g.add(worker);

  scene.add(g);

  const tag = document.createElement('div');
  tag.className = 'tag'; tag.textContent = ev.label;
  overlay.appendChild(tag);

  const a = {
    id: ev.id, role: ev.role, label: ev.label, group: g, worker, body, head,
    bodyMat, headMat, roleColor, status: 'spawning', tag, bubble: null, bubbleUntil: 0,
    phase: Math.random() * Math.PI * 2, intensity: 0.5,
  };
  agents.set(ev.id, a);
  document.getElementById('empty').style.display = 'none';
  refreshStats();
  return a;
}

function setStatus(a, status) {
  a.status = status;
  const c = STATUS_COLORS[status] ?? 0x94a3b8;
  a.bodyMat.emissive.setHex(c); a.bodyMat.emissiveIntensity = status === 'working' ? 0.5 : 0.28;
  a.intensity = status === 'working' ? 1.4 : status === 'thinking' ? 0.8 : 0.3;
  if (status === 'error' || status === 'blocked') a.headMat.emissive.setHex(0xf87171);
  else a.headMat.emissive.setHex(0x000000);
  refreshStats();
}

function speak(a, text) {
  if (!a.bubble) { a.bubble = document.createElement('div'); a.bubble.className = 'bubble'; overlay.appendChild(a.bubble); }
  a.bubble.textContent = text.length > 120 ? text.slice(0, 117) + '…' : text;
  a.bubble.style.opacity = '1';
  a.bubbleUntil = performance.now() + 4500;
}

// Communication links (fading arcs between two agents).
const links = [];
function link(fromId, toId, text) {
  const a = agents.get(fromId); if (!a) return;
  const targets = toId === 'all' ? [...agents.values()].filter((x) => x !== a) : [agents.get(toId)].filter(Boolean);
  for (const b of targets) {
    const start = a.group.position.clone(); start.y = 1.4;
    const end = b.group.position.clone(); end.y = 1.4;
    const mid = start.clone().add(end).multiplyScalar(0.5); mid.y += 2.5;
    const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
    const geo = new THREE.TubeGeometry(curve, 20, 0.04, 6, false);
    const mat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.9 });
    const mesh = new THREE.Mesh(geo, mat); scene.add(mesh);
    links.push({ mesh, mat, until: performance.now() + 1600 });
    // a little courier dot travelling the arc
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), new THREE.MeshBasicMaterial({ color: 0x7dd3fc }));
    scene.add(dot); links.push({ mesh: dot, mat: dot.material, until: performance.now() + 1600, curve, born: performance.now(), dur: 1600, dot });
  }
  if (text) speak(a, text);
}

function removeAgent(a, status) {
  setStatus(a, status === 'error' ? 'error' : 'done');
  a.done = true;
}

// ---- HUD ----
function refreshStats() {
  const all = [...agents.values()];
  document.getElementById('s-agents').textContent = all.length;
  document.getElementById('s-active').textContent = all.filter((a) => !a.done && a.status !== 'done').length;
  document.getElementById('s-done').textContent = all.filter((a) => a.done || a.status === 'done').length;
}
function addBoard(who, note) {
  const list = document.getElementById('board-list');
  const el = document.createElement('div'); el.className = 'note';
  el.innerHTML = '<span class="who"></span> ';
  el.firstChild.textContent = (agents.get(who)?.label ?? who) + ':';
  el.appendChild(document.createTextNode(' ' + note));
  list.prepend(el);
  while (list.children.length > 40) list.lastChild.remove();
}
function addLog(who, msg) {
  const list = document.getElementById('log-list');
  const el = document.createElement('div'); el.className = 'row';
  const w = document.createElement('span'); w.className = 'who'; w.textContent = (agents.get(who)?.label ?? who) + ' ';
  el.appendChild(w); el.appendChild(document.createTextNode(msg));
  list.prepend(el);
  while (list.children.length > 60) list.lastChild.remove();
}

// ---- Event handling ----
function handle(ev) {
  switch (ev.type) {
    case 'agent_spawned': if (!agents.has(ev.id)) { makeAgent(ev); addLog(ev.id, 'joined as ' + ev.role); } break;
    case 'agent_status': { const a = agents.get(ev.id); if (a) setStatus(a, ev.status); break; }
    case 'agent_tool': { const a = agents.get(ev.id); if (a) { if (ev.phase === 'start') { setStatus(a, 'working'); addLog(ev.id, ev.tool + ' ' + ev.summary); } } break; }
    case 'agent_message': { const a = agents.get(ev.id); if (a) { speak(a, ev.text); addLog(ev.id, ev.text); } break; }
    case 'communication': link(ev.from, ev.to, ev.text); addLog(ev.from, '→ ' + (ev.to === 'all' ? 'everyone' : (agents.get(ev.to)?.label ?? ev.to)) + (ev.text ? ': ' + ev.text : '')); break;
    case 'blackboard': addBoard(ev.id, ev.note); { const a = agents.get(ev.id); if (a) { link(ev.id, 'all'); } } break;
    case 'agent_done': { const a = agents.get(ev.id); if (a) { removeAgent(a, ev.status); addLog(ev.id, 'finished (' + ev.status + ')'); } break; }
  }
}

// ---- SSE ----
const es = new EventSource('/events');
es.addEventListener('snapshot', (e) => {
  const snap = JSON.parse(e.data);
  for (const ev of snap.events) handle(ev);
});
es.onmessage = (e) => { try { handle(JSON.parse(e.data)); } catch {} };

// ---- Animation ----
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const now = performance.now();

  for (const a of agents.values()) {
    a.phase += dt * (1 + a.intensity);
    // idle typing bob
    const bob = Math.sin(a.phase * 4) * 0.03 * a.intensity;
    a.worker.position.y = bob;
    a.head.rotation.z = Math.sin(a.phase * 2) * 0.05 * a.intensity;
    a.body.scale.y = 1 + Math.sin(a.phase * 4) * 0.02 * a.intensity;

    // labels + bubbles follow the head
    const p = toScreen(a.head, 0.4);
    a.tag.style.left = p.x + 'px'; a.tag.style.top = (p.y - 14) + 'px'; a.tag.style.display = p.vis ? 'block' : 'none';
    if (a.bubble) {
      if (now > a.bubbleUntil) { a.bubble.style.opacity = '0'; }
      const bp = toScreen(a.head, 0.9);
      a.bubble.style.left = bp.x + 'px'; a.bubble.style.top = (bp.y - 10) + 'px';
      a.bubble.style.display = p.vis ? 'block' : 'none';
    }
  }

  for (let i = links.length - 1; i >= 0; i--) {
    const l = links[i];
    if (l.dot && l.curve) { const tt = Math.min(1, (now - l.born) / l.dur); l.dot.position.copy(l.curve.getPoint(tt)); }
    const life = (l.until - now);
    if (life <= 0) { scene.remove(l.mesh); l.mesh.geometry?.dispose?.(); links.splice(i, 1); continue; }
    l.mat.opacity = Math.min(0.9, life / 1600 * 0.9);
  }

  board.material.emissiveIntensity = 0.12 + Math.abs(Math.sin(now / 700)) * 0.1;
  controls.update();
  renderer.render(scene, camera);
}
animate();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
</script>
</body>
</html>`;
