import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createStage, makeSky } from './scene.js?v=46';
import { Sim, V3 } from './physics.js?v=46';
import { SystemView } from './bodies3d.js?v=46';
import { ShipView } from './ship3d.js?v=46';
import { UI } from './ui.js?v=46';
import { ANDROMEDA, SHIP, G_ACC, fmtKm } from './data.js?v=46';
import { Fleet } from './fleet.js?v=46';
import { Music, renderTest } from './music.js?v=46';
import { initEnvironment } from './models.js?v=46';

const stage = createStage(document.getElementById('app'));
const sky = makeSky(stage.scene);
initEnvironment(stage.renderer, stage.scene);

const sim = new Sim();
const system = new SystemView(stage.scene, sim);
const shipView = new ShipView(stage.scene, sim);
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

// ship view = 3rd-person chase cam behind the hull; follows orientation with a soft lag.
// wheel sets distance, vertical drag sets camera height (elevation angle)
const chaseQuat = new THREE.Quaternion();
let chaseDist = 0.6;
let chaseEl = Math.atan2(0.32, 1);
stage.renderer.domElement.addEventListener('wheel', e => {
  if (focusName !== 'Starship') return;
  chaseDist = Math.min(40, Math.max(0.5, chaseDist * Math.exp(e.deltaY * 0.001)));
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
  if (focusName !== 'Starship') return;
  if (e.button === 2) chaseDragY = e.clientY;
  else if (e.button === 0) {
    steering = true;
    shipView.angVel.set(0, 0, 0);          // kill any residual key-spin
    const p = stage.renderer.domElement.requestPointerLock();
    if (p && p.catch) p.catch(() => {});   // denied lock -> visible-cursor fallback
  }
});
window.addEventListener('pointermove', e => {
  if (focusName !== 'Starship') return;
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
// boot attitude: nose on the bisector between sun and Earth so the crescent
// rides top-right and the sun glares bottom-left, with a cinematic bank
function bootAttitude(rollRad = -0.6) {
  const e = sim.body('Earth'), sun = sim.bodies[0], sp = sim.ship.pos;
  const S = new THREE.Vector3(sun.pos.x - sp.x, sun.pos.z - sp.z, -(sun.pos.y - sp.y)).normalize();
  const E = new THREE.Vector3(e.pos.x - sp.x, e.pos.z - sp.z, -(e.pos.y - sp.y)).normalize();
  const dir = S.add(E).normalize();
  shipView.quat.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
  shipView.quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rollRad));
  chaseQuat.copy(shipView.quat);
}
bootAttitude();

let focusName = 'Earth';
const ui = new UI(sim, (name, beam) => { if (beam) beamToName(name); else applyFocus(name); },
  fleet.objects.map(o => o.name));

function focusRadiusKm() {
  if (focusName === 'Starship') return 0.35;
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
    const standoff = Math.max(fo.radiusKm * 3, 1.5);
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
  ui.toast('Beamed to ' + name);
}
function applyFocus(name, announce = true) {
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
  const dist = name === 'Andromeda' ? r * 2.4 : name === 'Starship' ? 0.6 : Math.max(r * 4.2, r + 1);
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
    onDone: () => { sim.resetShip(); ui.setWarp(1); ui.toast('Back in Earth orbit'); },
  };
  ui.toast('Autopilot engaged: return to Earth');
  applyFocus('Starship', false);
}

window.addEventListener('keydown', e => {
  if (e.target.tagName === 'SELECT') return;   // keep arrow/enter nav inside the focus dropdown
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();  // helm keys never drive UI controls
  keys.add(e.code);
  if (e.code === 'KeyJ') startAndromedaJump();
  if (e.code === 'KeyH') startHomeJump();
  if (e.code === 'KeyF') applyFocus('Starship');
  if (e.code === 'KeyM') { music.toggle(); music.onTrackChange(music.title); }
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
const music = new Music(title => {
  document.getElementById('v-track').textContent = music.enabled ? title : 'off';
  document.getElementById('b-music').innerHTML = music.enabled ? '&#9834; Pause' : '&#9834; Play';
});
document.getElementById('b-music').addEventListener('click', () => {
  music.toggle();
  music.onTrackChange(music.title);
});
document.getElementById('b-nexttrack').addEventListener('click', () => music.next());
// start softly on the very first interaction anywhere (autoplay policy)
const musicKickoff = () => {
  if (!music.ctx) music.start();
  window.removeEventListener('pointerdown', musicKickoff, true);
  window.removeEventListener('keydown', musicKickoff, true);
};
window.addEventListener('pointerdown', musicKickoff, true);
window.addEventListener('keydown', musicKickoff, true);

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
  fleet.tick(sim.time);

  focusPos(fPos);
  shipView.update(fPos, stage.camera, dtWall, keys, ui.state.shipG);
  system.update(fPos, stage.camera, ui.state.sizeMult, ui.state.trails, dtWall);
  fleet.place(fPos, sim.time, dtWall);

  if (focusName === 'Starship') {
    // chase cam: sit aft-above of the hull, follow orientation with a soft lag
    controls.enabled = false;
    chaseQuat.slerp(shipView.quat, 1 - Math.exp(-5 * dtWall));
    stage.camera.position.set(0, Math.sin(chaseEl), Math.cos(chaseEl)).multiplyScalar(chaseDist).applyQuaternion(chaseQuat);
    stage.camera.up.set(0, 1, 0).applyQuaternion(chaseQuat);
    stage.camera.lookAt(0, 0, 0);
  } else {
    if (!controls.enabled) { controls.enabled = true; stage.camera.up.set(0, 1, 0); }
    controls.minDistance = Math.max(focusRadiusKm() * 1.25, 0.08);
    controls.update();
  }

  stage.bloom.strength = ui.state.bloom;
  stage.film.material.uniforms.uTime.value = (now * 0.001) % 100;
  ui.updateLabels(fPos, stage.camera, focusName);
  ui.updateHUD(hudExtra());

  stage.composer.render();

  // flight reticle: project the nose direction onto the screen (ship view only)
  if (focusName === 'Starship') {
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
const LOOK_DEF = { bloom: 0.15, exposure: 1.15, contrast: 1.045, saturation: 1.07, grain: 1, vignette: 1, film: true };
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

window.__dbg = { stage, sim, system, shipView, sky, fleet, music, renderTest, applyFocus, beamToName, tick: t => frameBody(t) };
console.log('sunsystem boot ok');

applyFocus('Starship', false);
ui.toast('Sol system loaded — N-body physics live. Press J for the Andromeda jump.', 5200);
requestAnimationFrame(frame);
