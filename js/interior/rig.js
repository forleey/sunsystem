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
//
// The interior camera is posed by one of three owners (this.mode):
//   walk    the Walk controller (the game)
//   rail    the debug rail under the well (perf ride, ?pose=rail)
//   manual  whoever set it last (self-tests aim it themselves)
import * as THREE from 'three';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { CAMERA, DECK_ANCHOR_KM, HULL_GLASS_LAYER, M_TO_KM, POSES, WALK, hullToInterior, railPointHull } from './hull_frame.js?v=103';
import { buildDeck } from './deck.js?v=103';
import { Walk } from './walk.js?v=103';
import { InteriorLighting } from './lighting.js?v=103';
import { buildSwatchStrip, setTexturesWanted } from './trim.js?v=103';
import { toRender } from '../scene.js?v=103';

const v3 = (p) => new THREE.Vector3(p.x, p.y, p.z);
const DEFAULT_HINT = 'WASD walk · mouse look · E use · V leave';

export class InteriorRig {
  // getFocus/setFocus reach into main.js's focusName; stage owns the composer;
  // hintEl is the one-line prompt bar shown while boarded
  constructor({ stage, shipView, sim, getFocus, setFocus, hintEl = null }) {
    this.stage = stage;
    this.shipView = shipView;
    this.sim = sim;
    this.getFocus = getFocus;
    this.setFocus = setFocus;
    this.hintEl = hintEl;
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

    const q = new URLSearchParams(location.search);
    if (q.get('trim') === '0') setTexturesWanted(false);   // tints and shading alone, no sheets
    this.deck = buildDeck(this.scene);
    this.lighting = new InteriorLighting({ scene: this.scene, renderer: stage.renderer });
    if (q.get('pose') === 'swatch') this.scene.add(buildSwatchStrip());
    this.walk = new Walk({ deck: this.deck, camera: this.camera, hint: (t) => this.showHint(t) });
    this.mode = 'walk';
    this.railT = null;

    this._anchor = v3(DECK_ANCHOR_KM);
    this._tmp = new THREE.Vector3();
    this._prevFocus = null;
    this._prevFov = stage.camera.fov;
    this._prevMask = stage.camera.layers.mask;
  }

  showHint(text) {
    if (!this.hintEl) return;
    this.hintEl.textContent = text || DEFAULT_HINT;
    this.hintEl.classList.toggle('prompt', !!text);
  }

  // ?pose=<name> puts the camera at a fixed pose after boarding (screenshots):
  // rail (with &t=0..1), cupola, cockpit, hold, corridor, tunnel, bunks,
  // engineering, airlock, swatch. ?sun=<alt>,<az> (degrees) turns the ship so
  // the real sun stands at that altitude over the cupola ring plane and
  // azimuth around the well (0 = toward the nose, 90 = starboard).
  // Returns true when the URL named a pose.
  applyUrlPose() {
    const q = new URLSearchParams(location.search);
    const sun = q.get('sun');
    if (sun) {
      const [alt, az] = sun.split(',').map(Number);
      if (Number.isFinite(alt)) this.setSun(alt * Math.PI / 180, (Number.isFinite(az) ? az : 0) * Math.PI / 180);
    }
    const pose = q.get('pose');
    if (!pose) return false;
    if (pose === 'rail') {
      const t = parseFloat(q.get('t'));
      this.setRail(Number.isFinite(t) ? t : 0);
      return true;
    }
    return this.setPose(pose);
  }

  // debug pose: a straight line under the well, looking up at the opening.
  // Screen up is the ship's nose, so the parallax reads as a sideways slide.
  setRail(t) {
    this.mode = 'rail';
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

  // a named pose from hull_frame POSES: seats the player or stands them at the
  // eye point, looking at the pose's target. The walk controller owns the
  // camera afterwards, so the pose is a real game state, not a detached camera.
  setPose(name) {
    const p = POSES[name];
    if (!p || name === 'rail') return false;
    this.mode = 'walk'; this.railT = null;
    const eye = hullToInterior(p.eye.x, p.eye.y, p.eye.z);
    const look = hullToInterior(p.lookAt.x, p.lookAt.y, p.lookAt.z);
    const d = { x: look.x - eye.x, y: look.y - eye.y, z: look.z - eye.z };
    const yaw = Math.atan2(-d.x, -d.z), pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    if (p.seat) {
      this.walk.poseSeat(p.seat);
      this.walk.yaw = yaw; this.walk.pitch = pitch;
      this.walk.step(0, {});
    } else {
      this.walk.poseStand({ x: eye.x, y: eye.y - WALK.eye, z: eye.z }, yaw, pitch);
    }
    return true;
  }

  // self-tests that aim the camera themselves call this first
  setManual() { this.mode = 'manual'; this.railT = null; }

  // turn the ship so the sun stands at (alt, az) in the interior frame: the
  // attitude q maps interior directions onto render directions, so q takes
  // the wanted interior sun direction onto the real one. Stops any spin.
  setSun(alt, az) {
    const ship = this.sim.ship, sun = this.sim.bodies[0];
    const real = toRender(new THREE.Vector3(sun.pos.x - ship.pos.x, sun.pos.y - ship.pos.y, sun.pos.z - ship.pos.z), new THREE.Vector3()).normalize();
    // interior: nose is -Z, starboard +X (hull frame mirrored in X and Z)
    const want = new THREE.Vector3(-Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));
    this.shipView.quat.setFromUnitVectors(want, real);
    this.shipView.angVel.set(0, 0, 0);
    this.update(0);
  }

  board({ spawn = true } = {}) {
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
    this.mode = 'walk'; this.railT = null;
    if (spawn) this.walk.spawn();
    this.walk.attach(stage.renderer.domElement);
    this.showHint(null);
    this.update(0);
    return true;
  }

  leave() {
    if (!this.boarded) return false;
    const stage = this.stage;
    this.walk.detach();
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
  update(dt = 0) {
    if (!this.boarded) return;
    if (this.mode === 'walk' && dt > 0) this.walk.update(dt);
    this.lighting.update({ sim: this.sim, shipView: this.shipView, eye: this.camera.position });
    const q = this.shipView.quat, cam = this.stage.camera;
    this._tmp.copy(this.camera.position).multiplyScalar(M_TO_KM).add(this._anchor).applyQuaternion(q);
    cam.position.copy(this._tmp).add(this.shipView.grp.position);
    cam.quaternion.copy(q).multiply(this.camera.quaternion);
    cam.up.set(0, 1, 0).applyQuaternion(q);
    cam.updateMatrixWorld(true);
  }
}
