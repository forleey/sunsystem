// Self-tests of the ship interior (design spec 11), reached from the console
// or the offscreen browser as __dbg.interior.windowTest() and .perf(). Both
// drive the live frame loop through tick and put everything back afterwards:
// interior pose, ship attitude, boarded state, pixel ratio.
import * as THREE from 'three';
import { toRender } from '../scene.js?v=102';
import { POSES, SELFTEST, CUPOLA, ROOMS, LADDER, hullToInterior, railPointHull } from './hull_frame.js?v=102';

const UP = new THREE.Vector3(0, 1, 0);
const NOSE = new THREE.Vector3(0, 0, -1);        // interior -Z is the hull nose
const py = (b) => (b ? 'True' : 'False');
const f3 = (x) => x.toFixed(3);
const sub = (a, b) => new THREE.Vector3(a.x - b.x, a.y - b.y, a.z - b.z);

export function createSelfTests({ rig, stage, sim, shipView, tick }) {
  const { renderer, composer, camera } = stage;

  // The composite before the film look. Every pass behind the interior pass
  // that swaps buffers is a ShaderPass; the last one renders to screen and
  // still swaps, so the last off-screen image (after FXAA, or after the
  // OutputPass when the film look is off) ends up in composer.writeBuffer.
  // Values are display-encoded there (tone map + sRGB), 0..1, row 0 at the
  // bottom like NDC. Read once per pose, then sampled in JS.
  function readFrame() {
    const rt = composer.writeBuffer, w = rt.width, h = rt.height;
    const half = rt.texture.type === THREE.HalfFloatType;
    const buf = half ? new Uint16Array(w * h * 4) : new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    const px = half ? (i) => THREE.DataUtils.fromHalfFloat(buf[i]) : (i) => buf[i] / 255;
    const lum = (x, y) => { const i = 4 * (y * w + x); return 0.2126 * px(i) + 0.7152 * px(i + 1) + 0.0722 * px(i + 2); };
    return { w, h, lum };
  }
  // mean luminance of the block around a render-space point projected by the space camera
  function blockLum(fr, p) {
    const v = p.clone().project(camera);
    const cx = Math.round((v.x + 1) / 2 * fr.w), cy = Math.round((v.y + 1) / 2 * fr.h), r = SELFTEST.block >> 1;
    let s = 0, n = 0;
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if (x >= 0 && y >= 0 && x < fr.w && y < fr.h) { s += fr.lum(x, y); n++; }
    }
    return { lum: n ? s / n : 0, ndc: [+v.x.toFixed(3), +v.y.toFixed(3)] };
  }

  const walk = rig.walk;
  const snapshot = () => ({
    boarded: rig.boarded, railT: rig.railT, mode: rig.mode,
    quat: shipView.quat.clone(), angVel: shipView.angVel.clone(),
    pos: rig.camera.position.clone(), rot: rig.camera.quaternion.clone(), up: rig.camera.up.clone(),
    walk: { pos: walk.pos.clone(), yaw: walk.yaw, pitch: walk.pitch, state: walk.state, seat: walk.seat, eyeOffset: walk.eyeOffset },
  });
  function restore(s) {
    shipView.quat.copy(s.quat); shipView.angVel.copy(s.angVel);
    walk.pos.copy(s.walk.pos); walk.yaw = s.walk.yaw; walk.pitch = s.walk.pitch;
    walk.state = s.walk.state; walk.seat = s.walk.seat; walk.eyeOffset = s.walk.eyeOffset; walk.climb = null;
    rig.camera.position.copy(s.pos); rig.camera.quaternion.copy(s.rot); rig.camera.up.copy(s.up);
    rig.camera.updateMatrixWorld(true);
    rig.railT = s.railT; rig.mode = s.mode;
    if (!s.boarded) rig.leave();
  }
  // interior camera at a hull-frame eye point, looking along an interior direction
  function aim(eye, fwd, up) {
    const p = hullToInterior(eye.x, eye.y, eye.z);
    rig.setManual();
    rig.camera.position.set(p.x, p.y, p.z);
    rig.camera.up.copy(up);
    rig.camera.lookAt(p.x + fwd.x, p.y + fwd.y, p.z + fwd.z);
    rig.camera.updateMatrixWorld(true);
  }

  // Seat in the cupola, turn the ship so the real Earth stands over the well,
  // render, read back: Earth at its centre and on its lit side. Then the rail,
  // looking at the hold's starboard wall: no pixel of that frame may be space.
  async function windowTest() {
    const prev = snapshot();
    if (!rig.boarded) rig.board();
    const ship = sim.ship, earth = sim.body('Earth'), sun = sim.bodies[0];
    // interior camera straight up: the space camera's forward is q * +Y, so
    // q taking +Y onto the Earth direction centres the Earth (spec 4.2)
    const ec = toRender(sub(earth.pos, ship.pos), new THREE.Vector3());
    const e = ec.clone().normalize();
    aim(POSES.cupola.eye, UP, NOSE);
    shipView.quat.setFromUnitVectors(UP, e);
    shipView.angVel.set(0, 0, 0);
    tick(performance.now());
    let fr = readFrame();
    // the start orbit parks the ship over the night side, so the centre can
    // be city lights alone: the lit point lies toward the sun, across the view
    const s = toRender(sub(sun.pos, earth.pos), new THREE.Vector3());
    const across = s.addScaledVector(e, -s.dot(e)).normalize();
    const centre = blockLum(fr, ec);
    const lit = blockLum(fr, ec.clone().addScaledVector(across, earth.r * SELFTEST.litOffset));
    const sky = blockLum(fr, ec.clone().addScaledVector(across, -earth.r * 2.5));   // off the disc, for reference
    const earthSeen = Math.max(centre.lum, lit.lum) > SELFTEST.earthLum && Math.max(centre.lum, lit.lum) > sky.lum * 3;

    // the wall: rail middle, eye height, looking along hull +X (interior -X)
    const rp = railPointHull(0.5);
    aim({ x: rp.x, y: rp.y, z: rp.z }, new THREE.Vector3(-1, 0, 0), UP);
    tick(performance.now());
    fr = readFrame();
    let leaks = 0, wallMin = 1;
    for (let y = 0; y < fr.h; y++) for (let x = 0; x < fr.w; x++) {
      const l = fr.lum(x, y);
      if (l < SELFTEST.skyLum) leaks++;
      if (l < wallMin) wallMin = l;
    }
    restore(prev);
    const pass = earthSeen && leaks === 0;
    const r = {
      pass, earthSeen, leaks, centreLum: +f3(centre.lum), litLum: +f3(lit.lum), skyLum: +f3(sky.lum),
      wallMin: +f3(wallMin), earthNdc: centre.ndc, pixels: fr.w * fr.h, cupolaZ: CUPOLA.z,
    };
    console.log(`WINDOWTEST result=${pass ? 'PASS' : 'FAIL'} earthSeen=${py(earthSeen)} leaks=${leaks} centre=${f3(centre.lum)} lit=${f3(lit.lum)} sky=${f3(sky.lum)} wallMin=${f3(wallMin)} ndc=${centre.ndc}`);
    return r;
  }

  // Walks the deck without input events: hold, ladder (climb, sit under the
  // cupola, climb down), fore passage, ring, bunks, aft ring, engineering, aft
  // passage, port ring, airlock, tunnel, cockpit, pilot seat. Runs the walk
  // controller synchronously at 60 Hz through its step() seam and checks
  // moved / grounded / never fell / never stuck, rooms visited, both seats.
  function walkTest() {
    const prev = snapshot();
    if (!rig.boarded) rig.board();
    rig.mode = 'walk';
    walk.spawn();
    walk.stats = { fell: 0, minFeet: Infinity };
    const dt = 1 / 60;
    const H = (x, z) => hullToInterior(x, 0, z);
    const path = [
      H(0, -20), H(0, -17.55), { use: 'ladder' }, { wait: 1 }, { use: 'stand' },
      H(1.2, -17.55), H(1.2, -15), H(0, -13.2), H(0, -11.2), H(9, -11.2), H(9, -8), H(9, -11.2),
      H(10.8, -11.2), H(10.8, -28.8), H(0, -28.8), H(0, -32), H(0, -28.8), H(0, -26.8), H(0, -24),
      H(0, -26.8), H(0, -28.8), H(-10.8, -28.8), H(-10.8, -11.2), H(-9.5, -11.2), H(-9.5, -8.5),
      H(-9.5, -11.2), H(0, -11.2), H(0, 0), H(0, 8), H(0, 12), H(-0.9, 14.4), { use: 'sit' }, { wait: 0.5 }, { use: 'stand' },
    ];
    const rooms = new Set();
    let time = 0, stuckAt = null, fellAt = null, maxDrop = 0, moved = 0, airborne = 0;
    const last = walk.pos.clone();
    const observe = () => {
      const r = walk.roomAt();
      if (r) rooms.add(r);
      if (walk.state === 'walk') {
        if (!walk.grounded) airborne++;
        const floor = r ? rig.deck.rooms[r].min.y : null;
        if (floor !== null && walk.pos.y < floor - 0.05) { fellAt = fellAt || { t: +time.toFixed(2), room: r, y: +walk.pos.y.toFixed(3) }; maxDrop = Math.max(maxDrop, floor - walk.pos.y); }
      }
      moved += walk.pos.distanceTo(last); last.copy(walk.pos);
    };
    for (const leg of path) {
      if (leg.use) {
        walk.step(dt, { use: true }); time += dt; observe();
        let guard = 0;
        while (walk.state === 'climb' && guard++ < 60 * 12) { walk.step(dt, {}); time += dt; observe(); }
        if (leg.use === 'ladder' && walk.state !== 'seated') stuckAt = stuckAt || { t: +time.toFixed(2), at: 'ladder', state: walk.state };
        if (leg.use === 'sit' && walk.state !== 'seated') stuckAt = stuckAt || { t: +time.toFixed(2), at: 'seat', state: walk.state, room: walk.roomAt() };
        if (leg.use === 'stand' && walk.state !== 'walk') stuckAt = stuckAt || { t: +time.toFixed(2), at: 'stand', state: walk.state };
        continue;
      }
      if (leg.wait) { for (let i = 0; i < leg.wait * 60; i++) { walk.step(dt, {}); time += dt; observe(); } continue; }
      let best = Infinity, sinceProgress = 0, n = 0;
      for (;;) {
        const dx = leg.x - walk.pos.x, dz = leg.z - walk.pos.z, dist = Math.hypot(dx, dz);
        if (dist < 0.25) break;
        if (dist < best - 0.02) { best = dist; sinceProgress = 0; } else sinceProgress += dt;
        if (sinceProgress > 2 || n++ > 60 * 40) { stuckAt = stuckAt || { t: +time.toFixed(2), room: walk.roomAt(), pos: walk.pos.toArray().map(v => +v.toFixed(2)), target: [leg.x, leg.z], dist: +dist.toFixed(2) }; break; }
        walk.yaw = Math.atan2(-dx, -dz);
        walk.step(dt, { fwd: 1 }); time += dt; observe();
      }
      if (stuckAt) break;
    }
    const st = walk.stats;
    const wanted = Object.keys(ROOMS);
    const missing = wanted.filter(k => !rooms.has(k));
    const pass = !stuckAt && !fellAt && !!st.climbed && !!st.sat_cupola && !!st.sat_pilot && missing.length === 0 && moved > 100;
    restore(prev);
    const r = {
      pass, rooms: rooms.size, missing, climbed: !!st.climbed, satCupola: !!st.sat_cupola, satCockpit: !!st.sat_pilot,
      moved: +moved.toFixed(1), seconds: +time.toFixed(1), airborneFrames: airborne, stuckAt, fellAt, maxDrop: +maxDrop.toFixed(3),
      ladderSeconds: LADDER.climbSeconds,
    };
    console.log(`WALKTEST result=${pass ? 'PASS' : 'FAIL'} rooms=${rooms.size}/${wanted.length} climbed=${py(r.climbed)} satCupola=${py(r.satCupola)} satCockpit=${py(r.satCockpit)} moved=${r.moved}m in ${r.seconds}s airborne=${airborne} stuck=${stuckAt ? JSON.stringify(stuckAt) : 'no'} fell=${fellAt ? JSON.stringify(fellAt) : 'no'}`);
    return r;
  }

  // Rail ride, t sweeping 0 -> 1 -> 0 over each half: the first half at DPR 1,
  // the second at the device's ratio (capped at 2). Two modes, chosen by
  // whether rAF fires at all:
  //   raf   the tab is visible: frame time is the spacing of our own rAF
  //         callbacks, which run in the same frames as the game loop. Honest
  //         wall time, capped by vsync.
  //   sync  the tab is hidden (Heddle's offscreen WebKit parks it and rAF
  //         never fires): frames are driven through tick() on a synthetic
  //         16.7 ms clock and each one ends in gl.finish(), so the time
  //         covers CPU and GPU of the whole composer. No vsync cap, so the
  //         mean is the true cost per frame, not the display cadence.
  // cpu is the CPU side of composer.render alone (submit only) in both modes.
  async function perf(seconds = 10) {
    const prev = snapshot(), prevPr = renderer.getPixelRatio();
    if (!rig.boarded) rig.board();
    const gl = renderer.getContext();
    const cpu = [], orig = composer.render;
    composer.render = function (...a) { const t0 = performance.now(); orig.apply(this, a); cpu.push(performance.now() - t0); };
    const stats = (xs) => {
      const s = [...xs].sort((a, b) => a - b), n = s.length;
      return { mean: +(s.reduce((a, b) => a + b, 0) / (n || 1)).toFixed(2), p95: +(s[Math.min(n - 1, Math.floor(n * 0.95))] || 0).toFixed(2), n };
    };
    const rafAlive = () => new Promise(res => {
      let hit = false;
      requestAnimationFrame(() => { hit = true; res(true); });
      setTimeout(() => { if (!hit) res(false); }, 300);
    });
    const mode = document.hidden || !(await rafAlive()) ? 'sync' : 'raf';
    const rideRaf = (pr) => new Promise(res => {
      stage.setPixelRatio(pr);
      const dts = [], c0 = cpu.length;
      let start = null, t0 = 0;
      const step = (now) => {
        if (start === null) start = now; else dts.push(now - t0);
        t0 = now;
        const u = (now - start) / 1000 / (seconds / 2);
        rig.setRail(u < 0.5 ? u * 2 : 2 - u * 2);
        if (u < 1) requestAnimationFrame(step);
        else res({ ...stats(dts), cpu: stats(cpu.slice(c0)).mean, dpr: pr });
      };
      requestAnimationFrame(step);
    });
    const rideSync = (pr) => new Promise(res => {
      stage.setPixelRatio(pr);
      const dts = [], c0 = cpu.length;
      const frames = Math.max(30, Math.round(seconds / 2 * 60));
      let clock = performance.now(), spent = 0;
      const px1 = new Uint8Array(4);
      // chunked through setTimeout so the page keeps answering evals meanwhile
      let i = 0;
      const chunk = () => {
        const until = Math.min(frames, i + 10);
        for (; i < until; i++) {
          const u = i / frames;
          rig.setRail(u < 0.5 ? u * 2 : 2 - u * 2);
          clock += 1000 / 60;
          const t0 = performance.now();
          tick(clock);
          // gl.finish() returns early in WebKit's GPU process; a 1-pixel read
          // of the default framebuffer is the stall that waits for the frame
          renderer.setRenderTarget(null);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1);
          dts.push(performance.now() - t0);
          spent += dts[dts.length - 1];
        }
        if (i < frames) setTimeout(chunk, 0);
        // performance.now() is 1 ms coarse here, so the mean comes from the
        // sum over all frames and p95 stays a coarse figure
        else res({ ...stats(dts), mean: +(spent / frames).toFixed(2), cpu: stats(cpu.slice(c0)).mean, dpr: pr });
      };
      chunk();
    });
    const ride = mode === 'raf' ? rideRaf : rideSync;
    const dpr1 = await ride(1);
    const dpr2 = await ride(Math.min(window.devicePixelRatio, 2));
    composer.render = orig;
    stage.setPixelRatio(prevPr);
    restore(prev);
    const budget = 1000 / 60;
    const pass = dpr2.mean <= budget;
    console.log(`PERF result=${pass ? 'PASS' : 'FAIL'} mode=${mode} dpr1 mean=${dpr1.mean} p95=${dpr1.p95} n=${dpr1.n} cpu=${dpr1.cpu} dpr2(${dpr2.dpr}) mean=${dpr2.mean} p95=${dpr2.p95} n=${dpr2.n} cpu=${dpr2.cpu} (ms per frame, budget ${budget.toFixed(1)})`);
    return { pass, mode, dpr1, dpr2 };
  }

  return { windowTest, perf, walkTest };
}
