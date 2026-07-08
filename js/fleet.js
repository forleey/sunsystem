// NPC fleet — Star Trek stations & traffic. Every position is an analytic
// function of sim time in the physics frame (km, ecliptic): warp-proof,
// zero integration cost, and independent of the player's Kepler rails.
import * as THREE from 'three';
import { toRender } from './scene.js?v=81';
import { G0 } from './data.js?v=81';
import {
  buildSpacedock, buildRingStation, buildGateway, buildISS,
  buildFreighter, buildWarship, buildScout,
} from './fleet_meshes.js?v=81';
import { loadInto, whitewashObject } from './models.js?v=81';
import { applyGreebleShading } from './greeble.js?v=81';
import { buildGreebleStation } from './megastation.js?v=81';

// open-source GLBs (R2-hosted) swapped over the procedural fallbacks;
// yaw/pitch/roll turn each model's nose to -Z (checked in model_viewer.html?axes=1)
const mkISS = () => loadInto(buildISS(THREE), 'iss.glb', { lengthKm: 0.109, blinkers: 0 });
const mkFreighter = () => loadInto(buildFreighter(THREE), 'freighter.glb', { lengthKm: 0.24, yaw: 0, blinkers: 3 });
const mkWarship = () => loadInto(buildWarship(THREE), 'warship.glb', { lengthKm: 0.16, yaw: Math.PI, blinkers: 3 });
const mkScout = () => loadInto(buildScout(THREE), 'scout.glb', { lengthKm: 0.06, yaw: Math.PI, blinkers: 2 });
const mkHauler = () => loadInto(buildFreighter(THREE), 'hauler.glb', { lengthKm: 0.28, yaw: 0, blinkers: 3 });
// Smithsonian Discovery scan comes in launch pose: nose -Y, belly -Z
const mkShuttle = () => loadInto(buildScout(THREE), 'shuttle.glb', { lengthKm: 0.037, pitch: Math.PI / 2, roll: Math.PI, blinkers: 0 });

const TAU = Math.PI * 2;
const smooth = u => u * u * (3 - 2 * u);
const FWD = new THREE.Vector3(0, 0, -1);

export class Fleet {
  constructor(scene, sim) {
    this.sim = sim;
    this.scene = scene;
    this.objects = [];
    this.byName = new Map();
    this.tmp = new THREE.Vector3();
    this.tmpD = new THREE.Vector3();
    const B = n => sim.body(n);
    const S = n => this.byName.get(n);

    // ---------- stations: real circular gravity orbits around their parent ----------
    this.addOrbiter('Spacedock One', buildSpacedock(THREE), B('Earth'), 45000, 1.2, 0.10, 4.2, 0.02);
    this.addOrbiter('Utopia Planitia', buildRingStation(THREE), B('Mars'), 15000, 3.9, 0.30, 2.2, 0.05);
    // megastructures: Jove Gateway is Moon-class (~3470 km), Cronos Station and
    // the free-flying belt hub K-7 are Pluto-class (~2380 km); slow, stately spin
    const jove = buildGateway(THREE); jove.scale.setScalar(632);          // 5.5 km build -> 3475 km
    this.addOrbiter('Jove Gateway', jove, B('Jupiter'), 450000, 0.4, 0.15, 1737, 0.008);
    const cronos = buildRingStation(THREE); cronos.scale.setScalar(594);  // 4 km build -> 2376 km
    this.addOrbiter('Cronos Station', cronos, B('Saturn'), 400000, 2.2, 0.40, 1190, 0.01);
    // K-7: O'Neill cylinder habitat — spins around its long axis (set vertical,
    // so the orbiter spin drives the gravity rotation). White hull, warm window
    // stripes; owns its palette (noWash), so it skips the fleet whitewash.
    const k7 = buildGreebleStation(THREE, { seed: 7 });
    k7.scale.setScalar(297);
    this.addOrbiter('Station K-7', k7, B('Sun'), 4.19e8, 2.6, 0.12, 1190, 0.02);
    // other megastructures get procedural hull detailing (panels, seams, windows)
    applyGreebleShading(jove);
    applyGreebleShading(cronos);
    this.addOrbiter('ISS', mkISS(), B('Earth'), 6791, 0.0, 0.90, 0.06, 0);
    // NASA Gateway (real CAD model) parked around the Moon
    this.addOrbiter('Lunar Gateway', loadInto(buildISS(THREE), 'gateway_station.glb', { lengthKm: 0.04, blinkers: 0 }),
      B('Moon'), 3500, 1.0, 1.20, 0.025, 0);

    // ---------- warship patrols: powered impulse circles, visibly moving at warp 1 ----------
    this.addPatrol('USS Defiant', mkWarship(), B('Earth'), 52000, 260, 0.0, 0.35);
    this.addPatrol('USS Excalibur', mkWarship(), B('Earth'), 62000, 340, 2.1, -0.50);
    this.addPatrol('USS Reliant', mkWarship(), B('Jupiter'), 300000, 600, 1.0, 0.30);
    this.addPatrol('USS Grissom', mkScout(), B('Venus'), 30000, 300, 0.5, 0.70);

    // ---------- lanes: ping-pong runs between two anchors (bodies or stations) ----------
    this.addLane('SS Kobayashi Maru', mkFreighter(), B('Earth'), B('Mars'), 3.456e6, 0.15, 2e6);
    this.addLane('SS Botany Bay', mkHauler(), B('Earth'), B('Jupiter'), 1.0368e7, 0.62, 5e6);
    this.addLane('SS Lakul', mkFreighter(), B('Mars'), B('Saturn'), 1.728e7, 0.40, 8e6);
    this.addLane('USS Oberth', mkScout(), B('Earth'), B('Moon'), 240, 0.0, 30000);
    // the real Discovery orbiter commutes between Spacedock and the ISS
    this.addLane('Shuttle Galileo', mkShuttle(), S('Spacedock One'), S('ISS'), 90, 0.0, 3000);
    const cop = mkScout(); cop.scale.setScalar(0.45);
    this.addLane('Shuttle Copernicus', cop, S('Spacedock One'), B('Moon'), 300, 0.5, 40000);

    // fleet paint scheme on the procedural stations & fallbacks (GLB swaps
    // run through the same wash inside models.js normalize). K-7 opts out.
    for (const o of this.objects) if (!o.grp.userData.noWash) whitewashObject(o.grp);
  }

  register(o) {
    o.pos = { x: 0, y: 0, z: 0 };
    o.pos2 = { x: 0, y: 0, z: 0 };
    this.scene.add(o.grp);
    this.objects.push(o);
    this.byName.set(o.name, o);
    return o;
  }

  // circular orbit obeying the parent's real gravity (stations, ISS)
  addOrbiter(name, grp, parent, R, th0, incl, radiusKm, spin) {
    const om = Math.sqrt(G0 * parent.m / (R * R * R));
    return this.register({
      name, grp, parent, kind: 'station', radiusKm, spin, label: true, hDiff: 1,
      state: (t, out) => Fleet.circleState(parent, R, th0 + om * t, incl, out),
      velAt: (t, out) => Fleet.circleVel(parent, R, om, th0 + om * t, incl, out),
    });
  }

  // powered patrol circle (impulse flight, period P seconds of sim time)
  addPatrol(name, grp, parent, R, P, th0, incl) {
    const om = TAU / P;
    return this.register({
      name, grp, parent, kind: 'ship', radiusKm: 0.4, label: false, hDiff: P / 400,
      state: (t, out) => Fleet.circleState(parent, R, th0 + om * t, incl, out),
      velAt: (t, out) => Fleet.circleVel(parent, R, om, th0 + om * t, incl, out),
    });
  }

  // ping-pong transit between two anchors, with an arc lifted out of the ecliptic
  addLane(name, grp, a, b, legT, phase, lift) {
    const uAt = t => {
      const s = (((t / legT + phase) % 2) + 2) % 2;
      return smooth(s < 1 ? s : 2 - s);
    };
    const aVel = { x: 0, y: 0, z: 0 }, bVel = { x: 0, y: 0, z: 0 };
    const anchorVel = (anc, t, out) => {
      if (anc.velAt) anc.velAt(t, out);
      else { out.x = anc.vel.x; out.y = anc.vel.y; out.z = anc.vel.z; }
    };
    const o = this.register({
      name, grp, kind: 'ship', radiusKm: 0.3, label: false, hDiff: Math.max(0.5, legT / 400),
      state: (t, out) => {
        const u = uAt(t);
        const A = a.pos, Bp = b.pos;
        out.x = A.x + (Bp.x - A.x) * u;
        out.y = A.y + (Bp.y - A.y) * u;
        out.z = A.z + (Bp.z - A.z) * u + Math.sin(Math.PI * u) * lift;
      },
      velAt: (t, out) => {
        // parametric part via finite difference (anchors frozen) ...
        o.state(t, o.pos2); o.state(t + o.hDiff, out);
        out.x = (out.x - o.pos2.x) / o.hDiff;
        out.y = (out.y - o.pos2.y) / o.hDiff;
        out.z = (out.z - o.pos2.z) / o.hDiff;
        // ... plus the anchors' own motion, blended by transit progress
        const u = uAt(t);
        anchorVel(a, t, aVel); anchorVel(b, t, bVel);
        out.x += aVel.x * (1 - u) + bVel.x * u;
        out.y += aVel.y * (1 - u) + bVel.y * u;
        out.z += aVel.z * (1 - u) + bVel.z * u;
      },
    });
    return o;
  }

  static circleState(parent, R, th, incl, out) {
    const c = Math.cos(th), s = Math.sin(th);
    const ci = Math.cos(incl), si = Math.sin(incl);
    out.x = parent.pos.x + R * c;
    out.y = parent.pos.y + R * s * ci;
    out.z = parent.pos.z + R * s * si;
  }

  // analytic velocity of a circle path INCLUDING the parent body's own motion
  static circleVel(parent, R, om, th, incl, out) {
    const v = R * om;
    out.x = parent.vel.x - v * Math.sin(th);
    out.y = parent.vel.y + v * Math.cos(th) * Math.cos(incl);
    out.z = parent.vel.z + v * Math.cos(th) * Math.sin(incl);
    return out;
  }

  velOf(o, t, out) {
    if (o.combat) { out.x = o.combat.vel.x; out.y = o.combat.vel.y; out.z = o.combat.vel.z; return out; }
    o.velAt(t, out);
    return out;
  }

  // detach a combat-spawned object (raiders) from the scene and registry
  remove(o) {
    this.scene.remove(o.grp);
    const i = this.objects.indexOf(o);
    if (i >= 0) this.objects.splice(i, 1);
    this.byName.delete(o.name);
  }

  // phase 1: advance every object's physics-frame position (run BEFORE the
  // focus position is resolved, or a focused NPC lags its own camera origin).
  // Objects drafted into combat fly free — their agent position wins.
  tick(simT) {
    for (const o of this.objects) {
      if (o.combat) { o.pos.x = o.combat.pos.x; o.pos.y = o.combat.pos.y; o.pos.z = o.combat.pos.z; }
      else o.state(simT, o.pos);
    }
  }

  // phase 2: render placement relative to the focus
  place(focusPos, simT, dtWall) {
    const blinkT = performance.now() * 0.006;
    for (const o of this.objects) {
      this.tmp.set(o.pos.x - focusPos.x, o.pos.y - focusPos.y, o.pos.z - focusPos.z);
      toRender(this.tmp, o.grp.position);

      if (o.kind === 'ship') {
        if (o.combat) {
          // combat agents aim where the AI points them
          o.grp.quaternion.setFromUnitVectors(FWD, o.combat.faceR);
        } else {
          // face along the direction of travel
          o.state(simT + o.hDiff, o.pos2);
          this.tmpD.set(o.pos2.x - o.pos.x, o.pos2.z - o.pos.z, -(o.pos2.y - o.pos.y));
          if (this.tmpD.lengthSq() > 1e-12) {
            this.tmpD.normalize();
            o.grp.quaternion.setFromUnitVectors(FWD, this.tmpD);
          }
        }
      } else if (o.spin) {
        o.grp.rotation.y += o.spin * dtWall;
      }

      const bl = o.grp.userData.blinkers;
      if (bl && bl.length) {
        for (let i = 0; i < bl.length; i++) {
          bl[i].material.emissiveIntensity = Math.sin(blinkT + i * 1.7) > 0.35 ? 2.4 : 0.12;
        }
      }
      // internal animation (K-7 flying-traffic skylanes)
      if (o.grp.userData.animate) o.grp.userData.animate(performance.now() * 0.001);
    }
  }
}
