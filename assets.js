// Loads every glTF model once, then hands out clones (with their own animation mixer)
// or instanced copies for scenery. All models are CC0 (Kenney), see assets/CREDITS.txt.
import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/addons/loaders/GLTFLoader.js';

export const PET_FILES = ['chick', 'bunny', 'caterpillar', 'cat', 'fox', 'penguin', 'panda', 'koala', 'parrot',
  'tiger', 'deer', 'polar', 'lion', 'elephant', 'giraffe', 'bee', 'monkey', 'crab'];
const CHAR_FILES = ['r', 'j', 'g', 'h'];
const NATURE_FILES = ['tree_default', 'tree_oak', 'tree_detailed', 'tree_pineRoundA', 'tree_pineRoundC', 'tree_pineTallA',
  'tree_cone', 'tree_cone_dark', 'tree_palmTall', 'tree_palmBend', 'rock_largeA', 'rock_largeC', 'rock_tallA', 'rock_tallE',
  'rock_smallA', 'cactus_tall', 'cactus_short', 'flower_redA', 'flower_yellowA', 'flower_purpleA', 'grass_large', 'plant_bush',
  'plant_bushLarge', 'mushroom_redGroup', 'stump_round', 'log_stack', 'fence_simple', 'fence_planks', 'crop_pumpkin',
  'campfire_stones', 'statue_obelisk'];
const PROP_FILES = ['coin', 'cloud', 'flag'];

const models = {};   // key -> {scene, animations}
let rampTex = null;
function ramp() {
  if (!rampTex) {
    rampTex = new THREE.DataTexture(new Uint8Array([120, 120, 120, 255, 205, 205, 205, 255, 255, 255, 255, 255]), 3, 1);
    rampTex.minFilter = rampTex.magFilter = THREE.NearestFilter; rampTex.needsUpdate = true;
  }
  return rampTex;
}

export async function loadAll(onProgress) {
  const list = [
    ...PET_FILES.map((n) => [`pet:${n}`, `pets/animal-${n}.glb`]),
    ...CHAR_FILES.map((n) => [`char:${n}`, `chars/character-${n}.glb`]),
    ...NATURE_FILES.map((n) => [`nature:${n}`, `nature/${n}.glb`]),
    ...PROP_FILES.map((n) => [`prop:${n}`, `props/${n}.glb`]),
  ];
  const loader = new GLTFLoader();
  let done = 0;
  await Promise.all(list.map(([key, file]) => loader.loadAsync(`./assets/${file}`)
    .then((g) => {
      g.scene.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = false; o.receiveShadow = true;
          // the kit materials are PBR; a 3-band toon material is cheaper on phones and gives the cartoon look of the cover
          const m = o.material;
          const toon = new THREE.MeshToonMaterial({ color: m.color.clone(), map: m.map, transparent: m.transparent, opacity: m.opacity, alphaTest: m.alphaTest, gradientMap: ramp() });
          if (toon.map) toon.map.colorSpace = THREE.SRGBColorSpace;
          o.material = toon;
        }
      });
      models[key] = { scene: g.scene, animations: g.animations };
    })
    .catch((e) => console.warn('[assets] failed', file, e))
    .finally(() => onProgress?.(++done / list.length))));
}

export const has = (key) => !!models[key];

// A ready-to-use copy. Characters and pets get a mixer and play(name) helper.
export function spawn(key, { shadow = true, scale = 1 } = {}) {
  const src = models[key];
  if (!src) return new THREE.Group();
  const root = new THREE.Group();
  const obj = src.scene.clone(true);
  obj.scale.setScalar(scale);
  obj.traverse((o) => { if (o.isMesh) o.castShadow = shadow; });
  root.add(obj);
  root.userData.model = obj;
  if (src.animations.length) {
    const mixer = new THREE.AnimationMixer(obj);
    const actions = {};
    for (const clip of src.animations) actions[clip.name] = mixer.clipAction(clip);
    let current = null;
    root.userData.mixer = mixer;
    root.userData.actions = actions;
    // crossfade to a looping clip; once=true plays it a single time then holds the last frame
    root.userData.play = (name, { fade = 0.15, speed = 1, once = false } = {}) => {
      const a = actions[name];
      if (!a) return;
      a.timeScale = speed;
      if (current === a && !once) return;
      a.reset();
      a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
      a.clampWhenFinished = once;
      a.play();
      if (current && current !== a) current.crossFadeTo(a, fade, false);
      current = a;
    };
    root.userData.speed = (s) => { if (current) current.timeScale = s; };
  }
  return root;
}

// Give a model its own materials, so a pet can be golden or glowing without touching the others.
export function ownMaterials(root) {
  const mats = [];
  root.traverse((o) => {
    if (o.isMesh) { o.material = o.material.clone(); mats.push(o.material); }
  });
  return mats;
}

// Many copies of one scenery model as InstancedMeshes (one draw call per sub-mesh).
// items: [{x, z, s, ry, y?, sy?}]; tint lerps every material toward a color (snowy trees, burnt rocks)
export function instanced(key, items, { shadow = false, tint = null, tintAmount = 0.6 } = {}) {
  const src = models[key];
  const group = new THREE.Group();
  if (!src || !items.length) return group;
  src.scene.updateMatrixWorld(true);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  src.scene.traverse((o) => {
    if (!o.isMesh) return;
    let material = o.material;
    if (tint != null) { material = material.clone(); material.color.lerp(new THREE.Color(tint), tintAmount); }
    const inst = new THREE.InstancedMesh(o.geometry, material, items.length);
    items.forEach((it, i) => {
      q.setFromAxisAngle(up, it.ry || 0);
      m.compose(new THREE.Vector3(it.x, it.y || 0, it.z), q, new THREE.Vector3(it.s, it.sy ?? it.s, it.s));
      inst.setMatrixAt(i, m.multiply(o.matrixWorld));
    });
    inst.castShadow = shadow; inst.receiveShadow = true;
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    group.add(inst);
  });
  return group;
}
