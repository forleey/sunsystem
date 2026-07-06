// Conflict mode — an arcade skirmish layer over the sim: raider waves hunt
// the player, the Federation patrol warships warp in and fight alongside.
//
//   * Laser cannons: light-speed hitscan (at combat ranges 1c IS instant) —
//     hold G, needs target lock inside a nose cone.
//   * Photon torpedoes (0.5c-rated launchers, flown at game speed so you can
//     watch them run): homing, T to fire, proximity fuse.
//   * Target lock: auto-acquires the nearest raider, R cycles.
//   * Radar scope: nose-up projection, 150 km range, foes red / friends cyan.
//
// Agents fly free in the physics frame (km, ecliptic) on wall-clock dt —
// a local combat bubble that ignores gravity for the duration of a fight.
// Drafted patrol ships get o.combat set; fleet.tick/place then follow the
// agent instead of the analytic rail, and releasing them (o.combat = null)
// puts them right back on patrol.
import * as THREE from 'three';
import { toRender } from './scene.js?v=69';
import { fmtKm } from './data.js?v=69';
import { loadInto } from './models.js?v=69';
import { buildWarship } from './fleet_meshes.js?v=69';
import { fromRender } from './ship3d.js?v=69';

const LASER = { range: 12, cone: 0.93, cd: 0.32, dmg: 9 };
const AI_LASER = { range: 10.5, cdFoe: 1.15, cdFed: 0.85, dmgFoe: 6, dmgFed: 7 };
const TORP = { speed: 7, accel: 5, relMax: 12, fuse: 0.3, life: 18, cd: 2.6, range: 45, dmg: 34, dmgPlayer: 30 };
const LOCK_RANGE = 90, RADAR_KM = 150, PLAYER_HP = 120;
const FWDZ = new THREE.Vector3(0, 0, 1);

const mkRaider = () => loadInto(buildWarship(THREE), 'warship.glb',
  { lengthKm: 0.18, yaw: Math.PI, blinkers: 3, raider: true });

export class Combat {
  constructor({ scene, sim, fleet, shipView, ui, onPlayerDeath }) {
    this.scene = scene; this.sim = sim; this.fleet = fleet;
    this.shipView = shipView; this.ui = ui; this.onPlayerDeath = onPlayerDeath;
    this.enabled = false;
    this.agents = []; this.torps = []; this.beams = []; this.fx = [];
    this.beamPool = [];
    this.pending = []; this.drafted = [];
    this.lock = null;
    this.playerHp = PLAYER_HP; this.kills = 0; this.wave = 0;
    this.waveT = 0; this.cdL = 0; this.cdT = 0; this.invulnT = 0;
    this.dmgFlash = 0; this.t = 0; this.raiderSeq = 0;
    // scratch
    this._v = new THREE.Vector3(); this._w = new THREE.Vector3();
    this._q = new THREE.Quaternion(); this._p = { x: 0, y: 0, z: 0 };
    this.tgtEl = document.getElementById('tgt');
    this.tgtTxt = this.tgtEl.querySelector('small');
    this.dmgEl = document.getElementById('dmg');
    this.radarCv = document.getElementById('radarCv');
    this.radarCtx = this.radarCv.getContext('2d');
  }

  // ---------- lifecycle ----------
  setEnabled(on) {
    if (on === this.enabled) return;
    this.enabled = on;
    document.body.classList.toggle('combat', on);
    const chk = document.getElementById('c-combat');
    if (chk && chk.checked !== on) chk.checked = on;
    if (on) {
      this.kills = 0; this.wave = 0; this.playerHp = PLAYER_HP;
      this.invulnT = 2; this.waveT = 2.5; this.t = 0; this.raiderSeq = 0;
      const escorts = ['USS Defiant', 'USS Excalibur', 'USS Reliant'];
      this.pending = escorts.map((n, i) => ({ name: n, at: 3 + i * 3.5 }));
      this.ui.toast('CONFLICT MODE — raiders inbound · G lasers · T torpedo · R target · K stand down', 6000);
    } else {
      for (const a of [...this.agents]) {
        if (a.side === 'foe') { this.fleet.remove(a.o); this.ui.removeLabel(a.name); }
      }
      this.releaseDrafted();
      for (const tp of this.torps) this.scene.remove(tp.mesh);
      for (const b of this.beams) b.mesh.visible = false;
      for (const f of this.fx) { this.scene.remove(f.core); this.scene.remove(f.shell); }
      this.agents = []; this.torps = []; this.beams = []; this.fx = [];
      this.pending = []; this.lock = null;
      this.tgtEl.style.display = 'none';
      this.dmgFlash = 0; this.dmgEl.style.opacity = 0;
      this.ui.toast('Conflict mode off — sector stands down');
    }
  }

  releaseDrafted() {
    for (const o of this.drafted) { o.combat = null; this.ui.removeLabel(o.name); }
    this.drafted = [];
  }

  // ---------- spawning ----------
  spawnWave() {
    this.wave++;
    const s = this.sim.ship, n = Math.min(2 + this.wave, 7);
    for (let i = 0; i < n; i++) {
      const name = `Raider ${String.fromCharCode(65 + (this.raiderSeq++ % 26))}-${this.wave}`;
      const dir = randDir();
      const d = 90 + Math.random() * 70;
      const agent = this.mkAgent('foe', name, {
        x: s.pos.x + dir.x * d, y: s.pos.y + dir.y * d, z: s.pos.z + dir.z * d,
      }, { x: s.vel.x + rnd2(), y: s.vel.y + rnd2(), z: s.vel.z + rnd2() },
      50 + this.wave * 6, 2.6);
      const grp = mkRaider();
      const o = this.fleet.register({
        name, grp, kind: 'ship', radiusKm: 0.35, label: false, hDiff: 1,
        state: (t, out) => { out.x = agent.pos.x; out.y = agent.pos.y; out.z = agent.pos.z; },
        velAt: (t, out) => { out.x = agent.vel.x; out.y = agent.vel.y; out.z = agent.vel.z; },
      });
      o.combat = agent; agent.o = o;
      this.ui.addLabel({ name, cls: 'foe', getPos: () => o.pos, minDist: 0 });
    }
    this.ui.toast(`Wave ${this.wave}: ${n} raiders on approach — check radar`, 4200);
  }

  spawnFed(name) {
    const o = this.fleet.byName.get(name);
    if (!o || o.combat) return;
    const s = this.sim.ship, dir = randDir(), d = 30 + Math.random() * 30;
    const agent = this.mkAgent('fed', name, {
      x: s.pos.x + dir.x * d, y: s.pos.y + dir.y * d, z: s.pos.z + dir.z * d,
    }, { x: s.vel.x, y: s.vel.y, z: s.vel.z }, 90, 2.9);
    agent.o = o; o.combat = agent;
    this.drafted.push(o);
    this.ui.addLabel({ name, cls: 'ship', getPos: () => o.pos, minDist: 0 });
    this.boom(agent.pos, 0.5, 0.6, true);   // warp flash
    this.ui.toast(`${name} warps in — engaging raiders`);
  }

  mkAgent(side, name, pos, vel, hp, acc) {
    const a = {
      side, name, pos, vel, hp, maxHp: hp, acc, alive: true, o: null,
      faceR: new THREE.Vector3(0, 0, -1), target: null,
      cLaser: 1 + Math.random(), cTorp: 6 + Math.random() * 6,
      retargetT: 0, jink: { x: 0, y: 0, z: 0 }, jinkT: 0,
    };
    this.agents.push(a);
    return a;
  }

  // ---------- per-frame simulation (wall-clock dt) ----------
  update(dt, keys) {
    if (!this.enabled) return;
    this.t += dt;
    this.cdL -= dt; this.cdT -= dt;
    this.invulnT -= dt;
    this.dmgFlash = Math.max(0, this.dmgFlash - 1.7 * dt);

    // escort warp-ins
    for (const p of this.pending) if (!p.done && this.t >= p.at) { p.done = true; this.spawnFed(p.name); }

    // wave pacing
    if (!this.agents.some(a => a.side === 'foe')) {
      this.waveT -= dt;
      if (this.waveT <= 0) { this.spawnWave(); this.waveT = Infinity; }
    }

    for (const a of this.agents) this.stepAgent(a, dt);
    this.agents = this.agents.filter(a => a.alive);

    // player lock maintenance
    if (this.lock && (!this.lock.alive || this.distToShip(this.lock.pos) > LOCK_RANGE * 1.5)) this.lock = null;
    if (!this.lock) this.lock = this.nearestFoe(LOCK_RANGE);

    // player lasers (hold G)
    if (keys.has('KeyG') && this.cdL <= 0 && this.lock) {
      const s = this.sim.ship, d = this.distToShip(this.lock.pos);
      if (d <= LASER.range) {
        const nose = this._v.set(0, 0, -1).applyQuaternion(this.shipView.quat);
        const at = this._w.set(
          this.lock.pos.x - s.pos.x, this.lock.pos.z - s.pos.z, -(this.lock.pos.y - s.pos.y)).normalize();
        if (nose.dot(at) > LASER.cone) {
          this.cdL = LASER.cd;
          const right = fromRender(this._w.set(1, 0, 0).applyQuaternion(this.shipView.quat), this._v);
          for (const sx of [-0.022, 0.022]) {
            this.beam(
              { x: s.pos.x + right.x * sx, y: s.pos.y + right.y * sx, z: s.pos.z + right.z * sx },
              jitter(this.lock.pos, 0.04), [1.4, 2.6, 4.5]);
          }
          this.damage(this.lock, LASER.dmg, 'fed');
        }
      }
    }

    // torpedoes
    for (const tp of this.torps) this.stepTorp(tp, dt);
    this.torps = this.torps.filter(tp => tp.alive);

    // beam + explosion aging
    for (const b of this.beams) b.t += dt;
    for (const b of this.beams) if (b.t >= b.dur) { b.mesh.visible = false; this.beamPool.push(b.mesh); }
    this.beams = this.beams.filter(b => b.t < b.dur);
    for (const f of this.fx) f.t += dt;
    for (const f of this.fx) if (f.t >= f.dur) { this.scene.remove(f.core); this.scene.remove(f.shell); }
    this.fx = this.fx.filter(f => f.t < f.dur);
  }

  stepAgent(a, dt) {
    a.cLaser -= dt; a.cTorp -= dt; a.retargetT -= dt; a.jinkT -= dt;

    // targeting
    if (a.retargetT <= 0 || !validTarget(a.target)) {
      a.retargetT = 2.5;
      a.target = a.side === 'foe' ? this.nearestOf(a.pos, this.fedTargets()) : this.nearestOf(a.pos, this.agents.filter(x => x.side === 'foe'));
    }
    const tgt = a.target;
    const tp = tgt === 'player' ? this.sim.ship.pos : tgt ? tgt.pos : null;
    const tv = tgt === 'player' ? this.sim.ship.vel : tgt ? tgt.vel : null;
    if (!tp) {   // nothing to fight — drift
      a.pos.x += a.vel.x * dt; a.pos.y += a.vel.y * dt; a.pos.z += a.vel.z * dt;
      return;
    }

    // movement: close in, slow into dogfight range, jink sideways
    let rx = tp.x - a.pos.x, ry = tp.y - a.pos.y, rz = tp.z - a.pos.z;
    const d = Math.hypot(rx, ry, rz) || 1e-6;
    rx /= d; ry /= d; rz /= d;
    if (a.jinkT <= 0) {
      a.jinkT = 1.2 + Math.random() * 1.6;
      const j = randDir(), m = 2.5 + Math.random() * 3;
      a.jink.x = j.x * m; a.jink.y = j.y * m; a.jink.z = j.z * m;
    }
    const close = d > 40 ? 26 : d > 12 ? 12 : 6.5;
    const jk = d < 60 ? 1 : 0;
    let dvx = tv.x + rx * close + a.jink.x * jk - a.vel.x;
    let dvy = tv.y + ry * close + a.jink.y * jk - a.vel.y;
    let dvz = tv.z + rz * close + a.jink.z * jk - a.vel.z;
    const dvl = Math.hypot(dvx, dvy, dvz);
    if (dvl > 1e-6) {
      const acc = Math.min(dvl / dt, a.acc);
      a.vel.x += dvx / dvl * acc * dt; a.vel.y += dvy / dvl * acc * dt; a.vel.z += dvz / dvl * acc * dt;
    }
    a.pos.x += a.vel.x * dt; a.pos.y += a.vel.y * dt; a.pos.z += a.vel.z * dt;
    a.faceR.set(rx, rz, -ry);   // nose on the target (attack run)

    // weapons
    if (a.cLaser <= 0 && d < AI_LASER.range) {
      a.cLaser = a.side === 'foe' ? AI_LASER.cdFoe : AI_LASER.cdFed;
      const hit = Math.random() < Math.min(0.9, Math.max(0.18, 0.92 - d / 24));
      const col = a.side === 'foe' ? [4.5, 0.9, 0.5] : [1.4, 2.6, 4.5];
      this.beam(a.pos, hit ? jitter(tp, 0.03) : jitter(tp, 1.4), col);
      if (hit) this.damage(tgt, a.side === 'foe' ? AI_LASER.dmgFoe : AI_LASER.dmgFed, a.side);
    }
    if (a.cTorp <= 0 && d > 5 && d < 38) {
      a.cTorp = 9 + Math.random() * 5;
      this.spawnTorp(a.side, a.pos, a.vel, tgt);
    }
  }

  stepTorp(tp, dt) {
    tp.life -= dt;
    if (tp.life <= 0) { tp.alive = false; this.scene.remove(tp.mesh); this.boom(tp.pos, 0.2, 0.4); return; }
    const tgt = tp.target;
    const alive = tgt === 'player' || (tgt && tgt.alive);
    if (alive) {
      const P = tgt === 'player' ? this.sim.ship.pos : tgt.pos;
      const V = tgt === 'player' ? this.sim.ship.vel : tgt.vel;
      let rx = P.x - tp.pos.x, ry = P.y - tp.pos.y, rz = P.z - tp.pos.z;
      const d = Math.hypot(rx, ry, rz) || 1e-6;
      // lead pursuit, capped relative speed
      const lead = Math.min(d / TORP.relMax, 3) * 0.5;
      rx = P.x + V.x * lead - tp.pos.x; ry = P.y + V.y * lead - tp.pos.y; rz = P.z + V.z * lead - tp.pos.z;
      const l = Math.hypot(rx, ry, rz) || 1e-6;
      tp.vel.x += rx / l * TORP.accel * dt; tp.vel.y += ry / l * TORP.accel * dt; tp.vel.z += rz / l * TORP.accel * dt;
      let vrx = tp.vel.x - V.x, vry = tp.vel.y - V.y, vrz = tp.vel.z - V.z;
      const vr = Math.hypot(vrx, vry, vrz);
      if (vr > TORP.relMax) {
        const k = TORP.relMax / vr;
        tp.vel.x = V.x + vrx * k; tp.vel.y = V.y + vry * k; tp.vel.z = V.z + vrz * k;
      }
      // proximity fuse (step-size aware — no tunneling past the target)
      if (d < Math.max(TORP.fuse, vr * dt * 0.75)) {
        tp.alive = false; this.scene.remove(tp.mesh);
        this.boom(tp.pos, 0.7, 0.7);
        this.damage(tgt, tgt === 'player' ? TORP.dmgPlayer : TORP.dmg, tp.side);
        return;
      }
    }
    tp.pos.x += tp.vel.x * dt; tp.pos.y += tp.vel.y * dt; tp.pos.z += tp.vel.z * dt;
  }

  // ---------- weapons / damage ----------
  firePlayerTorpedo() {
    if (!this.enabled) return;
    if (this.cdT > 0 || !this.lock) return;
    const s = this.sim.ship, d = this.distToShip(this.lock.pos);
    if (d > TORP.range) { this.ui.toast('Target out of torpedo range'); return; }
    this.cdT = TORP.cd;
    this.spawnTorp('fed', s.pos, s.vel, this.lock);
  }

  cycleTarget() {
    if (!this.enabled) return;
    const s = this.sim.ship;
    const foes = this.agents.filter(a => a.side === 'foe')
      .sort((a, b) => dist2(a.pos, s.pos) - dist2(b.pos, s.pos));
    if (!foes.length) { this.lock = null; return; }
    const i = foes.indexOf(this.lock);
    this.lock = foes[(i + 1) % foes.length];
    this.ui.toast(`Target lock: ${this.lock.name}`);
  }

  spawnTorp(side, from, shooterVel, target) {
    const P = target === 'player' ? this.sim.ship.pos : target.pos;
    let dx = P.x - from.x, dy = P.y - from.y, dz = P.z - from.z;
    const l = Math.hypot(dx, dy, dz) || 1e-6;
    dx /= l; dy /= l; dz /= l;
    const mesh = new THREE.Mesh(torpGeo, side === 'foe' ? torpMatFoe : torpMatFed);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.torps.push({
      side, target, alive: true, life: TORP.life, mesh,
      pos: { x: from.x + dx * 0.12, y: from.y + dy * 0.12, z: from.z + dz * 0.12 },
      vel: { x: shooterVel.x + dx * TORP.speed, y: shooterVel.y + dy * TORP.speed, z: shooterVel.z + dz * TORP.speed },
    });
  }

  damage(target, dmg, fromSide) {
    if (target === 'player') {
      if (this.invulnT > 0) return;
      this.playerHp -= dmg;
      this.dmgFlash = Math.min(1, this.dmgFlash + 0.55);
      if (this.playerHp <= 0) {
        this.boom(this.sim.ship.pos, 2.2, 1.4);
        this.playerHp = PLAYER_HP;
        this.invulnT = 6;
        this.onPlayerDeath();
      }
      return;
    }
    if (!target || !target.alive) return;
    target.hp -= dmg;
    if (target.hp > 0) return;
    target.alive = false;
    this.boom(target.pos, 1.1, 1.0);
    if (target === this.lock) this.lock = null;
    this.ui.removeLabel(target.name);
    if (target.side === 'foe') {
      this.kills++;
      this.fleet.remove(target.o);
      if (!this.agents.some(a => a.side === 'foe' && a.alive)) {
        this.ui.toast(`Wave ${this.wave} cleared — next wave inbound`, 4000);
        this.waveT = 9;
      }
    } else {
      // wingman lost: she breaks off and warps clear — rail resumes far away
      target.o.combat = null;
      this.drafted = this.drafted.filter(o => o !== target.o);
      this.ui.toast(`${target.name} is hit hard — warping clear of the fight`, 3600);
    }
  }

  // ---------- visuals ----------
  beam(a, b, rgb) {
    let mesh = this.beamPool.pop();
    if (!mesh) {
      mesh = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ transparent: true, toneMapped: false }));
      mesh.frustumCulled = false;
      this.scene.add(mesh);
    }
    mesh.visible = true;
    mesh.material.color.setRGB(rgb[0], rgb[1], rgb[2]);
    this.beams.push({ a: { ...a }, b: { ...b }, t: 0, dur: 0.09, mesh });
  }

  boom(pos, r, dur, cold = false) {
    const core = new THREE.Mesh(boomGeo, new THREE.MeshBasicMaterial({
      transparent: true, toneMapped: false,
      color: cold ? new THREE.Color(5, 6.5, 9) : new THREE.Color(8, 6.5, 4),
    }));
    const shell = new THREE.Mesh(boomGeo, new THREE.MeshBasicMaterial({
      transparent: true, toneMapped: false,
      color: cold ? new THREE.Color(1.2, 2.2, 4) : new THREE.Color(4, 1.1, 0.3),
    }));
    core.frustumCulled = shell.frustumCulled = false;
    this.scene.add(core); this.scene.add(shell);
    this.fx.push({ pos: { ...pos }, t: 0, dur, r, core, shell });
  }

  // place combat visuals relative to the focus (floating origin)
  place(fPos) {
    if (!this.enabled) return;
    for (const tp of this.torps) {
      this._p.x = tp.pos.x - fPos.x; this._p.y = tp.pos.y - fPos.y; this._p.z = tp.pos.z - fPos.z;
      toRender(this._p, tp.mesh.position);
    }
    for (const b of this.beams) {
      const m = b.mesh;
      this._p.x = (b.a.x + b.b.x) / 2 - fPos.x;
      this._p.y = (b.a.y + b.b.y) / 2 - fPos.y;
      this._p.z = (b.a.z + b.b.z) / 2 - fPos.z;
      toRender(this._p, m.position);
      this._p.x = b.b.x - b.a.x; this._p.y = b.b.y - b.a.y; this._p.z = b.b.z - b.a.z;
      toRender(this._p, this._v);
      const L = this._v.length() || 1e-6;
      m.quaternion.setFromUnitVectors(FWDZ, this._v.multiplyScalar(1 / L));
      m.scale.set(0.04, 0.04, L);
      m.material.opacity = 1 - b.t / b.dur;
    }
    for (const f of this.fx) {
      const k = f.t / f.dur, e = 1 - (1 - k) * (1 - k);
      this._p.x = f.pos.x - fPos.x; this._p.y = f.pos.y - fPos.y; this._p.z = f.pos.z - fPos.z;
      toRender(this._p, f.core.position);
      f.shell.position.copy(f.core.position);
      f.core.scale.setScalar(Math.max(0.02, f.r * (0.15 + 0.5 * e)));
      f.shell.scale.setScalar(Math.max(0.03, f.r * (0.2 + 0.8 * e)));
      f.core.material.opacity = Math.pow(1 - k, 1.6);
      f.shell.material.opacity = (1 - k) * 0.8;
    }
  }

  // ---------- HUD: hull/kills/wave, target box, radar, damage flash ----------
  hud(camera, fPos) {
    if (!this.enabled) return;
    const pct = Math.max(0, Math.round(this.playerHp / PLAYER_HP * 100));
    const hpEl = document.getElementById('h-hp');
    hpEl.textContent = pct + '%';
    hpEl.style.color = pct > 50 ? 'var(--acc)' : pct > 25 ? 'var(--acc2)' : '#ff5c4c';
    document.getElementById('h-kills').textContent = this.kills;
    document.getElementById('h-wave').textContent = this.wave || '—';
    this.dmgEl.style.opacity = (this.dmgFlash * 0.85).toFixed(3);

    // target box, projected like the reticle
    if (this.lock && this.lock.alive) {
      this._p.x = this.lock.pos.x - fPos.x; this._p.y = this.lock.pos.y - fPos.y; this._p.z = this.lock.pos.z - fPos.z;
      toRender(this._p, this._v).project(camera);
      if (this._v.z < 1 && Math.abs(this._v.x) < 1.1 && Math.abs(this._v.y) < 1.1) {
        this.tgtEl.style.display = 'block';
        this.tgtEl.style.left = ((this._v.x * 0.5 + 0.5) * innerWidth) + 'px';
        this.tgtEl.style.top = ((-this._v.y * 0.5 + 0.5) * innerHeight) + 'px';
        const d = this.distToShip(this.lock.pos);
        const hp = Math.max(0, Math.round(this.lock.hp / this.lock.maxHp * 100));
        this.tgtTxt.textContent = `${this.lock.name} · ${fmtKm(d)} · ${hp}%`;
      } else this.tgtEl.style.display = 'none';
    } else this.tgtEl.style.display = 'none';

    this.drawRadar();
  }

  drawRadar() {
    const ctx = this.radarCtx, W = this.radarCv.width, cx = W / 2, cy = W / 2;
    const R = W / 2 - 8, k = R / RADAR_KM;
    ctx.clearRect(0, 0, W, W);
    // rings + crosshair
    ctx.strokeStyle = 'rgba(120,200,255,.22)';
    ctx.lineWidth = 1.5;
    for (const rr of [50, 100, 150]) {
      ctx.beginPath(); ctx.arc(cx, cy, rr * k, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
    // sweep
    const ang = (performance.now() * 0.0011) % (Math.PI * 2);
    const grad = ctx.createLinearGradient(cx, cy, cx + Math.cos(ang) * R, cy + Math.sin(ang) * R);
    grad.addColorStop(0, 'rgba(106,209,255,0)');
    grad.addColorStop(1, 'rgba(106,209,255,.5)');
    ctx.strokeStyle = grad; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R); ctx.stroke();

    // blips in the ship's nose-up frame
    const s = this.sim.ship;
    this._q.copy(this.shipView.quat).invert();
    const blip = (pos, style, size, ring) => {
      this._p.x = pos.x - s.pos.x; this._p.y = pos.y - s.pos.y; this._p.z = pos.z - s.pos.z;
      toRender(this._p, this._v).applyQuaternion(this._q);
      let px = this._v.x * k, py = this._v.z * k;
      const rr = Math.hypot(px, py);
      let dim = 1;
      if (rr > R) { px *= R / rr; py *= R / rr; dim = 0.35; }
      ctx.globalAlpha = dim;
      ctx.fillStyle = style;
      ctx.beginPath(); ctx.arc(cx + px, cy + py, size, 0, Math.PI * 2); ctx.fill();
      if (ring) {
        ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(cx + px, cy + py, size + 5, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };
    for (const tp of this.torps) blip(tp.pos, 'rgba(255,170,60,.9)', 2.5, false);
    for (const a of this.agents) {
      blip(a.pos, a.side === 'foe' ? '#ff5a4c' : '#54d8ff', a.side === 'foe' ? 4.5 : 4, a === this.lock);
    }
    // own ship
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, cy + 4);
    ctx.moveTo(cx - 4, cy + 1); ctx.lineTo(cx + 4, cy + 1); ctx.stroke();
  }

  // ---------- helpers ----------
  distToShip(p) {
    const s = this.sim.ship.pos;
    return Math.hypot(p.x - s.x, p.y - s.y, p.z - s.z);
  }

  nearestFoe(maxD) {
    const s = this.sim.ship.pos;
    let best = null, bd = maxD * maxD;
    for (const a of this.agents) {
      if (a.side !== 'foe' || !a.alive) continue;
      const d2 = dist2(a.pos, s);
      if (d2 < bd) { bd = d2; best = a; }
    }
    return best;
  }

  fedTargets() {
    const t = this.agents.filter(a => a.side === 'fed' && a.alive);
    if (this.invulnT <= 0) t.push('player');
    return t;
  }

  nearestOf(pos, list) {
    let best = null, bd = Infinity;
    for (const t of list) {
      const p = t === 'player' ? this.sim.ship.pos : t.pos;
      const d2 = dist2(p, pos);
      if (d2 < bd) { bd = d2; best = t; }
    }
    return best;
  }
}

// shared geometry/materials (HDR colors + toneMapped:false -> bloom lifts them)
const torpGeo = new THREE.SphereGeometry(0.05, 10, 8);
const torpMatFed = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 2.4, 0.8), toneMapped: false });
const torpMatFoe = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 1.2, 0.5), toneMapped: false });
const beamGeo = new THREE.BoxGeometry(1, 1, 1);
const boomGeo = new THREE.SphereGeometry(1, 18, 12);

function validTarget(t) { return t === 'player' || (t && t.alive); }
function dist2(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}
function randDir() {
  const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
  return { x: r * Math.cos(th), y: r * Math.sin(th), z: u };
}
function rnd2() { return (Math.random() - 0.5) * 4; }
function jitter(p, m) {
  return { x: p.x + (Math.random() - 0.5) * m, y: p.y + (Math.random() - 0.5) * m, z: p.z + (Math.random() - 0.5) * m };
}
