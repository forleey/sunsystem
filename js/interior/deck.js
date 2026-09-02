// The deck: shell boxes for walking and the room shells for looking, both
// generated from the room table in hull_frame.js. Nothing in here carries a
// number of its own except colours, tints and sample counts.
//
// Two lists come out of buildDeck():
//   solids  axis-aligned boxes in INTERIOR metres that the walk capsule
//           collides with: every wall, floor and ceiling slab (with the
//           doorways cut out), the steps, the ladder, the seats, the core.
//   group   the meshes. Visual meshes never enter the solid list; the slab
//           meshes are the same boxes as the slab solids, which is what makes
//           the shell watertight by construction.
//
// M2: every slab wears a trim sheet (trim.js) through a box UV projection in
// metres, one merged mesh per material; the cupola has its seven panes,
// frames, handrail and platform; the lights live in lighting.js.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  ROOMS, WELL, CUPOLA, CUPOLA_INTERIOR, SHELL, STEPS, LADDER, SEATS, CORE, SPAWN, WALK, OCCLUDER, doorways, hullToInterior, hullOutline,
} from './hull_frame.js?v=103';
import { surface, plain, boxUV } from './trim.js?v=103';
import { SOFT_TERMINATOR } from '../models.js?v=103';

const T = SHELL.thickness;
const SEGS = 48;

// what each room is made of: [surface set, tint, tile metres]. Tints keep the
// albedo in the 0.25 to 0.45 band the grade wants (the sheets are mid grey
// themselves; the rubber is near black and needs a light tint). Sets vary by
// room so the deck does not read as one wallpaper: bolted plate in the hold
// and bunks, the octagon panel in the corridors, powder-coat in the cockpit.
const CORRIDOR = { wall: ['panel', 0xa2a8ae, 2.4], floor: ['grating', 0xc0c4c8], ceil: ['powder', 0x8a8f94] };
const LOOK = {
  hold: { wall: ['plate', 0xaab2b8], floor: ['rubber', 0xd8d8d2], ceil: ['panel', 0x8e9296, 3.0] },   // the cool tint takes the orange out of the rusty plate
  corridorPort: CORRIDOR, corridorStbd: CORRIDOR, corridorAft: CORRIDOR, corridorFwd: CORRIDOR,
  passageFwd: CORRIDOR, passageAft: CORRIDOR,
  tunnel: { wall: ['panel', 0x9ea4aa, 2.4], floor: ['tread', 0xb5b8bb], ceil: ['powder', 0x80868c] },
  cockpit: { wall: ['plate', 0xa8aeb4], floor: ['tread', 0xa8abae], ceil: ['powder', 0x8a9096] },   // powder-coat walls went black under the one console strip
  bunks: { wall: ['plate', 0xc8b89c], floor: ['rubber', 0xc8c2b8], ceil: ['panel', 0x9a948a, 3.0] },
  engineering: { wall: ['plate', 0x8a8f94], floor: ['tread', 0xa0a4a8], ceil: ['greasy', 0x6f7478] },
  airlock: { wall: ['bluePlate', 0xa0a8b0], floor: ['tread', 0xa8abae], ceil: ['panel', 0x80868c, 3.0] },
};
const FIXED = {
  rib: () => surface('rib', { tint: 0x4a4e52, grime: 0.4 }),
  well: () => surface('panel', { tint: 0x9a9ea2, side: THREE.BackSide, grime: 0.3 }),
  step: () => surface('tread', { tint: 0xa8abae }),
  seat: () => surface('powder', { tint: 0x35383c, grime: 0.2 }),
  platform: () => surface('grating', { tint: 0xa8acb0, grime: 0.2 }),
  ladder: () => plain({ color: 0x8a8f96, metalness: 0.7, roughness: 0.45 }),
  frame: () => plain({ color: 0x24262a, metalness: 0.85, roughness: 0.4 }),
  handrail: () => plain({ color: 0x9aa0a6, metalness: 0.8, roughness: 0.35 }),
};

// hull-frame box (x range, y range, z range) -> interior AABB
export function hullBox(x0, x1, y0, y1, z0, z1, tag = '') {
  const a = hullToInterior(x0, y0, z0), b = hullToInterior(x1, y1, z1);
  return {
    min: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) },
    max: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) },
    tag,
  };
}
const roomBox = (r, key) => hullBox(r.x[0], r.x[1], r.floorY, r.ceilY, r.z[0], r.z[1], key);

// BoxGeometry for an interior AABB, translated into place
function boxGeom(b) {
  const g = new THREE.BoxGeometry(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
  g.translate((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
  return g;
}

// 2D rectangle subtraction on a wall face: rects are {s0, s1, y0, y1} in the
// face's span coordinate and height; a door cut leaves up to four pieces
function cut(rects, door) {
  const out = [];
  for (const r of rects) {
    const s0 = Math.max(r.s0, door.s0), s1 = Math.min(r.s1, door.s1);
    const y0 = Math.max(r.y0, door.y0), y1 = Math.min(r.y1, door.y1);
    if (s1 <= s0 || y1 <= y0) { out.push(r); continue; }
    if (door.s0 > r.s0) out.push({ s0: r.s0, s1: door.s0, y0: r.y0, y1: r.y1 });
    if (door.s1 < r.s1) out.push({ s0: door.s1, s1: r.s1, y0: r.y0, y1: r.y1 });
    if (door.y0 > r.y0) out.push({ s0, s1, y0: r.y0, y1: door.y0 });
    if (door.y1 < r.y1) out.push({ s0, s1, y0: door.y1, y1: r.y1 });
  }
  return out;
}

// wall slabs of one room in the HULL frame: for each of the four faces, a
// slab of thickness T inside the room, with every doorway on that face cut out
function wallSlabs(key, r, doors) {
  const slabs = [];
  const faces = [
    { axis: 'x', at: r.x[0], inner: [r.x[0], r.x[0] + T], span: 'z' },
    { axis: 'x', at: r.x[1], inner: [r.x[1] - T, r.x[1]], span: 'z' },
    { axis: 'z', at: r.z[0], inner: [r.z[0], r.z[0] + T], span: 'x' },
    { axis: 'z', at: r.z[1], inner: [r.z[1] - T, r.z[1]], span: 'x' },
  ];
  for (const f of faces) {
    let rects = [{ s0: r[f.span][0], s1: r[f.span][1], y0: r.floorY, y1: r.ceilY }];
    for (const d of doors) {
      if (d.axis !== f.axis || Math.abs(d.at - f.at) > 1e-9 || (d.a !== key && d.b !== key)) continue;
      rects = cut(rects, { s0: d.span[0], s1: d.span[1], y0: d.bottomY, y1: d.topY });
    }
    for (const q of rects) {
      const x = f.axis === 'x' ? f.inner : [q.s0, q.s1];
      const z = f.axis === 'z' ? f.inner : [q.s0, q.s1];
      slabs.push(hullBox(x[0], x[1], q.y0, q.y1, z[0], z[1], `${key}:wall`));
    }
  }
  return slabs;
}

// octagonal dressing of a tube-like room (corridor legs, passages, tunnel):
// four chamfer prisms along the long edges and a rib ring every 1.2 m. Visual
// only. Built in the interior frame from the room's AABB.
function tubeDress(b, along) {
  const c = 0.3, ribEvery = 1.2, ribT = 0.12, ribD = 0.1;
  const geoms = [];
  const w = b.max.x - b.min.x - 2 * T;
  const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2, y0 = b.min.y, y1 = b.max.y;
  const len = along === 'z' ? (b.max.z - b.min.z) : (b.max.x - b.min.x);
  const innerW = along === 'z' ? w : (b.max.z - b.min.z - 2 * T);
  // one shape per corner (no mirroring: a negative scale would turn the
  // faces inside out and the front-side material would cull them)
  const corners = [
    { u: -innerW / 2, v: y0, su: 1, sv: 1 }, { u: innerW / 2, v: y0, su: -1, sv: 1 },
    { u: -innerW / 2, v: y1, su: 1, sv: -1 }, { u: innerW / 2, v: y1, su: -1, sv: -1 },
  ];
  for (const k of corners) {
    const tri = new THREE.Shape([new THREE.Vector2(k.u, k.v), new THREE.Vector2(k.u + k.su * c, k.v), new THREE.Vector2(k.u, k.v + k.sv * c)]);
    const g = new THREE.ExtrudeGeometry(tri, { depth: len, bevelEnabled: false });
    g.translate(0, 0, -len / 2);
    geoms.push(g);
  }
  const n = Math.floor(len / ribEvery);
  const start = -((n - 1) * ribEvery) / 2;
  const bar = (u0, v0, u1, v1) => {
    const L = Math.hypot(u1 - u0, v1 - v0);
    const g = new THREE.BoxGeometry(L, ribT, ribD);
    g.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.atan2(v1 - v0, u1 - u0)));
    g.translate((u0 + u1) / 2, (v0 + v1) / 2, 0);
    return g;
  };
  const hw = innerW / 2, off = ribT / 2;
  const pts = [
    [-hw + c, y0 + off], [hw - c, y0 + off], [hw - off, y0 + c], [hw - off, y1 - c],
    [hw - c, y1 - off], [-hw + c, y1 - off], [-hw + off, y1 - c], [-hw + off, y0 + c],
  ];
  for (let i = 0; i < n; i++) {
    const s = start + i * ribEvery;
    for (let k = 0; k < 8; k++) {
      const p = pts[k], q = pts[(k + 1) % 8];
      const g = bar(p[0], p[1], q[0], q[1]);
      g.translate(0, 0, s);
      geoms.push(g);
    }
  }
  const merged = mergeGeometries(geoms.map(g => (g.index ? g.toNonIndexed() : g)), false);
  const m = new THREE.Matrix4();
  if (along === 'x') m.makeRotationY(Math.PI / 2);
  merged.applyMatrix4(m);
  merged.translate(cx, 0, cz);
  return merged;
}

// a bar of square section w along the segment a -> b (interior frame)
function barBetween(a, b, w) {
  const d = new THREE.Vector3().subVectors(b, a), L = d.length();
  const g = new THREE.BoxGeometry(L + w, w, w);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), d.normalize());
  g.applyQuaternion(q);
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

// The cupola seen from inside: ring hexagon (radius CUPOLA.radius at ringY),
// top hexagon (topRadius at ringY + height), six trapezoid panes between,
// one hexagonal top pane, frames on every edge. Returns { panes, frames }.
function cupolaInterior(wc) {
  const R = CUPOLA.radius, r = CUPOLA_INTERIOR.topRadius, y0 = CUPOLA.ringY, y1 = CUPOLA.ringY + CUPOLA.height;
  const ring = [], top = [];
  for (let k = 0; k < 6; k++) {
    const a = k * Math.PI / 3;        // vertices on +-X and at 60 degrees: the seat looks aft through a pane's middle
    ring.push(new THREE.Vector3(wc.x + R * Math.cos(a), y0, wc.z + R * Math.sin(a)));
    top.push(new THREE.Vector3(wc.x + r * Math.cos(a), y1, wc.z + r * Math.sin(a)));
  }
  // panes
  const pos = [];
  const tri = (a, b, c) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let k = 0; k < 6; k++) {
    const k2 = (k + 1) % 6;
    tri(ring[k], ring[k2], top[k2]); tri(ring[k], top[k2], top[k]);
  }
  const centre = new THREE.Vector3(wc.x, y1, wc.z);
  for (let k = 0; k < 6; k++) tri(centre, top[k], top[(k + 1) % 6]);
  const paneGeom = new THREE.BufferGeometry();
  paneGeom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  paneGeom.computeVertexNormals();
  boxUV(paneGeom);
  // frames
  const w = CUPOLA_INTERIOR.frameWidth;
  const bars = [];
  for (let k = 0; k < 6; k++) {
    const k2 = (k + 1) % 6;
    bars.push(barBetween(ring[k], ring[k2], w), barBetween(top[k], top[k2], w), barBetween(ring[k], top[k], w));
  }
  const frameGeom = mergeGeometries(bars.map(g => g.toNonIndexed()), false);
  return { paneGeom, frameGeom };
}

// The depth-only hull body (OCCLUDER in hull_frame.js): a cap in the plan
// outline at topY with the well cut out of it, and a skirt down the outline
// to bottomY. Deliberately no bottom and no wall around the hole: an extruded
// shape puts one there, and that wall stood as an invisible depth cylinder in
// the middle of the hold, swallowing everything behind it (space showed
// through, 02.09.2026). The well tube itself is the wall of the hole.
function buildOccluder() {
  const pts = hullOutline();
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z)));
  const hole = new THREE.Path();
  hole.absarc(WELL.x, WELL.z, OCCLUDER.holeRadius, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const cap = new THREE.ShapeGeometry(shape, 24);
  // shape (X, Y) is hull (x, z) at y = topY; hull -> interior mirrors x and z
  cap.applyMatrix4(new THREE.Matrix4().set(
    -1, 0, 0, 0,
    0, 0, 1, OCCLUDER.topY,
    0, -1, 0, 0,
    0, 0, 0, 1));
  const pos = [];
  const y0 = OCCLUDER.bottomY, y1 = OCCLUDER.topY;
  for (let i = 0; i < pts.length; i++) {
    const a = hullToInterior(pts[i][0], 0, pts[i][1]), b = hullToInterior(pts[(i + 1) % pts.length][0], 0, pts[(i + 1) % pts.length][1]);
    pos.push(a.x, y0, a.z, b.x, y0, b.z, b.x, y1, b.z, a.x, y0, a.z, b.x, y1, b.z, a.x, y1, a.z);
  }
  const skirt = new THREE.BufferGeometry();
  skirt.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const mat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
  const g = new THREE.Group();
  g.name = 'hullOccluder';
  for (const geom of [cap, skirt]) {
    const m = new THREE.Mesh(geom, mat);
    m.renderOrder = -10;          // depth first, so the slabs behind it are never even shaded
    g.add(m);
  }
  return g;
}

// A generated scratch-and-dust normal map for the cupola glass: flat blue with
// a few hundred hairline scratches and dust specks, 512 px, tiled once per pane
// metre through the box UVs. Strength comes from CUPOLA_INTERIOR.scratchStrength.
function scratchNormalMap() {
  const N = 512, c = document.createElement('canvas'); c.width = c.height = N;
  const x = c.getContext('2d');
  x.fillStyle = 'rgb(128,128,255)'; x.fillRect(0, 0, N, N);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  x.lineWidth = 1;
  for (let i = 0; i < 260; i++) {
    const a = rnd() * Math.PI, L = 20 + rnd() * 160, px = rnd() * N, py = rnd() * N;
    const nx = Math.round(128 + Math.cos(a + Math.PI / 2) * 40), ny = Math.round(128 + Math.sin(a + Math.PI / 2) * 40);
    x.strokeStyle = `rgba(${nx},${ny},255,${0.35 + rnd() * 0.4})`;
    x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * L, py + Math.sin(a) * L); x.stroke();
  }
  for (let i = 0; i < 900; i++) {
    x.fillStyle = `rgba(${Math.round(100 + rnd() * 56)},${Math.round(100 + rnd() * 56)},255,0.5)`;
    x.fillRect(rnd() * N, rnd() * N, 1, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 1);
  return t;
}

export function buildDeck(interiorScene) {
  const group = new THREE.Group();
  group.name = 'deck';
  const solids = [];
  const doors = doorways();
  const rooms = {};
  group.add(buildOccluder());

  // geometry sinks: one merged mesh per material
  const parts = new Map();
  const add = (geom, matKey, make, flags = {}) => {
    if (!parts.has(matKey)) parts.set(matKey, { mat: make(), geoms: [], flags });
    parts.get(matKey).geoms.push(boxUV(geom.index ? geom.toNonIndexed() : geom));
  };
  const roomMat = (key, part) => {
    const [set, tint, tile] = LOOK[key][part];
    return [`${part}:${set}:${tint}:${tile || ''}`, () => surface(set, { tint, tile, grime: part === 'floor' ? 0.5 : 0.6 })];
  };

  for (const [key, r] of Object.entries(ROOMS)) {
    rooms[key] = roomBox(r, key);
    for (const s of wallSlabs(key, r, doors)) { solids.push(s); add(boxGeom(s), ...roomMat(key, 'wall')); }
    const floor = hullBox(r.x[0], r.x[1], r.floorY - T, r.floorY, r.z[0], r.z[1], `${key}:floor`);
    // only the hold floor lies under the well: the sun's 6 x 6 m shadow frustum
    // reaches nothing else, and a receiving material pays the PCF taps per pixel
    solids.push(floor); add(boxGeom(floor), ...roomMat(key, 'floor'), { receive: key === 'hold' });
    const ceil = hullBox(r.x[0], r.x[1], r.ceilY, r.ceilY + T, r.z[0], r.z[1], `${key}:ceil`);
    solids.push(ceil);
    if (key !== 'hold') add(boxGeom(ceil), ...roomMat(key, 'ceil'));   // the hold ceiling is the shape with the well hole below
    if (key.startsWith('corridor') || key.startsWith('passage') || key === 'tunnel') {
      const along = (key === 'corridorAft' || key === 'corridorFwd') ? 'x' : 'z';
      add(tubeDress(rooms[key], along), 'rib', FIXED.rib);
    }
  }

  // hold ceiling with the well hole, and the well tube up to the cupola ring
  const wc = hullToInterior(WELL.x, 0, WELL.z);
  {
    const h = ROOMS.hold, b = rooms.hold;
    const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
    const shape = new THREE.Shape();
    shape.moveTo(b.min.x - cx, b.min.z - cz); shape.lineTo(b.max.x - cx, b.min.z - cz);
    shape.lineTo(b.max.x - cx, b.max.z - cz); shape.lineTo(b.min.x - cx, b.max.z - cz); shape.closePath();
    const hole = new THREE.Path();
    hole.absarc(wc.x - cx, wc.z - cz, WELL.radius, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const g = new THREE.ShapeGeometry(shape, SEGS);
    g.rotateX(Math.PI / 2);
    g.translate(cx, h.ceilY, cz);
    add(g, ...roomMat('hold', 'ceil'));
    const wellH = WELL.topY - WELL.bottomY;
    const tube = new THREE.CylinderGeometry(WELL.radius, WELL.radius, wellH, SEGS, 1, true);
    tube.translate(wc.x, (WELL.bottomY + WELL.topY) / 2, wc.z);
    add(tube, 'well', FIXED.well, { receive: true });
  }

  // steps up to the cockpit
  for (const s of STEPS) {
    const b = hullBox(s.x[0], s.x[1], s.bottomY, s.topY, s.z[0], s.z[1], 'step');
    solids.push(b); add(boxGeom(b), 'step', FIXED.step);
  }

  // the ladder: a thin solid from the hold floor up into the well, rungs every LADDER.rungPitch
  const ladder = hullBox(LADDER.x - LADDER.width / 2, LADDER.x + LADDER.width / 2, LADDER.bottomY, LADDER.topY,
    LADDER.z - LADDER.depth, LADDER.z, 'ladder');
  solids.push({ ...ladder, max: { ...ladder.max, y: ROOMS.hold.ceilY } });   // only the hold part blocks walking
  {
    const lc = hullToInterior(LADDER.x, 0, LADDER.z - LADDER.depth / 2);
    const rail = (dx) => { const g = new THREE.BoxGeometry(0.04, LADDER.topY - LADDER.bottomY, 0.04); g.translate(lc.x + dx, (LADDER.topY + LADDER.bottomY) / 2, lc.z); return g; };
    add(rail(-LADDER.width / 2 + 0.02), 'ladder', FIXED.ladder, { cast: true });
    add(rail(LADDER.width / 2 - 0.02), 'ladder', FIXED.ladder, { cast: true });
    for (let y = LADDER.bottomY + LADDER.rungPitch; y < LADDER.topY; y += LADDER.rungPitch) {
      const g = new THREE.BoxGeometry(LADDER.width - 0.08, 0.03, 0.03); g.translate(lc.x, y, lc.z);
      add(g, 'ladder', FIXED.ladder, { cast: true });
    }
  }

  // seats: pan and backrest, the pan is a solid
  const seats = {};
  for (const [key, s] of Object.entries(SEATS)) {
    const panY = s.floorY + 0.45;
    const pan = hullBox(s.x - s.width / 2, s.x + s.width / 2, s.floorY, panY, s.z - s.depth / 2, s.z + s.depth / 2, `seat:${key}`);
    solids.push(pan); add(boxGeom(pan), 'seat', FIXED.seat, { cast: true });
    const back = s.facing === 0 ? [s.z - s.depth / 2 - 0.06, s.z - s.depth / 2] : [s.z + s.depth / 2, s.z + s.depth / 2 + 0.06];
    add(boxGeom(hullBox(s.x - s.width / 2, s.x + s.width / 2, panY, panY + 0.55, back[0], back[1])), 'seat', FIXED.seat, { cast: true });
    const eye = hullToInterior(s.x, s.floorY + WALK.seatedEye, s.z);
    const stand = s.standAt ? hullToInterior(s.standAt.x, s.floorY, s.standAt.z) : null;
    seats[key] = { ...s, eye, stand, yaw0: s.facing, pan };
  }

  // the cupola: platform with the ladder gap, handrail, frames, panes
  {
    const P = CUPOLA_INTERIOR.platform;
    const shape = new THREE.Shape();
    shape.absarc(0, 0, WELL.radius - 0.02, 0, Math.PI * 2, false);
    // the ladder climbs the well's fore wall: hull +Z is interior -Z
    const gap = new THREE.Path();
    const gz0 = -(WELL.radius - 0.02), gz1 = gz0 + P.ladderGap.depth, gx = P.ladderGap.width / 2;
    gap.moveTo(-gx, gz0); gap.lineTo(gx, gz0); gap.lineTo(gx, gz1); gap.lineTo(-gx, gz1); gap.closePath();
    shape.holes.push(gap);
    const plate = new THREE.ExtrudeGeometry(shape, { depth: P.thickness, bevelEnabled: false });
    plate.rotateX(Math.PI / 2);                 // shape XY -> XZ, extruded downward
    plate.translate(wc.x, P.y, wc.z);
    add(plate, 'platform', FIXED.platform, { cast: true, receive: true });

    const H = CUPOLA_INTERIOR.handrail;
    const rail = new THREE.TorusGeometry(H.radius, H.tube, 8, 48, Math.PI * 2 - H.gap);
    rail.rotateZ(Math.PI / 2 + H.gap / 2);      // gap centred on -Z (the ladder side) after the flip below
    rail.rotateX(-Math.PI / 2);
    rail.translate(wc.x, H.y, wc.z);
    add(rail, 'handrail', FIXED.handrail, { cast: true });

    const { paneGeom, frameGeom } = cupolaInterior(wc);
    add(frameGeom, 'frame', FIXED.frame, { cast: true });
    // Additive glass: black diffuse, so the pane ADDS its reflections and
    // highlights to the space image and never tints it (a normal-blended
    // pane at 10 % opacity laid a 0.22 grey over the sky, at 2 % still 0.06,
    // measured 02.09.2026). The environment it reflects is set by lighting.js
    // (scene environment at LIGHTING.glassEnv, the studio map would be 0.09
    // of grey sky at the scene's own intensity). Lamps and the sun make the
    // highlights; the scratch map breaks them up.
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0x000000, roughness: CUPOLA_INTERIOR.paneRoughness, metalness: 0, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
      normalMap: scratchNormalMap(), normalScale: new THREE.Vector2(CUPOLA_INTERIOR.scratchStrength, CUPOLA_INTERIOR.scratchStrength),
    });
    glass.defines = { [SOFT_TERMINATOR]: '' };
    const panes = new THREE.Mesh(paneGeom, glass);
    panes.name = 'cupolaPanes';
    panes.renderOrder = 10;
    group.add(panes);
  }

  // the drive core: a cylinder, its square footprint as a solid
  {
    const cc = hullToInterior(CORE.x, 0, CORE.z);
    const g = new THREE.CylinderGeometry(CORE.radius, CORE.radius, CORE.topY - CORE.floorY, 32);
    g.translate(cc.x, (CORE.topY + CORE.floorY) / 2, cc.z);
    const m = new THREE.Mesh(g, plain({ color: 0x1a1d20, metalness: 0.3, roughness: 0.6, emissive: 0x0c2a44, emissiveIntensity: 0.25 }));   // M3.4 dresses it
    m.name = 'core';
    group.add(m);
    solids.push(hullBox(CORE.x - CORE.radius, CORE.x + CORE.radius, CORE.floorY, CORE.topY, CORE.z - CORE.radius, CORE.z + CORE.radius, 'core'));
  }

  let triangles = 0;
  for (const [k, part] of parts) {
    const m = new THREE.Mesh(mergeGeometries(part.geoms, false), part.mat);
    m.name = k;
    m.castShadow = !!part.flags.cast;
    m.receiveShadow = !!part.flags.receive;
    triangles += m.geometry.attributes.position.count / 3;
    group.add(m);
  }

  const ladderInfo = {
    foot: hullToInterior(LADDER.x, LADDER.bottomY, LADDER.z - LADDER.standoff),
    top: hullToInterior(LADDER.x, LADDER.topY, LADDER.z - LADDER.standoff),
    yaw: 0,   // climber faces the rungs, hull +Z = interior -Z
  };
  const spawn = { ...hullToInterior(SPAWN.x, SPAWN.floorY, SPAWN.z), yaw: SPAWN.yaw };
  const cupolaEye = hullToInterior(CUPOLA.x, CUPOLA.eyeY, CUPOLA.z);

  interiorScene.add(group);
  return { group, solids, rooms, doors, seats, ladder: ladderInfo, spawn, cupolaEye, triangles: Math.round(triangles), materials: parts.size };
}
