// Unit check for js/interior/hull_frame.js: every room box has to sit inside
// the hull envelope of the design spec section 5 over its whole Z range. The
// cupola well is the one exception and is checked separately (it pierces the
// top skin by design). Run: node tools/hull_frame_check.mjs
import {
  ROOMS, WELL, CUPOLA, ENVELOPE, RIDGE, envelopeAt, hullToInterior, M_TO_KM,
  DECK_ANCHOR_KM, TOP_SKIN_AT_CUPOLA, TOP_SKIN_AT_RING, CUPOLA_GLASS, railPointHull, POSES,
  WALK, DOOR, STEPS, LADDER, SEATS, CORE, SPAWN, SHELL, doorways,
} from '../js/interior/hull_frame.js';

const EPS = 1e-6;
const fails = [];
const fail = (m) => fails.push(m);
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

// walk the room's Z range in 0.25 m steps (plus both ends, nudged inward: a
// room flush with a row border belongs to its own row, not the neighbour) and
// take the worst envelope it ever sees at its outermost X: a room crossing a
// row border is checked in both rows.
function worstEnvelope(z0, z1, absX) {
  const zs = [z0 + EPS, z1 - EPS];
  for (let z = z0 + EPS; z < z1; z += 0.25) zs.push(z);
  let halfWidth = Infinity, topY = Infinity, bottomY = -Infinity, region = null;
  for (const z of zs) {
    const e = envelopeAt(z, absX);
    if (e.halfWidth < halfWidth) { halfWidth = e.halfWidth; region = e.region; }
    topY = Math.min(topY, e.topY);
    bottomY = Math.max(bottomY, e.bottomY);
  }
  return { halfWidth, topY, bottomY, region };
}

let rooms = 0;
for (const [key, r] of Object.entries(ROOMS)) {
  rooms++;
  const maxAbsX = Math.max(Math.abs(r.x[0]), Math.abs(r.x[1]));
  const e = worstEnvelope(r.z[0], r.z[1], maxAbsX);
  const label = `${key} (${r.name})`;
  if (e.region === null || !(e.halfWidth > 0)) fail(`${label}: Z ${r.z} leaves the decked hull`);
  if (r.z[0] >= r.z[1]) fail(`${label}: empty Z range`);
  if (r.x[0] >= r.x[1]) fail(`${label}: empty X range`);
  if (r.floorY >= r.ceilY) fail(`${label}: ceiling not above floor`);
  if (maxAbsX > e.halfWidth + EPS) fail(`${label}: |X| ${maxAbsX} > half width ${e.halfWidth.toFixed(2)} (${e.region})`);
  if (r.ceilY > e.topY + EPS) fail(`${label}: ceiling ${r.ceilY} above top skin ${e.topY.toFixed(2)} at |X| ${maxAbsX} (${e.region})`);
  if (r.floorY < e.bottomY - EPS) fail(`${label}: floor ${r.floorY} below hull bottom ${e.bottomY.toFixed(2)} (${e.region})`);
}

// no two rooms may share volume. Shared faces (the four corridor legs meet
// at their ends, bunks and airlock lean on the fore leg) are touching, not
// overlapping: an interval pair that only meets at one number is allowed.
const boxes = Object.entries(ROOMS);
let pairs = 0;
const spans = (r) => [[r.x[0], r.x[1]], [r.floorY, r.ceilY], [r.z[0], r.z[1]]];
const overlap1 = ([a0, a1], [b0, b1]) => Math.min(a1, b1) - Math.max(a0, b0) > EPS;
for (let i = 0; i < boxes.length; i++) {
  for (let j = i + 1; j < boxes.length; j++) {
    pairs++;
    const [ka, a] = boxes[i], [kb, b] = boxes[j];
    const sa = spans(a), sb = spans(b);
    if (overlap1(sa[0], sb[0]) && overlap1(sa[1], sb[1]) && overlap1(sa[2], sb[2])) {
      fail(`${ka} and ${kb} share volume`);
    }
  }
}

// the envelope rows must tile the deck without gaps or overlaps in Z
const rows = [...ENVELOPE].sort((a, b) => a.z[0] - b.z[0]);
for (let i = 1; i < rows.length; i++) {
  if (!near(rows[i - 1].z[1], rows[i].z[0])) fail(`envelope rows ${rows[i - 1].name} and ${rows[i].name} do not meet in Z`);
}

// the well and the cupola pierce the skin on purpose: only their fixed numbers.
// The ring sits ON the measured skin, the bubble fits the flat of the ridge.
if (!near(WELL.radius, 0.9)) fail(`well radius ${WELL.radius} is not 0.9 (1.8 m opening)`);
if (!near(WELL.topY, CUPOLA.ringY)) fail(`well top ${WELL.topY} is not the cupola ring ${CUPOLA.ringY}`);
if (!near(WELL.bottomY, ROOMS.hold.ceilY)) fail(`well bottom ${WELL.bottomY} is not the hold ceiling ${ROOMS.hold.ceilY}`);
if (CUPOLA.ringY < TOP_SKIN_AT_CUPOLA) fail(`cupola ring ${CUPOLA.ringY} is inside the skin ${TOP_SKIN_AT_CUPOLA}`);
if (CUPOLA.ringY - TOP_SKIN_AT_CUPOLA > 0.1) fail(`cupola ring ${CUPOLA.ringY} floats ${(CUPOLA.ringY - TOP_SKIN_AT_CUPOLA).toFixed(2)} m over the skin`);
if (CUPOLA.z < RIDGE.z[0] || CUPOLA.z > RIDGE.z[1]) fail(`cupola Z ${CUPOLA.z} is off the ridge ${RIDGE.z}`);
if (Math.abs(CUPOLA.x) + CUPOLA.radius > RIDGE.halfWidth + EPS) fail(`cupola radius ${CUPOLA.radius} does not fit the ridge half width ${RIDGE.halfWidth}`);
if (!(WELL.topY - WELL.bottomY > 0)) fail('well has no height');
// the exterior bubble: collar down to the lowest skin at the ring, the disc
// above the highest skin and under the dome, panes inside the ring, seven of them
{
  const g = CUPOLA_GLASS;
  if (g.collar.bottomY > TOP_SKIN_AT_RING[0] + EPS) fail(`glass collar bottom ${g.collar.bottomY} floats over the fore skin ${TOP_SKIN_AT_RING[0]}`);
  if (!near(g.collar.topY, CUPOLA.ringY)) fail('glass collar does not end at the cupola ring');
  if (g.collar.radius < CUPOLA.radius) fail('glass collar is narrower than the ring');
  if (g.disc.y <= TOP_SKIN_AT_RING[1]) fail(`glass disc ${g.disc.y} is under the aft skin ${TOP_SKIN_AT_RING[1]}`);
  if (g.disc.y >= CUPOLA.ringY + CUPOLA.height) fail('glass disc is above the dome');
  if (g.disc.radius >= CUPOLA.radius || g.topRadius >= CUPOLA.radius) fail('glass disc or top pane does not fit inside the ring');
  if (g.sides + 1 !== 7) fail(`cupola has ${g.sides + 1} panes, not seven`);
  if (!(g.frameWidth > 0 && g.frameWidth < 0.2)) fail('glass frame width is off');
}
if (Math.abs(WELL.x - CUPOLA.x) > EPS || Math.abs(WELL.z - CUPOLA.z) > EPS) fail('well and cupola are not on the same axis');
// the well must rise inside the hold footprint, otherwise it opens into vacuum
if (WELL.z - WELL.radius < ROOMS.hold.z[0] || WELL.z + WELL.radius > ROOMS.hold.z[1]
  || WELL.x - WELL.radius < ROOMS.hold.x[0] || WELL.x + WELL.radius > ROOMS.hold.x[1]) {
  fail('well opening is not inside the hold footprint');
}

// frame conversions: hull -> interior mirrors X and Z, the km scale is 1/1000,
// the deck anchor is the hull centre, and the rail runs under the cupola.
{
  const i = hullToInterior(3, 2, -18);
  if (!near(i.x, -3) || !near(i.y, 2) || !near(i.z, 18)) fail('hullToInterior does not mirror X and Z');
  if (!near(M_TO_KM, 0.001)) fail('M_TO_KM is not 1/1000');
  if (DECK_ANCHOR_KM.x || DECK_ANCHOR_KM.y || DECK_ANCHOR_KM.z) fail('deck anchor is not the hull centre');
  const a = railPointHull(0), b = railPointHull(1), m = railPointHull(0.5);
  if (!near(a.x, POSES.rail.from.x) || !near(b.x, POSES.rail.to.x) || !near(m.x, 0)) fail('rail does not run from POSES.rail.from.x to POSES.rail.to.x through 0');
  if (!near(m.z, CUPOLA.z)) fail('rail does not run under the cupola');
  const c = POSES.cupola;
  if (!(c.lookAt.z < c.eye.z && c.lookAt.y < c.eye.y)) fail('cupola pose does not look aft and down');
}

// ---------- M1: doorways, steps, ladder, seats, spawn, poses ----------
const inRoom = (r, x, z) => x >= r.x[0] - EPS && x <= r.x[1] + EPS && z >= r.z[0] - EPS && z <= r.z[1] + EPS;
const roomOf = (x, z) => Object.entries(ROOMS).find(([, r]) => inRoom(r, x, z));
const doors = doorways();
// every room but the hold must be reachable: a graph walk over the doorways
{
  const adj = new Map(Object.keys(ROOMS).map(k => [k, new Set()]));
  for (const d of doors) { adj.get(d.a).add(d.b); adj.get(d.b).add(d.a); }
  const seen = new Set(['hold']), q = ['hold'];
  while (q.length) for (const n of adj.get(q.shift())) if (!seen.has(n)) { seen.add(n); q.push(n); }
  for (const k of Object.keys(ROOMS)) if (!seen.has(k)) fail(`${k} is not reachable from the hold through any doorway`);
}
for (const d of doors) {
  if (d.width < DOOR.minWidth - EPS) fail(`doorway ${d.a}-${d.b} is ${d.width.toFixed(2)} m wide, under ${DOOR.minWidth}`);
  if (d.clear < DOOR.minClear - EPS) fail(`doorway ${d.a}-${d.b} clears ${d.clear.toFixed(2)} m, under ${DOOR.minClear.toFixed(2)}`);
  // the walkable width inside the slabs must hold the capsule on both sides
  for (const k of [d.a, d.b]) {
    const r = ROOMS[k], span = d.axis === 'x' ? 'z' : 'x';
    if (r[span][1] - r[span][0] - 2 * SHELL.thickness < 2 * WALK.radius + 0.1) fail(`${k} is too narrow for the capsule`);
  }
}
// no wall is thinner than the shell allows around a door
if (DOOR.margin < SHELL.thickness - EPS) fail('door margin under the slab thickness leaves a sliver of wall');
// the steps: each tread within the step height of the one below, the top tread level with the cockpit floor
{
  const treads = [ROOMS.tunnel.floorY, ...STEPS.map(s => s.topY)];
  for (let i = 1; i < treads.length; i++) if (treads[i] - treads[i - 1] > WALK.step + EPS) fail(`step ${i} rises ${(treads[i] - treads[i - 1]).toFixed(2)}, over ${WALK.step}`);
  if (!near(treads[treads.length - 1], ROOMS.cockpit.floorY)) fail('top step is not level with the cockpit floor');
  for (const s of STEPS) if (!inRoom(ROOMS.tunnel, s.x[0], s.z[0]) || !inRoom(ROOMS.tunnel, s.x[1], s.z[1])) fail('a step lies outside the tunnel');
  const clearOverTop = ROOMS.tunnel.ceilY - ROOMS.cockpit.floorY;
  if (clearOverTop < WALK.height + 0.1) fail(`only ${clearOverTop.toFixed(2)} m over the top step`);
}
// the ladder stands in the hold at the fore edge of the well and ends at the seat platform
{
  if (!inRoom(ROOMS.hold, LADDER.x, LADDER.z)) fail('ladder is not in the hold');
  if (Math.abs(LADDER.z - WELL.z) > WELL.radius + EPS) fail('ladder is outside the well opening');
  const climber = LADDER.z - LADDER.standoff;
  if (Math.hypot(climber - WELL.z, LADDER.x - WELL.x) + WALK.radius > WELL.radius + EPS) fail('climber does not fit inside the well');
  if (!near(LADDER.bottomY, ROOMS.hold.floorY)) fail('ladder does not start on the hold floor');
  if (!near(LADDER.topY, CUPOLA.platformY)) fail('ladder does not end at the seat platform');
  if (!(CUPOLA.platformY < CUPOLA.ringY && CUPOLA.platformY > WELL.bottomY)) fail('seat platform is not inside the well');
  if (!(CUPOLA.eyeY > CUPOLA.ringY && CUPOLA.eyeY < CUPOLA.ringY + CUPOLA.height - 0.2)) fail(`seated eye ${CUPOLA.eyeY} is not between the ring and the dome`);
  if (!near(CUPOLA.eyeY, CUPOLA.platformY + WALK.seatedEye)) fail('seated eye is not WALK.seatedEye over the platform');
  if (!near(SEATS.cupola.floorY, CUPOLA.platformY)) fail('cupola seat is not on the platform');
}
// walk-in seats stand in a room, with their stand point in the same room; the spawn stands in the hold
for (const [k, s] of Object.entries(SEATS)) {
  if (s.reachedByLadder) continue;
  const r = roomOf(s.x, s.z);
  if (!r) fail(`seat ${k} is outside every room`);
  else if (!near(r[1].floorY, s.floorY)) fail(`seat ${k} floats over the ${r[0]} floor`);
  if (s.standAt && (!roomOf(s.standAt.x, s.standAt.z) || roomOf(s.standAt.x, s.standAt.z)[0] !== (r && r[0]))) fail(`seat ${k} stand point is not in its room`);
}
if (!roomOf(CORE.x, CORE.z) || roomOf(CORE.x, CORE.z)[0] !== 'engineering') fail('core is not in engineering');
if (!inRoom(ROOMS.engineering, CORE.x - CORE.radius, CORE.z - CORE.radius) || !inRoom(ROOMS.engineering, CORE.x + CORE.radius, CORE.z + CORE.radius)) fail('core pokes out of engineering');
if (!roomOf(SPAWN.x, SPAWN.z) || roomOf(SPAWN.x, SPAWN.z)[0] !== 'hold') fail('spawn is not in the hold');
if (Math.hypot(SPAWN.x - LADDER.x, SPAWN.z - LADDER.z) < 2 * WALK.radius + 0.3) fail('spawn stands in the ladder');
// standing poses stand in their named room at eye height; seat poses at the seated eye
let poses = 0;
for (const [k, p] of Object.entries(POSES)) {
  if (k === 'rail') continue;
  poses++;
  if (p.room) {
    const r = ROOMS[p.room];
    if (!inRoom(r, p.eye.x, p.eye.z)) fail(`pose ${k} is outside ${p.room}`);
    if (!near(p.eye.y, r.floorY + WALK.eye)) fail(`pose ${k} eye is not WALK.eye over the floor`);
  } else if (p.seat) {
    const s = SEATS[p.seat];
    if (!near(p.eye.x, s.x) || !near(p.eye.z, s.z) || !near(p.eye.y, s.floorY + WALK.seatedEye)) fail(`pose ${k} is not the ${p.seat} seat's eye`);
  } else fail(`pose ${k} names neither a room nor a seat`);
}

if (fails.length) {
  for (const f of fails) console.error('FAIL ' + f);
  process.exit(1);
}
console.log(`HULLFRAME result=PASS ${rooms} rooms inside the section 5 envelope, ${pairs} room pairs without shared volume, well 1.8 m at the cupola, ring at +${CUPOLA.ringY} m on skin +${TOP_SKIN_AT_CUPOLA}, ${ENVELOPE.length} envelope rows, glass collar ${CUPOLA_GLASS.collar.bottomY} to ${CUPOLA_GLASS.collar.topY} on skin ${TOP_SKIN_AT_RING}, ${doors.length} doorways >= ${DOOR.minWidth} m wide and ${DOOR.minClear.toFixed(1)} m clear, every room reachable, ${STEPS.length} steps <= ${WALK.step} m, ${poses} poses`);
