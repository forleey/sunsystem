// The deck (M1): shell boxes for walking and untextured room shells for
// looking, both generated from the room table in hull_frame.js. Nothing in
// here carries a number of its own except colours and sample counts.
//
// Two lists come out of buildDeck():
//   solids  axis-aligned boxes in INTERIOR metres that the walk capsule
//           collides with: every wall, floor and ceiling slab (with the
//           doorways cut out), the steps, the ladder, the seats, the core.
//   group   the meshes. Visual meshes never enter the solid list; the slab
//           meshes are the same boxes as the slab solids, which is what makes
//           the untextured shell watertight by construction.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  ROOMS, WELL, CUPOLA, SHELL, STEPS, LADDER, SEATS, CORE, SPAWN, WALK, doorways, hullToInterior,
} from './hull_frame.js?v=102';

const T = SHELL.thickness;
const SEGS = 48;
const rough = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.05, ...extra });
const MAT = {
  wall: rough(0x5a5f66),
  floor: rough(0x33363b),
  ceil: rough(0x474b52),
  rib: rough(0x2b2e33, { metalness: 0.4, roughness: 0.6 }),
  well: rough(0x4a4f56, { side: THREE.BackSide }),
  seat: rough(0x3a3f46),
  ladder: rough(0x8a8f96, { metalness: 0.6, roughness: 0.5 }),
  step: rough(0x3d4046),
  core: rough(0x1e2a36, { metalness: 0.5, roughness: 0.4, emissive: 0x2a6a9a, emissiveIntensity: 0.6 }),
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
  const w = b.max.x - b.min.x - 2 * T, h = b.max.y - b.min.y;   // inner width (walls are inside the room), full height (floor/ceiling slabs sit outside)
  const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2, y0 = b.min.y, y1 = b.max.y;
  const len = along === 'z' ? (b.max.z - b.min.z) : (b.max.x - b.min.x);
  const innerW = along === 'z' ? w : (b.max.z - b.min.z - 2 * T);
  // chamfer prism: right triangle with legs c, extruded along the tube
  const tri = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(c, 0), new THREE.Vector2(0, c)]);
  const prism = new THREE.ExtrudeGeometry(tri, { depth: len, bevelEnabled: false });
  prism.translate(0, 0, -len / 2);
  // corners in the tube's cross-section (u across, v up), triangle pointing into the room
  const corners = [
    { u: -innerW / 2, v: y0, su: 1, sv: 1 }, { u: innerW / 2, v: y0, su: -1, sv: 1 },
    { u: -innerW / 2, v: y1, su: 1, sv: -1 }, { u: innerW / 2, v: y1, su: -1, sv: -1 },
  ];
  for (const k of corners) {
    const g = prism.clone();
    g.scale(k.su, k.sv, 1);
    g.translate(k.u, k.v, 0);
    geoms.push(g);
  }
  // rib rings: 4 straight bars + 4 diagonal bars, cross-section ribT x ribD
  const n = Math.floor(len / ribEvery);
  const start = -((n - 1) * ribEvery) / 2;
  const bar = (u0, v0, u1, v1) => {
    const L = Math.hypot(u1 - u0, v1 - v0);
    const g = new THREE.BoxGeometry(L, ribT, ribD);
    const m = new THREE.Matrix4().makeRotationZ(Math.atan2(v1 - v0, u1 - u0));
    g.applyMatrix4(m);
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
  // the prisms are non-indexed and the bars indexed: mergeGeometries wants one kind
  const merged = mergeGeometries(geoms.map(g => (g.index ? g.toNonIndexed() : g)), false);
  // the tube geometry runs along local Z; turn it for legs that run along X
  const m = new THREE.Matrix4();
  if (along === 'x') m.makeRotationY(Math.PI / 2);
  merged.applyMatrix4(m);
  merged.translate(cx, 0, cz);
  return merged;
}

export function buildDeck(interiorScene) {
  const group = new THREE.Group();
  group.name = 'deck';
  const solids = [];
  const doors = doorways();
  const rooms = {};
  const visual = { wall: [], floor: [], ceil: [], rib: [], step: [], seat: [], ladder: [] };

  for (const [key, r] of Object.entries(ROOMS)) {
    rooms[key] = roomBox(r, key);
    for (const s of wallSlabs(key, r, doors)) { solids.push(s); visual.wall.push(boxGeom(s)); }
    const floor = hullBox(r.x[0], r.x[1], r.floorY - T, r.floorY, r.z[0], r.z[1], `${key}:floor`);
    solids.push(floor); visual.floor.push(boxGeom(floor));
    const ceil = hullBox(r.x[0], r.x[1], r.ceilY, r.ceilY + T, r.z[0], r.z[1], `${key}:ceil`);
    solids.push(ceil);
    if (key !== 'hold') visual.ceil.push(boxGeom(ceil));   // the hold ceiling is the shape with the well hole below
    if (key.startsWith('corridor') || key.startsWith('passage') || key === 'tunnel') {
      const along = (key === 'corridorAft' || key === 'corridorFwd') ? 'x' : 'z';
      visual.rib.push(tubeDress(rooms[key], along));
    }
  }

  // hold ceiling with the well hole: a flat shape whose underside faces the hold
  {
    const h = ROOMS.hold, b = rooms.hold, wc = hullToInterior(WELL.x, 0, WELL.z);
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
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x474b52, roughness: 0.9, side: THREE.DoubleSide }));
    m.name = 'holdCeiling';
    group.add(m);
    // the well tube, open at both ends, from the hold ceiling to the cupola ring
    const wellH = WELL.topY - WELL.bottomY;
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(WELL.radius, WELL.radius, wellH, SEGS, 1, true), MAT.well);
    tube.position.set(wc.x, (WELL.bottomY + WELL.topY) / 2, wc.z);
    tube.name = 'well';
    group.add(tube);
  }

  // steps up to the cockpit
  for (const s of STEPS) {
    const b = hullBox(s.x[0], s.x[1], s.bottomY, s.topY, s.z[0], s.z[1], 'step');
    solids.push(b); visual.step.push(boxGeom(b));
  }

  // the ladder: a thin solid from the hold floor up into the well, rungs every LADDER.rungPitch
  const ladder = hullBox(LADDER.x - LADDER.width / 2, LADDER.x + LADDER.width / 2, LADDER.bottomY, LADDER.topY,
    LADDER.z - LADDER.depth, LADDER.z, 'ladder');
  solids.push({ ...ladder, max: { ...ladder.max, y: ROOMS.hold.ceilY } });   // only the hold part blocks walking
  {
    const lc = hullToInterior(LADDER.x, 0, LADDER.z - LADDER.depth / 2);
    const rail = (dx) => { const g = new THREE.BoxGeometry(0.04, LADDER.topY - LADDER.bottomY, 0.04); g.translate(lc.x + dx, (LADDER.topY + LADDER.bottomY) / 2, lc.z); return g; };
    visual.ladder.push(rail(-LADDER.width / 2 + 0.02), rail(LADDER.width / 2 - 0.02));
    for (let y = LADDER.bottomY + LADDER.rungPitch; y < LADDER.topY; y += LADDER.rungPitch) {
      const g = new THREE.BoxGeometry(LADDER.width - 0.08, 0.03, 0.03); g.translate(lc.x, y, lc.z); visual.ladder.push(g);
    }
  }

  // seats: pan and backrest, the pan is a solid
  const seats = {};
  for (const [key, s] of Object.entries(SEATS)) {
    const panY = s.floorY + 0.45;
    const pan = hullBox(s.x - s.width / 2, s.x + s.width / 2, s.floorY, panY, s.z - s.depth / 2, s.z + s.depth / 2, `seat:${key}`);
    solids.push(pan); visual.seat.push(boxGeom(pan));
    // backrest on the side the seat faces away from (hull yaw: facing 0 = +Z nose)
    const back = s.facing === 0 ? [s.z - s.depth / 2 - 0.06, s.z - s.depth / 2] : [s.z + s.depth / 2, s.z + s.depth / 2 + 0.06];
    visual.seat.push(boxGeom(hullBox(s.x - s.width / 2, s.x + s.width / 2, panY, panY + 0.55, back[0], back[1])));
    const eye = hullToInterior(s.x, s.floorY + WALK.seatedEye, s.z);
    const stand = s.standAt ? hullToInterior(s.standAt.x, s.floorY, s.standAt.z) : null;
    // hull yaw -> interior yaw: the interior frame is the hull frame turned half a turn about Y, so facing 0 (nose) is interior -Z, yaw 0
    seats[key] = { ...s, eye, stand, yaw0: s.facing, pan };
  }

  // the drive core: a cylinder, its square footprint as a solid
  {
    const cc = hullToInterior(CORE.x, 0, CORE.z);
    const g = new THREE.CylinderGeometry(CORE.radius, CORE.radius, CORE.topY - CORE.floorY, 32);
    g.translate(cc.x, (CORE.topY + CORE.floorY) / 2, cc.z);
    const m = new THREE.Mesh(g, MAT.core); m.name = 'core';
    group.add(m);
    solids.push(hullBox(CORE.x - CORE.radius, CORE.x + CORE.radius, CORE.floorY, CORE.topY, CORE.z - CORE.radius, CORE.z + CORE.radius, 'core'));
  }

  for (const [k, list] of Object.entries(visual)) {
    if (!list.length) continue;
    const m = new THREE.Mesh(mergeGeometries(list, false), MAT[k]);
    m.name = k;
    group.add(m);
  }

  // M1 light: one warm practical per major room and a flat fill so the grey
  // shells read; lighting.js (M2) replaces this
  group.add(new THREE.AmbientLight(0x9aa4b0, 0.55));
  const lamp = (room, intensity, dist, dy = 0.4) => {
    const b = rooms[room];
    const l = new THREE.PointLight(0xffe2c0, intensity, dist, 2);
    l.position.set((b.min.x + b.max.x) / 2, b.max.y - dy, (b.min.z + b.max.z) / 2);
    group.add(l);
  };
  lamp('hold', 60, 30); lamp('engineering', 45, 24); lamp('cockpit', 20, 14);
  lamp('bunks', 12, 10); lamp('airlock', 10, 9); lamp('corridorFwd', 22, 18); lamp('corridorAft', 22, 18);

  const ladderInfo = {
    foot: hullToInterior(LADDER.x, LADDER.bottomY, LADDER.z - LADDER.standoff),
    top: hullToInterior(LADDER.x, LADDER.topY, LADDER.z - LADDER.standoff),
    yaw: 0,   // climber faces the rungs, hull +Z = interior -Z
  };
  const spawn = { ...hullToInterior(SPAWN.x, SPAWN.floorY, SPAWN.z), yaw: SPAWN.yaw };
  const cupolaEye = hullToInterior(CUPOLA.x, CUPOLA.eyeY, CUPOLA.z);

  interiorScene.add(group);
  return { group, solids, rooms, doors, seats, ladder: ladderInfo, spawn, cupolaEye };
}
