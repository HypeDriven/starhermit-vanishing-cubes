/**
 * Vanishing Cubes localization runtime.
 *
 * The language comes from sh-language.js (window.StarHermitLanguage, loaded
 * as a classic script before the modules): explicit game choice (ui.language)
 * → StarHermit account preferredLanguage → navigator.languages → en-US.
 * `?lang=` forces a locale for the page load (QA links) and hides the shared
 * selector. A change re-applies the static markup (data-i18n,
 * data-i18n-aria, data-i18n-title) and notifies onLanguage listeners so
 * dynamic text re-renders without restarting the round.
 */

import { STRINGS } from './strings.js';

export const SUPPORTED = Object.keys(STRINGS);
let lang = 'en-US';
let dict = STRINGS[lang];
const listeners = new Set();

export function locale() {
  return lang;
}

const fill = (s, vars) => (vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)) : s);

/** Localized string for a flat key with {placeholders} filled from vars. */
export function t(key, vars) {
  return fill(dict?.[key] ?? STRINGS['en-US'][key] ?? key, vars);
}

/** Localized content text from a nested group (symbols, chapters, themes, …). */
export function tn(group, id, fallback) {
  const own = dict?.[group]?.[id];
  if (own != null) return own;
  const en = STRINGS['en-US'][group]?.[id];
  return en != null ? en : fallback;
}

/** True when the string table has a flat key (used for optional cue keys). */
export function hasKey(key) {
  return typeof STRINGS['en-US'][key] === 'string';
}

/** fn(locale) runs after every language change. */
export function onLanguage(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Re-apply static markup text in the current locale. */
export function applyDom(root = globalThis.document) {
  if (!root?.querySelectorAll) return;
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  if (root.documentElement) root.documentElement.lang = lang;
}

function setLocale(next) {
  lang = STRINGS[next] ? next : 'en-US';
  dict = STRINGS[lang];
  const doc = globalThis.document;
  if (doc && doc.readyState !== 'loading') applyDom(doc);
  else if (doc?.documentElement) doc.documentElement.lang = lang;
  for (const fn of listeners) {
    try {
      fn(lang);
    } catch (e) {
      console.error(e);
    }
  }
}

const SL = globalThis.window?.StarHermitLanguage ?? null;
let forced = null;
try {
  const q = new URLSearchParams(globalThis.location?.search ?? '').get('lang');
  forced = q && SL ? SL.match(q, SUPPORTED) : null;
} catch {
  /* opaque origin */
}
export const language = SL
  ? SL.create({ game: 'vanishing-cubes', supported: SUPPORTED, panel: !forced, apply: (l) => setLocale(forced || l) })
  : null;
if (!language) setLocale('en-US');

// ---------------------------------------------------------------------------
// Content display names (the authored English stays in content/*.js)
// ---------------------------------------------------------------------------

/** Display name of a generated level (journey, lesson board, practice, daily, challenge). */
export function levelName(level) {
  if (!level) return '';
  const id = String(level.id || '');
  let m;
  if ((m = /^lesson-(t\d+)$/.exec(id))) return tn('lessons', m[1], level.name);
  if ((m = /^practice-(easy|medium|hard)/.exec(id))) return t('practiceName', { level: t('diff_' + m[1]) });
  if ((m = /^daily-(.+)$/.exec(id))) return t('dailyName', { date: m[1] });
  if (/^ch-/.test(id)) return tn('challenges', id, level.name);
  return tn('levels', id, level.name);
}

/** The level's tip line (journey tips by level id; the daily has one shared tip). */
export function levelTip(level) {
  if (!level || !level.tip) return '';
  return /^daily-/.test(String(level.id)) ? t('tipDaily') : tn('tips', level.id, level.tip);
}

/** Lesson step text by lesson id and step index. */
export function lessonStep(lessonId, index, fallback) {
  return tn('lessonSteps', lessonId + '.' + index, fallback);
}

export const dirName = (dir) => t('dir_' + dir);

/** Engine refusal (explainRelease / invalid event) in the current locale. */
export function refusalText(ex) {
  if (!ex || ex.ok) return '';
  switch (ex.reason) {
    case 'not-active': return t('rsnNotActive');
    case 'gone': return t('rsnGone');
    case 'stone': return t('rsnStone');
    case 'core': return t('rsnCore');
    case 'locked': return ex.keyId ? t('rsnLocked', { key: ex.keyId }) : t('rsnLockedNoKey');
    case 'blocked': return ex.byStone ? t('rsnBlockedStone') : t('rsnBlockedBy', { id: ex.by });
    default: return ex.message || t('rsnDefault');
  }
}

/** Built-in fallback names ('Player <id>', 'Guest') are localized at render time. */
export function playerName(name) {
  if (name == null || name === 'Guest') return t('guest');
  const m = /^Player (\S+)$/.exec(String(name));
  return m ? t('playerN', { id: m[1] }) : String(name);
}
