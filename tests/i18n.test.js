// Every string key the engine client uses (T("…") in native/*.ts) exists in all
// nine locales with the same {placeholders} as US English, every locale has
// exactly the US English keys, and every content name (levels, chapters,
// tips, lessons and their steps, challenges, themes, achievements) is
// translated.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { STRINGS } from '../js/ui/strings.js';
import { GFX_STRING_KEYS } from '../js/ui/gfx-strings.js';
import { LEVEL_DEFS, CHAPTERS } from '../js/content/levels.js';
import { LESSONS } from '../js/content/tutorials.js';
import { CHALLENGES } from '../js/content/challenges.js';
import { THEMES } from '../js/content/themes.js';
import { ACHIEVEMENTS } from '../js/content/achievements.js';
import { ENGINE_STRINGS } from '../js/ui/engine-strings.js';
import { PLATFORM_STRINGS } from '../js/ui/platform-strings.js';

const LOCALES = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT'];
const root = new URL('../', import.meta.url);
const code = readdirSync(new URL('native/', root)).filter((f) => f.endsWith('.ts')).map((f) => readFileSync(new URL('native/' + f, root), 'utf8')).join('\n');
const en = { ...STRINGS['en-US'], ...ENGINE_STRINGS['en-US'] };
const used = new Set();
for (const m of code.matchAll(/\bT\("([A-Za-z0-9_]*[A-Za-z0-9])"/g)) used.add(m[1]);
for (const m of code.matchAll(/"(net(?:Synced|Saving|Offline)|head[A-Z]\w*|nextStage|nextLesson|playAgain)"/g)) used.add(m[1]);
const ACTIONS = ['confirm', 'cancel', 'pause', 'navNext', 'navPrev', 'rotateLeft', 'rotateRight', 'undo', 'hint', 'camReset'];
for (const a of ACTIONS) used.add('bind_' + a);
for (const k of ['arrow', 'stone', 'core']) used.add('describe_' + k);
for (const d of ['easy', 'medium', 'hard']) { used.add('diff_' + d); used.add('diffBlurb_' + d); }
for (const m of ['learn', 'journey', 'daily', 'practice', 'challenge']) { used.add('setupH_' + m); used.add('modeName_' + m); }
for (let i = 0; i < 6; i++) used.add('dir_' + i);
for (const m of readFileSync(new URL('native/audio.ts', root), 'utf8').match(/CAPTIONED = new Set\(\[([^\]]*)\]/)[1].matchAll(/"([a-z-]+)"/g)) used.add('cap_' + m[1].replace(/-/g, '_'));
const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('ships the nine locales', () => assert.deepEqual(Object.keys(STRINGS).sort(), [...LOCALES].sort()));
test('every locale has exactly the US English keys', () => {
  for (const loc of LOCALES) assert.deepEqual(Object.keys(STRINGS[loc]).sort(), Object.keys(STRINGS['en-US']).sort(), loc);
});
test('found the keys in the code', () => assert.ok(used.size > 200, String(used.size)));
test('engine strings: every locale has the US English keys', () => {
  for (const loc of LOCALES) assert.deepEqual(Object.keys(ENGINE_STRINGS[loc]).sort(), Object.keys(ENGINE_STRINGS['en-US']).sort(), loc);
});
test('platform strings ship every locale', () => { for (const loc of LOCALES) assert.ok(PLATFORM_STRINGS[loc]?.signIn, loc); });
for (const loc of LOCALES) {
  test(`${loc}: every used key, matching placeholders`, () => {
    const L = { ...STRINGS[loc], ...ENGINE_STRINGS[loc] };
    assert.deepEqual([...used].filter((k) => typeof L[k] !== 'string'), []);
    for (const k of Object.keys(en)) if (typeof en[k] === 'string') assert.equal(vars(L[k]), vars(en[k]), `${loc}.${k}`);
  });
  test(`${loc}: every content name`, () => {
    const L = STRINGS[loc];
    for (const d of LEVEL_DEFS) {
      assert.ok(L.levels[d.id], `level ${d.id}`);
      if (d.tip) assert.ok(L.tips[d.id], `tip ${d.id}`);
    }
    for (const c of CHAPTERS) assert.ok(L.chapters[c.id] && L.chapterBlurbs[c.id], `chapter ${c.id}`);
    for (const l of LESSONS) {
      assert.ok(L.lessons[l.id] && L.lessonGoals[l.id], `lesson ${l.id}`);
      l.steps.forEach((_, i) => assert.ok(L.lessonSteps[l.id + '.' + i], `step ${l.id}.${i}`));
    }
    for (const c of CHALLENGES) assert.ok(L.challenges[c.id] && L.challengeBlurbs[c.id], `challenge ${c.id}`);
    for (const th of THEMES) assert.ok(L.themes[th.id], `theme ${th.id}`);
    for (const a of ACHIEVEMENTS) assert.equal(L.achievements[a.key]?.length, 2, `achievement ${a.key}`);
  });
}
test('English content strings match the authored data', () => {
  for (const d of LEVEL_DEFS) assert.equal(en.levels[d.id], d.name);
  for (const l of LESSONS) {
    assert.deepEqual([en.lessons[l.id], en.lessonGoals[l.id]], [l.name, l.goal]);
    l.steps.forEach((st, i) => assert.equal(en.lessonSteps[l.id + '.' + i], st.text));
  }
  for (const c of CHALLENGES) assert.deepEqual([en.challenges[c.id], en.challengeBlurbs[c.id]], [c.name, c.blurb]);
  for (const a of ACHIEVEMENTS) assert.deepEqual(en.achievements[a.key], [a.name, a.desc]);
});
test('non-English locales are translated', () => {
  for (const loc of LOCALES.filter((l) => !l.startsWith('en'))) {
    const same = [...used].filter((k) => ({ ...STRINGS[loc], ...ENGINE_STRINGS[loc] })[k] === en[k]);
    assert.ok(same.length < 15, `${loc}: ${same.join(', ')}`);
  }
});
