// SPIKE DECK (milestone 0, task 0.3) -- thrown away in M1.
//
// Just enough geometry to prove the two-pass render: the main hold as a grey
// box seen from inside, a ceiling with a real 1.8 m round hole over the cupola
// position, and the well as an open tube up to the top skin. The open top of
// that tube IS the window of this spike: space shows through it because the
// interior scene has no geometry there.
//
// Everything is built in INTERIOR metres (hull metres mirrored in X and Z, see
// hull_frame.js); every number comes from hull_frame.js, none from here.
import * as THREE from 'three';
import { ROOMS, WELL, hullToInterior } from './hull_frame.js?v=101';

const GREY = 0x5a5f66;   // mid grey, albedo about 0.35
const SEGS = 48;         // hole and tube share it, so no sliver of space shows at the seam

export function buildSpikeDeck(interiorScene) {
  const grp = new THREE.Group();
  grp.name = 'spikeDeck';
  const hold = ROOMS.hold;

  // hold footprint in interior metres (X and Z mirror, so the ends swap)
  const a = hullToInterior(hold.x[0], hold.floorY, hold.z[0]);
  const b = hullToInterior(hold.x[1], hold.ceilY, hold.z[1]);
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
  const z0 = Math.min(a.z, b.z), z1 = Math.max(a.z, b.z);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const w = x1 - x0, d = z1 - z0, h = hold.ceilY - hold.floorY;

  const shell = new THREE.MeshStandardMaterial({ color: GREY, roughness: 0.92, metalness: 0.0, side: THREE.BackSide });
  const wallMats = [shell, shell, new THREE.MeshBasicMaterial({ visible: false }), shell, shell, shell];
  const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMats);   // +Y face left open: the ceiling below has the hole
  box.position.set(cx, (hold.floorY + hold.ceilY) / 2, cz);
  grp.add(box);

  // ceiling with a real hole: THREE.Shape + a circular hole, laid flat.
  // Rotating +90 deg about X sends the shape's (u, v) to world (x, z) and the
  // face normal to -Y, so it is the underside we look at from the hold.
  const wellC = hullToInterior(WELL.x, 0, WELL.z);
  const shape = new THREE.Shape();
  shape.moveTo(x0 - cx, z0 - cz);
  shape.lineTo(x1 - cx, z0 - cz);
  shape.lineTo(x1 - cx, z1 - cz);
  shape.lineTo(x0 - cx, z1 - cz);
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(wellC.x - cx, wellC.z - cz, WELL.radius, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const ceil = new THREE.Mesh(
    new THREE.ShapeGeometry(shape, SEGS),
    new THREE.MeshStandardMaterial({ color: GREY, roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide })
  );
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(cx, hold.ceilY, cz);
  grp.add(ceil);

  // the well: open tube from the hold ceiling to the cupola ring, no cap.
  // BackSide, so from below we see its inner wall and straight out of the top.
  const wellH = WELL.topY - WELL.bottomY;
  const tube = new THREE.Mesh(
    new THREE.CylinderGeometry(WELL.radius, WELL.radius, wellH, SEGS, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x4a4f56, roughness: 0.95, metalness: 0.0, side: THREE.BackSide })
  );
  tube.position.set(wellC.x, (WELL.bottomY + WELL.topY) / 2, wellC.z);
  grp.add(tube);

  // one lamp, low in the hold so the well throat stays darker than the sky
  const lamp = new THREE.PointLight(0xffe9cf, 55, 26, 2);
  lamp.position.set(cx, hold.ceilY - 0.6, cz);
  grp.add(lamp);

  interiorScene.add(grp);
  return grp;
}
