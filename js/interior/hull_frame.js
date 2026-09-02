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
// Because the interior origin IS the hull centre, the deck anchor D is the
// zero vector. It stays exported so the plan's name exists and so a later
// deck that sits off-centre only has to change one constant.

export const M_TO_KM = 0.001;

// hull metres -> ship-local render km (inside shipView.grp)
export function hullToLocalKm(x, y, z) {
  return { x: -x * M_TO_KM, y: y * M_TO_KM, z: -z * M_TO_KM };
}
// hull metres -> interior metres
export function hullToInterior(x, y, z) {
  return { x: -x, y, z: -z };
}

// deck anchor: origin of the interior frame in ship-local render km
export const DECK_ANCHOR_KM = { x: 0, y: 0, z: 0 };
export const D = DECK_ANCHOR_KM;

// layer bit for hull glass (cupola dome, canopy panes). Disabled on the space
// camera while boarded, so the glass never sits between eye and sky.
export const HULL_GLASS_LAYER = 3;

export const CAMERA = {
  interiorFov: 68, interiorNear: 0.03, interiorFar: 120,
  spaceFovBoarded: 68, spaceFovDefault: 55,
};

// ---------- hull envelope (SPEC section 5) ----------
// thickness and topY are [aft-end, fore-end] of the region; the nose tapers,
// the other three are read conservatively (worst case over the whole region).
export const ENVELOPE = [
  { name: 'Aft body', z: [-43, -13], halfWidth: [14, 14], thickness: [13, 19], topY: [7.3, 7.5], deck: true },
  { name: 'Mid body', z: [-13, 13], halfWidth: [12, 12], thickness: [12, 16], topY: [4.7, 8.2], deck: true },
  { name: 'Nose', z: [13, 45], halfWidth: [6, 1], thickness: [13, 8], topY: [4, 0], deck: true },
  // the wing carries no deck; it is here for completeness of the table
  { name: 'Wing', z: [-45, -20], halfWidth: [55, 55], thickness: [4, 12], topY: [0, 2.5], deck: false },
];

export const HULL_LENGTH_M = 110;      // longest axis of the normalised GLB
export const TOP_SKIN_AT_CUPOLA = 7.4; // aft-body top skin at Z -18
export const ENGINE_HUMPS = { y: 10, z: -28, x: [-5, 5] };

const lerp = (a, b, t) => a + (b - a) * t;

// Usable pressure hull at a station Z: half width, top skin, floor of the
// envelope. Outside the decked regions everything is zero-width, which makes
// any room reaching there fail the check.
export function envelopeAt(z) {
  let best = null;
  for (const r of ENVELOPE) {
    if (!r.deck || z < r.z[0] || z > r.z[1]) continue;
    const t = (z - r.z[0]) / (r.z[1] - r.z[0]);
    const halfWidth = lerp(r.halfWidth[0], r.halfWidth[1], t);
    // conservative: within aft and mid the top skin varies along X too, so
    // take the lower of the two ends; the nose really does fall linearly.
    const topY = r.name === 'Nose' ? lerp(r.topY[0], r.topY[1], t) : Math.min(r.topY[0], r.topY[1]);
    const thickness = r.name === 'Nose' ? lerp(r.thickness[0], r.thickness[1], t) : Math.min(r.thickness[0], r.thickness[1]);
    const cand = { region: r.name, halfWidth, topY, bottomY: topY - thickness };
    // overlapping regions (none today between decked ones): keep the tighter
    if (!best || cand.halfWidth < best.halfWidth) best = cand;
  }
  return best || { region: null, halfWidth: 0, topY: 0, bottomY: 0 };
}

// ---------- rooms (spec section 7.2), hull frame, metres ----------
// Deck floor -1.5, deck ceiling +3.0 (spec section 5): the hold is 4.5 m clear
// and the well rises from +3.0 to the skin at +7.4 (4.4 m). WELL below carries
// bottomY/topY, never a height.
// The airlock's "X -12" is its OUTBOARD WALL: read as a centre, the 3 m box
// would stand 1.5 m outside the mid-body envelope (half width 12).
export const ROOMS = {
  hold: { name: 'Main hold', z: [-26, -14], x: [-6, 6], floorY: -1.5, ceilY: 3.0 },
  // the corridor is a ring of four boxes that share faces and never volume:
  // the side legs run between the aft and the fore leg, so the check tests
  // real geometry and not the bounding shell.
  corridorPort: { name: 'Ring corridor (port)', z: [-27.6, -12.4], x: [-12, -9.6], floorY: -1.5, ceilY: 1.1 },
  corridorStbd: { name: 'Ring corridor (starboard)', z: [-27.6, -12.4], x: [9.6, 12], floorY: -1.5, ceilY: 1.1 },
  corridorAft: { name: 'Ring corridor (aft)', z: [-30, -27.6], x: [-12, 12], floorY: -1.5, ceilY: 1.1 },
  corridorFwd: { name: 'Ring corridor (fore)', z: [-12.4, -10], x: [-12, 12], floorY: -1.5, ceilY: 1.1 },
  // 2.4 m clear from the hold floor; M1 ramps it up to the cockpit floor (-1.0)
  tunnel: { name: 'Cockpit tunnel', z: [-10, 10], x: [-1.1, 1.1], floorY: -1.5, ceilY: 0.9 },
  cockpit: { name: 'Cockpit', z: [10, 18], x: [-2.5, 2.5], floorY: -1.0, ceilY: 2.2 },
  // bunks and airlock sit FORWARD of the ring's fore leg (Z -10) and open onto
  // it: at the spec's Z -14..-10 they stood inside the corridor's own volume.
  bunks: { name: 'Bunks', z: [-10, -6], x: [7, 12], floorY: -1.5, ceilY: 1.1 },
  engineering: { name: 'Engineering', z: [-40, -30], x: [-5, 5], floorY: -1.5, ceilY: 4.0 },
  airlock: { name: 'Airlock', z: [-10, -7], x: [-12, -9], floorY: -1.5, ceilY: 1.1 },
};

// ---------- cupola, well, canopy (spec section 7.3) ----------
// The well and the cupola are the one thing allowed to pierce the top skin.
export const CUPOLA = {
  x: 0, z: -18,
  ringY: TOP_SKIN_AT_CUPOLA,   // where the dome meets the skin
  radius: 1.6,
  height: 1.1,                 // dome height above the skin
  seatY: TOP_SKIN_AT_CUPOLA + 0.45,
  eyeY: 8.6,
};
export const WELL = {
  x: CUPOLA.x, z: CUPOLA.z,
  bottomY: ROOMS.hold.ceilY,   // 3.0, the hold ceiling
  topY: TOP_SKIN_AT_CUPOLA,    // 7.4, the cupola ring
  radius: 0.9,                 // 1.8 m diameter opening
};
export const CANOPY = {
  z: [ROOMS.cockpit.z[0], ROOMS.cockpit.z[1]],
  x: [ROOMS.cockpit.x[0], ROOMS.cockpit.x[1]],
  sillY: 2.2,
  panes: 5,
};

// ---------- debug camera poses (task 0.3), hull frame ----------
// rail: a straight line under the well opening, looking up it, t = 0 to 1.
// Eye 1.7 m over the hold floor. The ends stay within 1.0 m of the well axis:
// a ray from 2.8 m below the hole and x off-axis leaves the 4.4 m tube at
// 2.57 x, so from 1.0 m most of the opening is still sky and from 2.5 m none
// of it is (measured 02.09.2026, the first rail was +-2.5).
// cupola: the seated eye point under the bubble, looking aft and a little
// down at the two engine humps. The spike has no cupola geometry, so this
// camera stands in open space above the skin; the humps are in the hull GLB.
export const POSES = {
  rail: {
    from: { x: -1.0, y: 0.2, z: CUPOLA.z },
    to: { x: 1.0, y: 0.2, z: CUPOLA.z },
    lookAt: { x: CUPOLA.x, y: WELL.topY, z: CUPOLA.z },
  },
  cupola: {
    eye: { x: CUPOLA.x, y: CUPOLA.eyeY, z: CUPOLA.z },
    lookAt: { x: 0, y: ENGINE_HUMPS.y, z: ENGINE_HUMPS.z },
  },
};
export const RAIL = POSES.rail;
export function railPointHull(t) {
  const k = Math.max(0, Math.min(1, t));
  return {
    x: lerp(RAIL.from.x, RAIL.to.x, k),
    y: lerp(RAIL.from.y, RAIL.to.y, k),
    z: lerp(RAIL.from.z, RAIL.to.z, k),
  };
}
