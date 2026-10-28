// The browser build's pure modules, imported unchanged (allowJs): the rules
// (js/rules/engine.js: arrows, rays, locks, stones, the core, legal actions,
// terminal reasons), scoring and stars (scoring.js), the generator
// (generator.js, practice and Daily boards), the seeded streams (rng.js),
// the session (js/session/session.js: command log, undo, hashes, snapshot)
// and the content (levels, lessons, challenges, themes, achievements), plus
// js/content/generated.js (the Journey and challenge boards precomputed by
// tools/gen-levels.mjs — generating them natively takes seconds). Typed here
// with the shapes this client reads.
import * as EngineJs from "../js/rules/engine.js";
import * as GeneratorJs from "../js/rules/generator.js";
import * as RngJs from "../js/rules/rng.js";
import * as SessionJs from "../js/session/session.js";
import * as LevelsJs from "../js/content/levels.js";
import * as TutorialsJs from "../js/content/tutorials.js";
import * as ChallengesJs from "../js/content/challenges.js";
import * as ThemesJs from "../js/content/themes.js";
import * as AchievementsJs from "../js/content/achievements.js";
import * as GeneratedJs from "../js/content/generated.js";
import * as MigrateJs from "../js/migrate.js";

export type Vec3i = [number, number, number];
export interface Cube { id: string; pos: Vec3i; dir: number; kind: "arrow" | "stone" | "core"; lock: { keyId: string; open?: boolean } | null }
export interface Par { taps: number; rotations: number; timeMs: number }
export interface Level {
  id: string; version?: number; name: string; chapter?: number; theme?: string; mechanics: string[]; tip?: string; mastery?: boolean;
  seed: string | number; cubes: Cube[]; par: Par;
}
export interface State {
  mode: string; seed: string; levelId: string; tick: number; status: "active" | "complete" | "failed"; terminalReason: string | null;
  cubes: Cube[]; stats: { taps: number; rotations: number; invalid: number; released: number };
  limits: { moves: number | null; timeMs: number | null }; elapsedMs: number;
}
export interface RulesEvent { type: string; cubeId?: string; pos?: Vec3i; dir?: number; reason?: string; keyId?: string; by?: string; byStone?: boolean; message?: string }
export interface Explain { ok: boolean; reason?: string; keyId?: string; by?: string; byStone?: boolean; message?: string }
export interface Components { release: number; completion: number; tapEfficiency: number; rotationEfficiency: number; timeBonus: number; invalidPenalty: number }
export interface ResultEnvelope {
  status: string; terminalReason: string; score: number; components: Components; stars: number;
  stats: State["stats"]; elapsedMs: number; sessionId: string;
}
export interface Session {
  sessionId: string; level: Level; ranked: boolean; allowUndo: boolean; tools: { hint: boolean; undo: boolean };
  state: State; history: unknown[]; finished: { reason: string } | null; startStamp: number; pausedAccum: number; paused: boolean;
  onEvents(fn: (events: RulesEvent[], state: State) => void): () => void;
  dispatch(type: string, payload?: Record<string, unknown>): { ok: boolean; events: RulesEvent[] };
  undo(): boolean; hint(): { cubeId: string } | null; tickClock(): void; activeMs(): number;
  pause(): void; resume(): void; score(): { components: Components; total: number }; resultEnvelope(): ResultEnvelope; snapshot(): string;
}
export interface LevelDef { id: string; name: string; chapter: number; seed: number | string; mechanics?: string[]; [k: string]: unknown }
export interface Lesson { id: string; name: string; goal: string; board: Level; steps: { text: string; focus?: string; require: { type: string; cubeId?: string; reason?: string } }[] }
export interface Challenge { id: string; name: string; blurb: string; def: LevelDef; limitKind: string; timeMs?: number; slack?: number; ranked?: boolean }
export interface Theme {
  id: string; name: string; unlockStars: number;
  sky: { top: number; horizon: number; fog: number; fogDensity: number };
  light: { key: number; keyIntensity: number; hemiSky: number; hemiGround: number; hemiIntensity: number };
  env: { structure: number; accent: number };
  cube: { arrow: number; stone: number; core: number; chevron: number; hover: number; select: number; invalid: number; locked: number; path: number };
  ui: { accent: string };
}
export interface Achievement { key: string; name: string; desc: string }

interface EngineApi {
  DIRS: readonly Vec3i[]; DIR_NAMES: readonly string[];
  legalActions(s: State): { cubeId: string }[]; explainRelease(s: State, id: string): Explain; remainingArrows(s: State): number;
  rayCells(s: State, c: Cube, max: number): { cells: Vec3i[]; blockedBy: string | null };
}
export const Engine = EngineJs as unknown as EngineApi;
export const generateLevel = (GeneratorJs as unknown as { generateLevel(d: LevelDef): Level }).generateLevel;
export const RngClass = (RngJs as unknown as { Rng: new (seed: string) => { next(): number; int(n: number): number } }).Rng;
export const SessionClass = (SessionJs as unknown as {
  GameSession: (new (o: Record<string, unknown>) => Session) & { restore(json: string, opts?: Record<string, unknown>): Session };
}).GameSession;
const L = LevelsJs as unknown as {
  CHAPTERS: { id: number; name: string; blurb: string }[]; LEVEL_DEFS: LevelDef[];
  PRACTICE_DEFS: Record<string, LevelDef & { seedSalt: string }>; dailyDef(key: string): LevelDef;
};
export const CHAPTERS = L.CHAPTERS, LEVEL_DEFS = L.LEVEL_DEFS, PRACTICE_DEFS = L.PRACTICE_DEFS, dailyDef = L.dailyDef;
export const LESSONS = (TutorialsJs as unknown as { LESSONS: Lesson[] }).LESSONS;
const C = ChallengesJs as unknown as { CHALLENGES: Challenge[]; challengeLimits(c: Challenge, l: Level): { moves?: number; timeMs?: number } };
export const CHALLENGES = C.CHALLENGES, challengeLimits = C.challengeLimits;
const Th = ThemesJs as unknown as { THEMES: Theme[]; themeById(id: string): Theme };
export const THEMES = Th.THEMES, themeById = Th.themeById;
const A = AchievementsJs as unknown as {
  ACHIEVEMENTS: Achievement[];
  evaluateAchievements(ctx: Record<string, unknown>, unlocked: Record<string, number>): Achievement[];
};
export const ACHIEVEMENTS = A.ACHIEVEMENTS, evaluateAchievements = A.evaluateAchievements;
export const GENERATED = (GeneratedJs as unknown as { GENERATED: Record<string, Level> }).GENERATED;

export interface GameSettings { captions: boolean; palette: string; leftHanded: boolean; dragToggle: boolean; timingAssist: boolean }
export interface Progression {
  journeyStars: Record<string, number>; tutorials: Record<string, boolean>; totals: { released: number; rounds: number };
  dailies: Record<string, { score: number; completed: boolean; at: number }>; challengeBest: Record<string, number>;
  practiceBest: Record<string, number>; levelBest: Record<string, number>; theme: string; lastSessionId: string | null;
}
export interface BoardEntry { board: string; name: string; score: number; completed: boolean; invalid: number; elapsedMs: number; sessionId: string; mode: string; at: number }
export interface SaveDoc {
  v: 1; settings: GameSettings; progression: Progression; profile: { name: string }; achievements: Record<string, number>;
  boards: { entries: Record<string, BoardEntry[]> }; snapshot: string | null;
}
export const Migrate = MigrateJs as unknown as {
  emptyDoc(): SaveDoc; normalizeDoc(d: unknown): SaveDoc; mergeDocs(remote: unknown, local: unknown): SaveDoc;
  fromForeign(old: unknown): SaveDoc | null; pickLegacy(kv: Record<string, unknown>): Partial<GameSettings>;
};

/** A Journey stage or challenge board from the precomputed table (generated if missing). */
export function journeyLevel(index: number): Level {
  const def = LEVEL_DEFS[index]!;
  return GENERATED[def.id] ?? generateLevel(def);
}
export function challengeLevel(c: Challenge): Level { return GENERATED["challenge:" + c.id] ?? generateLevel(c.def); }
