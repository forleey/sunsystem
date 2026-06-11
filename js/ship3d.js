// Constitution-class-ish starship from primitives + helm input. Render axes; forward = -Z.
import * as THREE from 'three';
import { toRender } from './scene.js?v=7';
import { G_ACC } from './data.js?v=7';

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
    this.buildDust(scene);
  }

  // co-moving debris specks around the ship: motionless while coasting with them,
  // streaming past under thrust — makes acceleration readable at realistic scales
  buildDust(scene) {
    const N = this.dustN = 360, R = this.dustR = 7;        // km
    this.dustP = new Float64Array(N * 3);                  // world pos (physics frame)
    this.dustV = new Float64Array(N * 3);                  // frozen velocity at spawn
    this.dustLive = new Uint8Array(N);                     // 0 = needs respawn
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    this.dustGeo = geo;
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0x93a8c8, size: 0.035, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }));
    pts.frustumCulled = false;
    scene.add(pts);
  }

  updateDust(focusPos, simDt) {
    const s = this.sim.ship, N = this.dustN, R = this.dustR;
    const P = this.dustP, V = this.dustV, out = this.dustGeo.attributes.position.array;
    for (let i = 0; i < N; i++) {
      const j = i * 3;
      if (this.dustLive[i]) { P[j] += V[j] * simDt; P[j + 1] += V[j + 1] * simDt; P[j + 2] += V[j + 2] * simDt; }
      const dx = P[j] - s.pos.x, dy = P[j + 1] - s.pos.y, dz = P[j + 2] - s.pos.z;
      if (!this.dustLive[i] || dx * dx + dy * dy + dz * dz > R * R) {
        const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
        const r = R * Math.cbrt(Math.random()), q = Math.sqrt(1 - u * u);
        P[j] = s.pos.x + r * q * Math.cos(th);
        P[j + 1] = s.pos.y + r * q * Math.sin(th);
        P[j + 2] = s.pos.z + r * u;
        V[j] = s.vel.x; V[j + 1] = s.vel.y; V[j + 2] = s.vel.z;
        this.dustLive[i] = 1;
      }
      // render relative to focus, ecliptic → render axes (x, z, -y)
      out[j] = P[j] - focusPos.x;
      out[j + 1] = P[j + 2] - focusPos.z;
      out[j + 2] = -(P[j + 1] - focusPos.y);
    }
    this.dustGeo.attributes.position.needsUpdate = true;
  }

  buildMesh() {
    const g = this.grp;
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
      g.add(grille);
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.0035, 0.045, 0.018), DARK);
      pylon.position.set(sx * 0.0165, -0.006, 0.055);
      pylon.rotation.z = sx * 0.6;
      g.add(pylon);
      // engine exhaust glow
    }
    this.plumes = [];
    for (const sx of [-1, 1]) {
      const plume = new THREE.Mesh(
        new THREE.ConeGeometry(0.0028, 0.05, 16, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0x2f7fc4, transparent: true, opacity: 0.32,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        })
      );
      plume.rotation.x = -Math.PI / 2;
      plume.position.set(sx * 0.031, 0.012, 0.112);
      plume.scale.set(1, 0.01, 1);
      g.add(plume); this.plumes.push(plume);
    }
    const lamp = new THREE.PointLight(0x88bbff, 0.0, 0.5, 2);
    lamp.position.set(0, 0.02, 0.1);
    g.add(lamp); this.lamp = lamp;
  }

  // keys: Set of pressed key codes; shipG: slider value in g; simDt: warped sim seconds this frame
  update(focusPos, camera, dtWall, keys, shipG, simDt = 0) {
    const sim = this.sim, ship = sim.ship;
    const dt = Math.min(dtWall, 0.05);
    // rotational inertia: keys command angular acceleration; releasing lets the
    // ship keep turning while RCS-style damping bleeds the rate back to zero
    const ACC = 2.2, MAX = 1.5, DAMP = 1.6, av = this.angVel;
    const inp = {
      x: (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0),
      y: (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0),
      z: (keys.has('KeyQ') ? 1 : 0) - (keys.has('KeyE') ? 1 : 0),
    };
    for (const a of ['x', 'y', 'z']) {
      if (inp[a]) av[a] = Math.max(-MAX, Math.min(MAX, av[a] + inp[a] * ACC * dt));
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
      // throttle spools up over ~10 s to the slider g — no instant full burn
      if (keys.has('Space')) {
        ship.throttle = Math.min(1, ship.throttle + dt / 10);
        fromRender(this.fwd, ship.thrustDir).norm();
      } else {
        ship.throttle = 0;
      }
      ship.thrustAcc = ship.throttle * shipG * G_ACC;
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

    this.updateDust(focusPos, simDt);

    // engine feedback — visible glow from the first sliver of throttle
    const thr = Math.min(1, ship.lastG / Math.max(shipG, 1));
    const lit = ship.autopilot ? 1 : ship.throttle > 0 ? 1 : 0;
    const pulse = 0.85 + 0.15 * Math.sin(performance.now() * 0.02);
    for (const p of this.plumes) {
      p.scale.set(1 + thr * 0.3, Math.max(lit * 0.25, thr * (0.9 + Math.min(1.2, Math.log10(1 + ship.lastG) * 0.25))) * pulse, 1 + thr * 0.3);
      p.material.opacity = lit * 0.22 + 0.35 * Math.min(1, thr);
    }
    for (const b of this.bussards) b.material.emissiveIntensity = 1.4 + pulse * 0.8;
    this.lamp.intensity = ship.lastG > 0 ? 0.8 : 0;
  }
}
