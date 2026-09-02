// Unit check for js/interior/hull_frame.js: every room box has to sit inside
// the hull envelope of the design spec section 5 over its whole Z range. The
// cupola well is the one exception and is checked separately (it pierces the
// top skin by design). Run: node tools/hull_frame_check.mjs
import {
  ROOMS, WELL, CUPOLA, ENVELOPE, RIDGE, envelopeAt, hullToInterior, M_TO_KM,
  DECK_ANCHOR_KM, TOP_SKIN_AT_CUPOLA, TOP_SKIN_AT_RING, CUPOLA_GLASS, railPointHull, POSES,
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

if (fails.length) {
  for (const f of fails) console.error('FAIL ' + f);
  process.exit(1);
}
console.log(`HULLFRAME result=PASS ${rooms} rooms inside the section 5 envelope, ${pairs} room pairs without shared volume, well 1.8 m at the cupola, ring at +${CUPOLA.ringY} m on skin +${TOP_SKIN_AT_CUPOLA}, ${ENVELOPE.length} envelope rows, glass collar ${CUPOLA_GLASS.collar.bottomY} to ${CUPOLA_GLASS.collar.topY} on skin ${TOP_SKIN_AT_RING}`);
