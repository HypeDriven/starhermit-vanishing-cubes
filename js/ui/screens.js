// Screen builders and the screen manager. Semantic HTML over/beside the
// canvas; the canvas is never the only UI. Maximum line lengths stay under
// ~70 characters in all panels.

import { CHAPTERS } from '../content/levels.js';
import { LESSONS } from '../content/tutorials.js';
import { CHALLENGES } from '../content/challenges.js';
import { THEMES } from '../content/themes.js';
import { DEFAULT_BINDINGS, bindingLabel } from './bindings.js';
import { formatMs } from './hud.js';
import { closeModal } from './a11y.js';
import { audio } from '../audio/audio.js';
import { CATEGORIES, PRESETS, choosePreset, normalize, presetTier, resolve, setOverride } from '../render/gfx.js';
import { gfxStrings } from './gfx-strings.js';
import { t, tn, locale, levelName, playerName } from './i18n.js';

const SCREENS = ['title', 'modes', 'setup', 'game', 'results', 'scores', 'help'];

export function showScreen(name) {
  for (const s of SCREENS) {
    const el = document.getElementById('screen-' + s);
    if (el) el.hidden = s !== name;
    // a screen shown again starts at its top (not where the player last scrolled it)
    if (el && s === name) el.scrollTop = 0;
  }
  const main = document.getElementById('main');
  if (main) main.focus({ preventScroll: true });
}

export function currentScreen() {
  for (const s of SCREENS) {
    const el = document.getElementById('screen-' + s);
    if (el && !el.hidden) return s;
  }
  return null;
}

// ---------- mode cards ----------

export function buildModeCards(container, ctx, onChoose) {
  const { progression, dailyKey, dailyDone } = ctx;
  const stars = Object.values(progression.journeyStars).reduce((a, b) => a + b, 0);
  const completed = Object.keys(progression.journeyStars).length;
  const lessonsDone = LESSONS.filter((l) => progression.tutorials[l.id]).length;
  const cards = [
    { id: 'learn', name: t('modeLearn'), blurb: t('modeLearnBlurb'), badge: 'casual', status: t('nLessons', { n: lessonsDone, total: LESSONS.length }) },
    { id: 'journey', name: t('modeJourney'), blurb: t('modeJourneyBlurb'), badge: 'casual', status: t('nStages', { n: completed, stars }) },
    { id: 'daily', name: t('modeDaily'), blurb: t('modeDailyBlurb'), badge: 'ranked', status: dailyDone ? t('completedToday') : dailyKey },
    { id: 'practice', name: t('modePractice'), blurb: t('modePracticeBlurb'), badge: 'casual', status: '' },
    { id: 'challenge', name: t('modeChallenge'), blurb: t('modeChallengeBlurb'), badge: 'ranked', status: t('nChallenges', { n: CHALLENGES.length }) },
    { id: 'score-chase', name: t('modeScores'), blurb: t('modeScoresBlurb'), badge: 'ranked', status: '' },
  ];
  container.textContent = '';
  for (const c of cards) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'card';
    btn.dataset.mode = c.id;
    const badge = document.createElement('span');
    badge.className = 'badge' + (c.badge === 'casual' ? ' casual' : '');
    badge.textContent = c.badge === 'casual' ? t('badgeCasual') : t('badgeRanked');
    const h = document.createElement('h3');
    h.textContent = c.name;
    const p = document.createElement('p');
    p.textContent = c.blurb;
    btn.append(badge, h, p);
    if (c.status) {
      const s = document.createElement('p');
      s.className = 'muted small';
      s.textContent = c.status;
      btn.appendChild(s);
    }
    btn.addEventListener('click', () => onChoose(c.id));
    container.appendChild(btn);
  }
}

// ---------- setup ----------

function setupFacts(el, facts) {
  const div = document.createElement('div');
  div.className = 'setup-facts';
  for (const [k, v] of facts) {
    const span = document.createElement('span');
    span.innerHTML = `<strong></strong>&nbsp;<span></span>`;
    span.children[0].textContent = k + ':';
    span.children[1].textContent = v;
    div.appendChild(span);
  }
  el.appendChild(div);
}

export function buildSetup(container, mode, ctx, onStart) {
  container.textContent = '';
  const { progression, levelMetas, dailyMeta, platformInfo } = ctx;

  if (mode === 'learn') {
    const panel = document.createElement('div');
    panel.className = 'setup-panel';
    const lh = document.createElement('h3');
    lh.textContent = t('lessonsH');
    panel.appendChild(lh);
    setupFacts(panel, [
      [t('factRules'), t('factRulesLearn')],
      [t('factPlayers'), '1'],
      [t('factRanked'), t('no')],
    ]);
    const grid = document.createElement('div');
    grid.className = 'level-grid';
    for (const lesson of LESSONS) {
      const done = !!progression.tutorials[lesson.id];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'card';
      btn.innerHTML = `<h3></h3><p></p>`;
      btn.querySelector('h3').textContent = (done ? '✓ ' : '') + tn('lessons', lesson.id, lesson.name);
      btn.querySelector('p').textContent = tn('lessonGoals', lesson.id, lesson.goal);
      btn.addEventListener('click', () => onStart({ mode, lessonId: lesson.id }));
      grid.appendChild(btn);
    }
    panel.appendChild(grid);
    container.appendChild(panel);
    return;
  }

  if (mode === 'journey') {
    const starsOf = (id) => progression.journeyStars[id] || 0;
    const isUnlocked = (index) => {
      if (index === 0) return true;
      return starsOf(levelMetas[index - 1].id) > 0;
    };
    let currentChapter = 0;
    for (let i = 0; i < levelMetas.length; i++) {
      const meta = levelMetas[i];
      if (meta.chapter !== currentChapter) {
        currentChapter = meta.chapter;
        const ch = CHAPTERS.find((c) => c.id === currentChapter);
        const h = document.createElement('h3');
        h.className = 'chapter-heading';
        h.textContent = t('chapterH', { n: ch.id, name: tn('chapters', ch.id, ch.name) });
        container.appendChild(h);
        const blurb = document.createElement('p');
        blurb.className = 'muted small';
        blurb.textContent = tn('chapterBlurbs', ch.id, ch.blurb);
        container.appendChild(blurb);
        const grid = document.createElement('div');
        grid.className = 'level-grid';
        grid.id = 'chapter-grid-' + currentChapter;
        container.appendChild(grid);
      }
      const grid = container.querySelector('#chapter-grid-' + currentChapter);
      const unlocked = isUnlocked(i);
      const stars = starsOf(meta.id);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'card' + (unlocked ? '' : ' locked');
      btn.disabled = !unlocked;
      btn.innerHTML = `<h3></h3><p></p><p class="stars-inline"></p>`;
      btn.querySelector('h3').textContent = levelName(meta);
      btn.querySelector('p').textContent = meta.summary;
      btn.querySelector('.stars-inline').textContent = stars
        ? '★'.repeat(stars) + '☆'.repeat(3 - stars)
        : unlocked
          ? t('notCleared')
          : t('locked');
      if (unlocked) btn.addEventListener('click', () => onStart({ mode, levelIndex: i }));
      grid.appendChild(btn);
    }
    return;
  }

  if (mode === 'daily') {
    const panel = document.createElement('div');
    panel.className = 'setup-panel';
    const h = document.createElement('h3');
    h.textContent = levelName(dailyMeta);
    panel.appendChild(h);
    setupFacts(panel, [
      [t('factSeed'), dailyMeta.seedLabel],
      [t('factRules'), dailyMeta.summary],
      [t('factExpected'), formatMs(dailyMeta.par.timeMs)],
      [t('factPlayers'), '1'],
      [t('factAssists'), t('hintsOnly')],
      [t('factRanked'), platformInfo.hosted ? t('rankedHosted') : t('rankedOffline')],
    ]);
    if (dailyMeta.doneToday) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = t('todaysBest', { score: dailyMeta.doneToday.score, status: dailyMeta.doneToday.completed ? t('cleared') : t('notClearedShort') });
      panel.appendChild(p);
    }
    const start = document.createElement('button');
    start.type = 'button';
    start.className = 'btn primary';
    start.textContent = dailyMeta.doneToday ? t('playAgain') : t('startDaily');
    start.addEventListener('click', () => onStart({ mode }));
    panel.appendChild(start);
    container.appendChild(panel);
    return;
  }

  if (mode === 'practice') {
    const panel = document.createElement('div');
    panel.className = 'setup-panel';
    const dh = document.createElement('h3');
    dh.textContent = t('difficultyH');
    panel.appendChild(dh);
    setupFacts(panel, [
      [t('factUndo'), t('allowed')],
      [t('factHints'), t('allowed')],
      [t('factRanked'), t('neverRanked')],
    ]);
    const grid = document.createElement('div');
    grid.className = 'level-grid';
    for (const diff of ['easy', 'medium', 'hard']) {
      const best = progression.practiceBest[diff];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'card';
      btn.innerHTML = `<h3></h3><p></p>`;
      btn.querySelector('h3').textContent = t('diff_' + diff);
      btn.querySelector('p').textContent = t('diffBlurb_' + diff) + (best != null ? ' ' + t('bestN', { n: best }) : '');
      btn.addEventListener('click', () => onStart({ mode, difficulty: diff }));
      grid.appendChild(btn);
    }
    panel.appendChild(grid);
    container.appendChild(panel);
    return;
  }

  if (mode === 'challenge') {
    const panel = document.createElement('div');
    panel.className = 'setup-panel';
    setupFacts(panel, [
      [t('factUndo'), t('disabled')],
      [t('factHints'), t('disabled')],
      [t('factRanked'), platformInfo.hosted ? t('rankedHosted') : t('rankedOffline')],
    ]);
    const grid = document.createElement('div');
    grid.className = 'level-grid';
    for (const ch of CHALLENGES) {
      const best = progression.challengeBest[ch.id];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'card';
      btn.innerHTML = `<h3></h3><p></p>`;
      btn.querySelector('h3').textContent = tn('challenges', ch.id, ch.name);
      btn.querySelector('p').textContent = tn('challengeBlurbs', ch.id, ch.blurb) + (best != null ? ' ' + t('bestN', { n: best }) : '');
      btn.addEventListener('click', () => onStart({ mode, challengeId: ch.id }));
      grid.appendChild(btn);
    }
    panel.appendChild(grid);
    container.appendChild(panel);
  }
}

// ---------- results ----------

const HEADLINES = {
  cleared: 'headCleared',
  'moves-exhausted': 'headMoves',
  'time-exhausted': 'headTime',
  conceded: 'headConceded',
  'no-legal-moves': 'headNoMoves',
};

export function renderResults(target, data) {
  const { result, level, mode, achievements, rankInfo, nextLabel, previousBest } = data;
  document.getElementById('results-heading').textContent = t(HEADLINES[result.terminalReason] || 'headOver');
  document.getElementById('results-sub').textContent =
    `${levelName(level)} · ${t('modeName_' + mode)} · ${formatMs(result.elapsedMs)}`;

  const starsEl = document.getElementById('results-stars');
  starsEl.textContent = result.stars > 0 ? '★'.repeat(result.stars) + '☆'.repeat(3 - result.stars) : '';
  starsEl.setAttribute('aria-label', t('starsOf3', { n: result.stars }));

  const tbody = document.querySelector('#results-table tbody');
  tbody.textContent = '';
  const c = result.components;
  const rows = [
    [t('rowReleasedN', { n: result.stats.released }), c.release],
    [t('rowCompletion'), c.completion],
    [t('rowTapEff'), c.tapEfficiency],
    [t('rowRotEff'), c.rotationEfficiency],
    [t('rowTime'), c.timeBonus],
    [t('rowInvalidN', { n: result.stats.invalid }), -c.invalidPenalty],
  ];
  for (const [label, value] of rows) {
    const tr = document.createElement('tr');
    const a = document.createElement('td');
    const b = document.createElement('td');
    a.textContent = label;
    b.textContent = String(value);
    tr.append(a, b);
    tbody.appendChild(tr);
  }
  const tr = document.createElement('tr');
  tr.className = 'total';
  const a = document.createElement('td');
  const b = document.createElement('td');
  a.textContent = t('total');
  b.textContent = String(result.score);
  tr.append(a, b);
  tbody.appendChild(tr);

  const achEl = document.getElementById('results-achievements');
  achEl.textContent = '';
  for (const ach of achievements || []) {
    const chip = document.createElement('div');
    chip.className = 'achievement-chip';
    const [name, desc] = tn('achievements', ach.key, [ach.name, ach.desc]);
    chip.textContent = t('achievementChip', { name, desc });
    achEl.appendChild(chip);
  }

  const cmp = document.getElementById('results-comparison');
  const parts = [];
  if (rankInfo?.rank) {
    parts.push(t(rankInfo.validated ? 'rankValidated' : 'rankCasual', { rank: rankInfo.rank }));
  }
  if (previousBest != null) {
    parts.push(result.score > previousBest ? t('newBest', { n: previousBest }) : t('personalBest', { n: previousBest }));
  }
  cmp.textContent = parts.join(' ');

  const nextBtn = document.getElementById('btn-next');
  // nextLabel is a string key (nextStage / nextLesson / playAgain / modes).
  nextBtn.textContent = t(nextLabel || 'next');
  // When the only continuation is "Modes", the exit button already covers it.
  nextBtn.hidden = !nextLabel || nextLabel === 'modes';
}

// ---------- scores ----------

function boardPanel(title, res, progression) {
  const panel = document.createElement('div');
  panel.className = 'setup-panel';
  const h = document.createElement('h3');
  h.textContent = title;
  panel.appendChild(h);
  const table = document.createElement('table');
  table.className = 'board-table';
  table.innerHTML =
    '<thead><tr><th>#</th><th></th><th class="num"></th><th class="num"></th><th class="num"></th></tr></thead>';
  ['colPlayer', 'colScore', 'colInvalid', 'colTime'].forEach((k, i) => { table.querySelectorAll('th')[i + 1].textContent = t(k); });
  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  panel.appendChild(table);
  if (!res.ok) {
    tbody.innerHTML = '<tr><td colspan="5"></td></tr>';
    tbody.querySelector('td').textContent = t('boardUnavailable', { error: res.error });
    return panel;
  }
  if (res.casual) {
    const p = document.createElement('p');
    p.className = 'board-note';
    p.textContent = t('casualBoard');
    panel.appendChild(p);
  }
  if (!res.entries.length) {
    tbody.innerHTML = '<tr><td colspan="5"></td></tr>';
    tbody.querySelector('td').textContent = t('noEntries');
    return panel;
  }
  res.entries.slice(0, 10).forEach((entry, i) => {
    const tr = document.createElement('tr');
    const name = playerName(entry.name || 'Guest');
    tr.innerHTML = `<td>${i + 1}</td><td></td><td class="num">${entry.score}</td><td class="num">${entry.invalid ?? 0}</td><td class="num">${formatMs(entry.elapsedMs || 0)}</td>`;
    tr.children[1].textContent = name + (entry.sessionId && entry.sessionId === progression.lastSessionId ? t('youTag') : '');
    tbody.appendChild(tr);
  });
  return panel;
}

export async function renderScores(container, ctx, friendNames = []) {
  const { platform, boards, progression } = ctx;
  container.textContent = '';
  const note = document.createElement('p');
  note.className = 'board-note';
  note.textContent = platform.hosted ? t('scoresHosted') : t('scoresOffline');
  container.appendChild(note);

  // Compact friends filter: compare against known display names. No social
  // graph exists for this title; filtering is display-name based.
  const frForm = document.createElement('form');
  frForm.className = 'friends-form';
  const frLabel = document.createElement('label');
  frLabel.textContent = t('friendsLabel');
  const frInput = document.createElement('input');
  frInput.type = 'text';
  frInput.maxLength = 200;
  frInput.placeholder = t('friendsPlaceholder');
  frInput.value = friendNames.join(', ');
  frLabel.appendChild(frInput);
  const frBtn = document.createElement('button');
  frBtn.type = 'submit';
  frBtn.className = 'btn';
  frBtn.textContent = friendNames.length ? t('clearFilter') : t('compare');
  const frHint = document.createElement('span');
  frHint.className = 'muted small';
  frHint.textContent = friendNames.length ? t('showing', { names: friendNames.join(', ') }) : '';
  frForm.append(frLabel, frBtn, frHint);
  frForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (friendNames.length) renderScores(container, ctx, []);
    else {
      const names = frInput.value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20);
      renderScores(container, ctx, names);
    }
  });
  container.appendChild(frForm);

  const scope = friendNames.length ? 'friends' : 'global';

  // Hosted: the platform's single read-only leaderboard for this game.
  if (platform.hosted) {
    const g = await platform.globalBoard(scope);
    if (g === null) {
      const p = document.createElement('p');
      p.className = 'board-note';
      p.textContent = t('noGlobalBoard');
      container.appendChild(p);
    } else {
      container.appendChild(boardPanel(t('globalAll'), g, progression));
    }
  }

  for (const board of boards) {
    const res = await platform.leaderboard(board.id, scope, friendNames);
    container.appendChild(boardPanel(board.name, res, progression));
  }
}

// ---------- help (generated from live bindings) ----------

export function renderHelp(container, settings) {
  container.textContent = '';
  const overrides = settings.controls.overrides;
  const rules = [
    { title: t('helpGoal'), body: t('helpGoalText') },
    { title: t('helpStones'), body: t('helpStonesText') },
    { title: t('helpScoring'), body: t('helpScoringText') },
    { title: t('helpReading'), body: t('helpReadingText') },
  ];
  for (const r of rules) {
    const card = document.createElement('div');
    card.className = 'rule-card';
    const h = document.createElement('h3');
    h.textContent = r.title;
    const p = document.createElement('p');
    p.textContent = r.body;
    card.append(h, p);
    container.appendChild(card);
  }
  const controls = document.createElement('div');
  controls.className = 'rule-card';
  const h = document.createElement('h3');
  h.textContent = t('helpControls');
  controls.appendChild(h);
  const list = document.createElement('p');
  const parts = DEFAULT_BINDINGS.map((b) => {
    const keys = bindingLabel(b.action, overrides)
      .split(' / ')
      .map((k) => `<kbd>${k}</kbd>`)
      .join(' ');
    return `${escapeHtml(t('bind_' + b.action))}: ${keys} · ${escapeHtml(t('gamepadN', { button: t('pad_' + b.action) }))}`;
  });
  list.innerHTML = parts.join('<br>');
  controls.appendChild(list);
  const touch = document.createElement('p');
  touch.textContent = t('helpTouch');
  controls.appendChild(touch);
  container.appendChild(controls);
}

// ---------- settings ----------

function heading3(text) {
  const h = document.createElement('h3');
  h.textContent = text;
  return h;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function row(labelText, control) {
  const div = document.createElement('div');
  div.className = 'setting-row';
  const label = document.createElement('label');
  label.textContent = labelText;
  div.append(label, control);
  return div;
}

function slider(value, onInput) {
  const s = document.createElement('input');
  s.type = 'range';
  s.min = '0';
  s.max = '1';
  s.step = '0.05';
  s.value = String(value);
  s.addEventListener('input', () => {
    audio.play('slider');
    onInput(Number(s.value));
  });
  return s;
}

function checkbox(value, onInput, label = '') {
  const c = document.createElement('input');
  c.type = 'checkbox';
  c.checked = !!value;
  if (label) c.setAttribute('aria-label', label);
  c.addEventListener('change', () => {
    audio.play('toggle');
    onInput(c.checked);
  });
  return c;
}

export function buildSettings(container, settings, ctx, onChange) {
  container.textContent = '';
  const a = settings.accessibility;

  const secAudio = document.createElement('div');
  secAudio.className = 'settings-section';
  secAudio.appendChild(heading3(t('audio')));
  secAudio.append(
    row(t('music'), slider(settings.audio.music, (v) => onChange('audio.music', v))),
    row(t('effects'), slider(settings.audio.effects, (v) => onChange('audio.effects', v))),
    row(t('ambience'), slider(settings.audio.ambience, (v) => onChange('audio.ambience', v))),
    row(t('voice'), slider(settings.audio.voice, (v) => onChange('audio.voice', v))),
    row(t('muteAll'), checkbox(settings.audio.muted, (v) => onChange('audio.muted', v), t('muteAllAria'))),
    row(t('captions'), checkbox(settings.audio.captions, (v) => onChange('audio.captions', v), t('captionsAria'))),
  );
  container.appendChild(secAudio);

  const secGfx = document.createElement('div');
  secGfx.className = 'settings-section';
  secGfx.appendChild(heading3(t('graphics')));
  secGfx.id = 'gfx-section';
  buildGraphicsControls(secGfx, settings.graphics, ctx.gfx || {}, (next) => onChange('graphics', next));
  secGfx.append(row(t('reducedMotion'), checkbox(a.reducedMotion, (v) => onChange('accessibility.reducedMotion', v), t('reducedMotion'))));

  const swatches = document.createElement('div');
  swatches.className = 'theme-swatches';
  for (const theme of THEMES) {
    const unlocked = ctx.totalStars >= theme.unlockStars;
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'theme-swatch' + (ctx.theme === theme.id ? ' selected' : '') + (unlocked ? '' : ' locked');
    sw.style.background = `linear-gradient(#${theme.sky.top.toString(16).padStart(6, '0')}, #${theme.sky.horizon.toString(16).padStart(6, '0')})`;
    const themeLabel = tn('themes', theme.id, theme.name);
    sw.setAttribute('aria-label', unlocked ? themeLabel : t('themeLocked', { name: themeLabel, n: theme.unlockStars }));
    const span = document.createElement('span');
    span.textContent = unlocked ? themeLabel : `🔒 ${theme.unlockStars}★`;
    sw.appendChild(span);
    if (unlocked) sw.addEventListener('click', () => onChange('theme', theme.id));
    swatches.appendChild(sw);
  }
  const themeRow = document.createElement('div');
  themeRow.className = 'setting-row';
  const themeRowLabel = document.createElement('label');
  themeRowLabel.textContent = t('themeRow');
  themeRow.append(themeRowLabel, swatches);
  secGfx.appendChild(themeRow);
  container.appendChild(secGfx);

  const secA11y = document.createElement('div');
  secA11y.className = 'settings-section';
  secA11y.appendChild(heading3(t('accessibility')));
  const palette = document.createElement('select');
  for (const [value, label] of [
    ['default', t('palDefault')],
    ['cvd-safe', t('palCvd')],
    ['mono-safe', t('palMono')],
  ]) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    palette.appendChild(o);
  }
  palette.value = a.palette;
  palette.addEventListener('change', () => onChange('accessibility.palette', palette.value));
  secA11y.append(
    row(t('colorPalette'), palette),
    row(t('highContrast'), checkbox(a.highContrast, (v) => onChange('accessibility.highContrast', v), t('highContrast'))),
    row(t('largerText'), checkbox(a.largeText, (v) => onChange('accessibility.largeText', v), t('largerText'))),
    row(t('leftHanded'), checkbox(a.leftHanded, (v) => onChange('accessibility.leftHanded', v), t('leftHanded'))),
    row(t('dragToggle'), checkbox(a.dragToggle, (v) => onChange('accessibility.dragToggle', v), t('dragToggle'))),
    row(t('timingAssist'), checkbox(a.timingAssist, (v) => onChange('accessibility.timingAssist', v), t('timingAssist'))),
    row(t('hapticsOff'), checkbox(a.hapticsOff, (v) => onChange('accessibility.hapticsOff', v), t('hapticsOff'))),
  );
  container.appendChild(secA11y);

  const secCtl = document.createElement('div');
  secCtl.className = 'settings-section';
  secCtl.appendChild(heading3(t('keyboardControls')));
  for (const b of DEFAULT_BINDINGS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    btn.textContent = bindingLabel(b.action, settings.controls.overrides);
    btn.setAttribute('aria-label', t('rebindAria', { action: t('bind_' + b.action) }));
    btn.addEventListener('click', () => {
      btn.textContent = t('pressKey');
      const handler = (ev) => {
        ev.preventDefault();
        window.removeEventListener('keydown', handler, true);
        onChange('rebind', { action: b.action, key: ev.code });
      };
      window.addEventListener('keydown', handler, true);
    });
    secCtl.appendChild(row(t('bind_' + b.action), btn));
  }
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'btn ghost';
  reset.textContent = t('resetBindings');
  reset.addEventListener('click', () => onChange('rebind-reset'));
  secCtl.appendChild(reset);
  container.appendChild(secCtl);

  const secMisc = document.createElement('div');
  secMisc.className = 'settings-section';
  secMisc.appendChild(heading3(t('gameplayPrivacy')));
  const replayTut = document.createElement('button');
  replayTut.type = 'button';
  replayTut.className = 'btn';
  replayTut.textContent = t('replayLessons');
  replayTut.addEventListener('click', () => {
    onChange('replay-tutorial');
    closeModal(document.getElementById('modal-settings'));
  });
  secMisc.append(
    row(t('tutorial'), replayTut),
    row(t('telemetry'), checkbox(settings.telemetryConsent, (v) => onChange('telemetryConsent', v), t('telemetry'))),
  );
  container.appendChild(secMisc);
}

// ---------- graphics ----------

function labelledRow(id, text, control) {
  const r = row(text, control);
  control.id = id;
  r.querySelector('label').htmlFor = id;
  return r;
}

function selectRow(r) {
  r.classList.add('gfx-select-row');
  return r;
}

function selectOf(options, value) {
  const sel = document.createElement('select');
  for (const [v, text] of options) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = text;
    sel.appendChild(o);
  }
  sel.value = value;
  return sel;
}

// Quality preset, render scale, one override per category, adaptive
// resolution, frame-rate readout and a cost summary. Every control applies
// immediately; choosing a preset clears the per-category overrides.
function buildGraphicsControls(sec, savedRaw, gfx, commit) {
  const t = gfxStrings(locale());
  const saved = normalize(savedRaw);
  const detected = gfx.detected || 'balanced';
  const r = gfx.info?.resolved || resolve(saved, detected);
  sec.dataset.gfxPreset = r.preset;

  const preset = selectOf([
    ['auto', t('auto', { tier: t(detected) })],
    ...PRESETS.map((p) => [p, t(p)]),
  ], saved.preset);
  preset.addEventListener('change', () => commit(choosePreset(saved, preset.value)));
  sec.append(selectRow(labelledRow('gfx-preset', t('quality'), preset)));

  const scaleWrap = document.createElement('span');
  scaleWrap.className = 'gfx-scale';
  const scale = document.createElement('input');
  scale.type = 'range';
  scale.min = '50';
  scale.max = '200';
  scale.step = '5';
  const pct = Math.round((Number(saved.render_scale) || 1) * 100);
  scale.value = String(pct);
  const scaleOut = document.createElement('output');
  scaleOut.id = 'gfx-scale-value';
  scaleOut.textContent = pct + '%';
  scale.addEventListener('input', () => { scaleOut.textContent = scale.value + '%'; });
  scale.addEventListener('change', () => {
    audio.play('slider');
    commit({ ...saved, render_scale: Number(scale.value) / 100 });
  });
  scaleWrap.append(scale, scaleOut);
  const scaleRow = labelledRow('gfx-scale', t('renderScale'), scale);
  scaleRow.replaceChild(scaleWrap, scale);
  scaleWrap.prepend(scale);
  sec.append(scaleRow);

  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    const sel = selectOf([
      ['preset', t('fromPreset', { tier: t(presetTier(r.preset, cat)) })],
      ...tiers.map((v) => [v, t(v)]),
    ], tiers.includes(saved[cat]) ? saved[cat] : 'preset');
    sel.dataset.gfxCat = cat;
    sel.addEventListener('change', () => commit(setOverride(saved, cat, sel.value)));
    sec.append(selectRow(labelledRow('gfx-' + cat, t(cat), sel)));
  }

  sec.append(
    labelledRow('gfx-adaptive', t('adaptive'), checkbox(saved.adaptive !== false, (v) => commit({ ...saved, adaptive: v }))),
    labelledRow('gfx-show-fps', t('showFps'), checkbox(!!saved.show_fps, (v) => commit({ ...saved, show_fps: v }))),
  );

  const summary = document.createElement('p');
  summary.id = 'gfx-summary';
  summary.className = 'muted small gfx-summary';
  summary.textContent = [gfx.info?.gpu || t('unknownGpu'), gfx.info && Number.isFinite(gfx.info.level) ? t('level').replace('{n}', gfx.info.level) : null, gfx.info?.summary].filter(Boolean).join(' · ');
  sec.append(summary);
  if (gfx.info?.postFailed) {
    const note = document.createElement('p');
    note.id = 'gfx-post-note';
    note.className = 'small gfx-note';
    note.setAttribute('role', 'status');
    note.textContent = t('postFailed');
    sec.append(note);
  }
}

// ---------- profile ----------

export function buildProfile(container, profile, progression, ctx, onSave) {
  container.textContent = '';
  const p = document.createElement('p');
  p.className = 'muted small';
  p.textContent = ctx.hosted ? t('profileHosted', { name: playerName(profile.name) }) : t('profileGuest');
  container.appendChild(p);

  const nameRow = document.createElement('div');
  nameRow.className = 'setting-row';
  const label = document.createElement('label');
  label.textContent = ctx.hosted ? t('accountNickname') : t('displayName');
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 24;
  input.value = profile.name === 'Guest' ? t('guest') : profile.name;
  input.disabled = ctx.hosted;
  nameRow.append(label, input);
  container.appendChild(nameRow);

  const stars = Object.values(progression.journeyStars).reduce((x, y) => x + y, 0);
  const stats = document.createElement('p');
  stats.className = 'muted';
  stats.textContent = t('profileStats', {
    stars, stages: Object.keys(progression.journeyStars).length, released: progression.totals.released, streak: ctx.dailyStreak,
  });
  container.appendChild(stats);

  if (!ctx.hosted) {
    input.addEventListener('change', () => {
      const v = input.value.trim();
      onSave(!v || v === t('guest') ? 'Guest' : v);
    });
  } else {
    input.addEventListener('change', () => { input.value = profile.name; });
  }
}
