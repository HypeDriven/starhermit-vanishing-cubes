// Vanishing Cubes on the StarHermit engine: the entry module (starhermit.txt
// engine.entry), played natively by the StarHermit client and in browsers by
// the engine's web runtime. The rules, generator, content and session are the
// browser build's js/ modules, unchanged; this module is what js/main.js did
// around them — the state machine (title → modes → setup → preparing →
// countdown → active ⇄ paused → resolving → results), every mode (Learn,
// Journey, Daily, Practice, Challenge, Score chase), the 3-2-1 countdown (any
// press skips it), the authoritative clock on the runtime's fixed steps (the
// 250 ms tick for timed rounds), selection and release by pointer, finger,
// keys and pads, camera drags that count as rotations, quarter turns, undo,
// hints, the lesson steps, results with stars, achievements, personal records
// and the score post, the resumable round snapshot, and the lifecycle (a
// hidden window pauses the round). Screens are drawn by screens.ts
// (starhermit:ui), the sculpture by render.ts (starhermit:scene).
import { frame, onFixedUpdate, onPreferencesChange, onRender, onResume, onStart, onSuspend, onUpdate, preferences, setFixedRate, clipboard } from "starhermit:engine";
import { onAction, onPointerButton, onPointerMove, onTouch, value, vibrate } from "starhermit:input";
import * as ui from "starhermit:ui";
import { onSessionEnded, requestSignIn } from "starhermit:platform";
import {
  CHALLENGES, Engine, LESSONS, LEVEL_DEFS, PRACTICE_DEFS, SessionClass, challengeLevel, challengeLimits, dailyDef, evaluateAchievements,
  journeyLevel, themeById, type Lesson, type Level, type ResultEnvelope, type RulesEvent, type Session, type State, type Theme,
} from "./game.ts";
import * as audio from "./audio.ts";
import * as gen from "./gen.ts";
import { S, T, dirName, hasKey, lessonStep, levelName, refusalText, tn } from "./i18n.ts";
import * as platform from "./platform.ts";
import { lookFor } from "./quality.ts";
import * as render from "./render.ts";
import { drawScreens } from "./screens.ts";
import { applyTokens, initStyles } from "./style.ts";

export type Screen = "title" | "modes" | "setup" | "scores" | "help" | "results" | null;
export type Modal = "pause" | "settings" | "profile" | "board" | null;
export type Phase = "menu" | "preparing" | "countdown" | "active" | "paused" | "resolving" | "results";
export interface Params { mode: string; levelIndex?: number; lessonId?: string; difficulty?: string; challengeId?: string }
export interface Results {
  result: ResultEnvelope; level: Level; mode: string; achievements: { key: string; name: string; desc: string }[];
  rank: number | null; previousBest: number | null; nextLabel: string; lb: { key: string; vars?: Record<string, number> } | null;
}

const STEP_RATE = 60;
const STEP_MS = 1000 / STEP_RATE;
export const app = {
  phase: "menu" as Phase,
  screen: "title" as Screen,
  modal: null as Modal,
  modalReturn: null as Modal,
  openedFrame: 0,
  focusNext: null as string | null,
  setupMode: "journey",
  helpReturn: null as Screen | "pause" | null,
  params: null as Params | null,
  level: null as Level | null,
  lesson: null as Lesson | null,
  tutorialStep: 0,
  session: null as Session | null,
  selected: null as string | null,
  hovered: null as string | null,
  countdown: 0,
  results: null as Results | null,
  toasts: [] as { text: string; until: number }[],
  railOpen: null as "left" | "right" | null,
  grab: false,
  scoresFriends: false,
  board: null as { loading: boolean; entries: platform.Entry[] | null } | null,
  preparingSince: 0,
};
export const fresh = (): boolean => frame().frame !== app.openedFrame;
const now = (): number => frame().time;
export const settings = (): typeof platform.doc.settings => platform.doc.settings;
export const progression = (): typeof platform.doc.progression => platform.doc.progression;

// ------------------------------------------------------------------ helpers
const spoken: string[] = [];
/** ui.announce (the old live regions): one announcement a frame, joined. */
export function announce(text: string): void { if (text) spoken.push(text); }
function flushAnnouncements(): void {
  if (!spoken.length) return;
  const text = spoken.splice(0).join(" ").slice(0, 500);
  try { ui.announce(text); } catch { /* busy */ }
}
/** a11y.js toast: 2.6 s (captions 1.2 s). */
export function toast(text: string, ms = 2600, sound = true): void {
  if (sound) audio.play("toast");
  app.toasts.push({ text, until: now() + ms / 1000 });
  if (app.toasts.length > 3) app.toasts.shift();
  announce(text);
}
const pending: (() => void)[] = [];
/** A widget's press, run once the frame's UI is built. */
export function later(fn: () => void): void { pending.push(fn); }
export function openScreen(s: Screen, focus: string | null = null): void {
  app.screen = s;
  app.openedFrame = frame().frame;
  app.focusNext = focus;
  ui.setFocus(null);
}
export function openModal(m: Modal, focus: string | null = null): void {
  if (m) audio.play("modal-open");
  else audio.play("panel-close");
  app.modal = m;
  app.openedFrame = frame().frame;
  app.focusNext = focus;
  ui.setFocus(null);
}
export function closeModal(): void {
  const back = app.modalReturn;
  app.modalReturn = null;
  openModal(back, back === "pause" ? "btn-resume" : null);
}

// ------------------------------------------------------------------ progress helpers
export const totalStars = (): number => Object.values(progression().journeyStars).reduce((a, b) => a + b, 0);
export function dailyStreak(): number {
  const d = progression().dailies;
  let streak = 0;
  let cursor = new Date(platform.utcDateKey() + "T00:00:00Z").getTime();
  if (!d[platform.utcDateKey(cursor)]?.completed) cursor -= 86400000;
  while (d[platform.utcDateKey(cursor)]?.completed) { streak++; cursor -= 86400000; }
  return streak;
}
const CVD_SAFE = { select: 0x56b4e9, hover: 0xbfe3ff, path: 0x0072b2, core: 0xe69f00, invalid: 0xd55e00 };
/** a11y.js paletteAdjust. */
export function currentTheme(): Theme {
  const t = themeById(progression().theme);
  if (settings().palette === "default") return t;
  const out = JSON.parse(JSON.stringify(t)) as Theme;
  Object.assign(out.cube, CVD_SAFE);
  return out;
}
export function nextJourneyIndex(): number {
  for (let i = 0; i < LEVEL_DEFS.length; i++) if (!progression().journeyStars[LEVEL_DEFS[i]!.id]) return i;
  return LEVEL_DEFS.length - 1;
}
export function levelSummary(level: Level): string {
  const bits = [T("sumCubes", { n: level.cubes.filter((c) => c.kind === "arrow").length })];
  if (level.mechanics.includes("stone")) bits.push(T("sumStones"));
  if (level.mechanics.includes("lock")) bits.push(T("sumLocks"));
  if (level.mechanics.includes("core")) bits.push(T("sumCore"));
  return bits.join(" · ");
}
let dailyCache: { key: string; level: Level | null; asked: boolean } = { key: "", level: null, asked: false };
/** Today's Daily board (generated on the worker the first time; null until ready). */
export function dailyLevel(): Level | null {
  const key = platform.utcDateKey();
  if (dailyCache.key !== key) dailyCache = { key, level: null, asked: false };
  if (!dailyCache.level && !dailyCache.asked && !gen.busy()) {
    dailyCache.asked = true;
    const c = dailyCache;
    gen.request(dailyDef(key), (l) => { c.level = l; c.asked = !!l; });
  }
  return dailyCache.level;
}

// ------------------------------------------------------------------ navigation
export function goTitle(): void {
  app.phase = "menu";
  app.session = null;
  app.modal = null;
  app.results = null;
  render.clearBoard();
  audio.play("menu-open");
  openScreen("title", "btn-play");
}
export function openModes(): void { app.phase = "menu"; app.session = null; render.clearBoard(); openScreen("modes"); }
export function openSetup(mode: string): void { app.phase = "menu"; app.setupMode = mode; openScreen("setup"); }
export function openScores(): void {
  app.phase = "menu";
  openScreen("scores");
  loadBoard();
}
export function loadBoard(): void {
  if (!platform.signedIn()) { app.board = null; return; }
  const view = { loading: true, entries: null as platform.Entry[] | null };
  app.board = view;
  void platform.fetchBoard(app.scoresFriends).then((e) => { view.loading = false; view.entries = e; });
}
/** The top bar's Help: a full screen; a running round pauses first. */
export function openHelp(): void {
  if (app.phase === "active") pauseGame("overlay");
  app.helpReturn = app.phase === "paused" ? "pause" : app.screen;
  app.modal = null;
  openScreen("help");
}
export function helpBack(): void {
  const r = app.helpReturn;
  app.helpReturn = null;
  if (r === "pause") { app.screen = null; openModal("pause", "btn-resume"); return; }
  openScreen(r && r !== "help" ? r : "title");
}
export function openSettings(): void {
  if (app.phase === "active") pauseGame("overlay");
  app.modalReturn = app.modal === "pause" || app.phase === "paused" ? "pause" : null;
  openModal("settings");
}
export function openProfile(): void {
  if (app.phase === "active") pauseGame("overlay");
  app.modalReturn = app.phase === "paused" ? "pause" : null;
  openModal("profile");
}
export function openBoardList(): void { if (app.phase === "active" || app.phase === "countdown") openModal("board"); }

// ------------------------------------------------------------------ rounds (main.js prepareRound)
let clockMs = 0;
let countdownIn = 0;
let tickIn = 0;
let warnedTime = false;
let finishIn = 0;
let snapshotIn = 0;
export function playButton(): void {
  audio.play("ui");
  if (platform.doc.snapshot) { resumeSnapshot(platform.doc.snapshot); return; }
  prepareRound({ mode: "journey", levelIndex: nextJourneyIndex() });
}
export function prepareRound(params: Params): void {
  app.params = params;
  app.lesson = null;
  gen.cancel();
  if (params.mode === "learn") { app.lesson = LESSONS.find((l) => l.id === params.lessonId) ?? LESSONS[0]!; startRound(params, app.lesson.board); return; }
  if (params.mode === "journey") { startRound(params, journeyLevel(params.levelIndex ?? 0)); return; }
  if (params.mode === "challenge") { const c = CHALLENGES.find((x) => x.id === params.challengeId) ?? CHALLENGES[0]!; startRound(params, challengeLevel(c)); return; }
  if (params.mode === "daily") {
    const d = dailyLevel();
    if (d) { startRound(params, d); return; }
  }
  // practice (a fresh seed each time) and a Daily not generated yet: on the worker
  const def = params.mode === "daily" ? dailyDef(platform.utcDateKey())
    : { ...PRACTICE_DEFS[params.difficulty ?? "easy"]!, seed: PRACTICE_DEFS[params.difficulty ?? "easy"]!.seedSalt + "-" + Date.now().toString(36) };
  app.phase = "preparing";
  app.preparingSince = now();
  app.modal = null;
  gen.request(def, (level) => {
    if (app.phase !== "preparing" || app.params !== params) return;
    if (!level) { toast(T("rsnDefault")); goTitle(); return; }
    if (params.mode === "daily") dailyCache = { key: platform.utcDateKey(), level, asked: true };
    startRound(params, level);
  });
}
export const preparingVisible = (): boolean => app.phase === "preparing" && now() - app.preparingSince > 0.3;
function sessionOptions(mode: string): Record<string, unknown> {
  if (mode === "journey") return { ranked: false, allowUndo: false, tools: { hint: true, undo: false } };
  if (mode === "daily") return { ranked: true, allowUndo: false, tools: { hint: true, undo: false } };
  if (mode === "challenge") return { ranked: true, allowUndo: false, tools: { hint: false, undo: false } };
  return { ranked: false, allowUndo: true, tools: { hint: true, undo: true } };
}
function startRound(params: Params, level: Level): void {
  let limits: { moves?: number; timeMs?: number } = {};
  if (params.mode === "challenge") {
    const c = CHALLENGES.find((x) => x.id === params.challengeId)!;
    limits = challengeLimits(c, level);
    if (settings().timingAssist && limits.timeMs) limits.timeMs = Math.round(limits.timeMs * 1.5);
  }
  app.level = level;
  app.tutorialStep = 0;
  app.selected = null;
  app.hovered = null;
  app.results = null;
  app.railOpen = null;
  warnedTime = false;
  finishIn = 0;
  clockMs = 0;
  app.session = new SessionClass({ level, mode: params.mode, seed: level.seed, limits, ...sessionOptions(params.mode), now: () => clockMs });
  app.session.onEvents(onSessionEvents);
  enterBoard();
  if (params.mode === "learn") showTutorialStep();
  // main.js startCountdown: 3, 2, 1 at 420 ms
  app.phase = "countdown";
  app.countdown = 3;
  countdownIn = Math.round(0.42 * STEP_RATE);
  audio.play("countdown");
}
function enterBoard(): void {
  const t = currentTheme();
  render.buildEnvironment(String(app.level!.seed), t);
  render.buildBoard(app.session!.state, t);
  render.resetCamera();
  app.screen = null;
  app.modal = null;
  app.openedFrame = frame().frame;
  ui.setFocus(null);
}
export function skipCountdown(): void { if (app.phase === "countdown") activateRound(); }
function activateRound(): void {
  const s = app.session!;
  s.startStamp = clockMs;
  s.pausedAccum = 0;
  app.phase = "active";
  tickIn = 15;
  snapshotIn = 300;
  audio.play("round-start");
  announce(T("announceStart", { name: levelName(app.level), n: Engine.remainingArrows(s.state), m: Engine.legalActions(s.state).length }));
}

// ------------------------------------------------------------------ session events (main.js onSessionEvents)
function onSessionEvents(events: RulesEvent[], state: State): void {
  render.syncBoard(state, events);
  for (const ev of events) {
    switch (ev.type) {
      case "release": {
        audio.play("release");
        const left = Engine.remainingArrows(state);
        const movesLeft = state.limits.moves == null ? null : state.limits.moves - state.stats.taps;
        if (movesLeft === 3) audio.play("move-limit");
        announce(T("announceReleased", { n: left }));
        audio.setIntensity(0.3 + 0.7 * (state.stats.released / (state.stats.released + left || 1)));
        try { vibrate(8); } catch { /* none */ }
        if (app.selected === ev.cubeId) selectCube(null);
        if (app.hovered === ev.cubeId) app.hovered = null;
        break;
      }
      case "invalid": audio.play("invalid"); toast(refusalText({ ok: false, ...ev }) || T("cannotLeave")); break;
      case "unlock": audio.play("unlock"); toast(T("lockOpened", { id: ev.cubeId ?? "" })); break;
      case "rotate": audio.play("rotate"); break;
      case "complete": audio.play("complete"); break;
      case "failed": audio.play("failed"); break;
      case "undo": announce(T("undone")); break;
    }
    checkTutorialEvent(ev, state);
  }
  if (state.status !== "active" && !finishIn && app.phase !== "resolving") {
    app.phase = "resolving";
    finishIn = Math.round((state.status === "complete" ? 1.4 : 0.7) * STEP_RATE);
  }
}

// ------------------------------------------------------------------ lessons
function showTutorialStep(): void {
  const step = app.lesson?.steps[app.tutorialStep];
  if (!step) return;
  if (step.focus) selectCube(step.focus);
  announce(tutorialText() ?? "");
}
export function tutorialText(): string | null {
  const l = app.lesson;
  const step = l?.steps[app.tutorialStep];
  return l && step ? lessonStep(l.id, app.tutorialStep, step.text) : null;
}
let tutorialIn = 0;
function checkTutorialEvent(ev: RulesEvent, state: State): void {
  const l = app.lesson;
  if (app.params?.mode !== "learn" || !l) return;
  const before = app.tutorialStep;
  const step = l.steps[before];
  if (!step) return;
  const req = step.require;
  let ok = false;
  if (req.type === "release" && ev.type === "release" && (!req.cubeId || ev.cubeId === req.cubeId)) ok = true;
  if (req.type === "invalid" && ev.type === "invalid" && (!req.cubeId || ev.cubeId === req.cubeId) && (!req.reason || ev.reason === req.reason)) ok = true;
  if (req.type === "rotate" && ev.type === "rotate") ok = true;
  if (req.type === "complete" && ev.type === "complete") ok = true;
  if (ok) app.tutorialStep++;
  while (app.tutorialStep < l.steps.length) {
    const r = l.steps[app.tutorialStep]!.require;
    let moot = false;
    if (r.type === "release" || r.type === "invalid") {
      const cube = state.cubes.find((c) => c.id === r.cubeId);
      if (!cube) moot = true;
      else if (r.type === "invalid") { const ex = Engine.explainRelease(state, r.cubeId!); moot = ex.ok || ex.reason !== r.reason; }
    }
    if (!moot) break;
    app.tutorialStep++;
  }
  if (app.tutorialStep !== before && app.tutorialStep < l.steps.length) {
    audio.play("tutorial-done");
    tutorialIn = Math.round(0.25 * STEP_RATE);
  }
}

// ------------------------------------------------------------------ results (main.js finishRound)
function previousBest(): number | null {
  const p = progression(), m = app.params!.mode;
  if (m === "journey") return p.levelBest[app.level!.id] ?? null;
  if (m === "challenge") return p.challengeBest[app.params!.challengeId!] ?? null;
  if (m === "practice") return p.practiceBest[app.params!.difficulty!] ?? null;
  if (m === "daily") return p.dailies[platform.utcDateKey()]?.score ?? null;
  return null;
}
function boardForCurrent(): string {
  const m = app.params!.mode;
  if (m === "daily") return "daily-" + platform.utcDateKey();
  if (m === "challenge") return "challenge-" + app.params!.challengeId;
  if (m === "journey") return "level-" + app.level!.id;
  return "misc";
}
function finishRound(): void {
  const s = app.session!, p = progression(), mode = app.params!.mode, level = app.level!;
  const result = s.resultEnvelope();
  const state = s.state;
  const completed = state.status === "complete";
  p.totals.rounds++;
  p.totals.released += state.stats.released;
  p.lastSessionId = s.sessionId;
  const prevBest = previousBest();
  if (mode === "learn" && completed && app.lesson) p.tutorials[app.lesson.id] = true;
  let newlyCleared = false;
  if (mode === "journey") {
    newlyCleared = completed && !p.journeyStars[level.id];
    if (completed && (p.journeyStars[level.id] || 0) < result.stars) p.journeyStars[level.id] = result.stars;
    if (completed && (prevBest == null || result.score > prevBest)) p.levelBest[level.id] = result.score;
  }
  if (mode === "practice" && completed && (prevBest == null || result.score > prevBest)) p.practiceBest[app.params!.difficulty!] = result.score;
  if (mode === "challenge" && (prevBest == null || result.score > prevBest)) p.challengeBest[app.params!.challengeId!] = result.score;
  if (mode === "daily") {
    const key = platform.utcDateKey();
    const ex = p.dailies[key];
    if (!ex || result.score > ex.score) p.dailies[key] = { score: result.score, completed, at: Date.now() };
    else if (completed && !ex.completed) ex.completed = true;
  }
  const lockLevels = LEVEL_DEFS.filter((d) => (d.mechanics || []).includes("lock") && p.journeyStars[d.id]).length;
  const fresh = evaluateAchievements({
    totals: p.totals, completedLevelIds: new Set(Object.keys(p.journeyStars)), lockLevelsCompleted: lockLevels, dailyStreak: dailyStreak(), justCompleted: completed,
  }, platform.doc.achievements);
  for (const a of fresh) {
    platform.doc.achievements[a.key] = Date.now();
    audio.play("achievement");
    toast(T("achievementToast", { name: tn<string[]>("achievements", a.key, [a.name])[0]! }));
  }
  let rank: number | null = null;
  if (s.ranked || mode === "journey") {
    rank = platform.recordLocal({ board: boardForCurrent(), name: platform.displayName() ?? platform.doc.profile.name, score: result.score, completed, invalid: result.stats.invalid, elapsedMs: result.elapsedMs, sessionId: s.sessionId, mode });
  }
  platform.doc.snapshot = null;
  platform.save();
  const nextLesson = mode === "learn" && completed ? LESSONS[LESSONS.findIndex((l) => l.id === app.lesson?.id) + 1]?.id : null;
  const nextLabel = mode === "journey" && completed && (app.params!.levelIndex ?? 0) + 1 < LEVEL_DEFS.length ? "nextStage"
    : nextLesson ? "nextLesson" : mode === "practice" ? "playAgain" : "modes";
  const res: Results = { result, level, mode, achievements: fresh, rank, previousBest: prevBest, nextLabel, lb: null };
  if (s.ranked && platform.signedIn()) {
    res.lb = { key: "lbPosting" };
    void platform.postScore(result.score).then((r) => {
      res.lb = !r.posted ? { key: "lbNotPosted" } : r.rank ? { key: "lbRank", vars: { rank: r.rank } } : { key: "lbPosted" };
      if (app.results === res) announce(S(res.lb.key, res.lb.vars));
    });
  }
  app.results = res;
  if (completed) {
    audio.play("level-win");
    if (result.stars > 0) audio.play("star-" + result.stars);
    if (mode === "journey" && newlyCleared && LEVEL_DEFS.filter((d) => d.chapter === level.chapter).every((d) => (p.journeyStars[d.id] || 0) > 0)) audio.play("chapter-complete");
  }
  if (prevBest != null && result.score > prevBest) audio.play("new-record");
  app.phase = "results";
  openScreen("results", nextLabel !== "modes" ? "btn-next" : "btn-retry");
  announce(T("announceResult", { head: completed ? T("boardCleared") : T("headOver"), score: result.score, stars: result.stars }));
}
export function retry(): void { if (app.params) prepareRound(app.params); }
export function next(): void {
  const r = app.results, p = app.params;
  if (!r || !p) { openModes(); return; }
  const done = r.result.status === "complete";
  if (p.mode === "journey" && done && (p.levelIndex ?? 0) + 1 < LEVEL_DEFS.length) prepareRound({ mode: "journey", levelIndex: (p.levelIndex ?? 0) + 1 });
  else if (p.mode === "learn" && done) {
    const nx = LESSONS[LESSONS.findIndex((l) => l.id === app.lesson?.id) + 1];
    if (nx) prepareRound({ mode: "learn", lessonId: nx.id }); else openSetup("learn");
  } else if (p.mode === "practice") prepareRound(p);
  else openModes();
}

// ------------------------------------------------------------------ snapshot (main.js persistSnapshot / resumeSnapshot)
function persistSnapshot(): void {
  const s = app.session;
  if (!s || s.finished || !app.params) return;
  try {
    platform.doc.snapshot = JSON.stringify({ savedAt: Date.now(), params: app.params, tutorialStep: app.tutorialStep, session: s.snapshot() });
    platform.save();
  } catch { /* non-fatal */ }
}
function resumeSnapshot(json: string): void {
  try {
    const data = JSON.parse(json) as { params: Params; tutorialStep?: number; session: string };
    clockMs = 0;
    const s = SessionClass.restore(data.session, { now: () => clockMs });
    app.params = data.params;
    app.lesson = data.params.lessonId ? LESSONS.find((l) => l.id === data.params.lessonId) ?? null : null;
    app.level = s.level;
    app.session = s;
    s.onEvents(onSessionEvents);
    app.tutorialStep = data.tutorialStep ?? 0;
    app.selected = null;
    app.hovered = null;
    app.results = null;
    warnedTime = false;
    finishIn = 0;
    enterBoard();
    if (app.lesson) showTutorialStep();
    app.phase = "active";
    tickIn = 15;
    snapshotIn = 300;
    toast(T("snapshotResumed"));
  } catch (e) {
    console.warn(`snapshot restore failed: ${String(e)}`);
    platform.doc.snapshot = null;
    platform.save();
    prepareRound({ mode: "journey", levelIndex: nextJourneyIndex() });
  }
}

// ------------------------------------------------------------------ commands
export function selectionText(): string {
  const id = app.selected || app.hovered;
  const s = app.session;
  if (!id || !s) return T("nothingSelected");
  const cube = s.state.cubes.find((c) => c.id === id);
  if (!cube) return T("nothingSelected");
  const ex = Engine.explainRelease(s.state, id);
  return ex.ok ? T("selClear", { id, dir: dirName(cube.dir) }) : T("selBlocked", { id, dir: dirName(cube.dir), reason: refusalText(ex) });
}
export function selectCube(id: string | null): void {
  app.selected = id;
  render.setSelected(id);
  if (app.session) render.showPathFor(app.session.state, id);
  if (id && app.session) {
    const ex = Engine.explainRelease(app.session.state, id);
    announce(T("selAnnounce", { id, status: ex.ok ? T("pathClear") : refusalText(ex) }));
  }
}
export function cycleSelection(sign: number): void {
  const s = app.session;
  if (!s) return;
  const acts = Engine.legalActions(s.state).map((a) => a.cubeId).sort();
  if (!acts.length) { audio.play("error"); announce(T("noClearPaths")); return; }
  const cur = acts.indexOf(app.selected ?? "");
  selectCube(acts[cur === -1 ? 0 : (cur + sign + acts.length) % acts.length]!);
}
export function attemptRelease(id: string): void {
  const s = app.session;
  if (app.phase !== "active" || !s || s.paused) return;
  audio.play("tap");
  s.dispatch("release", { cubeId: id });
}
export function doRotate(sign: number): void {
  if (app.phase !== "active" && app.phase !== "countdown") return;
  render.quarter(sign);
  if (app.phase === "active" && app.session && !app.session.paused) app.session.dispatch("rotate");
}
export function doUndo(): void {
  const s = app.session;
  if (app.phase !== "active" || !s) return;
  if (s.undo()) {
    render.syncBoard(s.state, [{ type: "undo" }]);
    selectCube(null);
    audio.play("undo");
  }
}
export function doHint(): void {
  const s = app.session;
  if (app.phase !== "active" || !s) return;
  const h = s.hint();
  if (h) { selectCube(h.cubeId); audio.play("hint"); toast(T("hintToast", { id: h.cubeId })); }
  else audio.play("error");
}
export const canUndo = (): boolean => { const s = app.session; return !!s && s.allowUndo && s.history.length > 0 && !s.finished; };
export const canHint = (): boolean => { const s = app.session; return !!s && s.tools.hint && !s.finished; };
export function resetCamera(): void { render.resetCamera(); }

// ------------------------------------------------------------------ pause
export function pauseGame(reason: string): void {
  const s = app.session;
  if (app.phase !== "active" || !s) return;
  s.pause();
  audio.play("pause");
  app.phase = "paused";
  persistSnapshot();
  app.modalReturn = null;
  openModal("pause", "btn-resume");
  if (reason === "background") announce(T("paused"));
}
export function resumeGame(): void {
  if (app.phase !== "paused") return;
  audio.play("resume");
  app.session!.resume();
  app.phase = "active";
  app.modal = null;
  app.openedFrame = frame().frame;
  ui.setFocus(null);
}
export function leaveRound(): void {
  const s = app.session;
  app.modal = null;
  if (s && !s.finished) {
    s.resume();
    app.phase = "active";
    s.dispatch("concede");
  } else openModes();
}
export function restartRound(): void { app.modal = null; if (app.params) prepareRound(app.params); }

// ------------------------------------------------------------------ settings and account
export function setOption(patch: Partial<typeof platform.doc.settings>): void {
  platform.setOptions(patch);
  audio.setCaptions(!!settings().captions);
  if ("palette" in patch) render.applyTheme(currentTheme());
  audio.play("toggle");
}
export function setTheme(id: string): void {
  progression().theme = id;
  platform.save();
  audio.play("settings-saved");
  if (app.session && app.level) { render.buildEnvironment(String(app.level.seed), currentTheme()); render.applyTheme(currentTheme()); }
}
export function setName(name: string): void {
  const v = name.trim().slice(0, 24);
  platform.doc.profile.name = !v || v === T("guest") ? "Guest" : v;
  platform.save();
  toast(T("nameSaved"));
}
export function signIn(): void { void requestSignIn().catch(() => undefined); }
export function invite(): void {
  const link = platform.inviteLink();
  if (!link) return;
  try { clipboard.writeText(link); toast(S("inviteCopied")); } catch { toast(S("inviteFailed", { link }), 6000); }
}

// ------------------------------------------------------------------ keys and pads (main.js onKeyDown / pollGamepad)
onAction((e) => {
  if (!e.pressed || ui.capturingKeys()) return;
  const a = e.action;
  if (app.phase === "countdown") { if (a === "rotate_left") later(() => doRotate(1)); else if (a === "rotate_right") later(() => doRotate(-1)); else later(skipCountdown); return; }
  if (app.phase !== "active" || app.modal || app.screen) return;
  switch (a) {
    case "pause": case "cancel": if (fresh()) later(() => pauseGame("user")); break;
    case "nav_next": ui.setFocus(null); later(() => cycleSelection(1)); break;
    case "nav_prev": ui.setFocus(null); later(() => cycleSelection(-1)); break;
    // a focused button keeps its own Enter
    case "confirm": if (ui.focused() === null) later(() => { if (app.selected) attemptRelease(app.selected); else cycleSelection(1); }); break;
    case "rotate_left": later(() => doRotate(1)); break;
    case "rotate_right": later(() => doRotate(-1)); break;
    case "undo": later(doUndo); break;
    case "hint": later(doHint); break;
    case "cam_reset": later(resetCamera); break;
  }
});
function padOrbit(): void {
  if (app.phase !== "active" || app.modal) return;
  const ax = value("orbit_right") - value("orbit_left"), ay = value("orbit_down") - value("orbit_up");
  if (Math.abs(ax) > 0.25 || Math.abs(ay) > 0.25) {
    render.rotate(-ax * 0.03, ay * 0.03);
    if (render.consumeRotationCredit() && app.session && !app.session.paused) app.session.dispatch("rotate");
  }
}

// ------------------------------------------------------------------ pointer and touch on the board (main.js wireCanvasInput)
const TAP_MAX_DIST = 9, TAP_MAX_S = 0.45, DRAG_K = 0.0062;
type PEv = { kind: "down" | "move" | "up" | "cancel"; x: number; y: number; ui: boolean; touch: boolean };
const queue: PEv[] = [];
let down: { x: number; y: number; lx: number; ly: number; t: number; dragging: boolean } | null = null;
let lastTouch = -1e9;
let lastMove: { x: number; y: number } | null = null;
let field: render.Rect | null = null;
export function setField(r: render.Rect | null): void { field = r; }
onTouch((e) => {
  lastTouch = now();
  if (e.control || !e.primary) return;
  if (e.phase === "start") queue.push({ kind: "down", x: e.x, y: e.y, ui: ui.pointerCaptured(), touch: true });
  else if (e.phase === "move") queue.push({ kind: "move", x: e.x, y: e.y, ui: false, touch: true });
  else queue.push({ kind: e.phase === "cancel" ? "cancel" : "up", x: e.x, y: e.y, ui: false, touch: true });
});
onPointerButton((e) => {
  if (e.button !== 0 || now() - lastTouch < 0.6) return;
  queue.push({ kind: e.pressed ? "down" : "up", x: e.x, y: e.y, ui: e.pressed && ui.pointerCaptured(), touch: false });
});
onPointerMove((x, y) => { if (now() - lastTouch >= 0.6) queue.push({ kind: "move", x, y, ui: false, touch: false }); });
const inField = (x: number, y: number): boolean => !!field && x >= field.x && y >= field.y && x <= field.x + field.width && y <= field.y + field.height;
function pointerInput(wasPlaying: boolean): void {
  for (const p of queue.splice(0)) {
    const playing = wasPlaying && (app.phase === "active" || app.phase === "countdown") && !app.modal && !!app.session;
    if (!playing) { down = null; continue; }
    const sc = ui.preferences().scale;
    if (p.kind === "down") {
      down = null;
      if (p.ui || !inField(p.x, p.y)) continue;
      if (app.phase === "countdown") { skipCountdown(); continue; }
      down = { x: p.x, y: p.y, lx: p.x, ly: p.y, t: now(), dragging: false };
    } else if (p.kind === "move") {
      const prevMove = lastMove;
      lastMove = { x: p.x, y: p.y };
      void prevMove;
      if (down) {
        if (Math.hypot(p.x - down.x, p.y - down.y) / sc > TAP_MAX_DIST) down.dragging = true;
        if (down.dragging) render.rotate((-(p.x - down.lx) / sc) * DRAG_K, ((p.y - down.ly) / sc) * DRAG_K);
        down.lx = p.x; down.ly = p.y;
      } else if (app.grab && !p.touch) {
        if (prevMove) render.rotate((-(p.x - prevMove.x) / sc) * DRAG_K, ((p.y - prevMove.y) / sc) * DRAG_K);
      } else if (!p.touch && app.phase === "active") hover(inField(p.x, p.y) ? render.pick(p.x, p.y) : null);
    } else {
      const d = down;
      down = null;
      if (!d || p.kind === "cancel") continue;
      if (d.dragging) {
        if (render.consumeRotationCredit() && app.session && !app.session.paused && app.phase === "active") app.session.dispatch("rotate");
        continue;
      }
      if (now() - d.t <= TAP_MAX_S) tap(p.x, p.y);
    }
  }
}
function hover(id: string | null): void {
  if (id === app.hovered) return;
  app.hovered = id;
  render.setHover(id);
  if (id && !app.selected && app.session) render.showPathFor(app.session.state, id);
}
/** main.js handleTap. */
function tap(x: number, y: number): void {
  if (app.phase !== "active" || !app.session) return;
  const id = render.pick(x, y);
  ui.setFocus(null);
  if (id) {
    if (app.grab) { app.grab = false; return; }
    selectCube(id);
    attemptRelease(id);
  } else if (settings().dragToggle) {
    app.grab = !app.grab;
    toast(app.grab ? T("grabOn") : T("grabOff"));
  } else selectCube(null);
}

// ------------------------------------------------------------------ the clock (fixed steps)
onFixedUpdate(() => {
  if (app.phase === "countdown") {
    if (--countdownIn > 0) return;
    app.countdown--;
    if (app.countdown <= 0) { activateRound(); return; }
    audio.play("countdown");
    countdownIn = Math.round(0.42 * STEP_RATE);
    return;
  }
  if (tutorialIn > 0 && --tutorialIn === 0) showTutorialStep();
  if (app.phase === "resolving") {
    clockMs += STEP_MS;
    if (--finishIn <= 0) { finishIn = 0; finishRound(); }
    return;
  }
  if (app.phase !== "active" || !app.session) return;
  clockMs += STEP_MS;
  const s = app.session;
  if (--snapshotIn <= 0) { snapshotIn = 300; persistSnapshot(); }
  if (--tickIn > 0) return;
  tickIn = 15;
  s.tickClock();
  const limit = s.state.limits.timeMs;
  if (limit != null && !warnedTime) {
    const left = limit - s.activeMs();
    if (left > 0 && left <= 5000) { warnedTime = true; audio.play("timer-warning"); }
  }
});
/** Time left on a timed round (the HUD clock). */
export function timeLeftMs(): number | null {
  const s = app.session;
  if (!s || s.state.limits.timeMs == null) return null;
  return Math.max(0, s.state.limits.timeMs - (app.phase === "countdown" ? 0 : s.activeMs()));
}

// ------------------------------------------------------------------ boot and lifecycle
let lookKey = "";
function applyLook(): void {
  const f = frame();
  const k = `${f.quality}:${f.levelIndex}`;
  if (k === lookKey) return;
  lookKey = k;
  render.applyLook(lookFor(f.quality, f.levelIndex));
}
onStart(() => {
  setFixedRate(STEP_RATE);
  initStyles();
  platform.initPlatform();
  render.setReducedMotion(preferences().reducedMotion);
  applyLook();
  audio.setCaptions(!!settings().captions);
  audio.onCaption((key) => {
    const k = "cap_" + key.replace(/-/g, "_");
    toast("♪ " + (hasKey(k) ? T(k) : key), 1200, false);
  });
  gen.warm();
  goTitle();
});
onPreferencesChange((p) => render.setReducedMotion(p.reducedMotion));
platform.onMerged(() => audio.setCaptions(!!settings().captions));
onSessionEnded(() => toast(S("signedOut")));
onSuspend(() => {
  if (app.phase === "active") pauseGame("background");
  audio.setSuspended(true);
  platform.flush();
});
onResume(() => audio.setSuspended(false));

let frameDt = 0;
onUpdate((dt) => {
  frameDt = dt;
  applyLook();
  applyTokens(ui.preferences().highContrast);
  audio.update(dt);
  padOrbit();
  const t = now();
  app.toasts = app.toasts.filter((x) => x.until > t);
});
onRender(() => {
  const wasPlaying = (app.phase === "active" || app.phase === "countdown") && !app.modal;
  render.update(frameDt);
  drawScreens();
  for (const fn of pending.splice(0)) fn();
  pointerInput(wasPlaying);
  flushAnnouncements();
});
export type { ResultEnvelope };
