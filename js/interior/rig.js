// Ship interior: the second scene and its coupling to the space render.
//
// While boarded the composer draws two scenes: the space RenderPass as always,
// then RenderPass(interiorScene, interiorCamera) with clear = false and
// clearDepth = true. The deck lands on top of the space image, and wherever the
// deck has no geometry (a window, the open top of the cupola well) the space
// image stays. Depth is cleared between them, so the metre scene and the
// kilometre scene never share a depth buffer (why the pass must sit directly
// behind the space pass: see insertPassAfterScene in scene.js). Bloom, output,
// FXAA and the film look then run once over the combined image.
//
// Nothing from the space scene is ever copied into the interior scene.
import * as THREE from 'three';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { CAMERA, DECK_ANCHOR_KM, HULL_GLASS_LAYER, M_TO_KM, POSES, hullToInterior, railPointHull } from './hull_frame.js?v=101';
import { buildSpikeDeck } from './deck_spike.js?v=101';

const v3 = (p) => new THREE.Vector3(p.x, p.y, p.z);

export class InteriorRig {
  // getFocus/setFocus reach into main.js's focusName; stage owns the composer
  constructor({ stage, shipView, getFocus, setFocus }) {
    this.stage = stage;
    this.shipView = shipView;
    this.getFocus = getFocus;
    this.setFocus = setFocus;
    this.boarded = false;

    this.scene = new THREE.Scene();          // no background, no fog: space shows through
    this.camera = new THREE.PerspectiveCamera(
      CAMERA.interiorFov, window.innerWidth / window.innerHeight,
      CAMERA.interiorNear, CAMERA.interiorFar
    );
    this.pass = new RenderPass(this.scene, this.camera);
    this.pass.clear = false;                 // keep the space image
    this.pass.clearDepth = true;             // but start the deck on a fresh depth buffer

    stage.onResize.push((w, h) => { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); });
    // hull glass is visible from outside and switched off while boarded
    stage.camera.layers.enable(HULL_GLASS_LAYER);

    buildSpikeDeck(this.scene);              // TEMP deck for milestone 0, replaced in M1

    this.railT = null;                       // null = rail pose off
    this._anchor = v3(DECK_ANCHOR_KM);
    this._tmp = new THREE.Vector3();
    this._prevFocus = null;
    this._prevFov = stage.camera.fov;
    this._prevMask = stage.camera.layers.mask;

    if (!this.applyUrlPose()) this.setRail(0.5);   // the spike has no walk mode yet
  }

  // ?pose=rail&t=0..1 puts the interior camera on the debug rail at boot,
  // ?pose=cupola at the cupola seat looking aft and down onto the dorsal deck.
  // Returns true when the URL named a pose.
  applyUrlPose() {
    const q = new URLSearchParams(location.search);
    const pose = q.get('pose');
    if (pose === 'cupola') { this.setCupola(); return true; }
    if (pose !== 'rail') return false;
    const t = parseFloat(q.get('t'));
    this.setRail(Number.isFinite(t) ? t : 0);
    return true;
  }

  // debug pose: a straight line under the well, looking up at the opening.
  // Screen up is the ship's nose, so the parallax reads as a sideways slide.
  setRail(t) {
    this.railT = Math.max(0, Math.min(1, t));
    const h = railPointHull(this.railT);
    const p = hullToInterior(h.x, h.y, h.z);
    const look = hullToInterior(POSES.rail.lookAt.x, POSES.rail.lookAt.y, POSES.rail.lookAt.z);
    this.camera.position.set(p.x, p.y, p.z);
    this.camera.up.set(0, 0, -1);            // interior -Z is the hull nose
    this.camera.lookAt(look.x, look.y, look.z);
    this.camera.updateMatrixWorld(true);
    return this.railT;
  }

  // debug pose: seated eye point in the cupola, looking aft and down onto the
  // flat dorsal deck of the hull GLB (the space scene shows it)
  setCupola() {
    this.railT = null;
    const c = POSES.cupola;
    const p = hullToInterior(c.eye.x, c.eye.y, c.eye.z);
    const look = hullToInterior(c.lookAt.x, c.lookAt.y, c.lookAt.z);
    this.camera.position.set(p.x, p.y, p.z);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(look.x, look.y, look.z);
    this.camera.updateMatrixWorld(true);
  }

  board() {
    if (this.boarded) return false;
    const stage = this.stage;
    this._prevFocus = this.getFocus();
    if (this._prevFocus !== 'Starship') this.setFocus('Starship');
    this._prevFov = stage.camera.fov;
    this._prevMask = stage.camera.layers.mask;
    stage.camera.fov = CAMERA.interiorFov;
    stage.camera.updateProjectionMatrix();
    stage.camera.layers.disable(HULL_GLASS_LAYER);
    stage.insertPassAfterScene(this.pass);
    document.body.classList.add('boarded');
    this.boarded = true;
    this.update();
    return true;
  }

  leave() {
    if (!this.boarded) return false;
    const stage = this.stage;
    stage.removePass(this.pass);
    stage.camera.fov = this._prevFov;
    stage.camera.updateProjectionMatrix();
    stage.camera.layers.mask = this._prevMask;
    document.body.classList.remove('boarded');
    this.boarded = false;
    // unconditional: applyFocus('Starship') is idempotent and re-snaps the
    // chase cam behind a ship that turned while we were inside
    if (this._prevFocus) this.setFocus(this._prevFocus);
    return true;
  }

  toggle() { return this.boarded ? this.leave() : this.board(); }

  // Pose coupling (design spec 4.2), run every frame after shipView.update and after
  // the arrival offset, before composer.render. The interior scene never
  // rotates: the ship's attitude is carried entirely by the space camera.
  //   spaceCamera.position   = q * (anchor + P_m * 0.001) + grp.position
  //   spaceCamera.quaternion = q * R
  //   spaceCamera.up         = q * (0, 1, 0)
  // grp.position is not exactly the origin: it is ship.pos - focusPos, plus the
  // arrival fly-in offset for the first ~10 s after boot.
  update() {
    if (!this.boarded) return;
    const q = this.shipView.quat, cam = this.stage.camera;
    this._tmp.copy(this.camera.position).multiplyScalar(M_TO_KM).add(this._anchor).applyQuaternion(q);
    cam.position.copy(this._tmp).add(this.shipView.grp.position);
    cam.quaternion.copy(q).multiply(this.camera.quaternion);
    cam.up.set(0, 1, 0).applyQuaternion(q);
    cam.updateMatrixWorld(true);
  }
}
