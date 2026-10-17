// Every string key used in markup (data-i18n*) and code (t('…')) exists in all
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
import { DEFAULT_BINDINGS } from '../js/ui/bindings.js';

const LOCALES = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT'];
const root = new URL('../', import.meta.url);
function walk(dir) {
  return readdirSync(new URL(dir, root)).flatMap((f) => {
    const rel = dir + f;
    return statSync(new URL(rel, root)).isDirectory() ? walk(rel + '/') : rel.endsWith('.js') && !rel.endsWith('strings.js') ? [rel] : [];
  });
}
const code = walk('js/').map((f) => readFileSync(new URL(f, root), 'utf8')).join('\n');
const html = readFileSync(new URL('index.html', root), 'utf8');
const en = STRINGS['en-US'];
const gfxKeys = new Set(GFX_STRING_KEYS);
const used = new Set();
for (const m of code.matchAll(/\bt\('([A-Za-z0-9_]*[A-Za-z0-9])'(?!\s*\+)/g)) if (!gfxKeys.has(m[1])) used.add(m[1]);
for (const m of html.matchAll(/data-i18n(?:-aria|-title)?="([A-Za-z0-9_]+)"/g)) used.add(m[1]);
// Keys built at run time: prefix + id.
for (const b of DEFAULT_BINDINGS) { used.add('bind_' + b.action); used.add('pad_' + b.action); }
for (const k of ['arrow', 'stone', 'core']) used.add('describe_' + k);
for (const d of ['easy', 'medium', 'hard']) { used.add('diff_' + d); used.add('diffBlurb_' + d); }
for (const m of ['learn', 'journey', 'daily', 'practice', 'challenge']) { used.add('setupH_' + m); used.add('modeName_' + m); }
for (let i = 0; i < 6; i++) used.add('dir_' + i);
for (const m of code.matchAll(/this\.caption\('([a-z-]+)'/g)) used.add('cap_' + m[1].replace(/-/g, '_'));
for (const m of code.matchAll(/'(head[A-Z]\w*|net[A-Z]\w*|lb[A-Z]\w*|nextStage|nextLesson|playAgain|modes)'/g)) if (!/^lb/.test(m[1])) used.add(m[1]);
const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('ships the nine locales', () => assert.deepEqual(Object.keys(STRINGS).sort(), [...LOCALES].sort()));
test('every locale has exactly the US English keys', () => {
  for (const loc of LOCALES) assert.deepEqual(Object.keys(STRINGS[loc]).sort(), Object.keys(en).sort(), loc);
});
test('found the keys in markup and code', () => assert.ok(used.size > 250, String(used.size)));
for (const loc of LOCALES) {
  test(`${loc}: every used key, matching placeholders`, () => {
    const L = STRINGS[loc];
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
  for (const b of DEFAULT_BINDINGS) assert.deepEqual([en['bind_' + b.action], en['pad_' + b.action]], [b.label, b.gamepad]);
});
test('non-English locales are translated', () => {
  for (const loc of LOCALES.filter((l) => !l.startsWith('en'))) {
    const same = [...used].filter((k) => STRINGS[loc][k] === en[k]);
    assert.ok(same.length < 15, `${loc}: ${same.join(', ')}`);
  }
});
