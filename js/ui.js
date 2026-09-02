// Sliders, HUD, body labels.
import * as THREE from 'three';
import { fmtKm, fmtSpeed, fmtWarp, C_KMS } from './data.js?v=103';
import { toRender } from './scene.js?v=103';

const $ = id => document.getElementById(id);

export class UI {
  constructor(sim, onFocus, extraNames = []) {
    this.sim = sim;
    this.state = { warp: 1, sizeMult: 1, shipG: 0.05, bloom: 0.15, trails: true, labels: true };
    this.onFocus = onFocus;
    this.labelEls = new Map();
    this.tmp = new THREE.Vector3();

    const bindLog = (slider, label, fmt, set) => {
      $(slider).addEventListener('input', e => {
        const v = Math.pow(10, parseFloat(e.target.value));
        $(label).textContent = fmt(v);
        set(v);
      });
    };
    bindLog('s-warp', 'v-warp', fmtWarp, v => { this.state.warp = v; });
    bindLog('s-psize', 'v-psize', v => v < 1.05 ? '1× (real)' : Math.round(v) + '×', v => { this.state.sizeMult = v; });
    $('s-g').addEventListener('input', e => {
      sim.gMult = parseFloat(e.target.value);
      $('v-g').textContent = sim.gMult.toFixed(2) + '×';
    });
    // ship max speed in multiples of c (1 G = light speed), log slider 0.05–100
    bindLog('s-shipg', 'v-shipg',
      v => (v >= 10 ? Math.round(v) : v >= 1 ? v.toFixed(1) : v.toFixed(2)) + ' G',
      v => { this.state.shipG = v; });
    $('s-bloom').addEventListener('input', e => {
      this.state.bloom = parseFloat(e.target.value);
      $('v-bloom').textContent = this.state.bloom.toFixed(2);
    });
    $('c-rel').addEventListener('change', e => { sim.relativistic = e.target.checked; });
    $('c-trails').addEventListener('change', e => { this.state.trails = e.target.checked; });
    $('c-labels').addEventListener('change', e => {
      this.state.labels = e.target.checked;
      $('labels').style.display = e.target.checked ? '' : 'none';
    });
    $('b-reset').addEventListener('click', () => this.resetDefaults());
    $('b-ship').addEventListener('click', () => { sim.resetShip(); this.toast('Ship returned to Earth orbit'); });
    // fold-up panels: collapsed, the whole chip is the button; open, only the
    // header folds (clicks on the controls must not). Height animates via the
    // CSS grid-rows transition; the width change is FLIP-tweened alongside.
    const fold = (panel, head, icon) => {
      const p = $(panel), h = $(head);
      p.addEventListener('click', e => {
        if (!p.classList.contains('closed') && !h.contains(e.target)) return;
        const w0 = p.offsetWidth;
        $(icon).textContent = p.classList.toggle('closed') ? '[+]' : '[–]';
        const w1 = p.offsetWidth;
        if (w0 !== w1) p.animate([{ width: w0 + 'px' }, { width: w1 + 'px' }],
          { duration: 280, easing: 'ease' });
      });
    };
    fold('settings', 'settingsHead', 'collapse');
    fold('help', 'helpHead', 'helpToggle');

    const sel = $('focus');
    const names = ['Starship', ...sim.bodies.map(b => b.name), ...extraNames, 'Andromeda'];
    for (const n of names) {
      const o = document.createElement('option');
      o.value = n; o.textContent = n;
      sel.appendChild(o);
    }
    sel.value = 'Earth';
    sel.addEventListener('change', e => onFocus(e.target.value));
  }

  resetDefaults() {
    const set = (id, v, evt = 'input') => { $(id).value = v; $(id).dispatchEvent(new Event(evt)); };
    set('s-warp', 0); set('s-g', 1); set('s-psize', 0); set('s-shipg', -1.301); set('s-bloom', 0.15);
    $('c-rel').checked = false; this.sim.relativistic = false;
    this.toast('Realistic defaults restored');
  }

  setWarp(w) {
    this.state.warp = w;
    $('s-warp').value = Math.log10(Math.max(1, w));
    $('v-warp').textContent = fmtWarp(w);
  }

  setFocusSelect(name) { $('focus').value = name; }

  toast(msg, ms = 2600) {
    const t = $('toast');
    t.textContent = msg;
    t.style.opacity = 1;
    clearTimeout(this._tt);
    this._tt = setTimeout(() => { t.style.opacity = 0; }, ms);
  }

  // anchors: [{name, cls, getPos(V3out)}] in physics frame
  initLabels(anchors) {
    for (const a of anchors) this.addLabel(a);
  }

  // dynamic label registration (combat spawns raiders / drafts wingmen)
  addLabel(a) {
    const el = document.createElement('div');
    el.className = 'lbl' + (a.cls ? ' ' + a.cls : '');
    el.textContent = a.name;
    el.addEventListener('click', e => this.onFocus(a.name, e.shiftKey));
    $('labels').appendChild(el);
    this.labelEls.set(a.name, { el, a });
  }

  removeLabel(name) {
    const rec = this.labelEls.get(name);
    if (!rec) return;
    rec.el.remove();
    this.labelEls.delete(name);
  }

  updateLabels(focusPos, camera, focusName) {
    if (!this.state.labels) return;
    const w = window.innerWidth, h = window.innerHeight;
    for (const { el, a } of this.labelEls.values()) {
      const p = a.getPos();
      this.tmp.set(p.x - focusPos.x, p.y - focusPos.y, p.z - focusPos.z);
      const v = toRender(this.tmp, this.tmp);
      const dist = v.length();
      v.project(camera);
      const behind = v.z > 1 || v.z < -1;
      const vis = !behind && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05
        && (a.name === focusName ? dist > (a.minDist || 0) : true);
      el.style.display = vis ? '' : 'none';
      if (vis) {
        el.style.left = ((v.x * 0.5 + 0.5) * w) + 'px';
        el.style.top = ((-v.y * 0.5 + 0.5) * h) + 'px';
      }
    }
  }

  updateHUD(extra) {
    const sim = this.sim, ship = sim.ship;
    $('h-warp').textContent = fmtWarp(this.state.warp) + (sim.relativistic ? '  ·  c-limit ON' : '');
    const spd = extra.relSpeed != null ? extra.relSpeed : ship.speed();
    $('h-speed').textContent = fmtSpeed(spd)
      + (spd > 0.01 * C_KMS && spd < 10 * C_KMS ? ` (${(spd / C_KMS * 100).toFixed(1)}% c)` : '')
      + (extra.relName ? `  rel ${extra.relName}` : '');
    $('h-throttle').textContent = ship.autopilot ? '100% AP' : Math.round(ship.throttle * 100) + '%';
    $('h-acc').textContent = ship.lastG >= 1000
      ? Math.round(ship.lastG).toLocaleString('en-US') + ' g'
      : ship.lastG.toFixed(1) + ' g';
    $('h-near').textContent = extra.nearest;

    const ap = sim.apProgress();
    const apEl = $('ap');
    if (ap) {
      apEl.style.display = 'block';
      $('ap-txt').textContent = `AUTOPILOT ${ap.label} — ${ap.phase || 'ALIGN'} — ${fmtKm(ap.dist)} to go`;
      $('ap-bar').style.width = (ap.frac * 100).toFixed(2) + '%';
    } else {
      apEl.style.display = 'none';
    }
  }
}
