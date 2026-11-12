// Hand-built scenery props (beveled boxes, merged into one vertex-coloured geometry each so a
// whole field of hay bales is a single instanced draw call) and painted ground textures with a
// dirt lane per zone.
import * as THREE from './vendor/three.module.js';
import { mergeGeometries, mergeVertices } from './vendor/addons/utils/BufferGeometryUtils.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// box with rounded (beveled) edges and soft shading
export function rbox(w, h, d, r = 0.06) {
  let g = new THREE.BoxGeometry(w, h, d, 3, 3, 3);
  const p = g.attributes.position, v = new THREE.Vector3(), inner = new THREE.Vector3();
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    inner.set(clamp(v.x, -hx, hx), clamp(v.y, -hy, hy), clamp(v.z, -hz, hz));
    v.sub(inner);
    if (v.lengthSq() > 1e-8) v.normalize().multiplyScalar(r);
    v.add(inner);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-4);
  g.computeVertexNormals();
  return g;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _c = new THREE.Color();
// parts: [geometry, color, [x,y,z], [rx,ry,rz]?, [sx,sy,sz]?]  ->  one geometry with vertex colours
export function merged(parts) {
  const list = parts.map(([geo, color, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]]) => {
    let g = geo.clone();
    if (g.attributes.uv) g.deleteAttribute('uv');
    if (g.index) g = g.toNonIndexed();
    if (!g.attributes.normal) g.computeVertexNormals();
    _m.compose(new THREE.Vector3(...p), _q.setFromEuler(_e.set(...r)), new THREE.Vector3(...s));
    g.applyMatrix4(_m);
    _c.set(color);
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  });
  return mergeGeometries(list);
}
// lighten the bottom of every prop a little less than the top: fake ambient occlusion baked into vertex colours
function bakeAO(g, h, k = 0.35) {
  const p = g.attributes.position, c = g.attributes.color;
  for (let i = 0; i < p.count; i++) {
    const f = 1 - k * (1 - clamp(p.getY(i) / h, 0, 1)) ** 2;
    c.setXYZ(i, c.getX(i) * f, c.getY(i) * f, c.getZ(i) * f);
  }
  return g;
}

export const vcMat = new THREE.MeshLambertMaterial({ vertexColors: true });
export const vcGlow = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0xff5a1a, emissiveIntensity: 0.55 });

const cyl = (rt, rb, h, n = 12) => new THREE.CylinderGeometry(rt, rb, h, n);
const sph = (r, w = 12, h = 8) => new THREE.SphereGeometry(r, w, h);
const cone = (r, h, n = 6) => new THREE.ConeGeometry(r, h, n);

// --- prop library: each returns {geo, h (collision height), r (collision half-size), glow?} -------
const P = {};
P.hay = () => {   // square bale with two strings
  const g = merged([[rbox(1.5, 0.85, 0.95, 0.12), 0xf2c94c, [0, 0.43, 0]], [rbox(1.52, 0.87, 0.08, 0.03), 0xb98a2e, [0.35, 0.43, 0], [0, Math.PI / 2, 0], [0.64, 1, 1]],
    [rbox(0.06, 0.88, 0.97, 0.02), 0xb98a2e, [-0.35, 0.43, 0]], [rbox(0.06, 0.88, 0.97, 0.02), 0xb98a2e, [0.35, 0.43, 0]],
    [rbox(1.3, 0.12, 0.8, 0.05), 0xffe08a, [0, 0.86, 0]]]);
  return { geo: bakeAO(g, 0.9), h: 0.9, r: [0.8, 0.5] };
};
P.hayRoll = () => {
  const g = merged([[cyl(0.62, 0.62, 1.2, 16), 0xe9bd45, [0, 0.62, 0], [0, 0, Math.PI / 2]], [cyl(0.5, 0.5, 1.22, 16), 0xf7d97a, [0, 0.62, 0], [0, 0, Math.PI / 2]],
    [cyl(0.64, 0.64, 0.08, 16), 0xb98a2e, [0.2, 0.62, 0], [0, 0, Math.PI / 2]]]);
  return { geo: bakeAO(g, 1.2), h: 1.2, r: [0.65, 0.65] };
};
P.crate = () => {
  const parts = [[rbox(1, 1, 1, 0.07), 0xc98b4e, [0, 0.5, 0]]];
  for (const z of [-0.51, 0.51]) {
    parts.push([rbox(0.98, 0.14, 0.04, 0.02), 0x8f5a2e, [0, 0.12, z]], [rbox(0.98, 0.14, 0.04, 0.02), 0x8f5a2e, [0, 0.88, z]],
      [rbox(1.25, 0.14, 0.04, 0.02), 0x8f5a2e, [0, 0.5, z], [0, 0, Math.PI / 4]]);
  }
  return { geo: bakeAO(merged(parts), 1), h: 1.0, r: [0.55, 0.55] };
};
P.barrel = () => {
  const g = merged([[cyl(0.46, 0.46, 1.1, 14), 0xa8683a, [0, 0.55, 0]], [cyl(0.5, 0.5, 0.1, 14), 0x4a4f5a, [0, 0.2, 0]], [cyl(0.5, 0.5, 0.1, 14), 0x4a4f5a, [0, 0.9, 0]],
    [cyl(0.4, 0.4, 0.04, 14), 0x7a4a26, [0, 1.11, 0]]]);
  return { geo: bakeAO(g, 1.1), h: 1.1, r: [0.5, 0.5] };
};
P.pot = () => {   // desert clay pot
  const g = merged([[sph(0.55, 12, 8), 0xd9773f, [0, 0.55, 0], [0, 0, 0], [1, 1.05, 1]], [cyl(0.28, 0.36, 0.3, 12), 0xc5652f, [0, 1.15, 0]], [cyl(0.36, 0.36, 0.08, 12), 0xf2d2a0, [0, 0.7, 0]]]);
  return { geo: bakeAO(g, 1.3), h: 1.1, r: [0.55, 0.55] };
};
P.snowman = () => {
  const g = merged([[sph(0.6), 0xf7fbff, [0, 0.55, 0]], [sph(0.42), 0xf7fbff, [0, 1.3, 0]], [cone(0.08, 0.4, 6), 0xff8a2a, [0, 1.32, 0.5], [Math.PI / 2, 0, 0]],
    [sph(0.06, 6, 4), 0x1a1a22, [-0.14, 1.42, 0.37]], [sph(0.06, 6, 4), 0x1a1a22, [0.14, 1.42, 0.37]], [rbox(0.9, 0.14, 0.2, 0.05), 0xd94a4a, [0, 1.0, 0]],
    [cyl(0.22, 0.22, 0.35, 10), 0x2a2f3a, [0, 1.85, 0]], [cyl(0.34, 0.34, 0.05, 10), 0x2a2f3a, [0, 1.68, 0]]]);
  return { geo: bakeAO(g, 2, 0.2), h: 1.3, r: [0.6, 0.6] };
};
P.snowCrate = () => {
  const c = P.crate();
  const g = mergeGeometries([c.geo, merged([[rbox(1.08, 0.22, 1.08, 0.1), 0xf7fbff, [0, 1.05, 0]]])]);
  return { geo: g, h: 1.15, r: [0.55, 0.55] };
};
P.crystal = () => {   // volcano: glowing crystal cluster
  const g = merged([[cone(0.3, 1.6, 5), 0xff7a2a, [0, 0.8, 0]], [cone(0.22, 1.1, 5), 0xffb03a, [0.35, 0.5, 0.1], [0, 0, -0.45]],
    [cone(0.2, 0.9, 5), 0xff5a1a, [-0.3, 0.42, -0.1], [0.2, 0, 0.5]], [cyl(0.55, 0.65, 0.25, 7), 0x2a1a18, [0, 0.12, 0]]]);
  return { geo: g, h: 1.2, r: [0.55, 0.55], glow: true };
};
P.charBarrel = () => {
  const b = P.barrel(); const c = b.geo.attributes.color;
  for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * 0.45, c.getY(i) * 0.38, c.getZ(i) * 0.38);
  return b;
};
P.bones = () => {   // desert: a sun-bleached skull-ish rock + bone
  const g = merged([[rbox(1.4, 0.18, 0.18, 0.07), 0xf4ecd8, [0, 0.12, 0], [0, 0.3, 0]], [sph(0.15, 8, 6), 0xf4ecd8, [0.7, 0.14, -0.22]], [sph(0.15, 8, 6), 0xf4ecd8, [-0.7, 0.14, 0.22]],
    [rbox(0.7, 0.55, 0.65, 0.2), 0xd8b98a, [0.2, 0.28, 0.5]]]);
  return { geo: g, h: 0.6, r: [0.6, 0.5] };
};
P.logPile = () => {
  const parts = [];
  [[-0.4, 0.3], [0.4, 0.3], [0, 0.78]].forEach(([x, y]) => parts.push([cyl(0.33, 0.33, 1.8, 10), 0x8a5a33, [x, y, 0], [Math.PI / 2, 0, 0]], [cyl(0.25, 0.25, 1.82, 10), 0xe0b07a, [x, y, 0], [Math.PI / 2, 0, 0]]));
  return { geo: bakeAO(merged(parts), 1.1), h: 1.1, r: [0.75, 0.9] };
};
P.mushroomBig = () => {
  const g = merged([[cyl(0.18, 0.24, 0.8, 10), 0xf5ead2, [0, 0.4, 0]], [sph(0.62, 14, 8), 0xe0383e, [0, 0.85, 0], [0, 0, 0], [1, 0.55, 1]],
    [sph(0.1, 6, 4), 0xffffff, [0.25, 1.12, 0.2]], [sph(0.08, 6, 4), 0xffffff, [-0.28, 1.08, -0.1]], [sph(0.09, 6, 4), 0xffffff, [0.02, 1.18, -0.3]]]);
  return { geo: g, h: 1.1, r: [0.55, 0.55] };
};
P.sackPile = () => {
  const g = merged([[sph(0.45, 10, 8), 0xd9c08a, [-0.3, 0.38, 0], [0, 0, 0], [1, 0.85, 0.8]], [sph(0.45, 10, 8), 0xcfb27a, [0.35, 0.38, 0.05], [0, 0, 0], [1, 0.85, 0.8]],
    [sph(0.42, 10, 8), 0xe2cb98, [0, 0.95, 0], [0, 0, 0], [1, 0.8, 0.8]]]);
  return { geo: bakeAO(g, 1.3), h: 1.1, r: [0.75, 0.5] };
};
// non-colliding ground clutter
P.tuft = () => ({ geo: merged([[cone(0.09, 0.5, 4), 0x5fae3e, [0, 0.25, 0], [0.2, 0, 0.15]], [cone(0.08, 0.42, 4), 0x6fc24a, [0.12, 0.21, 0.05], [0, 0, -0.35]],
  [cone(0.08, 0.38, 4), 0x4f9a34, [-0.1, 0.19, -0.04], [0.1, 0, 0.4]]]), h: 0 });
P.pebbles = () => ({ geo: merged([[rbox(0.4, 0.2, 0.32, 0.08), 0xb8b2a4, [0, 0.08, 0], [0, 0.4, 0]], [rbox(0.25, 0.14, 0.22, 0.06), 0xa49e90, [0.32, 0.06, 0.15]],
  [rbox(0.18, 0.1, 0.16, 0.04), 0xc8c2b4, [-0.25, 0.05, 0.2]]]), h: 0 });
P.daisies = () => {
  const parts = [];
  [[0, 0], [0.3, 0.2], [-0.25, 0.25], [0.1, -0.3]].forEach(([x, z], i) => {
    const c = [0xffffff, 0xffe066, 0xff8fb1, 0xffffff][i];
    parts.push([cyl(0.025, 0.025, 0.3, 4), 0x4f9a34, [x, 0.15, z]], [cyl(0.13, 0.13, 0.04, 8), c, [x, 0.31, z]], [cyl(0.05, 0.05, 0.06, 6), 0xffb020, [x, 0.33, z]]);
  });
  return { geo: merged(parts), h: 0 };
};
P.snowLump = () => ({ geo: merged([[sph(0.5, 10, 6), 0xf3f8fd, [0, 0, 0], [0, 0, 0], [1.4, 0.45, 1]], [sph(0.3, 8, 6), 0xe9f1fa, [0.5, 0, 0.2], [0, 0, 0], [1, 0.5, 1]]]), h: 0 });
P.snowBank = () => ({ geo: merged([[sph(1, 12, 8), 0xf6faff, [0, 0, 0], [0, 0, 0], [2.2, 0.7, 1.2]], [sph(0.8, 10, 6), 0xe4eefa, [1.4, 0, 0.3], [0, 0, 0], [1.3, 0.55, 1]],
  [sph(0.7, 10, 6), 0xdce8f6, [-1.5, 0, -0.2], [0, 0, 0], [1.2, 0.5, 1]]]), h: 0 });
P.lavaPool = () => ({ geo: merged([[cyl(1, 1.15, 0.12, 14), 0x2a1410, [0, 0.04, 0]], [cyl(0.8, 0.8, 0.12, 14), 0xff6a1a, [0, 0.07, 0]], [cyl(0.4, 0.4, 0.13, 12), 0xffc04a, [0.15, 0.08, 0.1]]]), h: 0, glow: true });
P.ashRocks = () => ({ geo: merged([[rbox(0.5, 0.3, 0.4, 0.1), 0x3a2622, [0, 0.12, 0], [0, 0.6, 0]], [rbox(0.3, 0.2, 0.3, 0.08), 0x4a302a, [0.38, 0.08, 0.1]],
  [rbox(0.12, 0.04, 0.5, 0.02), 0xff6a1a, [-0.2, 0.02, 0.25], [0, 0.8, 0]]]), h: 0 });
P.dryBush = () => ({ geo: merged([[cone(0.06, 0.6, 4), 0xa8864a, [0, 0.3, 0], [0.4, 0, 0]], [cone(0.06, 0.6, 4), 0xb8965a, [0, 0.3, 0], [-0.3, 0, 0.4]],
  [cone(0.06, 0.6, 4), 0x98763a, [0, 0.3, 0], [0, 0, -0.45]], [cone(0.05, 0.5, 4), 0xa8864a, [0, 0.25, 0], [-0.2, 0, -0.5]]]), h: 0 });
P.leaves = () => ({ geo: merged([[rbox(0.25, 0.03, 0.18, 0.01), 0xe08a2a, [0, 0.02, 0], [0, 0.5, 0]], [rbox(0.22, 0.03, 0.16, 0.01), 0xc85a2a, [0.3, 0.02, 0.2], [0, 1.4, 0]],
  [rbox(0.2, 0.03, 0.15, 0.01), 0xe8b23a, [-0.2, 0.02, 0.28], [0, 2.2, 0]]]), h: 0 });

const cache = {};
export function prop(name) { return cache[name] || (cache[name] = P[name]()); }

// --- landmarks: one merged mesh each -----------------------------------------------------------
export function barn() {
  const red = 0xc8423a, white = 0xfaf3e6, roof = 0x3f5f9e, dark = 0x7a2a24;
  const parts = [
    [rbox(10, 6, 8, 0.15), red, [0, 3, 0]],
    [rbox(10.2, 0.4, 8.2, 0.1), white, [0, 0.2, 0]],
    [rbox(3.4, 4, 0.2, 0.05), dark, [0, 2, 4.02]],
    [rbox(3.8, 0.3, 0.3, 0.08), white, [0, 4.1, 4.1]], [rbox(0.3, 4.1, 0.3, 0.08), white, [-1.85, 2.05, 4.1]], [rbox(0.3, 4.1, 0.3, 0.08), white, [1.85, 2.05, 4.1]],
    [rbox(4.6, 0.25, 0.25, 0.06), white, [0, 2.05, 4.13], [0, 0, 0.86]], [rbox(4.6, 0.25, 0.25, 0.06), white, [0, 2.05, 4.13], [0, 0, -0.86]],
    [rbox(1.6, 1.3, 0.2, 0.05), 0x2a2f3a, [0, 5.4, 4.02]], [rbox(1.9, 0.2, 0.25, 0.05), white, [0, 6.1, 4.1]], [rbox(1.9, 0.2, 0.25, 0.05), white, [0, 4.7, 4.1]],
    // roof: two slabs + ridge
    [rbox(6.2, 0.4, 8.8, 0.12), roof, [-2.5, 7.3, 0], [0, 0, 0.62]], [rbox(6.2, 0.4, 8.8, 0.12), roof, [2.5, 7.3, 0], [0, 0, -0.62]],
    [rbox(0.6, 0.5, 8.9, 0.15), 0x2f4a80, [0, 9.1, 0]],
  ];
  // gable triangle (front and back)
  const tri = new THREE.Shape(); tri.moveTo(-5, 0); tri.lineTo(0, 3.2); tri.lineTo(5, 0); tri.lineTo(-5, 0);
  const gab = new THREE.ExtrudeGeometry(tri, { depth: 7.8, bevelEnabled: false });
  parts.push([gab, red, [0, 6, -3.9]]);
  return bakeAO(merged(parts), 9, 0.3);
}
export function windmill() {
  const parts = [[cyl(1.3, 2.1, 9, 8), 0xf1e6cf, [0, 4.5, 0]], [cone(1.9, 2.4, 8), 0xc8423a, [0, 10.2, 0]], [rbox(1.1, 1.8, 0.2, 0.05), 0x7a4a26, [0, 0.9, 2.0]],
    [rbox(0.7, 0.7, 0.2, 0.05), 0x2a2f3a, [0, 5.5, 1.75]]];
  return bakeAO(merged(parts), 11, 0.25);
}
export function windmillBlades() {
  const parts = [[cyl(0.35, 0.35, 0.6, 8), 0x7a4a26, [0, 0, 0], [Math.PI / 2, 0, 0]]];
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2;
    parts.push([rbox(0.25, 4.6, 0.12, 0.04), 0x7a4a26, [Math.sin(a) * 2.4, Math.cos(a) * 2.4, 0.3], [0, 0, -a]],
      [rbox(1.1, 3.6, 0.06, 0.03), 0xfaf3e6, [Math.sin(a) * 2.7 + Math.cos(a) * 0.6, Math.cos(a) * 2.7 - Math.sin(a) * 0.6, 0.32], [0, 0, -a]]);
  }
  return merged(parts);
}
export function cabin() {   // forest log cabin
  const parts = [];
  for (let i = 0; i < 6; i++) {
    parts.push([cyl(0.35, 0.35, 8, 8), i % 2 ? 0x8a5a33 : 0x7a4c2a, [0, 0.35 + i * 0.66, 2.9], [0, 0, Math.PI / 2]], [cyl(0.35, 0.35, 8, 8), i % 2 ? 0x8a5a33 : 0x7a4c2a, [0, 0.35 + i * 0.66, -2.9], [0, 0, Math.PI / 2]],
      [cyl(0.35, 0.35, 6.4, 8), i % 2 ? 0x7a4c2a : 0x8a5a33, [3.6, 0.68 + i * 0.66, 0], [Math.PI / 2, 0, 0]], [cyl(0.35, 0.35, 6.4, 8), i % 2 ? 0x7a4c2a : 0x8a5a33, [-3.6, 0.68 + i * 0.66, 0], [Math.PI / 2, 0, 0]]);
  }
  parts.push([rbox(5, 0.35, 7.4, 0.1), 0x3d6b3a, [-2, 4.9, 0], [0, 0, 0.55]], [rbox(5, 0.35, 7.4, 0.1), 0x3d6b3a, [2, 4.9, 0], [0, 0, -0.55]],
    [rbox(1.4, 2.4, 0.2, 0.05), 0x4a2c18, [0, 1.2, 3.25]], [rbox(1, 1, 0.2, 0.05), 0xffd36a, [-2.2, 2.2, 3.25]], [rbox(1, 1, 0.2, 0.05), 0xffd36a, [2.2, 2.2, 3.25]],
    [rbox(0.9, 3, 0.9, 0.1), 0x8a8478, [2.4, 5.5, -1]]);
  return bakeAO(merged(parts), 7, 0.3);
}
export function igloo() {
  const parts = [[new THREE.SphereGeometry(3.4, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0xf4f9ff, [0, 0, 0]],
    [new THREE.CylinderGeometry(1.2, 1.2, 2.4, 12, 1, false, 0, Math.PI), 0xeaf2fb, [0, 0, 3.2], [Math.PI / 2, 0, -Math.PI / 2]], [rbox(1.4, 1.6, 0.1, 0.05), 0x5a7a9a, [0, 0.8, 4.35]]];
  return merged(parts);
}
export function tent() {   // desert market tent
  const parts = [[cone(3.6, 3.2, 6), 0xe8c27a, [0, 4.4, 0]], [cyl(3.4, 3.4, 2.8, 6, 1, true), 0xd9773f, [0, 1.4, 0]], [rbox(1.6, 2.4, 0.2, 0.05), 0x5a2a1a, [0, 1.2, 3.0]],
    [cyl(0.12, 0.12, 1.2, 6), 0x7a4a26, [0, 6.4, 0]], [rbox(0.9, 0.5, 0.05, 0.02), 0xd94a4a, [0.45, 6.8, 0]]];
  return bakeAO(merged(parts), 6, 0.3);
}
export function ruin() {   // volcano: broken tower
  const parts = [];
  for (let i = 0; i < 5; i++) parts.push([rbox(4.2 - i * 0.2, 1.4, 4.2 - i * 0.2, 0.25), i % 2 ? 0x3a2a30 : 0x2f2226, [0, 0.7 + i * 1.4, 0], [0, i * 0.12, 0]]);
  parts.push([rbox(1.2, 1.8, 0.2, 0.05), 0xff6a1a, [0, 1.2, 2.12]], [rbox(0.6, 0.9, 0.2, 0.05), 0xffa23a, [1, 4.5, 1.9]]);
  return merged(parts);
}

// --- painted ground ---------------------------------------------------------------------------
// One square tile covering the whole road width; it repeats along the road. A wavy dirt lane runs down the middle.
const PALETTE = {
  meadow: { g: ['#8ed35c', '#7cc64d', '#a3e06e'], blade: '#5fae3e', lane: ['#d9b27a', '#c99f66', '#e6c48e'], edge: '#a87c4c', peb: '#bdb3a0', laneW: 0.085 },
  forest: { g: ['#5eae50', '#4f9d44', '#72c060'], blade: '#3d8634', lane: ['#a87d52', '#966c44', '#b98e62'], edge: '#6e4c2e', peb: '#9b9284', laneW: 0.08, leaves: true },
  snow: { g: ['#eef5fb', '#e1ecf6', '#f8fbff'], blade: '#cfe0ef', lane: ['#c6d6e6', '#b9cadc', '#d3e1ee'], edge: '#aabdd2', peb: '#9fb0c4', laneW: 0.08 },
  desert: { g: ['#f0cf86', '#e8c274', '#f6dc9c'], blade: '#d9ad5c', lane: ['#d9a35c', '#cc9650', '#e2b06c'], edge: '#b9803e', peb: '#c4955a', laneW: 0.09, ripples: true },
  volcano: { g: ['#6b4842', '#5c3c37', '#7a5650'], blade: '#4a302c', lane: ['#3e2a27', '#352320', '#4a332f'], edge: '#2a1a18', peb: '#2f2220', laneW: 0.085, cracks: true },
  base: { g: ['#8ed35c', '#7cc64d', '#a3e06e'], blade: '#5fae3e', lane: ['#dcc09a', '#cfb289', '#e6cfac'], edge: '#b0916a', peb: '#bdb3a0', laneW: 0.11 },
  path: { g: ['#8ed35c', '#7cc64d', '#a3e06e'], blade: '#5fae3e', lane: ['#d0a776', '#c49a69', '#dcb486'], edge: '#a07448', peb: '#bdb3a0', laneW: 0.2 },
};
// lane centre as a fraction of the tile width (0..1), for v in 0..1 (one tile); also used to keep scatter off the lane
export const laneU = (v) => 0.5 + Math.sin(v * Math.PI * 2) * 0.05;
const texCache = new Map();
export function groundTexture(kind, size = 1024) {
  const key = kind + size;
  if (texCache.has(key)) return texCache.get(key);
  const S = PALETTE[kind];
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const R = (a, b) => a + Math.random() * (b - a);
  const k = size / 1024;
  // wrap-around draw so the tile repeats seamlessly along v
  const blob = (x, y, r, col) => { g.fillStyle = col; for (const dy of [-size, 0, size]) { g.beginPath(); g.arc(x, y + dy, r, 0, Math.PI * 2); g.fill(); } };
  g.fillStyle = S.g[0]; g.fillRect(0, 0, size, size);
  for (let i = 0; i < 900; i++) { g.globalAlpha = R(0.25, 0.6); blob(R(0, size), R(0, size), R(10, 46) * k, S.g[1 + (i % 2)]); }
  g.globalAlpha = 1;
  if (S.ripples) {
    g.strokeStyle = S.blade; g.lineWidth = 2 * k; g.globalAlpha = 0.18;
    for (let i = 0; i < 160; i++) { const y0 = R(0, size), x0 = R(0, size), L = R(60, 160) * k; g.beginPath(); for (let x = 0; x <= L; x += 8) g.lineTo(x0 + x, y0 + Math.sin(x / 25) * 4 * k); g.stroke(); }
    g.globalAlpha = 1;
  }
  // grass blades / speckles
  g.strokeStyle = S.blade; g.lineWidth = 2.2 * k; g.globalAlpha = 0.55;
  for (let i = 0; i < 2600; i++) { const x = R(0, size), y = R(0, size), h = R(6, 14) * k; g.beginPath(); g.moveTo(x, y); g.lineTo(x + R(-3, 3) * k, y - h); g.stroke(); }
  g.globalAlpha = 1;
  // lane: soft edge band, then the lane, then lighter middle wear
  const laneAt = (v) => laneU(v) * size;
  const W = S.laneW * size;
  const strip = (half, col, alpha, jitter) => {
    g.globalAlpha = alpha;
    for (let y = -20; y < size + 20; y += 4 * k) {
      const cx = laneAt(((y % size) + size) % size / size);
      const w = half + Math.sin(y * 0.05) * jitter + Math.sin(y * 0.013 + 1) * jitter;
      blob(cx, y, w, col);
    }
    g.globalAlpha = 1;
  };
  strip(W * 1.12, S.edge, 0.35, 6 * k);
  strip(W, S.lane[0], 1, 5 * k);
  for (let i = 0; i < 500; i++) { const y = R(0, size), cx = laneAt(y / size); g.globalAlpha = R(0.3, 0.7); blob(cx + R(-W, W) * 0.85, y, R(6, 22) * k, S.lane[1 + (i % 2)]); }
  g.globalAlpha = 1;
  // two compacted wheel tracks, and grass tufts creeping in from the edges
  for (const off of [-0.42, 0.42]) {
    g.globalAlpha = 0.28;
    for (let y = -10; y < size + 10; y += 3 * k) blob(laneAt(((y % size) + size) % size / size) + off * W + Math.sin(y * 0.03) * 3 * k, y, 7 * k, S.edge);
  }
  g.globalAlpha = 1;
  for (let i = 0; i < 260; i++) { const y = R(0, size), side = Math.random() < 0.5 ? -1 : 1; blob(laneAt(y / size) + side * W * R(0.85, 1.05), y, R(3, 8) * k, S.g[i % 3]); }
  // pebbles in and near the lane
  for (let i = 0; i < 220; i++) {
    const y = R(0, size), cx = laneAt(y / size), x = cx + R(-W * 1.4, W * 1.4), r = R(2, 6) * k;
    g.globalAlpha = 0.5; blob(x + 1.5 * k, y + 2 * k, r, 'rgba(0,0,0,.35)'); g.globalAlpha = 1; blob(x, y, r, S.peb);
  }
  if (S.leaves) for (let i = 0; i < 300; i++) blob(R(0, size), R(0, size), R(3, 6) * k, ['#e08a2a', '#c85a2a', '#e8b23a'][i % 3]);
  let glow = null;
  if (S.cracks) {
    const c2 = document.createElement('canvas'); c2.width = c2.height = size;
    const g2 = c2.getContext('2d'); g2.fillStyle = '#000'; g2.fillRect(0, 0, size, size);
    for (let i = 0; i < 30; i++) {
      let x = R(0, size), y = R(0, size); const pts = [[x, y]];
      for (let j = 0; j < 7; j++) { x += R(-34, 34) * k; y += R(-34, 34) * k; pts.push([x, y]); }
      for (const [ctx, col, w] of [[g, '#2a1410', 7], [g, '#ff7a2a', 3], [g2, '#ff5a10', 6], [g2, '#ffc04a', 2.5]]) {
        ctx.strokeStyle = col; ctx.lineWidth = w * k; ctx.lineJoin = 'round'; ctx.beginPath(); pts.forEach(([px, py], n) => (n ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.stroke();
      }
    }
    glow = new THREE.CanvasTexture(c2); glow.wrapT = THREE.RepeatWrapping; glow.colorSpace = THREE.SRGBColorSpace;
  }
  // darker grass toward the fences: grounds the edges like ambient occlusion
  for (const [x0, x1] of [[0, 70 * k], [size, size - 70 * k]]) {
    const grd = g.createLinearGradient(x0, 0, x1, 0); grd.addColorStop(0, 'rgba(20,40,10,.28)'); grd.addColorStop(1, 'rgba(20,40,10,0)');
    g.fillStyle = grd; g.fillRect(Math.min(x0, x1), 0, 70 * k, size);
  }
  const tx = new THREE.CanvasTexture(c);
  tx.wrapS = THREE.ClampToEdgeWrapping; tx.wrapT = THREE.RepeatWrapping; tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 8;
  tx.userData.glow = glow;
  texCache.set(key, tx);
  return tx;
}

// pen floor: straw bed on a beveled wooden base
export function penPad() {
  const parts = [[rbox(4.3, 0.22, 4.3, 0.08), 0x9a6a3a, [0, 0.11, 0]], [rbox(3.9, 0.12, 3.9, 0.06), 0xe8c35a, [0, 0.25, 0]]];
  for (let i = 0; i < 14; i++) {
    const a = i * 2.4, r = 0.4 + (i % 5) * 0.32;
    parts.push([rbox(0.7, 0.05, 0.08, 0.02), i % 2 ? 0xf6dc86 : 0xc99a3a, [Math.cos(a) * r, 0.32, Math.sin(a) * r], [0, a * 1.7, 0]]);
  }
  return merged(parts);
}
// soft round contact shadow under characters (works even with shadows switched off)
let blobTex = null;
export function blobShadow(size) {
  if (!blobTex) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grd.addColorStop(0, 'rgba(0,0,0,.5)'); grd.addColorStop(0.6, 'rgba(0,0,0,.22)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    blobTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.rotation.x = -Math.PI / 2; m.renderOrder = 1;
  return m;
}
