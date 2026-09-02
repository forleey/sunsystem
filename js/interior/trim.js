// Surfaces of the ship interior (M2): a material factory over the CC0 trim
// sheets on R2, a box UV projection for the generated slabs, and the swatch
// strip that shows every set side by side (?board=1&pose=swatch).
//
// Every material made here carries defines.SOFT_TERMINATOR, so the razor
// terminator that js/models.js patches into the shared shader chunk for the
// ships stays off inside (spec 6.6). Textures arrive asynchronously; until
// then the material is its tint alone, which is why the tints are chosen to
// look right on their own.
import * as THREE from 'three';
import { ASSET_BASE, SOFT_TERMINATOR } from '../models.js?v=103';
import { SWATCH, hullToInterior } from './hull_frame.js?v=103';

// surface sets: R2 folder name and the maps the pipeline produced
// (tools/interior_assets.sh writes textures/interior/<set>/<set>_<map>.webp)
export const SETS = {
  panel: { set: 'MetalPlates015A', maps: ['color', 'normal', 'rough', 'metal', 'ao'], tile: 2.0 },   // sci-fi panel sheet, the main trim
  powder: { set: 'Metal027', maps: ['color', 'normal', 'rough', 'metal'], tile: 1.0 },              // black powder-coat, switch panels
  tread: { set: 'DiamondPlate008C', maps: ['color', 'normal', 'rough', 'metal', 'ao'], tile: 1.0 }, // tread plate floors
  grating: { set: 'MetalWalkway006', maps: ['color', 'normal', 'rough', 'metal'], tile: 1.0 },       // floor grating (ambientCG ships no AO for this set)
  greasy: { set: 'Metal046B', maps: ['color', 'normal', 'rough', 'metal'], tile: 1.5 },             // greasy dark metal, under-deck
  plate: { set: 'metal_plate', maps: ['color', 'normal', 'rough', 'metal', 'ao'], tile: 1.5 },      // bolted steel plate
  bluePlate: { set: 'blue_metal_plate', maps: ['color', 'normal', 'rough', 'metal', 'ao'], tile: 1.5 },
  rib: { set: 'painted_metal_shutter', maps: ['color', 'normal', 'rough', 'metal', 'ao'], tile: 1.0 }, // painted ribs
  rubber: { set: 'rubber_tiles', maps: ['color', 'normal', 'rough', 'ao'], tile: 1.0 },              // hold floor matting
  grate: { set: 'metal_grate_rusty', maps: ['color', 'normal', 'rough', 'metal', 'ao'], tile: 0.5 }, // hatches
};

const loader = new THREE.TextureLoader();
loader.setCrossOrigin('anonymous');
const texCache = new Map();          // url -> Texture
let texturesWanted = true;           // ?trim=0 renders tints alone (swatch of the shading itself)
export function setTexturesWanted(v) { texturesWanted = !!v; }

// Loads a map once and hands it to every caller when it is there. A map is
// never put on a material before its image arrived: a Texture without image
// makes three warn every frame, and the material needs a recompile
// (USE_MAP and friends) the moment the map appears, so the caller does that.
function tex(set, map, onReady) {
  const url = `${ASSET_BASE}/textures/interior/${set}/${set}_${map}.webp`;
  let e = texCache.get(url);
  if (!e) {
    e = { tex: null, waiters: [], failed: false };
    texCache.set(url, e);
    const t = loader.load(url, () => {
      e.tex = t;
      for (const w of e.waiters) w(t);
      e.waiters = [];
    }, undefined, () => { e.failed = true; e.waiters = []; });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    if (map === 'color') t.colorSpace = THREE.SRGBColorSpace;
  }
  if (e.tex) onReady(e.tex); else if (!e.failed) e.waiters.push(onReady);
}
export function texturesLoaded() {
  let n = 0, failed = 0, pending = 0;
  for (const e of texCache.values()) { if (e.tex) n++; else if (e.failed) failed++; else pending++; }
  return { loaded: n, failed, pending };
}

// grime: a cheap two-octave value noise on the interior world position,
// darkening and roughening the surface, strongest low on the walls and in
// the corners where a floor meets them. uGrime scales it per material.
const GRIME_GLSL = /* glsl */`
uniform float uGrime;
uniform vec3 uGrimeTint;
varying vec3 vTrimPos;
float trimHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float trimNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(trimHash(i), trimHash(i + vec3(1, 0, 0)), f.x), mix(trimHash(i + vec3(0, 1, 0)), trimHash(i + vec3(1, 1, 0)), f.x), f.y);
  float b = mix(mix(trimHash(i + vec3(0, 0, 1)), trimHash(i + vec3(1, 0, 1)), f.x), mix(trimHash(i + vec3(0, 1, 1)), trimHash(i + vec3(1, 1, 1)), f.x), f.y);
  return mix(a, b, f.z);
}
float trimGrime() {
  float n = trimNoise(vTrimPos * 2.3) * 0.6 + trimNoise(vTrimPos * 8.5) * 0.4;   // two octaves: the third cost 3 ms a frame at DPR 2 and read as texture noise
  float low = 1.0 - smoothstep(-1.5, 0.4, vTrimPos.y);          // the deck floor is at -1.5
  float g = smoothstep(0.42, 0.85, n) * (0.3 + 0.7 * low);
  return clamp(g * uGrime, 0.0, 1.0);
}
`;

function grimed(m, grime) {
  m.defines = { ...(m.defines || {}), [SOFT_TERMINATOR]: '' };
  m.userData.grime = { value: grime };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGrime = m.userData.grime;
    sh.uniforms.uGrimeTint = { value: new THREE.Color(0x1a1714) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTrimPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTrimPos = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GRIME_GLSL)
      .replace('#include <map_fragment>', '#include <map_fragment>\nfloat trimG = trimGrime(); diffuseColor.rgb = mix(diffuseColor.rgb, uGrimeTint, trimG * 0.5);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + trimG * 0.35, 0.0, 1.0);');
  };
  // the shader cache keys on onBeforeCompile's source: one program per grime
  // setting would be wasteful, and the value rides in a uniform anyway
  m.customProgramCacheKey = () => 'trim';
  return m;
}

// A MeshStandardMaterial over one surface set. tint multiplies the colour
// map (or IS the colour until the map arrives); grime 0..1.5. metalness scales
// the metalness map: at 1.0 the bare-steel parts of a sheet had no diffuse at
// all and went pure black wherever no lamp reflected (windowTest counted
// 4700 such pixels as space); painted and grimy metal at 0.5 keeps a diffuse term.
export function surface(key, { tint = 0xffffff, roughness = 1.0, metalness = 0.5, grime = 0.6, side = THREE.FrontSide, emissive = 0x000000, emissiveIntensity = 1, tile } = {}) {
  const def = SETS[key];
  if (!def) throw new Error(`trim: no surface set ${key}`);
  const rep = 1 / (tile || def.tile);
  const m = new THREE.MeshStandardMaterial({ color: tint, roughness, metalness, side, emissive, emissiveIntensity });
  if (texturesWanted) {
    for (const map of def.maps) {
      tex(def.set, map, (shared) => {
        // repeat is per material (tile differs), so each material gets its own
        // Texture over the shared Source: one GPU upload per image (three
        // shares the WebGL texture between clones of a Source)
        const t = shared.clone();
        t.repeat.set(rep, rep);
        t.needsUpdate = true;
        if (map === 'color') m.map = t;
        else if (map === 'normal') { m.normalMap = t; m.normalScale.set(1, 1); }
        else if (map === 'rough') m.roughnessMap = t;
        else if (map === 'metal') m.metalnessMap = t;
        else if (map === 'ao') { m.aoMap = t; m.aoMapIntensity = 0.5; }   // at 0.8 the seams of the plate sheet went to pure black (windowTest counted them as space)
        m.needsUpdate = true;
      });
    }
  }
  m.name = `trim:${key}`;
  return grimed(m, grime);
}

// a plain tinted material with the interior's soft terminator (glass frames,
// lamp housings, things without a sheet)
export function plain(opts = {}) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.3, ...opts });
  m.defines = { ...(m.defines || {}), [SOFT_TERMINATOR]: '' };
  return m;
}

// Box UV projection: every triangle takes its UVs from the two world axes
// perpendicular to its dominant normal axis, in metres, so a trim sheet
// tiles seamlessly across all the slabs of a room whatever their size. The
// geometry must already be in interior world coordinates (translated) and
// non-indexed or indexed, with a normal attribute. aoMap reads uv as well
// (uv2 was retired in three 0.152+, aoMap uses uv by default via
// aoMap.channel = 0).
export function boxUV(geom) {
  const pos = geom.attributes.position, nrm = geom.attributes.normal;
  const n = pos.count;
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i)), nz = Math.abs(nrm.getZ(i));
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let u, v;
    if (ny >= nx && ny >= nz) { u = x; v = z; }
    else if (nx >= nz) { u = z; v = y; }
    else { u = x; v = y; }
    uv[2 * i] = u; uv[2 * i + 1] = v;
  }
  geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geom;
}

// The swatch strip: one panel per set, standing along the hold's port wall,
// in the order of SETS. Visual only, added when the URL asks for it.
export function buildSwatchStrip() {
  const g = new THREE.Group();
  g.name = 'swatches';
  const keys = Object.keys(SETS);
  keys.forEach((key, i) => {
    const z = SWATCH.z0 + i * (SWATCH.size + SWATCH.gap) + SWATCH.size / 2;
    const p = hullToInterior(SWATCH.x, SWATCH.y + SWATCH.size / 2, z);
    const geom = new THREE.BoxGeometry(0.08, SWATCH.size, SWATCH.size);
    geom.translate(p.x, p.y, p.z);
    boxUV(geom);
    const m = new THREE.Mesh(geom, surface(key, { tint: 0xffffff, grime: 0.6, tile: 1.0 }));
    m.name = `swatch:${key}`;
    g.add(m);
    // a plain version beside it, without grime, half a metre lower
    const geom2 = new THREE.BoxGeometry(0.08, SWATCH.size * 0.4, SWATCH.size);
    geom2.translate(p.x, p.y - SWATCH.size * 0.5 - SWATCH.size * 0.25, p.z);
    boxUV(geom2);
    g.add(new THREE.Mesh(geom2, surface(key, { tint: 0xffffff, grime: 0.0, tile: 1.0 })));
  });
  return g;
}
