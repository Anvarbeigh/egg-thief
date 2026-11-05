// Juice: pooled particles (confetti, sparkles, dust, coins), floating text, camera shake.
import * as THREE from './vendor/three.module.js';

let scene = null;
const MAX = 600;
let points, pos, col, size, data;   // data[i] = {life, max, vx, vy, vz, g, drag, s0}
let cursor = 0;

// soft round dot texture
function dotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.45, 'rgba(255,255,255,.95)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function initFx(s) {
  scene = s;
  const geo = new THREE.BufferGeometry();
  pos = new Float32Array(MAX * 3); col = new Float32Array(MAX * 3); size = new Float32Array(MAX);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: dotTexture() }, scale: { value: window.innerHeight / 2 } },
    vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC;
      uniform float scale;
      void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0);
        gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D map; varying vec3 vC;
      void main(){ vec4 t = texture2D(map, gl_PointCoord); if (t.a < 0.05) discard; gl_FragColor = vec4(vC, t.a); }`,
    transparent: true, depthWrite: false,
  });
  points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 5;
  scene.add(points);
  data = Array.from({ length: MAX }, () => ({ life: 0 }));
  window.addEventListener('resize', () => { mat.uniforms.scale.value = window.innerHeight / 2; });
}

const tmpC = new THREE.Color();
function emit(x, y, z, o) {
  const i = cursor; cursor = (cursor + 1) % MAX;
  const d = data[i];
  d.life = d.max = o.life;
  d.vx = o.vx; d.vy = o.vy; d.vz = o.vz; d.g = o.g ?? 9; d.drag = o.drag ?? 0.98; d.s0 = o.size;
  pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
  tmpC.set(o.color); col[i * 3] = tmpC.r; col[i * 3 + 1] = tmpC.g; col[i * 3 + 2] = tmpC.b;
  size[i] = o.size;
}
const r = (a, b) => a + Math.random() * (b - a);
const CONFETTI = [0xff5a7a, 0xffd23a, 0x5ad1ff, 0x7dff6a, 0xc77dff, 0xffffff];

export const fx = {
  confetti(p, n = 60, colors = CONFETTI) {
    for (let k = 0; k < n; k++) {
      const a = r(0, Math.PI * 2), sp = r(3, 9);
      emit(p.x, p.y, p.z, { vx: Math.cos(a) * sp * 0.6, vy: r(6, 13), vz: Math.sin(a) * sp * 0.6, life: r(1, 1.8), size: r(0.25, 0.45), color: colors[k % colors.length], g: 14, drag: 0.97 });
    }
  },
  sparkle(p, color = 0xffe27a, n = 2, spread = 0.9) {
    for (let k = 0; k < n; k++) emit(p.x + r(-spread, spread), p.y + r(0, spread * 1.6), p.z + r(-spread, spread), { vx: 0, vy: r(0.6, 1.6), vz: 0, life: r(0.6, 1.1), size: r(0.15, 0.3), color, g: 0, drag: 1 });
  },
  dust(p, color = 0xe8dcc0) {
    emit(p.x + r(-0.3, 0.3), p.y + 0.1, p.z + r(-0.3, 0.3), { vx: r(-0.6, 0.6), vy: r(0.5, 1.2), vz: r(-0.6, 0.6), life: r(0.35, 0.6), size: r(0.35, 0.6), color, g: 0, drag: 0.94 });
  },
  burst(p, color, n = 24, speed = 6) {
    for (let k = 0; k < n; k++) {
      const a = r(0, Math.PI * 2), e = r(-0.2, 1);
      emit(p.x, p.y, p.z, { vx: Math.cos(a) * speed * r(0.4, 1), vy: e * speed, vz: Math.sin(a) * speed * r(0.4, 1), life: r(0.4, 0.8), size: r(0.25, 0.5), color, g: 10, drag: 0.93 });
    }
  },
  update(dt) {
    if (!points) return;
    for (let i = 0; i < MAX; i++) {
      const d = data[i];
      if (d.life <= 0) { if (size[i] !== 0) size[i] = 0; continue; }
      d.life -= dt;
      d.vy -= d.g * dt; d.vx *= d.drag; d.vy *= d.drag; d.vz *= d.drag;
      pos[i * 3] += d.vx * dt; pos[i * 3 + 1] += d.vy * dt; pos[i * 3 + 2] += d.vz * dt;
      if (pos[i * 3 + 1] < 0.05) { pos[i * 3 + 1] = 0.05; d.vy *= -0.3; d.vx *= 0.7; d.vz *= 0.7; }
      size[i] = d.s0 * Math.min(1, d.life / (d.max * 0.4));
    }
    points.geometry.attributes.position.needsUpdate = true;
    points.geometry.attributes.size.needsUpdate = true;
    points.geometry.attributes.color.needsUpdate = true;
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i];
      f.t += dt;
      f.sprite.position.y += dt * 1.6;
      const k = f.t / f.life;
      f.sprite.material.opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      const pop = Math.min(1, f.t * 8);
      f.sprite.scale.set(f.w * pop, f.h * pop, 1);
      if (f.t >= f.life) { scene.remove(f.sprite); f.sprite.material.map.dispose(); f.sprite.material.dispose(); floats.splice(i, 1); }
    }
    if (shakeT > 0) shakeT = Math.max(0, shakeT - dt);
  },
  // floating "+123" in the world
  text(p, str, color = '#ffd84a', scale = 1.6) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 80;
    const g = c.getContext('2d');
    g.font = '800 56px Rubik, "Trebuchet MS", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 10; g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineJoin = 'round';
    g.strokeText(str, 128, 42); g.fillStyle = color; g.fillText(str, 128, 42);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.position.copy(p); sp.renderOrder = 20;
    scene.add(sp);
    floats.push({ sprite: sp, t: 0, life: 1.2, w: scale * 3.2, h: scale });
  },
  shake(s = 0.5) { shakeT = Math.max(shakeT, s); },
  shakeOffset() { return shakeT > 0 ? shakeT * 0.6 : 0; },
};
const floats = [];
let shakeT = 0;
