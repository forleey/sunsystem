// Unit check for js/interior/hull_frame.js: every room box has to sit inside
// the hull envelope of SPEC section 5 over its whole Z range. The cupola well
// is the one exception and is checked separately (it pierces the top skin by
// design). Run: node tools/hull_frame_check.mjs
import {
  ROOMS, WELL, CUPOLA, ENVELOPE, envelopeAt, hullToInterior, hullToLocalKm,
  DECK_ANCHOR_KM, TOP_SKIN_AT_CUPOLA, railPointHull, RAIL,
} from '../js/interior/hull_frame.js';

const EPS = 1e-6;
const fails = [];
const fail = (m) => fails.push(m);
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

// walk the room's Z range in 0.25 m steps (plus both ends) and take the worst
// envelope it ever sees: a room crossing a region border is checked in both.
function worstEnvelope(z0, z1) {
  const zs = [z0, z1];
  for (let z = z0; z < z1; z += 0.25) zs.push(z);
  let halfWidth = Infinity, topY = Infinity, bottomY = -Infinity, region = null;
  for (const z of zs) {
    const e = envelopeAt(z);
    if (e.halfWidth < halfWidth) { halfWidth = e.halfWidth; region = e.region; }
    topY = Math.min(topY, e.topY);
    bottomY = Math.max(bottomY, e.bottomY);
  }
  return { halfWidth, topY, bottomY, region };
}

let rooms = 0;
for (const [key, r] of Object.entries(ROOMS)) {
  rooms++;
  const e = worstEnvelope(r.z[0], r.z[1]);
  const label = `${key} (${r.name})`;
  if (e.region === null || !(e.halfWidth > 0)) fail(`${label}: Z ${r.z} leaves the decked hull`);
  if (r.z[0] >= r.z[1]) fail(`${label}: empty Z range`);
  if (r.x[0] >= r.x[1]) fail(`${label}: empty X range`);
  if (r.floorY >= r.ceilY) fail(`${label}: ceiling not above floor`);
  const maxAbsX = Math.max(Math.abs(r.x[0]), Math.abs(r.x[1]));
  if (maxAbsX > e.halfWidth + EPS) fail(`${label}: |X| ${maxAbsX} > half width ${e.halfWidth.toFixed(2)} (${e.region})`);
  if (r.ceilY > e.topY + EPS) fail(`${label}: ceiling ${r.ceilY} above top skin ${e.topY.toFixed(2)} (${e.region})`);
  if (r.floorY < e.bottomY - EPS) fail(`${label}: floor ${r.floorY} below hull bottom ${e.bottomY.toFixed(2)} (${e.region})`);
}

// the well and the cupola pierce the skin on purpose: only their fixed numbers
if (!near(WELL.radius, 0.9)) fail(`well radius ${WELL.radius} is not 0.9 (1.8 m opening)`);
if (!near(WELL.topY, TOP_SKIN_AT_CUPOLA)) fail(`well top ${WELL.topY} is not the top skin ${TOP_SKIN_AT_CUPOLA}`);
if (!near(WELL.bottomY, ROOMS.hold.ceilY)) fail(`well bottom ${WELL.bottomY} is not the hold ceiling ${ROOMS.hold.ceilY}`);
if (!near(CUPOLA.ringY, 7.4)) fail(`cupola ring ${CUPOLA.ringY} is not at the skin height 7.4`);
if (!(WELL.topY - WELL.bottomY > 0)) fail('well has no height');
if (Math.abs(WELL.x - CUPOLA.x) > EPS || Math.abs(WELL.z - CUPOLA.z) > EPS) fail('well and cupola are not on the same axis');
// the well must rise inside the hold footprint, otherwise it opens into vacuum
if (WELL.z - WELL.radius < ROOMS.hold.z[0] || WELL.z + WELL.radius > ROOMS.hold.z[1]
  || WELL.x - WELL.radius < ROOMS.hold.x[0] || WELL.x + WELL.radius > ROOMS.hold.x[1]) {
  fail('well opening is not inside the hold footprint');
}

// frame conversions: hull -> interior mirrors X and Z, hull -> ship-local km
// is the same flip at 1/1000, and the deck anchor is the hull centre.
{
  const i = hullToInterior(3, 2, -18);
  if (!near(i.x, -3) || !near(i.y, 2) || !near(i.z, 18)) fail('hullToInterior does not mirror X and Z');
  const k = hullToLocalKm(3, 2, -18);
  if (!near(k.x, -0.003) || !near(k.y, 0.002) || !near(k.z, 0.018)) fail('hullToLocalKm is not the mirrored millimetre-scale flip');
  if (DECK_ANCHOR_KM.x || DECK_ANCHOR_KM.y || DECK_ANCHOR_KM.z) fail('deck anchor is not the hull centre');
  const a = railPointHull(0), b = railPointHull(1), m = railPointHull(0.5);
  if (!near(a.x, RAIL.from.x) || !near(b.x, RAIL.to.x) || !near(m.x, 0)) fail('rail does not run from RAIL.from.x to RAIL.to.x through 0');
  if (!near(m.z, CUPOLA.z)) fail('rail does not run under the cupola');
}

if (fails.length) {
  for (const f of fails) console.error('FAIL ' + f);
  process.exit(1);
}
console.log(`HULLFRAME result=PASS ${rooms} rooms inside the section 5 envelope, well 1.8 m at the cupola, ring at +${CUPOLA.ringY} m, ${ENVELOPE.length} envelope regions`);
