// The engine client's save document and the browser build's data carrying over (js/migrate.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyDoc, normalizeDoc, mergeDocs, fromForeign, pickLegacy } from '../js/migrate.js';

const oldCloud = {
  savedAt: 1,
  docs: {
    settings: { rev: 3, payload: { audio: { music: 0.2, captions: true }, graphics: { preset: 'high' }, accessibility: { palette: 'cvd-safe', leftHanded: true, highContrast: true } } },
    progression: { rev: 5, payload: { journeyStars: { j01: 3, j02: 1 }, tutorials: { t1: true }, totals: { released: 40, rounds: 4 }, dailies: { '2026-10-01': { score: 900, completed: true, at: 1 } }, theme: 'verdant' } },
    profile: { rev: 1, payload: { name: 'Mira', guest: true } },
    achievements: { rev: 1, payload: { 'first-clear': 100 } },
    boards: { rev: 2, payload: { entries: { 'level-j01': [{ board: 'level-j01', name: 'Mira', score: 1900, sessionId: 's1', invalid: 0, elapsedMs: 3000 }] } } },
  },
};

test('the browser build\'s cloud slot becomes an engine document', () => {
  const d = fromForeign(oldCloud);
  assert.equal(d.v, 1);
  assert.deepEqual(d.settings, { captions: true, palette: 'cvd-safe', leftHanded: true, dragToggle: false, timingAssist: false });
  assert.equal(d.progression.journeyStars.j01, 3);
  assert.equal(d.progression.theme, 'verdant');
  assert.equal(d.profile.name, 'Mira');
  assert.equal(d.achievements['first-clear'], 100);
  assert.equal(d.boards.entries['level-j01'][0].score, 1900);
  assert.equal(fromForeign(null), null);
  assert.equal(fromForeign({ docs: {} }), null);
});

test('merging keeps progress from both devices', () => {
  const a = fromForeign(oldCloud);
  const b = emptyDoc();
  b.progression.journeyStars = { j01: 1, j03: 2 };
  b.progression.totals = { released: 10, rounds: 9 };
  b.achievements = { 'first-clear': 50, 'grand-work': 70 };
  b.snapshot = '{"x":1}';
  const m = mergeDocs(a, b);
  assert.deepEqual(m.progression.journeyStars, { j01: 3, j02: 1, j03: 2 });
  assert.deepEqual(m.progression.totals, { released: 40, rounds: 9 });
  assert.deepEqual(m.achievements, { 'first-clear': 50, 'grand-work': 70 });
  assert.equal(m.profile.name, 'Mira');
  assert.equal(m.snapshot, '{"x":1}');
  assert.equal(m.boards.entries['level-j01'].length, 1);
});

test('malformed documents are filled with defaults', () => {
  const d = normalizeDoc({ settings: { palette: 'neon', captions: 'yes' }, progression: { journeyStars: 5 }, boards: 3 });
  assert.deepEqual(d.settings, emptyDoc().settings);
  assert.deepEqual(d.progression.journeyStars, {});
  assert.deepEqual(d.boards, { entries: {} });
});

test('legacy settings KV: only the game\'s own options carry over', () => {
  assert.deepEqual(pickLegacy({ accessibility: { timingAssist: true, dragToggle: 'x', reducedMotion: true }, audio: { captions: false }, graphics: { preset: 'low' } }),
    { timingAssist: true, captions: false });
  assert.deepEqual(pickLegacy(null), {});
});
