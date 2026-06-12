import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createStage, makeSky } from './scene.js?v=18';
import { Sim, V3 } from './physics.js?v=18';
import { SystemView } from './bodies3d.js?v=18';
import { ShipView } from './ship3d.js?v=18';
import { UI } from './ui.js?v=18';
import { ANDROMEDA, SHIP, G_ACC, fmtKm } from './data.js?v=18';

const stage = createStage(document.getElementById('app'));
const sky = makeSky(stage.scene);

const sim = new Sim();
const system = new SystemView(stage.scene, sim);
const shipView = new ShipView(stage.scene, sim);

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

// ship view = 3rd-person chase cam behind the hull; follows orientation with a soft lag.
// wheel sets distance, vertical drag sets camera height (elevation angle)
const chaseQuat = new THREE.Quaternion();
let chaseDist = 1.15;
let chaseEl = Math.atan2(0.32, 1);
stage.renderer.domElement.addEventListener('wheel', e => {
  if (focusName !== 'Starship') return;
  chaseDist = Math.min(40, Math.max(0.5, chaseDist * Math.exp(e.deltaY * 0.001)));
}, { passive: true });
let chaseDragY = null;
stage.renderer.domElement.addEventListener('pointerdown', e => {
  if (focusName === 'Starship') chaseDragY = e.clientY;
});
window.addEventListener('pointermove', e => {
  if (chaseDragY === null || focusName !== 'Starship') return;
  chaseEl = Math.min(1.35, Math.max(-0.45, chaseEl + (e.clientY - chaseDragY) * 0.004));
  chaseDragY = e.clientY;
});
window.addEventListener('pointerup', () => { chaseDragY = null; });

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
aimShipAt(sim.body('Earth'));   // boot: chase view opens onto the planet

let focusName = 'Earth';
const ui = new UI(sim, applyFocus);

function focusRadiusKm() {
  if (focusName === 'Starship') return 0.35;
  if (focusName === 'Andromeda') return ANDROMEDA.radius;
  const b = sim.body(focusName);
  return b ? b.r * (b.name === 'Sun' ? Math.min(ui.state.sizeMult, 60) : ui.state.sizeMult) : 6371;
}
function focusPos(out) {
  if (focusName === 'Starship') return out.copy(sim.ship.pos);
  if (focusName === 'Andromeda') return out.copy(andromedaPos);
  return out.copy(sim.body(focusName).pos);
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
  const dist = name === 'Andromeda' ? r * 2.4 : name === 'Starship' ? 1.1 : Math.max(r * 4.2, r + 1);
  stage.camera.position.copy(dir.multiplyScalar(dist));
  if (announce) ui.toast('Focus: ' + name, 1400);
}

// label anchors
const anchors = sim.bodies.map(b => ({ name: b.name, getPos: () => b.pos, minDist: Infinity }));
anchors.push({ name: 'Starship', cls: 'ship', getPos: () => sim.ship.pos, minDist: Infinity });
anchors.push({ name: 'Andromeda', getPos: () => andromedaPos, minDist: Infinity });
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

  focusPos(fPos);
  shipView.update(fPos, stage.camera, dtWall, keys, ui.state.shipG);
  system.update(fPos, stage.camera, ui.state.sizeMult, ui.state.trails, dtWall);

  if (focusName === 'Starship') {
    // chase cam: sit aft-above of the hull, follow orientation with a soft lag
    controls.enabled = false;
    chaseQuat.slerp(shipView.quat, 1 - Math.exp(-5 * dtWall));
    stage.camera.position.set(0, Math.sin(chaseEl), Math.cos(chaseEl)).multiplyScalar(chaseDist).applyQuaternion(chaseQuat);
    stage.camera.up.set(0, 1, 0).applyQuaternion(chaseQuat);
    stage.camera.lookAt(0, 0, 0);
  } else {
    if (!controls.enabled) { controls.enabled = true; stage.camera.up.set(0, 1, 0); }
    controls.minDistance = Math.max(focusRadiusKm() * 1.25, 1);
    controls.update();
  }

  stage.bloom.strength = ui.state.bloom;
  ui.updateLabels(fPos, stage.camera, focusName);
  ui.updateHUD(hudExtra());

  stage.composer.render();
}

window.__dbg = { stage, sim, system, shipView, sky, applyFocus, tick: t => frameBody(t) };
console.log('sunsystem boot ok');

applyFocus('Starship', false);
ui.toast('Sol system loaded — N-body physics live. Press J for the Andromeda jump.', 5200);
requestAnimationFrame(frame);
