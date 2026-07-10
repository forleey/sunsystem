// Constitution-class-ish starship from primitives + helm input. Render axes; forward = -Z.
// An open-source GLB (R2-hosted) swaps over the primitives once loaded.
import * as THREE from 'three';
import { toRender } from './scene.js?v=92';
import { C_KMS } from './data.js?v=92';
import { loadModel } from './models.js?v=92';

export function fromRender(v, out) { return out.set(v.x, -v.z, v.y); }

const HULL = new THREE.MeshStandardMaterial({ color: 0xccd3dd, metalness: 0.45, roughness: 0.4 });
const DARK = new THREE.MeshStandardMaterial({ color: 0x6b7480, metalness: 0.6, roughness: 0.5 });

// soft radial glow for the additive engine sprites. Per-pixel Gaussian that
// hits exactly zero at the disc edge (and the quad corners), so the additive
// blob can never show a square boundary or bloom into a box.
const GLOW_TEX = (() => {
  const N = 128, c = document.createElement('canvas'); c.width = c.height = N;
  const x = c.getContext('2d'), img = x.createImageData(N, N), d = img.data;
  for (let yy = 0; yy < N; yy++) for (let xx = 0; xx < N; xx++) {
    const dx = (xx - (N - 1) / 2) / ((N - 1) / 2), dy = (yy - (N - 1) / 2) / ((N - 1) / 2);
    const r = Math.hypot(dx, dy);
    const a = Math.exp(-r * r * 3.4) * Math.max(0, 1 - r);   // round, zero at r>=1
    const i = (yy * N + xx) * 4;
    d[i] = d[i + 1] = d[i + 2] = 255;
    d[i + 3] = Math.round(Math.min(1, Math.max(0, a)) * 255);
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();

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
    this.angVel = new THREE.Vector3();   // local pitch/yaw/roll rates, rad/s (rotational inertia)
    this.glow = 0;                       // throttle glow, lagged (afterburner feel)
    this.selfGlow = 1.2;                 // ship-light emissive level (editor-tunable)
    this.exhaustMul = 0.36;              // exhaust brightness multiplier (editor-tunable)
    this.exhaustColor = new THREE.Color(0xd8e7f3);   // exhaust tint, multiplies base (editor-tunable)
  }

  buildMesh() {
    const g = new THREE.Group();          // procedural fallback, replaced by GLB
    g.visible = false;                    // stays hidden unless the GLB fails — no old-ship flash
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
    // soft engine halo light: brightens with throttle, no protruding jets
    const lamp = new THREE.PointLight(0x88bbff, 0, 0.6, 2);
    lamp.position.set(0, 0.02, 0.09);
    this.grp.add(lamp); this.lamp = lamp;   // on grp: survives the GLB swap
    // soft self-fill from the ship's own lights: lifts the shadow side a touch
    // out of pure silhouette (short range, so it barely touches anything else)
    const selfLit = new THREE.PointLight(0x414044, 1.8, 0.5, 2);
    selfLit.position.set(0, 0.02, 0);
    this.grp.add(selfLit); this.selfLit = selfLit;   // editor-tunable fill

    // exhaust: soft additive glow sprites (heavily blurred, no hard edges) for
    // the nozzles and the plume/schweif. Billboarded, on grp so they survive
    // the GLB swap. Size/length + brightness are driven by throttle in update.
    const spr = (r, g, b) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: GLOW_TEX, color: new THREE.Color(r, g, b), transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      s.frustumCulled = false; return s;
    };
    const ex = new THREE.Group();
    this.noz = [];
    for (const sx of [-1, 1]) {
      const n = spr(1.7, 2.3, 4.2); n.position.set(sx * 0.017, 0.004, 0.052);
      ex.add(n); this.noz.push(n);
    }
    // plume = a trail of soft puffs along +Z: stays 3D-directional but every
    // blob is a blurred glow. Positions/opacity set in update (grows w/ throttle).
    this.puffs = [];
    for (let i = 0; i < 7; i++) { const p = spr(0.9 - i * 0.02, 1.5 - i * 0.05, 3 - i * 0.16); ex.add(p); this.puffs.push(p); }
    this.plumeHalo = spr(0.5, 1.0, 2.2); this.plumeHalo.position.set(0, 0.004, 0.055); ex.add(this.plumeHalo);
    this.grp.add(ex);
    // remember each sprite's base colour so the editor tint can multiply it
    this.exAll = [...this.noz, ...this.puffs, this.plumeHalo];
    for (const s of this.exAll) s.userData.base = s.material.color.clone();
  }

  // swap in the hero GLB; the throttle-glow loop in update() then drives the
  // hull's own emissive map (engine ports + windows) instead of add-on discs
  _loadGLB() {
    const reveal = setTimeout(() => { this.fallback.visible = true; }, 6000);   // stuck load
    loadModel('player.glb', { lengthKm: 0.11, yaw: Math.PI, blinkers: 0, player: true }).then(m => {
      clearTimeout(reveal);
      this.grp.remove(this.fallback);
      this.grp.add(m);
      const glows = [];
      m.traverse(n => { if (n.isMesh && n.material && n.material.emissiveMap) glows.push(n); });
      if (glows.length) this.grilles = glows;
      this.lamp.position.set(0, 0.0, 0.06);
    }).catch(() => { clearTimeout(reveal); this.fallback.visible = true; });   // primitives on failure
  }

  // keys: Set of pressed key codes; shipG: slider value in g
  update(focusPos, camera, dtWall, keys, shipG) {
    const sim = this.sim, ship = sim.ship;
    const dt = Math.min(dtWall, 0.05);
    // rotational inertia: keys command angular acceleration; releasing lets the
    // ship keep turning while RCS-style damping bleeds the rate back to zero
    const ACC = 6.5, MAX = 1.7, DAMP = 7.0, av = this.angVel;   // low inertia: snappy in, quick settle
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

    // engine glow: only the nozzles flare, lagged behind the throttle (a quick
    // spool-up, slow fade). The plume lengthens with throttle, so the faster
    // you push, the longer the schweif. Hull windows stay a steady dim.
    const target = ship.autopilot ? 1 : (ship.thrustAcc > 0 ? Math.max(0.12, ship.throttle) : 0);
    const rate = target > this.glow ? 6 : 2.2;
    this.glow += (target - this.glow) * (1 - Math.exp(-rate * dt));
    const gl = this.glow, pf = 0.85 + 0.15 * Math.sin(performance.now() * 0.03);
    const em = this.exhaustMul;
    for (const n of this.noz) { const s = 0.022 + gl * 0.026; n.scale.set(s, s, 1); n.material.opacity = (0.1 + gl * 0.5) * pf * em; }
    const len = 0.04 + gl * 0.16;                                 // schweif length grows with throttle
    const step = len / this.puffs.length;
    for (let i = 0; i < this.puffs.length; i++) {
      const p = this.puffs[i], f = i / this.puffs.length;         // 0..1 along the trail
      p.position.set(0, 0.004, 0.055 + (i + 0.5) * step);
      const s = (0.05 - f * 0.028) * (0.5 + gl * 0.55);
      p.scale.set(s, s, 1);
      p.material.opacity = gl * (1 - f) * 0.4 * pf * em;
    }
    const hs = 0.05 + gl * 0.035;
    this.plumeHalo.scale.set(hs, hs, 1);
    this.plumeHalo.material.opacity = gl * 0.32 * pf * em;
    this.lamp.intensity = gl * 0.5;
    for (const s of this.exAll) s.material.color.copy(s.userData.base).multiply(this.exhaustColor);   // editor tint
    for (const gr of this.grilles) gr.material.emissiveIntensity = this.selfGlow * pf;   // ship lights (editor-tunable)
  }
}
