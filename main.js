import * as THREE from './vendor/three.module.js';
import { platform } from './platform.js';
import { t, setLang } from './i18n.js';
import { audio } from './audio.js';
import { loadAll, spawn, instanced, ownMaterials, PET_FILES } from './assets.js';
import { initFx, fx } from './fx.js';

// ---------------------------------------------------------------------------
// Balance / content
// ---------------------------------------------------------------------------
const RARITIES = [
  { color: '#c3c9d4', income: 1 },
  { color: '#5dd36b', income: 3 },
  { color: '#4aa3ff', income: 10 },
  { color: '#b05cff', income: 35 },
  { color: '#ffb020', income: 120 },
  { color: '#ff4fa3', income: 500 },
];
// 3 species per rarity; index = rarity * 3 + species (same order as PET_FILES)
const PET_EMOJI = ['🐤', '🐰', '🐛', '🐱', '🦊', '🐧', '🐼', '🐨', '🦜', '🐯', '🦌', '🐻‍❄️', '🦁', '🐘', '🦒', '🐝', '🐵', '🦀'];

const ZONES = [
  { z0: 40, z1: 110, ground: 0x74c646, edge: 0x58a836, egg: 0xfff4dc, guard: { speed: 5, model: 'j', n: 2, scale: 1.1 }, weights: [80, 18, 2, 0, 0, 0], hatch: 8, decor: 'meadow', arch: 0xff7a59 },
  { z0: 130, z1: 200, ground: 0x4fae55, edge: 0x2f7d3a, egg: 0xc9f29b, guard: { speed: 10, model: 'j', n: 3, scale: 1.15 }, weights: [50, 35, 13, 2, 0, 0], hatch: 15, decor: 'forest', arch: 0xa0663a },
  { z0: 220, z1: 290, ground: 0xdfeaf3, edge: 0xc4dae9, egg: 0xa6e4ff, guard: { speed: 14, model: 'j', n: 3, scale: 1.2 }, weights: [0, 45, 40, 13, 2, 0], hatch: 25, decor: 'snow', arch: 0x3b8fe0 },
  { z0: 310, z1: 380, ground: 0xf0cf86, edge: 0xd9ad5c, egg: 0xffcf6b, guard: { speed: 18, model: 'g', n: 4, scale: 1.25 }, weights: [0, 0, 50, 38, 11, 1], hatch: 40, decor: 'desert', arch: 0xd9822b },
  { z0: 400, z1: 470, ground: 0x6b4842, edge: 0x3c2724, egg: 0xff7a3d, guard: { speed: 23, model: 'h', n: 4, scale: 1.3 }, weights: [0, 0, 0, 50, 40, 10], hatch: 60, decor: 'volcano', arch: 0x8b2be2 },
];

const BASE_SPEED = 8, SPEED_STEP = 0.5;
const ROAD_HALF = 18;
const BASE_LIMIT_Z = 24;
const MAX_PENS = 12, START_PENS = 4;
const PEN_COST = [0, 0, 0, 0, 150, 400, 1200, 3500, 10000, 30000, 90000, 250000];
const speedCost = (lvl) => Math.round(25 * Math.pow(1.35, lvl));
const incomeCost = (lvl) => Math.round(500 * Math.pow(2.2, lvl));
const rebirthCost = (n) => Math.round(2.5e6 * Math.pow(3, n));
const BOOST_MS = 5 * 60 * 1000;
const AD_GAP_MS = 3 * 60 * 1000;
const BOOST_CAP_MS = 30 * 60 * 1000;   // ×2 income can be stocked up to 30 minutes
const OFFLINE_CAP_S = 3 * 3600;
const GIFT_MULT = [1, 1.5, 2, 2.5, 3, 4, 6];

// ---------------------------------------------------------------------------
// State + save (old saves from v1 load fine: new fields just get defaults)
// ---------------------------------------------------------------------------
const state = {
  coins: 0, bank: 0, speedLvl: 0, incomeLvl: 0, pens: START_PENS,
  slots: Array(MAX_PENS).fill(null), // null | {kind:'egg'|'pet', zone, rarity, species, mult, golden, hatchAt}
  best: 0, lastSeen: Date.now(), boostUntil: 0,
  rebirths: 0, index: {}, tut: 0, giftDay: '', giftStreak: 0, sound: true, music: true,
};
let pendingAway = 0;

function load(raw) {
  try {
    if (new URLSearchParams(location.search).has('reset')) return;
    if (!raw) return;
    const old = JSON.parse(raw);
    Object.assign(state, old);
    if (!Array.isArray(state.slots) || state.slots.length !== MAX_PENS) state.slots = Array(MAX_PENS).fill(null);
    if (!state.index || typeof state.index !== 'object') state.index = {};
    // v1 players already know the loop: skip the tutorial
    if (old.tut === undefined && (state.coins > 0 || state.slots.some(Boolean))) state.tut = 5;
    // pets that already hatched earned while the player was away (eggs keep hatching on real time)
    const away = Math.min(OFFLINE_CAP_S, Math.max(0, (Date.now() - (state.lastSeen || Date.now())) / 1000));
    const earned = incomePerSec() * away;
    if (earned >= 10 && away > 60) pendingAway = earned;
    else state.bank += earned;
  } catch (e) { /* storage blocked or corrupt: start fresh */ }
}
// Every save lands in localStorage at once (refresh-safe); the cloud copy is sent at most every 10 s.
let lastCloudSave = 0, cloudTimer = 0;
function save() {
  state.lastSeen = Date.now();
  const s = JSON.stringify(state);
  const wait = 10000 - (Date.now() - lastCloudSave);
  if (save.flush || wait <= 0) {
    clearTimeout(cloudTimer); cloudTimer = 0;
    lastCloudSave = Date.now();
    platform.writeSave(s);
  } else {
    platform.writeLocal(s);
    if (!cloudTimer) cloudTimer = setTimeout(() => { cloudTimer = 0; save(); }, wait);
  }
}
const flushSave = () => { save.flush = true; save(); save.flush = false; };

const rebirthIncome = (n = state.rebirths) => 1 + 0.5 * n;
const rebirthSpeed = (n = state.rebirths) => n;
const playerSpeed = () => BASE_SPEED + rebirthSpeed() + SPEED_STEP * state.speedLvl;
const boosted = () => state.boostUntil > Date.now();
const boostCost = () => Math.max(300, Math.round(incomePerSec() / (boosted() ? 2 : 1) * 180 / 50) * 50);   // ~3 min of income
const incomeMult = () => (1 + 0.1 * state.incomeLvl) * rebirthIncome() * (boosted() ? 2 : 1);
const petIncome = (p) => RARITIES[p.rarity].income * p.mult * (p.golden ? 3 : 1) * incomeMult();
function incomePerSec() {
  let s = 0;
  for (let i = 0; i < state.pens; i++) { const p = state.slots[i]; if (p && p.kind === 'pet') s += petIncome(p); }
  return s;
}
function fmt(n) {
  n = Math.floor(n);
  if (n < 1000) return String(n);
  const u = ['K', 'M', 'B', 'T', 'Qa', 'Qi'];
  let i = -1;
  while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
  return (n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : Math.floor(n)) + u[i];
}
// income per second can be fractional early on (a small Common pet earns 0.8/s)
const fmtRate = (n) => (n > 0 && n < 100 && n % 1 ? n.toFixed(1) : fmt(n));
const speciesIdx = (p) => p.rarity * 3 + p.species;
const petName = (p) => `${p.golden ? t('golden') + ' ' : ''}${t('species')[speciesIdx(p)]}`;

// ---------------------------------------------------------------------------
// Renderer / scene
// ---------------------------------------------------------------------------
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch || devicePixelRatio < 2, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const HORIZON = 0xc9e6ff;
scene.fog = new THREE.Fog(HORIZON, 95, 260);
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);

scene.add(new THREE.HemisphereLight(0xdcefff, 0x5e9440, 1.1));
const sun = new THREE.DirectionalLight(0xfff1d6, 3.0);
sun.castShadow = true;
sun.shadow.mapSize.set(isTouch ? 1024 : 2048, isTouch ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 120 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

// gradient sky dome
{
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 12), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x2b86f2) }, bottom: { value: new THREE.Color(HORIZON) } },
    vertexShader: 'varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying float h; void main(){ gl_FragColor = vec4(mix(bottom, top, smoothstep(0.0, 0.5, h)), 1.0); }',
  }));
  sky.userData.followCam = true;
  scene.add(sky);
  scene.userData.sky = sky;
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

let ramp = null;
function toonRamp() {
  if (!ramp) {
    ramp = new THREE.DataTexture(new Uint8Array([120, 120, 120, 255, 205, 205, 205, 255, 255, 255, 255, 255]), 3, 1);
    ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.needsUpdate = true;
  }
  return ramp;
}
const matCache = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshToonMaterial({ color, gradientMap: toonRamp(), ...opts }));
  return matCache.get(key);
}
const box = (w, h, d, color, opts) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
  m.castShadow = true; m.receiveShadow = true;
  return m;
};

// canvas-text sprite, redrawable
function makeLabel(text, color = '#fff', w = 256, h = 64, scale = 3) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(scale, scale * h / w, 1);
  sp.renderOrder = 10;
  sp.userData.draw = (txt, col = color) => {
    const g = c.getContext('2d');
    g.clearRect(0, 0, w, h);
    let fs = Math.floor(h * 0.62);
    g.font = `800 ${fs}px Rubik, "Trebuchet MS", sans-serif`;
    while (g.measureText(txt).width > w - 16 && fs > 10) { fs -= 2; g.font = `800 ${fs}px Rubik, "Trebuchet MS", sans-serif`; }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = Math.max(4, fs * 0.18); g.lineJoin = 'round'; g.strokeStyle = 'rgba(0,0,0,.6)';
    let x = w / 2;
    if (txt.startsWith('🪙')) {
      txt = txt.slice(2).trim();
      const r = fs * 0.42, tw = g.measureText(txt).width, x0 = w / 2 - (tw + r * 2 + 8) / 2;
      drawCoin(g, x0 + r, h / 2 + 2, r);
      x = x0 + r * 2 + 8 + tw / 2;
    }
    g.strokeText(txt, x, h / 2 + 2);
    g.fillStyle = col;
    g.fillText(txt, x, h / 2 + 2);
    tex.needsUpdate = true;
  };
  sp.userData.draw(text);
  return sp;
}

function drawCoin(g, x, y, r) {
  g.save();
  g.lineWidth = r * 0.28; g.strokeStyle = 'rgba(0,0,0,.55)';
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
  const grd = g.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
  grd.addColorStop(0, '#fff3b0'); grd.addColorStop(0.55, '#ffc531'); grd.addColorStop(1, '#d68a00');
  g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.lineWidth = r * 0.14; g.strokeStyle = '#c47a00'; g.beginPath(); g.arc(x, y, r * 0.62, 0, Math.PI * 2); g.stroke();
  g.restore();
}

// ground textures: soft tiles for the play road, noisy grass/sand outside
function tileTexture(base, alt, n = 8) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const s = 256 / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    g.fillStyle = (x + y) % 2 ? base : alt; g.fillRect(x * s, y * s, s, s);
  }
  for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`; g.fillRect(Math.random() * 256, Math.random() * 256, 3, 3); }
  const tx = new THREE.CanvasTexture(c);
  tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.colorSpace = THREE.SRGBColorSpace;
  tx.anisotropy = 4;
  return tx;
}
const hexCss = (h, k = 1) => { const c = new THREE.Color(h).multiplyScalar(k); return '#' + c.getHexString(); };

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------
const obstacles = []; // {minX,maxX,minZ,maxZ,h}
const WORLD_END = ZONES[ZONES.length - 1].z1 + 14;
const rand = (a, b) => a + Math.random() * (b - a);

function groundPlane(z0, z1, color, x0, x1, tex, rep = 6) {
  const w = x1 - x0, d = z1 - z0;
  const material = new THREE.MeshLambertMaterial({ color: tex ? 0xffffff : color, map: tex ? tex.clone() : null });
  if (material.map) { material.map.needsUpdate = true; material.map.repeat.set(w / rep, d / rep); }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
  m.rotation.x = -Math.PI / 2;
  m.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
  m.receiveShadow = true;
  scene.add(m);
  return m;
}

// a straight line of fence models from (x0,z0) to (x1,z1)
function fenceLine(list, x0, z0, x1, z1, s) {
  const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
  const n = Math.max(1, Math.round(len / s));
  const ry = Math.atan2(-dz, dx);
  const ox = Math.sin(ry) * 0.465 * s, oz = Math.cos(ry) * 0.465 * s; // models sit on a tile edge
  for (let i = 0; i < n; i++) {
    const k = (i + 0.5) / n;
    list.push({ x: x0 + dx * k + ox, z: z0 + dz * k + oz, s: len / n, sy: s, ry });
  }
}

function buildWorld() {
  // base, neutral paths and zones: road tiles inside, scenery colour outside
  const road = (z0, z1, a, b) => groundPlane(z0, z1, 0, -ROAD_HALF - 1, ROAD_HALF + 1, tileTexture(a, b), 8);
  const out = (z0, z1, color) => {
    groundPlane(z0, z1, 0, -150, -ROAD_HALF - 1, colorNoise(color), 10);
    groundPlane(z0, z1, 0, ROAD_HALF + 1, 150, colorNoise(color), 10);
  };
  road(-40, 26, '#78c94a', '#66b83c'); out(-40, 26, 0x5fae34);
  let prev = 26;
  for (const z of ZONES) {
    road(prev, z.z0, '#78c94a', '#66b83c'); out(prev, z.z0, 0x5fae34);
    road(z.z0, z.z1, hexCss(z.ground), hexCss(z.ground, 0.93)); out(z.z0, z.z1, z.edge);
    prev = z.z1;
  }
  road(prev, WORLD_END + 40, '#7a5a4a', '#6b4c3e'); out(prev, WORLD_END + 40, 0x6b4842);

  // fences along the road and around the base
  const rails = [];
  for (const side of [-1, 1]) fenceLine(rails, side * (ROAD_HALF + 0.6), -30, side * (ROAD_HALF + 0.6), WORLD_END, 3);
  fenceLine(rails, -ROAD_HALF - 0.6, -30, ROAD_HALF + 0.6, -30, 3);
  fenceLine(rails, -ROAD_HALF - 0.6, WORLD_END, ROAD_HALF + 0.6, WORLD_END, 3);
  scene.add(instanced('nature:fence_planks', rails));

  // grass tufts and flowers along the fences of the base and the paths, so the near ground is not a bare checkerboard
  const tufts = [], blooms = [];
  for (let i = 0; i < 160; i++) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const z = rand(-28, WORLD_END);
    if (ZONES.some((zn) => z > zn.z0 - 3 && z < zn.z1 + 3)) continue;
    const it = { x: side * rand(ROAD_HALF - 4.5, ROAD_HALF - 1), z, s: rand(1.8, 3), ry: rand(0, 6) };
    (Math.random() < 0.7 ? tufts : blooms).push(it);
  }
  scene.add(instanced('nature:grass_large', tufts));
  scene.add(instanced('nature:flower_yellowA', blooms));
  buildBase();
  ZONES.forEach((z, i) => buildZone(z, i));
  buildClouds();
}
const noiseCache = new Map();
function colorNoise(color) {
  if (!noiseCache.has(color)) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = hexCss(color); g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 260; i++) {
      g.fillStyle = Math.random() < 0.5 ? hexCss(color, 0.9) : hexCss(color, 1.07);
      g.beginPath(); g.arc(Math.random() * 128, Math.random() * 128, 2 + Math.random() * 6, 0, Math.PI * 2); g.fill();
    }
    const tx = new THREE.CanvasTexture(c);
    tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.colorSpace = THREE.SRGBColorSpace;
    noiseCache.set(color, tx);
  }
  return noiseCache.get(color);
}

let clouds;
function buildClouds() {
  const items = [];
  for (let i = 0; i < 40; i++) items.push({ x: rand(-140, 140), y: rand(32, 55), z: rand(-60, WORLD_END + 40), s: rand(6, 14), sy: rand(3, 6), ry: rand(0, 6) });
  clouds = instanced('prop:cloud', items);
  clouds.traverse((o) => { if (o.material) { o.material = o.material.clone(); o.material.color.set(0xffffff); o.material.emissive = new THREE.Color(0x8899aa); } });
  scene.add(clouds);
}

// scenery per zone (instanced). Each entry: [model, share, minScale, maxScale, tint?]
const DECOR = {
  meadow: [['nature:tree_default', 3, 5, 7], ['nature:tree_oak', 3, 5, 7.5], ['nature:plant_bushLarge', 2, 3, 4], ['nature:flower_redA', 3, 3, 4],
    ['nature:flower_yellowA', 3, 3, 4], ['nature:flower_purpleA', 2, 3, 4], ['nature:rock_largeA', 1, 3, 5], ['nature:crop_pumpkin', 1, 3, 4]],
  forest: [['nature:tree_pineTallA', 4, 6, 9], ['nature:tree_pineRoundA', 3, 6, 8], ['nature:tree_detailed', 3, 6, 8], ['nature:mushroom_redGroup', 2, 3, 4],
    ['nature:stump_round', 1, 3, 4], ['nature:log_stack', 1, 3, 4], ['nature:plant_bush', 2, 3, 4]],
  snow: [['nature:tree_pineRoundC', 4, 6, 9, 0xffffff], ['nature:tree_cone', 3, 6, 9, 0xffffff], ['nature:rock_largeC', 2, 3, 5, 0xe8f4ff], ['nature:rock_tallA', 1, 3, 5, 0xe8f4ff]],
  desert: [['nature:cactus_tall', 4, 4, 6], ['nature:cactus_short', 3, 4, 6], ['nature:tree_palmTall', 2, 5, 7], ['nature:tree_palmBend', 2, 5, 7], ['nature:rock_tallA', 2, 4, 7, 0xe0a860]],
  volcano: [['nature:rock_tallE', 4, 4, 8, 0x2a1a18], ['nature:rock_largeC', 3, 4, 7, 0x2a1a18], ['nature:statue_obelisk', 1, 4, 6, 0x3a2030], ['nature:campfire_stones', 1, 3, 4]],
};
function decorate(zone) {
  const sets = DECOR[zone.decor];
  const total = sets.reduce((a, s) => a + s[1], 0);
  const bins = sets.map(() => []);
  for (let i = 0; i < 70; i++) {
    let r = Math.random() * total, k = 0;
    while (r > sets[k][1]) { r -= sets[k][1]; k++; }
    const near = Math.random() < 0.35;
    const x = (Math.random() < 0.5 ? -1 : 1) * (near ? rand(ROAD_HALF + 2.5, ROAD_HALF + 9) : rand(ROAD_HALF + 9, 70));
    bins[k].push({ x, z: rand(zone.z0 - 10, zone.z1 + 10), s: rand(sets[k][2], sets[k][3]), ry: rand(0, Math.PI * 2) });
  }
  sets.forEach((s, k) => scene.add(instanced(s[0], bins[k], { shadow: s[2] >= 5, tint: s[4] ?? null, tintAmount: 0.7 })));
  if (zone.decor === 'volcano') {
    for (let i = 0; i < 14; i++) {
      const lava = new THREE.Mesh(new THREE.CircleGeometry(rand(2, 4.5), 14), new THREE.MeshBasicMaterial({ color: 0xff5a1a }));
      lava.rotation.x = -Math.PI / 2;
      const x = (Math.random() < 0.5 ? -1 : 1) * rand(ROAD_HALF + 4, 50), z = rand(zone.z0, zone.z1);
      lava.position.set(x, 0.04, z); scene.add(lava);
      embers.push(new THREE.Vector3(x, 0.2, z));
    }
  }
}
const embers = [];

// --- base --------------------------------------------------------------------
const pens = [];      // {pos, pad, lock, lockLabel, holder, label, shown}
let coinPlate, coinLabel, coinStack, shopPad;
const SPAWN = new THREE.Vector3(0, 0, 12);

function buildBase() {
  const sign = makeLabel(t('yourBase'), '#ffd84a', 512, 96, 10);
  sign.position.set(0, 7, -27); scene.add(sign);
  const line = box(ROAD_HALF * 2, 0.06, 0.6, 0x3fcf5e, { emissive: 0x0c4a18 }); line.position.set(0, 0.03, BASE_LIMIT_Z); scene.add(line);

  const penFences = [];
  for (let i = 0; i < MAX_PENS; i++) {
    const row = Math.floor(i / 6), col = i % 6;
    const pos = new THREE.Vector3(-12.5 + col * 5, 0, -4 - row * 9);
    const pad = box(4.2, 0.24, 4.2, 0x9be37a); pad.position.set(pos.x, 0.12, pos.z); scene.add(pad);
    const lock = makeLabel('🔒', '#fff', 128, 128, 2.2); lock.position.set(pos.x, 1.6, pos.z); scene.add(lock);
    const lockLabel = makeLabel('', '#ffd84a', 256, 64, 3.6); lockLabel.position.set(pos.x, 3.0, pos.z); scene.add(lockLabel);
    const holder = new THREE.Group(); holder.position.set(pos.x, 0.24, pos.z); scene.add(holder);
    const label = makeLabel('', '#fff', 256, 64, 3.4); label.position.set(pos.x, 3.6, pos.z); scene.add(label);
    pens.push({ pos, pad, lock, lockLabel, holder, label, shown: null });
    const h = 2.2;
    fenceLine(penFences, pos.x - h, pos.z - h, pos.x + h, pos.z - h, 1.1);
    fenceLine(penFences, pos.x - h, pos.z + h, pos.x - h, pos.z - h, 1.1);
    fenceLine(penFences, pos.x + h, pos.z - h, pos.x + h, pos.z + h, 1.1);
  }
  scene.add(instanced('nature:fence_simple', penFences));

  coinPlate = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.5, 0.3, 32), mat(0xffc531, { emissive: 0x5a3c00 }));
  coinPlate.position.set(-9, 0.15, 12); coinPlate.receiveShadow = true; scene.add(coinPlate);
  coinStack = new THREE.Group(); coinStack.position.set(-9, 0.3, 12); scene.add(coinStack);
  for (let i = 0; i < 12; i++) {
    const c = spawn('prop:coin', { scale: 2.2 });
    const a = (i / 12) * Math.PI * 2;
    c.position.set(Math.cos(a) * (0.6 + (i % 3) * 0.45), 0, Math.sin(a) * (0.6 + (i % 3) * 0.45));
    c.rotation.y = a; c.visible = false;
    coinStack.add(c);
  }
  coinLabel = makeLabel('🪙 0', '#ffd84a', 256, 64, 4.2); coinLabel.position.set(-9, 3.0, 12); scene.add(coinLabel);
  const collect = makeLabel(t('collect'), '#fff', 256, 64, 3); collect.position.set(-9, 1.9, 12); scene.add(collect);

  shopPad = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.5, 0.3, 32), mat(0x3aa0ff, { emissive: 0x0a2d5a }));
  shopPad.position.set(9, 0.15, 12); scene.add(shopPad);
  const shopLabel = makeLabel('🛒 ' + t('shopPad'), '#fff', 256, 64, 3.6); shopLabel.position.set(9, 2.2, 12); scene.add(shopLabel);

  // flags at the base corners
  for (const [x, z] of [[-ROAD_HALF + 1, -28], [ROAD_HALF - 1, -28], [-ROAD_HALF + 1, BASE_LIMIT_Z], [ROAD_HALF - 1, BASE_LIMIT_Z]]) {
    const f = spawn('prop:flag', { scale: 2.6, shadow: true }); f.position.set(x, 0, z); scene.add(f);
  }
}

// --- zones -----------------------------------------------------------------
const nests = [];   // {zone, pos, egg, available, respawnAt}
const guards = [];  // {zone, mesh, state, target, alert, wait}

function buildZone(zone, zi) {
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 7, 10), mat(zone.arch)); post.castShadow = true;
    post.position.set(side * (ROAD_HALF - 0.6), 3.5, zone.z0); scene.add(post);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), mat(0xffd84a, { emissive: 0x4a3a00 }));
    ball.position.set(side * (ROAD_HALF - 0.6), 7.6, zone.z0); scene.add(ball);
  }
  const beam = box(ROAD_HALF * 2 - 1, 1.3, 0.8, zone.arch); beam.position.set(0, 6.4, zone.z0); scene.add(beam);
  const title = makeLabel(`${zi + 1}. ${t('zone')[zi].toUpperCase()}`, '#fff', 512, 96, 10); title.position.set(0, 8.8, zone.z0); scene.add(title);
  zone.speedLabel = makeLabel('', '#fff', 512, 80, 6); zone.speedLabel.position.set(0, 4.8, zone.z0 - 0.7); scene.add(zone.speedLabel);

  decorate(zone);

  // fences to jump over or go around (a gap on one side)
  const len = zone.z1 - zone.z0;
  const fences = [];
  for (let k = 1; k <= 2; k++) {
    const z = zone.z0 + len * (k / 3);
    const gapLeft = Math.random() < 0.5;
    const w = ROAD_HALF * 2 - 7;
    const cx = gapLeft ? 3.5 : -3.5;
    fenceLine(fences, cx - w / 2, z, cx + w / 2, z, 2.6);
    obstacles.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: z - 0.4, maxZ: z + 0.4, h: 0.9 });
  }
  scene.add(instanced('nature:fence_simple', fences, { shadow: true }));

  // nests near the far end
  const straw = [];
  for (const x of [-10, 0, 10]) {
    const pos = new THREE.Vector3(x + rand(-2, 2), 0, zone.z1 - rand(4, 12));
    const nest = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.45, 8, 18), mat(0xc79a52));
    nest.rotation.x = -Math.PI / 2; nest.position.set(pos.x, 0.35, pos.z); nest.castShadow = true; scene.add(nest);
    for (let k = 0; k < 4; k++) straw.push({ x: pos.x + Math.cos(k * 1.6) * 1.4, z: pos.z + Math.sin(k * 1.6) * 1.4, s: 2.5, ry: k });
    const egg = makeEgg(zone.egg, 1);
    egg.position.set(pos.x, 0.95, pos.z); scene.add(egg);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(1.6, 24), new THREE.MeshBasicMaterial({ color: 0xffffaa, transparent: true, opacity: 0.35, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2; glow.position.set(pos.x, 0.05, pos.z); scene.add(glow);
    nests.push({ zone: zi, pos, egg, glow, available: true, respawnAt: 0 });
  }
  scene.add(instanced('nature:grass_large', straw));

  for (let g = 0; g < zone.guard.n; g++) {
    const mesh = spawn('char:' + zone.guard.model, { scale: zone.guard.scale });
    mesh.position.set(rand(-ROAD_HALF + 2, ROAD_HALF - 2), 0, rand(zone.z1 - 14, zone.z1 - 1));
    scene.add(mesh);
    mesh.userData.play?.('idle');
    const alert = makeLabel('!', '#ff3b3b', 64, 64, 1.8); alert.position.y = 3.9 * zone.guard.scale; alert.visible = false; mesh.add(alert);
    guards.push({ zone: zi, mesh, state: 'return', target: new THREE.Vector3(), alert, wait: 0, vy: 0 });
  }
}

function makeEgg(color, s) {
  const g = new THREE.Group();
  const egg = new THREE.Mesh(new THREE.SphereGeometry(0.6 * s, 20, 14), mat(color, { emissive: new THREE.Color(color).multiplyScalar(0.18) }));
  egg.scale.y = 1.3; egg.castShadow = true;
  g.add(egg);
  const spotMat = mat(new THREE.Color(color).offsetHSL(0.5, 0.2, -0.15).getHex());
  for (let i = 0; i < 6; i++) {
    const sp = new THREE.Mesh(new THREE.SphereGeometry(0.13 * s, 8, 6), spotMat);
    const a = (i / 6) * Math.PI * 2 + rand(-0.3, 0.3), h = rand(-0.35, 0.45);
    sp.position.set(Math.cos(a) * 0.55 * s * Math.sqrt(1 - h * h), h * 0.75 * s, Math.sin(a) * 0.55 * s * Math.sqrt(1 - h * h));
    sp.scale.set(1, 1, 0.5); sp.lookAt(0, h * 0.75 * s, 0);
    g.add(sp);
  }
  return g;
}

// pet model: golden pets get gold materials, Mythic ones a shifting cosmic glow
function makePet(p) {
  const root = spawn('pet:' + PET_FILES[speciesIdx(p)], { scale: 0.95 * p.mult });
  if (p.golden || p.rarity === 5) {
    const mats = ownMaterials(root);
    for (const m of mats) {
      if (p.golden) { m.color.lerp(new THREE.Color(0xffd23a), 0.55); m.emissive = new THREE.Color(0x5a3a00); }
    }
    root.userData.cosmic = p.rarity === 5 ? mats : null;
  }
  if (p.rarity >= 3 || p.golden) {
    const glow = new THREE.Mesh(new THREE.RingGeometry(1.3, 1.75, 32), new THREE.MeshBasicMaterial({ color: p.golden ? 0xffd23a : RARITIES[p.rarity].color, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = 0.04; root.add(glow);
    root.userData.glow = glow;
  }
  root.userData.play?.('idle');
  return root;
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------
let player;
const vel = new THREE.Vector3();
let onGround = true, controlLock = 0;
let carrying = null;
const carryEgg = new THREE.Group();

function buildPlayer() {
  player = spawn('char:r', { scale: 1.05 });
  player.position.copy(SPAWN);
  player.rotation.y = Math.PI;
  carryEgg.position.y = 4.1;
  player.add(carryEgg);
  scene.add(player);
  player.userData.play?.('idle');
  // the cover shows a ninja with a red belt and headband: add both so the hero reads the same in game
  const bb = new THREE.Box3().setFromObject(player.userData.model);
  const h = bb.max.y - bb.min.y, w = (bb.max.x - bb.min.x) * 0.62, d = (bb.max.z - bb.min.z) * 0.62;
  const red = mat(0xff4d4d, { emissive: 0x3a0000 });
  const belt = new THREE.Mesh(new THREE.BoxGeometry(w * 1.06, h * 0.045, d * 1.06), red);
  belt.position.y = bb.min.y + h * 0.40; player.add(belt);
  const band = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, h * 0.03, d * 0.9), red);
  band.position.y = bb.min.y + h * 0.80; player.add(band);
}

// guide: a bouncing arrow over the target + chevrons on the ground from the player
const guide = new THREE.Group();
const guideArrow = new THREE.Group();
const chevrons = [];
function buildGuide() {
  const m = new THREE.MeshBasicMaterial({ color: 0xffe04a });
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.4, 4), m); cone.rotation.x = Math.PI; cone.position.y = 0;
  const stick = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.2, 0.5), m); stick.position.y = 1.2;
  guideArrow.add(cone, stick);
  scene.add(guideArrow);
  const shape = new THREE.Shape(); shape.moveTo(-0.7, -0.3); shape.lineTo(0, 0.35); shape.lineTo(0.7, -0.3); shape.lineTo(0.7, -0.65); shape.lineTo(0, 0); shape.lineTo(-0.7, -0.65);
  const cg = new THREE.ShapeGeometry(shape);
  for (let i = 0; i < 6; i++) {
    const c = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ color: 0xffe04a, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
    c.rotation.x = -Math.PI / 2; guide.add(c); chevrons.push(c);
  }
  scene.add(guide);
  guide.visible = guideArrow.visible = false;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const keys = {};
let camYaw = Math.PI, camPitch = 0.42, camDist = 12;
let camYawTarget = null;
let introT = 0;             // seconds left of the opening camera flight (first play only)
const INTRO_S = 2.8;
let jumpQueued = false;
const joy = { active: false, id: null, x: 0, y: 0, cx: 0, cy: 0 };
if (isTouch) document.body.classList.add('touch');

window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  introT = Math.min(introT, 0.35);
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.code === 'Space') jumpQueued = true;
  // Esc closes a window, or pauses the game behind the settings window (Poki asks for an Esc pause)
  if (e.code === platform.pauseKey) { if (panelOpen) closePanels(); else if (started && !platform.ownAudioControl) openPanel('settingsPanel'); }
  audio.unlock();
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

let drag = null;
canvas.addEventListener('pointerdown', (e) => { introT = Math.min(introT, 0.35); camYawTarget = null; drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ } audio.unlock(); });
canvas.addEventListener('pointermove', (e) => {
  if (!drag || drag.id !== e.pointerId) return;
  camYaw -= (e.clientX - drag.x) * 0.006;
  camPitch = Math.min(1.15, Math.max(0.15, camPitch + (e.clientY - drag.y) * 0.004));
  drag.x = e.clientX; drag.y = e.clientY;
});
const endDrag = (e) => { if (drag && drag.id === e.pointerId) drag = null; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', (e) => { camDist = Math.min(20, Math.max(7, camDist + e.deltaY * 0.01)); }, { passive: true });
window.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });   // the page itself never scrolls (Poki)
// no context menu, selection, pinch-zoom or double-tap zoom anywhere (portal requirement)
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('selectstart', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

const zoneEl = document.getElementById('touchzone'), joyEl = document.getElementById('joy'), knob = document.getElementById('joyknob');
if (isTouch) joyEl.classList.add('idle');
zoneEl.addEventListener('pointerdown', (e) => {
  if (joy.active) return;
  const r = zoneEl.getBoundingClientRect();
  Object.assign(joy, { active: true, id: e.pointerId, cx: e.clientX, cy: e.clientY });
  joyEl.classList.remove('idle');
  joyEl.style.display = 'block'; joyEl.style.left = (e.clientX - r.left) + 'px'; joyEl.style.top = (e.clientY - r.top) + 'px';
  try { zoneEl.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
  moveJoy(e); audio.unlock();
});
zoneEl.addEventListener('pointermove', (e) => { if (joy.active && e.pointerId === joy.id) moveJoy(e); });
const endJoy = (e) => {
  if (e.pointerId !== joy.id) return;
  joy.active = false; joy.x = joy.y = 0; knob.style.transform = '';
  joyEl.style.left = joyEl.style.top = ''; joyEl.classList.add('idle');
};
zoneEl.addEventListener('pointerup', endJoy);
zoneEl.addEventListener('pointercancel', endJoy);
function moveJoy(e) {
  let dx = e.clientX - joy.cx, dy = e.clientY - joy.cy;
  const max = 50, d = Math.hypot(dx, dy);
  if (d > max) { dx *= max / d; dy *= max / d; }
  joy.x = dx / max; joy.y = dy / max;
  knob.style.transform = `translate(${dx}px, ${dy}px)`;
}
document.getElementById('jumpbtn').addEventListener('pointerdown', (e) => { e.preventDefault(); jumpQueued = true; audio.unlock(); });

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
function applyTexts() {
  document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
  $('logo').innerHTML = t('title').replace(/(ЯИЦ|EGG)/, '$1 <span class="egg">🥚</span>');
  $('controlsText').textContent = isTouch ? t('controlsTouch') : t('controlsPc');
  $('carry').textContent = '🥚 ' + t('carry');
  document.title = t('docTitle');
}
// the coin emoji looks grey on some systems: draw our own gold coin instead
const COIN_HTML = '<i class="cn"></i>';
const coinify = (el) => { if (el.innerHTML.includes('🪙')) el.innerHTML = el.innerHTML.replaceAll('🪙', COIN_HTML); return el; };
function toast(text, color = '#fff', ms = 2300) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = text; el.style.color = color;
  if (ms !== 2300) el.style.cssText += `;animation-duration:${ms - 100}ms;white-space:normal;max-width:min(640px,calc(100vw - 32px));text-align:center`;
  coinify(el);
  $('toasts').appendChild(el);
  while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
  setTimeout(() => el.remove(), ms);
}
function flash() { $('flash').style.opacity = 0.45; setTimeout(() => ($('flash').style.opacity = 0), 180); }
const bumpCoins = () => { const c = $('coinChip'); c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); };

let panelOpen = null;
const RENDER = { caughtPanel: () => {}, shopPanel: () => renderShop(), petsPanel: () => renderPets(), indexPanel: () => renderIndex(), rebirthPanel: () => renderRebirth(), giftPanel: () => renderGift(), settingsPanel: () => renderSettings(), awayPanel: () => {} };
function openPanel(id) {
  if (!panelOpen && started) platform.gameplayStop();
  document.querySelectorAll('.panel').forEach((p) => p.classList.remove('open'));
  panelOpen = id;
  $(id).classList.add('open');
  RENDER[id]();
  audio.play('open', { vol: 0.6 });
}
function closePanels() {
  if (!panelOpen || panelOpen === 'awayPanel' || panelOpen === 'caughtPanel') return;
  document.querySelectorAll('.panel').forEach((p) => p.classList.remove('open'));
  if (started) platform.gameplayStart();
  panelOpen = null;
  audio.play('close', { vol: 0.5 });
}
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closePanels));
document.querySelectorAll('.panel').forEach((p) => p.addEventListener('pointerdown', (e) => { if (e.target === p) closePanels(); }));
$('btnShop').addEventListener('click', () => openPanel('shopPanel'));
$('btnPets').addEventListener('click', () => openPanel('petsPanel'));
$('btnIndex').addEventListener('click', () => openPanel('indexPanel'));
$('btnRebirth').addEventListener('click', () => openPanel('rebirthPanel'));
$('btnGift').addEventListener('click', () => openPanel('giftPanel'));
$('gear').addEventListener('click', () => openPanel('settingsPanel'));
if (platform.ownAudioControl) $('gear').classList.add('hidden');   // the portal's own mute switch is the only one

function row(ico, title, desc, icoBg) {
  const r = document.createElement('div');
  r.className = 'row';
  r.innerHTML = `<div class="ico"${icoBg ? ` style="background:${icoBg}"` : ''}>${ico}</div><div class="txt"><b></b><span></span></div>`;
  r.querySelector('b').textContent = title; r.querySelector('span').textContent = desc;
  coinify(r.querySelector('.txt'));
  return r;
}
function button(label, cls, onClick, disabled = false) {
  const b = document.createElement('button');
  b.className = 'btn ' + cls; b.textContent = label; b.disabled = disabled;
  coinify(b);
  b.addEventListener('click', () => { audio.unlock(); onClick(b); });
  return b;
}

function renderShop() {
  const list = $('shopList');
  list.innerHTML = '';
  const buyRow = (ico, title, desc, cost, buy) => {
    const r = row(ico, title, desc);
    if (cost != null) r.appendChild(button(`🪙 ${fmt(cost)}`, 'green', () => {
      if (state.coins < cost) { audio.play('error'); return; }
      state.coins -= cost; buy(); audio.play('buy'); save(); renderShop(); updateHud(true);
    }, state.coins < cost));
    list.appendChild(r);
  };
  buyRow('👟', `${t('speed')} ${playerSpeed().toFixed(1)} → ${(playerSpeed() + SPEED_STEP).toFixed(1)}`, t('speedDesc'), speedCost(state.speedLvl), () => {
    state.speedLvl++;
    if (state.tut === 4) advanceTut();
  });
  if (state.pens < MAX_PENS) buyRow('🏠', t('pen', { a: state.pens + 1, b: MAX_PENS }), t('penDesc'), PEN_COST[state.pens], () => { state.pens++; audio.play('unlock'); });
  else buyRow('🏠', t('pensAll'), t('pensAllDesc'), null);
  buyRow('📈', t('income'), t('incomeDesc', { m: incomeMult().toFixed(1) }), incomeCost(state.incomeLvl), () => state.incomeLvl++);
  {
    // ×2 income: watch an ad OR pay coins; capped so the offer never stacks forever
    const leftMs = Math.max(0, state.boostUntil - Date.now());
    const full = leftMs > BOOST_CAP_MS - BOOST_MS;
    const r = row('🚀', leftMs ? t('boostOn', { m: Math.ceil(leftMs / 60000) }) : t('boostOff'), full ? t('boostFull') : t(platform.hasRewarded ? 'boostDesc' : 'boostDescCoins'));
    const give = () => { state.boostUntil = Math.max(Date.now(), state.boostUntil) + BOOST_MS; audio.play('buy'); toast(t('boostToast') + ' 🚀', '#ffd84a'); save(); };
    if (!full) {
      const cost = boostCost();
      r.appendChild(button(`🪙 ${fmt(cost)}`, 'green', () => {
        if (state.coins < cost) { audio.play('error'); return; }
        state.coins -= cost; give(); renderShop(); updateHud(true);
      }, state.coins < cost));
      if (platform.hasRewarded) r.appendChild(button(`🎬 ${t('watch')}`, platform.adColor === 'green' ? 'orange' : platform.adColor, async (b) => {
        b.disabled = true;
        const ok = await withAd((onStart) => platform.rewarded(onStart));
        if (ok) give(); else toast(t('noAd'), '#ff9a5a');
        renderShop(); updateHud(true);
      }));
    }
    list.appendChild(r);
  }
  const next = ZONES.findIndex((z) => z.guard.speed >= playerSpeed());
  list.appendChild(next >= 0
    ? row('🗺️', t('nextGoal', { z: t('zone')[next] }), t('nextGoalDesc', { g: ZONES[next].guard.speed }))
    : row('🗺️', t('allGoal'), t('allGoalDesc')));
}

function renderPets() {
  const list = $('petsList');
  list.innerHTML = '';
  let any = false;
  state.slots.slice(0, state.pens).forEach((p, i) => {
    if (!p) return;
    any = true;
    if (p.kind === 'egg') {
      const left = Math.max(0, Math.ceil((p.hatchAt - Date.now()) / 1000));
      list.appendChild(row('🥚', t('eggOf', { z: t('zone')[p.zone] }), t('hatchesIn', { s: left })));
    } else {
      const r = RARITIES[p.rarity];
      const value = Math.round(petIncome(p) * 20);
      const el = row(PET_EMOJI[speciesIdx(p)], petName(p), `${t('rarity')[p.rarity]} · ${t('size')} ×${p.mult.toFixed(2)} · ${fmtRate(petIncome(p))}${t('perSec')}`, r.color + '66');
      el.querySelector('b').style.color = p.golden ? '#ffd23a' : r.color;
      el.appendChild(button(`${t('sell')} 🪙 ${fmt(value)}`, 'orange', () => {
        state.coins += value; state.slots[i] = null; audio.play('coin'); bumpCoins(); save(); renderPets(); updateHud(true);
      }));
      list.appendChild(el);
    }
  });
  if (!any) list.innerHTML = `<div class="empty">${t('noPets')}</div>`;
}

const indexKey = (r, s) => `${r}_${s}`;
function renderIndex() {
  const grid = $('indexGrid');
  grid.innerHTML = '';
  let found = 0;
  for (let r = 0; r < 6; r++) for (let s = 0; s < 3; s++) {
    const v = state.index[indexKey(r, s)] || 0;
    if (v) found++;
    const c = document.createElement('div');
    c.className = 'cell' + (v ? '' : ' locked');
    c.style.setProperty('--rc', RARITIES[r].color);
    c.innerHTML = `<span class="em">${v ? PET_EMOJI[r * 3 + s] : '❔'}</span><div></div><div style="color:${RARITIES[r].color}"></div>${v & 2 ? '<div class="gd">★ ' + t('golden') + '</div>' : ''}`;
    c.children[1].textContent = v ? t('species')[r * 3 + s] : t('indexHidden');
    c.children[2].textContent = t('rarity')[r];
    grid.appendChild(c);
  }
  $('indexNote').textContent = t('indexFound', { a: found, b: 18 });
}

function canRebirth() { return state.best >= 5 && state.coins >= rebirthCost(state.rebirths); }
function renderRebirth() {
  const b = $('rebirthBody');
  b.innerHTML = '';
  const p = (txt, cls = 'note') => { const e = document.createElement('div'); e.className = cls; e.textContent = txt; b.appendChild(e); };
  p(t('rebirthText'));
  b.appendChild(row('🌀', t('rebirthNow', { m: rebirthIncome().toFixed(1), s: rebirthSpeed() }), ''));
  b.appendChild(row('✨', t('rebirthNext', { m: rebirthIncome(state.rebirths + 1).toFixed(1), s: rebirthSpeed(state.rebirths + 1) }), ''));
  p(t('rebirthNeed', { n: fmt(rebirthCost(state.rebirths)) }));
  b.appendChild(button(t('rebirthGo'), 'purple big', doRebirth, !canRebirth()));
}
function doRebirth() {
  if (!canRebirth()) return;
  state.rebirths++;
  Object.assign(state, { coins: 0, bank: 0, speedLvl: 0, incomeLvl: 0, pens: START_PENS, slots: Array(MAX_PENS).fill(null), best: 0, boostUntil: state.boostUntil });
  closePanels();
  audio.play('rebirth');
  fx.confetti(player.position.clone().add(new THREE.Vector3(0, 3, 0)), 140);
  toast(t('rebirthDone', { n: state.rebirths }), '#c9a6ff');
  platform.happytime();
  flushSave(); updateHud(true);
}

const dayKey = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
function giftAvailable() { return state.giftDay !== dayKey(); }
function giftAmount(day) { return Math.round(Math.max(100, incomePerSec() * 90) * GIFT_MULT[(day - 1) % 7]); }
function nextStreak() {
  const y = new Date(); y.setDate(y.getDate() - 1);
  return state.giftDay === dayKey(y) ? state.giftStreak + 1 : 1;
}
function renderGift() {
  const b = $('giftBody');
  b.innerHTML = '';
  const note = document.createElement('div'); note.className = 'note'; note.textContent = t('giftText'); b.appendChild(note);
  const streak = giftAvailable() ? nextStreak() : state.giftStreak;
  const days = document.createElement('div'); days.className = 'days';
  const cycleStart = Math.floor((streak - 1) / 7) * 7;
  for (let i = 1; i <= 7; i++) {
    const d = cycleStart + i;
    const el = document.createElement('div');
    el.className = 'day' + (d < streak || (d === streak && !giftAvailable()) ? ' got' : '') + (d === streak && giftAvailable() ? ' now' : '');
    el.innerHTML = `${t('giftDay', { d })}<br>🎁×${GIFT_MULT[i - 1]}`;
    days.appendChild(el);
  }
  b.appendChild(days);
  if (giftAvailable()) {
    const amt = giftAmount(streak);
    b.appendChild(button(t('giftClaim', { n: '🪙 ' + fmt(amt) }), 'pink big', () => {
      state.coins += amt; state.giftDay = dayKey(); state.giftStreak = streak;
      audio.play('unlock'); bumpCoins(); toast(t('giftGot', { n: fmt(amt) }) + ' 🪙', '#ffd84a');
      fx.confetti(player.position.clone().add(new THREE.Vector3(0, 3, 0)), 60);
      flushSave(); renderGift(); updateHud(true);
    }));
  } else {
    const mid = new Date(); mid.setHours(24, 0, 0, 0);
    const ms = mid - Date.now(), h = Math.floor(ms / 3.6e6), m = Math.floor(ms / 6e4) % 60;
    const w = document.createElement('div'); w.className = 'empty'; w.textContent = t('giftWait', { t: `${h}h ${m}m` }); b.appendChild(w);
  }
}

function renderSettings() {
  const b = $('settingsBody');
  b.innerHTML = '';
  for (const [key, label] of [['sound', t('sound')], ['music', t('music')]]) {
    const r = row(key === 'sound' ? '🔊' : '🎵', label, '');
    r.appendChild(button(state[key] ? t('on') : t('off'), state[key] ? 'green' : 'red', () => {
      state[key] = !state[key];
      audio.setSound(state.sound); audio.setMusic(state.music);
      save(); renderSettings();
    }));
    b.appendChild(r);
  }
}

function showAway() {
  if (pendingAway <= 0) return;
  const amt = pendingAway;
  const b = $('awayBody');
  b.innerHTML = `<div style="font-size:54px"><i class="cn" style="width:64px;height:64px"></i></div><div class="note" style="font-size:18px"></div>`;
  b.querySelector('.note').textContent = t('awayText', { n: fmt(amt) });
  const finish = (k) => {
    pendingAway = 0;
    state.bank += amt * k;
    $('awayPanel').classList.remove('open'); panelOpen = null;
    if (started) platform.gameplayStart();
    audio.play('coin'); save();
  };
  const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;gap:10px;margin-top:8px';
  wrap.appendChild(button(t('take'), 'green big', () => finish(1)));
  if (platform.hasRewarded) wrap.appendChild(button(`${t('takeX2')} · 🎬 ${t('watchAd')}`, `${platform.adColor} big`, async (btn) => {
    btn.disabled = true;
    const ok = await withAd((onStart) => platform.rewarded(onStart));
    if (!ok) toast(t('noAd'), '#ff9a5a');
    finish(ok ? 2 : 1);
  }));
  b.appendChild(wrap);
  openPanel('awayPanel');
}

// hatch reveal card
let revealTimer = 0;
function reveal(p, isNew, bonus) {
  const el = $('reveal');
  const r = RARITIES[p.rarity];
  el.style.setProperty('--rc', p.golden ? '#ffd23a' : r.color);
  el.querySelector('.rname').textContent = `${PET_EMOJI[speciesIdx(p)]} ${petName(p)}`;
  el.querySelector('.rname').style.color = p.golden ? '#ffd23a' : '#fff';
  el.querySelector('.rrar').textContent = t('rarity')[p.rarity];
  el.querySelector('.rinc').textContent = `+${fmtRate(petIncome(p))} 🪙${t('perSec')}` + (bonus ? `  ·  ${t('indexBonus', { n: fmt(bonus) })}` : '');
  coinify(el.querySelector('.rinc'));
  el.querySelector('.rnew').classList.toggle('hidden', !isNew);
  el.classList.remove('open'); void el.offsetWidth; el.classList.add('open');
  revealTimer = 2.8;
}
$('reveal').addEventListener('pointerdown', () => { $('reveal').classList.remove('open'); revealTimer = 0; });

let hudCache = '';
function updateHud(force) {
  const s = `${Math.floor(state.coins)}|${Math.floor(incomePerSec())}|${playerSpeed()}|${boosted()}|${state.rebirths}|${giftAvailable()}|${canRebirth()}`;
  if (s === hudCache && !force) return;
  hudCache = s;
  $('coins').textContent = fmt(state.coins);
  $('income').textContent = fmtRate(incomePerSec()) + (boosted() ? ' 🚀' : '');
  $('speed').textContent = playerSpeed().toFixed(1);
  $('rbChip').classList.toggle('hidden', !state.rebirths);
  $('rbText').textContent = `×${rebirthIncome().toFixed(1)}`;
  $('btnGift').classList.toggle('dot', giftAvailable());
  $('btnRebirth').classList.toggle('dot', canRebirth());
  $('btnRebirth').classList.toggle('purple', true);
  $('btnRebirth').classList.toggle('hidden', !state.rebirths && state.best < 5);
  $('btnIndex').classList.toggle('hidden', !Object.keys(state.index).length);
  for (let i = 0; i < ZONES.length; i++) {
    const z = ZONES[i];
    const ok = playerSpeed() > z.guard.speed;
    z.speedLabel.userData.draw(`${t('guardsRun', { g: z.guard.speed })}  ${ok ? '✔' : '✖ ' + t('tooFast')}`, ok ? '#8dff8d' : '#ff7070');
  }
}

// ---------------------------------------------------------------------------
// Tutorial
// ---------------------------------------------------------------------------
function showTut() {
  const el = $('tut');
  if (state.tut >= 5 || !started) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.textContent = t('tut')[state.tut];
  if (state.tut === 0) { const k = document.createElement('small'); k.textContent = t(isTouch ? 'controlsTouch' : 'controlsPc'); el.appendChild(k); }
  const skip = document.createElement('button'); skip.className = 'skip'; skip.textContent = t('skip');
  skip.addEventListener('pointerdown', (e) => { e.stopPropagation(); state.tut = 5; showTut(); save(); audio.play('click'); });
  el.appendChild(skip);
}
function advanceTut() {
  state.tut++;
  if (state.tut === 5) { toast(t('tutDone') + ' ⭐', '#ffd84a'); audio.play('unlock'); }
  else audio.blip([784, 1047], 0.07, 0.05);
  showTut(); save();
}
const guideTarget = new THREE.Vector3();
function tutTarget() {
  if (carrying) return guideTarget.set(0, 0, BASE_LIMIT_Z - 3);
  if (state.tut >= 5) return null;
  switch (state.tut) {
    case 0: {
      let best = null, bd = Infinity;
      for (const n of nests) if (n.zone === 0 && n.available) { const d = n.pos.distanceTo(player.position); if (d < bd) { bd = d; best = n; } }
      return best ? guideTarget.copy(best.pos) : null;
    }
    case 2: {
      const i = state.slots.findIndex((s, k) => k < state.pens && s && s.kind === 'egg');
      return i >= 0 ? guideTarget.copy(pens[i].pos) : null;
    }
    case 3: return guideTarget.copy(coinPlate.position).setY(0);
    case 4: return state.coins >= speedCost(state.speedLvl) ? guideTarget.copy(shopPad.position).setY(0) : guideTarget.copy(coinPlate.position).setY(0);
    default: return null;
  }
}
function updateGuide(time) {
  const target = started ? tutTarget() : null;
  guide.visible = guideArrow.visible = !!target;
  if (!target) return;
  guideArrow.position.set(target.x, 4.2 + Math.sin(time * 5) * 0.4, target.z);
  guideArrow.rotation.y = time * 2;
  const dx = target.x - player.position.x, dz = target.z - player.position.z;
  const d = Math.hypot(dx, dz);
  const ux = dx / (d || 1), uz = dz / (d || 1);
  const ang = Math.atan2(ux, uz);
  chevrons.forEach((c, i) => {
    const k = 2 + i * 2.2 + ((time * 3) % 2.2);
    c.visible = k < d - 1.5;
    c.position.set(player.position.x + ux * k, 0.08, player.position.z + uz * k);
    c.rotation.z = -ang + Math.PI;
    c.material.opacity = 0.85 * (1 - i / 7);
  });
}

// ---------------------------------------------------------------------------
// Game logic
// ---------------------------------------------------------------------------
function rollRarity(weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r < 0) return i; }
  return 0;
}
function currentZone(z) { return ZONES.findIndex((zn) => z >= zn.z0 - 2 && z <= zn.z1 + 2); }

function grabEgg(nest) {
  nest.available = false;
  nest.egg.visible = false; nest.glow.visible = false;
  nest.respawnAt = performance.now() + 5000;
  carrying = { zone: nest.zone };
  carryEgg.clear();
  carryEgg.add(makeEgg(ZONES[nest.zone].egg, 0.9));
  $('carry').style.display = 'block';
  audio.play('grab');
  fx.burst(nest.pos.clone().setY(1), 0xfff2a0, 18, 5);
  toast(t('gotIt') + ' 🏃', '#ffd84a');
  camYawTarget = 0;
  if (state.tut === 0) advanceTut();
  for (const g of guards) if (g.zone === nest.zone) { g.state = 'alert'; g.react = nest.zone === 0 ? 1.0 : 0.5; }
}

// guards only guard their own zone: once you are far enough out, they give up
const CHASE_PAST = 25;
let lastEscape = 0;
function escaped(g) {
  g.mesh.userData.play?.('emote-no');
  if (performance.now() - lastEscape < 3000) return;   // one toast for the whole group
  lastEscape = performance.now();
  toast(t('escaped') + ' 🎉', '#8dff8d');
  audio.blip([660, 880, 1175], 0.07, 0.05);
}

function dropCarry() {
  carrying = null;
  carryEgg.clear();
  $('carry').style.display = 'none';
}

function depositEgg() {
  const idx = state.slots.findIndex((s, i) => i < state.pens && !s);
  if (idx < 0) {
    if (!depositEgg.warned) { toast(t('pensFull'), '#ff9a5a'); audio.play('error'); depositEgg.warned = true; }
    return;
  }
  depositEgg.warned = false;
  const zone = ZONES[carrying.zone];
  const rarity = rollRarity(zone.weights);
  const mult = Math.round((0.8 + Math.pow(Math.random(), 2.2) * 0.8) * 100) / 100;
  state.slots[idx] = {
    kind: 'egg', zone: carrying.zone, rarity, species: Math.floor(Math.random() * 3),
    mult, golden: Math.random() < 0.05, hatchAt: Date.now() + zone.hatch * 1000,
  };
  state.best = Math.max(state.best, carrying.zone + 1);
  dropCarry();
  audio.play('place');
  fx.confetti(pens[idx].pos.clone().setY(1.5), 30);
  toast(t('placed') + ' 🥚', '#8dff8d');
  camYawTarget = Math.PI;
  if (state.tut === 1) advanceTut();
  save();
}

function caught() {
  dropCarry();
  audio.play('caught'); flash(); fx.shake(0.6);
  fx.burst(player.position.clone().setY(1.5), 0xffffff, 26, 6);
  toast(t('caught') + ' 😵', '#ff7070');
  controlLock = 0.9;
  player.userData.play?.('emote-no', { once: true, fade: 0.05 });
  for (const g of guards) { if (g.state === 'chase' || g.state === 'alert') g.mesh.userData.play?.('emote-yes'); g.state = 'gloat'; g.wait = 1; }
  $('fade').style.opacity = 0.6;
  setTimeout(() => {
    player.position.copy(SPAWN); vel.set(0, 0, 0); player.rotation.y = Math.PI;
    camYawTarget = Math.PI;
    $('fade').style.opacity = 0;
    for (const g of guards) g.state = 'return';
    // ads only in a logical pause: a "caught" card, and the ad starts right after the player taps Continue
    if (Date.now() - lastAd >= AD_GAP_MS && !panelOpen) openPanel('caughtPanel');
  }, 700);
}
$('btnCaughtOk').addEventListener('click', () => {
  $('caughtPanel').classList.remove('open'); panelOpen = null;
  lastAd = Date.now();
  withAd((onStart) => platform.interstitial(onStart));
});

// Pause / ads. Anything that pauses (ad, tab hidden, portal pause event) bumps the counter.
let paused = 0, lastAd = Date.now();
function pause(mute = true) { if (paused++ === 0) { if (started && !panelOpen) platform.gameplayStop(); } if (mute) audio.suspend(); }
function resume(mute = true) {
  if (paused === 0) return;
  if (mute) audio.resume();
  if (--paused === 0) { last = performance.now(); if (started && !panelOpen) platform.gameplayStart(); }
}
// The game freezes while an ad is requested; sound is cut only when the ad actually starts playing
// (an unfilled request must not make the music blink off and on).
async function withAd(show) {
  pause(false);
  let muted = false;
  const onStart = () => { if (!muted) { muted = true; audio.suspend(); } };
  try { return await show(onStart); } finally { if (muted) audio.resume(); resume(false); }
}
platform.onPause = pause;
platform.onResume = resume;
let portalAudio = true;
platform.onAudio = (on) => { if (on === portalAudio) return; portalAudio = on; on ? audio.resume() : audio.suspend(); };

function hatch(s, i) {
  s.kind = 'pet';
  if (i >= state.pens) return;
  const key = indexKey(s.rarity, s.species);
  const before = state.index[key] || 0;
  const flag = s.golden ? 2 : 1;
  const isNew = !(before & flag);
  let bonus = 0;
  if (isNew) {
    state.index[key] = before | flag;
    bonus = Math.round(RARITIES[s.rarity].income * 60 * (s.golden ? 3 : 1) * rebirthIncome());
    state.coins += bonus;
    const all = Object.values(state.index);
    const n = (f) => all.filter((v) => v & f).length;
    // tell the player when there is nothing new left to find (YouTube Playables asks for a clear end)
    if (n(1) === 18 && n(2) === 18) setTimeout(() => toast(t('indexDone'), '#ffd23a', 6000), 2500);
    else if (flag === 1 && n(1) === 18) setTimeout(() => toast(t('allSpecies'), '#ffd23a', 6000), 2500);
  }
  const pos = pens[i].pos.clone().setY(1.2);
  fx.confetti(pos, s.rarity >= 3 || s.golden ? 110 : 50, s.golden ? [0xffd23a, 0xfff2a0, 0xffffff] : undefined);
  audio.play('crack');
  audio.play(s.rarity >= 3 || s.golden ? 'hatch_rare' : 'hatch');
  fx.text(pos.clone().setY(4), `+${fmtRate(petIncome(s))}${t('perSec')}`, RARITIES[s.rarity].color);
  if (isNew || s.rarity >= 2 || s.golden) reveal(s, isNew, bonus);
  else toast(t('hatched', { name: petName(s) }), RARITIES[s.rarity].color);
  if (s.rarity >= 3 || s.golden) { platform.happytime(); fx.shake(0.25); }
  pens[i].dance = 2.2;
  if (state.tut === 2) advanceTut();
  save(); updateHud(true);
}
function hatchCheck() {
  const now = Date.now();
  state.slots.forEach((s, i) => { if (s && s.kind === 'egg' && now >= s.hatchAt) hatch(s, i); });
}

// keep pen visuals in sync with state; pets wander a little inside their pen
function syncPens(time, dt) {
  pens.forEach((pen, i) => {
    const unlocked = i < state.pens;
    pen.lock.visible = !unlocked;
    pen.pad.material = mat(unlocked ? 0x8fde66 : 0xb9a98a);
    pen.lockLabel.visible = !unlocked && i === state.pens;
    if (pen.lockLabel.visible) {
      const key = 'lock' + PEN_COST[i];
      if (pen.lockKey !== key) { pen.lockLabel.userData.draw(`🪙 ${fmt(PEN_COST[i])}`); pen.lockKey = key; }
    }
    const s = unlocked ? state.slots[i] : null;
    const key = s ? `${s.kind}|${s.rarity}|${s.species}|${s.golden}|${s.mult}|${s.zone}` : 'none';
    if (pen.shown !== key) {
      pen.holder.clear();
      pen.pet = null;
      if (s && s.kind === 'egg') { const e = makeEgg(ZONES[s.zone].egg, 1.25); e.position.y = 0.85; pen.holder.add(e); }
      if (s && s.kind === 'pet') { pen.pet = makePet(s); pen.holder.add(pen.pet); pen.wander = new THREE.Vector3(); pen.wait = rand(1, 3); }
      pen.shown = key;
      pen.labelKey = null;
    }
    pen.label.visible = !!s;
    if (!s) return;
    if (s.kind === 'egg') {
      const left = Math.max(0, Math.ceil((s.hatchAt - Date.now()) / 1000));
      const lk = 'e' + left;
      if (pen.labelKey !== lk) { pen.label.userData.draw(`🥚 ${left}s`); pen.labelKey = lk; }
      const obj = pen.holder.children[0];
      const urgency = left <= 3 ? 16 : 4;
      if (obj) { obj.rotation.z = Math.sin(time * urgency) * (left <= 3 ? 0.25 : 0.12); const k = left <= 3 ? 1 + Math.abs(Math.sin(time * 8)) * 0.08 : 1; obj.scale.setScalar(k); }
      if (left <= 3 && Math.random() < 0.3) fx.sparkle(pen.pos.clone().setY(1), 0xffffff, 1, 0.7);
    } else {
      const lk = 'p' + petIncome(s);
      if (pen.labelKey !== lk) { pen.label.userData.draw(`${fmtRate(petIncome(s))}${t('perSec')}`, RARITIES[s.rarity].color); pen.labelKey = lk; }
      const pet = pen.pet;
      if (!pet) return;
      pet.userData.mixer?.update(dt);
      if (pen.dance > 0) {
        pen.dance -= dt; pet.userData.play?.('dance');
        pet.rotation.y += dt * 4;
      } else {
        const d = pet.position.distanceTo(pen.wander);
        if (d > 0.1) {
          const step = Math.min(d, dt * 1.2);
          const dir = pen.wander.clone().sub(pet.position).normalize();
          pet.position.addScaledVector(dir, step);
          pet.rotation.y = Math.atan2(dir.x, dir.z);
          pet.userData.play?.('walk');
        } else {
          pet.userData.play?.('idle');
          pen.wait -= dt;
          if (pen.wait <= 0) { pen.wander.set(rand(-1, 1), 0, rand(-1, 1)); pen.wait = rand(2, 5); }
        }
      }
      if (pet.userData.glow) pet.userData.glow.rotation.z += dt;
      if (pet.userData.cosmic) for (const m of pet.userData.cosmic) { m.emissive = m.emissive || new THREE.Color(); m.emissive.setHSL((time * 0.15 + i * 0.1) % 1, 0.9, 0.35); }
      if ((s.golden || s.rarity >= 4) && Math.random() < dt * 6) fx.sparkle(pen.pos.clone().add(pet.position).setY(1), s.golden ? 0xffe27a : RARITIES[s.rarity].color, 1, 1);
    }
  });
}

// is a fence right in front of this point (looking along dx, dz)?
function fenceAhead(pos, dx, dz, dist = 1.3) {
  const ax = pos.x + dx * dist, az = pos.z + dz * dist;
  return obstacles.some((o) => ax > o.minX - 0.4 && ax < o.maxX + 0.4 && az > o.minZ - 0.4 && az < o.maxZ + 0.4);
}
// guards of one zone never stand inside each other
function separateGuards() {
  for (let i = 0; i < guards.length; i++) for (let j = i + 1; j < guards.length; j++) {
    const a = guards[i].mesh.position, b = guards[j].mesh.position;
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), min = 1.1;
    if (d >= min) continue;
    const push = (min - (d || 0.01)) / 2, ux = d ? dx / d : 1, uz = d ? dz / d : 0;
    a.x -= ux * push; a.z -= uz * push; b.x += ux * push; b.z += uz * push;
  }
}

function collideObstacles(pos) {
  const r = 0.45;
  for (const o of obstacles) {
    if (pos.y >= o.h) continue;
    if (pos.x + r <= o.minX || pos.x - r >= o.maxX || pos.z + r <= o.minZ || pos.z - r >= o.maxZ) continue;
    const pens4 = [
      [o.maxX - (pos.x - r), 'x', 1], [(pos.x + r) - o.minX, 'x', -1],
      [o.maxZ - (pos.z - r), 'z', 1], [(pos.z + r) - o.minZ, 'z', -1],
    ].sort((a, b) => a[0] - b[0]);
    const [d, axis, sign] = pens4[0];
    pos[axis] += d * sign;
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let started = false, last = performance.now(), saveTimer = 0, zoneShown = -2, dustT = 0;
const tmp = new THREE.Vector3(), camTarget = new THREE.Vector3();

function update(dt, time) {
  let ix = 0, iz = 0;
  if (keys.KeyW || keys.ArrowUp) iz += 1;
  if (keys.KeyS || keys.ArrowDown) iz -= 1;
  if (keys.KeyA || keys.ArrowLeft) ix -= 1;
  if (keys.KeyD || keys.ArrowRight) ix += 1;
  if (joy.active) { ix += joy.x; iz -= joy.y; }
  if (controlLock > 0) { controlLock -= dt; ix = iz = 0; jumpQueued = false; }
  const mag = Math.min(1, Math.hypot(ix, iz));
  const moving = mag > 0.1 && !panelOpen;
  if (moving) {
    const fx_ = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
    const dx = fx_ * iz + rx * ix, dz = fz * iz + rz * ix;
    const len = Math.hypot(dx, dz) || 1;
    const sp = playerSpeed() * mag;
    vel.x = dx / len * sp; vel.z = dz / len * sp;
    const target = Math.atan2(vel.x, vel.z);
    let diff = target - player.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    player.rotation.y += diff * Math.min(1, dt * 14);
  } else { vel.x = 0; vel.z = 0; }

  if (jumpQueued && onGround && !panelOpen) { vel.y = 8.5; onGround = false; audio.play('jump', { vol: 0.6 }); }
  jumpQueued = false;
  vel.y -= 22 * dt;
  player.position.addScaledVector(vel, dt);
  if (player.position.y <= 0) {
    if (!onGround) { audio.play('land', { vol: 0.5 }); for (let k = 0; k < 6; k++) fx.dust(player.position); }
    player.position.y = 0; vel.y = 0; onGround = true;
  }
  player.position.x = Math.max(-ROAD_HALF, Math.min(ROAD_HALF, player.position.x));
  player.position.z = Math.max(-29, Math.min(WORLD_END - 1, player.position.z));
  collideObstacles(player.position);
  // animation + squash/stretch while airborne
  if (controlLock <= 0) {
    if (!onGround) player.userData.play?.('static', { fade: 0.1 });
    else if (moving) { player.userData.play?.(mag > 0.6 ? 'sprint' : 'walk'); player.userData.speed?.(Math.max(0.8, playerSpeed() * mag / 9)); }
    else player.userData.play?.('idle');
  }
  const model = player.userData.model;
  if (model) { const sy = onGround ? 1 : 1 + Math.min(0.15, Math.abs(vel.y) * 0.015); model.scale.set(1.05 / Math.sqrt(sy), 1.05 * sy, 1.05 / Math.sqrt(sy)); }
  player.userData.mixer?.update(dt);
  carryEgg.rotation.y += dt * 2;
  carryEgg.position.y = 4.1 + Math.sin(time * 10) * 0.08;
  if (moving && onGround && (dustT -= dt) <= 0) {
    dustT = 0.07;
    const zi = currentZone(player.position.z);
    fx.dust(player.position, zi >= 0 ? new THREE.Color(ZONES[zi].ground).lerp(new THREE.Color(0xffffff), 0.4).getHex() : 0xf0e6cc);
  }

  // nests
  const now = performance.now();
  for (const n of nests) {
    if (!n.available && now >= n.respawnAt) { n.available = true; n.egg.visible = true; n.glow.visible = true; fx.sparkle(n.pos.clone().setY(1), 0xffffff, 8, 1); }
    if (n.available) { n.egg.position.y = 0.95 + Math.sin(time * 2 + n.pos.x) * 0.12; n.egg.rotation.y += dt; n.glow.material.opacity = 0.25 + Math.sin(time * 4) * 0.1; }
    if (n.available && !carrying && controlLock <= 0 && player.position.distanceTo(tmp.set(n.pos.x, 0, n.pos.z)) < 1.7) grabEgg(n);
  }

  // guards
  for (const g of guards) {
    const zone = ZONES[g.zone];
    const m = g.mesh;
    let speed = zone.guard.speed * 0.35, dest = null;
    const pz = player.position.z;
    const playerInRange = carrying && carrying.zone === g.zone && pz > zone.z0 - CHASE_PAST && pz < zone.z1 + 12;
    // gravity first, so a guard that was mid-hop always lands (even while gloating)
    if (!panelOpen && (m.position.y > 0 || g.vy > 0)) {
      g.vy -= 22 * dt; m.position.y += g.vy * dt;
      if (m.position.y <= 0) { m.position.y = 0; g.vy = 0; }
    }
    if (panelOpen) { m.userData.mixer?.update(dt); continue; }
    if (g.state === 'gloat') { g.wait -= dt; m.userData.mixer?.update(dt); continue; }
    if (g.state === 'alert') { g.react -= dt; if (g.react <= 0) g.state = playerInRange ? 'chase' : 'return'; }
    if (g.state === 'chase' && !playerInRange) { g.state = 'return'; if (carrying) escaped(g); }
    if (g.state !== 'chase' && g.state !== 'alert' && playerInRange && m.position.distanceTo(player.position) < 18) g.state = 'chase';

    if (g.state === 'chase') { dest = player.position; speed = zone.guard.speed; }
    else if (g.state === 'alert') { m.rotation.y = Math.atan2(player.position.x - m.position.x, player.position.z - m.position.z); }
    else {
      if (g.state === 'return' || (g.wait <= 0 && m.position.distanceTo(g.target) < 1)) {
        g.target.set(rand(-ROAD_HALF + 2, ROAD_HALF - 2), 0, rand(zone.z1 - 14, zone.z1 - 1));
        g.wait = rand(0.5, 2);
        g.state = 'patrol';
      }
      if (m.position.distanceTo(g.target) < 1) g.wait -= dt; else dest = g.target;
    }
    g.alert.visible = g.state === 'chase' || g.state === 'alert';
    if (g.alert.visible) g.alert.scale.setScalar(1.8 * (1 + Math.abs(Math.sin(time * 10)) * 0.2));
    if (dest) {
      tmp.set(dest.x - m.position.x, 0, dest.z - m.position.z);
      const d = tmp.length();
      if (d > 0.01) {
        tmp.multiplyScalar(Math.min(d, speed * dt) / d);
        m.position.add(tmp);
        m.rotation.y = Math.atan2(tmp.x, tmp.z);
      }
      m.position.x = Math.max(-ROAD_HALF, Math.min(ROAD_HALF, m.position.x));
      // guards hop over the low fences like the player does (instead of walking through them)
      if (m.position.y <= 0 && d > 0.01 && fenceAhead(m.position, tmp.x / (Math.hypot(tmp.x, tmp.z) || 1), tmp.z / (Math.hypot(tmp.x, tmp.z) || 1))) g.vy = 8;
    }
    collideObstacles(m.position);
    if (g.state === 'chase') { m.userData.play?.('sprint'); m.userData.speed?.(Math.max(1, zone.guard.speed / 10)); }
    else if (g.state === 'alert') m.userData.play?.('emote-no');
    else m.userData.play?.(dest ? 'walk' : 'idle');
    m.userData.mixer?.update(dt);
    if (g.state === 'chase' && carrying && controlLock <= 0 && m.position.distanceTo(player.position) < 1.2 && player.position.y < 1.5) { caught(); break; }
  }

  separateGuards();
  if (carrying && player.position.z < BASE_LIMIT_Z) depositEgg();

  // coins
  state.bank += incomePerSec() * dt;
  const onPlate = Math.hypot(player.position.x - coinPlate.position.x, player.position.z - coinPlate.position.z) < 2.4;
  if (onPlate && state.bank >= 1) {
    const amt = Math.floor(state.bank);
    state.coins += amt; state.bank -= amt;
    if (!update.onPlateBefore || amt >= 5) {
      audio.play('coin', { rate: 0.95 + Math.random() * 0.1 });
      fx.text(coinPlate.position.clone().setY(3.6), `+${fmt(amt)}`, '#ffd84a', 1.8);
      fx.burst(coinPlate.position.clone().setY(0.6), 0xffd23a, Math.min(30, 8 + Math.log2(amt + 1) * 3), 7);
      bumpCoins();
      if (state.tut === 3) advanceTut();
    }
  }
  update.onPlateBefore = onPlate;
  const bankText = `🪙 ${fmt(state.bank)}`;
  if (bankText !== update.bankText) {
    coinLabel.userData.draw(bankText); update.bankText = bankText;
    const n = state.bank < 1 ? 0 : Math.min(12, Math.ceil(Math.log10(state.bank + 1) * 3));
    coinStack.children.forEach((c, i) => { c.visible = i < n; });
  }
  coinStack.rotation.y += dt * 0.8;

  const onShop = Math.hypot(player.position.x - shopPad.position.x, player.position.z - shopPad.position.z) < 2.4;
  if (onShop && !panelOpen && !update.onShopBefore) openPanel('shopPanel');
  update.onShopBefore = onShop;

  const zi = currentZone(player.position.z);
  if (zi !== zoneShown) {
    zoneShown = zi;
    const el = $('zonehint');
    if (zi >= 0) {
      const z = ZONES[zi];
      const ok = playerSpeed() > z.guard.speed;
      el.textContent = t(ok ? 'zoneHintOk' : 'zoneHintBad', { z: t('zone')[zi], g: z.guard.speed, p: playerSpeed().toFixed(1) });
      el.className = 'show ' + (ok ? 'ok' : 'bad');
      clearTimeout(update.hintT);
      if (isTouch) update.hintT = setTimeout(() => { el.className = ''; }, 3500);
    } else el.className = '';
  }
  if (zi === 4 && Math.random() < 0.5) {
    const e = embers[Math.floor(Math.random() * embers.length)];
    if (e) fx.sparkle(e, 0xff7a2a, 1, 2);
  }

  hatchCheck();
  syncPens(time, dt);
  updateHud();
  updateGuide(time);

  // camera: follows behind, auto-turns home while carrying, small FOV kick while running with an egg
  if (camYawTarget !== null) {
    const d = Math.atan2(Math.sin(camYawTarget - camYaw), Math.cos(camYawTarget - camYaw));
    camYaw += d * Math.min(1, dt * 9);
    if (Math.abs(d) < 0.01) camYawTarget = null;
  }
  const fov = carrying && moving ? 68 : 60;
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix(); }
  camTarget.copy(player.position); camTarget.y += 1.9;
  const ch = Math.sin(camPitch) * camDist, cd = Math.cos(camPitch) * camDist;
  camera.position.set(camTarget.x + Math.sin(camYaw) * cd, camTarget.y + ch, camTarget.z + Math.cos(camYaw) * cd);
  const sh = fx.shakeOffset();
  if (sh) camera.position.add(new THREE.Vector3(rand(-sh, sh), rand(-sh, sh), rand(-sh, sh)));
  if (introT > 0) {
    // ease from a high view over the first nests down to the normal chase camera
    introT -= dt;
    const k = Math.max(0, introT / INTRO_S), e = k * k * (3 - 2 * k);
    const nest = nests[1] ? nests[1].pos : new THREE.Vector3(0, 0, 100);
    const from = new THREE.Vector3(nest.x + 13, 12, nest.z + 24);
    const look = new THREE.Vector3().lerpVectors(camTarget, nest.clone().setY(1), e);
    camera.position.lerp(from, e);
    camera.lookAt(look);
    camera.fov = 60 + 8 * e; camera.updateProjectionMatrix();
  } else camera.lookAt(camTarget);
  scene.userData.sky.position.copy(camera.position);
  sun.position.set(player.position.x + 15, 32, player.position.z - 10);
  sun.target.position.copy(player.position);

  if (revealTimer > 0 && (revealTimer -= dt) <= 0) $('reveal').classList.remove('open');

  saveTimer += dt;
  if (saveTimer > 5) { saveTimer = 0; save(); }
}

const STEP = 1 / 120;
let acc = 0;
function loop() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  requestAnimationFrame(loop);
  if (paused) return;
  const time = now / 1000;
  if (started) {
    acc = Math.min(acc + dt, STEP * 6);
    while (acc >= STEP) { acc -= STEP; update(STEP, time); }
  } else {
    const a = time * 0.12;
    camera.position.set(Math.sin(a) * 17, 7.5, 6 + Math.cos(a) * 17);
    camera.lookAt(0, 1.6, 4);
    syncPens(time, dt);
    for (const g of guards) g.mesh.userData.mixer?.update(dt);
    player?.userData.mixer?.update(dt);
  }
  scene.userData.sky.position.copy(camera.position);
  if (clouds) { clouds.position.x = Math.sin(time * 0.02) * 20; }
  fx.update(dt);
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------------------
let hiddenAt = 0;
// the game loop doesn't run while the tab is hidden or the portal has paused it: pets still earn
function awayStart() { hiddenAt = Date.now(); flushSave(); }
function awayEnd() {
  if (hiddenAt && started) {
    const away = Math.min(OFFLINE_CAP_S, (Date.now() - hiddenAt) / 1000);
    if (away > 2) state.bank += incomePerSec() * away;
  }
  hiddenAt = 0;
}
if (platform.ownPauseEvents) {
  platform.onPause = () => { awayStart(); pause(); };
  platform.onResume = () => { awayEnd(); resume(); };
} else document.addEventListener('visibilitychange', () => {
  if (document.hidden) { awayStart(); audio.suspend(); return; }
  audio.resume();
  awayEnd();
});
window.addEventListener('pagehide', flushSave);

$('btnPlay').addEventListener('click', () => {
  audio.unlock();
  audio.play('click');
  $('start').classList.add('hidden');
  $('hud').classList.remove('hidden');
  started = true;
  last = performance.now();
  platform.gameplayStart();
  camYaw = Math.PI;
  if (state.tut === 0) { introT = INTRO_S; controlLock = Math.max(controlLock, 0.6); }
  showTut();
  if (pendingAway > 0) setTimeout(showAway, 300);
});

async function boot() {
  const bar = document.querySelector('#bar i');
  const assetsP = loadAll((k) => { bar.style.width = Math.round(k * 90) + '%'; });
  await platform.init();
  setLang(platform.lang());
  applyTexts();
  await Promise.all([assetsP, document.fonts?.load?.('800 20px Rubik').catch(() => {})]);
  initFx(scene);
  buildWorld();
  buildPlayer();
  buildGuide();
  load(await platform.loadSave());
  audio.setSound(state.sound !== false); audio.setMusic(state.music !== false);
  updateHud(true);
  bar.style.width = '100%';
  renderer.compile(scene, camera);
  loop();
  $('loader').classList.add('hidden');
  $('start').classList.remove('hidden');
  requestAnimationFrame(() => platform.loadingDone());
}
boot();

// debug hook for testing in the console (local dev or ?debug only, never in portal builds)
let simT = 0;
// ?debug works on this machine only: a real player's URL must not expose the game's insides
if (platform.name === 'local' || (new URLSearchParams(location.search).has('debug') && /^(localhost|127\.0\.0\.1)$/.test(location.hostname))) window.__game = {
  state, guards, nests, ZONES, save, keys, platform, renderer, scene, camera, fx,
  get player() { return player; },
  setCam(yaw, pitch, dist) { camYaw = yaw; camPitch = pitch; camDist = dist; camYawTarget = null; },
  step(n, dt = 1 / 60) { started = true; for (let i = 0; i < n; i++) { simT += dt; update(dt, simT); } renderer.render(scene, camera); },
  carrying: () => carrying,
  reveal, openPanel, closePanels, hatch, caught,
  adDue() { lastAd = 0; }, joy, obstacles, audio, renderShop, get paused() { return paused; }, get panel() { return panelOpen; },
  // dev only: render one frame and post the canvas to a local receiver (store screenshots)
  snap(name, url = 'http://127.0.0.1:8782/') {
    renderer.render(scene, camera);
    return fetch(url + name, { method: 'POST', body: canvas.toDataURL('image/png') }).then((r) => r.text());
  },
};
