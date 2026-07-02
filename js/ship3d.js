// Constitution-class-ish starship from primitives + helm input. Render axes; forward = -Z.
// An open-source GLB (R2-hosted) swaps over the primitives once loaded.
import * as THREE from 'three';
import { toRender } from './scene.js?v=35';
import { C_KMS } from './data.js?v=35';
import { loadModel } from './models.js?v=35';

export function fromRender(v, out) { return out.set(v.x, -v.z, v.y); }

const HULL = new THREE.MeshStandardMaterial({ color: 0xccd3dd, metalness: 0.45, roughness: 0.4 });
const DARK = new THREE.MeshStandardMaterial({ color: 0x6b7480, metalness: 0.6, roughness: 0.5 });

function capsule(r, l, mat) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, l, 8, 20), mat);
  m.rotation.x = Math.PI / 2;   // along Z
  return m;
}

export class ShipView {
  constructor(scene, sim) {
    this.sim = sim;
    this.grp = new THREE.Group();
    this.quat = this.grp.quaternion;
    this.buildMesh();
    scene.add(this.grp);
    this.fwd = new THREE.Vector3();
    this.tmp = new THREE.Vector3();
    this.tmpV = new THREE.Vector3();
    this.angVel = new THREE.Vector3();   // local pitch/yaw/roll rates, rad/s — rotational inertia
  }

  buildMesh() {
    const g = new THREE.Group();          // procedural fallback, replaced by GLB
    this.grp.add(g);
    this.fallback = g;
    this._loadGLB();
    // saucer
    const saucer = new THREE.Mesh(new THREE.SphereGeometry(0.0635, 48, 24), HULL);
    saucer.scale.set(1, 0.17, 1);
    saucer.position.set(0, 0.018, -0.085);
    g.add(saucer);
    const bridge = new THREE.Mesh(new THREE.SphereGeometry(0.009, 24, 12), HULL);
    bridge.scale.set(1, 0.6, 1);
    bridge.position.set(0, 0.029, -0.085);
    g.add(bridge);
    // engineering hull
    const eng = capsule(0.0125, 0.075, HULL);
    eng.position.set(0, -0.022, 0.01);
    g.add(eng);
    // deflector dish
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.009, 24, 12), new THREE.MeshStandardMaterial({
      color: 0xd89030, emissive: 0xff9920, emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.2,
    }));
    dish.scale.set(1, 1, 0.45);
    dish.position.set(0, -0.022, -0.0405);
    g.add(dish);
    // neck
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.034, 0.045), HULL);
    neck.position.set(0, -0.001, -0.045);
    neck.rotation.x = 0.45;
    g.add(neck);
    // nacelles + pylons + bussards + grilles
    this.bussards = []; this.grilles = [];
    for (const sx of [-1, 1]) {
      const nac = capsule(0.0055, 0.085, HULL);
      nac.position.set(sx * 0.031, 0.012, 0.065);
      g.add(nac);
      const buss = new THREE.Mesh(new THREE.SphereGeometry(0.0054, 20, 12), new THREE.MeshStandardMaterial({
        color: 0xff3018, emissive: 0xff2a10, emissiveIntensity: 2.2, roughness: 0.4,
      }));
      buss.position.set(sx * 0.031, 0.012, 0.0205);
      g.add(buss); this.bussards.push(buss);
      const grille = new THREE.Mesh(new THREE.BoxGeometry(0.0015, 0.006, 0.07), new THREE.MeshStandardMaterial({
        color: 0x3ec8ff, emissive: 0x2fb8ff, emissiveIntensity: 0.9,
      }));
      grille.position.set(sx * (0.031 - 0.0052), 0.012, 0.062);
      g.add(grille); this.grilles.push(grille);
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.0035, 0.045, 0.018), DARK);
      pylon.position.set(sx * 0.0165, -0.006, 0.055);
      pylon.rotation.z = sx * 0.6;
      g.add(pylon);
    }
    // soft engine halo light — brightens with throttle, no protruding jets
    const lamp = new THREE.PointLight(0x88bbff, 0, 0.6, 2);
    lamp.position.set(0, 0.02, 0.09);
    this.grp.add(lamp); this.lamp = lamp;   // on grp: survives the GLB swap
  }

  // swap in the hero GLB; rebuild engine grilles at its stern so the
  // throttle-glow loop in update() keeps working unchanged
  _loadGLB() {
    loadModel('player.glb', { lengthKm: 0.19, yaw: Math.PI, blinkers: 0 }).then(m => {
      this.grp.remove(this.fallback);
      this.grp.add(m);
      // additive glow discs sitting in the twin exhaust ports
      const grilles = [];
      for (const sx of [-1, 1]) {
        const gr = new THREE.Mesh(new THREE.CircleGeometry(0.0065, 20), new THREE.MeshStandardMaterial({
          color: 0x000000, emissive: 0x2fb8ff, emissiveIntensity: 0.9,
          transparent: true, opacity: 0.95, depthWrite: false,
          blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        }));
        gr.position.set(sx * 0.0125, 0.001, 0.0915);
        m.add(gr); grilles.push(gr);
      }
      this.grilles = grilles;
      this.lamp.position.set(0, 0.0, 0.1);
    }).catch(() => {});   // primitives stay on failure
  }

  // keys: Set of pressed key codes; shipG: slider value in g
  update(focusPos, camera, dtWall, keys, shipG) {
    const sim = this.sim, ship = sim.ship;
    const dt = Math.min(dtWall, 0.05);
    // rotational inertia: keys command angular acceleration; releasing lets the
    // ship keep turning while RCS-style damping bleeds the rate back to zero
    const ACC = 4.4, MAX = 1.5, DAMP = 3.2, av = this.angVel;
    const SPD = { x: 0.5, y: 0.5, z: 1 };   // pitch/yaw at half rate, roll unchanged
    const inp = {
      x: (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0),
      y: (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0),
      z: (keys.has('KeyQ') ? 1 : 0) - (keys.has('KeyE') ? 1 : 0),
    };
    for (const a of ['x', 'y', 'z']) {
      const lim = MAX * SPD[a];
      if (inp[a]) av[a] = Math.max(-lim, Math.min(lim, av[a] + inp[a] * ACC * SPD[a] * dt));
      else {
        av[a] *= Math.exp(-DAMP * dt);
        if (Math.abs(av[a]) < 1e-4) av[a] = 0;
      }
    }
    const rot = new THREE.Quaternion(), ax = new THREE.Vector3();
    if (av.x) { rot.setFromAxisAngle(ax.set(1, 0, 0), av.x * dt); this.quat.multiply(rot); }
    if (av.y) { rot.setFromAxisAngle(ax.set(0, 1, 0), av.y * dt); this.quat.multiply(rot); }
    if (av.z) { rot.setFromAxisAngle(ax.set(0, 0, 1), av.z * 1.2 * dt); this.quat.multiply(rot); }

    this.fwd.set(0, 0, -1).applyQuaternion(this.quat);

    if (!ship.autopilot) {
      // slider G = max speed in multiples of c; constant burn reaches it in ~10 s
      const maxV = shipG * C_KMS;
      ship.maxV = maxV;
      if (keys.has('Space')) {
        ship.braking = false;
        ship.thrustAcc = maxV / 10;                         // full throttle in 10 s
        fromRender(this.fwd, ship.thrustDir).norm();
        ship.throttle = Math.min(1, ship.speed() / maxV);   // 0→1 as max v is reached
      } else {
        if (ship.thrustAcc > 0) ship.braking = true;  // just released — retro-burn to local rest
        ship.thrustAcc = 0;
        if (!ship.braking) ship.throttle = 0;         // while braking, physics owns the readout
      }
    } else {
      // visually align with autopilot thrust vector
      this.angVel.set(0, 0, 0);
      toRender(ship.thrustDir, this.tmp).normalize();
      const target = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), this.tmp);
      this.quat.slerp(target, Math.min(1, dt * 2.5));
    }

    // position relative to focus
    this.tmpV.set(ship.pos.x - focusPos.x, ship.pos.y - focusPos.y, ship.pos.z - focusPos.z);
    toRender(this.tmpV, this.grp.position);

    // engine glow — nacelle grilles brighten with throttle + a soft halo light
    const burning = ship.thrustAcc > 0 || ship.braking || ship.autopilot;
    const lvl = burning ? Math.max(0.15, ship.autopilot ? 1 : ship.throttle) : 0;
    const pulse = 0.9 + 0.1 * Math.sin(performance.now() * 0.02);
    for (const gr of this.grilles) gr.material.emissiveIntensity = (0.9 + lvl * 3.5) * pulse;
    this.lamp.intensity = lvl * 0.45;
  }
}
