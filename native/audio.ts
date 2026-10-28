// Sound, as the browser build's js/audio/audio.js: the recorded one-shots
// (sfx/*.opus, sfx/manifest.md) per logical event with the seeded ±6 % pitch
// variant, sound captions (when Captions is on), the quiet generative pad
// (pentatonic sines, a detuned pair a note, one or two notes every 2.6 s,
// louder as more cubes are released) and the wind ambience (brown noise
// through a 420 Hz low-pass breathing ±160 Hz at 0.07 Hz). The browser build
// ran the pad and wind as live oscillators; here the wind is rendered once
// into a seamless loop and each pad note into a clip, a slice a frame (the
// native interpreter is slow), all on the music bus (the runtime has no
// ambience bus) at the old buses' default balance. The synthesized stand-ins
// the old engine played while a sample decoded are not ported. The runtime's
// Options own volumes, mute and the voice limit. Clips load once the mixer
// runs, one at a time.
import { context, createClip, loadClip, play as playClip, type AudioClip, type Sound } from "starhermit:audio";
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
const queue: string[] = [...new Set(Object.values(SFX))];
let loading = false;
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
const SINE_N = 4096;
const SINE = new Float32Array(SINE_N + 1);
for (let i = 0; i <= SINE_N; i++) SINE[i] = Math.sin((2 * Math.PI * i) / SINE_N);
const sin1 = (p: number): number => { const q = (p - Math.floor(p)) * SINE_N, i = q | 0, f = q - i; return SINE[i]! + (SINE[i + 1]! - SINE[i]!) * f; };
const MUSIC = 0.55 * 0.5, AMB = 0.45 * 0.45;
const BED_N = Math.round(RATE / 0.07);
const bed = new Float32Array(BED_N);
let bedPos = 0, brown = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
let nState = 0x51f15e;
function white(): number {
  nState = (nState + 0x6d2b79f5) | 0;
  let t = Math.imul(nState ^ (nState >>> 15), 1 | nState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
}
function renderBed(count: number): boolean {
  const end = Math.min(BED_N, bedPos + count);
  for (; bedPos < end; bedPos++) {
    brown = (brown + 0.02 * white()) / 1.02;
    const x = brown * 3.5;
    const fc = 420 + 160 * Math.sin((2 * Math.PI * 0.07 * bedPos) / RATE);
    const w = (2 * Math.PI * fc) / RATE, al = Math.sin(w) / (2 * Math.SQRT1_2), c = Math.cos(w), a0 = 1 + al;
    const y = ((1 - c) / 2 / a0) * x + ((1 - c) / a0) * x1 + ((1 - c) / 2 / a0) * x2 - ((-2 * c) / a0) * y1 - ((1 - al) / a0) * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    bed[bedPos] = y * AMB;
  }
  return bedPos >= BED_N;
}
// audio.js pad(freq, dur, gain): two sines detuned −4 and +3 cents, a linear rise over 40 % then fall; rendered at 4 s
// and peak 1 (the gain is the play's).
const SCALE = [261.6, 293.7, 329.6, 392.0, 440.0, 523.3];
const PAD_S = 4;
function renderPad(f: number, from: number, to: number, out: Float32Array): void {
  const a = f * Math.pow(2, -4 / 1200), b = f * Math.pow(2, 3 / 1200);
  for (let i = from; i < to; i++) {
    const t = i / RATE, k = t / PAD_S;
    const env = k < 0.4 ? k / 0.4 : Math.max(0, (1 - k) / 0.6);
    out[i] = (sin1(a * t) + sin1(b * t)) * 0.5 * env * MUSIC;
  }
}
const pads: AudioClip[] = [];
let padBuf: Float32Array | null = null, padPos = 0;
let bedClip: AudioClip | null = null;
let bedVoice: Sound | null = null;
let nextIn = 0;
const musicRng = new RngClass("music:music");

/** Each frame: clips one at a time once the mixer runs, then the bed and the pads. */
export function update(dt: number): void {
  clock += dt;
  if (context.state !== "running") return;
  if (!loading && queue.length) {
    const name = queue.shift()!;
    loading = true;
    loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); loading = false; }, (e: unknown) => {
      console.warn(`sfx ${name}: ${e instanceof Error ? e.message : String(e)}`);
      loading = false;
    });
    return;
  }
  if (loading) return;
  if (!bedClip) {
    if (!renderBed(6000)) return;
    try { bedClip = createClip([bed], RATE); } catch (e) { console.warn(`audio: ${String(e)}`); bedPos = 0; }
    return;
  }
  if (pads.length < SCALE.length * 2) {
    const n = Math.round(RATE * PAD_S);
    if (!padBuf) { padBuf = new Float32Array(n); padPos = 0; }
    const i = pads.length;
    const end = Math.min(n, padPos + 6000);
    renderPad(SCALE[i % SCALE.length]! * (i >= SCALE.length ? 2 : 1), padPos, end, padBuf);
    padPos = end;
    if (padPos >= n) {
      try { pads.push(createClip([padBuf], RATE)); } catch (e) { console.warn(`audio: ${String(e)}`); pads.push(null as unknown as AudioClip); }
      padBuf = null;
    }
    return;
  }
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
