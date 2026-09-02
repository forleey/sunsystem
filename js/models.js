// GLB model loading for ships & stations. Models are open-source assets
// (see models_src/poly/meta.txt + README credits), optimized with
// gltf-transform and served from Cloudflare R2. Every build*() in
// fleet_meshes.js stays as instant fallback: loadInto() swaps the GLB in
// when it arrives, so the sim never waits on the network.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export const ASSET_BASE = 'https://pub-71534651969246d597a0c1bf543eff8c.r2.dev';

// Razor terminator for ships & stations: sharpen the diffuse N·L response of
// every MeshStandardMaterial so lit faces snap to shadow in a ~13° band
// instead of the soft cosine roll-off. Planets use custom shaders (untouched).
// Must run before the first render (materials bake the chunk on compile).
// Opt-out: a material with defines.SOFT_TERMINATOR keeps the plain cosine
// (the ship interior, js/interior/trim.js). The default stays hard, so every
// space-scene material renders exactly as before.
export const SOFT_TERMINATOR = 'SOFT_TERMINATOR';
function hardenDirectLighting() {
  const key = 'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );';
  const chunk = THREE.ShaderChunk.lights_physical_pars_fragment;
  if (chunk.includes(key)) {
    THREE.ShaderChunk.lights_physical_pars_fragment = chunk.replace(key,
      key + '\n\t#ifndef SOFT_TERMINATOR\n\tdotNL = smoothstep( 0.0, 0.14, dotNL ) * ( 0.6 + 0.4 * dotNL );\n\t#endif');
  } else {
    console.warn('hardenDirectLighting: chunk signature not found — soft shading stays');
  }
}

// Neutral studio environment so metallic PBR models (NASA CAD exports ship
// with metalness 1) reflect something instead of rendering black. Custom
// planet/star shaders ignore scene.environment, so this only affects ships.
export function initEnvironment(renderer, scene) {
  hardenDirectLighting();
  import('three/addons/environments/RoomEnvironment.js').then(({ RoomEnvironment }) => {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    // barely-there IBL: just enough that full-metal PBR parts catch a glint,
    // while shadow sides stay pitch black like the planet shaders
    scene.environmentIntensity = 0.012;
    pmrem.dispose();
  }).catch(() => {});
}

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map();          // url -> Promise<GLTF scene template>

// ---- fleet paint scheme: white hulls with light gray shading ----
// Base-color maps are converted to bright grayscale (panel detail survives as
// gray tones); flat material colors get the same treatment. Pure glow
// materials (blinkers, windows, engine discs — emissive, no map) keep their
// color, and emissive TEXTURES on washed materials stay lit too.
const washedTex = new WeakMap();
function whitewashTexture(tex) {
  if (washedTex.has(tex)) return washedTex.get(tex);
  const img = tex.image;
  if (!img || !img.width) return tex;
  const cnv = document.createElement('canvas');
  cnv.width = img.width; cnv.height = img.height;
  const ctx = cnv.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, cnv.width, cnv.height);
  const a = d.data;
  for (let i = 0; i < a.length; i += 4) {
    const v = 205 + (0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2]) * 0.20;
    a[i] = a[i + 1] = a[i + 2] = v;
  }
  ctx.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(cnv);
  t.colorSpace = tex.colorSpace;
  t.flipY = tex.flipY;
  t.wrapS = tex.wrapS; t.wrapT = tex.wrapT;
  t.anisotropy = tex.anisotropy;
  washedTex.set(tex, t);
  return t;
}
// per-object material override (editor-tuned station/ship looks). Clones the
// (shared) GLB materials before mutating. Call after load via loadInto onLoaded.
export function paintObject(root, spec) {
  root.traverse(n => {
    if (!n.isMesh || !n.material) return;
    n.material = Array.isArray(n.material) ? n.material.map(m => m.clone()) : n.material.clone();
    const mats = Array.isArray(n.material) ? n.material : [n.material];
    for (const m of mats) {
      if (m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.2 && !m.map) {
        // running lights / windows / engine glow: keep the light, honour Lights tweaks
        if (spec.glow != null && 'emissiveIntensity' in m) m.emissiveIntensity *= spec.glow;
        if (spec.glowColor != null && m.emissive) m.emissive.setHex(spec.glowColor);
        m.userData._washed = true;
        continue;
      }
      if (spec.hull != null && m.color) m.color.setHex(spec.hull);
      if (spec.emissive != null && m.emissive) m.emissive.setHex(spec.emissive);
      if (spec.emissiveIntensity != null && 'emissiveIntensity' in m) m.emissiveIntensity = spec.emissiveIntensity;
      if (spec.metalness != null && 'metalness' in m) m.metalness = spec.metalness;
      if (spec.roughness != null && 'roughness' in m) m.roughness = spec.roughness;
      m.userData._washed = true;
    }
  });
}

export function whitewashObject(root) {
  root.traverse(n => {
    if (!n.isMesh) return;
    const mats = Array.isArray(n.material) ? n.material : [n.material];
    for (const m of mats) {
      if (!m || m.userData._washed) continue;
      const glowing = m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.2 && !m.map;
      if (glowing) continue;   // nav lights & engine glows keep their color
      if (m.map) { m.map = whitewashTexture(m.map); m.color && m.color.setRGB(1, 1, 1); }
      else if (m.color) {
        const c = m.color;
        const v = 0.82 + (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) * 0.18;
        c.setRGB(v, v, v);
      }
      m.userData._washed = true;
    }
  });
}

function fetchModel(url) {
  if (!cache.has(url)) {
    cache.set(url, new Promise((res, rej) => loader.load(url, g => res(g.scene), undefined, rej)));
  }
  return cache.get(url);
}

// Normalize: center, scale so the longest axis equals lengthKm (scene units
// = km), nose to -Z via yaw, then attach nav blinkers at the extremes.
// raider paint: near-black hull, red engine glow — hostile silhouette.
// Materials are SHARED across GLB clones, so clone them before painting.
function raiderPaint(root) {
  root.traverse(n => {
    if (!n.isMesh) return;
    n.material = Array.isArray(n.material) ? n.material.map(m => m.clone()) : n.material.clone();
    const mats = Array.isArray(n.material) ? n.material : [n.material];
    for (const m of mats) {
      const glowing = m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.2 && !m.map;
      if (glowing) { m.emissive.setRGB(1.8, 0.28, 0.12); continue; }
      if (m.emissiveMap) m.emissive.setRGB(1.4, 0.3, 0.15);
      if (m.color) {
        const c = m.color, lum = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
        const v = 0.13 + lum * 0.1;
        c.setRGB(v, v * 1.02, v * 1.12);
      }
      m.userData._washed = true;   // keep the fleet wash off this paint job
    }
  });
}

// player paint: black hull (editor-tuned), matte-ish, self-lit by its own
// window/port emissive + fill light. Drops the albedo map (no markings/colour).
function playerPaint(root) {
  root.traverse(n => {
    if (!n.isMesh) return;
    n.material = Array.isArray(n.material) ? n.material.map(m => m.clone()) : n.material.clone();
    const mats = Array.isArray(n.material) ? n.material : [n.material];
    for (const m of mats) {
      if (m.map) m.map = null;                 // strip painted lettering/markings + colour
      if (m.color) m.color.setHex(0x000000);   // black hull
      if (m.emissive) m.emissive.setHex(0xe6e6e6);
      if ('metalness' in m) m.metalness = 0.2;
      if ('roughness' in m) m.roughness = 0.56;
      m.userData._washed = true;
    }
  });
}

function normalize(src, { lengthKm, yaw = 0, pitch = 0, roll = 0, lift = 0, blinkers = 2, unlit = false, raider = false, player = false }) {
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
  if (raider) raiderPaint(obj);        // hostiles: black hull, red glow
  else if (player) playerPaint(obj);   // hero: dark gunmetal, glossy
  else whitewashObject(obj);           // fleet paint scheme: white hull, light gray shading

  // nav blinkers (fleet.place drives emissiveIntensity)
  wrap.userData.blinkers = [];
  if (blinkers > 0) {
    const half = lengthKm / 2;
    const spots = raider ? [
      [half * 0.85, 0, 0, 0xff3322], [-half * 0.85, 0, 0, 0xff3322],
      [0, half * 0.5, 0, 0xff5533], [0, 0, -half * 0.9, 0xff3322],
    ] : [
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

// Swap a GLB into `grp` when it arrives. The procedural fallback inside grp
// stays HIDDEN until the load fails (or hangs >6 s) — no primitive flash.
export function loadInto(grp, file, opts) {
  grp.visible = false;
  const reveal = setTimeout(() => { grp.visible = true; }, 6000);
  fetchModel(`${ASSET_BASE}/models/${file}`).then(tpl => {
    const model = normalize(tpl, opts);
    for (const c of [...grp.children]) grp.remove(c);
    grp.add(model);
    grp.userData.blinkers = model.userData.blinkers;
    clearTimeout(reveal);
    grp.visible = true;
    if (opts.onLoaded) opts.onLoaded(model);
  }).catch(err => {
    clearTimeout(reveal);
    grp.visible = true;
    console.warn('model fallback stays (load failed):', file, err && err.message);
  });
  return grp;
}
