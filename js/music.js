// Ambient music engine. Tracks are note data (composed by claude-sonnet-5 via
// OpenRouter, see music_tracks.js); this synthesizes them with Web Audio —
// no audio files, loops forever. The graph builder is BaseAudioContext-agnostic
// so the whole engine can be verified with an OfflineAudioContext render.
import { TRACKS } from './music_tracks.js?v=81';

const midiHz = m => 440 * Math.pow(2, (m - 69) / 12);

function makeIR(ctx, seconds) {
  const rate = ctx.sampleRate, len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
  }
  return buf;
}

export function buildMaster(ctx, dest) {
  const out = ctx.createGain(); out.gain.value = 0.34;
  const bus = ctx.createGain(); bus.gain.value = 1;
  const dry = ctx.createGain(); dry.gain.value = 0.55;
  const conv = ctx.createConvolver(); conv.buffer = makeIR(ctx, 5.5);
  const wet = ctx.createGain(); wet.gain.value = 0.8;
  bus.connect(dry); dry.connect(out);
  bus.connect(conv); conv.connect(wet); wet.connect(out);
  out.connect(dest);
  return { bus, out };
}

// spawn one note; returns nodes so a track switch can stop them early
export function spawnNote(ctx, bus, type, t0, dur, hz, vel) {
  const g = ctx.createGain();
  g.gain.value = 0;
  const nodes = [g];
  const oscs = [];
  const mk = (kind, f, det) => {
    const o = ctx.createOscillator();
    o.type = kind; o.frequency.value = f;
    if (det) o.detune.value = det;
    oscs.push(o); nodes.push(o);
    return o;
  };
  // percussion: a short filtered-noise hit. Pitch tunes the band center, so
  // low midi = tom/kick, high = snare/hat. Self-contained, returns early.
  if (type === 'perc') {
    const src = ctx.createBufferSource();
    const len = Math.floor(ctx.sampleRate * 0.4), buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const dch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) dch[i] = (Math.random() * 2 - 1) * (1 - i / len);
    src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = hz; bp.Q.value = 0.9;
    src.connect(bp); bp.connect(g); g.connect(bus);
    nodes.push(src, bp);
    const decay = 0.06 + Math.min(dur, 0.6) * 0.5;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vel, t0 + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.02 + decay);
    src.start(t0); src.stop(t0 + 0.42);
    return nodes;
  }
  let att = 2.5, rel = 4, lpF = 900, amp = vel;
  if (type === 'drone') {
    mk('triangle', hz).connect(g); mk('triangle', hz, 8).connect(g); mk('sine', hz / 2).connect(g);
    att = 3.5; rel = 6; lpF = 340; amp = vel * 0.5;
  } else if (type === 'pad') {
    mk('sawtooth', hz, -6).connect(g); mk('sawtooth', hz, 7).connect(g);
    att = 2.8; rel = 4.5; lpF = 950; amp = vel * 0.36;
  } else if (type === 'bass') {
    mk('sine', hz).connect(g); mk('triangle', hz, 4).connect(g);
    att = 0.35; rel = 1.4; lpF = 240; amp = vel * 0.7;
  } else if (type === 'brass') {
    // martial fanfare stab: detuned saws + a square sub, bright and short
    mk('sawtooth', hz, -9).connect(g); mk('sawtooth', hz, 9).connect(g); mk('square', hz / 2).connect(g);
    att = 0.02; rel = 0.28; lpF = 2600; amp = vel * 0.5;
  } else { // bell
    const o1 = mk('sine', hz), o2 = mk('sine', hz * 2.01);
    const g2 = ctx.createGain(); g2.gain.value = 0.35; nodes.push(g2);
    o1.connect(g); o2.connect(g2); g2.connect(g);
    att = 0.01; rel = Math.max(3, dur); lpF = 6000; amp = vel * 0.5;
    // feedback echo
    const dl = ctx.createDelay(1.2); dl.delayTime.value = 0.44;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    g.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(bus);
    nodes.push(dl, fb);
  }
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = lpF; lp.Q.value = 0.4;
  nodes.push(lp);
  if (type === 'pad') {
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 0.07; lg.gain.value = 260;
    lfo.connect(lg); lg.connect(lp.frequency);
    lfo.start(t0); lfo.stop(t0 + dur + rel + 0.1);
    nodes.push(lfo, lg);
  }
  g.connect(lp); lp.connect(bus);
  const tEnd = t0 + dur;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(amp, t0 + Math.min(att, dur * 0.6));
  g.gain.setValueAtTime(amp, Math.max(t0 + Math.min(att, dur * 0.6), tEnd - 0.05));
  g.gain.linearRampToValueAtTime(0.0001, tEnd + rel);
  for (const o of oscs) { o.start(t0); o.stop(tEnd + rel + 0.1); }
  return nodes;
}

export function scheduleTrack(ctx, bus, track, at) {
  const spb = 60 / track.bpm;
  const nodes = [];
  for (const v of track.voices) {
    for (const [s, d, m, vel] of v.notes) {
      nodes.push(...spawnNote(ctx, bus, v.type, at + s * spb, d * spb, midiHz(m), vel));
    }
  }
  return { nodes, loopDur: track.loopBeats * spb };
}

export class Music {
  constructor(onTrackChange) {
    this.enabled = false;
    this.idx = 0;
    this.ctx = null;
    this.onTrackChange = onTrackChange || (() => {});
    this._live = [];
    this._timer = null;
    this._ambientOn = false;
    // aux layers on their own buses, crossfaded over the ambient bed:
    // combat (Red Alert, by threat level) and title (Starblazer Theme)
    this.combatL = this._mkLayer(t => t.combat);
    this.titleL = this._mkLayer(t => t.titleTrack);
    this.titleActive = false;
  }

  _mkLayer(sel) { return { sel, gain: null, bus: null, timer: null, live: [], level: 0 }; }
  get title() { return TRACKS[this.idx].title; }

  _ensureCtx() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = buildMaster(this.ctx, this.ctx.destination);
  }

  // must be called from a user gesture the first time (autoplay policy)
  start() {
    this._ensureCtx();
    if (!this._ambientOn) {
      this._loop(this.ctx.currentTime + 0.15);
      this._ambientOn = true;
    }
    this.ctx.resume();
    this.enabled = true;
    if (this.titleActive) this._setLayer(this.titleL, 1);   // booted on the start screen
    this.onTrackChange(this.title);
  }

  _loop(at) {
    const { nodes, loopDur } = scheduleTrack(this.ctx, this.master.bus, TRACKS[this.idx], at);
    this._live.push({ nodes, until: at + loopDur + 10 });
    this._live = this._live.filter(l => l.until > this.ctx.currentTime);
    const lead = (at + loopDur - this.ctx.currentTime - 2) * 1000;
    this._timer = setTimeout(() => this._loop(at + loopDur), Math.max(250, lead));
  }

  _stopAll() {
    clearTimeout(this._timer);
    const now = this.ctx.currentTime;
    this.master.bus.gain.setValueAtTime(this.master.bus.gain.value, now);
    this.master.bus.gain.linearRampToValueAtTime(0.0001, now + 1.2);
    const old = this._live; this._live = [];
    const oldBus = this.master.bus;
    setTimeout(() => {
      for (const l of old) for (const n of l.nodes) { try { n.disconnect(); } catch (e) {} }
      try { oldBus.disconnect(); } catch (e) {}
    }, 1500);
    this.master = buildMaster(this.ctx, this.ctx.destination);   // fresh bus + reverb
    // aux layers outlive track switches — re-hang them on the new master
    for (const L of [this.combatL, this.titleL]) {
      if (!L.gain) continue;
      try { L.gain.disconnect(); } catch (e) {}
      L.gain.connect(this.master.out);
    }
  }

  _nextIdx() {   // ambient rotation skips the layer-only tracks
    do { this.idx = (this.idx + 1) % TRACKS.length; }
    while (TRACKS[this.idx].combat || TRACKS[this.idx].titleTrack);
  }

  next() {
    if (!this.ctx) { this._nextIdx(); this.onTrackChange(this.title); return; }
    this._stopAll();
    this._nextIdx();
    this._loop(this.ctx.currentTime + 0.4);
    this.onTrackChange(this.title);
  }

  // ---- aux layer engine (combat + title themes) ----
  _armLayer(L) {
    this._ensureCtx();
    this.ctx.resume();
    if (!L.gain) {
      L.gain = this.ctx.createGain();
      L.gain.gain.value = 0;
      L.gain.connect(this.master.out);
      L.bus = this.ctx.createGain();
      L.bus.connect(L.gain);
    }
  }

  _layerLoop(L, at) {
    const idx = TRACKS.findIndex(L.sel);
    if (idx < 0) return;
    const { nodes, loopDur } = scheduleTrack(this.ctx, L.bus, TRACKS[idx], at);
    L.live.push({ nodes, until: at + loopDur + 10 });
    L.live = L.live.filter(l => l.until > this.ctx.currentTime);
    const lead = (at + loopDur - this.ctx.currentTime - 2) * 1000;
    L.timer = setTimeout(() => this._layerLoop(L, at + loopDur), Math.max(250, lead));
  }

  _setLayer(L, v) {
    if (!(v > 0) && !L.gain) { L.level = 0; return; }
    this._armLayer(L);
    if (v > 0 && !L.timer) this._layerLoop(L, this.ctx.currentTime + 0.2);
    L.level = v;
    const now = this.ctx.currentTime;
    L.gain.gain.cancelScheduledValues(now);
    L.gain.gain.setValueAtTime(L.gain.gain.value, now);
    L.gain.gain.linearRampToValueAtTime(v * 0.95, now + 1.4);
    this._applyDuck();
  }

  _stopLayer(L) {
    if (!L.gain) return;
    this._setLayer(L, 0);
    clearTimeout(L.timer);
    L.timer = null;
    const old = L.live;
    L.live = [];
    setTimeout(() => {
      for (const l of old) for (const n of l.nodes) { try { n.disconnect(); } catch (e) {} }
    }, 2600);
  }

  _applyDuck() {   // the ambient bed yields to the loudest active layer
    if (!this._ambientOn) return;
    const duck = Math.max(this.combatL.level, this.titleL.level);
    const b = this.master.bus.gain, now = this.ctx.currentTime;
    b.cancelScheduledValues(now);
    b.setValueAtTime(b.value, now);
    b.linearRampToValueAtTime(1 - 0.75 * duck, now + 1.4);
  }

  // combat (Red Alert): v=0 silent .. v=1 full, driven by threat distance
  armCombat() { this._armLayer(this.combatL); }
  setCombatLevel(v) {
    if (!(v > 0) && !this.combatL.gain) return;
    this._setLayer(this.combatL, v);
  }
  stopCombat() { this._stopLayer(this.combatL); }

  // title (Starblazer Theme): plays while the start screen is up. Pre-gesture
  // there is no AudioContext yet — start() honors the flag on first kickoff.
  setTitleActive(on) {
    this.titleActive = on;
    if (!this.ctx) return;
    if (on) this._setLayer(this.titleL, 1);
    else this._stopLayer(this.titleL);
  }

  toggle() {
    if (!this.ctx) { this.start(); return true; }
    if (this.enabled) { this.ctx.suspend(); this.enabled = false; }
    else { this.ctx.resume(); this.enabled = true; }
    return this.enabled;
  }
}

// offline verification: render a few seconds of a track and report RMS
export async function renderTest(seconds = 6, trackIdx = 0) {
  const ctx = new OfflineAudioContext(2, 44100 * seconds, 44100);
  const master = buildMaster(ctx, ctx.destination);
  scheduleTrack(ctx, master.bus, TRACKS[trackIdx], 0.05);
  const buf = await ctx.startRendering();
  const d = buf.getChannelData(0);
  let sum = 0, peak = 0;
  for (let i = 0; i < d.length; i++) { sum += d[i] * d[i]; peak = Math.max(peak, Math.abs(d[i])); }
  return { rms: Math.sqrt(sum / d.length), peak, finite: isFinite(sum) };
}
