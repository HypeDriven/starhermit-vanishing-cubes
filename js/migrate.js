// The engine client's save document and how the browser build's data carries
// over (pure; native/platform.ts calls it, tests/save.test.mjs covers it).
// The browser build kept five checksummed localStorage documents (settings,
// progression, profile, achievements, boards) and mirrored them to the cloud
// slot as { savedAt, docs: { <name>: { payload, rev } } }; it also mirrored
// audio / graphics / accessibility / telemetryConsent into the account's
// settings KV. On the engine the save is one document:
//   { v: 1, settings, progression, profile, achievements, boards, snapshot }
// Volumes, mute, graphics, reduced motion, high contrast, larger text,
// haptics, key bindings and the language are the runtime's Options now; the
// game keeps its own options (captions, colour palette, left-handed layout,
// grab toggle, timing assistance). Telemetry had no route and is gone.
import { mergeProgression, mergeAchievements, mergeBoards } from './session/merge.js';

export const DEFAULT_SETTINGS = { captions: false, palette: 'default', leftHanded: false, dragToggle: false, timingAssist: false };
export const DEFAULT_PROGRESSION = {
  journeyStars: {}, tutorials: {}, totals: { released: 0, rounds: 0 }, dailies: {}, challengeBest: {}, practiceBest: {},
  levelBest: {}, theme: 'dawn', lastSessionId: null,
};
const PALETTES = ['default', 'cvd-safe', 'mono-safe'];
const clone = (v) => JSON.parse(JSON.stringify(v));
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

export function emptyDoc() {
  return { v: 1, settings: clone(DEFAULT_SETTINGS), progression: clone(DEFAULT_PROGRESSION), profile: { name: 'Guest' }, achievements: {}, boards: { entries: {} }, snapshot: null };
}

/** The game's own options from an old accessibility / audio object (typed, known values only). */
export function pickOptions(accessibility, audio) {
  const a = obj(accessibility), out = {};
  for (const k of ['leftHanded', 'dragToggle', 'timingAssist']) if (typeof a[k] === 'boolean') out[k] = a[k];
  if (typeof a.palette === 'string' && PALETTES.includes(a.palette)) out.palette = a.palette;
  if (typeof obj(audio).captions === 'boolean') out.captions = audio.captions;
  return out;
}

/** A document filled out with defaults (any missing or malformed part replaced). */
export function normalizeDoc(d) {
  const src = obj(d), e = emptyDoc();
  const p = obj(src.progression);
  const prog = { ...e.progression, ...p, totals: { ...e.progression.totals, ...obj(p.totals) } };
  for (const k of ['journeyStars', 'tutorials', 'dailies', 'challengeBest', 'practiceBest', 'levelBest']) prog[k] = obj(p[k]);
  return {
    v: 1,
    settings: { ...e.settings, ...pickOptions(src.settings, src.settings) },
    progression: prog,
    profile: { name: typeof obj(src.profile).name === 'string' ? src.profile.name : 'Guest' },
    achievements: obj(src.achievements),
    boards: { entries: obj(obj(src.boards).entries) },
    snapshot: typeof src.snapshot === 'string' ? src.snapshot : null,
  };
}

/** Two devices' documents: progress from both kept; options, profile and the resumable round are local's. */
export function mergeDocs(remote, local) {
  const r = normalizeDoc(remote), l = normalizeDoc(local);
  return {
    v: 1,
    settings: l.settings,
    progression: mergeProgression(r.progression, l.progression),
    profile: l.profile.name !== 'Guest' ? l.profile : r.profile,
    achievements: mergeAchievements(r.achievements, l.achievements),
    boards: mergeBoards(r.boards, l.boards),
    snapshot: l.snapshot,
  };
}

/** The browser build's cloud slot ({ savedAt, docs }) as an engine document, or null. */
export function fromForeign(old) {
  const docs = obj(obj(old).docs);
  if (!Object.keys(docs).length) return null;
  const pay = (n) => obj(obj(docs[n]).payload);
  const s = pay('settings');
  return normalizeDoc({
    settings: { ...DEFAULT_SETTINGS, ...pickOptions(s.accessibility, s.audio) },
    progression: pay('progression'), profile: pay('profile'), achievements: pay('achievements'), boards: pay('boards'),
  });
}

/** Settings KV values (key → value) the browser build mirrored: the game's own options among them. */
export function pickLegacy(kv) {
  return pickOptions(obj(kv).accessibility, obj(kv).audio);
}
