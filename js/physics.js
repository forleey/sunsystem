// N-body gravity + starship with thrust & inertia. Positions in km (JS doubles), ecliptic frame:
// x,y in ecliptic plane (x = vernal equinox), z = ecliptic north.
import { G0, C_KMS, G_ACC, PLANETS, SUN, MOON } from './data.js?v=65';

const DEG = Math.PI / 180;

class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new V3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  scale(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  addScaled(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  len() { return Math.hypot(this.x, this.y, this.z); }
  norm() { const l = this.len() || 1; return this.scale(1 / l); }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
}
export { V3 };

function solveKepler(M, e) {
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 30; k++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  return E;
}

// Mean ecliptic elements -> heliocentric (or parent-centric) state vectors.
function elementsToState(el, GM) {
  const a = el.a, e = el.e, i = el.i * DEG, O = el.O * DEG;
  const w = (el.W - el.O) * DEG;          // argument of perihelion
  const M = ((el.L - el.W) * DEG) % (2 * Math.PI);
  const E = solveKepler(M, e);
  const cE = Math.cos(E), sE = Math.sin(E);
  const xp = a * (cE - e), yp = a * Math.sqrt(1 - e * e) * sE;
  const r = a * (1 - e * cE);
  const n = Math.sqrt(GM / (a * a * a));
  const vxp = -(n * a * a / r) * sE;
  const vyp = (n * a * a / r) * Math.sqrt(1 - e * e) * cE;
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(i), si = Math.sin(i);
  const rot = (px, py) => new V3(
    (cw * cO - sw * sO * ci) * px + (-sw * cO - cw * sO * ci) * py,
    (cw * sO + sw * cO * ci) * px + (-sw * sO + cw * cO * ci) * py,
    (sw * si) * px + (cw * si) * py
  );
  return { pos: rot(xp, yp), vel: rot(vxp, vyp) };
}

export class Body {
  constructor(def) {
    this.def = def;
    this.name = def.name;
    this.m = def.m;
    this.r = def.r;
    this.pos = new V3();
    this.vel = new V3();
    this.acc = new V3();
    this.trail = [];
  }
}

export class Ship {
  constructor() {
    this.pos = new V3();
    this.vel = new V3();
    this.u = new V3();            // proper velocity (gamma*v) for relativistic mode
    this.thrustDir = new V3(1, 0, 0);
    this.thrustAcc = 0;           // km/s^2, current commanded
    this.throttle = 0;            // 0..1, fraction of max v reached while burning
    this.maxV = C_KMS;            // manual-thrust speed limit (slider G × c)
    this.braking = false;         // retro-burn back to local rest after Space release
    this.autopilot = null;        // {targetFn, accel, arriveR, label}
    this.lastG = 0;
  }
  speed() { return this.vel.len(); }
}

export class Sim {
  constructor() {
    this.gMult = 1;
    this.warp = 1;
    this.relativistic = false;
    this.time = 0;                // s since J2000
    this.bodies = [new Body(SUN)];
    const sun = this.bodies[0];
    for (const p of PLANETS) {
      const b = new Body(p);
      const st = elementsToState(p, G0 * (SUN.m + p.m));
      b.pos.copy(st.pos); b.vel.copy(st.vel);
      this.bodies.push(b);
    }
    const earth = this.bodies.find(b => b.name === 'Earth');
    const moon = new Body(MOON);
    const ms = elementsToState(MOON, G0 * (earth.m + MOON.m));
    moon.pos.copy(earth.pos).add(ms.pos);
    moon.vel.copy(earth.vel).add(ms.vel);
    this.bodies.splice(this.bodies.indexOf(earth) + 1, 0, moon);
    for (const b of this.bodies.slice(1)) {
      const central = b.name === 'Moon' ? earth.m : SUN.m;
      b.period = 2 * Math.PI * Math.sqrt(b.def.a ** 3 / (G0 * central));
    }
    // zero total momentum so the system doesn't drift
    const P = new V3(), Msum = this.bodies.reduce((s, b) => s + b.m, 0);
    for (const b of this.bodies) P.addScaled(b.vel, b.m);
    P.scale(1 / Msum);
    for (const b of this.bodies) b.vel.sub(P);
    sun.pos.set(0, 0, 0);

    this.prePos = this.bodies.map(b => b.pos.clone());
    this.preVel = this.bodies.map(b => b.vel.clone());
    this.preAcc = this.bodies.map(b => b.acc.clone());
    this.ship = new Ship();
    this.resetShip();
    this.computeAcc();
  }

  body(name) { return this.bodies.find(b => b.name === name); }

  // beam the ship into a circular orbit around a body (R defaults to 3 radii).
  // side +1 parks on the sun-facing side (day side fills the view);
  // side -1 parks off the terminator, ~108 deg from the sun vector: the
  // planet shows a big lit crescent with city lights on the dark half.
  beamShipTo(name, R, side = 1) {
    const b = this.body(name), s = this.ship;
    if (!b) return false;
    R = R || Math.max(b.r * 3, b.r + 2000);
    const v = Math.sqrt(G0 * this.gMult * b.m / R);
    const sun = this.bodies[0];
    let rx = sun.pos.x - b.pos.x, ry = sun.pos.y - b.pos.y, rz = sun.pos.z - b.pos.z;
    const rl = Math.hypot(rx, ry, rz);
    if (rl < 1) { rx = 1; ry = 0; rz = 0; } else { rx /= rl; ry /= rl; rz /= rl; }
    if (side < 0) {
      const a = -1.25, c = Math.cos(a), sn = Math.sin(a);
      const nx = -(rx * c - ry * sn), ny = -(rx * sn + ry * c);
      rx = nx; ry = ny; rz = -rz;
    }
    const tl = Math.hypot(rx, ry) || 1;
    const tx = -ry / tl, ty = rx / tl;          // in-plane tangential for a circular orbit
    s.pos.set(b.pos.x + rx * R, b.pos.y + ry * R, b.pos.z + rz * R);
    s.vel.set(b.vel.x + tx * v, b.vel.y + ty * v, b.vel.z);
    s.u.copy(s.vel).scale(1 / Math.sqrt(Math.max(1e-12, 1 - (s.vel.len() / C_KMS) ** 2)));
    s.thrustAcc = 0;
    s.throttle = 0;
    s.braking = false;
    s.autopilot = null;
    return true;
  }

  resetShip() {
    // cinematic default: big Earth crescent off the terminator, 25,000 km out
    this.beamShipTo('Earth', 25000, -1);
  }

  // teleport the ship to an explicit state (used for beaming to stations/ships)
  placeShip(px, py, pz, vx, vy, vz) {
    const s = this.ship;
    s.pos.set(px, py, pz);
    s.vel.set(vx, vy, vz);
    s.u.copy(s.vel).scale(1 / Math.sqrt(Math.max(1e-12, 1 - (s.vel.len() / C_KMS) ** 2)));
    s.thrustAcc = 0;
    s.throttle = 0;
    s.braking = false;
    s.autopilot = null;
  }

  computeAcc() {
    const G = G0 * this.gMult, bs = this.bodies;
    for (const b of bs) b.acc.set(0, 0, 0);
    for (let i = 0; i < bs.length; i++) {
      const bi = bs[i];
      for (let j = i + 1; j < bs.length; j++) {
        const bj = bs[j];
        const dx = bj.pos.x - bi.pos.x, dy = bj.pos.y - bi.pos.y, dz = bj.pos.z - bi.pos.z;
        const r2 = dx * dx + dy * dy + dz * dz;
        const inv = 1 / (Math.sqrt(r2) * r2);
        const fi = G * bj.m * inv, fj = G * bi.m * inv;
        bi.acc.x += dx * fi; bi.acc.y += dy * fi; bi.acc.z += dz * fi;
        bj.acc.x -= dx * fj; bj.acc.y -= dy * fj; bj.acc.z -= dz * fj;
      }
    }
  }

  shipGravity(out) {
    const G = G0 * this.gMult, s = this.ship;
    out.set(0, 0, 0);
    for (const b of this.bodies) {
      const dx = b.pos.x - s.pos.x, dy = b.pos.y - s.pos.y, dz = b.pos.z - s.pos.z;
      const r2 = dx * dx + dy * dy + dz * dz;
      if (r2 < b.r * b.r) continue;
      const f = G * b.m / (Math.sqrt(r2) * r2);
      out.x += dx * f; out.y += dy * f; out.z += dz * f;
    }
    return out;
  }

  // Returns {dir, acc} the autopilot wants right now, or null when done this step.
  autopilotControl(dt) {
    const s = this.ship, ap = s.autopilot;
    if (!ap) return null;
    const T = ap.targetFn();
    const d = T.clone().sub(s.pos);
    const dist = d.len();
    const dHat = d.clone().norm();
    const vT = s.vel.dot(dHat);
    const vPerp = s.vel.clone().addScaled(dHat, -vT);
    const a = ap.accel;

    const vLen = s.vel.len();
    if (dist < ap.arriveR && (vLen < ap.arriveV || (vLen * vLen) / (2 * a) < ap.arriveR)) {
      s.vel.set(0, 0, 0);                  // park — at 100 kG the last fraction is bookkeeping
      s.autopilot = null; s.thrustAcc = 0;
      ap.onDone && ap.onDone();
      return null;
    }
    const stopDist = vT > 0 ? (vT * vT) / (2 * a) : 0;
    let dir;
    if (vT > 0 && stopDist >= dist * 0.98) {           // flip & burn: decelerate
      dir = s.vel.clone().scale(-1).norm();
      ap.phase = 'DECEL';
      if (vT - a * dt < 0 && dist > ap.arriveR) {       // avoid overshoot oscillation at coarse dt
        s.vel.addScaled(dHat, -vT * 0.999);
        s.vel.sub(vPerp);
        return { dir: dHat, acc: 0 };
      }
    } else {                                            // accelerate, steering out lateral drift
      dir = dHat.clone().scale(a);
      const corr = Math.min(vPerp.len() / Math.max(dt, 1e-6), a * 0.5);
      if (vPerp.len() > 1e-9) dir.addScaled(vPerp.clone().norm(), -corr);
      dir.norm();
      ap.phase = 'BURN';
    }
    return { dir, acc: a };
  }

  apProgress() {
    const ap = this.ship.autopilot;
    if (!ap) return null;
    const dist = ap.targetFn().clone().sub(this.ship.pos).len();
    if (ap.total == null) ap.total = dist;
    return { ...ap, dist, frac: Math.min(1, Math.max(0, 1 - dist / ap.total)) };
  }

  // Suggest a time warp so the remaining trip takes ~tReal seconds of wall time.
  apSuggestedWarp() {
    const s = this.ship, ap = s.autopilot;
    if (!ap) return null;
    const d = ap.targetFn().clone().sub(s.pos);
    const dist = d.len(), v = Math.max(s.vel.len(), 1e-6), a = ap.accel;
    const tEst = ap.phase === 'DECEL' ? v / a : (Math.sqrt(Math.max(dist, 0) / a) + v / a);
    return Math.min(3e7, Math.max(1, tEst / 14));
  }

  // Exact elliptic two-body propagation via f&g functions; null when not bound.
  static keplerPropagate(r0, v0, GM, dt) {
    const r0n = r0.len();
    const a = 1 / (2 / r0n - v0.dot(v0) / GM);
    if (!(a > 0) || !isFinite(a)) return null;
    const n = Math.sqrt(GM / (a * a * a));
    const esE = r0.dot(v0) / Math.sqrt(GM * a);
    const ecE = 1 - r0n / a;
    const e = Math.hypot(esE, ecE);
    if (e > 0.95) return null;                  // near-parabolic: Newton gets shaky, integrate instead
    const E0 = Math.atan2(esE, ecE);
    const M0 = E0 - esE;
    const M1 = M0 + n * dt;
    const TAU = 2 * Math.PI;
    const Mw = ((M1 % TAU) + TAU) % TAU;
    let E1 = e < 0.8 ? Mw : Math.PI;
    for (let i = 0; i < 40; i++) {
      const dE = (E1 - e * Math.sin(E1) - Mw) / (1 - e * Math.cos(E1));
      E1 -= dE;
      if (Math.abs(dE) < 1e-13) break;
    }
    const dEa = (E1 - (((E0 % TAU) + TAU) % TAU)) + TAU * Math.round(((M1 - Mw) - (M0 - ((M0 % TAU) + TAU) % TAU)) / TAU);
    const cdE = Math.cos(dEa), sdE = Math.sin(dEa);
    const f = 1 - (a / r0n) * (1 - cdE);
    const g = dt - (dEa - sdE) / n;
    const r1 = r0.clone().scale(f).addScaled(v0, g);
    const r1n = r1.len();
    const fd = -(Math.sqrt(GM * a) / (r0n * r1n)) * sdE;
    const gd = 1 - (a / r1n) * (1 - cdE);
    const v1 = r0.clone().scale(fd).addScaled(v0, gd);
    // reject any solve that teleports past the orbit's own speed limit
    const vMax = Math.sqrt(GM * (2 / (a * (1 - e)) - 1 / a));
    if (!isFinite(r1n) || r1.clone().sub(r0).len() > vMax * Math.abs(dt) * 1.5 + 1) return null;
    return { r: r1, v: v1 };
  }

  stepShip(dt) {
    const s = this.ship;
    const ctrl = this.autopilotControl(dt);
    let aThr = 0;
    if (ctrl) { s.thrustDir.copy(ctrl.dir); aThr = ctrl.acc; s.braking = false; }
    else if (s.thrustAcc > 0) aThr = s.thrustAcc;

    // dominant gravity well — frame for braking, on-rails coasting and step sizing
    let pull = 0, di = 0;
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i];
      const dx = b.pos.x - s.pos.x, dy = b.pos.y - s.pos.y, dz = b.pos.z - s.pos.z;
      const p = b.m / (dx * dx + dy * dy + dz * dz);
      if (p > pull) { pull = p; di = i; }
    }
    const dom = this.bodies[di];

    // spacebar released: retro-burn at the spool rate (max v / 10 s) until the
    // ship stands still relative to the local frame — symmetric to acceleration
    if (!ctrl && aThr === 0 && s.braking) {
      const rvx = s.vel.x - dom.vel.x, rvy = s.vel.y - dom.vel.y, rvz = s.vel.z - dom.vel.z;
      const rv = Math.hypot(rvx, rvy, rvz);
      if (rv < Math.max(0.2, s.maxV * 2e-5)) {
        s.vel.copy(dom.vel);
        s.u.copy(s.vel);
        s.braking = false;
        s.throttle = 0;
      } else {
        // full retro while fast, then a √v ease-out: deceleration fades smoothly
        // and reaches zero together with the speed — no terminal hard stop
        const RATE = s.maxV / 10.5, knee = s.maxV * 0.08;  // ~10 s from max v to rest
        const a = rv > knee ? RATE : RATE * Math.sqrt(rv / knee);
        aThr = Math.min(a, rv / dt);              // never overshoot at high warp
        s.thrustDir.set(-rvx / rv, -rvy / rv, -rvz / rv);
        s.throttle = Math.min(1, rv / Math.max(s.maxV, 1e-9));
      }
    }
    s.lastG = aThr / G_ACC;

    // Coasting and bound to the dominant well → exact Kepler arc relative to it.
    // Immune to time-warp; numeric integration is only needed under thrust.
    if (aThr === 0) {
      const r0 = s.pos.clone().sub(this.prePos[di]);
      const v0 = s.vel.clone().sub(this.preVel[di]);
      const kp = Sim.keplerPropagate(r0, v0, G0 * this.gMult * dom.m, dt);
      if (kp) {
        s.pos.copy(dom.pos).add(kp.r);
        s.vel.copy(dom.vel).add(kp.v);
        s.u.copy(s.vel);
        return;
      }
    }

    // close orbits need a much finer step than the planets do — subdivide so dt
    // stays a small fraction of the orbital period around the dominant well
    const domD = Math.hypot(dom.pos.x - s.pos.x, dom.pos.y - s.pos.y, dom.pos.z - s.pos.z);
    const period = 2 * Math.PI * Math.sqrt(domD ** 3 / (G0 * this.gMult * dom.m));
    const n = Math.min(96, Math.max(1, Math.ceil(dt / Math.max(period / 120, 15))));
    const h = dt / n;
    const G = G0 * this.gMult, bs = this.bodies;
    const pre = this.prePos, pv = this.preVel, pa = this.preAcc;
    const g = { x: 0, y: 0, z: 0 };
    // bodies already moved a full substep — reconstruct their in-substep path with
    // p0 + v0·s + ½a0·s², which is exactly the Verlet drift, so the ship sees the
    // same trajectory the body integrator produced (a linear lerp leaves ~10³ km
    // of curvature error per substep and pumps close orbits until they eject)
    const calcG = f => {
      const sT = f * dt, sT2 = 0.5 * sT * sT;
      let gx = 0, gy = 0, gz = 0;
      for (let bi = 0; bi < bs.length; bi++) {
        const b = bs[bi], p0 = pre[bi], v0 = pv[bi], a0 = pa[bi];
        const dx = p0.x + v0.x * sT + a0.x * sT2 - s.pos.x;
        const dy = p0.y + v0.y * sT + a0.y * sT2 - s.pos.y;
        const dz = p0.z + v0.z * sT + a0.z * sT2 - s.pos.z;
        const r2 = dx * dx + dy * dy + dz * dz;
        if (r2 < b.r * b.r) continue;
        const w = G * b.m / (Math.sqrt(r2) * r2);
        gx += dx * w; gy += dy * w; gz += dz * w;
      }
      g.x = gx; g.y = gy; g.z = gz;
    };
    const kick = hh => {
      if (this.relativistic) {
        // integrate proper velocity u = gamma*v; v = u / sqrt(1+|u|²/c²)
        s.u.addScaled(s.thrustDir, aThr * hh);
        s.u.x += g.x * hh; s.u.y += g.y * hh; s.u.z += g.z * hh;
        const u2 = s.u.dot(s.u);
        s.vel.copy(s.u).scale(1 / Math.sqrt(1 + u2 / (C_KMS * C_KMS)));
      } else {
        s.vel.addScaled(s.thrustDir, aThr * hh);
        s.vel.x += g.x * hh; s.vel.y += g.y * hh; s.vel.z += g.z * hh;
        s.u.copy(s.vel);
      }
    };
    calcG(0);                                   // kick-drift-kick velocity Verlet,
    for (let k = 0; k < n; k++) {               // 2nd order to match the planets
      kick(h / 2);
      s.pos.addScaled(s.vel, h);
      calcG((k + 1) / n);
      kick(h / 2);
    }
    // manual burns respect the max-v setting (autopilot jumps are not capped)
    if (aThr > 0 && !s.autopilot && s.maxV > 0) {
      const vl = s.vel.len();
      if (vl > s.maxV) {
        s.vel.scale(s.maxV / vl);
        if (this.relativistic && s.maxV < C_KMS) {
          s.u.copy(s.vel).scale(1 / Math.sqrt(1 - (s.maxV / C_KMS) ** 2));
        } else {
          s.u.copy(s.vel);
        }
      }
    }
  }

  step(simDt) {
    if (!(simDt > 0)) return;
    const DT_MAX = 1800;
    const n = Math.min(6000, Math.max(1, Math.ceil(simDt / DT_MAX)));
    const dt = simDt / n;
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < this.bodies.length; i++) {
        this.prePos[i].copy(this.bodies[i].pos);
        this.preVel[i].copy(this.bodies[i].vel);
        this.preAcc[i].copy(this.bodies[i].acc);
      }
      for (const b of this.bodies) {            // velocity Verlet
        b.vel.addScaled(b.acc, dt * 0.5);
        b.pos.addScaled(b.vel, dt);
      }
      this.computeAcc();
      for (const b of this.bodies) b.vel.addScaled(b.acc, dt * 0.5);
      this.stepShip(dt);
      this.time += dt;
    }
    this.recordTrails(simDt);
  }

  recordTrails(simDt) {
    const sun = this.bodies[0];
    for (const b of this.bodies) {
      if (b === sun) continue;
      if (simDt > b.period / 30) {            // undersampled at this warp: trail would alias
        if (b.trail.length) b.trail.length = 0;
        continue;
      }
      const rel = b.pos.clone().sub(b.name === 'Moon' ? this.body('Earth').pos : sun.pos);
      const t = b.trail, last = t[t.length - 1];
      const minStep = (b.name === 'Moon' ? MOON.a : b.def.a) * 0.012;
      if (!last || Math.hypot(rel.x - last.x, rel.y - last.y, rel.z - last.z) > minStep) {
        t.push(rel);
        if (t.length > 540) t.shift();
      }
    }
  }
}
