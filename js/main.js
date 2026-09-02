import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createStage, makeSky } from './scene.js?v=101';
import { Sim, V3 } from './physics.js?v=101';
import { SystemView } from './bodies3d.js?v=101';
import { ShipView } from './ship3d.js?v=101';
import { UI } from './ui.js?v=101';
import { ANDROMEDA, SHIP, G_ACC, fmtKm } from './data.js?v=101';
import { Fleet } from './fleet.js?v=101';
import { Music, renderTest } from './music.js?v=101';
import { armShine } from './shine.js?v=101';
import { initEnvironment } from './models.js?v=101';
import { Combat } from './combat.js?v=101';
import { Sfx } from './sfx.js?v=101';
import { Editor } from './editor.js?v=101';
import { InteriorRig } from './interior/rig.js?v=101';
import { addHullGlass } from './interior/hull_glass.js?v=101';
import { createSelfTests } from './interior/selftest.js?v=101';

const stage = createStage(document.getElementById('app'));
const sky = makeSky(stage.scene);
initEnvironment(stage.renderer, stage.scene);

const sim = new Sim();
const system = new SystemView(stage.scene, sim);
const shipView = new ShipView(stage.scene, sim);
addHullGlass(shipView);   // exterior cupola bubble on the hull, hidden from the space camera while boarded
const fleet = new Fleet(stage.scene, sim);

// Andromeda center & approach point in the physics (ecliptic) frame
const aDir = new V3(
  Math.cos(ANDROMEDA.eclLat) * Math.cos(ANDROMEDA.eclLon),
  Math.cos(ANDROMEDA.eclLat) * Math.sin(ANDROMEDA.eclLon),
  Math.sin(ANDROMEDA.eclLat)
);
const andromedaPos = aDir.clone().scale(ANDROMEDA.dist);
const andromedaStop = aDir.clone().scale(ANDROMEDA.dist - 1.45 * ANDROMEDA.radius);

const controls = new OrbitControls(stage.camera, stage.renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxDistance = 5.5e19;

// flight reticle (ship view): marks where the nose points on screen
const reticleEl = document.getElementById('reticle');
const retV = new THREE.Vector3();

// arrival fly-in: the ship starts fully OUTSIDE the frame (behind and below
// the camera), sweeps in huge from the bottom edge and eases into park over
// ~10 s (cubic ease-out, ends at exactly zero — no snap). Render-only offset
// along a FROZEN line: physics is parked, the helm answers immediately.
let arrivalT = -1;                 // -1 inactive, else 0..1
let arrivalKm = 0.8;
const ARRIVE_S = 10;
const arrivalDir = new THREE.Vector3();
const arrivalTmp = new THREE.Vector3();
function startArrival() {
  arrivalT = 0;
  arrivalKm = chaseDist * 1.6;
  arrivalDir.set(0, 0, -1).applyQuaternion(shipView.quat).multiplyScalar(-1);   // behind the park point
  arrivalTmp.set(0, 1, 0).applyQuaternion(shipView.quat);
  arrivalDir.addScaledVector(arrivalTmp, -0.9).normalize();                     // ... and well below
}

// ship view = 3rd-person chase cam behind the hull; follows orientation with a soft lag.
// wheel sets distance, vertical drag sets camera height (elevation angle)
const chaseQuat = new THREE.Quaternion();
let chaseDist = 0.28;              // boot at the closest zoom stop
let chaseEl = Math.atan2(0.32, 1);
stage.renderer.domElement.addEventListener('wheel', e => {
  if (focusName !== 'Starship' || rig.boarded) return;
  // tight zoom range (scaled to the 110 m hull): closest stop stays, zooming
  // out caps at ~+80% so the ship always fills a good chunk of the viewport
  chaseDist = Math.min(0.5, Math.max(0.28, chaseDist * Math.exp(e.deltaY * 0.001)));
}, { passive: true });
// ship view mouse: hold LMB to steer — the mouse turns the nose DIRECTLY
// (no rotational inertia: stop the mouse, the turn stops); RMB drag sets
// camera height. Keyboard helm keeps its inertia model untouched.
// Steering grabs pointer lock: the OS cursor is hidden and stays put, and
// movementX/Y keeps steering past screen edges.
let chaseDragY = null;
let steering = false;
const steerRot = new THREE.Quaternion();
const steerAxis = new THREE.Vector3();
stage.renderer.domElement.addEventListener('contextmenu', e => {
  if (focusName === 'Starship') e.preventDefault();
});
stage.renderer.domElement.addEventListener('pointerdown', e => {
  if (focusName !== 'Starship' || rig.boarded) return;   // no helm from inside (M0)
  if (e.button === 2) chaseDragY = e.clientY;
  else if (e.button === 0) {
    if (editor && editor.enabled) return;   // don't grab pointer-lock while editing
    steering = true;
    shipView.angVel.set(0, 0, 0);          // kill any residual key-spin
    const p = stage.renderer.domElement.requestPointerLock();
    if (p && p.catch) p.catch(() => {});   // denied lock -> visible-cursor fallback
  }
});
window.addEventListener('pointermove', e => {
  if (focusName !== 'Starship' || rig.boarded) return;
  if (steering) {
    const K = 0.0035;                      // rad per px, applied immediately
    steerRot.setFromAxisAngle(steerAxis.set(0, 1, 0), -e.movementX * K);
    shipView.quat.multiply(steerRot);
    steerRot.setFromAxisAngle(steerAxis.set(1, 0, 0), -e.movementY * K);
    shipView.quat.multiply(steerRot);
  } else if (chaseDragY !== null) {
    chaseEl = Math.min(1.35, Math.max(-0.45, chaseEl + (e.clientY - chaseDragY) * 0.004));
    chaseDragY = e.clientY;
  }
});
window.addEventListener('pointerup', () => {
  chaseDragY = null;
  if (steering) { steering = false; document.exitPointerLock(); }
});

// point the ship's nose at a body (used at boot and after beaming)
function aimShipAt(body) {
  const dir = new THREE.Vector3(
    body.pos.x - sim.ship.pos.x,
    body.pos.z - sim.ship.pos.z,
    -(body.pos.y - sim.ship.pos.y)
  ).normalize();
  shipView.quat.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
  chaseQuat.copy(shipView.quat);
}
// boot attitude: nose on an Earth-weighted blend between sun and Earth, so
// more of the globe rides top-right while the sun still glares bottom-left
function bootAttitude(rollRad = -0.6) {
  const e = sim.body('Earth'), sun = sim.bodies[0], sp = sim.ship.pos;
  const S = new THREE.Vector3(sun.pos.x - sp.x, sun.pos.z - sp.z, -(sun.pos.y - sp.y)).normalize();
  const E = new THREE.Vector3(e.pos.x - sp.x, e.pos.z - sp.z, -(e.pos.y - sp.y)).normalize();
  const dir = S.multiplyScalar(0.36).add(E.multiplyScalar(0.64)).normalize();
  shipView.quat.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
  shipView.quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rollRad));
  chaseQuat.copy(shipView.quat);
}
bootAttitude();   // parked behind the start screen — the fly-in runs on mode select

let focusName = 'Earth';
let editor;   // assigned below; the label-click router checks it at call time
const ui = new UI(sim, (name, beam) => {
  if (editor && editor.enabled) { editor.select(name); return; }   // editor mode: click selects
  if (beam) beamToName(name); else applyFocus(name);
}, fleet.objects.map(o => o.name));
editor = new Editor({ stage, system, fleet, shipView, sim, ui });
// ship interior (V boards, Esc leaves): a second scene drawn over the space
// render, see js/interior/rig.js. Owns the space camera while boarded.
const rig = new InteriorRig({ stage, shipView, getFocus: () => focusName, setFocus: n => applyFocus(n, false) });

function focusRadiusKm() {
  if (focusName === 'Starship') return 0.2;
  if (focusName === 'Andromeda') return ANDROMEDA.radius;
  const fo = fleet.byName.get(focusName);
  if (fo) return fo.radiusKm;
  const b = sim.body(focusName);
  return b ? b.r * (b.name === 'Sun' ? Math.min(ui.state.sizeMult, 60) : ui.state.sizeMult) : 6371;
}
function focusPos(out) {
  if (focusName === 'Starship') return out.copy(sim.ship.pos);
  if (focusName === 'Andromeda') return out.copy(andromedaPos);
  const fo = fleet.byName.get(focusName);
  if (fo) return out.copy(fo.pos);
  return out.copy(sim.body(focusName).pos);
}

// beam the player's ship to any body or fleet object (stations, NPC ships)
const fleetVel = { x: 0, y: 0, z: 0 };
function beamToName(name) {
  const fo = fleet.byName.get(name);
  if (fo) {
    fo.state(sim.time, fo.pos);
    fleet.velOf(fo, sim.time, fleetVel);
    const sun = sim.bodies[0];
    let dx = sun.pos.x - fo.pos.x, dy = sun.pos.y - fo.pos.y, dz = sun.pos.z - fo.pos.z;
    const dl = Math.hypot(dx, dy, dz) || 1;
    const standoff = Math.max(fo.radiusKm * 3, 0.8);
    sim.placeShip(
      fo.pos.x + (dx / dl) * standoff, fo.pos.y + (dy / dl) * standoff, fo.pos.z + (dz / dl) * standoff,
      fleetVel.x, fleetVel.y, fleetVel.z
    );
    aimShipAt(fo);
  } else if (sim.body(name)) {
    sim.beamShipTo(name);
    aimShipAt(sim.body(name));
  } else return;
  applyFocus('Starship', false);
  startArrival();
  ui.toast('Beamed to ' + name);
}
function applyFocus(name, announce = true) {
  if (rig.boarded && name !== 'Starship') { ui.setFocusSelect(focusName); return; }   // focus lock while boarded (design spec 4.4)
  focusName = name;
  ui.setFocusSelect(name);
  if (name === 'Starship') chaseQuat.copy(shipView.quat);   // snap behind, no swing-in
  const r = focusRadiusKm();
  let dir = stage.camera.position.clone().normalize();
  if (name === 'Starship') {
    // frame the ship with the nearest planet behind it
    let best = sim.bodies[0], bd = Infinity;
    for (const b of sim.bodies) {
      const d = Math.hypot(b.pos.x - sim.ship.pos.x, b.pos.y - sim.ship.pos.y, b.pos.z - sim.ship.pos.z);
      if (d < bd) { bd = d; best = b; }
    }
    const away = new V3(sim.ship.pos.x - best.pos.x, sim.ship.pos.y - best.pos.y, sim.ship.pos.z - best.pos.z);
    dir = new THREE.Vector3(away.x, away.z, -away.y).normalize().lerp(new THREE.Vector3(0, 0.5, 0), 0.18).normalize();
  }
  if (!dir.lengthSq()) dir.set(0, 0.4, 1).normalize();
  const dist = name === 'Andromeda' ? r * 2.4 : name === 'Starship' ? 0.28 : Math.max(r * 4.2, r + 1);
  stage.camera.position.copy(dir.multiplyScalar(dist));
  if (announce) ui.toast('Focus: ' + name, 1400);
}

// label anchors
const anchors = sim.bodies.map(b => ({ name: b.name, getPos: () => b.pos, minDist: Infinity }));
anchors.push({ name: 'Starship', cls: 'ship', getPos: () => sim.ship.pos, minDist: Infinity });
anchors.push({ name: 'Andromeda', getPos: () => andromedaPos, minDist: Infinity });
for (const o of fleet.objects) {
  if (o.label) anchors.push({ name: o.name, cls: 'station', getPos: () => o.pos, minDist: Infinity });
}
ui.initLabels(anchors);

// ---------- input ----------
const keys = new Set();
const DIGITS = { Digit1: 'Sun', Digit2: 'Mercury', Digit3: 'Venus', Digit4: 'Earth', Digit5: 'Mars', Digit6: 'Jupiter', Digit7: 'Saturn', Digit8: 'Uranus', Digit9: 'Neptune', Digit0: 'Pluto' };

function startAndromedaJump() {
  sim.ship.autopilot = {
    targetFn: () => andromedaStop,
    accel: SHIP.jumpAccelG * G_ACC,
    arriveR: 6e16, arriveV: 2e6,
    label: '→ ANDROMEDA · 100 000 g',
    onDone: () => { ui.setWarp(1); ui.toast('Arrived at Andromeda — 2.5 million light-years from home'); applyFocus('Starship', false); },
  };
  ui.toast('Autopilot engaged: Andromeda, constant 100 000 g (flip & burn)');
  applyFocus('Starship', false);
}
function startHomeJump() {
  const earth = sim.body('Earth');
  sim.ship.autopilot = {
    targetFn: () => earth.pos.clone().add(new V3(SHIP.startOrbitR, 0, 0)),
    accel: SHIP.jumpAccelG * G_ACC,
    arriveR: 4000, arriveV: 80,
    label: '→ EARTH · 100 000 g',
    onDone: () => { sim.resetShip(); bootAttitude(); ui.setWarp(1); startArrival(); ui.toast('Back in Earth orbit'); },
  };
  ui.toast('Autopilot engaged: return to Earth');
  applyFocus('Starship', false);
}

window.addEventListener('keydown', e => {
  if (e.target.tagName === 'SELECT') return;   // keep arrow/enter nav inside the focus dropdown
  if (e.code === 'Escape') {                   // boarded: step off; else back to the start screen
    if (rig.boarded) { rig.leave(); return; }
    if (!document.body.classList.contains('title')) showTitle();
    return;
  }
  if (document.body.classList.contains('title')) return;   // menu is up — helm keys idle
  if (e.code === 'KeyV') { if (!e.repeat) rig.toggle(); keys.clear(); return; }   // board / leave the ship interior
  if (e.code === 'KeyM') { setMusic(!musicWanted()); return; }   // music stays reachable from inside
  if (rig.boarded) { keys.clear(); return; }               // no helm, jumps, focus or beams from inside
  if (e.code === 'Backquote') { editor.toggle(); return; }  // ` toggles the editor
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();  // helm keys never drive UI controls
  keys.add(e.code);
  if (e.code === 'KeyJ') startAndromedaJump();
  if (e.code === 'KeyH') startHomeJump();
  if (e.code === 'KeyF') applyFocus('Starship');
  if (e.code === 'KeyR') combat.cycleTarget();
  if (e.code === 'KeyT') combat.firePlayerTorpedo();
  if (e.code === 'KeyX') {
    sim.ship.autopilot = null; sim.ship.thrustAcc = 0; sim.ship.throttle = 0; sim.ship.braking = false;
    ui.setWarp(1); ui.toast('Thrust cut — coasting on inertia');
  }
  if (DIGITS[e.code]) {
    if (e.shiftKey) {                       // beam the ship into orbit there
      const name = DIGITS[e.code];
      sim.beamShipTo(name);
      aimShipAt(sim.body(name));
      applyFocus('Starship', false);
      ui.toast('Beamed into ' + name + ' orbit');
    } else {
      applyFocus(DIGITS[e.code]);
    }
  }
});
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());   // no stuck thrust when the tab loses focus

// ---------- ambient music (tracks composed via OpenRouter, synthesized live) ----------
// The wish for music is a stored preference, not the live context state: when a
// browser blocks autoplay the wish is still "on" while nothing sounds yet, and
// the start screen says so with #sndHint instead of lying about the setting.
const MUSIC_KEY = 'starblazer.music';
const musicWanted = () => localStorage.getItem(MUSIC_KEY) !== 'off';
const music = new Music(title => {
  document.getElementById('v-track').textContent = music.enabled ? title : 'off';
  document.getElementById('b-music').innerHTML = music.enabled ? '&#9834; Pause' : '&#9834; Play';
  const t = document.getElementById('m-music');
  t.classList.toggle('off', !musicWanted());
  t.innerHTML = musicWanted() ? '&#9834; Music On' : '&#9834; Music Off';
  updSndHint();
});
function setMusic(on) {
  localStorage.setItem(MUSIC_KEY, on ? 'on' : 'off');
  if (on) { music.start(); watchCtx(); }
  else if (music.ctx) { music.ctx.suspend(); music.enabled = false; }
  music.onTrackChange(music.title);
}
let ctxWatched = false;
function watchCtx() {   // the context is born on the first start(), whenever that is
  if (ctxWatched || !music.ctx) return;
  music.ctx.addEventListener('statechange', updSndHint);
  ctxWatched = true;
}
function updSndHint() {   // pulsing "click for sound" only while the wish is blocked
  const hint = document.getElementById('sndHint');
  hint.style.display = musicWanted() && music.ctx && music.ctx.state !== 'running' ? '' : 'none';
}
document.getElementById('m-music').addEventListener('click', () => setMusic(!musicWanted()));
document.getElementById('b-music').addEventListener('click', () => setMusic(!music.enabled));
document.getElementById('b-nexttrack').addEventListener('click', () => music.next());
// the page tries to start music right on load (bottom of this file); browsers
// that distrust the site keep the context suspended, so the very first
// interaction anywhere resumes it (autoplay policy)
const musicKickoff = () => {
  window.removeEventListener('pointerdown', musicKickoff, true);
  window.removeEventListener('keydown', musicKickoff, true);
  if (!musicWanted()) return;
  if (!music.ctx) { music.start(); watchCtx(); }
  else if (music.enabled && music.ctx.state !== 'running') music.ctx.resume();
  updSndHint();
};
window.addEventListener('pointerdown', musicKickoff, true);
window.addEventListener('keydown', musicKickoff, true);

// ---------- conflict mode (raider waves, lasers, torpedoes, radar) ----------
// (the R/T keydown bindings above resolve these consts at call time)
const sfx = new Sfx();   // shared: weapons (combat) + engine bed (both modes)
const combat = new Combat({
  scene: stage.scene, sim, fleet, shipView, ui, music, sfx,
  onPlayerDeath: () => {
    sim.resetShip();
    bootAttitude();
    applyFocus('Starship', false);
    startArrival();
    ui.toast('Hull breached — emergency beam-out to Earth orbit', 4200);
  },
});

window.__combat = combat; window.__sim = sim;   // TEMP debug probe: remove after verification

// ---------- start screen: STARBLAZER mode select ----------
function showTitle() {
  if (rig.boarded) rig.leave();   // never park a stale interior pass under the menu
  document.body.classList.add('title');
  if (combat.enabled) combat.setEnabled(false);
  music.setTitleActive(true);
  stage.setPixelRatio(1);
}
function startGame(mode) {
  document.body.classList.remove('title');
  music.setTitleActive(false);
  stage.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  sim.resetShip();
  bootAttitude();
  applyFocus('Starship', false);
  startArrival();
  if (mode === 'battle') combat.setEnabled(true);
  else ui.toast('Free Mode — the system is yours. J jumps to Andromeda, H flies home.', 4600);
}
document.getElementById('m-free').addEventListener('click', () => startGame('free'));
document.getElementById('m-battle').addEventListener('click', () => startGame('battle'));

// panel controls steal keyboard focus after a click/drag — give it back to the helm.
// selects only blur on change: blurring on pointerup would close the dropdown mid-pick
for (const el of document.querySelectorAll('.panel input, .panel select, .panel button')) {
  el.addEventListener('change', () => el.blur());
  if (el.tagName !== 'SELECT') el.addEventListener('pointerup', () => setTimeout(() => el.blur(), 0));
}

// ---------- HUD helpers ----------
function hudExtra() {
  let best = null, bd = Infinity;
  const s = sim.ship;
  for (const b of sim.bodies) {
    const d = Math.hypot(b.pos.x - s.pos.x, b.pos.y - s.pos.y, b.pos.z - s.pos.z) - b.r;
    if (d < bd) { bd = d; best = b; }
  }
  const relSpeed = Math.hypot(s.vel.x - best.vel.x, s.vel.y - best.vel.y, s.vel.z - best.vel.z);
  const aD = Math.hypot(andromedaPos.x - s.pos.x, andromedaPos.y - s.pos.y, andromedaPos.z - s.pos.z);
  const nearest = aD < bd ? 'Andromeda core · ' + fmtKm(aD) : best.name + ' · ' + fmtKm(Math.max(0, bd));
  return { nearest, relName: best.name, relSpeed };
}

// ---------- main loop ----------
const fPos = new V3();
let last = performance.now();
let apWarp = 1;
let engEnv = 0;   // engine-sound envelope: ramps up the longer Space is held, fades on release
// menu beauty shot: camera rides the hull while the ship "flies"
let titleT = 0;
const titleQ = new THREE.Quaternion();
const titleAxis = new THREE.Vector3(0, 0, 1);
const titleTgt = new THREE.Vector3();

let lastRafAt = 0;
function frame(now) {
  lastRafAt = performance.now();
  requestAnimationFrame(frame);
  try { frameBody(now); } catch (err) {
    if (!window.__frameErr) { window.__frameErr = String(err.stack || err); console.error('FRAME ERROR', window.__frameErr); }
  }
}
// hidden tabs starve rAF — keep the universe ticking
setInterval(() => {
  if (performance.now() - lastRafAt > 200) {
    try { frameBody(performance.now()); } catch (err) {
      if (!window.__frameErr) { window.__frameErr = String(err.stack || err); console.error('FRAME ERROR', window.__frameErr); }
    }
  }
}, 50);

function frameBody(now) {
  let dtWall = Math.min((now - last) / 1000, 0.1);
  if (!(dtWall > 0)) dtWall = 0.016;     // first frame, clock skew, or out-of-order timestamps
  last = now;

  // autopilot drives the time warp so interstellar trips stay watchable
  if (sim.ship.autopilot) {
    const target = sim.apSuggestedWarp() || 1;
    apWarp = apWarp * 0.9 + target * 0.1;
    ui.setWarp(Math.max(1, apWarp));
  } else {
    apWarp = ui.state.warp;
  }

  sim.step(dtWall * ui.state.warp);
  combat.update(dtWall, keys);
  fleet.tick(sim.time);

  focusPos(fPos);
  // battle mode: combat impulse limiter, max speed (and with it thrust accel,
  // which scales off it) is cut to 20% so dogfights stay inside the arena.
  // Boarded: keys stays empty (the keydown handler drops everything), so the
  // helm idles until the walk controller takes the keys in M1.
  shipView.update(fPos, stage.camera, dtWall, keys, ui.state.shipG * (combat.enabled ? 0.2 : 1));

  // engine bed: volume is keyed to how long thrust is held, not to throttle.
  // Holding Space ramps it up over ~1.8 s; releasing fades it over ~1.1 s.
  const holdingThrust = keys.has('Space') || !!sim.ship.autopilot;
  engEnv = Math.max(0, Math.min(1, engEnv + (holdingThrust ? dtWall / 1.8 : -dtWall / 1.1)));
  sfx.engine(engEnv);
  if (arrivalT >= 0) {
    arrivalT += dtWall / ARRIVE_S;
    if (arrivalT >= 1) arrivalT = -1;                    // lands on exactly zero — no snap
    else {
      const k = (1 - arrivalT) ** 3;                     // cubic ease-out
      shipView.grp.position.addScaledVector(arrivalDir, arrivalKm * k);
    }
  }
  // boarded: planets at real size whatever the slider says (design spec 4.4);
  // the slider itself is left alone and applies again after leaving
  system.update(fPos, stage.camera, rig.boarded ? 1 : ui.state.sizeMult, ui.state.trails, dtWall);
  fleet.place(fPos, sim.time, dtWall);
  combat.place(fPos, stage.camera);

  if (rig.boarded) {
    // interior: the rig poses the space camera from the walk camera every frame
    controls.enabled = false;
    rig.update();
  } else if (focusName === 'Starship') {
    controls.enabled = false;
    if (document.body.classList.contains('title')) {
      // menu beauty shot: hug the hull (the ship is 110 m — sit ~60 m off),
      // gentle roll + camera sway, engines burning for the flight look
      titleT += dtWall;
      shipView.quat.multiply(titleQ.setFromAxisAngle(titleAxis, 0.016 * dtWall));
      stage.camera.position.set(
        -0.035 + Math.sin(titleT * 0.11) * 0.005,
        0.026 + Math.sin(titleT * 0.073) * 0.004,
        0.085
      ).applyQuaternion(shipView.quat);
      titleTgt.set(-0.055, 0.016, -0.045).applyQuaternion(shipView.quat);
      stage.camera.up.set(0, 1, 0).applyQuaternion(shipView.quat);
      stage.camera.lookAt(titleTgt);
      chaseQuat.copy(shipView.quat);
      const pulse = 0.85 + 0.15 * Math.sin(now * 0.013);
      for (const gr of shipView.grilles) gr.material.emissiveIntensity = 3.6 * pulse;
      shipView.lamp.intensity = 0.4 * pulse;
    } else {
      // chase cam: sit aft-above of the hull, follow orientation with a soft lag
      chaseQuat.slerp(shipView.quat, 1 - Math.exp(-5 * dtWall));
      stage.camera.position.set(0, Math.sin(chaseEl), Math.cos(chaseEl)).multiplyScalar(chaseDist).applyQuaternion(chaseQuat);
      stage.camera.up.set(0, 1, 0).applyQuaternion(chaseQuat);
      stage.camera.lookAt(0, 0, 0);
    }
  } else {
    if (!controls.enabled) { controls.enabled = true; stage.camera.up.set(0, 1, 0); }
    controls.minDistance = Math.max(focusRadiusKm() * 1.25, 0.08);
    controls.update();
  }

  stage.bloom.strength = ui.state.bloom;
  stage.film.material.uniforms.uTime.value = (now * 0.001) % 100;
  // the start screen hides labels, HUD and reticle via CSS; skip writing them
  // there. Every write is a DOM mutation (textContent = childList), ~19 per
  // frame, and each one wakes Heddle's design bridge observer.
  const onTitle = document.body.classList.contains('title');
  const hideUi = onTitle || rig.boarded;   // boarded hides the same set via body.boarded
  if (!hideUi) {
    ui.updateLabels(fPos, stage.camera, focusName);
    ui.updateHUD(hudExtra());
    combat.hud(stage.camera, fPos);
  }

  stage.composer.render();

  // flight reticle: project the nose direction onto the screen (ship view only)
  if (focusName === 'Starship' && !hideUi) {
    retV.set(0, 0, -1).applyQuaternion(shipView.quat).multiplyScalar(1e7).add(shipView.grp.position);
    retV.project(stage.camera);
    if (retV.z < 1) {
      reticleEl.style.display = 'block';
      reticleEl.style.left = ((retV.x * 0.5 + 0.5) * innerWidth) + 'px';
      reticleEl.style.top = ((-retV.y * 0.5 + 0.5) * innerHeight) + 'px';
    } else reticleEl.style.display = 'none';
  } else if (reticleEl.style.display !== 'none') {
    reticleEl.style.display = 'none';
  }
}

// ---- visual look: adjustable and persistable as default (localStorage) ----
const LOOK_KEY = 'sunsystem-look-v1';
const LOOK_DEF = { bloom: 0.06, exposure: 1.43, contrast: 1.075, saturation: 1.07, grain: 1, vignette: 1, film: true };
const look = { ...LOOK_DEF, ...(JSON.parse(localStorage.getItem(LOOK_KEY) || 'null') || {}) };
const filmU = stage.film.material.uniforms;
const LOOK_BIND = [
  ['exposure', 's-exposure', 'v-exposure', v => { stage.renderer.toneMappingExposure = v; }],
  ['contrast', 's-contrast', 'v-contrast', v => { filmU.uCon.value = v; }],
  ['saturation', 's-sat', 'v-sat', v => { filmU.uSat.value = v; }],
  ['grain', 's-grain', 'v-grain', v => { filmU.uGrain.value = v; }],
  ['vignette', 's-vig', 'v-vig', v => { filmU.uVig.value = v; }],
];
function applyLookControl(key, sid, lid, apply) {
  const s = document.getElementById(sid);
  s.value = look[key];
  document.getElementById(lid).textContent = (+look[key]).toFixed(2);
  apply(look[key]);
}
for (const [key, sid, lid, apply] of LOOK_BIND) {
  applyLookControl(key, sid, lid, apply);
  document.getElementById(sid).addEventListener('input', e => {
    look[key] = parseFloat(e.target.value);
    document.getElementById(lid).textContent = look[key].toFixed(2);
    apply(look[key]);
  });
}
const filmChk = document.getElementById('c-film');
filmChk.checked = look.film;
stage.film.enabled = look.film;
filmChk.addEventListener('change', () => { look.film = filmChk.checked; stage.film.enabled = look.film; filmChk.blur(); });
// bloom lives in ui.state — seed it from the saved look, track user changes
const sBloom = document.getElementById('s-bloom');
sBloom.value = look.bloom;
sBloom.dispatchEvent(new Event('input'));
sBloom.addEventListener('input', () => { look.bloom = parseFloat(sBloom.value); });
document.getElementById('b-savelook').addEventListener('click', e => {
  localStorage.setItem(LOOK_KEY, JSON.stringify(look));
  ui.toast('Look saved — loads as default from now on');
  e.target.blur();
});
document.getElementById('b-resetlook').addEventListener('click', e => {
  localStorage.removeItem(LOOK_KEY);
  Object.assign(look, LOOK_DEF);
  for (const [key, sid, lid, apply] of LOOK_BIND) applyLookControl(key, sid, lid, apply);
  sBloom.value = look.bloom;
  sBloom.dispatchEvent(new Event('input'));
  filmChk.checked = look.film;
  stage.film.enabled = look.film;
  ui.toast('Look reset to built-in defaults');
  e.target.blur();
});

// 'Ship -> Earth orbit' re-runs the full cinematic arrival (ui.js resets the
// physics; we add attitude, focus and the fly-in on top)
document.getElementById('b-ship').addEventListener('click', () => {
  bootAttitude();
  applyFocus('Starship', false);
  startArrival();
});

const tick = t => frameBody(t);
const selfTests = createSelfTests({ rig, stage, sim, shipView, system, tick });   // windowTest, perf (design spec 11)
window.__dbg = { stage, sim, system, shipView, sky, fleet, music, combat, editor, keys, renderTest, applyFocus, beamToName, interior: { rig, ...selfTests }, tick };
console.log('sunsystem boot ok');

applyFocus('Starship', false);
showTitle();
armShine(document.getElementById('shine'));
// try to start the title theme immediately: browsers that trust the site
// (media engagement / prior visits) allow it; otherwise the context stays
// suspended until the first click/keypress (musicKickoff resumes it) and a
// pulsing hint on the title screen says so.
if (musicWanted()) music.start();
music.onTrackChange(music.title);
watchCtx();
requestAnimationFrame(frame);
// ?board=1: skip the menu and boot straight into the interior (dev deep link)
if (new URLSearchParams(location.search).get('board') === '1') { startGame('free'); rig.board(); keys.clear(); }
