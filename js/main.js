// Bootstrap + game controller.
// State machine: boot → title → profile-ready → mode-select → preparing →
// tutorial/countdown → active ↔ paused → resolving → results → progression.
// Every transition has one owner and an explicit reason. Rules state changes
// only through GameSession commands; rendering consumes snapshots.

import { legalActions, explainRelease, remainingArrows, DIR_NAMES } from './rules/engine.js';
import { generateLevel } from './rules/generator.js';
import { buildEnvelope } from './rules/replay.js';
import { LEVEL_DEFS, PRACTICE_DEFS, dailyDef } from './content/levels.js';
import { LESSONS, lessonById } from './content/tutorials.js';
import { CHALLENGES, challengeLimits } from './content/challenges.js';
import { themeById } from './content/themes.js';
import { evaluateAchievements } from './content/achievements.js';
import { GameSession } from './session/session.js';
import { loadDoc, saveDoc } from './session/persistence.js';
import { platform } from './platform/platform.js';
import { audio } from './audio/audio.js';
import { GameScene } from './render/scene.js';
import { detectTier } from './render/quality.js';
import {
  showScreen, buildModeCards, buildSetup, renderResults, renderScores, renderHelp,
  buildSettings, buildProfile,
} from './ui/screens.js';
import { updateHUD, updateClock, setSelectionInfo, formatMs } from './ui/hud.js';
import {
  announce, toast, applyA11yClasses, paletteAdjust, openModal, closeModal,
  buildBoardList,
} from './ui/a11y.js';
import { matchKey, GAMEPAD_BUTTONS } from './ui/bindings.js';

const BUILD = '1.0.0';
const $ = (id) => document.getElementById(id);

// ---------- persistent documents ----------

const DEFAULT_SETTINGS = {
  audio: { music: 0.55, effects: 0.8, ambience: 0.45, voice: 0.8, muted: false, captions: false },
  graphics: { tier: 'auto' },
  accessibility: {
    reducedMotion: false, highContrast: false, largeText: false, palette: 'default',
    leftHanded: false, dragToggle: false, timingAssist: false, hapticsOff: false,
  },
  controls: { overrides: {} },
  telemetryConsent: false,
};

const DEFAULT_PROGRESSION = {
  journeyStars: {},
  tutorials: {},
  totals: { released: 0, rounds: 0 },
  dailies: {},
  challengeBest: {},
  practiceBest: {},
  levelBest: {},
  theme: 'dawn',
  lastSessionId: null,
};

const DEFAULT_PROFILE = { name: 'Guest', guest: true };

const docs = {
  settings: loadDoc('settings', structuredClone(DEFAULT_SETTINGS)),
  progression: loadDoc('progression', structuredClone(DEFAULT_PROGRESSION)),
  profile: loadDoc('profile', structuredClone(DEFAULT_PROFILE)),
  achievements: loadDoc('achievements', {}),
};

function deepMerge(base, over) {
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && base[k]) {
      out[k] = deepMerge(base[k], over[k]);
    } else {
      out[k] = over[k];
    }
  }
  return out;
}

const settings = deepMerge(structuredClone(DEFAULT_SETTINGS), docs.settings.payload);
const progression = deepMerge(structuredClone(DEFAULT_PROGRESSION), docs.progression.payload);
const profile = deepMerge(structuredClone(DEFAULT_PROFILE), docs.profile.payload);
const achievementsUnlocked = docs.achievements.payload || {};

function saveSettings() {
  docs.settings.rev = saveDoc('settings', settings, docs.settings.rev);
}
function saveProgression() {
  docs.progression.rev = saveDoc('progression', progression, docs.progression.rev);
}
function saveProfile() {
  docs.profile.rev = saveDoc('profile', profile, docs.profile.rev);
}
function saveAchievements() {
  docs.achievements.rev = saveDoc('achievements', achievementsUnlocked, docs.achievements.rev);
}

// ---------- app state machine ----------

const app = {
  state: 'boot',
  owner: 'boot',
  transitions: [],
  mode: null,
  params: null,
  level: null,
  lesson: null,
  tutorialStep: 0,
  session: null,
  scene: null,
  webgl: true,
  accessibleOnly: false,
  levelCache: new Map(),
  selectedCubeId: null,
  hoveredCubeId: null,
  finishing: false,
  hiddenAt: null,
  dragMode: false,
  countdownTimer: null,
  clockTimer: null,
  lastFramePad: 0,
  padPrev: [],
};

// Debug/validation handle for captures and smoke tests (read-only usage).
if (typeof window !== 'undefined') window.__vc = { app, BUILD };

function transition(to, reason, owner = 'ui') {
  const from = app.state;
  app.state = to;
  app.owner = owner;
  app.transitions.push({ from, to, reason, owner, at: Date.now() });
  console.debug(`[state] ${from} → ${to} (${reason}, owner: ${owner})`);
}

// ---------- level loading ----------

function getJourneyLevel(index) {
  const def = LEVEL_DEFS[index];
  if (!app.levelCache.has(def.id)) {
    app.levelCache.set(def.id, generateLevel(def));
  }
  return app.levelCache.get(def.id);
}

function levelSummary(level) {
  const arrows = level.cubes.filter((c) => c.kind === 'arrow').length;
  const bits = [`${arrows} cubes`];
  if (level.mechanics.includes('stone')) bits.push('stones');
  if (level.mechanics.includes('lock')) bits.push('locks');
  if (level.mechanics.includes('core')) bits.push('a core');
  return bits.join(' · ');
}

function totalStars() {
  return Object.values(progression.journeyStars).reduce((a, b) => a + b, 0);
}

function dailyStreak(dailies = progression.dailies) {
  let streak = 0;
  const today = platform.utcDateKey();
  let cursor = new Date(today + 'T00:00:00Z').getTime();
  // Today counts if completed; otherwise start from yesterday.
  if (!dailies[platform.utcDateKey(cursor)]?.completed) cursor -= 86400000;
  while (dailies[platform.utcDateKey(cursor)]?.completed) {
    streak++;
    cursor -= 86400000;
  }
  return streak;
}

function currentTheme() {
  return paletteAdjust(themeById(progression.theme), settings.accessibility.palette);
}

// ---------- mode → round preparation ----------

function resolveTier() {
  return settings.graphics.tier === 'auto' ? detectTier() : settings.graphics.tier;
}

function nextJourneyIndex() {
  for (let i = 0; i < LEVEL_DEFS.length; i++) {
    if (!progression.journeyStars[LEVEL_DEFS[i].id]) return i;
  }
  return LEVEL_DEFS.length - 1;
}

function prepareRound(params) {
  transition('preparing', 'prepare ' + params.mode, 'controller');
  app.params = params;
  app.mode = params.mode;
  app.lesson = null;
  app.tutorialStep = 0;
  app.finishing = false;
  app.selectedCubeId = null;
  app.hoveredCubeId = null;

  let level;
  let sessionOpts = { ranked: false, allowUndo: true, tools: { hint: true, undo: true } };
  let limits = {};

  if (params.mode === 'learn') {
    app.lesson = lessonById(params.lessonId);
    level = app.lesson.board;
  } else if (params.mode === 'journey') {
    level = getJourneyLevel(params.levelIndex);
    sessionOpts = { ranked: false, allowUndo: false, tools: { hint: true, undo: false } };
  } else if (params.mode === 'daily') {
    const dateKey = platform.utcDateKey();
    level = generateLevel(dailyDef(dateKey));
    sessionOpts = { ranked: true, allowUndo: false, tools: { hint: true, undo: false } };
  } else if (params.mode === 'practice') {
    const def = PRACTICE_DEFS[params.difficulty];
    const seed = def.seedSalt + '-' + Date.now().toString(36);
    level = generateLevel({ ...def, seed });
    if (settings.accessibility.timingAssist) {
      // Relaxed clocks: practice has no clock by default, so nothing to relax.
    }
  } else if (params.mode === 'challenge') {
    const challenge = CHALLENGES.find((c) => c.id === params.challengeId);
    level = generateLevel(challenge.def);
    limits = challengeLimits(challenge, level);
    if (settings.accessibility.timingAssist && limits.timeMs) {
      limits.timeMs = Math.round(limits.timeMs * 1.5);
    }
    sessionOpts = { ranked: true, allowUndo: false, tools: { hint: false, undo: false } };
  }

  app.level = level;
  app.session = new GameSession({
    level,
    mode: params.mode,
    seed: level.seed,
    limits,
    ...sessionOpts,
  });
  app.session.onEvents(onSessionEvents);

  const theme = currentTheme();
  if (app.scene) {
    app.scene.buildEnvironment(level.seed, theme);
    app.scene.buildBoard(app.session.state, theme);
  }
  refreshHUD();
  refreshBoardMirror();
  $('tutorial-banner').hidden = params.mode !== 'learn';
  if (params.mode === 'learn') showTutorialStep();
  // Show the board behind the countdown so the player can read the assembly.
  showScreen('game');
  if (app.scene) {
    app.scene.resize(); // playfield was 0-sized while the screen was hidden
    app.scene.start();
  }

  platform.activityStart(params.mode);
  platform.telemetry('start', { mode: params.mode });
  startCountdown(() => activateRound());
}

function startCountdown(done) {
  transition('countdown', 'round prepared', 'controller');
  const el = $('countdown');
  el.hidden = false;
  let n = 3;
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    clearTimeout(app.countdownTimer);
    window.removeEventListener('pointerdown', finish, true);
    window.removeEventListener('keydown', finish, true);
    el.hidden = true;
    done();
  };
  const step = () => {
    if (n <= 0) {
      finish();
      return;
    }
    el.textContent = String(n);
    audio.play('countdown');
    n--;
    app.countdownTimer = setTimeout(step, 420);
  };
  step();
  // Any deliberate input fast-forwards the countdown to the exact same state.
  setTimeout(() => {
    if (settled) return;
    window.addEventListener('pointerdown', finish, true);
    window.addEventListener('keydown', finish, true);
  }, 60);
}

function activateRound() {
  // Restart the authoritative clock at activation (countdown is not play).
  app.session.startStamp = performance.now();
  app.session.pausedAccum = 0;
  transition('active', 'countdown done', 'controller');
  showScreen('game');
  announce(
    `${app.level.name}. ${remainingArrows(app.session.state)} cubes to release. ` +
    `${legalActions(app.session.state).length} paths are currently clear.`,
  );
  if (app.scene) app.scene.start();
  if (app.clockTimer) clearInterval(app.clockTimer);
  app.clockTimer = setInterval(() => {
    if (app.state !== 'active') return;
    app.session.tickClock();
    updateClock(app.session);
  }, 250);
}

// ---------- session event handling ----------

function onSessionEvents(events, state) {
  if (app.scene) app.scene.syncBoard(state, events);
  for (const ev of events) {
    switch (ev.type) {
      case 'release': {
        audio.play('release');
        const left = remainingArrows(state);
        announce(`Cube released. ${left} left.`);
        audio.setMusicIntensity(0.3 + 0.7 * (state.stats.released / (state.stats.released + left || 1)));
        if (!settings.accessibility.hapticsOff && navigator.vibrate) navigator.vibrate(8);
        // The released cube is gone — drop a stale selection so a repeated
        // confirm key never becomes a phantom invalid tap.
        if (app.selectedCubeId === ev.cubeId) selectCube(null);
        if (app.hoveredCubeId === ev.cubeId) app.hoveredCubeId = null;
        break;
      }
      case 'invalid':
        audio.play('invalid');
        toast(ev.message || 'That cube cannot leave yet.');
        break;
      case 'unlock':
        audio.play('unlock');
        toast(`Lock on ${ev.cubeId} opened.`);
        break;
      case 'rotate':
        audio.play('rotate');
        break;
      case 'complete':
        audio.play('complete');
        break;
      case 'failed':
        audio.play('failed');
        break;
      case 'undo':
        announce('Undone.');
        break;
    }
    checkTutorialEvent(ev, state);
  }
  refreshHUD();
  refreshBoardMirror();
  persistSnapshot();
  if (state.status !== 'active' && !app.finishing) {
    app.finishing = true;
    setTimeout(() => finishRound(), state.status === 'complete' ? 1400 : 700);
  }
}

// ---------- tutorial runner ----------

function showTutorialStep() {
  const step = app.lesson.steps[app.tutorialStep];
  if (!step) return;
  $('tutorial-text').textContent = step.text;
  if (step.focus) {
    selectCube(step.focus);
  }
  platform.telemetry('tutorial-step', { step: app.lesson.id + ':' + app.tutorialStep });
}

function checkTutorialEvent(ev, state) {
  if (app.mode !== 'learn' || !app.lesson) return;
  const before = app.tutorialStep;
  const step = app.lesson.steps[before];
  if (!step) return;
  const req = step.require;
  let ok = false;
  if (req.type === 'release' && ev.type === 'release' && (!req.cubeId || ev.cubeId === req.cubeId)) ok = true;
  if (req.type === 'invalid' && ev.type === 'invalid' && (!req.cubeId || ev.cubeId === req.cubeId) && (!req.reason || ev.reason === req.reason)) ok = true;
  if (req.type === 'rotate' && ev.type === 'rotate') ok = true;
  if (req.type === 'complete' && ev.type === 'complete') ok = true;
  if (ok) app.tutorialStep++;
  // Skip steps that the player's own progress made unsatisfiable, so doing
  // actions out of order can never soft-lock a lesson.
  while (app.tutorialStep < app.lesson.steps.length) {
    const r = app.lesson.steps[app.tutorialStep].require;
    let moot = false;
    if (r.type === 'release' || r.type === 'invalid') {
      const cube = state.cubes.find((c) => c.id === r.cubeId);
      if (!cube) moot = true;
      else if (r.type === 'invalid') {
        const ex = explainRelease(state, r.cubeId);
        moot = ex.ok || ex.reason !== r.reason;
      }
    }
    if (!moot) break;
    app.tutorialStep++;
  }
  if (app.tutorialStep !== before && app.tutorialStep < app.lesson.steps.length) {
    setTimeout(showTutorialStep, 250);
  }
}

// ---------- finishing ----------

function previousBest() {
  if (app.mode === 'journey') return progression.levelBest[app.level.id] ?? null;
  if (app.mode === 'challenge') return progression.challengeBest[app.params.challengeId] ?? null;
  if (app.mode === 'practice') return progression.practiceBest[app.params.difficulty] ?? null;
  if (app.mode === 'daily') return progression.dailies[platform.utcDateKey()]?.score ?? null;
  return null;
}

async function finishRound() {
  if (!app.session) return;
  if (app.clockTimer) clearInterval(app.clockTimer);
  const result = app.session.resultEnvelope();
  const state = app.session.state;
  const completed = state.status === 'complete';

  transition('resolving', 'round terminal: ' + result.terminalReason, 'rules');

  // Progression updates.
  progression.totals.rounds++;
  progression.totals.released += state.stats.released;
  progression.lastSessionId = app.session.sessionId;
  let rankInfo = null;
  const prevBest = previousBest();

  if (app.mode === 'learn' && completed) {
    progression.tutorials[app.lesson.id] = true;
  }
  if (app.mode === 'journey') {
    const stars = result.stars;
    if (completed && (progression.journeyStars[app.level.id] || 0) < stars) {
      progression.journeyStars[app.level.id] = stars;
    }
    if (completed && (prevBest == null || result.score > prevBest)) {
      progression.levelBest[app.level.id] = result.score;
    }
  }
  if (app.mode === 'practice' && completed && (prevBest == null || result.score > prevBest)) {
    progression.practiceBest[app.params.difficulty] = result.score;
  }
  if (app.mode === 'challenge' && (prevBest == null || result.score > prevBest)) {
    progression.challengeBest[app.params.challengeId] = result.score;
  }
  if (app.mode === 'daily') {
    const key = platform.utcDateKey();
    const existing = progression.dailies[key];
    if (!existing || result.score > existing.score) {
      progression.dailies[key] = { score: result.score, completed, at: Date.now() };
    } else if (completed && !existing.completed) {
      existing.completed = true;
    }
  }
  saveProgression();

  // Achievements (idempotent).
  const lockLevelsCompleted = LEVEL_DEFS.filter(
    (d) => (d.mechanics || []).includes('lock') && progression.journeyStars[d.id],
  ).length;
  const freshAchievements = evaluateAchievements(
    {
      totals: progression.totals,
      completedLevelIds: new Set(Object.keys(progression.journeyStars)),
      lockLevelsCompleted,
      dailyStreak: dailyStreak(),
      justCompleted: completed,
    },
    achievementsUnlocked,
  );
  for (const ach of freshAchievements) {
    achievementsUnlocked[ach.key] = Date.now();
    audio.play('achievement');
    toast(`Achievement: ${ach.name}`);
  }
  if (freshAchievements.length) saveAchievements();

  // Ranked submission with replay envelope.
  if (app.session.ranked || app.mode === 'journey') {
    const board = boardForCurrent();
    try {
      const envelope = buildEnvelope({ build: BUILD, session: app.session });
      rankInfo = await platform.submitScore({
        board,
        name: profile.name,
        score: result.score,
        completed,
        invalid: result.stats.invalid,
        elapsedMs: result.elapsedMs,
        sessionId: app.session.sessionId,
        ruleset: app.mode,
        contentVersion: app.session.state.levelVersion,
        seed: app.session.state.seed,
        assists: { ...result.assists, timingAssist: !!settings.accessibility.timingAssist },
        durationMs: result.elapsedMs,
        replay: envelope,
      });
    } catch (err) {
      console.warn('score submission failed', err);
    }
  }

  platform.activityEnd();
  platform.telemetry('round-end', { mode: app.mode, outcome: result.terminalReason });
  localStorage.removeItem('vc.snapshot');

  const nextLessonId =
    app.mode === 'learn' && completed
      ? LESSONS[LESSONS.findIndex((l) => l.id === app.lesson.id) + 1]?.id
      : null;
  const nextLabel =
    app.mode === 'journey' && completed && app.params.levelIndex + 1 < LEVEL_DEFS.length
      ? 'Next stage'
      : nextLessonId
        ? 'Next lesson'
        : app.mode === 'practice'
          ? 'Play again'
          : 'Modes';

  renderResults(null, {
    result,
    level: app.level,
    mode: app.mode,
    achievements: freshAchievements,
    rankInfo,
    previousBest: prevBest,
    nextLabel,
  });
  transition('results', 'results shown', 'controller');
  showScreen('results');
  if (app.scene) app.scene.stop(); // nothing visible to render behind results
  announce(
    `${completed ? 'Board cleared' : 'Round over'}. Score ${result.score}, ${result.stars} stars.`,
    true,
  );
}

function boardForCurrent() {
  if (app.mode === 'daily') return 'daily-' + platform.utcDateKey();
  if (app.mode === 'challenge') return 'challenge-' + app.params.challengeId;
  if (app.mode === 'journey') return 'level-' + app.level.id;
  return 'misc';
}

// Local snapshot so a crashed/backgrounded round can be resumed.
let snapshotTimer = 0;
function persistSnapshot() {
  if (!app.session || app.session.finished) return;
  const now = Date.now();
  if (now - snapshotTimer < 1500) return;
  snapshotTimer = now;
  try {
    localStorage.setItem(
      'vc.snapshot',
      JSON.stringify({
        savedAt: now,
        params: app.params,
        tutorialStep: app.tutorialStep,
        session: app.session.snapshot(),
      }),
    );
  } catch { /* storage full — non-fatal */ }
}

// ---------- HUD / mirror ----------

function refreshHUD() {
  if (!app.session) return;
  updateHUD(app.session, app.level, selectionText());
}

function selectionText() {
  const id = app.selectedCubeId || app.hoveredCubeId;
  if (!id || !app.session) return 'Nothing selected.';
  const cube = app.session.state.cubes.find((c) => c.id === id);
  if (!cube) return 'Nothing selected.';
  const ex = explainRelease(app.session.state, id);
  const dir = DIR_NAMES[cube.dir];
  if (ex.ok) return `Cube ${id}, facing ${dir} — path clear.`;
  return `Cube ${id}, facing ${dir} — ${ex.message}`;
}

function refreshBoardMirror() {
  if (!app.session) return;
  const legal = new Set(legalActions(app.session.state).map((a) => a.cubeId));
  buildBoardList($('board-list'), app.session.state, legal, (cubeId) => {
    attemptRelease(cubeId);
  });
}

function selectCube(cubeId) {
  app.selectedCubeId = cubeId;
  if (app.scene?.cubeViews) {
    app.scene.cubeViews.setSelected(cubeId);
    app.scene.cubeViews.showPathFor(app.session.state, cubeId);
  }
  setSelectionInfo(selectionText());
  if (cubeId) {
    const ex = explainRelease(app.session.state, cubeId);
    announce(`Selected cube ${cubeId}. ${ex.ok ? 'Path is clear.' : ex.message}`);
  }
}

function cycleSelection(dirSign) {
  if (!app.session) return;
  const acts = legalActions(app.session.state).map((a) => a.cubeId).sort();
  if (!acts.length) {
    announce('No clear paths right now.');
    return;
  }
  const current = acts.indexOf(app.selectedCubeId);
  const next = current === -1 ? 0 : (current + dirSign + acts.length) % acts.length;
  selectCube(acts[next]);
}

// ---------- input: releasing ----------

function attemptRelease(cubeId) {
  if (app.state !== 'active' || !app.session || app.session.paused) return;
  audio.play('tap');
  app.session.dispatch('release', { cubeId });
}

function doRotate(dirSign) {
  if (!app.scene || (app.state !== 'active' && app.state !== 'countdown')) return;
  app.scene.rig.quarter(dirSign);
  if (app.state === 'active' && app.session && !app.session.paused) {
    app.session.dispatch('rotate');
  }
}

function doUndo() {
  if (app.state !== 'active' || !app.session) return;
  if (app.session.undo()) {
    if (app.scene) app.scene.syncBoard(app.session.state, [{ type: 'undo' }]);
    app.selectedCubeId = null;
    refreshHUD();
    refreshBoardMirror();
    audio.play('ui');
  }
}

function doHint() {
  if (app.state !== 'active' || !app.session) return;
  const hint = app.session.hint();
  if (hint) {
    selectCube(hint.cubeId);
    toast(`Hint: cube ${hint.cubeId} has a clear path.`);
  }
}

// ---------- pause ----------

function pauseGame(reason) {
  if (app.state !== 'active' || !app.session) return;
  app.session.pause();
  transition('paused', reason, 'controller');
  openModal($('modal-pause'));
  $('btn-resume').focus();
  if (app.scene) app.scene.stop();
}

function resumeGame() {
  if (app.state !== 'paused') return;
  closeModal($('modal-pause'));
  app.session.resume();
  transition('active', 'resumed', 'controller');
  if (app.scene) app.scene.start();
}

function leaveRound() {
  closeModal($('modal-pause'));
  if (app.clockTimer) clearInterval(app.clockTimer);
  if (app.session && !app.session.finished) {
    app.session.resume();
    app.session.dispatch('concede');
  } else {
    exitToModes();
  }
}

function exitToModes() {
  if (app.clockTimer) clearInterval(app.clockTimer);
  app.session = null;
  platform.activityEnd();
  openModeSelect();
}

// ---------- screens ----------

function openTitle() {
  transition('title', 'show title', 'controller');
  showScreen('title');
  if (app.scene) app.scene.stop();
  const stars = totalStars();
  const done = Object.keys(progression.journeyStars).length;
  $('title-progress').textContent = done
    ? `${done}/40 journey stages · ${stars} stars · daily streak ${dailyStreak()}`
    : 'A floating sculpture of cubes awaits.';
  const snap = localStorage.getItem('vc.snapshot');
  $('btn-play').textContent = snap ? 'Resume' : 'Play';
}

function openModeSelect() {
  transition('mode-select', 'choose mode', 'controller');
  showScreen('modes');
  if (app.scene) app.scene.stop();
  buildModeCards($('mode-cards'), {
    progression,
    dailyKey: platform.utcDateKey(),
    dailyDone: !!progression.dailies[platform.utcDateKey()]?.completed,
  }, (mode) => {
    if (mode === 'score-chase') {
      openScores();
    } else {
      openSetup(mode);
    }
  });
}

function openSetup(mode) {
  transition('setup', 'setup ' + mode, 'controller');
  showScreen('setup');
  const headings = {
    learn: 'Learn — lessons',
    journey: 'Journey — stages',
    daily: 'Daily challenge',
    practice: 'Practice',
    challenge: 'Challenge',
  };
  $('setup-heading').textContent = headings[mode] || 'Set up';
  const levelMetas = LEVEL_DEFS.map((def, i) => ({
    id: def.id,
    name: def.name,
    chapter: def.chapter,
    summary: levelSummary(getJourneyLevel(i)),
  }));
  const dateKey = platform.utcDateKey();
  const dailyLevel = app.levelCache.get('daily-' + dateKey) || (() => {
    const lvl = generateLevel(dailyDef(dateKey));
    app.levelCache.set('daily-' + dateKey, lvl);
    return lvl;
  })();
  buildSetup($('setup-body'), mode, {
    progression,
    levelMetas,
    dailyMeta: {
      name: dailyLevel.name,
      seedLabel: dateKey,
      summary: levelSummary(dailyLevel),
      par: dailyLevel.par,
      doneToday: progression.dailies[dateKey] || null,
    },
    platformInfo: { hosted: platform.hosted },
  }, (params) => prepareRound(params));
}

function openScores() {
  transition('mode-select', 'scores', 'controller');
  showScreen('scores');
  if (app.scene) app.scene.stop();
  const boards = [
    { id: 'daily-' + platform.utcDateKey(), name: 'Daily — ' + platform.utcDateKey() },
    ...CHALLENGES.map((c) => ({ id: 'challenge-' + c.id, name: c.name })),
  ];
  renderScores($('scores-body'), { platform, boards, progression });
}

function openHelp() {
  showScreen('help');
  renderHelp($('help-body'), settings);
}

function openSettings() {
  buildSettings($('settings-body'), settings, {
    totalStars: totalStars(),
    theme: progression.theme,
  }, onSettingChange);
  openModal($('modal-settings'));
}

function openProfile() {
  buildProfile($('profile-body'), profile, progression, {
    hosted: platform.hosted,
    dailyStreak: dailyStreak(),
  }, (name) => {
    profile.name = name;
    saveProfile();
    toast('Display name saved.');
  });
  openModal($('modal-profile'));
}

function onSettingChange(key, value) {
  const setPath = (obj, path, v) => {
    const parts = path.split('.');
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    o[parts[parts.length - 1]] = v;
  };

  if (key === 'rebind') {
    settings.controls.overrides[value.action] = [value.key];
  } else if (key === 'rebind-reset') {
    settings.controls.overrides = {};
  } else if (key === 'theme') {
    progression.theme = value;
    saveProgression();
    applyThemeNow();
  } else if (key === 'replay-tutorial') {
    saveSettings();
    openSetup('learn');
    return;
  } else if (key === 'telemetryConsent') {
    settings.telemetryConsent = value;
    platform.setTelemetryConsent(value);
  } else {
    setPath(settings, key, value);
  }
  saveSettings();
  applySettingsNow();
  platform.telemetry('settings-change');
  if (key !== 'theme' && key !== 'replay-tutorial') {
    // Rebuild the form so dependent controls (e.g. rebinding labels) refresh.
    buildSettings($('settings-body'), settings, { totalStars: totalStars(), theme: progression.theme }, onSettingChange);
  }
}

function applySettingsNow() {
  applyA11yClasses(settings);
  audio.applySettings(settings);
  audio.onCaption = settings.audio.captions ? (text) => toast('♪ ' + text, { ms: 1200 }) : null;
  if (app.scene) {
    app.scene.applyQuality(resolveTier());
    app.scene.setReducedMotion(settings.accessibility.reducedMotion);
    applyThemeNow();
  }
}

function applyThemeNow() {
  if (!app.scene) return;
  const theme = currentTheme();
  app.scene.buildEnvironment(app.level ? app.level.seed : 'title', theme);
  app.scene.cubeViews?.applyTheme(theme);
  document.documentElement.style.setProperty('--accent', theme.ui.accent);
}

// ---------- canvas pointer input ----------

const pointer = {
  down: false,
  id: null,
  startX: 0,
  startY: 0,
  lastX: 0,
  lastY: 0,
  dragging: false,
  downAt: 0,
};

const TAP_MAX_DIST = 9; // CSS px
const TAP_MAX_MS = 450;

function wireCanvasInput(canvas) {
  canvas.addEventListener('pointerdown', (ev) => {
    if (app.state !== 'active') return;
    pointer.down = true;
    pointer.id = ev.pointerId;
    pointer.startX = pointer.lastX = ev.clientX;
    pointer.startY = pointer.lastY = ev.clientY;
    pointer.dragging = false;
    pointer.downAt = performance.now();
    try {
      canvas.setPointerCapture(ev.pointerId);
    } catch { /* capture unsupported — drag degrades to hover-only */ }
  });

  canvas.addEventListener('pointermove', (ev) => {
    if (app.state !== 'active') return;
    if (pointer.down && ev.pointerId === pointer.id) {
      const totalDist = Math.hypot(ev.clientX - pointer.startX, ev.clientY - pointer.startY);
      if (totalDist > TAP_MAX_DIST) pointer.dragging = true;
      if (pointer.dragging && app.scene) {
        const dx = ev.clientX - pointer.lastX;
        const dy = ev.clientY - pointer.lastY;
        app.scene.rig.rotate(-dx * 0.0062, dy * 0.0062);
      }
      pointer.lastX = ev.clientX;
      pointer.lastY = ev.clientY;
    } else if (app.dragMode && app.scene) {
      app.scene.rig.rotate(-ev.movementX * 0.0062, ev.movementY * 0.0062);
    } else {
      updateHover(ev.clientX, ev.clientY);
    }
  });

  const endPointer = (ev, cancelled) => {
    if (!pointer.down || ev.pointerId !== pointer.id) return;
    pointer.down = false;
    pointer.id = null;
    if (cancelled) {
      pointer.dragging = false;
      return; // cancel safely on lost capture — never commit
    }
    const wasDrag = pointer.dragging;
    pointer.dragging = false;
    const quick = performance.now() - pointer.downAt < TAP_MAX_MS;
    if (wasDrag) {
      if (app.scene?.rig.consumeRotationCredit() && app.session && !app.session.paused) {
        app.session.dispatch('rotate');
      }
      return;
    }
    if (!quick) return;
    handleTap(ev.clientX, ev.clientY);
  };

  canvas.addEventListener('pointerup', (ev) => endPointer(ev, false));
  canvas.addEventListener('pointercancel', (ev) => endPointer(ev, true));
  canvas.addEventListener('lostpointercapture', (ev) => endPointer(ev, true));
}

function handleTap(x, y) {
  if (app.state !== 'active' || !app.session) return;
  if (!app.scene) return;
  const cubeId = app.scene.pick(x, y);
  if (cubeId) {
    if (app.dragMode) {
      app.dragMode = false;
      return;
    }
    selectCube(cubeId);
    attemptRelease(cubeId);
  } else {
    if (settings.accessibility.dragToggle) {
      app.dragMode = !app.dragMode;
      toast(app.dragMode ? 'Camera grab on — move to rotate, tap to release.' : 'Camera grab off.');
    } else {
      selectCube(null);
    }
  }
}

let hoverPending = false;
function updateHover(x, y) {
  if (!app.scene || hoverPending) return;
  hoverPending = true;
  requestAnimationFrame(() => {
    hoverPending = false;
    if (app.state !== 'active' || !app.session) return;
    const cubeId = app.scene.pick(x, y);
    if (cubeId === app.hoveredCubeId) return;
    app.hoveredCubeId = cubeId;
    app.scene.cubeViews?.setHover(cubeId);
    if (cubeId && !app.selectedCubeId) {
      app.scene.cubeViews?.showPathFor(app.session.state, cubeId);
    }
    setSelectionInfo(selectionText());
    document.getElementById('gl').style.cursor = cubeId ? 'pointer' : 'default';
  });
}

// ---------- keyboard ----------

function onKeyDown(ev) {
  const overrides = settings.controls.overrides;
  const openModals = [...document.querySelectorAll('.modal:not([hidden])')];
  const topModal = openModals.length ? openModals[openModals.length - 1] : null;

  if (topModal) {
    if (matchKey(ev, 'cancel', overrides)) {
      const id = topModal.id;
      if (id === 'modal-pause') resumeGame();
      else closeModal(topModal);
      ev.preventDefault();
    }
    return;
  }

  if (app.state === 'active') {
    if (matchKey(ev, 'pause', overrides) || ev.key === 'Escape') {
      pauseGame('user');
      ev.preventDefault();
      return;
    }
    if (matchKey(ev, 'navNext', overrides)) {
      cycleSelection(1);
      ev.preventDefault();
    } else if (matchKey(ev, 'navPrev', overrides)) {
      cycleSelection(-1);
      ev.preventDefault();
    } else if (matchKey(ev, 'confirm', overrides)) {
      if (app.selectedCubeId) attemptRelease(app.selectedCubeId);
      else cycleSelection(1);
      ev.preventDefault();
    } else if (matchKey(ev, 'rotateLeft', overrides)) {
      doRotate(1);
      ev.preventDefault();
    } else if (matchKey(ev, 'rotateRight', overrides)) {
      doRotate(-1);
      ev.preventDefault();
    } else if (matchKey(ev, 'undo', overrides)) {
      doUndo();
      ev.preventDefault();
    } else if (matchKey(ev, 'hint', overrides)) {
      doHint();
      ev.preventDefault();
    } else if (matchKey(ev, 'camReset', overrides)) {
      app.scene?.rig.reset();
      ev.preventDefault();
    }
    return;
  }

  if (app.state === 'results' && ev.key === 'Enter') {
    $('btn-next').click();
  }
}

// ---------- gamepad ----------

function pollGamepad() {
  if (app.state !== 'active' || !navigator.getGamepads) return;
  const pads = navigator.getGamepads();
  const pad = [...pads].find((p) => p && p.connected);
  if (!pad) return;
  const pressed = (i) => pad.buttons[i]?.pressed;
  const edge = (i) => {
    const now = !!pressed(i);
    const was = !!app.padPrev[i];
    app.padPrev[i] = now;
    return now && !was;
  };
  const B = GAMEPAD_BUTTONS;
  if (edge(B.pause)) pauseGame('gamepad');
  if (edge(B.confirm)) {
    if (app.selectedCubeId) attemptRelease(app.selectedCubeId);
    else cycleSelection(1);
  }
  if (edge(B.cancel)) selectCube(null);
  if (edge(B.navNext)) cycleSelection(1);
  if (edge(B.navPrev)) cycleSelection(-1);
  if (edge(B.rotateLeft)) doRotate(1);
  if (edge(B.rotateRight)) doRotate(-1);
  if (edge(B.undo)) doUndo();
  if (edge(B.hint)) doHint();
  if (edge(B.camReset)) app.scene?.rig.reset();
  const ax = pad.axes[0] || 0;
  const ay = pad.axes[1] || 0;
  if (Math.abs(ax) > 0.25 || Math.abs(ay) > 0.25) {
    app.scene?.rig.rotate(-ax * 0.03, ay * 0.03);
    if (app.scene?.rig.consumeRotationCredit() && app.session && !app.session.paused) {
      app.session.dispatch('rotate');
    }
  }
}

// ---------- buttons ----------

function wireButtons() {
  $('btn-play').addEventListener('click', () => {
    audio.play('ui');
    const snap = localStorage.getItem('vc.snapshot');
    if (snap && $('btn-play').textContent === 'Resume') {
      resumeSnapshot(snap);
      return;
    }
    prepareRound({ mode: 'journey', levelIndex: nextJourneyIndex() });
  });
  $('btn-daily').addEventListener('click', () => openSetup('daily'));
  $('btn-journey').addEventListener('click', () => openSetup('journey'));
  $('btn-scores').addEventListener('click', () => openScores());
  $('btn-modes').addEventListener('click', openModeSelect);
  $('btn-help').addEventListener('click', openHelp);
  $('btn-settings').addEventListener('click', openSettings);
  $('btn-profile').addEventListener('click', openProfile);

  document.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-nav');
      if (target === 'title') openTitle();
      else if (target === 'modes') openModeSelect();
    });
  });

  $('btn-pause').addEventListener('click', () => pauseGame('user'));
  $('tray-pause').addEventListener('click', () => pauseGame('user'));
  $('btn-resume').addEventListener('click', resumeGame);
  $('btn-pause-settings').addEventListener('click', openSettings);
  $('btn-pause-help').addEventListener('click', () => {
    closeModal($('modal-pause'));
    openHelp();
  });
  $('btn-restart-round').addEventListener('click', () => {
    closeModal($('modal-pause'));
    platform.telemetry('retry');
    prepareRound(app.params);
  });
  $('btn-leave-round').addEventListener('click', leaveRound);
  $('btn-settings-close').addEventListener('click', () => closeModal($('modal-settings')));
  $('btn-profile-close').addEventListener('click', () => closeModal($('modal-profile')));
  $('btn-board-close').addEventListener('click', () => closeModal($('modal-board')));

  for (const id of ['btn-undo', 'tray-undo']) $(id).addEventListener('click', doUndo);
  for (const id of ['btn-hint', 'tray-hint']) $(id).addEventListener('click', doHint);
  for (const [id, sign] of [['btn-rot-left', 1], ['tray-rot-left', 1], ['btn-rot-right', -1], ['tray-rot-right', -1]]) {
    $(id).addEventListener('click', () => doRotate(sign));
  }
  $('btn-cam-reset').addEventListener('click', () => app.scene?.rig.reset());
  $('btn-board-list').addEventListener('click', () => {
    refreshBoardMirror();
    openModal($('modal-board'));
  });

  $('btn-drawer-left').addEventListener('click', () => {
    $('rail-left').classList.toggle('open');
    $('rail-right').classList.remove('open');
  });
  $('btn-drawer-right').addEventListener('click', () => {
    $('rail-right').classList.toggle('open');
    $('rail-left').classList.remove('open');
  });

  $('btn-retry').addEventListener('click', () => {
    platform.telemetry('retry');
    prepareRound(app.params);
  });
  $('btn-next').addEventListener('click', () => {
    if (app.mode === 'journey' && app.session?.state.status === 'complete' && app.params.levelIndex + 1 < LEVEL_DEFS.length) {
      prepareRound({ mode: 'journey', levelIndex: app.params.levelIndex + 1 });
    } else if (app.mode === 'learn' && app.session?.state.status === 'complete') {
      const next = LESSONS[LESSONS.findIndex((l) => l.id === app.lesson.id) + 1];
      if (next) prepareRound({ mode: 'learn', lessonId: next.id });
      else openSetup('learn');
    } else if (app.mode === 'practice') {
      prepareRound(app.params);
    } else {
      openModeSelect();
    }
  });
  $('btn-results-exit').addEventListener('click', openModeSelect);

  $('btn-accessible-mode').addEventListener('click', () => {
    app.accessibleOnly = true;
    $('canvas-fallback').hidden = true;
    refreshBoardMirror();
    openModal($('modal-board'));
  });
}

function resumeSnapshot(snapJson) {
  try {
    const data = JSON.parse(snapJson);
    const session = GameSession.restore(data.session);
    app.params = data.params;
    app.mode = data.params.mode;
    app.lesson = data.params.lessonId ? lessonById(data.params.lessonId) : null;
    app.tutorialStep = data.tutorialStep || 0;
    app.level = session.level;
    app.session = session;
    app.session.onEvents(onSessionEvents);
    app.finishing = false;
    app.selectedCubeId = null;
    app.hoveredCubeId = null;
    const theme = currentTheme();
    if (app.scene) {
      app.scene.buildEnvironment(app.level.seed, theme);
      app.scene.buildBoard(session.state, theme);
    }
    refreshHUD();
    refreshBoardMirror();
    $('tutorial-banner').hidden = app.mode !== 'learn';
    if (app.mode === 'learn' && app.lesson) showTutorialStep();
    transition('active', 'snapshot resumed', 'controller');
    showScreen('game');
    if (app.scene) {
      app.scene.resize();
      app.scene.start();
    }
    toast('Round resumed from your last safe snapshot.');
    app.clockTimer = setInterval(() => {
      if (app.state !== 'active') return;
      app.session.tickClock();
      updateClock(app.session);
    }, 250);
  } catch (err) {
    console.warn('snapshot restore failed', err);
    localStorage.removeItem('vc.snapshot');
    prepareRound({ mode: 'journey', levelIndex: nextJourneyIndex() });
  }
}

// ---------- lifecycle ----------

function wireLifecycle() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      app.hiddenAt = Date.now();
      if (app.state === 'active') pauseGame('background');
      app.scene?.stop();
      audio.suspend();
    } else {
      audio.resume();
      if (app.hiddenAt) {
        const away = Date.now() - app.hiddenAt;
        app.hiddenAt = null;
        if (app.state === 'paused' && away > 5000) {
          toast(`Paused while you were away (${formatMs(away)}).`);
        }
      }
    }
  });

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => app.scene?.resize(), 120);
  });
  window.addEventListener('orientationchange', () => {
    setTimeout(() => app.scene?.resize(), 250);
  });

  const canvas = $('gl');
  canvas.addEventListener('webglcontextlost', (ev) => {
    ev.preventDefault();
    console.warn('WebGL context lost');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    // Rebuild GPU resources from retained CPU descriptors.
    if (app.session && app.scene) {
      const theme = currentTheme();
      app.scene.buildEnvironment(app.level.seed, theme);
      app.scene.buildBoard(app.session.state, theme);
      app.scene.resize();
    }
  });

  window.addEventListener('error', (ev) => {
    platform.telemetry('error', { category: 'uncaught' });
    console.error(ev.error);
  });
}

// Frame hook for gamepad polling + presence heartbeat.
function frameHook() {
  pollGamepad();
  if (app.state === 'active') platform.heartbeat();
  requestAnimationFrame(frameHook);
}

// ---------- boot ----------

async function boot() {
  transition('boot', 'start', 'boot');
  applyA11yClasses(settings);

  // Capability detection.
  let gl = null;
  try {
    const probe = document.createElement('canvas');
    gl = probe.getContext('webgl2') || probe.getContext('webgl');
  } catch { gl = null; }
  app.webgl = !!gl;

  await platform.init();
  $('net-status').textContent = platform.hosted ? 'online' : 'local play';
  platform.setTelemetryConsent(settings.telemetryConsent);

  // Audio unlocks on the first deliberate gesture.
  const unlockAudio = () => {
    audio.ensure();
    audio.applySettings(settings);
    audio.onCaption = settings.audio.captions ? (text) => toast('♪ ' + text, { ms: 1200 }) : null;
    audio.resume();
    audio.startMusic('title');
    audio.startAmbience();
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
  };
  window.addEventListener('pointerdown', unlockAudio);
  window.addEventListener('keydown', unlockAudio);

  if (app.webgl) {
    try {
      app.scene = new GameScene($('gl'), {
        graphics: { tier: resolveTier() },
        accessibility: settings.accessibility,
      });
      app.scene.applyQuality(resolveTier());
      const theme = currentTheme();
      app.scene.buildEnvironment('title', theme);
      document.documentElement.style.setProperty('--accent', theme.ui.accent);
      wireCanvasInput($('gl'));
    } catch (err) {
      console.error('renderer init failed', err);
      app.webgl = false;
    }
  }
  if (!app.webgl) {
    $('canvas-fallback').hidden = false;
    toast('WebGL unavailable — accessible mode is available from the game screen.', { ms: 5000 });
  }

  wireButtons();
  wireLifecycle();
  window.addEventListener('keydown', onKeyDown);
  requestAnimationFrame(frameHook);

  // Pre-generate journey levels so stage cards open instantly.
  setTimeout(() => {
    for (let i = 0; i < LEVEL_DEFS.length; i++) {
      try {
        getJourneyLevel(i);
      } catch (err) {
        console.error('level generation failed for', LEVEL_DEFS[i].id, err);
      }
    }
  }, 50);

  transition('profile-ready', 'profile loaded (guest)', 'boot');
  openTitle();
}

boot();
