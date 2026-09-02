// Walking the deck (M1): keyboard and pointer-lock look, a capsule against
// the deck's solid boxes resolved per axis with a step-up, sticky ground,
// the scripted ladder climb and the two seats. Everything is in INTERIOR
// metres (yaw 0 looks along -Z, the hull's nose); the rig couples the camera
// this class poses into the space render.
//
// step(dt, input) is the seam the self-test drives without DOM events:
//   input = { fwd, side, dyaw, dpitch, use }   (fwd/side in -1..1, angles in rad)
import * as THREE from 'three';
import { WALK, LADDER } from './hull_frame.js?v=102';

const HALF = WALK.radius;
const EPS = 1e-4;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (t) => t * t * (3 - 2 * t);
const contains = (b, p) => p.x >= b.min.x && p.x <= b.max.x && p.z >= b.min.z && p.z <= b.max.z && p.y >= b.min.y - EPS && p.y <= b.max.y + EPS;

export class Walk {
  // deck: buildDeck() result; camera: the interior camera; hint(text) shows the prompt line
  constructor({ deck, camera, hint = () => {} }) {
    this.deck = deck;
    this.camera = camera;
    this.hint = hint;
    this.pos = new THREE.Vector3();      // feet
    this.vy = 0;
    this.yaw = 0; this.pitch = 0;
    this.grounded = false;
    this.state = 'walk';                 // walk | climb | seated
    this.seat = null;
    this.climb = null;                   // { from, to, t, seconds, dir }
    this.eyeOffset = WALK.eye;           // blends toward the seated eye
    this.pressed = new Set();
    this.look = { x: 0, y: 0 };          // accumulated pointer movement since the last frame
    this.useQueued = false;
    this.locked = false;
    this.lastHint = null;
    this._box = { min: new THREE.Vector3(), max: new THREE.Vector3() };
    this._onKey = (e) => this.onKey(e);
    this._onMove = (e) => this.onMove(e);
    this._onDown = (e) => this.onDown(e);
    this._onLock = () => { this.locked = document.pointerLockElement === this.canvas; };
    this.canvas = null;
    this.stats = { fell: 0, minFeet: Infinity };
    this.spawn();
  }

  spawn() {
    const s = this.deck.spawn;
    this.pos.set(s.x, s.y, s.z);
    this.vy = 0; this.yaw = s.yaw; this.pitch = 0;
    this.state = 'walk'; this.seat = null; this.climb = null; this.eyeOffset = WALK.eye;
    this.applyCamera();
  }

  // ---------- DOM input (only while boarded) ----------
  attach(canvas) {
    this.canvas = canvas;
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('keyup', this._onKey);
    window.addEventListener('pointermove', this._onMove);
    canvas.addEventListener('pointerdown', this._onDown);
    document.addEventListener('pointerlockchange', this._onLock);
  }
  detach() {
    window.removeEventListener('keydown', this._onKey);
    window.removeEventListener('keyup', this._onKey);
    window.removeEventListener('pointermove', this._onMove);
    if (this.canvas) this.canvas.removeEventListener('pointerdown', this._onDown);
    document.removeEventListener('pointerlockchange', this._onLock);
    if (this.locked) document.exitPointerLock();
    this.pressed.clear();
    this.setHint(null);
  }
  onKey(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    const down = e.type === 'keydown';
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].includes(e.code)) {
      if (down) this.pressed.add(e.code); else this.pressed.delete(e.code);
      e.preventDefault();
    }
    if (e.code === 'KeyE' && down && !e.repeat) this.useQueued = true;
  }
  onMove(e) {
    if (!this.locked && !this.dragging) return;
    this.look.x += e.movementX; this.look.y += e.movementY;
  }
  onDown(e) {
    if (e.button !== 0) return;
    this.dragging = true;
    const p = this.canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => {});
    const up = () => { this.dragging = false; window.removeEventListener('pointerup', up); };
    window.addEventListener('pointerup', up);
  }
  // live input from the DOM state, consumed once per frame
  readInput() {
    const k = this.pressed;
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const side = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const inp = { fwd, side, dyaw: -this.look.x * WALK.lookSens, dpitch: -this.look.y * WALK.lookSens, use: this.useQueued };
    this.look.x = this.look.y = 0; this.useQueued = false;
    return inp;
  }
  update(dt) { this.step(dt, this.readInput()); }

  // ---------- one simulation step ----------
  step(dt, input) {
    dt = Math.min(dt, 0.05);
    this.yaw += input.dyaw || 0;
    this.pitch += input.dpitch || 0;
    if (this.state === 'seated') {
      const s = this.seat;
      if (!s.yawFree) this.yaw = clamp(this.yaw, s.yaw0 + s.yaw[0], s.yaw0 + s.yaw[1]);
      this.pitch = clamp(this.pitch, s.pitch[0], s.pitch[1]);
      if (input.use) this.stand();
    } else if (this.state === 'climb') {
      this.pitch = clamp(this.pitch, -0.6, 1.2);
      this.yaw = this.deck.ladder.yaw + clamp(this.yaw - this.deck.ladder.yaw, -0.9, 0.9);
      this.stepClimb(dt);
    } else {
      this.pitch = clamp(this.pitch, -WALK.pitchLimit, WALK.pitchLimit);
      this.stepWalk(dt, input);
      if (input.use) this.use();
    }
    this.updateHint();
    this.applyCamera();
  }

  stepWalk(dt, input) {
    const f = clamp(input.fwd || 0, -1, 1), s = clamp(input.side || 0, -1, 1);
    const len = Math.hypot(f, s) || 1;
    const sp = WALK.speed / Math.max(1, len);
    // yaw 0 looks along -Z; right is +X
    const dx = (Math.sin(-this.yaw) * f + Math.cos(this.yaw) * s) * sp * dt;
    const dz = (-Math.cos(this.yaw) * f - Math.sin(this.yaw) * s) * sp * dt;
    if (dx) this.moveAxis('x', dx);
    if (dz) this.moveAxis('z', dz);
    // ground: the highest solid top under the footprint within a step below the feet
    const g = this.groundUnder(this.pos, WALK.step + 0.05);
    if (g !== null && this.vy <= 0) {
      this.pos.y = g; this.vy = 0; this.grounded = true;
    } else {
      this.grounded = false;
      this.vy -= WALK.gravity * dt;
      const dy = this.vy * dt;
      this.moveAxis('y', dy);
      if (this.vy < 0 && this.groundUnder(this.pos, 0.02) !== null) { this.vy = 0; this.grounded = true; }
    }
    if (this.pos.y < this.stats.minFeet) this.stats.minFeet = this.pos.y;
  }

  // the capsule as a box around the feet point
  bodyBox(p, out = this._box) {
    out.min.set(p.x - HALF, p.y + 0.02, p.z - HALF);
    out.max.set(p.x + HALF, p.y + WALK.height, p.z + HALF);
    return out;
  }
  overlaps(a, b) {
    return a.min.x < b.max.x && a.max.x > b.min.x && a.min.y < b.max.y && a.max.y > b.min.y && a.min.z < b.max.z && a.max.z > b.min.z;
  }
  // move along one axis and push back out of the first solids hit; on a
  // horizontal hit, try the same move raised by the step height
  moveAxis(axis, d) {
    const p = this.pos;
    // solids already touching before the move are not this axis's business:
    // pushing out of them along this axis would fling the player sideways
    // (the ladder foot did exactly that on 02.09.2026)
    let box = this.bodyBox(p);
    const before = new Set();
    for (const s of this.deck.solids) if (this.overlaps(box, s)) before.add(s);
    p[axis] += d;
    box = this.bodyBox(p);
    let hit = null;
    for (const s of this.deck.solids) if (!before.has(s) && this.overlaps(box, s)) { hit = s; break; }
    if (!hit) return true;
    if (axis !== 'y' && this.grounded) {
      const rise = hit.max.y - p.y;
      if (rise > 0 && rise <= WALK.step + EPS) {
        const y0 = p.y;
        p.y = hit.max.y + EPS;
        box = this.bodyBox(p);
        let blocked = false;
        for (const s of this.deck.solids) if (this.overlaps(box, s)) { blocked = true; break; }
        if (!blocked) return true;
        p.y = y0;
      }
    }
    // push back: the face along the move axis
    for (const s of this.deck.solids) {
      if (before.has(s)) continue;
      box = this.bodyBox(p);
      if (!this.overlaps(box, s)) continue;
      if (axis === 'y') {
        if (d > 0) p.y = s.min.y - WALK.height - EPS; else { p.y = s.max.y; this.vy = 0; }
      } else if (d > 0) p[axis] = s.min[axis] - HALF - EPS;
      else p[axis] = s.max[axis] + HALF + EPS;
    }
    return false;
  }
  // highest solid top under the footprint, no more than `drop` below the feet; null if none
  groundUnder(p, drop) {
    let best = null;
    for (const s of this.deck.solids) {
      if (s.max.x <= p.x - HALF || s.min.x >= p.x + HALF || s.max.z <= p.z - HALF || s.min.z >= p.z + HALF) continue;
      const top = s.max.y;
      if (top <= p.y + 0.02 && top >= p.y - drop && (best === null || top > best)) best = top;
    }
    return best;
  }

  roomAt(p = this.pos) {
    for (const [k, b] of Object.entries(this.deck.rooms)) if (contains(b, { x: p.x, y: p.y + 0.5, z: p.z })) return k;
    return null;
  }

  // ---------- prompts, ladder, seats ----------
  nearLadderFoot() {
    const f = this.deck.ladder.foot;
    return Math.hypot(this.pos.x - f.x, this.pos.z - f.z) < WALK.useRange && Math.abs(this.pos.y - f.y) < 0.5;
  }
  nearSeat() {
    for (const s of Object.values(this.deck.seats)) {
      if (s.decorative || s.reachedByLadder) continue;
      const cx = (s.pan.min.x + s.pan.max.x) / 2, cz = (s.pan.min.z + s.pan.max.z) / 2;
      if (Math.hypot(this.pos.x - cx, this.pos.z - cz) < WALK.useRange + 0.3 && Math.abs(this.pos.y - s.pan.min.y) < 0.6) return s;
    }
    return null;
  }
  prompt() {
    if (this.state === 'seated') return this.seat.reachedByLadder ? 'E  climb down' : 'E  stand up';
    if (this.state === 'climb') return null;
    if (this.nearLadderFoot()) return 'E  climb the ladder';
    const s = this.nearSeat();
    if (s) return 'E  sit';
    return null;
  }
  updateHint() {
    const p = this.prompt();
    this.setHint(p);
  }
  setHint(text) {
    if (text === this.lastHint) return;
    this.lastHint = text;
    this.hint(text);
  }
  use() {
    if (this.nearLadderFoot()) return this.startClimb(+1);
    const s = this.nearSeat();
    if (s) return this.sit(s.name);
    return false;
  }
  startClimb(dir) {
    const L = this.deck.ladder;
    this.state = 'climb';
    this.climb = { dir, t: 0, seconds: LADDER.climbSeconds, from: dir > 0 ? L.foot : L.top, to: dir > 0 ? L.top : L.foot };
    this.pos.set(this.climb.from.x, this.climb.from.y, this.climb.from.z);
    this.yaw = L.yaw; this.vy = 0;
    this.stats.climbed = true;
    return true;
  }
  stepClimb(dt) {
    const c = this.climb;
    c.t = Math.min(1, c.t + dt / c.seconds);
    const k = smooth(c.t);
    this.pos.set(c.from.x, c.from.y + (c.to.y - c.from.y) * k, c.from.z);
    // hand-over-hand bob: a small vertical wobble and a faint side sway
    const bob = Math.sin(c.t * c.seconds * 2 * Math.PI / 0.9) * 0.05 * (1 - Math.abs(2 * k - 1));
    this.pos.y += bob;
    this.pitch = this.pitch * 0.9 + (c.dir > 0 ? 0.45 : -0.35) * 0.1;
    if (c.t >= 1) {
      this.climb = null;
      if (c.dir > 0) this.sit('cupola'); else { this.state = 'walk'; this.pos.copy(c.to); this.pitch *= 0.5; }
    }
  }
  sit(name) {
    const s = this.deck.seats[name];
    if (!s) return false;
    this.state = 'seated'; this.seat = s;
    this.pos.set(s.eye.x, s.eye.y - WALK.seatedEye, s.eye.z);
    this.eyeOffset = WALK.seatedEye;
    this.yaw = s.yaw0; this.pitch = clamp(this.pitch, s.pitch ? s.pitch[0] : -1, s.pitch ? s.pitch[1] : 1);
    this.vy = 0;
    this.stats['sat_' + name] = true;
    return true;
  }
  stand() {
    const s = this.seat;
    this.seat = null;
    this.eyeOffset = WALK.eye;
    if (s.reachedByLadder) return this.startClimb(-1);
    this.state = 'walk';
    if (s.stand) this.pos.set(s.stand.x, s.stand.y, s.stand.z);
    return true;
  }
  // put the player straight into a pose (screenshots, tests)
  poseSeat(name) { this.sit(name); this.applyCamera(); }
  poseStand(p, yaw = 0, pitch = 0) {
    this.state = 'walk'; this.seat = null; this.climb = null; this.eyeOffset = WALK.eye;
    this.pos.set(p.x, p.y, p.z); this.yaw = yaw; this.pitch = pitch; this.vy = 0;
    this.applyCamera();
  }

  applyCamera() {
    const c = this.camera;
    c.position.set(this.pos.x, this.pos.y + this.eyeOffset, this.pos.z);
    c.up.set(0, 1, 0);
    c.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    c.updateMatrixWorld(true);
  }
}
