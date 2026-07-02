// GLB model loading for ships & stations. Models are open-source assets
// (see models_src/poly/meta.txt + README credits), optimized with
// gltf-transform and served from Cloudflare R2. Every build*() in
// fleet_meshes.js stays as instant fallback: loadInto() swaps the GLB in
// when it arrives, so the sim never waits on the network.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export const ASSET_BASE = 'https://pub-71534651969246d597a0c1bf543eff8c.r2.dev';

// Neutral studio environment so metallic PBR models (NASA CAD exports ship
// with metalness 1) reflect something instead of rendering black. Custom
// planet/star shaders ignore scene.environment, so this only affects ships.
export function initEnvironment(renderer, scene) {
  import('three/addons/environments/RoomEnvironment.js').then(({ RoomEnvironment }) => {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    // barely-there IBL: just enough that full-metal PBR parts catch a glint,
    // while shadow sides stay pitch black like the planet shaders
    scene.environmentIntensity = 0.02;
    pmrem.dispose();
  }).catch(() => {});
}

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map();          // url -> Promise<GLTF scene template>

function fetchModel(url) {
  if (!cache.has(url)) {
    cache.set(url, new Promise((res, rej) => loader.load(url, g => res(g.scene), undefined, rej)));
  }
  return cache.get(url);
}

// Normalize: center, scale so the longest axis equals lengthKm (scene units
// = km), nose to -Z via yaw, then attach nav blinkers at the extremes.
function normalize(src, { lengthKm, yaw = 0, pitch = 0, roll = 0, lift = 0, blinkers = 2, unlit = false }) {
  const obj = src.clone(true);
  const wrap = new THREE.Group();
  const inner = new THREE.Group();
  inner.add(obj);
  wrap.add(inner);

  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const ctr = box.getCenter(new THREE.Vector3());
  obj.position.sub(ctr);
  const s = lengthKm / Math.max(size.x, size.y, size.z, 1e-9);
  inner.scale.setScalar(s);
  // ZYX: model-space X first (pitch), then yaw, then world roll — so a
  // launch-pose model (nose -Y) pitches onto -Z and rolls upright
  inner.rotation.set(pitch, yaw, roll, 'ZYX');
  inner.position.y = lift * lengthKm;

  obj.traverse(n => {
    if (!n.isMesh) return;
    n.frustumCulled = true;
    const mats = Array.isArray(n.material) ? n.material : [n.material];
    for (const m of mats) {
      if (unlit && m.emissive) { m.emissive.copy(m.color); m.emissiveIntensity = 0.35; }
      if (m.map) m.map.anisotropy = 4;
      // CAD/Blender exports default to metalness 1 — pitch black without an
      // environment map. Only clamp when no metal-rough texture drives it.
      if (!m.metalnessMap && m.metalness > 0.85) { m.metalness = 0.35; m.roughness = Math.max(m.roughness ?? 1, 0.5); }
    }
  });

  // nav blinkers (fleet.place drives emissiveIntensity)
  wrap.userData.blinkers = [];
  if (blinkers > 0) {
    const half = lengthKm / 2;
    const spots = [
      [half * 0.85, 0, 0, 0xff5544], [-half * 0.85, 0, 0, 0x44ff77],
      [0, half * 0.5, 0, 0xffffff], [0, 0, -half * 0.9, 0xffffff],
    ];
    for (let i = 0; i < Math.min(blinkers, spots.length); i++) {
      const [x, y, z, col] = spots[i];
      const b = new THREE.Mesh(
        new THREE.SphereGeometry(Math.max(lengthKm * 0.012, 0.004), 6, 6),
        new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.5 }));
      b.position.set(x, y, z);
      wrap.add(b);
      wrap.userData.blinkers.push(b);
    }
  }
  return wrap;
}

// Promise variant for callers that manage the swap themselves (player ship).
export function loadModel(file, opts) {
  return fetchModel(`${ASSET_BASE}/models/${file}`).then(tpl => normalize(tpl, opts));
}

// Swap a GLB into `grp` when it arrives; until then the procedural fallback
// (already inside grp) keeps flying. On success the fallback children are
// removed and the blinker list is replaced.
export function loadInto(grp, file, opts) {
  fetchModel(`${ASSET_BASE}/models/${file}`).then(tpl => {
    const model = normalize(tpl, opts);
    for (const c of [...grp.children]) grp.remove(c);
    grp.add(model);
    grp.userData.blinkers = model.userData.blinkers;
    if (opts.onLoaded) opts.onLoaded(model);
  }).catch(err => {
    console.warn('model fallback stays (load failed):', file, err && err.message);
  });
  return grp;
}
