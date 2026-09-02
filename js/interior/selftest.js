// Self-tests of the ship interior (design spec 11), reached from the console
// or the offscreen browser as __dbg.interior.windowTest() and .perf(). Both
// drive the live frame loop through tick and put everything back afterwards:
// interior pose, ship attitude, boarded state, pixel ratio.
import * as THREE from 'three';
import { toRender } from '../scene.js?v=101';
import { POSES, SELFTEST, CUPOLA, hullToInterior, railPointHull } from './hull_frame.js?v=101';

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

  const snapshot = () => ({
    boarded: rig.boarded, railT: rig.railT,
    quat: shipView.quat.clone(), angVel: shipView.angVel.clone(),
    pos: rig.camera.position.clone(), rot: rig.camera.quaternion.clone(), up: rig.camera.up.clone(),
  });
  function restore(s) {
    shipView.quat.copy(s.quat); shipView.angVel.copy(s.angVel);
    rig.camera.position.copy(s.pos); rig.camera.quaternion.copy(s.rot); rig.camera.up.copy(s.up);
    rig.camera.updateMatrixWorld(true);
    rig.railT = s.railT;
    if (!s.boarded) rig.leave();
  }
  // interior camera at a hull-frame eye point, looking along an interior direction
  function aim(eye, fwd, up) {
    const p = hullToInterior(eye.x, eye.y, eye.z);
    rig.railT = null;
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

  return { windowTest, perf };
}
