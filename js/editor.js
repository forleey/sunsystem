// Editor mode: a live parameter inspector. Toggle it, click any scene label,
// and tweak that object's look (colours, emissive, bloom, material, planet
// shader colours, global grade). Every control updates the scene live and
// rewrites a readout block you can copy and hand back to me.
const $ = id => document.getElementById(id);
// sRGB hex (matches an <input type=color> and bakes straight into new THREE.Color(0xRRGGBB))
const hex = c => '#' + c.getHexString();
// a "glow" material is a window / running light / engine, driven by the Lights
// section and kept out of the structural Hull controls
const isGlow = m => !!(m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.12);

export class Editor {
  constructor({ stage, system, fleet, shipView, sim, ui }) {
    this.stage = stage; this.system = system; this.fleet = fleet;
    this.shipView = shipView; this.sim = sim; this.ui = ui;
    this.enabled = false;
    this.sel = null;
    this.body = $('edBody');
    this.ambient = null;
    stage.scene.traverse(n => { if (n.isAmbientLight) this.ambient = n; });
    $('editorToggle').addEventListener('click', () => this.toggle());
    $('edClose').addEventListener('click', () => this.setEnabled(false));
  }

  toggle() { this.setEnabled(!this.enabled); }

  setEnabled(on) {
    this.enabled = on;
    document.body.classList.toggle('editor', on);
    if (on) this.render();
  }

  // resolve a clicked label name to an editable target
  select(name) {
    const fo = this.fleet.byName.get(name);
    if (name === 'Starship') this.sel = { type: 'mat', name: 'Starship', root: this.shipView.grp, ship: true };
    else if (fo) this.sel = { type: 'mat', name, root: fo.grp };
    else {
      const e = this.system.entries.find(en => en.body.name === name);
      if (e) this.sel = { type: e.isSun ? 'sun' : 'body', name, entry: e };
      else return;
    }
    if (!this.enabled) this.setEnabled(true);
    this.render();
  }

  // ---------- control builders ----------
  _sec(t) { const d = document.createElement('div'); d.className = 'ed-sec'; d.textContent = t; this.body.appendChild(d); }

  _slider(label, min, max, step, get, set) {
    const row = document.createElement('div'); row.className = 'ed-row';
    const lab = document.createElement('label');
    const b = document.createElement('b');
    lab.textContent = label; lab.appendChild(b);
    const inp = document.createElement('input');
    inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = get();
    const show = () => { b.textContent = (+inp.value).toFixed(step < 0.01 ? 3 : step < 1 ? 2 : 0); };
    show();
    inp.addEventListener('input', () => { set(parseFloat(inp.value)); show(); this.readout(); });
    row.appendChild(lab); row.appendChild(inp); this.body.appendChild(row);
  }

  _color(label, get, set) {
    const row = document.createElement('div'); row.className = 'ed-row';
    const lab = document.createElement('label'); lab.textContent = label;
    const inp = document.createElement('input');
    inp.type = 'color'; inp.value = get();
    inp.addEventListener('input', () => { set(inp.value); this.readout(); });
    row.appendChild(lab); row.appendChild(inp); this.body.appendChild(row);
  }

  // gather unique materials under a root
  _mats(root) {
    const out = [], seen = new Set();
    root.traverse(n => {
      if (!n.isMesh || !n.material) return;
      for (const m of (Array.isArray(n.material) ? n.material : [n.material])) {
        if (m && !seen.has(m.uuid)) { seen.add(m.uuid); out.push(m); }
      }
    });
    return out;
  }

  // Lights: brightness (a multiplier over each glow material's baked intensity,
  // so relative window/light/engine ratios are preserved) + colour. Universal to
  // every ship and station that has any emissive glow material.
  _lightsControls(mats) {
    const glow = mats.filter(m => isGlow(m) && 'emissiveIntensity' in m);
    if (!glow.length) return;
    for (const m of glow) if (m.userData._eiBase === undefined) m.userData._eiBase = m.emissiveIntensity ?? 1;
    const g0 = glow[0];
    this._sec('Lights · windows & glows');
    this._slider('Lights brightness', 0, 4, 0.05,
      () => (g0.emissiveIntensity ?? 0) / (g0.userData._eiBase || 1),
      v => { for (const m of glow) m.emissiveIntensity = (m.userData._eiBase || 1) * v; });
    this._color('Lights colour', () => hex(g0.emissive),
      h => { for (const m of glow) if (m.emissive) m.emissive.set(h); });
  }

  // station-only controls: live greeble uniforms (window/panel detailing) + spin.
  // _grb is the shader uniform bag stashed by greeble.js at compile time.
  _stationControls(s, mats) {
    const grb = mats.filter(m => m.userData._grb).map(m => m.userData._grb);
    if (grb.length) {
      this._sec('Station · hull detailing');
      const u0 = grb[0];
      const setAll = (k, v) => { for (const u of grb) if (u[k]) u[k].value = v; };
      this._slider('Window frequency', 2, 120, 1, () => u0.uGWin.value, v => setAll('uGWin', v));
      this._slider('Window brightness', 0, 6, 0.05, () => u0.uGWinBright.value, v => setAll('uGWinBright', v));
      this._slider('Window sparsity', 0, 0.98, 0.01, () => u0.uGWinDen.value, v => setAll('uGWinDen', v));
      this._slider('Panel strength', 0, 0.6, 0.01, () => u0.uGStr.value, v => setAll('uGStr', v));
      this._color('Window tint', () => hex(u0.uGWinTint.value),
        h => { for (const u of grb) if (u.uGWinTint) u.uGWinTint.value.set(h); });
    }
    const fo = this.fleet.byName.get(s.name);
    if (fo && fo.spin != null) {
      this._sec('Station · motion');
      this._slider('Spin rate', 0, 0.1, 0.001, () => fo.spin, v => { fo.spin = v; });
    }
  }

  // ---------- render the panel ----------
  render() {
    if (!this.enabled) return;
    this.body.innerHTML = '';

    // quick-select for objects whose label can't be clicked in flight (the ship)
    const q = document.createElement('button');
    q.textContent = 'Select Starship'; q.style.marginBottom = '8px';
    q.addEventListener('click', () => this.select('Starship'));
    this.body.appendChild(q);

    // GLOBAL grade + bloom (always available)
    this._sec('Global · Bloom & Grade');
    const bloom = this.stage.bloom, r = this.stage.renderer, film = this.stage.film.material.uniforms;
    this._slider('Bloom strength', 0, 3, 0.01, () => this.ui.state.bloom, v => { this.ui.state.bloom = v; });
    this._slider('Bloom radius', 0, 2, 0.01, () => bloom.radius, v => { bloom.radius = v; });
    this._slider('Bloom threshold', 0, 1, 0.01, () => bloom.threshold, v => { bloom.threshold = v; });
    this._slider('Exposure', 0.3, 2.5, 0.01, () => r.toneMappingExposure, v => { r.toneMappingExposure = v; });
    this._slider('Contrast', 0.9, 1.4, 0.005, () => film.uCon.value, v => { film.uCon.value = v; });
    this._slider('Saturation', 0.3, 1.7, 0.01, () => film.uSat.value, v => { film.uSat.value = v; });
    this._slider('Sun light', 0, 10, 0.05, () => this.system.light.intensity, v => { this.system.light.intensity = v; });
    if (this.ambient) this._slider('Ambient fill', 0, 0.15, 0.001, () => this.ambient.intensity, v => { this.ambient.intensity = v; });

    // SELECTION
    const s = this.sel;
    if (!s) {
      const d = document.createElement('div'); d.className = 'ed-hint'; d.style.marginTop = '12px';
      d.textContent = 'No object selected. Click a label (planet, sun, station, Starship).';
      this.body.appendChild(d);
    } else if (s.type === 'body') {
      this._sec('Planet · ' + s.name);
      const u = s.entry.mat.uniforms;
      for (const key of ['uC1', 'uC2', 'uC3']) {
        if (u[key]) this._color('Colour ' + key.slice(2), () => hex(u[key].value), h => u[key].value.set(h));
      }
      const atmo = this._atmoMat(s.entry);
      if (atmo) this._color('Atmosphere', () => hex(atmo.uniforms.uColor.value), h => atmo.uniforms.uColor.value.set(h));
    } else if (s.type === 'sun') {
      this._sec('Sun · ' + s.name);
      const d = document.createElement('div'); d.className = 'ed-hint';
      d.textContent = 'Sun brightness is the "Sun light" slider above; corona and glare are shader-baked.';
      this.body.appendChild(d);
    } else if (s.type === 'mat') {
      const mats = this._mats(s.root);
      this._sec('Ship/Station · ' + s.name + ' (' + mats.length + ' materials)');
      if (!mats.length) {
        const d = document.createElement('div'); d.className = 'ed-hint';
        d.textContent = 'Model still loading, reopen in a moment.';
        this.body.appendChild(d);
      } else {
        // structural hull mats (glows are handled in the Lights section below).
        // the player ship bakes bright self-illumination onto its hull, so its
        // emissive is NOT "lights": treat all its mats as structural.
        const struct = s.ship ? mats : mats.filter(m => !isGlow(m));
        const rep = struct.find(m => m.color) || mats.find(m => m.color) || mats[0];
        this._color('Hull colour', () => rep.color ? hex(rep.color) : '#ffffff',
          h => { for (const m of struct) if (m.color) m.color.set(h); });
        this._color('Hull emissive', () => rep.emissive ? hex(rep.emissive) : '#000000',
          h => { for (const m of struct) if (m.emissive) m.emissive.set(h); });
        this._slider('Emissive intensity', 0, 6, 0.05, () => rep.emissiveIntensity ?? 1,
          v => { for (const m of struct) if ('emissiveIntensity' in m) m.emissiveIntensity = v; });
        this._slider('Metalness', 0, 1, 0.01, () => rep.metalness ?? 0,
          v => { for (const m of mats) if ('metalness' in m) m.metalness = v; });
        this._slider('Roughness', 0, 1, 0.01, () => rep.roughness ?? 1,
          v => { for (const m of mats) if ('roughness' in m) m.roughness = v; });
        // Lights: windows, running lights, engine glows (NPC ships & stations).
        // The player ship uses its own self-light & exhaust section instead.
        if (!s.ship) this._lightsControls(mats);
        if (s.ship) {
          const sv = this.shipView;
          this._sec('Starship · self-light & exhaust');
          this._slider('Ship-light glow', 0, 5, 0.05, () => sv.selfGlow, v => { sv.selfGlow = v; });
          this._slider('Fill light', 0, 2, 0.02, () => sv.selfLit.intensity, v => { sv.selfLit.intensity = v; });
          this._color('Fill light colour', () => hex(sv.selfLit.color), h => sv.selfLit.color.set(h));
          this._slider('Exhaust brightness', 0, 2.5, 0.02, () => sv.exhaustMul, v => { sv.exhaustMul = v; });
          this._color('Exhaust tint', () => hex(sv.exhaustColor), h => sv.exhaustColor.set(h));
        }
        this._stationControls(s, mats);
      }
    }

    // readout + copy
    this._sec('Readout (copy & send to me)');
    this.ta = document.createElement('textarea'); this.ta.readOnly = true;
    this.body.appendChild(this.ta);
    const btn = document.createElement('button');
    btn.textContent = 'Copy to clipboard'; btn.style.marginTop = '6px';
    btn.addEventListener('click', () => {
      try { navigator.clipboard.writeText(this.ta.value); } catch (e) {}
      btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy to clipboard'; }, 1400);
    });
    this.body.appendChild(btn);
    this.readout();
  }

  _atmoMat(entry) {
    let found = null;
    entry.grp.traverse(n => {
      if (n.isMesh && n.material && n.material.uniforms && n.material.uniforms.uColor && !found) found = n.material;
    });
    return found;
  }

  // rebuild the copyable text block from current live values
  readout() {
    if (!this.ta) return;
    const bloom = this.stage.bloom, r = this.stage.renderer, film = this.stage.film.material.uniforms;
    const L = [];
    L.push('GLOBAL bloom.strength=' + this.ui.state.bloom.toFixed(2)
      + ' radius=' + bloom.radius.toFixed(2) + ' threshold=' + bloom.threshold.toFixed(2)
      + ' exposure=' + r.toneMappingExposure.toFixed(2)
      + ' contrast=' + film.uCon.value.toFixed(3) + ' saturation=' + film.uSat.value.toFixed(2)
      + ' sunLight=' + this.system.light.intensity.toFixed(2)
      + (this.ambient ? ' ambient=' + this.ambient.intensity.toFixed(3) : ''));
    const s = this.sel;
    if (s && s.type === 'body') {
      const u = s.entry.mat.uniforms, atmo = this._atmoMat(s.entry);
      L.push(s.name + ' c1=' + hex(u.uC1.value) + ' c2=' + hex(u.uC2.value) + ' c3=' + hex(u.uC3.value)
        + (atmo ? ' atmosphere=' + hex(atmo.uniforms.uColor.value) : ''));
    } else if (s && s.type === 'mat') {
      const allMats = this._mats(s.root);
      const rep = allMats.find(m => m.color && !isGlow(m)) || allMats.find(m => m.color);
      if (rep) {
        let line = s.name + ' hull=' + hex(rep.color)
          + ' emissive=' + (rep.emissive ? hex(rep.emissive) : 'n/a')
          + ' emissiveIntensity=' + (rep.emissiveIntensity ?? 1).toFixed(2)
          + ' metalness=' + (rep.metalness ?? 0).toFixed(2) + ' roughness=' + (rep.roughness ?? 1).toFixed(2);
        const glow = s.ship ? [] : allMats.filter(m => isGlow(m) && 'emissiveIntensity' in m);
        if (glow.length) {
          const g0 = glow[0];
          line += ' lights=' + ((g0.emissiveIntensity ?? 0) / (g0.userData._eiBase || 1)).toFixed(2);
          if (glow.every(m => m.emissive.getHex() === g0.emissive.getHex())) line += ' lightsColour=' + hex(g0.emissive);
        }
        L.push(line);
      }
      if (s.ship) {
        const sv = this.shipView;
        L.push('Starship shipGlow=' + sv.selfGlow.toFixed(2) + ' fillLight=' + sv.selfLit.intensity.toFixed(2)
          + ' fillColour=' + hex(sv.selfLit.color) + ' exhaustBright=' + sv.exhaustMul.toFixed(2)
          + ' exhaustTint=' + hex(sv.exhaustColor));
      } else {
        const grb = allMats.filter(m => m.userData._grb).map(m => m.userData._grb);
        const fo = this.fleet.byName.get(s.name);
        const parts = [];
        if (grb.length) {
          const u = grb[0];
          parts.push('winFreq=' + u.uGWin.value.toFixed(1)
            + ' winBright=' + u.uGWinBright.value.toFixed(2)
            + ' winSparsity=' + u.uGWinDen.value.toFixed(2)
            + ' panel=' + u.uGStr.value.toFixed(2)
            + ' winTint=' + hex(u.uGWinTint.value));
        }
        if (fo && fo.spin != null) parts.push('spin=' + fo.spin.toFixed(3));
        if (parts.length) L.push(s.name + ' detail ' + parts.join(' '));
      }
    }
    this.ta.value = L.join('\n');
  }
}
