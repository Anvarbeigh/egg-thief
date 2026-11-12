import * as THREE from './vendor/three.module.js';
import { platform } from './platform.js';
import { t, setLang, getLang } from './i18n.js';
import { audio } from './audio.js';
import { loadAll, spawn, instanced, ownMaterials, PET_FILES } from './assets.js';
import { initFx, fx } from './fx.js';
import { ICONS, icon, applyIcons, BIRD_ICONS } from './icons.js';
import { makeBird } from './birds.js';
import { prop, penPad, blobShadow, vcMat, vcGlow, groundTexture, barn, windmill, windmillBlades, cabin, igloo, tent, ruin } from './props.js';

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

const ZONES = [
  { z0: 40, z1: 110, ground: 0x86d45e, edge: 0x5fb243, egg: 0xfff4dc, guard: { speed: 5, bird: 'hen', n: 2, scale: 1.15 }, weights: [80, 18, 2, 0, 0, 0], hatch: 8, decor: 'meadow', arch: 0xff7a59 },
  { z0: 130, z1: 200, ground: 0x4fae55, edge: 0x2f7d3a, egg: 0xc9f29b, guard: { speed: 10, bird: 'turkey', n: 3, scale: 1.15 }, weights: [50, 35, 13, 2, 0, 0], hatch: 15, decor: 'forest', arch: 0xa0663a },
  { z0: 220, z1: 290, ground: 0xdfeaf3, edge: 0xc4dae9, egg: 0xa6e4ff, guard: { speed: 14, bird: 'goose', n: 3, scale: 1.15 }, weights: [0, 45, 40, 13, 2, 0], hatch: 25, decor: 'snow', arch: 0x3b8fe0 },
  { z0: 310, z1: 380, ground: 0xf0cf86, edge: 0xd9ad5c, egg: 0xffcf6b, guard: { speed: 18, bird: 'ostrich', n: 4, scale: 1.15 }, weights: [0, 0, 50, 38, 11, 1], hatch: 40, decor: 'desert', arch: 0xd9822b },
  { z0: 400, z1: 470, ground: 0x6b4842, edge: 0x3c2724, egg: 0xff7a3d, guard: { speed: 23, bird: 'phoenix', n: 4, scale: 1.2 }, weights: [0, 0, 0, 50, 40, 10], hatch: 60, decor: 'volcano', arch: 0x8b2be2 },
];

const BASE_SPEED = 8, SPEED_STEP = 0.5;
const ROAD_HALF = 18;
const BASE_LIMIT_Z = 24;
const MAX_PENS = 12, START_PENS = 4;
const PEN_COST = [0, 0, 0, 0, 100, 300, 1200, 3500, 10000, 30000, 90000, 250000];
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
  rebirths: 0, index: {}, tut: 0, goal: 0, goldenDone: 0, giftDay: '', giftStreak: 0, sound: true, music: true, shake: false, caughtN: 0,
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
// quality: 'high' on desktops, 'low' on phones (or ?low); high drops to low by itself if frames are slow
const QUALITY = { level: isTouch || /[?&]low\b/.test(location.search) ? 'low' : 'high' };
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch || devicePixelRatio < 2, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY.level === 'low' ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const HORIZON = 0xf3ead2;   // warm haze at the horizon
scene.fog = new THREE.Fog(0xdde9e6, 75, 200);
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 230);

const hemi = new THREE.HemisphereLight(0xd8efff, 0x6d7f48, 1.05);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe0a8, 3.0);   // warm late-morning sun from the side: longer, softer shadows
sun.castShadow = true;
sun.shadow.mapSize.set(QUALITY.level === 'low' ? 1024 : 2048, QUALITY.level === 'low' ? 1024 : 2048);
sun.shadow.radius = 3;
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 120 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

// gradient sky dome
{
  const sky = new THREE.Mesh(new THREE.SphereGeometry(200, 24, 12), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x3f9cf2) }, bottom: { value: new THREE.Color(HORIZON) } },
    vertexShader: 'varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying float h; void main(){ gl_FragColor = vec4(mix(bottom, top, smoothstep(-0.02, 0.3, h)), 1.0); }',
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

const matCache = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshLambertMaterial({ color, ...opts }));
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
    g.font = `900 ${fs}px Nunito, "Trebuchet MS", sans-serif`;
    while (g.measureText(txt).width > w - 16 && fs > 10) { fs -= 2; g.font = `900 ${fs}px Nunito, "Trebuchet MS", sans-serif`; }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = Math.max(5, fs * 0.22); g.lineJoin = 'round'; g.strokeStyle = '#101827';
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

function groundPlane(z0, z1, color, x0, x1, tex, rep = 6, laneTile = false, offset = 0, fixedV = false) {
  const w = x1 - x0, d = z1 - z0;
  const material = new THREE.MeshLambertMaterial({ color: tex ? 0xffffff : color, map: tex ? tex.clone() : null });
  if (material.map) {
    material.map.needsUpdate = true;
    // lane tiles are anchored to world z (v = z / tile), so the painted lane runs on unbroken across every plane edge
    if (fixedV) material.map.repeat.set(laneTile ? 1 : w / rep, 1);
    else { material.map.repeat.set(laneTile ? 1 : w / rep, d / rep); if (laneTile) material.map.offset.y = -z1 / rep; }
  }
  if (offset) { material.polygonOffset = true; material.polygonOffsetFactor = offset; material.polygonOffsetUnits = offset; }
  if (tex?.userData.glow) { material.emissive = new THREE.Color(0xffffff); material.emissiveMap = tex.userData.glow.clone(); material.emissiveMap.needsUpdate = true; material.emissiveMap.repeat.copy(material.map.repeat); material.emissiveMap.offset.copy(material.map.offset); }
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
  // Biome planes, and between two biomes a transition strip that blends one into the other (same tile scale and
  // lane, painted from both neighbours' own textures). Strips and the side fields overlap their neighbours a little,
  // so no hairline gap opens at a seam on low-precision phone GPUs; the strips draw on top in the overlap.
  const TILE = ROAD_HALF * 2 + 2, OV = 0.6, size = isTouch ? 512 : 1024;
  const road = (z0, z1, kind) => groundPlane(z0, z1, 0, -ROAD_HALF - 1, ROAD_HALF + 1, groundTexture(kind, size), TILE, true);
  const out = (z0, z1, color, tex) => {
    const inner = ROAD_HALF + 1 - (tex ? 0 : OV);   // plain fields tuck under the road edge; strip fields stop at it
    groundPlane(z0, z1, 0, -150, -inner, tex || colorNoise(color), 10, false, tex ? -1 : 1, !!tex);
    groundPlane(z0, z1, 0, inner, 150, tex || colorNoise(color), 10, false, tex ? -1 : 1, !!tex);
  };
  const seam = (z0, z1, kindA, kindB, colA, colB) => {
    groundPlane(z0 - OV, z1 + OV, 0, -ROAD_HALF - 1, ROAD_HALF + 1, blendTexture(groundTexture(kindA, size), groundTexture(kindB, size), z0 - OV, z1 + OV, TILE), TILE, true, -1, true);
    out(z0 - OV, z1 + OV, 0, blendFields(colA, colB, z0 - OV, z1 + OV, z0, z1));
  };
  road(-40, 26, 'base'); out(-40, 26, 0x9ed66f);
  let prev = 26, prevKind = 'base', prevCol = 0x9ed66f;
  for (const z of ZONES) {
    seam(prev, z.z0, prevKind, z.decor, prevCol, z.edge);
    road(z.z0, z.z1, z.decor); out(z.z0, z.z1, z.edge);
    prev = z.z1; prevKind = z.decor; prevCol = z.edge;
  }
  road(prev, WORLD_END + 40, 'volcano'); out(prev, WORLD_END + 40, 0x6b4842);

  // fences along the road and around the base
  const rails = [];
  for (const side of [-1, 1]) fenceLine(rails, side * (ROAD_HALF + 0.6), -30, side * (ROAD_HALF + 0.6), WORLD_END, 3);
  fenceLine(rails, -ROAD_HALF - 0.6, -30, ROAD_HALF + 0.6, -30, 3);
  fenceLine(rails, -ROAD_HALF - 0.6, WORLD_END, ROAD_HALF + 0.6, WORLD_END, 3);
  scene.add(instanced('nature:fence_planks', rails));

  buildBase();
  ZONES.forEach((z, i) => buildZone(z, i));
  buildClouds();
}
// Transition strip texture for the road between z0 and z1: rows come from texture A (before) and B (after) at the
// same world phase as on their own planes, mixed through a soft, patchy mask (grass patches running into snow, etc).
function blendTexture(A, B, z0, z1, tile) {
  const size = A.image.width, H = Math.max(8, Math.round(size * (z1 - z0) / tile));
  const rowAt = (((z0 / tile) % 1) + 1) % 1 * size;
  const strip = (src) => {   // the H rows of a tiled canvas starting at world z0, wrapping around
    const c = document.createElement('canvas'); c.width = size; c.height = H;
    const g = c.getContext('2d');
    for (let y = 0; y < H;) { const sy = (rowAt + y) % size, n = Math.min(H - y, size - sy); g.drawImage(src, 0, sy, size, n, 0, y, size, n); y += n; }
    return c;
  };
  const mask = (() => {
    const c = document.createElement('canvas'); c.width = size; c.height = H;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0.2, 'rgba(0,0,0,0)'); grd.addColorStop(0.8, 'rgba(0,0,0,1)');
    g.fillStyle = grd; g.fillRect(0, 0, size, H);
    for (let i = 0; i < 1400; i++) {
      const y = Math.random() * H, x = Math.random() * size, r = (14 + Math.random() * 40) * size / 1024, k = y / H;
      const p = Math.min(1, Math.max(0, (k - 0.15) / 0.7));
      g.globalCompositeOperation = Math.random() < p ? 'source-over' : 'destination-out';
      const rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, 'rgba(0,0,0,.85)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    // the strip ends are exactly A and exactly B
    g.clearRect(0, 0, size, Math.ceil(H * 0.08)); g.fillRect(0, Math.floor(H * 0.92), size, H);
    return c;
  })();
  const mix = (a, b) => {
    const c = strip(a), top = strip(b), g = c.getContext('2d'), tg = top.getContext('2d');
    tg.globalCompositeOperation = 'destination-in'; tg.drawImage(mask, 0, 0);
    g.drawImage(top, 0, 0);
    return c;
  };
  // canvas row 0 is world z0 (flipY maps the top row to v = 1, the plane's z0 edge)
  const tx = new THREE.CanvasTexture(mix(A.image, B.image));
  tx.wrapS = THREE.ClampToEdgeWrapping; tx.wrapT = THREE.ClampToEdgeWrapping; tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = A.anisotropy;
  const gA = A.userData.glow?.image, gB = B.userData.glow?.image;
  if (gA || gB) {
    const black = document.createElement('canvas'); black.width = black.height = size; const bg = black.getContext('2d'); bg.fillStyle = '#000'; bg.fillRect(0, 0, size, size);
    const glow = new THREE.CanvasTexture(mix(gA || black, gB || black)); glow.wrapT = THREE.ClampToEdgeWrapping; glow.colorSpace = THREE.SRGBColorSpace;
    tx.userData.glow = glow;
  }
  return tx;
}
// side fields of a transition strip: colour A fading into colour B, with the same speckle as the plain fields
function blendFields(colA, colB, z0, z1, za, zb) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(Math.max(0, (za - z0) / (z1 - z0) + 0.15), hexCss(colA)); grd.addColorStop(Math.min(1, (zb - z0) / (z1 - z0) - 0.15), hexCss(colB));
  g.fillStyle = grd; g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 520; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,.08)' : 'rgba(255,255,255,.06)';
    g.beginPath(); g.arc(Math.random() * 128, Math.random() * 256, 2 + Math.random() * 6, 0, Math.PI * 2); g.fill();
  }
  const tx = new THREE.CanvasTexture(c);
  tx.wrapS = THREE.RepeatWrapping; tx.wrapT = THREE.ClampToEdgeWrapping; tx.colorSpace = THREE.SRGBColorSpace;
  return tx;
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
  for (let i = 0; i < (isTouch ? 90 : 120); i++) {
    let r = Math.random() * total, k = 0;
    while (r > sets[k][1]) { r -= sets[k][1]; k++; }
    const near = Math.random() < 0.5;
    const x = (Math.random() < 0.5 ? -1 : 1) * (near ? rand(ROAD_HALF + 2.5, ROAD_HALF + 10) : rand(ROAD_HALF + 10, 70));
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

// --- props: hand-built scenery (one instanced draw call per prop type) ----------------------
// items: [{x, z, ry, s}]; collide adds a jumpable box obstacle for each (rotation in quarter turns only)
function placeProps(name, items, { collide = true, shadow = true } = {}) {
  if (!items.length) return;
  const P = prop(name);
  const inst = new THREE.InstancedMesh(P.geo, P.glow ? vcGlow : vcMat, items.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), sc = new THREE.Vector3();
  items.forEach((it, i) => {
    const s = it.s || 1;
    m.compose(v.set(it.x, it.y || 0, it.z), q.setFromAxisAngle(up, it.ry || 0), sc.set(s, s, s));
    inst.setMatrixAt(i, m);
    if (collide && P.h > 0) {
      const quarter = Math.round((it.ry || 0) / (Math.PI / 2)) % 2 !== 0;
      const [rx, rz] = quarter ? [P.r[1], P.r[0]] : P.r;
      obstacles.push({ minX: it.x - rx * s, maxX: it.x + rx * s, minZ: it.z - rz * s, maxZ: it.z + rz * s, h: P.h * s, prop: true });
    }
  });
  inst.castShadow = shadow && P.h > 0; inst.receiveShadow = true;
  inst.computeBoundingSphere();
  scene.add(inst);
}
function landmark(geo, x, z, ry, s = 1) {
  const m = new THREE.Mesh(geo, vcMat.clone());   // own material: it fades out when it hides the player
  m.position.set(x, 0, z); m.rotation.y = ry; m.scale.setScalar(s);
  m.castShadow = true; m.receiveShadow = true;
  scene.add(m);
  m.updateMatrixWorld(true);
  occluders.push({ mesh: m, box: new THREE.Box3().setFromObject(m).expandByScalar(0.4), op: 1 });
  return m;
}
const ZONE_PROPS = {
  meadow: { edge: ['hay', 'hayRoll', 'crate', 'barrel', 'hay'], clutter: [['tuft', 60], ['daisies', 45], ['pebbles', 18]] },
  forest: { edge: ['logPile', 'mushroomBig', 'crate', 'barrel'], clutter: [['tuft', 50], ['leaves', 40], ['pebbles', 18]] },
  snow: { edge: ['snowman', 'snowCrate', 'barrel', 'snowCrate'], clutter: [['snowLump', 40], ['pebbles', 16]], banks: 'snowBank' },
  desert: { edge: ['pot', 'sackPile', 'crate', 'bones', 'pot'], clutter: [['dryBush', 34], ['pebbles', 30]] },
  volcano: { edge: ['crystal', 'charBarrel', 'crystal'], clutter: [['ashRocks', 50]], banks: 'lavaPool' },
};
let windBlades = null;
function scatterClutter(list, z0, z1, avoid, laneHalf = 6.8, xMax = ROAD_HALF - 0.8) {
  for (const [name, n] of list) {
    const items = [];
    for (let i = 0, tries = 0; i < (isTouch ? Math.ceil(n * 0.7) : n) && tries < n * 20; tries++) {
      const x = (Math.random() < 0.5 ? -1 : 1) * rand(laneHalf, xMax), z = rand(z0, z1);
      if (avoid.some(([ax, az, r]) => Math.hypot(x - ax, z - az) < r)) continue;
      items.push({ x, z, ry: rand(0, Math.PI * 2), s: rand(0.8, 1.3) }); i++;
    }
    placeProps(name, items, { collide: false, shadow: false });
  }
}
function dressZone(zone, zi) {
  const cfg = ZONE_PROPS[zone.decor];
  const len = zone.z1 - zone.z0;
  const fenceZ = [zone.z0 + len / 3, zone.z0 + len * 2 / 3];
  const bins = {};
  for (const side of [-1, 1]) {
    for (let z = zone.z0 + 5 + rand(0, 3); z < zone.z1 + 6; z += rand(4.5, 8)) {
      if (fenceZ.some((f) => Math.abs(z - f) < 3) || Math.random() < 0.25) continue;
      const name = cfg.edge[Math.floor(Math.random() * cfg.edge.length)];
      const ry = Math.random() < 0.5 ? 0 : Math.PI / 2;
      (bins[name] ||= []).push({ x: side * (ROAD_HALF - rand(1.2, 1.9)), z, ry: ry + (Math.random() < 0.5 ? Math.PI : 0) });
      if (Math.random() < 0.4) {   // a small cluster
        const n2 = cfg.edge[Math.floor(Math.random() * cfg.edge.length)];
        (bins[n2] ||= []).push({ x: side * (ROAD_HALF - rand(1.0, 1.6)), z: z + 1.7, ry: 0, s: 0.85 });
      }
    }
  }
  for (const [name, items] of Object.entries(bins)) placeProps(name, items);
  const avoid = nests.filter((n) => n.zone === zi).map((n) => [n.pos.x, n.pos.z, 2.6]);
  scatterClutter(cfg.clutter, zone.z0 - 2, zone.z1 + 4, avoid);
  // composed clusters: a ring of clutter around every nest, banks/pools hugging the fences outside
  const ring = cfg.clutter[0][0], ringItems = [];
  for (const n of nests.filter((q) => q.zone === zi)) for (let k = 0; k < 7; k++) { const a = k * 0.9 + rand(0, 0.4), r = rand(2.3, 3.4); ringItems.push({ x: n.pos.x + Math.cos(a) * r, z: n.pos.z + Math.sin(a) * r, ry: a, s: rand(1, 1.5) }); }
  placeProps(ring, ringItems, { collide: false, shadow: false });
  if (cfg.banks) {
    const banks = [];
    for (const side of [-1, 1]) for (let z = zone.z0; z < zone.z1 + 8; z += rand(5, 9)) banks.push({ x: side * (ROAD_HALF + rand(2, 6)), z, ry: rand(0, 6), s: rand(0.9, 1.6) });
    placeProps(cfg.banks, banks, { collide: false, shadow: false });
  }
  // a landmark or two just outside the fence
  const L = {
    meadow: () => { landmark(barn(), -33, zone.z0 + 30, Math.PI / 2); landmark(windmill(), 32, zone.z0 + 52, -Math.PI / 2); windBlades = new THREE.Mesh(windmillBlades(), vcMat); windBlades.position.set(30.2, 8.2, zone.z0 + 52); windBlades.rotation.y = -Math.PI / 2; scene.add(windBlades);
      placeProps('hay', [{ x: -26, z: zone.z0 + 22, ry: 0 }, { x: -26, z: zone.z0 + 23.2, ry: 0 }, { x: -26, z: zone.z0 + 22.6, y: 0.85, ry: 0 }, { x: -27.5, z: zone.z0 + 38, ry: Math.PI / 2 }], { collide: false }); },
    forest: () => { landmark(cabin(), -30, zone.z0 + 36, Math.PI / 2); },
    snow: () => { landmark(igloo(), 30, zone.z0 + 30, -Math.PI / 2); landmark(igloo(), -34, zone.z0 + 52, Math.PI / 2, 0.8); },
    desert: () => { landmark(tent(), -29, zone.z0 + 28, Math.PI / 2); landmark(tent(), 31, zone.z0 + 50, -Math.PI / 2, 0.9); },
    volcano: () => { landmark(ruin(), 30, zone.z0 + 34, 0.3); landmark(ruin(), -33, zone.z0 + 18, -0.5, 0.8); },
  };
  L[zone.decor]();
}
function dressBase() {
  landmark(barn(), 0, -47, 0, 1.1);
  landmark(windmill(), -30, -24, Math.PI / 2);
  const b = new THREE.Mesh(windmillBlades(), vcMat); b.position.set(-27.8, 8.2, -24); b.rotation.y = Math.PI / 2; scene.add(b); dressBase.blades = b;
  placeProps('hay', [{ x: -16.4, z: 20, ry: 0 }, { x: -16.4, z: 18.6, ry: Math.PI / 2, s: 0.9 }, { x: 16.4, z: -24, ry: 0 }, { x: 16.4, z: -26, ry: 0 }, { x: 16.4, z: -25, y: 0.85, ry: 0, s: 0.9 }]);
  placeProps('crate', [{ x: 16.6, z: 21, ry: 0 }, { x: 16.6, z: 19.8, ry: 0, s: 0.8 }, { x: -16.6, z: -26, ry: 0 }]);
  placeProps('barrel', [{ x: -16.8, z: -24, ry: 0 }, { x: 16.8, z: 3, ry: 0 }, { x: -16.8, z: 3, ry: 0 }]);
  placeProps('hayRoll', [{ x: 16.4, z: -18, ry: 0 }, { x: -16.4, z: -18, ry: 0 }]);
  const avoid = [[-9, 12, 3.4], [9, 12, 3.4], [0, 12, 2]];
  for (let i = 0; i < MAX_PENS; i++) avoid.push([-12.5 + (i % 6) * 5, -4 - Math.floor(i / 6) * 9, 3.3]);
  scatterClutter([['tuft', 40], ['daisies', 34], ['pebbles', 10]], -29, 25, avoid, 7.5);
}

// --- base --------------------------------------------------------------------
const pens = [];      // {pos, pad, lock, lockLabel, holder, label, shown}
let coinPlate, coinLabel, coinStack, shopPad;
const SPAWN = new THREE.Vector3(0, 0, 12);
let penPadGeo = null;

function buildBase() {
  const sign = makeLabel(t('yourBase'), '#ffd84a', 512, 96, 6);
  sign.position.set(0, 4.6, -27); scene.add(sign); baseSign = sign;
  // safe-zone edge: a painted dashed line on the ground (a raised neon bar read as a rendering glitch)
  {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 32; const g = c.getContext('2d');
    g.fillStyle = 'rgba(255,246,214,.9)';
    for (let i = 0; i < 18; i++) { const x = i * 1024 / 18 + 10; g.beginPath(); g.roundRect(x, 6, 1024 / 18 - 20, 20, 10); g.fill(); }
    const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 4;
    const line = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2 - 2, 0.55), new THREE.MeshLambertMaterial({ map: tx, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    line.rotation.x = -Math.PI / 2; line.position.set(0, 0.01, BASE_LIMIT_Z); line.receiveShadow = true; scene.add(line);
  }

  const penFences = [];
  for (let i = 0; i < MAX_PENS; i++) {
    const row = Math.floor(i / 6), col = i % 6;
    const pos = new THREE.Vector3(-12.5 + col * 5, 0, -4 - row * 9);
    const pad = new THREE.Mesh(penPadGeo || (penPadGeo = penPad()), vcMat); pad.position.set(pos.x, 0, pos.z); pad.receiveShadow = true; scene.add(pad);
    const lock = makeLabel('🔒', '#fff', 128, 128, 2.2); lock.position.set(pos.x, 1.6, pos.z); scene.add(lock);
    const lockLabel = makeLabel('', '#ffd84a', 256, 64, 3.6); lockLabel.position.set(pos.x, 3.0, pos.z); scene.add(lockLabel);
    const holder = new THREE.Group(); holder.position.set(pos.x, 0.24, pos.z); scene.add(holder);
    const label = makeLabel('', '#fff', 256, 64, 3.4); label.position.set(pos.x, 3.6, pos.z); scene.add(label);
    pens.push({ pos, pad, lock, lockLabel, holder, label, shown: null });
    const h = 2.2;
    fenceLine(penFences, pos.x - h, pos.z - h, pos.x + h, pos.z - h, 1.1);
    fenceLine(penFences, pos.x - h, pos.z + h, pos.x - h, pos.z - h, 1.1);
    fenceLine(penFences, pos.x + h, pos.z - h, pos.x + h, pos.z + h, 1.1);
    // the fence models sit 0.51 inside the line: collide where they are drawn (back + both sides, front stays open)
    const fi = h - 0.51, ft = 0.14;
    obstacles.push({ minX: pos.x - fi - ft, maxX: pos.x + fi + ft, minZ: pos.z - fi - ft, maxZ: pos.z - fi + ft, h: 1.0 });
    for (const sx of [-1, 1]) obstacles.push({ minX: pos.x + sx * fi - ft, maxX: pos.x + sx * fi + ft, minZ: pos.z - fi, maxZ: pos.z + fi, h: 1.0 });
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

  dressBase();
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
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 9.6, 10), mat(zone.arch)); post.castShadow = true;
    post.position.set(side * (ROAD_HALF - 0.6), 4.8, zone.z0); scene.add(post); camBlockers.push(post);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), mat(0xffd84a, { emissive: 0x4a3a00 }));
    ball.position.set(side * (ROAD_HALF - 0.6), 10.2, zone.z0); scene.add(ball);
  }
  const beam = box(ROAD_HALF * 2 - 1, 1.3, 0.8, zone.arch); beam.position.set(0, 9, zone.z0); scene.add(beam); camBlockers.push(beam);
  const title = makeLabel(`${zi + 1}. ${t('zone')[zi].toUpperCase()}`, '#fff', 512, 96, isTouch ? 14 : 10); title.position.set(0, 11.4, zone.z0); scene.add(title); zone.titleLabel = title;

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

  // nests near the far end (the meadow also gets a starter nest right behind its gate)
  const straw = [];
  const spots = [-10, 0, 10].map((x) => [x + rand(-2, 2), zone.z1 - rand(4, 12)]);
  if (zi === 0) spots.unshift([0, zone.z0 + 14]);   // a first egg right behind the gate
  for (const [x, z] of spots) {
    const pos = new THREE.Vector3(x, 0, z);
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
    const mesh = makeBird(zone.guard.bird, zone.guard.scale);
    mesh.position.set(rand(-ROAD_HALF + 4, ROAD_HALF - 4), 0, rand(zone.z1 - 14, zone.z1 - 1));
    scene.add(mesh);
    mesh.userData.blob = blobShadow(2.6 * zone.guard.scale); scene.add(mesh.userData.blob);
    mesh.userData.play?.('idle');
    const alert = makeLabel('!', '#ff3b3b', 64, 64, 1.8); alert.position.y = mesh.userData.height + 0.9; alert.visible = false; mesh.add(alert);
    // the meadow's first guard walks past the starter nest, so the first steal starts a chase
    const patrol = zi === 0 && g === 0 ? [zone.z0 + 25, zone.z0 + 34] : [zone.z1 - 14, zone.z1 - 1];   // behind the nest: it chases, it doesn't block
    if (zi === 0 && g === 0) mesh.position.z = zone.z0 + 28;
    guards.push({ zone: zi, mesh, state: 'return', target: new THREE.Vector3(), alert, wait: 0, vault: null, patrol });
  }
  dressZone(zone, zi);
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

// the stock ninja texture is grey on grey and reads as a black block in game: give the player
// an indigo outfit, navy trousers, a thick red belt and a red headband (guards keep their own looks)
function recolorNinja(obj) {
  let src = null;
  obj.traverse((o) => { if (o.isMesh && !src) src = o.material.map; });
  const img = src?.image;
  if (!img?.width) return;
  const W = img.width, H = img.height, k = W / 1024;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, W, H), px = d.data;
  // the glTF loader may hand over the image upside down: find the face (skin) to know which way is up
  const skin = (x, y) => { const i = (Math.floor(y) * W + Math.floor(x)) * 4; return px[i] > 200 && px[i + 1] > 170 && px[i + 2] < 190; };
  const flip = !skin(160 * k, 200 * k) && skin(160 * k, H - 200 * k);
  const Y = (y, h = 0) => (flip ? H - y - h : y);
  const top = [46, 74, 140], topHi = [92, 128, 210], low = [30, 40, 70], lowHi = [62, 78, 120];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, r = px[i], gg = px[i + 1], bb = px[i + 2];
    const mx = Math.max(r, gg, bb), mn = Math.min(r, gg, bb);
    if (mx - mn > 40) continue;                         // skin, face and the belt keep their colours
    const lum = Math.min(1, Math.max(0, (mx - 30) / 80));
    const legs = x >= 470 * k && Y(y) >= 790 * k;
    const [a0, a1] = legs ? [low, lowHi] : [top, topHi];
    px[i] = a0[0] + (a1[0] - a0[0]) * lum; px[i + 1] = a0[1] + (a1[1] - a0[1]) * lum; px[i + 2] = a0[2] + (a1[2] - a0[2]) * lum;
  }
  g.putImageData(d, 0, 0);
  g.fillStyle = '#d94f4f';
  g.fillRect(0, Y(874 * k, 36 * k), 448 * k, 36 * k);    // belt, about 1.5x thicker
  g.fillRect(0, Y(128 * k, 22 * k), 512 * k, 22 * k);    // headband above the eyes, all round the head
  g.fillStyle = '#a8343a';
  g.fillRect(0, Y(906 * k, 4 * k), 448 * k, 4 * k); g.fillRect(0, Y(146 * k, 4 * k), 512 * k, 4 * k);
  const tex = src.clone();   // keeps the model's own UV settings; only the picture changes
  tex.image = c; tex.needsUpdate = true;
  obj.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.map = tex; } });
}

function buildPlayer() {
  player = spawn('char:r', { scale: 1.05 });
  recolorNinja(player);
  player.position.copy(SPAWN);
  player.rotation.y = Math.PI;
  carryEgg.position.y = 4.1;
  player.add(carryEgg);
  scene.add(player);
  player.userData.blob = blobShadow(2.2); scene.add(player.userData.blob);
  // headband tails: two red ribbons knotted at the back of the head that stream out behind while running
  const head = player.userData.model?.getObjectByName('head');
  if (head) {
    const bb = new THREE.Box3();
    head.traverse((o) => { if (o.isMesh) { o.geometry.computeBoundingBox(); const b2 = o.geometry.boundingBox.clone(); if (o !== head) b2.applyMatrix4(o.matrix); bb.union(b2); } });
    const hsz = bb.getSize(new THREE.Vector3()), knot = new THREE.Group();
    knot.position.set((bb.min.x + bb.max.x) / 2, bb.min.y + hsz.y * 0.72, bb.min.z - 0.01);
    const tails = [-1, 1].map((side) => {
      const piv = new THREE.Group(); piv.rotation.y = side * 0.35;
      const rib = new THREE.Mesh(new THREE.BoxGeometry(hsz.x * 0.12, hsz.y * 0.08, hsz.z * 0.62), mat(0xd94f4f));
      rib.position.z = -hsz.z * 0.31; rib.castShadow = true; piv.add(rib); knot.add(piv);
      return piv;
    });
    knot.add(new THREE.Mesh(new THREE.BoxGeometry(hsz.x * 0.22, hsz.y * 0.16, hsz.z * 0.1), mat(0xa8343a)));
    head.add(knot);
    player.userData.tails = tails;
  }
  player.userData.play?.('idle');
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
let camYaw = Math.PI, camPitch = 0.17, camDist = 9;
// chase camera: while a bird chases you, the view swings a little to one side so the bird behind shows up in frame
let camOffset = 0, camOffsetTarget = 0, chaseSide = 0, camLift = 0, camDistS = 0, dangerK = 0, camOffsetV = 0, camLiftV = 0, liftHold = 0;
// critically damped spring: no velocity jumps when a target changes (an exponential ease starts at full speed)
const spring = (x, v, target, k, dt) => { v += ((target - x) * k * k - 2 * k * v) * dt; return [x + v * dt, v]; };
const camFollow = new THREE.Vector3(), camLookOff = new THREE.Vector3(); let camFollowInit = false;
const camLook = new THREE.Vector3();
const occluders = [];    // big landmarks (barn, windmill, cabin...): fade out while they sit between the camera and the player
const camBlockers = [];   // gate posts and beams: the camera slides in front of them instead of through
let camYawTarget = null, camYawVel = 0;
const CAM_YAW_MAX = 1.4, CAM_YAW_ACC = 3;   // rad/s (80°/s), rad/s²
let moveYaw = null;   // while set, held keys keep their direction even as the camera swings round
const moveIn = { x: 0, z: 0 };   // the input that was held when moveYaw latched: a new direction releases it
let jumpQueued = false;
const joy = { active: false, id: null, x: 0, y: 0, cx: 0, cy: 0 };
if (isTouch) document.body.classList.add('touch');

window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.code === 'Space') jumpQueued = true;
  // Esc closes a window, or pauses the game behind the settings window (Poki asks for an Esc pause)
  if (e.code === 'Escape') { if (panelOpen) closePanels(); else if (started && !platform.ownAudioControl) openPanel('settingsPanel'); }
  audio.unlock();
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

let drag = null;
canvas.addEventListener('pointerdown', (e) => { camYawTarget = null; camYawVel = 0; moveYaw = null; drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ } audio.unlock(); });
canvas.addEventListener('pointermove', (e) => {
  if (!drag || drag.id !== e.pointerId) return;
  camYaw -= (e.clientX - drag.x) * 0.006;
  camPitch = Math.min(1.1, Math.max(0.05, camPitch + (e.clientY - drag.y) * 0.004));
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
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 && e.cancelable) e.preventDefault(); }, { passive: false });

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
  $('logo').src = `./assets/ui/logo-${getLang() === 'ru' ? 'ru' : 'en'}.webp`; $('logo').alt = t('title');
  $('controlsText').textContent = isTouch ? t('controlsTouch') : t('controlsPc');
  $('carry').innerHTML = icon('egg'); $('carry').appendChild(document.createTextNode(t('carry')));
  applyIcons();
  document.title = t('docTitle');
}
// emoji render differently on every device and look like placeholder art: swap them for our own icon set
const COIN_HTML = `<i class="cn">${ICONS.coin}</i>`;
const EMOJI_ICON = { '🪙': 'coin', '🥚': 'egg', '🚀': 'boost', '🏠': 'home', '🎬': 'ad', '🗺️': 'map', '🗺': 'map', '🔒': 'lock', '🛒': 'shop', '👟': 'speed', '📈': 'income',
  '🌀': 'rebirth', '✨': 'star', '⭐': 'star', '🏆': 'star', '🎁': 'gift', '🔊': 'sound', '🎵': 'music', '😵': 'caught', '💤': 'moon', '🏃': '', '🎉': '' };
const EMOJI_RE = new RegExp(Object.keys(EMOJI_ICON).sort((a, b) => b.length - a.length).join('|'), 'g');
const coinify = (el) => {
  if (EMOJI_RE.test(el.innerHTML)) el.innerHTML = el.innerHTML.replace(EMOJI_RE, (m) => (m === '🪙' ? COIN_HTML : EMOJI_ICON[m] ? icon(EMOJI_ICON[m]) : '')).trim();
  EMOJI_RE.lastIndex = 0;
  return el;
};
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
  $('reveal').classList.remove('open'); revealTimer = 0;   // one thing in front at a time
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
$('titleGear').addEventListener('click', () => openPanel('settingsPanel'));
if (platform.ownAudioControl) { $('gear').classList.add('hidden'); $('titleGear').classList.add('hidden'); }   // the portal's own mute switch is the only one

function row(ico, title, desc, icoBg) {
  const r = document.createElement('div');
  r.className = 'row';
  r.innerHTML = `<div class="ico"${icoBg ? ` style="background:${icoBg}"` : ''}>${ico}</div><div class="txt"><b></b><span></span></div>`;
  r.querySelector('.txt b').textContent = title; r.querySelector('.txt span').textContent = desc;
  coinify(r.querySelector('.txt')); coinify(r.querySelector('.ico'));
  return r;
}
function button(label, cls, onClick, disabled = false) {
  const b = document.createElement('button');
  b.className = 'btn ' + cls; b.textContent = label; b.disabled = disabled;
  coinify(b);
  b.addEventListener('click', () => { audio.unlock(); onClick(b); });
  return b;
}

// zones whose birds you can't outrun yet: the first is the next goal
const nextZoneIdx = () => ZONES.findIndex((z) => z.guard.speed >= playerSpeed());
// speed meter: markers sit evenly along the track, the fill moves piecewise between them
const MK = (i) => 0.1 + 0.2 * i;
function meterFill(sp) {
  const S = ZONES.map((z) => z.guard.speed);
  if (sp <= S[0]) return MK(0) * sp / S[0];
  for (let i = 0; i < S.length - 1; i++) if (sp < S[i + 1]) return MK(i) + 0.2 * (sp - S[i]) / (S[i + 1] - S[i]);
  return Math.min(1, MK(S.length - 1) + 0.1 * (sp - S[S.length - 1]) / 5);
}
function renderShop() {
  const list = $('shopList');
  list.innerHTML = '';
  $('shopBal').innerHTML = COIN_HTML + fmt(state.coins);
  const buyBtn = (cost, cls, buy) => button(`🪙 ${fmt(cost)}`, cls, () => {
    if (state.coins < cost) { audio.play('error'); return; }
    state.coins -= cost; buy(); audio.play('buy'); save(); renderShop(); updateHud(true);
  }, state.coins < cost);
  const buyRow = (ico, title, desc, cost, buy, cls = 'gold') => {
    const r = row(icon(ico), title, desc);
    if (cost != null) r.appendChild(buyBtn(cost, cls, buy));
    list.appendChild(r);
  };
  {
    // speed leads the shop: it is the whole loop (outrun the next birds), so its card carries the meter
    const sp = playerSpeed(), next = nextZoneIdx();
    const card = document.createElement('div');
    card.className = 'row feat';
    card.innerHTML = `<div class="ico">${icon('speed')}</div><div class="txt"><b></b></div><div class="meter"><div class="track"><i></i></div></div>`;
    card.querySelector('b').innerHTML = `${t('speed')} ${sp.toFixed(1)} ➜ <em>${(sp + SPEED_STEP).toFixed(1)}</em>`;
    const gs = curGoal()?.shop;
    card.insertBefore(buyBtn(speedCost(state.speedLvl), 'gold' + (state.tut === 4 || gs === 'speed' ? ' goal' : ''), () => { state.speedLvl++; if (state.tut === 4) advanceTut(); }), card.querySelector('.meter'));
    const meter = card.querySelector('.meter');
    meter.querySelector('.track i').style.width = (meterFill(sp) * 100).toFixed(1) + '%';
    ZONES.forEach((z, i) => {
      const m = document.createElement('div');
      m.className = 'mk' + (sp > z.guard.speed ? ' ok' : '');
      m.style.left = (MK(i) * 100) + '%';
      m.innerHTML = `${i === next ? `<div class="tag">${t('nextZone', { z: t('zone')[i] })}</div>` : ''}${icon(BIRD_ICONS[i])}<span>${z.guard.speed}</span>`;
      meter.appendChild(m);
    });
    list.appendChild(card);
  }
  if (state.pens < MAX_PENS) buyRow('pen', t('pen', { a: state.pens + 1, b: MAX_PENS }), t('penDesc'), PEN_COST[state.pens], () => { state.pens++; audio.play('unlock'); renderGoal.key = ''; }, 'gold' + (curGoal()?.shop === 'pen' || pensFull() ? ' goal' : ''));
  else buyRow('pen', t('pensAll'), t('pensAllDesc'), null);
  buyRow('income', t('income'), t('incomeDesc', { m: incomeMult().toFixed(1) }), incomeCost(state.incomeLvl), () => state.incomeLvl++);
  {
    // ×2 income: watch an ad OR pay coins; capped so the offer never stacks forever
    const leftMs = Math.max(0, state.boostUntil - Date.now());
    const full = leftMs > BOOST_CAP_MS - BOOST_MS;
    const r = row(icon('boost'), leftMs ? t('boostOn', { m: Math.ceil(leftMs / 60000) }) : t('boostOff'), full ? t('boostFull') : t(platform.hasRewarded ? 'boostDesc' : 'boostDescCoins'));
    const give = () => { state.boostUntil = Math.max(Date.now(), state.boostUntil) + BOOST_MS; audio.play('buy'); toast(t('boostToast') + ' 🚀', '#ffd84a'); save(); };
    if (!full) {
      const cost = boostCost();
      r.appendChild(button(`🪙 ${fmt(cost)}`, 'gold', () => {
        if (state.coins < cost) { audio.play('error'); return; }
        state.coins -= cost; give(); renderShop(); updateHud(true);
      }, state.coins < cost));
      if (platform.hasRewarded) r.appendChild(button(`🎬 ${t('watch')}`, platform.adColor, async (b) => {
        b.disabled = true;
        const ok = await withAd((onStart) => platform.rewarded(onStart));
        if (ok) give(); else toast(t('noAd'), '#ff9a5a');
        renderShop(); updateHud(true);
      }));
    }
    list.appendChild(r);
  }
  if (nextZoneIdx() < 0) list.appendChild(row(icon('star'), t('allGoal'), t('allGoalDesc')));
}

function renderPets() {
  const list = $('petsList');
  list.innerHTML = '';
  // weakest pet first, so the one worth selling is always on top; eggs go last
  const order = state.slots.slice(0, state.pens).map((p, i) => [p, i]).filter(([p]) => p)
    .sort(([a], [b]) => (a.kind === 'egg') - (b.kind === 'egg') || (a.kind === 'pet' ? petIncome(a) - petIncome(b) : a.hatchAt - b.hatchAt));
  $('petsCount').textContent = `${order.length}/${state.pens}`;
  $('petsHint').classList.toggle('hidden', order.length < state.pens);
  let first = true;
  order.forEach(([p, i]) => {
    const el = document.createElement('div');
    if (p.kind === 'egg') {
      const left = Math.max(0, Math.ceil((p.hatchAt - Date.now()) / 1000));
      el.className = 'row pet egg';
      el.innerHTML = `<div class="ico">${icon('egg')}</div><div class="txt"><b></b></div><div class="hatch">${icon('egg')}<span class="v"></span></div>`;
      el.querySelector('b').textContent = t('eggOf', { z: t('zone')[p.zone] });
      el.querySelector('.hatch .v').textContent = t('hatchesIn', { s: left });
    } else {
      const r = RARITIES[p.rarity];
      el.className = 'row pet' + (first ? ' weak' : '');
      first = false;
      el.innerHTML = `<div class="ico" style="background:${r.color}44">${petImg(speciesIdx(p), p.golden)}</div><div class="txt"><b></b><span class="rar"></span></div><div class="rate">${icon('income')}<span class="v"></span></div>`;
      el.querySelector('b').textContent = petName(p);
      if (p.golden) el.querySelector('b').style.color = '#c98a0c';
      const rar = el.querySelector('.rar'); rar.textContent = t('rarity')[p.rarity]; rar.style.background = r.color;
      el.querySelector('.rate .v').textContent = `${fmtRate(petIncome(p))}${t('perSec')}`;
      const value = Math.round(petIncome(p) * 20);
      el.appendChild(button(`${t('sell')} 🪙 ${fmt(value)}`, 'gold', () => {
        state.coins += value; state.slots[i] = null; audio.play('coin'); bumpCoins(); save(); renderPets(); updateHud(true);
      }));
    }
    list.appendChild(el);
  });
  if (!order.length) list.innerHTML = `<div class="empty">${t('noPets')}</div>`;
}

// little portraits of each pet species for the UI, rendered once from the real 3D models
const PET_THUMBS = [];
function renderPetThumbs() {
  const r = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  r.setSize(128, 128, false);
  r.outputColorSpace = renderer.outputColorSpace; r.toneMapping = renderer.toneMapping;
  const sc = new THREE.Scene();
  sc.add(new THREE.HemisphereLight(0xffffff, 0x9a7a5a, 2.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(3, 6, 5); sc.add(sun);
  const cam = new THREE.PerspectiveCamera(26, 1, 0.1, 200);
  const box = new THREE.Box3(), size = new THREE.Vector3(), mid = new THREE.Vector3();
  PET_FILES.forEach((f, i) => {
    const m = spawn('pet:' + f, { shadow: false });
    m.rotation.y = 0.45; sc.add(m);
    box.setFromObject(m); box.getSize(size); box.getCenter(mid);
    const d = Math.max(size.x, size.y, size.z) * 2.5;
    cam.position.set(mid.x + d * 0.25, mid.y + d * 0.28, mid.z + d); cam.lookAt(mid);
    r.render(sc, cam);
    PET_THUMBS[i] = r.domElement.toDataURL('image/png');
    sc.remove(m);
  });
  r.dispose(); r.forceContextLoss();
}
const petImg = (idx, golden = false) => `<img class="pthumb${golden ? ' gold' : ''}" src="${PET_THUMBS[idx] || ''}" alt="" draggable="false">`;

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
    c.innerHTML = `<span class="em">${v ? petImg(r * 3 + s, !!(v & 2)) : '?'}</span><div></div><div style="color:${RARITIES[r].color}"></div>${v & 2 ? '<div class="gd">★ ' + t('golden') + '</div>' : ''}`;
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
  for (const [key, label, ic] of [['sound', t('sound'), 'sound'], ['music', t('music'), 'music'], ['shake', t('shake'), 'cam']]) {
    const r = row(icon(ic), label, '');
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
  el.querySelector('.rimg').innerHTML = petImg(speciesIdx(p), p.golden);
  el.querySelector('.rname').textContent = petName(p);
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
  const boostLeft = Math.max(0, Math.ceil((state.boostUntil - Date.now()) / 1000));
  const s = `${Math.floor(state.coins)}|${Math.floor(incomePerSec())}|${playerSpeed()}|${boostLeft}|${state.rebirths}|${giftAvailable()}|${canRebirth()}|${Object.keys(state.index).length}`;
  if (s === hudCache && !force) return;
  hudCache = s;
  $('coins').textContent = fmt(state.coins);
  $('income').textContent = fmtRate(incomePerSec());
  $('inc2').textContent = `+${fmtRate(incomePerSec())}${t('perSec')}`;
  $('incomeChip').classList.toggle('hidden', incomePerSec() <= 0);
  document.querySelector('#coinChip .inc').classList.toggle('hidden', incomePerSec() <= 0);
  // speed chip: your speed and the next birds to beat (the full meter lives in the shop)
  const next = nextZoneIdx();
  $('spdNow').textContent = playerSpeed().toFixed(1);
  $('spdNext').innerHTML = next >= 0 ? `${icon(BIRD_ICONS[next])}${ZONES[next].guard.speed}` : icon('star');
  $('boostChip').classList.toggle('hidden', !boostLeft);
  $('boostTime').textContent = `${Math.floor(boostLeft / 60)}:${String(boostLeft % 60).padStart(2, '0')}`;
  $('btnIndex').classList.toggle('hidden', !Object.keys(state.index).length);
  $('btnGift').classList.toggle('hidden', !giftAvailable());
  $('btnRebirth').classList.toggle('hidden', !canRebirth() && !state.rebirths);
  $('rbChip').classList.toggle('hidden', !state.rebirths);
  $('rbText').textContent = `×${rebirthIncome().toFixed(1)}`;
  $('btnGift').classList.toggle('dot', giftAvailable());
  $('btnRebirth').classList.toggle('dot', canRebirth());
}

// ---------------------------------------------------------------------------
// Tutorial
// ---------------------------------------------------------------------------
function showTut() {
  const el = $('tut');
  if (!started) { el.classList.add('hidden'); return; }
  if (state.tut >= 5) { renderGoal(); return; }
  el.classList.remove('hidden');
  el.innerHTML = `<span class="step">${state.tut + 1}/5</span><span></span>`;
  el.lastChild.textContent = t('tut')[state.tut];
}
function advanceTut() {
  state.tut++;
  if (state.tut === 5) { toast(t('tutDone') + ' ⭐', '#ffd84a'); audio.play('goal'); skipDoneGoals(); goalHold = 1.5; }
  else audio.blip([784, 1047], 0.07, 0.05);
  showTut(); save();
}
const guideTarget = new THREE.Vector3();
function tutTarget() {
  if (carrying && !(state.tut >= 5 && pensFull())) return guideTarget.set(0, 0, BASE_LIMIT_Z - 3);
  if (state.tut >= 5) return goalTarget();
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

// ---------------------------------------------------------------------------
// Goals: after the tutorial there is always ONE next thing to do, with a reward and a celebration.
// Spaced so something new happens every 20-40 s in the first minutes (golden egg, 3 pets, speed, pen, turkeys...).
// ---------------------------------------------------------------------------
const petsOwned = () => state.slots.filter((s, i) => i < state.pens && s && s.kind === 'pet').length;
const GOALS = [
  { id: 'golden', n: 1, prog: () => state.goldenDone, reward: 0 },
  { id: 'pets3', n: 3, prog: petsOwned, reward: 40 },
  { id: 'pen5', n: 5, prog: () => state.pens, reward: 60, shop: 'pen' },
  { id: 'speed3', n: 3, prog: () => state.speedLvl, reward: 80, shop: 'speed' },
  { id: 'beat', n: 5, prog: () => state.speedLvl, reward: 120, shop: 'speed' },
  { id: 'forest', n: 1, prog: () => (state.best >= 2 ? 1 : 0), reward: 250, zone: 1 },
  { id: 'pets8', n: 8, prog: petsOwned, reward: 600 },
  { id: 'snow', n: 1, prog: () => (state.best >= 3 ? 1 : 0), reward: 1500, zone: 2 },
  { id: 'epic', n: 1, prog: () => (state.slots.some((s) => s && s.kind === 'pet' && s.rarity >= 3) ? 1 : 0), reward: 3000, zone: 2 },
  { id: 'desert', n: 1, prog: () => (state.best >= 4 ? 1 : 0), reward: 8000, zone: 3 },
  { id: 'volcano', n: 1, prog: () => (state.best >= 5 ? 1 : 0), reward: 30000, zone: 4 },
];
const curGoal = () => (state.tut >= 5 ? GOALS[state.goal] : null);
// every open pen holds something: the next egg has nowhere to go, so buying a pen becomes the goal for now
const pensFull = () => state.pens < MAX_PENS && state.slots.slice(0, state.pens).every(Boolean);
function shopOrPlate(cost) {
  if (state.coins >= cost) return guideTarget.copy(shopPad.position).setY(0);
  if (state.coins + state.bank >= cost) return guideTarget.copy(coinPlate.position).setY(0);
  return null;
}
// returning players: goals they already passed are skipped without a party
function skipDoneGoals() { while (GOALS[state.goal] && GOALS[state.goal].prog() >= GOALS[state.goal].n) state.goal++; }
let goalHold = 0;   // seconds the banner keeps showing "done" before the next goal slides in
function renderGoal() {
  const el = $('tut'), g = curGoal();
  if (pensFull() && goalHold <= 0) {
    el.classList.remove('hidden');
    const key = `full|${state.pens}`;
    if (renderGoal.key === key) return;
    renderGoal.key = key;
    el.innerHTML = `<span class="step goalico">🔒</span><span class="gtxt"></span><span class="grew">🪙 ${fmt(PEN_COST[state.pens])}</span>`;
    el.querySelector('.gtxt').textContent = t('goalFull', { n: state.pens + 1 });
    coinify(el);
    return;
  }
  if (!g) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const p = Math.min(g.n, g.prog());
  const txt = t('goals')[g.id].replace('{n}', g.n);
  const key = `${g.id}|${p}`;
  if (renderGoal.key === key) return;
  renderGoal.key = key;
  el.innerHTML = `<span class="step goalico">🎯</span><span class="gtxt"></span>${g.n > 1 ? `<span class="gprog">${p}/${g.n}</span>` : ''}${g.reward ? `<span class="grew">🪙 ${fmt(g.reward)}</span>` : ''}`;
  el.querySelector('.gtxt').textContent = txt;
  coinify(el);
}
function checkGoals(dt) {
  if (state.tut < 5) return;
  if (goalHold > 0) { goalHold -= dt; if (goalHold <= 0) { renderGoal.key = ''; $('tut').classList.add('slidein'); setTimeout(() => $('tut').classList.remove('slidein'), 600); startGoal(); showTut(); } return; }
  const g = curGoal(); if (!g) return;
  if (g.prog() >= g.n) completeGoal(g); else renderGoal();
}
function startGoal() {
  const g = curGoal(); if (!g) return;
  if (g.id === 'golden') spawnGolden();
}
function completeGoal(g) {
  state.goal++;
  if (g.reward) { state.coins += g.reward; bumpCoins(); }
  audio.play('goal');
  const el = $('goaldone');
  el.querySelector('.gd1').textContent = t('goalDone');
  el.querySelector('.gd2').textContent = g.reward ? t('goalReward', { n: fmt(g.reward) }) : t('goalPet');
  coinify(el.querySelector('.gd2'));
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  fx.confetti(player.position.clone().setY(3), 90, [0xffd23a, 0x7dff6a, 0x5ac8ff, 0xff7ab8]);
  fx.ring(player.position, 0xffd23a, 6, 0.8);
  fx.sparkle(player.position.clone().setY(2), 0xffe27a, 18, 1.6);
  if (g.reward) fx.text(player.position.clone().setY(4.4), `+${fmt(g.reward)}`, '#ffd84a', 2.6);
  $('tut').classList.add('gdone');
  setTimeout(() => $('tut').classList.remove('gdone'), 1400);
  goalHold = 1.6;
  save(); updateHud(true);
}
// where the arrow points for the current goal
function goalTarget() {
  if (pensFull()) return shopOrPlate(PEN_COST[state.pens]);
  const g = curGoal(); if (!g || goalHold > 0) return null;
  const nearestNest = (zone) => {
    let best = null, bd = Infinity;
    for (const n of nests) if (n.zone === zone && n.available) { const d = n.pos.distanceTo(player.position); if (d < bd) { bd = d; best = n; } }
    return best ? guideTarget.copy(best.pos) : null;
  };
  if (g.id === 'golden') { const n = nests.find((q) => q.special); return n && n.available ? guideTarget.copy(n.pos) : null; }
  if (g.shop) return shopOrPlate(g.shop === 'speed' ? speedCost(state.speedLvl) : PEN_COST[state.pens]);   // null = not enough yet: free to steal, no nagging
  if (g.zone) return playerSpeed() > ZONES[g.zone].guard.speed ? nearestNest(g.zone) : null;
  return null;
}
// the golden egg: one special nest in the Meadow, a tall light beam, guaranteed rare+ golden pet
function spawnGolden() {
  if (state.goldenDone || nests.some((n) => n.special)) return;
  const n = nests.filter((q) => q.zone === 0).sort((a, b) => a.pos.z - b.pos.z)[0];   // the starter nest right behind the gate: visible from home
  n.special = true;
  n.normalEgg = n.egg;
  n.egg.visible = false;
  const egg = makeEgg(0xffd23a, 1.15); egg.position.copy(n.normalEgg.position); scene.add(egg); n.egg = egg;
  n.available = true; n.egg.visible = true; n.glow.visible = true;
  n.beamT = 0;
  toast(t('goldenUp'), '#ffd23a', 3200);
  audio.play('unlock');
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
    c.rotation.z = ang + Math.PI;   // the shape points +y; after the -90° x tilt that is -z, so turn it by ang + 180°
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
  carrying = { zone: nest.zone, golden: !!nest.special };
  if (nest.special) { nest.special = false; scene.remove(nest.egg); nest.egg = nest.normalEgg; nest.egg.visible = false; }
  carryEgg.clear();
  carryEgg.add(makeEgg(carrying.golden ? 0xffd23a : ZONES[nest.zone].egg, 0.9));
  carryEgg.userData.pop = 0;   // pops in: overshoots to 1.12x, settles in a quarter second
  $('carry').style.display = state.tut >= 5 ? 'flex' : 'none';   // during the tutorial the objective already says it
  audio.play('grab');
  fx.burst(nest.pos.clone().setY(1), 0xffc94d, 30, 7);
  fx.burst(nest.pos.clone().setY(1.4), 0xffffff, 14, 5);
  fx.ring(nest.pos, 0xffd23a, 4.5);
  fx.shake(0.16);
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
  const rarity = carrying.golden ? Math.max(1, rollRarity(zone.weights)) : rollRarity(zone.weights);
  const mult = Math.round((0.8 + Math.pow(Math.random(), 2.2) * 0.8) * 100) / 100;
  state.slots[idx] = {
    kind: 'egg', zone: carrying.zone, rarity, species: Math.floor(Math.random() * 3),
    mult, golden: carrying.golden || Math.random() < 0.05, hatchAt: Date.now() + (carrying.golden ? 5 : zone.hatch) * 1000,
  };
  if (carrying.golden) state.goldenDone = 1;
  state.best = Math.max(state.best, carrying.zone + 1);
  const eggColor = ZONES[carrying.zone].egg;
  dropCarry();
  audio.play('place');
  fx.confetti(pens[idx].pos.clone().setY(1.5), 45);
  fx.confetti(player.position.clone().setY(2.5), 40);
  fx.ring(player.position, 0x7dff6a, 5);
  fx.pillar(pens[idx].pos, eggColor, 1.2, 7, 1.4);
  fx.text(player.position.clone().setY(4.6), '+1', '#8dff8d', 2.2);
  toast(t('placed') + ' 🥚', '#8dff8d');
  if (state.tut === 1) advanceTut();
  save();
}

function caught() {
  const lostGolden = carrying?.golden && !state.goldenDone;
  dropCarry();
  if (lostGolden) setTimeout(spawnGolden, 1200);   // the golden egg goes back to its nest: the goal can't get lost
  state.caughtN = (state.caughtN || 0) + 1;
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
  const rare = s.rarity >= 3 || s.golden, rc = new THREE.Color(RARITIES[s.rarity].color).getHex();
  fx.shards(pos.clone().setY(1.1), ZONES[s.zone].egg, 16);
  fx.pillar(pens[i].pos, s.golden ? 0xffd23a : rc, rare ? 2.4 : 1.4, rare ? 14 : 8, rare ? 2.2 : 1.6);
  fx.ring(pens[i].pos, s.golden ? 0xffd23a : rc, rare ? 7 : 4.5, 0.7);
  if (rare) for (let k = 1; k <= 4; k++) setTimeout(() => { fx.sparkle(pos.clone().setY(1.5), s.golden ? 0xffd23a : rc, 14, 1.4); fx.ring(pens[i].pos, 0xffffff, 3 + k, 0.5); }, k * 280);
  fx.confetti(pos, s.rarity >= 3 || s.golden ? 110 : 50, s.golden ? [0xffd23a, 0xfff2a0, 0xffffff] : undefined);
  audio.play(rare ? 'hatch_rare' : 'hatch'); audio.play('crack', { vol: 0.7, jitter: 0.05 });
  fx.text(pos.clone().setY(4), `+${fmtRate(petIncome(s))}${t('perSec')}`, RARITIES[s.rarity].color);
  if (isNew || s.rarity >= 2 || s.golden) reveal(s, isNew, bonus);
  else toast(t('hatched', { name: petName(s) }), RARITIES[s.rarity].color);
  if (s.rarity >= 3 || s.golden) { platform.happytime(); fx.shake(0.25); }
  pens[i].dance = 2.2;
  if (state.tut === 2) {
    // first pet ever: a small welcome gift on the coin plate, so the first speed upgrade comes right after
    state.bank += 25;
    setTimeout(() => { fx.text(coinPlate.position.clone().setY(4.2), `${t('welcome')} +25`, '#ffd84a', 2.4); fx.burst(coinPlate.position.clone().setY(0.8), 0xffd23a, 24, 6); audio.play('coin'); }, 900);
    advanceTut();
  }
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
    pen.pad.material = unlocked ? vcMat : (syncPens.lockedMat ||= Object.assign(vcMat.clone(), { color: new THREE.Color(0x8a8f99) }));
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
      if ((s.rarity >= 3 || s.golden) && Math.random() < dt * 5) fx.sparkle(pen.pos.clone().setY(0.6), s.golden ? 0xffd23a : new THREE.Color(RARITIES[s.rarity].color).getHex(), 1, 1.2);
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

// any landmark between the camera and the player turns see-through (and back) within ~0.2 s
const occRay = new THREE.Ray(), occHit = new THREE.Vector3();
function fadeOccluders(dt) {
  const len = camera.position.distanceTo(camTarget);
  occRay.origin.copy(camera.position); occRay.direction.copy(camTarget).sub(camera.position).normalize();
  for (const o of occluders) {
    if (Math.abs(o.box.min.z - player.position.z) > 60 && Math.abs(o.box.max.z - player.position.z) > 60 && o.op === 1) continue;
    const hit = o.box.containsPoint(camera.position) || (occRay.intersectBox(o.box, occHit) && occHit.distanceTo(camera.position) < len);
    const want = hit ? 0.15 : 1;
    if (o.op === want) continue;
    o.op = Math.abs(want - o.op) < 0.02 ? want : o.op + (want - o.op) * Math.min(1, dt * 10);
    const m = o.mesh.material;
    m.transparent = o.op < 1; m.opacity = o.op; m.depthWrite = o.op >= 1;
    o.mesh.castShadow = o.op > 0.5;
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
let baseSign = null;
let blockedT = 0, stepT = 0;
let started = false, last = performance.now(), saveTimer = 0, zoneShown = -2, dustT = 0, turnLean = 0;
const tmp = new THREE.Vector3(), camTarget = new THREE.Vector3(), camDir = new THREE.Vector3(), camRay = new THREE.Raycaster();

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
  if (!moving) moveYaw = null;
  else if (moveYaw !== null && (ix * moveIn.x + iz * moveIn.z) / (mag || 1) < 0.8) moveYaw = null;   // new input = new frame of reference
  // the camera looks home from the grab until you walk back out of the base: then it turns to face the zones
  if (moving && !carrying && camYawTarget === null && Math.cos(camYaw) > 0 && player.position.z > BASE_LIMIT_Z + 1 && vel.z > 0) {
    moveYaw = camYaw; camYawTarget = Math.PI; moveIn.x = ix / (mag || 1); moveIn.z = iz / (mag || 1);
  }
  if (moving) {
    const yaw = moveYaw ?? camYaw;
    const fx_ = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const dx = fx_ * iz + rx * ix, dz = fz * iz + rz * ix;
    const len = Math.hypot(dx, dz) || 1;
    const sp = playerSpeed() * mag;
    vel.x = dx / len * sp; vel.z = dz / len * sp;
    const target = Math.atan2(vel.x, vel.z);
    let diff = target - player.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    player.rotation.y += diff * Math.min(1, dt * 14);
    turnLean = Math.max(-1, Math.min(1, diff * 2));
    if (Math.abs(diff) > 0.9 && onGround) for (let k = 0; k < 3; k++) fx.dust(player.position, 0xf3ead8);
  } else { vel.x = 0; vel.z = 0; turnLean = 0; }

  // footsteps on the run cycle (grass, or snow in the Snowfield)
  if (moving && onGround) { stepT -= dt * Math.sqrt(playerSpeed() * mag / 8); if (stepT <= 0) { stepT = 0.34; audio.step(currentZone(player.position.z) === 2); } } else stepT = 0.05;
  if (jumpQueued && onGround && !panelOpen) { vel.y = 8.5; onGround = false; audio.play('jump', { vol: 0.6 }); }
  jumpQueued = false;
  vel.y -= 22 * dt;
  player.position.addScaledVector(vel, dt);
  if (player.position.y <= 0) {
    if (!onGround) { audio.play('land', { vol: 0.5 }); for (let k = 0; k < 6; k++) fx.dust(player.position); player.userData.land = 0.16; }
    player.position.y = 0; vel.y = 0; onGround = true;
  }
  player.position.x = Math.max(-ROAD_HALF, Math.min(ROAD_HALF, player.position.x));
  player.position.z = Math.max(-29, Math.min(WORLD_END - 1, player.position.z));
  const preX = player.position.x, preZ = player.position.z;
  collideObstacles(player.position);
  // pushing into a fence/prop: after 0.45 s the ninja hops over it by itself (no stuck-on-a-crate moments)
  const want = Math.hypot(vel.x, vel.z) * dt, got = Math.hypot(player.position.x - (preX - vel.x * dt), player.position.z - (preZ - vel.z * dt));
  if (moving && onGround && want > 0.02 && got < want * 0.35 && Math.abs(player.position.x - preX) + Math.abs(player.position.z - preZ) > 1e-4) { blockedT += dt; if (blockedT > 0.45) { jumpQueued = true; blockedT = 0; } }
  else blockedT = 0;
  // animation + squash/stretch while airborne
  if (controlLock <= 0) {
    if (!onGround) player.userData.play?.('static', { fade: 0.1 });
    else if (moving) { player.userData.play?.(mag > 0.6 ? 'sprint' : 'walk', { fade: 0.18 }); player.userData.speed?.(Math.min(1.8, Math.max(0.9, playerSpeed() * mag / 6.5))); }
    else player.userData.play?.('idle', { fade: 0.18 });
  }
  const model = player.userData.model;
  if (model) {
    const land = player.userData.land || 0;
    const sy = onGround ? 1 - Math.sin(land / 0.16 * Math.PI) * 0.18 : 1 + Math.min(0.15, Math.abs(vel.y) * 0.015); model.scale.set(1.05 / Math.sqrt(sy), 1.05 * sy, 1.05 / Math.sqrt(sy));
    // lean into the run (about 7 degrees) and a little into turns
    const k = Math.min(1, dt * 10);
    model.rotation.x += ((moving && onGround ? (carrying ? 0.24 : 0.18) * mag : 0) - model.rotation.x) * k;
    model.rotation.z += ((moving ? -turnLean * 0.06 : 0) - model.rotation.z) * k;
  }
  player.userData.mixer?.update(dt);
  if (player.userData.tails) {
    const sp = Math.hypot(vel.x, vel.z) / 10;
    player.userData.tails.forEach((tl, i) => {
      // hanging when still, streaming back (rotate up toward horizontal) and fluttering when running
      tl.rotation.x = -1.25 + Math.min(1, sp) * 1.35 + Math.sin(time * (8 + sp * 14) + i * 1.7) * (0.12 + sp * 0.18);
      tl.rotation.z = Math.sin(time * 6 + i) * 0.08;
    });
  }
  // landing squash
  if (player.userData.land > 0) player.userData.land = Math.max(0, player.userData.land - dt);
  carryEgg.rotation.y += dt * 2;
  if (carryEgg.userData.pop !== undefined && carryEgg.userData.pop < 0.25) {
    const k = (carryEgg.userData.pop += dt) / 0.25;
    carryEgg.scale.setScalar(k >= 1 ? 1 : k < 0.6 ? 0.3 + k / 0.6 * 0.82 : 1.12 - (k - 0.6) / 0.4 * 0.12);
  }
  carryEgg.position.y = 4.1 + Math.sin(time * 10) * 0.08;
  if (moving && onGround && (dustT -= dt) <= 0) {
    dustT = carrying ? 0.045 : 0.07;
    const zi = currentZone(player.position.z);
    fx.dust(player.position, zi >= 0 ? new THREE.Color(ZONES[zi].ground).lerp(new THREE.Color(0xffffff), 0.4).getHex() : 0xf0e6cc);
  }

  // nests
  const now = performance.now();
  for (const n of nests) {
    if (n.special && n.available) {
      n.egg.rotation.y += dt * 2; n.egg.position.y = 1.05 + Math.sin(time * 4) * 0.15;
      const near = Math.hypot(player.position.x - n.pos.x, player.position.z - n.pos.z);
      if ((n.beamT -= dt) <= 0) { n.beamT = 0.9; if (near > 9) fx.pillar(n.pos, 0xffd23a, 1.4, 18, 0.8); fx.sparkle(n.pos.clone().setY(1.4), 0xffe27a, 4, 1); }
      n.glow.material.opacity = 0.45 + Math.sin(time * 6) * 0.15;
    }
    if (!n.available && now >= n.respawnAt) { n.available = true; n.egg.visible = true; n.glow.visible = true; fx.sparkle(n.pos.clone().setY(1), 0xffffff, 8, 1); }
    if (n.available && !n.special) { n.egg.position.y = 0.95 + Math.sin(time * 2 + n.pos.x) * 0.12; n.egg.rotation.y += dt; n.glow.material.opacity = 0.25 + Math.sin(time * 4) * 0.1; }
    if (n.available && !carrying && controlLock <= 0 && player.position.distanceTo(tmp.set(n.pos.x, 0, n.pos.z)) < 1.7) grabEgg(n);
  }

  // guards
  for (const g of guards) {
    const zone = ZONES[g.zone];
    const m = g.mesh;
    let speed = zone.guard.speed * 0.35, dest = null;
    const pz = player.position.z;
    const playerInRange = carrying && carrying.zone === g.zone && pz > zone.z0 - CHASE_PAST && pz < zone.z1 + 12;
    if (panelOpen) { m.userData.mixer?.update(dt); continue; }
    // a fence hop is a fixed flap over it (a free jump let slow walkers land on the fence and get stuck)
    if (g.vault) {
      const v = g.vault, k = Math.min(1, (v.t += dt) / v.dur);
      m.position.set(v.x0 + v.dx * k, Math.sin(Math.PI * k) * 1.6, v.z0 + v.dz * k);
      if (k >= 1) { m.position.y = 0; g.vault = null; }
      m.userData.mixer?.update(dt);
      continue;
    }
    if (g.state === 'gloat') { g.wait -= dt; m.userData.mixer?.update(dt); continue; }
    if (g.state === 'alert') { g.react -= dt; if (g.react <= 0) g.state = playerInRange ? 'chase' : 'return'; }
    if (g.state === 'chase' && !playerInRange) { g.state = 'return'; if (carrying) escaped(g); }
    if (g.state !== 'chase' && g.state !== 'alert' && playerInRange && m.position.distanceTo(player.position) < 18) g.state = 'chase';

    if (g.state === 'chase') { dest = player.position; speed = zone.guard.speed; }
    else if (g.state === 'alert') { m.rotation.y = Math.atan2(player.position.x - m.position.x, player.position.z - m.position.z); }
    else {
      if (g.state === 'return' || (g.wait <= 0 && m.position.distanceTo(g.target) < 1)) {
        g.target.set(rand(-ROAD_HALF + 4, ROAD_HALF - 4), 0, rand(g.patrol[0], g.patrol[1]));
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
      // guards flap over the low fences like the player jumps them (instead of walking through them)
      const ux = tmp.x / (Math.hypot(tmp.x, tmp.z) || 1), uz = tmp.z / (Math.hypot(tmp.x, tmp.z) || 1);
      if (d > 0.01 && Math.abs(uz) > 0.3 && fenceAhead(m.position, ux, uz)) {
        const hs = Math.max(speed, 7);
        g.vault = { t: 0, dur: 3.4 / hs, x0: m.position.x, z0: m.position.z, dx: ux * 1.2, dz: Math.sign(uz) * 3.4 };
      }
    }
    collideObstacles(m.position);
    if (g.state === 'chase') { m.userData.play?.('sprint'); m.userData.speed?.(Math.max(1, zone.guard.speed / 10)); if (Math.random() < dt * 14) fx.dust(m.position, 0xf0e6cc); }
    else if (g.state === 'alert') m.userData.play?.('emote-no');
    else m.userData.play?.(dest ? 'walk' : 'idle');
    m.userData.mixer?.update(dt);
    // build-up: a bird has to be on your heels (warning shown) for a moment before it can grab the egg;
    // the very first catch of the game gets the longest lead-in
    const gd = m.position.distanceTo(player.position);
    g.closeT = g.state === 'chase' && carrying && gd < 6 ? (g.closeT || 0) + dt : Math.max(0, (g.closeT || 0) - dt * 2);
    const needClose = state.caughtN ? 0.5 : 1.4;
    if (g.state === 'chase' && carrying && controlLock <= 0 && gd < 1.2 && g.closeT >= needClose && player.position.y < 1.5) { caught(); break; }
  }

  separateGuards();
  for (const o of [player, ...guards.map((g) => g.mesh)]) {
    const b = o.userData.blob; if (!b) continue;
    b.position.set(o.position.x, 0.06, o.position.z);
    const k = 1 / (1 + o.position.y * 0.35); b.scale.setScalar(k); b.material.opacity = k;
  }
  if (carrying && player.position.z < BASE_LIMIT_Z) depositEgg();

  // coins
  state.bank += incomePerSec() * dt;
  const onPlate = Math.hypot(player.position.x - coinPlate.position.x, player.position.z - coinPlate.position.z) < 2.4;
  // one sound and one "+N" per visit (the first coin you pick up there); standing on it collects quietly
  if (onPlate && !update.onPlateBefore) update.plateFresh = true;
  if (onPlate && state.bank >= 1) {
    const amt = Math.floor(state.bank);
    state.coins += amt; state.bank -= amt;
    if (update.plateFresh) {
      update.plateFresh = false;
      audio.play('coin', { rate: 0.95 + Math.random() * 0.1 });
      fx.text(coinPlate.position.clone().setY(3.6), `+${fmt(amt)}`, '#ffd84a', 2.5);
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

  for (const z of ZONES) z.titleLabel.visible = camera.aspect >= 1 && player.position.z < z.z0 - 1;   // portrait: the objective slot is right there
  const zi = currentZone(player.position.z);
  if (zi !== zoneShown) {
    zoneShown = zi;
    const el = $('zonehint');
    if (zi >= 0) {
      const z = ZONES[zi];
      const ok = playerSpeed() > z.guard.speed;
      el.textContent = ok ? '' : t('zoneHintBad', { z: t('zone')[zi] });
      el.className = ok ? '' : 'show bad';
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
  checkGoals(dt);
  updateHud();
  updateGuide(time);

  // camera: follows behind, auto-turns home while carrying, small FOV kick while running with an egg
  if (camYawTarget !== null) {
    const d = Math.atan2(Math.sin(camYawTarget - camYaw), Math.cos(camYawTarget - camYaw));
    // auto-turns (to face home after a grab, back to the zones after leaving base) are slow and eased:
    // at most 90°/s, so the view never whips around the player (motion sickness)
    const want = Math.max(-CAM_YAW_MAX, Math.min(CAM_YAW_MAX, d * 1.8));
    camYawVel += Math.max(-CAM_YAW_ACC * dt, Math.min(CAM_YAW_ACC * dt, (want - camYawVel) * Math.min(1, dt * 6)));   // gentle start and stop
    let step = camYawVel * dt; if (Math.sign(step) === Math.sign(d) && Math.abs(step) > Math.abs(d)) step = d;   // no overshoot
    camYaw += step;
    if (Math.abs(d) < 0.01) { camYawTarget = null; camYawVel = 0; }
  }
  const portrait = camera.aspect < 1;
  // nearest chasing bird (if any) decides the side the camera swings to
  let chaser = null, cd = 14;
  if (carrying) for (const g of guards) if (g.state === 'chase') { const d = g.mesh.position.distanceTo(player.position); if (d < cd) { cd = d; chaser = g; } }
  if (chaser) {
    if (!chaseSide) {
      const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);   // camera right vector
      chaseSide = ((chaser.mesh.position.x - player.position.x) * rx + (chaser.mesh.position.z - player.position.z) * rz) >= 0 ? 1 : -1;
    }
    camOffsetTarget = 0.55 * chaseSide;
  } else { camOffsetTarget = 0; if (Math.abs(camOffset) < 0.02) chaseSide = 0; }
  [camOffset, camOffsetV] = spring(camOffset, camOffsetV, camOffsetTarget, 2.6, Math.min(dt, 0.05));
  const fov = (portrait ? 62 : 52) + (carrying && moving ? 3 : 0);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 1.5); camera.updateProjectionMatrix(); }
  // smooth follow: a light lag on the ground plane, a softer one on height (hops and jumps don't jolt the view);
  // snaps after teleports (caught, rebirth, debug moves)
  if (!camFollowInit || camFollow.distanceTo(player.position) > 8) { camFollow.copy(player.position); camFollowInit = true; }
  else {
    const kxz = 1 - Math.exp(-dt * 14), ky = 1 - Math.exp(-dt * 4);
    camFollow.x += (player.position.x - camFollow.x) * kxz; camFollow.z += (player.position.z - camFollow.z) * kxz;
    camFollow.y += (player.position.y - camFollow.y) * ky;
  }
  camTarget.copy(camFollow); camTarget.y += 2.2;
  const chaseK = Math.abs(camOffset) / 0.55;
  let dist = camDist * (portrait ? 1.15 : 1) * (1 + 0.12 * chaseK);
  // a bird between the camera and the ninja: the camera rises and looks over it (never lose sight of the player)
  let birdBlock = false;
  for (const g of guards) {
    const m = g.mesh.position;
    if (Math.abs(m.z - player.position.z) > 14) continue;
    const ax = camera.position.x - camTarget.x, az = camera.position.z - camTarget.z, al = Math.hypot(ax, az) || 1;
    const bx = m.x - camTarget.x, bz = m.z - camTarget.z;
    const along = (bx * ax + bz * az) / al;
    if (along > 0.6 && along < al + 0.5 && Math.abs(bx * az - bz * ax) / al < 1.5) { birdBlock = true; break; }
  }
  liftHold = birdBlock ? 0.9 : Math.max(0, liftHold - dt);   // hold the raised view a moment: no up/down flicker
  [camLift, camLiftV] = spring(camLift, camLiftV, liftHold > 0 ? 0.38 : 0, 3, Math.min(dt, 0.05));
  const yawV = camYaw + camOffset, pitchV = camPitch + 0.06 * chaseK + camLift;
  camDir.set(Math.sin(yawV) * Math.cos(pitchV), Math.sin(pitchV), Math.cos(yawV) * Math.cos(pitchV));
  camRay.set(camTarget, camDir); camRay.far = dist;
  const hit = camRay.intersectObjects(camBlockers, false)[0];
  if (hit) dist = Math.max(2.5, hit.distance - 0.6);
  // no popping when a post or beam crosses the view: pull in quickly, ease back out slowly
  if (!camDistS) camDistS = dist;
  camDistS += (dist - camDistS) * Math.min(1, dt * (dist < camDistS ? 10 : 2.5));
  camera.position.copy(camTarget).addScaledVector(camDir, camDistS);
  // shake only for hits/catches, and only if the player turned it on (Settings > Camera shake, off by default)
  const sh = state.shake ? fx.shakeOffset() * 0.5 : 0;
  if (sh) camera.position.add(tmp.set(rand(-sh, sh), rand(-sh, sh) * 0.5, rand(-sh, sh)));
  // look slightly toward the chasing bird so both stay in frame
  // (smoothed, so switching between two chasing birds never jerks the view)
  if (chaser) tmp.copy(chaser.mesh.position).setY(1.6).sub(camTarget).multiplyScalar(0.22 * chaseK); else tmp.set(0, 0, 0);
  camLookOff.lerp(tmp, Math.min(1, dt * 3));
  camLook.copy(camTarget).add(camLookOff);
  camera.lookAt(camLook);
  $('speedlines').style.opacity = carrying && moving ? (chaser ? 0.85 : 0.5) : 0;
  const dk = chaser ? Math.max(0, Math.min(1, (8 - cd) / 6.5)) : 0;
  dangerK += (dk - dangerK) * Math.min(1, dt * 6);
  $('danger').style.opacity = dangerK.toFixed(3); $('danger').classList.toggle('hot', dangerK > 0.6);
  if (chaser && carrying && !carrying.warned && cd < 8) {
    carrying.warned = true;
    audio.blip([988, 740, 988, 740], 0.09, 0.06);
    toast(t('behind'), '#ff8a7a');
  }
  if (baseSign) baseSign.visible = camera.position.z > baseSign.position.z + 5 && camera.position.distanceTo(baseSign.position) > 12;   // never fill the screen with the sign
  fadeOccluders(dt);
  scene.userData.sky.position.copy(camera.position);
  sun.position.set(player.position.x + 22, 34, player.position.z - 10);
  sun.target.position.copy(player.position);
  zoneLight(dt);

  if (revealTimer > 0 && (revealTimer -= dt) <= 0) $('reveal').classList.remove('open');
  // the pens panel shows hatch countdowns: refresh it once a second while an egg is in there
  if (panelOpen === 'petsPanel' && (update.petsT = (update.petsT || 0) + dt) > 1) {
    update.petsT = 0;
    if (state.slots.some((p) => p && p.kind === 'egg')) renderPets();
  }

  saveTimer += dt;
  if (saveTimer > 5) { saveTimer = 0; save(); }
}

// Toy shading for every Lambert material: darker near the ground (contact AO for props, fences, trees,
// characters) and a soft warm rim light on characters so they pop off the ground. One shader tweak, no extra passes.
function toyShade(m, rim) {
  if (m.userData.toy) return; m.userData.toy = true;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.rimK = { value: rim ? 0.45 : 0.0 };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vWY;\nvarying vec3 vWN;\nvarying vec3 vWV;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 wp4 = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wp4 = instanceMatrix * wp4;
        #endif
        wp4 = modelMatrix * wp4;
        vWY = wp4.y; vWV = cameraPosition - wp4.xyz;
        vWN = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vWY;\nvarying vec3 vWN;\nvarying vec3 vWV;\nuniform float rimK;')
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        float ao = mix(0.72, 1.0, smoothstep(0.0, 0.9, vWY));
        gl_FragColor.rgb *= ao;
        float fr = pow(1.0 - max(dot(normalize(vWN), normalize(vWV)), 0.0), 3.0);
        gl_FragColor.rgb += vec3(1.0, 0.86, 0.6) * fr * rimK;`);
  };
  m.customProgramCacheKey = () => 'toy' + (rim ? 1 : 0);
  m.needsUpdate = true;
}
function toyShadeScene() {
  const chars = new Set([player, ...guards.map((g) => g.mesh)]);
  scene.traverse((o) => {
    if (!o.isMesh || !o.material || !o.material.isMeshLambertMaterial) return;
    let p = o, rim = false; while (p) { if (chars.has(p)) { rim = true; break; } p = p.parent; }
    if (o.geometry.type === 'PlaneGeometry') return;   // ground stays as painted
    if (rim) { o.material = o.material.clone(); }
    toyShade(o.material, rim);
  });
}
// per-zone light: the sun, sky fill and haze shift with the zone you're in (cool snow, hot volcano...)
const ZONE_LIGHT = [
  { sun: 0xffe0a8, sky: 0xd8efff, gnd: 0x6d7f48, fog: 0xdde9e6 },   // base / meadow
  { sun: 0xffe6b0, sky: 0xd0f0d8, gnd: 0x4f6f38, fog: 0xd2e6d6 },   // forest: richer greens
  { sun: 0xfff4e6, sky: 0xd8e8ff, gnd: 0x9fb8d8, fog: 0xe4eefa },   // snow: cool blue shadows
  { sun: 0xffd090, sky: 0xffeccc, gnd: 0xb08a50, fog: 0xf2e2c4 },   // desert: hot and warm
  { sun: 0xffa060, sky: 0xffc8a8, gnd: 0x6a2a20, fog: 0xc8a090 },   // volcano: orange glow
];
const _lc = new THREE.Color();
function zoneLight(dt) {
  const zi = Math.max(0, currentZone(player.position.z));
  const L = ZONE_LIGHT[zi], k = Math.min(1, dt * 1.5);
  sun.color.lerp(_lc.set(L.sun), k); hemi.color.lerp(_lc.set(L.sky), k); hemi.groundColor.lerp(_lc.set(L.gnd), k); scene.fog.color.lerp(_lc.set(L.fog), k);
}
function setQuality(level) {
  QUALITY.level = level;
  if (level === 'low') {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    sun.shadow.mapSize.set(1024, 1024); sun.shadow.map?.dispose(); sun.shadow.map = null;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    document.getElementById('vignette').style.display = 'none';
  }
  console.info('[quality]', level);
}
function loop() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  requestAnimationFrame(loop);
  if (paused || loop.frozen) return;
  const time = now / 1000;
  if (!started) return;   // the title screen is painted key art: nothing 3D to draw behind it
  if (QUALITY.level === 'high' && !document.hidden && !/[?&]hq\b/.test(location.search)) {
    const q = (QUALITY.probe ||= { n: 0, sum: 0, skip: 30 });
    if (q.skip > 0) q.skip--;
    else if (q.n < 240) {
      q.sum += now - (q.prev || now); q.n++;
      if (q.n === 240 && q.sum / q.n > 24) setQuality('low');
    }
    q.prev = now;
  }
  update(dt, time);
  scene.userData.sky.position.copy(camera.position);
  if (clouds) { clouds.position.x = Math.sin(time * 0.02) * 20; }
  if (windBlades) windBlades.rotation.z += dt * 0.8;
  if (dressBase.blades) dressBase.blades.rotation.z += dt * 0.8;
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
} else {
  // Silence when not active: tab hidden, app backgrounded or screen locked, window unfocused, page closing.
  // All audio is suspended AND the game pauses; both come back when the player returns.
  // focus is tracked by events, not document.hasFocus(): an unfocused portal iframe (or iOS, where a tap may not
  // focus the frame) must never leave the game stuck paused. Only a real blur pauses; any tap/key/focus resumes.
  let inactive = false, focused = true, pageGone = false;
  const setInactive = (v) => {
    if (v === inactive) return;
    inactive = v;
    if (v) { awayStart(); pause(); } else { awayEnd(); resume(); }
    $('pausedHint').classList.toggle('show', v && started && !document.hidden);
  };
  const checkActive = () => setInactive(document.hidden || !focused || pageGone);
  document.addEventListener('visibilitychange', checkActive);
  window.addEventListener('blur', () => { focused = false; checkActive(); });
  window.addEventListener('focus', () => { focused = true; checkActive(); });
  window.addEventListener('pageshow', () => { pageGone = false; checkActive(); });
  window.addEventListener('pagehide', () => { pageGone = true; checkActive(); });
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) document.addEventListener(ev, () => { if (!focused) { focused = true; checkActive(); } }, true);
  if (document.hidden) setInactive(true);   // opened in a background tab: stay silent until shown
}
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
  if (state.tut >= 5) { skipDoneGoals(); startGoal(); }
  showTut();
  if (pendingAway > 0) setTimeout(showAway, 300);
});

async function boot() {
  const bar = document.querySelector('#bar i');
  const assetsP = loadAll((k) => { bar.style.width = Math.round(k * 90) + '%'; });
  await platform.init();
  setLang(platform.lang());
  applyTexts();
  await Promise.all([assetsP, document.fonts?.load?.('900 20px Nunito').catch(() => {})]);
  initFx(scene);
  renderPetThumbs();
  buildWorld();
  buildPlayer();
  buildGuide();
  load(await platform.loadSave());
  audio.setSound(state.sound !== false); audio.setMusic(state.music !== false);
  updateHud(true);
  bar.style.width = '100%';
  toyShadeScene();
  // shader prewarm: every effect + the faded landmark variant compile now, not on the first grab/hatch (no hitches later)
  const warm = new THREE.Vector3(0, -30, 0);
  fx.confetti(warm, 4); fx.sparkle(warm); fx.dust(warm); fx.burst(warm, 0xffffff, 4); fx.text(warm, '+1');
  fx.ring(warm); fx.pillar(warm); fx.shards(warm, 0xffffff, 3);
  const warmEgg = makeEgg(0xffd23a, 1); warmEgg.position.copy(warm); scene.add(warmEgg);
  if (occluders[0]) occluders[0].mesh.material.transparent = true;
  renderer.compile(scene, camera);
  if (occluders[0]) occluders[0].mesh.material.transparent = false;
  renderer.compile(scene, camera);
  scene.remove(warmEgg);
  loop();
  $('loader').classList.add('hidden');
  $('start').classList.remove('hidden');
  // report loading done on the next frame, or after 100 ms if the tab is in the background (no frames there)
  let loadReported = false;
  const reportLoaded = () => { if (!loadReported) { loadReported = true; platform.loadingDone(); } };
  requestAnimationFrame(reportLoaded); setTimeout(reportLoaded, 100);
}
boot();

// debug hook for testing in the console (local dev or ?debug only, never in portal builds)
let simT = 0;
// ?debug works on this machine only: a real player's URL must not expose the game's insides
if (platform.name === 'local' || (new URLSearchParams(location.search).has('debug') && /^(localhost|127\.0\.0\.1)$/.test(location.hostname))) window.__game = {
  state, guards, nests, ZONES, save, keys, platform, renderer, scene, camera, fx,
  get player() { return player; },
  setCam(yaw, pitch, dist) { camYaw = yaw; camPitch = pitch; camDist = dist; camYawTarget = null; camYawVel = 0; },
  step(n, dt = 1 / 60) { started = true; for (let i = 0; i < n; i++) { simT += dt; update(dt, simT); fx.update(dt); if (windBlades) windBlades.rotation.z += dt * 0.8; if (dressBase.blades) dressBase.blades.rotation.z += dt * 0.8; } renderer.render(scene, camera); },
  freeze(v = true) { loop.frozen = v; },
  carrying: () => carrying, dropCarry: () => dropCarry(),
  sim(n, dt = 1 / 60) { started = true; for (let i = 0; i < n; i++) { simT += dt; update(dt, simT); } },
  get camYaw() { return camYaw; }, QUALITY, setQuality, jump() { jumpQueued = true; }, fenceAhead,
  reveal, openPanel, closePanels, hatch, caught, showTut, updateHud,
  guide: () => { const g = started ? tutTarget() : null; return g ? { x: g.x, z: g.z } : null; },
  get goal() { return curGoal()?.id || null; }, coinPlatePos: () => ({ x: coinPlate.position.x, z: coinPlate.position.z }), shopPadPos: () => ({ x: shopPad.position.x, z: shopPad.position.z }),
  adDue() { lastAd = 0; }, joy, obstacles, audio, renderShop, get paused() { return paused; }, get panel() { return panelOpen; },
  // dev only: render one frame and post the canvas to a local receiver (store screenshots)
  snap(name, url = 'http://127.0.0.1:8782/') {
    renderer.render(scene, camera);
    return fetch(url + name, { method: 'POST', body: canvas.toDataURL('image/png') }).then((r) => r.text());
  },
};
