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
  // flat dorsal deck at 8.2 (8.0 at |X| 6); the skin at |X| 14 is 2.0 at Z -22
  { name: 'Dorsal deck', z: [-39, -22], halfWidth: 14, topY: 2.0, bottomY: -5.0, spine: { halfWidth: 6, topY: 8.0 } },
  // the deck narrows into the ridge; shoulders 4.6 to 3.9 at |X| 6, skin at |X| 12 is 1.18 at Z -10
  { name: 'Ridge', z: [-22, -10], halfWidth: 12, topY: 1.18, bottomY: -4.2, spine: { halfWidth: 6, topY: 3.9 } },
  // shoulders under the spine: skin at |X| 11 is 1.20 at Z -6, 0.63 at |X| 12
  { name: 'Shoulders', z: [-10, -6], halfWidth: 11, topY: 1.2, bottomY: -4.3, spine: { halfWidth: 5, topY: 4.3 } },
  // the spine falls from 7.1 to 4.9 over the tunnel; |X| 5 stays above 3.1
  { name: 'Fore body', z: [-6, 10], halfWidth: 5, topY: 3.1, bottomY: -5.0, spine: { halfWidth: 2.5, topY: 4.6 } },
  // cockpit station: |X| 2.5 falls from 4.61 to 2.57, |X| 5 from 3.15 to 1.00
  { name: 'Nose (cockpit)', z: [10, 18], taper: true, halfWidth: 5, topY: [3.1, 1.0], bottomY: [-7.2, -6.3], spine: { halfWidth: 2.5, topY: [4.6, 2.5] } },
  // beyond the canopy only fins are left; the tip is at Z 45
  { name: 'Nose (tip)', z: [18, 36], taper: true, halfWidth: [5, 2], topY: [1.0, -1.5], bottomY: [-6.3, -2.4] },
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
  // 2.4 m clear from the hold floor; M1 ramps it up to the cockpit floor (-1.0)
  tunnel: { name: 'Cockpit tunnel', z: [-10, 10], x: [-1.1, 1.1], floorY: -1.5, ceilY: 0.9 },
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
  seatY: 8.55,                 // 0.45 over the well platform
  eyeY: 9.3,                   // seated eye, 1.2 m above the skin
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

// ---------- debug camera poses (task 0.3), hull frame ----------
// rail: a straight line under the well opening, looking up it, t = 0 to 1.
// Eye 1.7 m over the hold floor. The ends stay within 1.0 m of the well axis:
// a ray from 2.8 m below the hole and x off-axis leaves the 5.1 m tube at
// 2.82 x, so from 1.0 m about a third of the opening is still sky and from
// 2.8 m none of it is (the first rail was +-2.5, measured 02.09.2026).
// cupola: the seated eye point under the bubble, looking aft and down onto
// the flat dorsal deck. The spike has no cupola geometry, so this camera
// stands in open space above the skin; the deck is the hull GLB itself.
export const POSES = {
  rail: {
    from: { x: -1.0, y: 0.2, z: CUPOLA.z },
    to: { x: 1.0, y: 0.2, z: CUPOLA.z },
    lookAt: { x: CUPOLA.x, y: WELL.topY, z: CUPOLA.z },
  },
  cupola: {
    eye: { x: CUPOLA.x, y: CUPOLA.eyeY, z: CUPOLA.z },
    lookAt: { x: 0, y: DORSAL_DECK.y, z: -34 },
  },
};
export function railPointHull(t) {
  const k = Math.max(0, Math.min(1, t)), r = POSES.rail;
  return { x: lerp(r.from.x, r.to.x, k), y: lerp(r.from.y, r.to.y, k), z: lerp(r.from.z, r.to.z, k) };
}
