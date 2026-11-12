// Zone guards: the mother birds whose eggs you steal. Built from boxes so they match the blocky
// Kenney models, with a small procedural animation instead of clips. They expose the same
// userData.play / speed / mixer.update interface as spawn()ed characters.
import * as THREE from './vendor/three.module.js';
import { mergeGeometries } from './vendor/addons/utils/BufferGeometryUtils.js';

// collapse a group's plain (non-glowing) box children into one vertex-coloured mesh: ~30 draw calls per bird -> ~10
const vcMat = new THREE.MeshLambertMaterial({ vertexColors: true });
function mergeChildren(group) {
  const plain = group.children.filter((c) => c.isMesh && !c.userData.keep && !(c.material.emissive && c.material.emissive.getHex()));
  if (plain.length < 2) return;
  const geos = plain.map((m) => {
    let g = m.geometry.clone(); g.deleteAttribute('uv'); if (g.index) g = g.toNonIndexed();
    m.updateMatrix(); g.applyMatrix4(m.matrix);
    const c = m.material.color, n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  });
  for (const m of plain) group.remove(m);
  const mesh = new THREE.Mesh(mergeGeometries(geos), vcMat); mesh.castShadow = true;
  group.add(mesh);
}

const cache = new Map();
const mat = (color, opts = {}) => {
  const key = color + JSON.stringify(opts);
  if (!cache.has(key)) cache.set(key, new THREE.MeshLambertMaterial({ color, ...opts }));
  return cache.get(key);
};
function bx(w, h, d, color, x = 0, y = 0, z = 0, opts) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
  m.position.set(x, y, z); m.castShadow = true;
  return m;
}

// body [w, h, d, color], leg length, neck [w, h], head size; the rest is decoration
const SPECIES = {
  hen: { body: [1.5, 1.25, 1.7, 0xfdf6ea], leg: 0.7, legC: 0xf2a33a, neck: [0.6, 0.45], head: 0.8, headC: 0xfdf6ea, beak: 0xf2a33a,
    comb: 0xe0383e, wattle: 0xe0383e, tail: 'up', tailC: 0xf3e9d6, wingC: 0xeee2cc },
  turkey: { body: [1.7, 1.5, 1.8, 0x7a4a2b], leg: 0.8, legC: 0xd98f4e, neck: [0.42, 0.75], neckC: 0x9fb4cf, head: 0.6, headC: 0x9fb4cf, beak: 0xe8c47a,
    wattle: 0xd8323a, tail: 'fan', fan: [0x4f2d1b, 0xc77a3a, 0xf1d9a6], wingC: 0x5e3820 },
  goose: { body: [1.35, 1.15, 2.1, 0xf4f6fa], leg: 0.75, legC: 0xff8a2a, neck: [0.42, 1.45], head: 0.6, headC: 0xf4f6fa, beak: 0xff8a2a, beakLen: 0.55,
    tail: 'flat', tailC: 0xdfe4ec, wingC: 0xdfe4ec, wingTip: 0x2b3442 },
  ostrich: { body: [1.7, 1.3, 2.1, 0x26282e], leg: 1.9, legC: 0xe9a4a0, legW: 0.3, neck: [0.34, 1.9], neckC: 0xe9a4a0, head: 0.55, headC: 0xe9a4a0, beak: 0xd9b48a,
    tail: 'puff', tailC: 0xf4f0e8, wingC: 0xf4f0e8 },
  phoenix: { body: [1.5, 1.3, 1.8, 0xe2402b], leg: 0.95, legC: 0xffb02e, neck: [0.55, 0.75], head: 0.72, headC: 0xf0602e, beak: 0xffd23a,
    crest: 0xffd23a, tail: 'flame', wingC: 0xff8a2a, glow: 0x5a1000 },
};

export function makeBird(kind, scale = 1) {
  const S = SPECIES[kind];
  const [bw, bh, bd, bc] = S.body;
  const glow = S.glow ? { emissive: S.glow } : undefined;
  const root = new THREE.Group();
  const model = new THREE.Group(); model.scale.setScalar(scale); root.add(model);

  // legs hang from hip pivots, so swinging them is one rotation
  const legs = [-1, 1].map((side) => {
    const hip = new THREE.Group(); hip.position.set(side * bw * 0.22, S.leg, 0.05);
    const lw = S.legW || 0.2;
    hip.add(bx(lw, S.leg, lw, S.legC, 0, -S.leg / 2, 0));
    hip.add(bx(lw * 2, 0.12, lw * 2.6, S.legC, 0, -S.leg + 0.06, lw * 0.6));
    model.add(hip);
    return hip;
  });

  const body = new THREE.Group(); body.position.y = S.leg; model.add(body);
  body.add(bx(bw, bh, bd, bc, 0, bh / 2, 0, glow));
  body.add(bx(bw * 0.86, bh * 0.3, bd * 0.8, bc, 0, -0.02, 0.05, glow));   // belly, so the legs don't stick out of a flat bottom

  const wings = [-1, 1].map((side) => {
    const p = new THREE.Group(); p.position.set(side * (bw / 2 + 0.06), bh * 0.85, -0.05);
    p.add(bx(0.16, bh * 0.72, bd * 0.78, S.wingC, side * 0.06, -bh * 0.33, 0, glow));
    if (S.wingTip) p.add(bx(0.17, bh * 0.22, bd * 0.4, S.wingTip, side * 0.06, -bh * 0.62, -bd * 0.22));
    body.add(p);
    return p;
  });

  // neck and head on one pivot at the front of the body (head bobs come from tilting it)
  const neckP = new THREE.Group(); neckP.position.set(0, bh * 0.7, bd * 0.36); body.add(neckP);
  const [nw, nh] = S.neck;
  neckP.add(bx(nw, nh, nw, S.neckC || bc, 0, nh / 2, 0, glow));
  const head = new THREE.Group(); head.position.set(0, nh + S.head * 0.4, 0.08); neckP.add(head);
  const hs = S.head;
  head.add(bx(hs, hs, hs, S.headC, 0, 0, 0, glow));
  const bl = S.beakLen || hs * 0.42;
  head.add(bx(hs * 0.42, hs * 0.14, bl, S.beak, 0, -hs * 0.03, hs / 2 + bl / 2));
  const jaw = new THREE.Group(); jaw.position.set(0, -hs * 0.1, hs / 2); head.add(jaw);
  jaw.add(bx(hs * 0.36, hs * 0.1, bl * 0.85, new THREE.Color(S.beak).multiplyScalar(0.8).getHex(), 0, -hs * 0.03, bl * 0.42));
  const brows = [];
  for (const side of [-1, 1]) {
    head.add(bx(0.04, hs * 0.34, hs * 0.34, 0xffffff, side * (hs / 2 + 0.01), hs * 0.1, hs * 0.18));
    head.add(bx(0.05, hs * 0.2, hs * 0.17, 0x101827, side * (hs / 2 + 0.02), hs * 0.08, hs * 0.25));
    // angry brow: a dark slab over each eye, slanting down toward the beak
    const b = bx(0.07, hs * 0.09, hs * 0.42, 0x2a1a14, side * (hs / 2 + 0.03), hs * 0.33, hs * 0.18);
    b.rotation.x = -0.45; b.userData.keep = true; head.add(b); brows.push(b);
  }
  if (S.comb) for (let k = 0; k < 3; k++) head.add(bx(0.16, 0.22 + (k === 1 ? 0.1 : 0), 0.2, S.comb, 0, hs / 2 + 0.1, -0.18 + k * 0.2));
  if (S.wattle) head.add(bx(0.14, hs * 0.38, 0.14, S.wattle, 0, -hs * 0.42, hs / 2 + 0.04));
  if (S.crest) for (let k = 0; k < 3; k++) { const c = bx(0.14, 0.55, 0.14, S.crest, (k - 1) * 0.16, hs / 2 + 0.22, -0.1, { emissive: 0x6a4a00 }); c.rotation.x = -0.5; c.rotation.z = (1 - k) * 0.3; head.add(c); }

  // tails
  const tail = new THREE.Group(); tail.position.set(0, bh * 0.75, -bd / 2); body.add(tail);
  const flames = [];
  if (S.tail === 'up') { const t = bx(bw * 0.55, 0.9, 0.35, S.tailC, 0, 0.35, -0.1); t.rotation.x = -0.45; tail.add(t); }
  if (S.tail === 'flat') { const t = bx(bw * 0.5, 0.25, 0.6, S.tailC, 0, 0, -0.25); t.rotation.x = -0.25; tail.add(t); }
  if (S.tail === 'puff') tail.add(bx(bw * 0.85, 0.8, 0.6, S.tailC, 0, 0.1, -0.2));
  if (S.tail === 'fan') {
    for (let k = 0; k < 7; k++) {
      const a = (k - 3) * 0.36;
      const plate = new THREE.Group(); plate.rotation.z = a; plate.position.z = -0.15 - Math.abs(k - 3) * 0.02;
      S.fan.forEach((c, j) => plate.add(bx(0.48, 0.62, 0.1, c, 0, 0.45 + j * 0.6, 0)));
      tail.add(plate);
    }
    tail.position.y = bh * 0.55; tail.rotation.x = -0.25;
  }
  if (S.tail === 'flame') {
    [[0xff6a1a, 1.2], [0xffa21a, 1.6], [0xffe15a, 1.0]].forEach(([c, h], k) => {
      const f = bx(0.35, h, 0.3, c, (k - 1) * 0.32, h / 2, -0.15, { emissive: c, emissiveIntensity: 0.55 });
      f.rotation.x = -0.6; f.rotation.z = (1 - k) * 0.25; tail.add(f); flames.push(f);
    });
  }

  for (const grp of [model, body, neckP, head, tail, jaw, ...legs, ...wings, ...tail.children.filter((c) => c.isGroup)]) mergeChildren(grp);
  const height = (S.leg + bh * 0.7 + nh + hs * 0.9) * scale;
  const hip = S.leg;
  let mode = 'idle', rate = 1, t = Math.random() * 10;
  const anim = {
    update(dt) {
      const air = root.position.y > 0.05;
      const run = mode === 'sprint', walk = mode === 'walk';
      t += dt * (run ? 15 * rate : walk ? 8 : mode === 'idle' ? 2 : 10);
      const stride = run ? 0.85 : walk ? 0.5 : 0;
      const sw = Math.sin(t);
      legs[0].rotation.x = air ? -0.7 : sw * stride;
      legs[1].rotation.x = air ? -0.7 : -sw * stride;
      body.position.y = hip + (stride ? Math.abs(Math.cos(t)) * 0.12 * (run ? 1.6 : 1) : 0)
        + (mode === 'emote-yes' ? Math.abs(Math.sin(t * 0.8)) * 0.35 : 0);
      body.rotation.x = run ? 0.2 : walk ? 0.05 : 0;
      neckP.rotation.x = run ? 0.45 + Math.max(0, Math.sin(t * 0.55)) ** 6 * 0.9 : walk ? Math.sin(t * 2) * 0.14 : mode === 'idle' ? Math.max(0, Math.sin(t * 0.6) - 0.85) * 4 : 0;
      head.rotation.y = mode === 'emote-no' ? Math.sin(t * 2.5) * 0.55 : 0;
      const flap = run || air || mode === 'emote-yes' || mode === 'emote-no';
      const wa = flap ? 0.6 + Math.sin(t * (air ? 2.4 : run ? 2.2 : 1.6)) * 0.75 : 0.04;
      wings[0].rotation.z = -wa; wings[1].rotation.z = wa;
      for (let k = 0; k < flames.length; k++) flames[k].scale.y = 1 + Math.sin(t * 1.7 + k * 2) * 0.18;
      // squash and stretch on every stride, squawking beak and furious brows while chasing
      const sq = stride && !air ? Math.sin(t * 2) * (run ? 0.08 : 0.04) : air ? 0.1 : 0;
      body.scale.set(1 - sq * 0.5, 1 + sq, 1 - sq * 0.5);
      const angry = run || mode === 'emote-no';
      jaw.rotation.x = angry ? 0.25 + Math.abs(Math.sin(t * 0.9)) * 0.35 : 0;
      for (const b of brows) { b.rotation.x = angry ? -0.75 : -0.35; b.position.y = hs * (angry ? 0.28 : 0.34); }
    },
  };
  root.userData.mixer = anim;
  root.userData.play = (name) => { mode = name; };
  root.userData.speed = (s) => { rate = s; };
  root.userData.height = height;
  return root;
}
