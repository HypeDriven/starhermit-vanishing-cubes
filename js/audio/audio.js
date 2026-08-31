// Original procedural audio: short transients tied to logical events, a quiet
// generative music pad, and soft wind ambience. Independent buses for music,
// effects, ambience, and voice (voice is declared but unused by this title).
// Randomized pitch variants draw from a seeded stream for replay consistency.

import { Rng } from '../rules/rng.js';

// Logical event -> recorded sample in sfx/ (see sfx/manifest.md). Samples are
// lazy-fetched, decoded, and cached after the user-gesture unlock; while a
// sample is loading (or fails) the event falls back to the procedural synth
// sounds below.
const SFX_FILES = {
  ui: 'ui-click',
  tap: 'ui-click',
  hover: 'ui-hover',
  confirm: 'ui-confirm',
  back: 'ui-back',
  error: 'ui-error',
  achievement: 'ui-success',
  'modal-open': 'ui-modal-open',
  'panel-close': 'ui-panel-close',
  toast: 'ui-toast',
  toggle: 'ui-toggle',
  slider: 'ui-slider-drag',
  scroll: 'ui-scroll-tick',
  'menu-open': 'ui-menu-open',
  'settings-saved': 'ui-settings-saved',
  'tab-switch': 'ui-tab-switch',
  pause: 'ui-pause',
  resume: 'ui-resume',
  release: 'block-release',
  invalid: 'block-blocked',
  rotate: 'cube-rotate',
  unlock: 'cube-unlock',
  complete: 'core-exposed',
  failed: 'level-fail',
  countdown: 'countdown-tick',
  'round-start': 'round-start',
  'timer-warning': 'timer-warning',
  'move-limit': 'move-limit-warning',
  undo: 'undo-move',
  hint: 'hint-highlight',
  'star-1': 'star-rating-1',
  'star-2': 'star-rating-2',
  'star-3': 'star-rating-3',
  'level-win': 'level-win',
  'chapter-complete': 'chapter-complete',
  'new-record': 'new-record',
  'tutorial-done': 'tutorial-step-done',
};

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buses = {};
    this.settings = null;
    this.avRng = new Rng('av:audio');
    this.musicTimer = null;
    this.ambienceNodes = null;
    this.onCaption = null; // (text) => void, set by UI when captions enabled
    this._lastCaption = new Map();
    this.sampleCache = new Map(); // file -> { buffer, failed, promise }
  }

  ensure() {
    if (this.ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      const mk = (name, gain) => {
        const g = this.ctx.createGain();
        g.gain.value = gain;
        g.connect(this.master);
        this.buses[name] = g;
      };
      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.ctx.destination);
      mk('music', 0.5);
      mk('effects', 0.8);
      mk('ambience', 0.4);
      mk('voice', 0.8);
      this.applySettings();
      return true;
    } catch {
      return false;
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  applySettings(settings = this.settings) {
    if (!settings) return;
    this.settings = settings;
    if (!this.ctx) return;
    const a = settings.audio;
    const mute = a.muted ? 0 : 1;
    this.buses.music.gain.value = a.music * 0.5 * mute;
    this.buses.effects.gain.value = a.effects * 0.9 * mute;
    this.buses.ambience.gain.value = a.ambience * 0.45 * mute;
    this.buses.voice.gain.value = a.voice * 0.9 * mute;
  }

  caption(key, text) {
    if (!this.onCaption) return;
    const now = performance.now();
    if (now - (this._lastCaption.get(key) || 0) < 900) return;
    this._lastCaption.set(key, now);
    this.onCaption(text);
  }

  // ---------- synth primitives ----------

  blip({ freq = 440, freqEnd = null, dur = 0.12, type = 'sine', gain = 0.5, attack = 0.004, bus = 'effects' }) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.buses[bus]);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  noiseBurst({ dur = 0.2, gain = 0.3, freq = 1200, q = 1, bus = 'effects', sweepTo = null }) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(freq, t);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.buses[bus]);
    src.start(t);
  }

  // ---------- recorded samples (sfx/*.opus) ----------

  // Lazy loader: once the gesture-unlocked AudioContext exists, each sample
  // is fetched, decoded, and cached on first use. The pending entry is shared
  // so repeated events never trigger duplicate fetches.
  loadSample(file) {
    if (!this.ctx) return null;
    let entry = this.sampleCache.get(file);
    if (!entry) {
      entry = { buffer: null, failed: false, promise: null };
      entry.promise = fetch('sfx/' + file + '.opus')
        .then((res) => {
          if (!res.ok) throw new Error('http ' + res.status);
          return res.arrayBuffer();
        })
        .then((data) => this.ctx.decodeAudioData(data))
        .then((buffer) => { entry.buffer = buffer; })
        .catch(() => { entry.failed = true; });
      this.sampleCache.set(file, entry);
    }
    return entry;
  }

  // One-shot sample playback through the effects bus, so current volume/mute
  // settings apply. Returns true only when the sample actually starts; callers
  // run the procedural fallback while the sample is loading or after failure.
  sfx(file) {
    if (!this.settings || this.settings.audio.muted) return false;
    if (!this.ctx || this.ctx.state !== 'running') return false;
    const entry = this.loadSample(file);
    if (!entry || !entry.buffer) return false;
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = entry.buffer;
      src.connect(this.buses.effects);
      src.start();
      return true;
    } catch { /* context torn down */ }
    return false;
  }

  // ---------- logical event sounds ----------

  play(name) {
    if (!this.settings || this.settings.audio.muted) return;
    const file = SFX_FILES[name] || null;
    // Prefer the mapped sample; synth runs only while it loads or on failure.
    const sampled = file ? this.sfx(file) : false;
    const v = 1 + (this.avRng.next() - 0.5) * 0.12; // seeded pitch variant
    switch (name) {
      case 'ui':
        if (!sampled) this.blip({ freq: 620 * v, dur: 0.05, type: 'triangle', gain: 0.18 });
        break;
      case 'tap':
        if (!sampled) this.blip({ freq: 340 * v, dur: 0.06, type: 'triangle', gain: 0.25 });
        this.caption('tap', 'tap');
        break;
      case 'release':
        if (!sampled) {
          this.noiseBurst({ dur: 0.28, gain: 0.22, freq: 900 * v, sweepTo: 2400 * v, q: 2 });
          this.blip({ freq: 520 * v, freqEnd: 780 * v, dur: 0.16, type: 'sine', gain: 0.22 });
        }
        this.caption('release', 'cube released');
        break;
      case 'invalid':
        if (!sampled) this.blip({ freq: 140, freqEnd: 90, dur: 0.14, type: 'square', gain: 0.16 });
        this.caption('invalid', 'not allowed');
        break;
      case 'rotate':
        if (!sampled) this.noiseBurst({ dur: 0.12, gain: 0.1, freq: 500 * v, q: 3 });
        break;
      case 'tab-switch':
        if (!sampled) this.blip({ freq: 700 * v, dur: 0.04, type: 'triangle', gain: 0.15 });
        break;
      case 'unlock':
        if (!sampled) {
          this.blip({ freq: 660, dur: 0.07, type: 'triangle', gain: 0.2 });
          setTimeout(() => this.blip({ freq: 990, dur: 0.1, type: 'triangle', gain: 0.2 }), 70);
        }
        this.caption('unlock', 'lock opened');
        break;
      case 'complete':
        if (!sampled) {
          [523, 659, 784, 1047].forEach((f, i) =>
            setTimeout(() => this.blip({ freq: f, dur: 0.35, type: 'sine', gain: 0.22 }), i * 90));
        }
        this.caption('complete', 'board cleared');
        break;
      case 'failed':
        if (!sampled) {
          [392, 330, 262].forEach((f, i) =>
            setTimeout(() => this.blip({ freq: f, dur: 0.3, type: 'sine', gain: 0.18 }), i * 120));
        }
        this.caption('failed', 'round over');
        break;
      case 'achievement':
        if (!sampled) {
          this.blip({ freq: 880, dur: 0.12, type: 'triangle', gain: 0.2 });
          setTimeout(() => this.blip({ freq: 1175, dur: 0.18, type: 'triangle', gain: 0.2 }), 110);
        }
        this.caption('achievement', 'achievement unlocked');
        break;
      case 'countdown':
        if (!sampled) this.blip({ freq: 440 * v, dur: 0.08, type: 'triangle', gain: 0.2 });
        break;
      case 'round-start':
        this.caption('round-start', 'round started');
        break;
      case 'undo':
        this.caption('undo', 'move undone');
        break;
      case 'hint':
        this.caption('hint', 'hint shown');
        break;
      case 'timer-warning':
        this.caption('timer-warning', 'time nearly up');
        break;
      case 'move-limit':
        this.caption('move-limit', 'few moves left');
        break;
      case 'level-win':
        this.caption('level-win', 'level completed');
        break;
      case 'chapter-complete':
        this.caption('chapter-complete', 'chapter cleared');
        break;
      case 'new-record':
        this.caption('new-record', 'new personal best');
        break;
    }
  }

  // ---------- generative music ----------

  startMusic(seed = 'music') {
    if (!this.ensure() || this.musicTimer) return;
    const rng = new Rng('music:' + seed);
    // Slow, quiet pentatonic pad — adaptive: intensity follows released count.
    const scale = [261.6, 293.7, 329.6, 392.0, 440.0, 523.3];
    this.musicIntensity = 0.3;
    const tick = () => {
      if (!this.ctx || this.ctx.state !== 'running') return;
      const n = 1 + (rng.next() < 0.3 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const f = scale[rng.int(scale.length)] * (rng.next() < 0.25 ? 2 : 1);
        const dur = 2.5 + rng.next() * 2.5;
        this.pad(f, dur, 0.05 + this.musicIntensity * 0.08);
      }
    };
    tick();
    this.musicTimer = setInterval(tick, 2600);
  }

  pad(freq, dur, gain) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const detune of [-4, 3]) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + dur * 0.4);
      g.gain.linearRampToValueAtTime(0, t + dur);
      osc.connect(g).connect(this.buses.music);
      osc.start(t);
      osc.stop(t + dur + 0.1);
    }
  }

  setMusicIntensity(x) {
    this.musicIntensity = Math.max(0, Math.min(1, x));
  }

  stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  // ---------- ambience ----------

  startAmbience() {
    if (!this.ensure() || this.ambienceNodes) return;
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      // brown-ish noise for wind
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 160;
    lfo.connect(lfoGain).connect(filter.frequency);
    src.connect(filter).connect(this.buses.ambience);
    src.start();
    lfo.start();
    this.ambienceNodes = { src, lfo };
  }

  stopAmbience() {
    if (!this.ambienceNodes) return;
    try {
      this.ambienceNodes.src.stop();
      this.ambienceNodes.lfo.stop();
    } catch { /* already stopped */ }
    this.ambienceNodes = null;
  }
}

export const audio = new AudioEngine();
