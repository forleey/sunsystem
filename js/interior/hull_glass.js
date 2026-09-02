// Exterior glass of the ship interior (design spec 7.3): the cupola bubble at
// km scale as a child of shipView.grp, OUTSIDE the normalised GLB subtree so
// playerPaint never blacks it out. One hexagonal top pane over six trapezoid
// side panes, 8 cm anodised frames, an open collar that seats the ring on the
// skin, and a warm emissive disc inside the bubble that makes the lit cupola
// read from the chase cam on the night side.
//
// Everything sits on HULL_GLASS_LAYER, which board() disables on the space
// camera: from the seat the panes are the interior scene's job (M1), from
// outside the bubble on the ridge is what says "someone is in there".
// Built in HULL metres (nose +Z): a half turn about Y is hullToInterior, the
// group scale is the km. All numbers come from hull_frame.js.
import * as THREE from 'three';
import { CUPOLA, CUPOLA_GLASS, HULL_GLASS_LAYER, M_TO_KM } from './hull_frame.js?v=101';

const FRAME = new THREE.MeshStandardMaterial({ color: 0x2a2d31, metalness: 0.8, roughness: 0.45, side: THREE.DoubleSide });
const PANE = new THREE.MeshPhysicalMaterial({
  color: 0xdbe4ee, transmission: 0.9, roughness: 0.05, metalness: 0,
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
});
// same order as the hull's own window emissive (0xe6e6e6 at selfGlow 1.2)
const DISC = new THREE.MeshStandardMaterial({ color: 0xffc27a, emissive: 0xffc27a, emissiveIntensity: 2.5, side: THREE.DoubleSide });

// flat-shaded facets from explicit triangles: one non-indexed geometry
function facets(tris) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(2), 3));
  g.computeVertexNormals();
  return g;
}

export function addHullGlass(shipView) {
  const grp = new THREE.Group();
  grp.name = 'hullGlass';
  grp.rotation.y = Math.PI;              // hull -> interior frame: (-x, y, -z)
  grp.scale.setScalar(M_TO_KM);          // metres -> ship-local km

  const { radius: r, ringY, height } = CUPOLA;
  const { sides, topRadius: rt, frameWidth: fw, collar, disc } = CUPOLA_GLASS;
  const topY = ringY + height;
  // bottom ring on the skin, top ring under the top pane, both hexagons
  const ring = (rad, y) => Array.from({ length: sides }, (_, k) => {
    const a = (k / sides) * Math.PI * 2;
    return [rad * Math.sin(a), y, rad * Math.cos(a)];
  });
  const B = ring(r, ringY), T = ring(rt, topY), C = [0, topY, 0];
  const n = (k) => (k + 1) % sides;

  // seven panes: six trapezoids (two triangles each) and the hexagonal top
  const tris = [];
  for (let k = 0; k < sides; k++) {
    tris.push([B[k], B[n(k)], T[n(k)]], [B[k], T[n(k)], T[k]]);
    tris.push([T[k], T[n(k)], C]);
  }
  grp.add(new THREE.Mesh(facets(tris), PANE));

  // frames: a bar along every pane edge (slanted uprights, top hexagon, base hexagon)
  const a = new THREE.Vector3(), b = new THREE.Vector3(), z = new THREE.Vector3(0, 0, 1);
  const bar = (p, q) => {
    a.fromArray(p); b.fromArray(q);
    const m = new THREE.Mesh(new THREE.BoxGeometry(fw, fw, a.distanceTo(b) + fw), FRAME);
    m.position.addVectors(a, b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(z, b.sub(a).normalize());
    return m;
  };
  for (let k = 0; k < sides; k++) grp.add(bar(B[k], T[k]), bar(T[k], T[n(k)]), bar(B[k], B[n(k)]));

  // collar: open tube from below the lowest skin at the ring up to the ring,
  // so the base seats on the skin all round (the hull covers the intrusion aft)
  const ch = collar.topY - collar.bottomY;
  const col = new THREE.Mesh(new THREE.CylinderGeometry(collar.radius, collar.radius, ch, 24, 1, true), FRAME);
  col.position.y = collar.bottomY + ch / 2;
  grp.add(col);

  // the warm disc inside the bubble, above the highest skin
  const d = new THREE.Mesh(new THREE.CircleGeometry(disc.radius, 32), DISC);
  d.rotation.x = -Math.PI / 2;
  d.position.y = disc.y;
  grp.add(d);

  grp.traverse(o => o.layers.set(HULL_GLASS_LAYER));
  shipView.grp.add(grp);
  return grp;
}
