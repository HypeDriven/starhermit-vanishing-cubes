// Sound, as the browser build's js/audio/audio.js: the recorded one-shots
// (sfx/*.opus, sfx/manifest.md) per logical event with the seeded ±6 % pitch
// variant, sound captions (when Captions is on), the quiet generative pad
// (pentatonic sines, a detuned pair a note, one or two notes every 2.6 s,
// louder as more cubes are released) and the wind ambience (brown noise
// through a 420 Hz low-pass breathing ±160 Hz at 0.07 Hz). The browser build
// ran the pad and wind as live oscillators; here the wind (brown noise and an
// LFO on the filter, natively) is rendered offline once into a seamless loop
// and the pad notes end to end in one offline render, sliced into clips, all
// on the music bus (the runtime has no ambience bus) at the old buses' default
// balance. The synthesized stand-ins the old engine played while a sample
// decoded are not ported. The runtime's Options own volumes, mute and the
// voice limit. Clips load at start; a cue whose clip is still loading is silent.
import { OfflineAudioContext, context, createClip, loadClip, play as playClip, type AudioClip, type Sound } from "starhermit:audio";
import { RngClass } from "./game.ts";

const SFX: Record<string, string> = {
  ui: "ui-click", tap: "ui-click", hover: "ui-hover", confirm: "ui-confirm", back: "ui-back", error: "ui-error", achievement: "ui-success",
  "modal-open": "ui-modal-open", "panel-close": "ui-panel-close", toast: "ui-toast", toggle: "ui-toggle", "menu-open": "ui-menu-open",
  "settings-saved": "ui-settings-saved", pause: "ui-pause", resume: "ui-resume", release: "block-release", invalid: "block-blocked",
  rotate: "cube-rotate", unlock: "cube-unlock", complete: "core-exposed", failed: "level-fail", countdown: "countdown-tick",
  "round-start": "round-start", "timer-warning": "timer-warning", "move-limit": "move-limit-warning", undo: "undo-move", hint: "hint-highlight",
  "star-1": "star-rating-1", "star-2": "star-rating-2", "star-3": "star-rating-3", "level-win": "level-win", "chapter-complete": "chapter-complete",
  "new-record": "new-record", "tutorial-done": "tutorial-step-done",
};
const UI_SOUNDS = new Set(["ui", "hover", "confirm", "back", "error", "modal-open", "panel-close", "toast", "toggle", "menu-open", "settings-saved", "pause", "resume"]);
// audio.js caption(key, text): the cue keys that showed a caption
const CAPTIONED = new Set(["tap", "release", "invalid", "unlock", "complete", "failed", "achievement", "round-start", "undo", "hint", "timer-warning",
  "move-limit", "level-win", "chapter-complete", "new-record"]);
const clips = new Map<string, AudioClip>();
let suspended = false;
const lastCaption = new Map<string, number>();
let captionFn: ((key: string) => void) | null = null;
let captionsOn = false;
const avRng = new RngClass("av:audio");
let clock = 0;
export function onCaption(fn: (key: string) => void): void { captionFn = fn; }
export function setCaptions(on: boolean): void { captionsOn = on; }

/** audio.js play(name). */
export function play(name: string): void {
  const v = 1 + (avRng.next() - 0.5) * 0.12;
  const file = SFX[name];
  const clip = file ? clips.get(file) : undefined;
  if (clip && !suspended && context.state === "running") {
    try { playClip(clip, { bus: UI_SOUNDS.has(name) ? "interface" : "effects", pitch: v }); } catch { /* busy */ }
  }
  if (captionsOn && captionFn && CAPTIONED.has(name)) {
    if (clock - (lastCaption.get(name) ?? -9) < 0.9) return;
    lastCaption.set(name, clock);
    captionFn(name);
  }
}
let intensity = 0.3;
export function setIntensity(x: number): void { intensity = Math.max(0, Math.min(1, x)); }
export function setSuspended(on: boolean): void {
  if (on === suspended) return;
  suspended = on;
  try { bedVoice?.fade(on ? 0 : 1, 0.2); } catch { /* gone */ }
}

// -- synthesis into clips ------------------------------------------------------------------
const RATE = 22050;
const MUSIC = 0.55 * 0.5, AMB = 0.45 * 0.45;
const BED_S = 315000 / RATE; // one LFO period (0.07 Hz), so the settled render loops
async function renderBed(): Promise<AudioClip> {
  const settle = Math.round(RATE), n = Math.round(BED_S * RATE);
  const off = new OfflineAudioContext(1, settle + n, RATE);
  const noise = off.createNoise({ color: "brown", seed: 0x51f15e, seconds: BED_S });
  const lp = off.createBiquadFilter();
  lp.type = "lowpass"; lp.frequency.value = 420; lp.Q.value = -3.01; // the old RBJ Q of 0.707 (Web Audio's Q is in dB)
  const lfo = off.createOscillator(); lfo.frequency.value = 0.07;
  const depth = off.createGain(); depth.gain.value = 160;
  lfo.connect(depth); depth.connect(lp.frequency);
  const g = off.createGain(); g.gain.value = AMB; // rms .0381, the old script noise's .0384
  noise.connect(lp); lp.connect(g); g.connect(off.destination);
  noise.start(); lfo.start();
  const r = await off.startRendering();
  return createClip([r.getChannelData(0).slice(settle)], RATE); // filtered periodic noise is periodic once settled
}
// audio.js pad(freq, dur, gain): two sines detuned −4 and +3 cents, a linear rise over 40 % then fall; rendered at 4 s
// and peak 1 (the gain is the play's). Twelve notes end to end in one context (contexts count until collected).
const SCALE = [261.6, 293.7, 329.6, 392.0, 440.0, 523.3];
const PAD_S = 4, PADS = SCALE.length * 2;
async function renderPads(): Promise<AudioClip[]> {
  const n = Math.round(RATE * PAD_S);
  const off = new OfflineAudioContext(1, n * PADS, RATE);
  for (let i = 0; i < PADS; i++) {
    const f = SCALE[i % SCALE.length]! * (i >= SCALE.length ? 2 : 1), t0 = i * PAD_S;
    const g = off.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.5 * MUSIC, t0 + PAD_S * 0.4);
    g.gain.linearRampToValueAtTime(0, t0 + PAD_S);
    g.connect(off.destination);
    for (const cents of [-4, 3]) {
      const o = off.createOscillator();
      o.frequency.value = f * Math.pow(2, cents / 1200);
      o.connect(g);
      o.start(t0); o.stop(t0 + PAD_S);
    }
  }
  const r = (await off.startRendering()).getChannelData(0);
  return Array.from({ length: PADS }, (_, i) => createClip([r.slice(i * n, (i + 1) * n)], RATE));
}
let pads: AudioClip[] = [];
let bedClip: AudioClip | null = null;
let bedVoice: Sound | null = null;
let nextIn = 0;
const musicRng = new RngClass("music:music");

/** Loads every clip and renders the bed and the pads (from onStart). */
export function loadSfx(): void {
  for (const name of new Set(Object.values(SFX))) {
    loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); }, (e: unknown) => console.warn(`sfx ${name}: ${e instanceof Error ? e.message : String(e)}`));
  }
  renderBed().then((c) => { bedClip = c; }, (e: unknown) => console.warn(`audio: ${String(e)}`));
  renderPads().then((c) => { pads = c; }, (e: unknown) => console.warn(`audio: ${String(e)}`));
}

/** Each frame: the bed once the mixer runs, then the pads. */
export function update(dt: number): void {
  clock += dt;
  if (context.state !== "running" || !bedClip || !pads.length) return;
  if (!bedVoice) {
    try { bedVoice = playClip(bedClip, { bus: "music", gain: suspended ? 0 : 1, loop: true }); } catch { bedVoice = null; }
    return;
  }
  // audio.js startMusic: a tick every 2.6 s, one note (two 30 % of the time), an octave up 25 % of the time
  nextIn -= dt;
  if (nextIn > 0) return;
  nextIn = 2.6;
  if (suspended) return;
  const n = 1 + (musicRng.next() < 0.3 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const idx = musicRng.int(SCALE.length) + (musicRng.next() < 0.25 ? SCALE.length : 0);
    musicRng.next(); // the old duration draw (2.5–5 s); notes are rendered at 4 s
    const clip = pads[idx];
    if (clip) { try { playClip(clip, { bus: "music", gain: 0.05 + intensity * 0.08 }); } catch { /* busy */ } }
  }
}
