// Screen builders and the screen manager. Semantic HTML over/beside the
// canvas; the canvas is never the only UI. Maximum line lengths stay under
// ~70 characters in all panels.

import { CHAPTERS } from '../content/levels.js';
import { LESSONS } from '../content/tutorials.js';
import { CHALLENGES } from '../content/challenges.js';
import { THEMES } from '../content/themes.js';
import { DEFAULT_BINDINGS, bindingLabel, effectiveKeys } from './bindings.js';
import { formatMs } from './hud.js';
import { closeModal } from './a11y.js';

const SCREENS = ['title', 'modes', 'setup', 'game', 'results', 'scores', 'help'];

export function showScreen(name) {
  for (const s of SCREENS) {
    const el = document.getElementById('screen-' + s);
    if (el) el.hidden = s !== name;
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
    {
      id: 'learn',
      name: 'Learn',
      blurb: 'Interactive lessons — one rule at a time, by doing.',
      badge: 'casual',
      status: `${lessonsDone}/${LESSONS.length} lessons`,
    },
    {
      id: 'journey',
      name: 'Journey',
      blurb: 'Forty authored stages across five chapters.',
      badge: 'casual',
      status: `${completed}/40 stages · ${stars}★`,
    },
    {
      id: 'daily',
      name: 'Daily',
      blurb: 'One shared board per UTC day, ranked.',
      badge: 'ranked',
      status: dailyDone ? 'Completed today ✓' : dailyKey,
    },
    {
      id: 'practice',
      name: 'Practice',
      blurb: 'Selectable difficulty, restart and undo. Never ranked.',
      badge: 'casual',
      status: '',
    },
    {
      id: 'challenge',
      name: 'Challenge',
      blurb: 'Move limits, speed targets, altered layouts.',
      badge: 'ranked',
      status: `${CHALLENGES.length} challenges`,
    },
    {
      id: 'score-chase',
      name: 'Score chase',
      blurb: 'Global and friends boards on validated seeds.',
      badge: 'ranked',
      status: '',
    },
  ];
  container.textContent = '';
  for (const c of cards) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'card';
    const badge = document.createElement('span');
    badge.className = 'badge' + (c.badge === 'casual' ? ' casual' : '');
    badge.textContent = c.badge;
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
    panel.innerHTML = '<h3>Lessons</h3>';
    setupFacts(panel, [
      ['Rules', 'introduced one at a time'],
      ['Players', '1'],
      ['Ranked', 'no'],
    ]);
    const grid = document.createElement('div');
    grid.className = 'level-grid';
    for (const lesson of LESSONS) {
      const done = !!progression.tutorials[lesson.id];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'card';
      btn.innerHTML = `<h3></h3><p></p>`;
      btn.querySelector('h3').textContent = (done ? '✓ ' : '') + lesson.name;
      btn.querySelector('p').textContent = lesson.goal;
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
        h.textContent = `Chapter ${ch.id} — ${ch.name}`;
        container.appendChild(h);
        const blurb = document.createElement('p');
        blurb.className = 'muted small';
        blurb.textContent = ch.blurb;
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
      btn.querySelector('h3').textContent = meta.name;
      btn.querySelector('p').textContent = meta.summary;
      btn.querySelector('.stars-inline').textContent = stars
        ? '★'.repeat(stars) + '☆'.repeat(3 - stars)
        : unlocked
          ? 'not cleared yet'
          : 'locked';
      if (unlocked) btn.addEventListener('click', () => onStart({ mode, levelIndex: i }));
      grid.appendChild(btn);
    }
    return;
  }

  if (mode === 'daily') {
    const panel = document.createElement('div');
    panel.className = 'setup-panel';
    const h = document.createElement('h3');
    h.textContent = dailyMeta.name;
    panel.appendChild(h);
    setupFacts(panel, [
      ['Seed', dailyMeta.seedLabel],
      ['Rules', dailyMeta.summary],
      ['Expected', formatMs(dailyMeta.par.timeMs)],
      ['Players', '1'],
      ['Assists', 'hints only — no undo'],
      ['Ranked', platformInfo.hosted ? 'yes — validated board' : 'casual (offline)'],
    ]);
    if (dailyMeta.doneToday) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = `Today's best: ${dailyMeta.doneToday.score} (${dailyMeta.doneToday.completed ? 'cleared' : 'not cleared'})`;
      panel.appendChild(p);
    }
    const start = document.createElement('button');
    start.type = 'button';
    start.className = 'btn primary';
    start.textContent = dailyMeta.doneToday ? 'Play again' : 'Start the daily';
    start.addEventListener('click', () => onStart({ mode }));
    panel.appendChild(start);
    container.appendChild(panel);
    return;
  }

  if (mode === 'practice') {
    const panel = document.createElement('div');
    panel.className = 'setup-panel';
    panel.innerHTML = '<h3>Difficulty</h3>';
    setupFacts(panel, [
      ['Undo', 'allowed'],
      ['Hints', 'allowed'],
      ['Ranked', 'never — no effect on ratings'],
    ]);
    const grid = document.createElement('div');
    grid.className = 'level-grid';
    for (const diff of ['easy', 'medium', 'hard']) {
      const best = progression.practiceBest[diff];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'card';
      btn.innerHTML = `<h3></h3><p></p>`;
      btn.querySelector('h3').textContent = diff[0].toUpperCase() + diff.slice(1);
      btn.querySelector('p').textContent =
        { easy: 'A small solid block.', medium: 'Stones and locks appear.', hard: 'A grand work with a core.' }[diff] +
        (best != null ? ` Best: ${best}.` : '');
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
      ['Undo', 'disabled'],
      ['Hints', 'disabled'],
      ['Ranked', platformInfo.hosted ? 'yes' : 'casual (offline)'],
    ]);
    const grid = document.createElement('div');
    grid.className = 'level-grid';
    for (const ch of CHALLENGES) {
      const best = progression.challengeBest[ch.id];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'card';
      btn.innerHTML = `<h3></h3><p></p>`;
      btn.querySelector('h3').textContent = ch.name;
      btn.querySelector('p').textContent = ch.blurb + (best != null ? ` Best: ${best}.` : '');
      btn.addEventListener('click', () => onStart({ mode, challengeId: ch.id }));
      grid.appendChild(btn);
    }
    panel.appendChild(grid);
    container.appendChild(panel);
  }
}

// ---------- results ----------

const HEADLINES = {
  cleared: 'Board cleared!',
  'moves-exhausted': 'Out of moves',
  'time-exhausted': 'Time is up',
  conceded: 'Round conceded',
  'no-legal-moves': 'No legal moves left',
};

export function renderResults(target, data) {
  const { result, level, mode, achievements, rankInfo, nextLabel, previousBest } = data;
  document.getElementById('results-heading').textContent =
    HEADLINES[result.terminalReason] || 'Round over';
  document.getElementById('results-sub').textContent =
    `${level.name} · ${mode} · ${formatMs(result.elapsedMs)}`;

  const starsEl = document.getElementById('results-stars');
  starsEl.textContent = result.stars > 0 ? '★'.repeat(result.stars) + '☆'.repeat(3 - result.stars) : '';
  starsEl.setAttribute('aria-label', `${result.stars} of 3 stars`);

  const tbody = document.querySelector('#results-table tbody');
  tbody.textContent = '';
  const c = result.components;
  const rows = [
    ['Cubes released × ' + result.stats.released, c.release],
    ['Completion', c.completion],
    ['Tap efficiency', c.tapEfficiency],
    ['Rotation efficiency', c.rotationEfficiency],
    ['Time bonus', c.timeBonus],
    ['Invalid taps × ' + result.stats.invalid, -c.invalidPenalty],
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
  a.textContent = 'Total';
  b.textContent = String(result.score);
  tr.append(a, b);
  tbody.appendChild(tr);

  const achEl = document.getElementById('results-achievements');
  achEl.textContent = '';
  for (const ach of achievements || []) {
    const chip = document.createElement('div');
    chip.className = 'achievement-chip';
    chip.textContent = `Achievement unlocked: ${ach.name} — ${ach.desc}`;
    achEl.appendChild(chip);
  }

  const cmp = document.getElementById('results-comparison');
  const parts = [];
  if (rankInfo?.rank) {
    parts.push(`Rank #${rankInfo.rank} on the board${rankInfo.validated ? ' (validated)' : ' (casual)'}.`);
  }
  if (previousBest != null) {
    parts.push(
      result.score > previousBest
        ? `New personal best (was ${previousBest}).`
        : `Personal best: ${previousBest}.`,
    );
  }
  cmp.textContent = parts.join(' ');

  const nextBtn = document.getElementById('btn-next');
  nextBtn.textContent = nextLabel || 'Next';
  // When the only continuation is "Modes", the exit button already covers it.
  nextBtn.hidden = !nextLabel || nextLabel === 'Modes';
}

// ---------- scores ----------

export async function renderScores(container, ctx, friendNames = []) {
  const { platform, boards, progression } = ctx;
  container.textContent = '';
  const note = document.createElement('p');
  note.className = 'board-note';
  note.textContent = platform.hosted
    ? 'Scores submitted with ruleset, content version, seed, assists and duration; ranked boards validate replays server-side.'
    : 'Offline: boards are local and labeled casual. Connect through the host for validated global boards.';
  container.appendChild(note);

  // Compact friends filter: compare against known display names. No social
  // graph exists for this title; filtering is display-name based.
  const frForm = document.createElement('form');
  frForm.className = 'friends-form';
  const frLabel = document.createElement('label');
  frLabel.textContent = 'Friends:';
  const frInput = document.createElement('input');
  frInput.type = 'text';
  frInput.maxLength = 200;
  frInput.placeholder = 'display names, comma-separated';
  frInput.value = friendNames.join(', ');
  frLabel.appendChild(frInput);
  const frBtn = document.createElement('button');
  frBtn.type = 'submit';
  frBtn.className = 'btn';
  frBtn.textContent = friendNames.length ? 'Clear filter' : 'Compare';
  const frHint = document.createElement('span');
  frHint.className = 'muted small';
  frHint.textContent = friendNames.length ? `Showing: ${friendNames.join(', ')}` : '';
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
  for (const board of boards) {
    const panel = document.createElement('div');
    panel.className = 'setup-panel';
    const h = document.createElement('h3');
    h.textContent = board.name;
    panel.appendChild(h);
    const table = document.createElement('table');
    table.className = 'board-table';
    table.innerHTML =
      '<thead><tr><th>#</th><th>Player</th><th class="num">Score</th><th class="num">Invalid</th><th class="num">Time</th></tr></thead>';
    const tbody = document.createElement('tbody');
    tbody.innerHTML = '<tr><td colspan="5">Loading…</td></tr>';
    table.appendChild(tbody);
    panel.appendChild(table);
    container.appendChild(panel);

    const res = await platform.leaderboard(board.id, scope, friendNames);
    tbody.textContent = '';
    if (!res.ok) {
      tbody.innerHTML = '<tr><td colspan="5">Board unavailable (' + res.error + '). Try again later.</td></tr>';
      continue;
    }
    if (res.casual) {
      const p = document.createElement('p');
      p.className = 'board-note';
      p.textContent = 'Casual board — replay validation unavailable.';
      panel.appendChild(p);
    }
    if (!res.entries.length) {
      tbody.innerHTML = '<tr><td colspan="5">No entries yet. Be the first.</td></tr>';
      continue;
    }
    res.entries.slice(0, 10).forEach((entry, i) => {
      const tr = document.createElement('tr');
      const name = entry.name || 'Guest';
      tr.innerHTML = `<td>${i + 1}</td><td></td><td class="num">${entry.score}</td><td class="num">${entry.invalid ?? 0}</td><td class="num">${formatMs(entry.elapsedMs || 0)}</td>`;
      tr.children[1].textContent = name + (entry.sessionId === progression.lastSessionId ? ' (you)' : '');
      tbody.appendChild(tr);
    });
  }
}

// ---------- help (generated from live bindings) ----------

export function renderHelp(container, settings) {
  container.textContent = '';
  const overrides = settings.controls.overrides;
  const rules = [
    {
      title: 'Goal',
      body: 'Every cube with an arrow wants to leave. A cube can leave only when its arrow path to the sky is clear. Release every cube to win; some boards hide a core to expose.',
    },
    {
      title: 'Stones and locks',
      body: 'Grey stones never move. Banded cubes are locked until their glowing key cube is released.',
    },
    {
      title: 'Scoring',
      body: 'Points for every release, a completion bonus, and efficiency bonuses for staying under par taps, rotations and time. Invalid taps cost points.',
    },
    {
      title: 'Reading the board',
      body: 'Select or hover a cube to preview its path. The Board list button shows every cube, its direction and its state in text.',
    },
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
  h.textContent = 'Controls';
  controls.appendChild(h);
  const list = document.createElement('p');
  const parts = DEFAULT_BINDINGS.map((b) => {
    const keys = bindingLabel(b.action, overrides)
      .split(' / ')
      .map((k) => `<kbd>${k}</kbd>`)
      .join(' ');
    return `${b.label}: ${keys} · gamepad ${b.gamepad}`;
  });
  list.innerHTML = parts.join('<br>');
  controls.appendChild(list);
  const touch = document.createElement('p');
  touch.textContent =
    'Touch: tap a cube to release it, drag on empty sky to rotate. Mouse: click and drag the same way.';
  controls.appendChild(touch);
  container.appendChild(controls);
}

// ---------- settings ----------

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
  s.addEventListener('input', () => onInput(Number(s.value)));
  return s;
}

function checkbox(value, onInput, label = '') {
  const c = document.createElement('input');
  c.type = 'checkbox';
  c.checked = !!value;
  if (label) c.setAttribute('aria-label', label);
  c.addEventListener('change', () => onInput(c.checked));
  return c;
}

export function buildSettings(container, settings, ctx, onChange) {
  container.textContent = '';
  const a = settings.accessibility;

  const secAudio = document.createElement('div');
  secAudio.className = 'settings-section';
  secAudio.innerHTML = '<h3>Audio</h3>';
  secAudio.append(
    row('Music', slider(settings.audio.music, (v) => onChange('audio.music', v))),
    row('Effects', slider(settings.audio.effects, (v) => onChange('audio.effects', v))),
    row('Ambience', slider(settings.audio.ambience, (v) => onChange('audio.ambience', v))),
    row('Voice (unused in this title)', slider(settings.audio.voice, (v) => onChange('audio.voice', v))),
    row('Mute all', checkbox(settings.audio.muted, (v) => onChange('audio.muted', v), 'Mute all audio')),
    row('Captions for meaningful sounds', checkbox(settings.audio.captions, (v) => onChange('audio.captions', v), 'Captions')),
  );
  container.appendChild(secAudio);

  const secGfx = document.createElement('div');
  secGfx.className = 'settings-section';
  secGfx.innerHTML = '<h3>Graphics</h3>';
  const tier = document.createElement('select');
  for (const t of ['auto', 'low', 'medium', 'high']) {
    const o = document.createElement('option');
    o.value = t;
    o.textContent = t[0].toUpperCase() + t.slice(1);
    tier.appendChild(o);
  }
  tier.value = settings.graphics.tier;
  tier.addEventListener('change', () => onChange('graphics.tier', tier.value));
  secGfx.append(row('Quality tier', tier));
  secGfx.append(row('Reduced motion', checkbox(a.reducedMotion, (v) => onChange('accessibility.reducedMotion', v), 'Reduced motion')));

  const swatches = document.createElement('div');
  swatches.className = 'theme-swatches';
  for (const theme of THEMES) {
    const unlocked = ctx.totalStars >= theme.unlockStars;
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'theme-swatch' + (ctx.theme === theme.id ? ' selected' : '') + (unlocked ? '' : ' locked');
    sw.style.background = `linear-gradient(#${theme.sky.top.toString(16).padStart(6, '0')}, #${theme.sky.horizon.toString(16).padStart(6, '0')})`;
    sw.setAttribute('aria-label', theme.name + (unlocked ? '' : ` — locked, needs ${theme.unlockStars} stars`));
    const span = document.createElement('span');
    span.textContent = unlocked ? theme.name : `🔒 ${theme.unlockStars}★`;
    sw.appendChild(span);
    if (unlocked) sw.addEventListener('click', () => onChange('theme', theme.id));
    swatches.appendChild(sw);
  }
  const themeRow = document.createElement('div');
  themeRow.className = 'setting-row';
  const themeLabel = document.createElement('label');
  themeLabel.textContent = 'Theme (cosmetic only)';
  themeRow.append(themeLabel, swatches);
  secGfx.appendChild(themeRow);
  container.appendChild(secGfx);

  const secA11y = document.createElement('div');
  secA11y.className = 'settings-section';
  secA11y.innerHTML = '<h3>Accessibility</h3>';
  const palette = document.createElement('select');
  for (const [value, label] of [
    ['default', 'Default'],
    ['cvd-safe', 'Color-vision safe'],
    ['mono-safe', 'High separation'],
  ]) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    palette.appendChild(o);
  }
  palette.value = a.palette;
  palette.addEventListener('change', () => onChange('accessibility.palette', palette.value));
  secA11y.append(
    row('Color palette', palette),
    row('High contrast', checkbox(a.highContrast, (v) => onChange('accessibility.highContrast', v), 'High contrast')),
    row('Larger text', checkbox(a.largeText, (v) => onChange('accessibility.largeText', v), 'Larger text')),
    row('Left-handed controls', checkbox(a.leftHanded, (v) => onChange('accessibility.leftHanded', v), 'Left-handed')),
    row('Toggle drag (tap to grab camera)', checkbox(a.dragToggle, (v) => onChange('accessibility.dragToggle', v), 'Toggle drag')),
    row('Timing assistance (relaxed clocks, unranked)', checkbox(a.timingAssist, (v) => onChange('accessibility.timingAssist', v), 'Timing assistance')),
    row('Haptics off', checkbox(a.hapticsOff, (v) => onChange('accessibility.hapticsOff', v), 'Haptics off')),
  );
  container.appendChild(secA11y);

  const secCtl = document.createElement('div');
  secCtl.className = 'settings-section';
  secCtl.innerHTML = '<h3>Keyboard controls</h3>';
  for (const b of DEFAULT_BINDINGS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    const current = effectiveKeys(b.action, settings.controls.overrides)[0];
    btn.textContent = current === ' ' ? 'Space' : current;
    btn.setAttribute('aria-label', `Rebind ${b.label}`);
    btn.addEventListener('click', () => {
      btn.textContent = 'press a key…';
      const handler = (ev) => {
        ev.preventDefault();
        window.removeEventListener('keydown', handler, true);
        onChange('rebind', { action: b.action, key: ev.key === ' ' ? 'Space' : ev.key });
      };
      window.addEventListener('keydown', handler, true);
    });
    secCtl.appendChild(row(b.label, btn));
  }
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'btn ghost';
  reset.textContent = 'Reset all bindings';
  reset.addEventListener('click', () => onChange('rebind-reset'));
  secCtl.appendChild(reset);
  container.appendChild(secCtl);

  const secMisc = document.createElement('div');
  secMisc.className = 'settings-section';
  secMisc.innerHTML = '<h3>Gameplay & privacy</h3>';
  const replayTut = document.createElement('button');
  replayTut.type = 'button';
  replayTut.className = 'btn';
  replayTut.textContent = 'Replay lessons';
  replayTut.addEventListener('click', () => {
    onChange('replay-tutorial');
    closeModal(document.getElementById('modal-settings'));
  });
  secMisc.append(
    row('Tutorial', replayTut),
    row('Share anonymous usage stats', checkbox(settings.telemetryConsent, (v) => onChange('telemetryConsent', v), 'Telemetry consent')),
  );
  container.appendChild(secMisc);
}

// ---------- profile ----------

export function buildProfile(container, profile, progression, ctx, onSave) {
  container.textContent = '';
  const p = document.createElement('p');
  p.className = 'muted small';
  p.textContent = ctx.hosted
    ? 'Signed in through the host shell.'
    : 'Guest profile stored on this device. Sign-in becomes available when hosted.';
  container.appendChild(p);

  const nameRow = document.createElement('div');
  nameRow.className = 'setting-row';
  const label = document.createElement('label');
  label.textContent = 'Display name';
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 24;
  input.value = profile.name;
  nameRow.append(label, input);
  container.appendChild(nameRow);

  const stars = Object.values(progression.journeyStars).reduce((x, y) => x + y, 0);
  const stats = document.createElement('p');
  stats.className = 'muted';
  stats.textContent =
    `${stars} journey stars · ${Object.keys(progression.journeyStars).length}/40 stages · ` +
    `${progression.totals.released} cubes released · daily streak ${ctx.dailyStreak}`;
  container.appendChild(stats);

  input.addEventListener('change', () => onSave(input.value.trim() || 'Guest'));
}
