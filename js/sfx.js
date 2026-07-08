// Combat sound effects — synthesized live with Web Audio, no files.
// Own AudioContext (independent of the music engine); every call is
// try/catch-guarded so audio can never break the game loop. The context
// unlocks on the first user gesture (K toggle / checkbox counts).
export class Sfx {
  constructor() { this.ctx = null; this.out = null; }

  _c() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.5;
      this.out.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  unlock() { try { this._c(); } catch (e) {} }

  _env(g, t0, a, peak, d) {
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }

  _noise(dur) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * dur);
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const s = ctx.createBufferSource();
    s.buffer = b;
    return s;
  }

  // sharp descending zap, doubled an octave down
  laser(vol = 1) {
    if (!(vol > 0.05)) return;
    try {
      const ctx = this._c(), t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(1500, t);
      o.frequency.exponentialRampToValueAtTime(180, t + 0.16);
      const g = ctx.createGain(); this._env(g, t, 0.004, 0.2 * vol, 0.18);
      o.connect(g); g.connect(this.out); o.start(t); o.stop(t + 0.26);
      const o2 = ctx.createOscillator(); o2.type = 'square';
      o2.frequency.setValueAtTime(720, t);
      o2.frequency.exponentialRampToValueAtTime(95, t + 0.12);
      const g2 = ctx.createGain(); this._env(g2, t, 0.002, 0.09 * vol, 0.12);
      o2.connect(g2); g2.connect(this.out); o2.start(t); o2.stop(t + 0.2);
    } catch (e) {}
  }

  // torpedo launch: rising band-passed whoosh over a sinking sub tone
  torp(vol = 1) {
    if (!(vol > 0.05)) return;
    try {
      const ctx = this._c(), t = ctx.currentTime;
      const n = this._noise(0.6);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2.2;
      bp.frequency.setValueAtTime(220, t);
      bp.frequency.exponentialRampToValueAtTime(1400, t + 0.5);
      const g = ctx.createGain(); this._env(g, t, 0.03, 0.28 * vol, 0.5);
      n.connect(bp); bp.connect(g); g.connect(this.out); n.start(t);
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(58, t + 0.45);
      const g2 = ctx.createGain(); this._env(g2, t, 0.02, 0.16 * vol, 0.45);
      o.connect(g2); g2.connect(this.out); o.start(t); o.stop(t + 0.55);
    } catch (e) {}
  }

  // explosion: noise through a falling lowpass + sub thump
  boom(vol = 1, big = false) {
    if (!(vol > 0.04)) return;
    try {
      const ctx = this._c(), t = ctx.currentTime;
      const dur = big ? 1.1 : 0.55;
      const n = this._noise(dur);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.setValueAtTime(big ? 1800 : 1300, t);
      lp.frequency.exponentialRampToValueAtTime(65, t + dur);
      const g = ctx.createGain(); this._env(g, t, 0.012, (big ? 0.6 : 0.38) * vol, dur);
      n.connect(lp); lp.connect(g); g.connect(this.out); n.start(t);
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(big ? 85 : 70, t);
      o.frequency.exponentialRampToValueAtTime(26, t + dur * 0.7);
      const g2 = ctx.createGain(); this._env(g2, t, 0.01, 0.3 * vol, dur * 0.7);
      o.connect(g2); g2.connect(this.out); o.start(t); o.stop(t + dur);
    } catch (e) {}
  }

  // we've been hit: dull metallic thud
  hit() {
    try {
      const ctx = this._c(), t = ctx.currentTime;
      const n = this._noise(0.16);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
      const g = ctx.createGain(); this._env(g, t, 0.004, 0.34, 0.15);
      n.connect(lp); lp.connect(g); g.connect(this.out); n.start(t);
      const o = ctx.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(190, t);
      o.frequency.exponentialRampToValueAtTime(70, t + 0.12);
      const g2 = ctx.createGain(); this._env(g2, t, 0.003, 0.2, 0.13);
      o.connect(g2); g2.connect(this.out); o.start(t); o.stop(t + 0.2);
    } catch (e) {}
  }

  // a shot connects with a hull: a crisp, bright zap-thwack. Shorter and
  // brighter than the dull "we've been hit" thud, so landing a hit reads.
  impact(vol = 1) {
    if (!(vol > 0.05)) return;
    try {
      const ctx = this._c(), t = ctx.currentTime;
      const n = this._noise(0.14);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.1;
      bp.frequency.setValueAtTime(2600, t);
      bp.frequency.exponentialRampToValueAtTime(650, t + 0.12);
      const g = ctx.createGain(); this._env(g, t, 0.002, 0.22 * vol, 0.12);
      n.connect(bp); bp.connect(g); g.connect(this.out); n.start(t);
      const o = ctx.createOscillator(); o.type = 'square';
      o.frequency.setValueAtTime(520, t);
      o.frequency.exponentialRampToValueAtTime(170, t + 0.1);
      const g2 = ctx.createGain(); this._env(g2, t, 0.001, 0.1 * vol, 0.1);
      o.connect(g2); g2.connect(this.out); o.start(t); o.stop(t + 0.16);
    } catch (e) {}
  }

  // target lock acquired: two quick blips
  lock() {
    try {
      const ctx = this._c(), t = ctx.currentTime;
      for (const [dt, f] of [[0, 880], [0.09, 1318]]) {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        const g = ctx.createGain(); this._env(g, t + dt, 0.004, 0.12, 0.07);
        o.connect(g); g.connect(this.out); o.start(t + dt); o.stop(t + dt + 0.12);
      }
    } catch (e) {}
  }

  // escort warp-in: shimmering upward sweep
  warp(vol = 1) {
    try {
      const ctx = this._c(), t = ctx.currentTime;
      for (const det of [-7, 0, 7]) {
        const o = ctx.createOscillator(); o.type = 'sine'; o.detune.value = det * 3;
        o.frequency.setValueAtTime(240, t);
        o.frequency.exponentialRampToValueAtTime(1500, t + 0.55);
        const g = ctx.createGain(); this._env(g, t, 0.06, 0.09 * vol, 0.6);
        o.connect(g); g.connect(this.out); o.start(t); o.stop(t + 0.7);
      }
    } catch (e) {}
  }

  // continuous engine bed: a filtered-noise "roar" (band-passed with a bit of
  // resonance so it carries on laptop speakers) over a mid thrum and a low sub.
  // Level + brightness follow throttle every frame: present, but not a roar.
  engine(v) {
    try {
      if (!this.ctx && !(v > 0)) return;   // never create audio before a gesture-driven burn
      const ctx = this._c();
      if (!this.eng) {
        // noise roar: highpass keeps some "air", resonant lowpass gives body
        const noise = this._noise(2); noise.loop = true;
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 130;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; lp.Q.value = 3.5;
        const ng = ctx.createGain(); ng.gain.value = 0;
        noise.connect(hp); hp.connect(lp); lp.connect(ng); ng.connect(this.out); noise.start();
        // mid thrum: a sawtooth pair around 108 Hz, the part small speakers hear
        const m1 = ctx.createOscillator(); m1.type = 'sawtooth'; m1.frequency.value = 108;
        const m2 = ctx.createOscillator(); m2.type = 'sawtooth'; m2.frequency.value = 108; m2.detune.value = 11;
        const mlp = ctx.createBiquadFilter(); mlp.type = 'lowpass'; mlp.frequency.value = 900; mlp.Q.value = 0.7;
        const mg = ctx.createGain(); mg.gain.value = 0;
        m1.connect(mlp); m2.connect(mlp); mlp.connect(mg); mg.connect(this.out); m1.start(); m2.start();
        // low sub for weight
        const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 62;
        const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 62; o2.detune.value = 9;
        const og = ctx.createGain(); og.gain.value = 0;
        o1.connect(og); o2.connect(og); og.connect(this.out); o1.start(); o2.start();
        this.eng = { lp, ng, mlp, mg, og, m1, m2 };
      }
      const t = this.ctx.currentTime, nv = Math.min(1, Math.max(0, v));
      // quick spool-up while burning, gentle spool-down when the throttle is cut
      const tau = nv > 0 ? 0.1 : 0.4;
      this.eng.ng.gain.setTargetAtTime(nv * 0.34, t, tau);
      this.eng.mg.gain.setTargetAtTime(nv * 0.11, t, tau);
      this.eng.og.gain.setTargetAtTime(nv * 0.15, t, tau);
      this.eng.lp.frequency.setTargetAtTime(520 + nv * 1500, t, 0.18);
      this.eng.m1.frequency.setTargetAtTime(104 + nv * 26, t, 0.2);
      this.eng.m2.frequency.setTargetAtTime(104 + nv * 26, t, 0.2);
    } catch (e) {}
  }

  // red alert: two-tone klaxon
  alert() {
    try {
      const ctx = this._c(), t = ctx.currentTime;
      for (let i = 0; i < 2; i++) {
        const t0 = t + i * 0.42;
        const o = ctx.createOscillator(); o.type = 'sawtooth';
        o.frequency.setValueAtTime(392, t0);
        o.frequency.linearRampToValueAtTime(587, t0 + 0.18);
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1600;
        const g = ctx.createGain(); this._env(g, t0, 0.02, 0.16, 0.34);
        o.connect(lp); lp.connect(g); g.connect(this.out); o.start(t0); o.stop(t0 + 0.4);
      }
    } catch (e) {}
  }
}
