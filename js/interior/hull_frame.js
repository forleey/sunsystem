// Every number of the ship interior lives here: hull envelope, room boxes,
// cupola/canopy, camera parameters, debug rail. No three import, no DOM: the
// unit check (tools/hull_frame_check.mjs) runs this file straight in Node.
//
// THREE FRAMES, and the only three that exist:
//
//   hull frame     hull-centred metres, nose +Z, up +Y, starboard +X.
//                  This is the frame of the interior design spec
//                  (docs/superpowers/specs/2026-09-02-ship-interior-design.md,
//                  sections 5 and 7) and the frame every table below is
//                  written in. SPEC.md at the root is the Unity contract, not
//                  this one.
//   interior frame metres, same origin (the hull centre), axes rotated onto
//                  the render axes: (x, y, z)_int = (-x, y, -z)_hull.
//                  js/models.js normalises player.glb with yaw = PI, so the
//                  GLB nose (+Z) points to render -Z and X is mirrored; the
//                  interior frame copies that flip, which is why the pose
//                  coupling in rig.js needs no extra rotation.
//   ship-local km  render kilometres inside shipView.grp: interior * 0.001.
//
// Because the interior origin IS the hull centre, the deck anchor is the zero
// vector. It stays exported so a later deck that sits off-centre only has to
// change one constant.

export const M_TO_KM = 0.001;

// hull metres -> interior metres
export function hullToInterior(x, y, z) {
  return { x: -x, y, z: -z };
}

// deck anchor: origin of the interior frame in ship-local render km
export const DECK_ANCHOR_KM = { x: 0, y: 0, z: 0 };

// layer bit for hull glass (cupola dome, canopy panes). Disabled on the space
// camera while boarded, so the glass never sits between eye and sky.
export const HULL_GLASS_LAYER = 3;

// one FOV for both cameras while boarded: the space camera copies it in board()
export const CAMERA = { interiorFov: 68, interiorNear: 0.03, interiorFar: 120 };

// ---------- hull envelope (design spec section 5) ----------
// Measured 02.09.2026 on the DEPLOYED player.glb by vertical raycast
// (tools/hullprobe.mjs) in the game's own normalisation. Rows cover the
// pressure hull only (no wing) and are read CONSERVATIVELY: a scalar is the
// worst value over the whole row, a [aft, fore] pair is interpolated linearly
// where the skin really falls that way (taper rows, the nose) and is chosen so
// the line stays under every probed station. topY holds out to halfWidth; the
// optional spine is the higher skin over the centre line (dorsal deck, ridge,
// canopy roof), valid for |X| <= spine.halfWidth.
export const ENVELOPE = [
  // flat dorsal deck at 8.2 (8.0 at |X| 6); the skin at |X| 14 is 2.0 at Z -22.
  // Bottom read outboard: -4.74 at |X| 14 Z -22.25 (the centre line is -5.0)
  { name: 'Dorsal deck', z: [-39, -22], halfWidth: 14, topY: 2.0, bottomY: -4.7, spine: { halfWidth: 6, topY: 8.0 } },
  // the flanks beside the crest: the deck narrows into the ridge, shoulders
  // 4.6 to 3.9 at |X| 6, skin at |X| 12 is 1.18 at Z -10. The crest itself
  // (8 m wide, 8.2 falling to 7.6) is the separate RIDGE below.
  { name: 'Ridge flanks', z: [-22, -10], halfWidth: 12, topY: 1.18, bottomY: -4.2, spine: { halfWidth: 6, topY: 3.9 } },
  // shoulders under the spine: skin at |X| 11 is 1.20 at Z -6, 0.63 at |X| 12;
  // the spine is 4.26 at |X| 5 Z -9.75
  { name: 'Shoulders', z: [-10, -6], halfWidth: 11, topY: 1.2, bottomY: -4.3, spine: { halfWidth: 5, topY: 4.2 } },
  // the spine falls from 7.1 to 4.9 over the tunnel; |X| 5 stays above 3.1
  { name: 'Fore body', z: [-6, 10], halfWidth: 5, topY: 3.1, bottomY: -5.0, spine: { halfWidth: 2.5, topY: 4.6 } },
  // cockpit station: |X| 2.5 falls from 4.61 to 2.57, |X| 5 from 3.15 to 1.00.
  // Bottom rises outboard (-4.80 at |X| 5 Z 17.75 against -6.3 on the axis)
  { name: 'Nose (cockpit)', z: [10, 18], taper: true, halfWidth: 5, topY: [3.1, 1.0], bottomY: -4.8, spine: { halfWidth: 2.5, topY: [4.6, 2.5] } },
  // beyond the canopy only fins are left; the tip is at Z 45 (-4.95 at |X| 5 Z 18)
  { name: 'Nose (tip)', z: [18, 36], taper: true, halfWidth: [5, 2], topY: [1.0, -1.5], bottomY: [-4.8, -2.4] },
];
// The wing (Z -41 to -20, out to |X| 54, top 7.7 at |X| 10 aft of Z -24 and
// 3.5 forward of it) carries no deck and is not in the table.

export const TOP_SKIN_AT_CUPOLA = 8.06;                   // raycast at (0, -18)
export const DORSAL_DECK = { y: 8.2, z: [-39, -22], halfWidth: 8 };   // 7.9 at |X| 8
export const RIDGE = { z: [-22, -12], halfWidth: 4, topY: [8.2, 7.6] }; // 8.0 at |X| 4 by Z -18, |X| 2.5 by Z -14

const lerp = (a, b, t) => a + (b - a) * t;
const at = (v, t) => (Array.isArray(v) ? lerp(v[0], v[1], t) : v);

// Usable pressure hull at station Z for a room reaching out to |X| = absX:
// half width, top skin over that X, bottom skin. Outside the rows everything
// is zero-width, which makes any room reaching there fail the check.
export function envelopeAt(z, absX = 0) {
  let best = null;
  for (const r of ENVELOPE) {
    if (z < r.z[0] || z > r.z[1]) continue;
    const t = r.taper ? (z - r.z[0]) / (r.z[1] - r.z[0]) : 0;
    const spine = r.spine && absX <= at(r.spine.halfWidth, t) + 1e-9 ? r.spine : null;
    const cand = {
      region: r.name, halfWidth: at(r.halfWidth, t),
      topY: at(spine ? spine.topY : r.topY, t), bottomY: at(r.bottomY, t),
    };
    // rows meet at their borders: keep the tighter of the two there
    if (!best || cand.halfWidth < best.halfWidth) best = cand;
  }
  return best || { region: null, halfWidth: 0, topY: 0, bottomY: 0 };
}

// ---------- rooms (spec section 7.2), hull frame, metres ----------
// Deck floor -1.5, deck ceiling +3.0 (spec section 5): the hold is 4.5 m clear
// and the well rises from +3.0 to the cupola ring at +8.1 (5.1 m). WELL below
// carries bottomY/topY, never a height.
// Bunks and airlock end at |X| 11: the skin at |X| 12 is 0.63 at Z -6, under
// their 1.1 ceiling. Engineering starts at Z -39, the body's aft end.
export const ROOMS = {
  hold: { name: 'Main hold', z: [-26, -14], x: [-6, 6], floorY: -1.5, ceilY: 3.0 },
  // the corridor is a ring of four boxes that share faces and never volume:
  // the side legs run between the aft and the fore leg, so the check tests
  // real geometry and not the bounding shell.
  corridorPort: { name: 'Ring corridor (port)', z: [-27.6, -12.4], x: [-12, -9.6], floorY: -1.5, ceilY: 1.1 },
  corridorStbd: { name: 'Ring corridor (starboard)', z: [-27.6, -12.4], x: [9.6, 12], floorY: -1.5, ceilY: 1.1 },
  corridorAft: { name: 'Ring corridor (aft)', z: [-30, -27.6], x: [-12, 12], floorY: -1.5, ceilY: 1.1 },
  corridorFwd: { name: 'Ring corridor (fore)', z: [-12.4, -10], x: [-12, 12], floorY: -1.5, ceilY: 1.1 },
  passageFwd: { name: 'Fore passage', z: [-14, -12.4], x: [-1.2, 1.2], floorY: -1.5, ceilY: 1.1 },
  passageAft: { name: 'Aft passage', z: [-27.6, -26], x: [-1.2, 1.2], floorY: -1.5, ceilY: 1.1 },
  // 2.7 m clear from the hold floor; two 0.25 m steps at the fore end (STEPS)
  // climb to the cockpit floor (-1.0), leaving 2.2 m over the top step
  tunnel: { name: 'Cockpit tunnel', z: [-10, 10], x: [-1.1, 1.1], floorY: -1.5, ceilY: 1.2 },
  cockpit: { name: 'Cockpit', z: [10, 18], x: [-2.5, 2.5], floorY: -1.0, ceilY: 2.2 },
  // bunks and airlock sit FORWARD of the ring's fore leg (Z -10) and open onto
  // it: at the spec's Z -14..-10 they stood inside the corridor's own volume.
  bunks: { name: 'Bunks', z: [-10, -6], x: [7, 11], floorY: -1.5, ceilY: 1.1 },
  engineering: { name: 'Engineering', z: [-39, -30], x: [-5, 5], floorY: -1.5, ceilY: 4.0 },
  airlock: { name: 'Airlock', z: [-10, -7], x: [-11, -8], floorY: -1.5, ceilY: 1.1 },
};

// ---------- cupola, well, canopy (spec section 7.3) ----------
// The well and the cupola are the one thing allowed to pierce the top skin.
// The ring sits ON the skin (8.1 over 8.06), on the flat of the 8 m ridge.
export const CUPOLA = {
  x: 0, z: -18,
  ringY: 8.1,                  // where the dome meets the skin
  radius: 1.6,
  height: 1.1,                 // dome height above the ring
  platformY: 7.6,              // seat platform in the well top, 0.5 under the ring
  seatY: 8.05,                 // seat pan, 0.45 over the platform
  eyeY: 8.8,                   // seated eye: 1.2 over the platform, 0.7 over the skin, 0.4 under the dome top
};
// exterior bubble (hull_glass.js): one hexagonal top pane over six trapezoid
// side panes (seven, spec 7.3), 8 cm anodised frames, an open collar that
// seats the ring on the skin all round (the skin at the 1.6 m ring runs from
// 7.97 fore to 8.14 aft, TOP_SKIN_AT_RING), and a warm emissive disc inside
// the bubble, above the highest skin, so the lit cupola reads from the chase
// cam on the night side.
export const TOP_SKIN_AT_RING = [7.97, 8.14];   // [fore, aft] at radius 1.6 around the ring
export const CUPOLA_GLASS = {
  sides: 6,                    // side panes; plus the top pane = 7
  topRadius: 0.9,              // the hexagonal top pane
  frameWidth: 0.08,
  collar: { radius: 1.65, bottomY: 7.9, topY: CUPOLA.ringY },
  disc: { radius: 1.5, y: CUPOLA.ringY + 0.06 },
};
export const WELL = {
  x: CUPOLA.x, z: CUPOLA.z,
  bottomY: ROOMS.hold.ceilY,   // 3.0, the hold ceiling
  topY: CUPOLA.ringY,          // 8.1, the cupola ring
  radius: 0.9,                 // 1.8 m diameter opening
};
export const CANOPY = {
  z: [ROOMS.cockpit.z[0], ROOMS.cockpit.z[1]],
  x: [ROOMS.cockpit.x[0], ROOMS.cockpit.x[1]],
  sillY: 2.2,
  panes: 5,
};

// ---------- self-test thresholds (spec section 11, selftest.js) ----------
// Luminances are display-encoded (the composite after the OutputPass), 0..1.
export const SELFTEST = {
  block: 9,          // n x n pixel block averaged at a test point
  earthLum: 0.08,    // Earth-seen: block mean above this at the centre or the lit point
  litOffset: 0.6,    // the lit point sits this many Earth radii from the centre toward the sun
  skyLum: 0.01,      // leak: a pixel of the wall frame darker than this is space
};

// ---------- walking (spec section 9), metres and seconds ----------
export const WALK = {
  speed: 2.7,            // m/s
  eye: 1.62,             // eye over the feet, standing
  seatedEye: 1.2,        // eye over the floor a seat stands on
  radius: 0.34,          // capsule radius
  height: 1.8,           // capsule height, feet to crown
  step: 0.3,             // max step-up
  lookSens: 0.0022,      // rad per pixel of pointer movement
  pitchLimit: 1.45,      // rad, standing
  gravity: 9.81,
  useRange: 1.4,         // m, distance at which an E prompt appears
};
// shell construction (deck.js): every wall, floor and ceiling is a slab of
// this thickness INSIDE its room, so two abutting rooms carry two slabs on
// the shared face and the doorway is cut into both from the same rectangle.
export const SHELL = { thickness: 0.2 };
// doorways: cut where two rooms abut, centred on the shared face
export const DOOR = {
  maxWidth: 2.0,
  margin: 0.2,           // wall left on either side at least (matches the slab thickness)
  lintel: 0.2,           // wall left under the lower ceiling
  minWidth: 0.9,         // checked by tools/hull_frame_check.mjs
  minClear: WALK.height + 0.1,
};
// two treads at the fore end of the tunnel, up to the cockpit floor
export const STEPS = [
  { x: ROOMS.tunnel.x, z: [8.8, 10], topY: -1.25, bottomY: ROOMS.tunnel.floorY },
  { x: ROOMS.tunnel.x, z: [9.4, 10], topY: ROOMS.cockpit.floorY, bottomY: ROOMS.tunnel.floorY },
];
// the ladder stands free in the hold on the fore edge of the well opening and
// runs up the well's fore wall to the seat platform. The climber hangs 0.4 m
// aft of the rungs, inside the 0.9 m well.
export const LADDER = {
  x: WELL.x, z: WELL.z + WELL.radius - 0.05,
  width: 0.5, depth: 0.1,
  bottomY: ROOMS.hold.floorY, topY: CUPOLA.platformY,
  standoff: 0.5,            // climber's centre aft of the rung face (capsule radius 0.34 clears the 0.1 m rungs)
  rungPitch: 0.3,
  climbSeconds: 4.5,
};
// seats: pan box and where the player stands after getting up (hull frame).
// facing is the hull-frame yaw of the seat's forward direction (0 = nose).
export const SEATS = {
  cupola: {
    name: 'cupola', x: WELL.x, z: WELL.z - 0.45, floorY: CUPOLA.platformY, width: 0.5, depth: 0.5, facing: Math.PI,
    yawFree: true, pitch: [-20 * Math.PI / 180, 90 * Math.PI / 180], reachedByLadder: true,
  },
  pilot: {
    name: 'pilot', x: -0.9, z: 15.4, floorY: ROOMS.cockpit.floorY, width: 0.55, depth: 0.55, facing: 0,
    yawFree: false, yaw: [-1.2, 1.2], pitch: [-0.9, 0.9], standAt: { x: -0.9, z: 14.4 },
  },
  copilot: { name: 'copilot', x: 0.9, z: 15.4, floorY: ROOMS.cockpit.floorY, width: 0.55, depth: 0.55, facing: 0, decorative: true },
};
// the drive core: a solid cylinder in the middle of engineering (visual + shell)
export const CORE = { x: 0, z: -34.5, radius: 1.5, floorY: ROOMS.engineering.floorY, topY: ROOMS.engineering.ceilY };
// where boarding puts the player: the hold, facing the ladder and the well
export const SPAWN = { x: 0, z: -23, floorY: ROOMS.hold.floorY, yaw: 0 };

// Doorways between abutting rooms, hull frame. A doorway is a rectangle on
// the shared face: axis 'x' when the rooms meet on a plane x = at (the door
// spans z), axis 'z' when they meet on z = at (the door spans x). Pure, so the
// check tool and deck.js see the same openings.
export function doorways(rooms = ROOMS) {
  const out = [];
  const keys = Object.keys(rooms);
  const eq = (a, b) => Math.abs(a - b) < 1e-9;
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const a = rooms[keys[i]], b = rooms[keys[j]];
    const yOverlap = Math.min(a.ceilY, b.ceilY) - Math.max(a.floorY, b.floorY);
    if (yOverlap <= 0) continue;
    for (const [axis, span] of [['x', 'z'], ['z', 'x']]) {
      let at = null;
      if (eq(a[axis][1], b[axis][0])) at = a[axis][1];
      else if (eq(b[axis][1], a[axis][0])) at = b[axis][1];
      if (at === null) continue;
      const s0 = Math.max(a[span][0], b[span][0]), s1 = Math.min(a[span][1], b[span][1]);
      if (s1 - s0 <= 0) continue;
      const width = Math.min(DOOR.maxWidth, s1 - s0 - 2 * DOOR.margin);
      const mid = (s0 + s1) / 2;
      const bottomY = Math.max(a.floorY, b.floorY);
      const topY = Math.min(a.ceilY, b.ceilY) - DOOR.lintel;
      out.push({ a: keys[i], b: keys[j], axis, at, span: [mid - width / 2, mid + width / 2], bottomY, topY, width, clear: topY - bottomY });
    }
  }
  return out;
}

// ---------- camera poses (screenshots, self-tests), hull frame ----------
// Standing poses put the eye WALK.eye over the room floor. rail is the perf
// ride under the well; cupola and cockpit are the two seats.
const standing = (x, z, room, lookAt) => ({ eye: { x, y: ROOMS[room].floorY + WALK.eye, z }, lookAt, room });
export const POSES = {
  rail: {
    from: { x: -1.0, y: 0.2, z: CUPOLA.z },
    to: { x: 1.0, y: 0.2, z: CUPOLA.z },
    lookAt: { x: CUPOLA.x, y: WELL.topY, z: CUPOLA.z },
  },
  cupola: { eye: { x: SEATS.cupola.x, y: CUPOLA.eyeY, z: SEATS.cupola.z }, lookAt: { x: 0, y: DORSAL_DECK.y, z: -34 }, seat: 'cupola' },
  cockpit: { eye: { x: SEATS.pilot.x, y: ROOMS.cockpit.floorY + WALK.seatedEye, z: SEATS.pilot.z }, lookAt: { x: 0, y: 1.0, z: 30 }, seat: 'pilot' },
  hold: standing(2.5, -24.5, 'hold', { x: 0, y: WELL.topY, z: WELL.z }),
  corridor: standing(-10.8, -26.5, 'corridorPort', { x: -10.8, y: 0, z: -12 }),
  tunnel: standing(0, -8, 'tunnel', { x: 0, y: 0, z: 12 }),
  bunks: standing(9, -9.6, 'bunks', { x: 9, y: 0, z: -6 }),
  engineering: standing(0, -30.6, 'engineering', { x: 0, y: 1.0, z: -35 }),
  airlock: standing(-9.5, -9.4, 'airlock', { x: -11, y: 0, z: -8.5 }),
};
export function railPointHull(t) {
  const k = Math.max(0, Math.min(1, t)), r = POSES.rail;
  return { x: lerp(r.from.x, r.to.x, k), y: lerp(r.from.y, r.to.y, k), z: lerp(r.from.z, r.to.z, k) };
}
