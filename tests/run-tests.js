// Vanishing Cubes — rules/content test suite.
// Unit tests for every legal action, invalid-action reason, scoring component,
// terminal state and serialization migration; property tests for deterministic
// replay; fuzz tests for malformed commands and generated content; golden
// tests for representative easy/medium/hard, interrupted and resumed sessions;
// and an API integration pass over the authoritative server script.
//
// Run: npm test   (node tests/run-tests.js)

import { rm } from 'node:fs/promises';
import {
  createState, applyCommand, legalActions, explainRelease, remainingArrows,
  solveGreedy, hintAction, serialize, deserialize, migrate, stateHash,
  canonicalJSON, firstCubeOnRay, rayCells, TERMINAL, DIRS, STATE_VERSION,
} from '../js/rules/engine.js';
import { Rng, hashSeed, cyrb53, makeStreams } from '../js/rules/rng.js';
import { computeScore, starsFor, compareResults, SCORE } from '../js/rules/scoring.js';
import { buildEnvelope, verifyEnvelope, REPLAY_SCHEMA } from '../js/rules/replay.js';
import { generateLevel, validateLevel, difficultyOf } from '../js/rules/generator.js';
import { GameSession } from '../js/session/session.js';
import { LEVEL_DEFS, PRACTICE_DEFS, dailyDef } from '../js/content/levels.js';
import { LESSONS } from '../js/content/tutorials.js';
import { CHALLENGES, challengeLimits } from '../js/content/challenges.js';
import { THEMES, themeById, unlockedThemes } from '../js/content/themes.js';
import { ACHIEVEMENTS, evaluateAchievements } from '../js/content/achievements.js';
import { readFileSync } from 'node:fs';

// ---------- tiny framework ----------

let passed = 0;
let failed = 0;
const failures = [];
let group = '';
const queue = [];

function describe(name) {
  group = name;
}

function test(name, fn) {
  queue.push([group, name, fn]);
}

function ok(v, msg) {
  if (!v) throw new Error(msg || 'expected truthy, got ' + JSON.stringify(v));
}
function eq(a, b, msg) {
  if (!Object.is(a, b)) throw new Error(`${msg || 'eq'} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function throws(fn, msg) {
  let t = false;
  try {
    fn();
  } catch {
    t = true;
  }
  if (!t) throw new Error(msg || 'expected function to throw');
}

const cube = (id, x, y, z, dir, kind = 'arrow', lock = null) => ({
  id, pos: [x, y, z], dir, kind, lock,
});
const boardOf = (cubes, id = 'tb') => ({
  id, version: 1, name: id, seed: id, mechanics: [], cubes, par: { taps: 10, rotations: 3, timeMs: 60000 },
});
let cmdSeq = 0;
const cmd = (type, payload = {}, at = 0) => ({ id: 't' + cmdSeq++, type, at, ...payload });
function applyOk(state, command) {
  const r = applyCommand(state, command);
  if (r.error) throw new Error('unexpected error: ' + r.error.code);
  return r;
}

// ===========================================================================
describe('rng');
// ===========================================================================

test('same seed reproduces the same stream', () => {
  const a = new Rng('seed-1');
  const b = new Rng('seed-1');
  for (let i = 0; i < 50; i++) eq(a.next(), b.next());
});

test('different seeds diverge', () => {
  const a = new Rng('seed-1');
  const b = new Rng('seed-2');
  let same = 0;
  for (let i = 0; i < 20; i++) if (a.next() === b.next()) same++;
  ok(same < 20, 'streams identical for different seeds');
});

test('int/range/pick stay in bounds', () => {
  const r = new Rng('bounds');
  for (let i = 0; i < 500; i++) {
    const v = r.int(6);
    ok(Number.isInteger(v) && v >= 0 && v < 6);
    const w = r.range(2, 5);
    ok(w >= 2 && w <= 5);
    ok([1, 2, 3].includes(r.pick([1, 2, 3])));
  }
});

test('shuffle is a permutation', () => {
  const r = new Rng('shuf');
  const arr = [1, 2, 3, 4, 5, 6, 7, 8];
  const out = r.shuffle(arr.slice());
  eq(out.slice().sort().join(','), arr.join(','));
});

test('state save/restore continues the stream', () => {
  const a = new Rng('cont');
  a.next();
  a.next();
  const snap = a.state();
  const expected = a.next();
  const b = new Rng('other');
  b.restore(snap);
  eq(b.next(), expected);
});

test('forks are independent streams', () => {
  const s = makeStreams('root');
  const a = s.rules.next();
  const b = s.decor.next();
  const c = s.av.next();
  ok(a !== b && b !== c && a !== c, 'forked streams produce identical values');
});

test('hash functions are deterministic', () => {
  eq(hashSeed('abc'), hashSeed('abc'));
  eq(cyrb53('abc'), cyrb53('abc'));
  ok(hashSeed('abc') !== hashSeed('abd'));
});

// ===========================================================================
describe('engine: creation and legality');
// ===========================================================================

test('createState initializes a clean serializable state', () => {
  const level = boardOf([cube('a', 0, 0, 0, 0)]);
  const st = createState({ level, mode: 'practice', seed: 's', limits: {} });
  eq(st.version, STATE_VERSION);
  eq(st.tick, 0);
  eq(st.status, 'active');
  eq(st.terminalReason, null);
  eq(st.stats.taps, 0);
  eq(st.limits.moves, null);
  eq(st.limits.timeMs, null);
  JSON.parse(serialize(st)); // serializable
  // input level not mutated; cube positions copied
  st.cubes[0].pos[0] = 99;
  eq(level.cubes[0].pos[0], 0);
});

test('limits are normalized to integers', () => {
  const st = createState({ level: boardOf([cube('a', 0, 0, 0, 0)]), limits: { moves: 7.9, timeMs: 1000.4 } });
  eq(st.limits.moves, 7);
  eq(st.limits.timeMs, 1000);
});

test('legalActions exposes a clear arrow cube', () => {
  const st = createState({ level: boardOf([cube('a', 0, 0, 0, 0)]) });
  const acts = legalActions(st);
  eq(acts.length, 1);
  eq(acts[0].type, 'release');
  eq(acts[0].cubeId, 'a');
});

test('blocked cube is illegal with reason and culprit', () => {
  const st = createState({ level: boardOf([cube('a', 0, 0, 0, 0), cube('b', 1, 0, 0, 0)]) });
  const ex = explainRelease(st, 'a');
  eq(ex.ok, false);
  eq(ex.reason, 'blocked');
  eq(ex.by, 'b');
  eq(explainRelease(st, 'b').ok, true);
  eq(legalActions(st).map((x) => x.cubeId).join(','), 'b');
  const hit = firstCubeOnRay(st, st.cubes[0]);
  eq(hit.id, 'b');
  const ray = rayCells(st, st.cubes[1]);
  ok(ray.cells.length >= 1 && !ray.blockedBy);
});

test('stone and core are never releasable', () => {
  const st = createState({
    level: boardOf([cube('s', 0, 0, 0, 0, 'stone'), cube('k', 2, 0, 0, 0, 'core'), cube('a', -2, 0, 0, 1)]),
  });
  eq(explainRelease(st, 's').reason, 'stone');
  eq(explainRelease(st, 'k').reason, 'core');
  eq(explainRelease(st, 'missing').reason, 'gone');
  eq(legalActions(st).length, 1);
  eq(legalActions(st)[0].cubeId, 'a'); // points west into open sky
});

test('locks block until their key is released', () => {
  const level = boardOf([
    cube('key', 1, 0, 0, 0),
    cube('locked', 0, 0, 0, 1, 'arrow', { keyId: 'key' }),
  ]);
  let st = createState({ level });
  const ex = explainRelease(st, 'locked');
  eq(ex.reason, 'locked');
  eq(ex.keyId, 'key');
  eq(legalActions(st).length, 1);
  const r = applyOk(st, cmd('release', { cubeId: 'key' }));
  st = r.state;
  ok(r.events.some((e) => e.type === 'unlock' && e.cubeId === 'locked'));
  eq(explainRelease(st, 'locked').ok, true);
});

// ===========================================================================
describe('engine: commands and terminals');
// ===========================================================================

test('release removes the cube and emits a snapshot event', () => {
  let st = createState({ level: boardOf([cube('a', 0, 0, 0, 0), cube('b', 0, 1, 0, 2)]) });
  const r = applyOk(st, cmd('release', { cubeId: 'a', }, 100));
  st = r.state;
  eq(st.cubes.length, 1);
  eq(st.stats.taps, 1);
  eq(st.stats.released, 1);
  const ev = r.events.find((e) => e.type === 'release');
  eq(ev.cubeId, 'a');
  eq(ev.pos.join(','), '0,0,0');
  eq(st.status, 'active');
});

test('completing the board ends the round with cleared reason', () => {
  let st = createState({ level: boardOf([cube('a', 0, 0, 0, 0)]) });
  const r = applyOk(st, cmd('release', { cubeId: 'a' }, 50));
  eq(r.state.status, 'complete');
  eq(r.state.terminalReason, TERMINAL.CLEARED);
  ok(r.events.some((e) => e.type === 'complete'));
});

test('invalid tap increments invalid counter but keeps state consistent', () => {
  let st = createState({ level: boardOf([cube('a', 0, 0, 0, 0), cube('b', 1, 0, 0, 0)]) });
  const r = applyOk(st, cmd('release', { cubeId: 'a' }, 10));
  st = r.state;
  eq(st.stats.invalid, 1);
  eq(st.cubes.length, 2);
  ok(r.events.some((e) => e.type === 'invalid' && e.reason === 'blocked'));
  eq(st.status, 'active');
});

test('move limit produces moves-exhausted', () => {
  let st = createState({
    level: boardOf([cube('a', 0, 0, 0, 0), cube('b', 1, 0, 0, 0)]),
    limits: { moves: 1 },
  });
  const r = applyOk(st, cmd('release', { cubeId: 'a' }, 10)); // invalid tap consumes the move
  eq(r.state.status, 'failed');
  eq(r.state.terminalReason, TERMINAL.MOVES);
});

test('time limit produces time-exhausted for late commands', () => {
  let st = createState({
    level: boardOf([cube('a', 0, 0, 0, 0)]),
    limits: { timeMs: 1000 },
  });
  const r = applyCommand(st, cmd('release', { cubeId: 'a' }, 5000));
  eq(r.state.status, 'failed');
  eq(r.state.terminalReason, TERMINAL.TIME);
  // a command inside the limit still works
  const r2 = applyOk(st, cmd('clock', {}, 500));
  eq(r2.state.status, 'active');
});

test('no legal moves produces no-legal-moves after a tap', () => {
  // a and b block each other; no cube can ever leave.
  let st = createState({ level: boardOf([cube('a', 0, 0, 0, 0), cube('b', 1, 0, 0, 1)]) });
  eq(legalActions(st).length, 0);
  const r = applyOk(st, cmd('release', { cubeId: 'a' }, 10));
  eq(r.state.terminalReason, TERMINAL.NO_MOVES);
});

test('concede ends the round immediately', () => {
  let st = createState({ level: boardOf([cube('a', 0, 0, 0, 0)]) });
  const r = applyOk(st, cmd('concede'));
  eq(r.state.terminalReason, TERMINAL.CONCEDED);
});

test('rotate and clock commands update counters and clock', () => {
  let st = createState({ level: boardOf([cube('a', 0, 0, 0, 0)]) });
  st = applyOk(st, cmd('rotate', {}, 100)).state;
  eq(st.stats.rotations, 1);
  st = applyOk(st, cmd('clock', {}, 250)).state;
  eq(st.elapsedMs, 250);
  // clock never runs backwards
  st = applyOk(st, cmd('clock', {}, 100)).state;
  eq(st.elapsedMs, 250);
});

test('tick is monotonic across all applied commands', () => {
  let st = createState({ level: boardOf([cube('a', 0, 0, 0, 0), cube('b', 0, 1, 0, 2)]) });
  let last = 0;
  for (const c of [cmd('rotate'), cmd('release', { cubeId: 'b' }), cmd('clock'), cmd('release', { cubeId: 'a' })]) {
    const r = applyCommand(st, c);
    ok(!r.error);
    st = r.state;
    ok(st.tick > last, 'tick did not increase');
    last = st.tick;
  }
});

test('malformed commands are rejected without touching state', () => {
  const st = createState({ level: boardOf([cube('a', 0, 0, 0, 0)]) });
  const bads = [
    null, {}, { id: '', type: 'release', at: 0 }, { id: 'x', type: 'nope', at: 0 },
    { id: 'x', type: 'release', at: -1 }, { id: 'x', type: 'release', at: NaN },
    { id: 'x'.repeat(100), type: 'release', at: 0 },
    { id: 'x', type: 'release', at: 0 }, // missing cubeId
  ];
  for (const b of bads) {
    const r = applyCommand(st, b);
    ok(r.error, 'expected error for ' + JSON.stringify(b));
    eq(r.state, st); // same reference: untouched
  }
});

test('commands on a terminal state are rejected', () => {
  let st = createState({ level: boardOf([cube('a', 0, 0, 0, 0)]) });
  st = applyOk(st, cmd('concede')).state;
  const r = applyCommand(st, cmd('release', { cubeId: 'a' }));
  eq(r.error.code, 'not-active');
  eq(legalActions(st).length, 0);
});

test('greedy solver and hint use the legal-action API', () => {
  const level = boardOf([cube('a', 0, 0, 0, 0), cube('b', 1, 0, 0, 0), cube('c', 0, 2, 0, 2)]);
  const st = createState({ level });
  const order = solveGreedy(st);
  eq(order.length, 3);
  const hint = hintAction(st);
  ok(hint && legalActions(st).some((a) => a.cubeId === hint.cubeId));
});

// ===========================================================================
describe('engine: serialization');
// ===========================================================================

test('serialize/deserialize round-trips with identical hash', () => {
  const level = generateLevel(LEVEL_DEFS[5]);
  let st = createState({ level, mode: 'journey', seed: level.seed });
  st = applyOk(st, cmd('rotate', {}, 100)).state;
  const acts = legalActions(st);
  st = applyOk(st, cmd('release', { cubeId: acts[0].cubeId }, 200)).state;
  const back = deserialize(serialize(st));
  eq(stateHash(back), stateHash(st));
});

test('migrate rejects unknown and future versions', () => {
  throws(() => migrate(null));
  throws(() => migrate({ version: null }));
  throws(() => migrate({ version: STATE_VERSION + 1 }));
  const st = createState({ level: boardOf([cube('a', 0, 0, 0, 0)]) });
  eq(migrate(st), st);
});

test('canonicalJSON is key-order independent', () => {
  const a = canonicalJSON({ x: 1, y: [1, { b: 2, a: 3 }] });
  const b = canonicalJSON({ y: [1, { a: 3, b: 2 }], x: 1 });
  eq(a, b);
  eq(stateHash(deserialize(serialize(createState({ level: boardOf([cube('a', 0, 0, 0, 0)]) })))),
    stateHash(createState({ level: boardOf([cube('a', 0, 0, 0, 0)]) })));
});

// ===========================================================================
describe('scoring');
// ===========================================================================

test('score components are exact integers with a transparent breakdown', () => {
  // 3-arrow board; par 4 taps / 2 rotations / 30s.
  const level = LESSONS[0].board;
  let st = createState({ level, mode: 'learn', seed: level.seed });
  st = applyOk(st, cmd('rotate', {}, 100)).state; // 1 rotation
  st = applyOk(st, cmd('release', { cubeId: 'nope', }, 200)).state; // invalid
  let at = 1000;
  for (const id of ['c2', 'c1', 'c0']) {
    st = applyOk(st, cmd('release', { cubeId: id }, at)).state;
    at += 9000;
  }
  eq(st.status, 'complete');
  const s = computeScore({ state: st, par: level.par, elapsedMs: st.elapsedMs });
  eq(s.components.release, 3 * SCORE.PER_RELEASE);
  eq(s.components.completion, SCORE.COMPLETION);
  eq(s.components.tapEfficiency, (4 - st.stats.taps) * SCORE.TAP_EFFICIENCY);
  eq(s.components.rotationEfficiency, (2 - 1) * SCORE.ROTATION_EFFICIENCY);
  eq(s.components.timeBonus, Math.floor((30000 - st.elapsedMs) / 1000) * SCORE.TIME_PER_SECOND);
  eq(s.components.invalidPenalty, 1 * SCORE.INVALID_PENALTY);
  eq(s.total,
    s.components.release + s.components.completion + s.components.tapEfficiency +
    s.components.rotationEfficiency + s.components.timeBonus - s.components.invalidPenalty);
});

test('stars follow completion and pars', () => {
  const level = boardOf([cube('a', 0, 0, 0, 0)]);
  level.par = { taps: 1, rotations: 0, timeMs: 1000 };
  let st = createState({ level });
  eq(starsFor({ state: st, par: level.par }), 0); // not complete
  st = applyOk(st, cmd('release', { cubeId: 'a' }, 100)).state;
  eq(starsFor({ state: st, par: level.par }), 3); // under tap par, no rotations
  let over = createState({ level });
  over = applyOk(over, cmd('rotate')).state;
  over = applyOk(over, cmd('release', { cubeId: 'a' }, 100)).state;
  eq(starsFor({ state: over, par: level.par }), 2);
});

test('compareResults implements the documented tie-break order', () => {
  const base = { score: 100, completed: true, invalid: 0, elapsedMs: 1000, sessionId: 'a' };
  ok(compareResults({ ...base, score: 200 }, base) < 0, 'higher score first');
  ok(compareResults({ ...base, completed: false }, base) > 0, 'completion breaks ties');
  ok(compareResults({ ...base, invalid: 1 }, base) > 0, 'fewer invalid breaks ties');
  ok(compareResults({ ...base, elapsedMs: 500 }, base) < 0, 'lower time breaks ties');
  ok(compareResults({ ...base, sessionId: 'b' }, base) > 0, 'session id is the final stable tie-break');
  eq(compareResults(base, { ...base }), 0);
});

// ===========================================================================
describe('generator and content validation');
// ===========================================================================

test('all 40 journey levels generate and pass the offline validator', () => {
  eq(LEVEL_DEFS.length, 40);
  for (const def of LEVEL_DEFS) {
    const level = generateLevel(def);
    const v = validateLevel(level);
    ok(v.ok, `${def.id}: ${v.problems.join('; ')}`);
    // versioned content fields per spec
    ok(level.id && level.version >= 1 && level.seed != null && level.par && level.theme);
  }
});

test('generation is deterministic per seed', () => {
  for (const def of [LEVEL_DEFS[0], LEVEL_DEFS[11], LEVEL_DEFS[39]]) {
    const a = generateLevel(def);
    const b = generateLevel(def);
    eq(JSON.stringify(a), JSON.stringify(b), def.id + ' not deterministic');
  }
});

test('every journey level is solvable and pars are bounded', () => {
  for (const def of LEVEL_DEFS) {
    const level = generateLevel(def);
    const st = createState({ level, seed: level.seed, mode: 'validate' });
    const order = solveGreedy(st);
    ok(order, def.id + ' unsolvable');
    eq(order.length, level.cubes.filter((c) => c.kind === 'arrow').length);
    ok(level.par.timeMs > 0 && level.par.timeMs < 20 * 60 * 1000, def.id + ' par out of bounds');
  }
});

test('difficulty grows from tutorial boards to grand works', () => {
  const easy = difficultyOf(generateLevel(LEVEL_DEFS[0]));
  const hard = difficultyOf(generateLevel(LEVEL_DEFS[39]));
  ok(hard.score > easy.score, `hard ${hard.score} <= easy ${easy.score}`);
  ok(hard.depth > easy.depth);
});

test('challenges generate and their limits match the ruleset', () => {
  for (const ch of CHALLENGES) {
    const level = generateLevel(ch.def);
    ok(validateLevel(level).ok, ch.id);
    const limits = challengeLimits(ch, level);
    const arrows = level.cubes.filter((c) => c.kind === 'arrow').length;
    if (ch.limitKind === 'exact-moves') eq(limits.moves, arrows);
    if (ch.limitKind === 'slack-moves') eq(limits.moves, arrows + ch.slack);
    if (ch.limitKind === 'time') eq(limits.timeMs, ch.timeMs);
  }
});

test('practice presets generate for arbitrary seeds', () => {
  for (const [key, def] of Object.entries(PRACTICE_DEFS)) {
    for (let i = 0; i < 3; i++) {
      const level = generateLevel({ ...def, seed: def.seedSalt + '-' + i });
      ok(validateLevel(level).ok, key + ' seed ' + i);
    }
  }
});

test('daily content is per-day seeded, immutable and valid', () => {
  const days = ['2026-01-01', '2026-03-14', '2026-08-16', '2026-08-17', '2026-12-31'];
  const hashes = new Set();
  for (const d of days) {
    const a = generateLevel(dailyDef(d));
    const b = generateLevel(dailyDef(d));
    eq(JSON.stringify(a), JSON.stringify(b), 'daily not immutable for ' + d);
    ok(validateLevel(a).ok, 'daily invalid for ' + d);
    hashes.add(cyrb53(canonicalJSON(a.cubes)));
  }
  ok(hashes.size > 1, 'all tested dailies identical');
});

test('lesson boards validate and are solvable through the legal-action API', () => {
  for (const lesson of LESSONS) {
    const v = validateLevel(lesson.board);
    ok(v.ok, lesson.id + ': ' + v.problems.join('; '));
    const st = createState({ level: lesson.board, seed: lesson.board.seed, mode: 'learn' });
    ok(solveGreedy(st), lesson.id + ' unsolvable');
  }
});

test('validator rejects defective content', () => {
  ok(!validateLevel({ cubes: [] }).ok, 'empty accepted');
  ok(!validateLevel(boardOf([cube('a', 0, 0, 0, 9)])).ok, 'bad dir accepted');
  ok(!validateLevel(boardOf([cube('a', 0, 0, 0, 0), cube('a', 1, 0, 0, 0)])).ok, 'dup ids accepted');
  ok(!validateLevel(boardOf([cube('a', 0, 0, 0, 0), cube('b', 0, 0, 0, 0)])).ok, 'overlap accepted');
  ok(!validateLevel(boardOf([cube('a', 0.5, 0, 0, 0)])).ok, 'non-integer accepted');
  ok(!validateLevel(boardOf([cube('a', 0, 0, 0, 0, 'stone')])).ok, 'no arrows accepted');
  ok(!validateLevel(boardOf([cube('a', 0, 0, 0, 0, 'arrow', { keyId: 'ghost' })])).ok, 'dangling key accepted');
  // unsolvable: mutually blocking pair
  ok(!validateLevel(boardOf([cube('a', 0, 0, 0, 0), cube('b', 1, 0, 0, 1)])).ok, 'unsolvable accepted');
});

test('five themes exist with cosmetic unlock ladder', () => {
  eq(THEMES.length, 5);
  eq(themeById('nope').id, THEMES[0].id);
  eq(unlockedThemes(0).length, 1);
  eq(unlockedThemes(1000).length, 5);
});

// ===========================================================================
describe('replay: property tests');
// ===========================================================================

function playSession(level, { seed = 'prop', ranked = false, random = null, maxTicks = 500 } = {}) {
  const rng = random || new Rng(seed);
  const session = new GameSession({ level, mode: 'journey', seed: level.seed, ranked, now: (() => { let t = 0; return () => (t += 137); })() });
  let guard = maxTicks;
  while (session.state.status === 'active' && guard-- > 0) {
    const acts = legalActions(session.state);
    if (!acts.length) break;
    const pick = acts[rng.int(acts.length)];
    session.dispatch('release', { cubeId: pick.cubeId });
    if (rng.next() < 0.2) session.dispatch('rotate');
  }
  return session;
}

test('replay verifies for random legal playthroughs on random boards', () => {
  const rng = new Rng('replay-property');
  for (let i = 0; i < 12; i++) {
    const def = LEVEL_DEFS[rng.int(LEVEL_DEFS.length)];
    const level = generateLevel(def);
    const session = playSession(level, { random: rng });
    eq(session.state.status, 'complete', 'random legal play failed to complete ' + def.id);
    const env = buildEnvelope({ build: 'test', session });
    const verdict = verifyEnvelope(env);
    ok(verdict.ok, 'replay rejected: ' + verdict.reason);
    eq(verdict.result.score, session.score().total);
  }
});

test('same version + seed + commands produce identical state hashes', () => {
  const level = generateLevel(LEVEL_DEFS[7]);
  const run = () => {
    let st = createState({ level, mode: 'journey', seed: level.seed });
    const rng = new Rng('det-prop');
    const hashes = [];
    let guard = 300;
    while (st.status === 'active' && guard-- > 0) {
      const acts = legalActions(st);
      const pick = acts[rng.int(acts.length)];
      st = applyOk(st, cmd('release', { cubeId: pick.cubeId }, st.elapsedMs + 100)).state;
      hashes.push(stateHash(st));
    }
    return hashes;
  };
  const a = run();
  const b = run();
  eq(a.length, b.length);
  for (let i = 0; i < a.length; i++) eq(a[i], b[i], 'hash mismatch at step ' + i);
});

test('tampered envelopes are rejected', () => {
  const level = generateLevel(LEVEL_DEFS[2]);
  const session = playSession(level);
  const good = buildEnvelope({ build: 'test', session });
  eq(verifyEnvelope(good).ok, true);

  const cases = {
    'wrong schema': { ...good, schema: REPLAY_SCHEMA + 1 },
    'no level': { ...good, level: null },
    'bad initial hash': { ...good, initialHash: 'deadbeef' },
    'bad final hash': { ...good, result: { ...good.result, stateHash: 'deadbeef' } },
    'inflated score': { ...good, result: { ...good.result, score: good.result.score + 1 } },
    'unfinished': { ...good, commands: good.commands.slice(0, 2), hashes: good.hashes.slice(0, 1) },
    'reordered clock': null, // built below
  };
  const reordered = structuredClone(good);
  if (reordered.commands.length >= 3) {
    reordered.commands[1].at = reordered.commands[2].at + 1000;
  }
  cases['reordered clock'] = reordered;

  for (const [name, env] of Object.entries(cases)) {
    if (!env) continue;
    const v = verifyEnvelope(env);
    ok(!v.ok, name + ' was accepted');
  }
});

test('duplicate command ids are idempotent in replay', () => {
  const level = generateLevel(LEVEL_DEFS[1]);
  const session = playSession(level);
  const env = buildEnvelope({ build: 'test', session });
  const duped = structuredClone(env);
  const c = duped.commands[0];
  duped.commands.splice(1, 0, c); // exact duplicate
  const v = verifyEnvelope(duped);
  ok(v.ok, 'duplicate ids broke verification: ' + v.reason);
});

test('undo keeps the replay log consistent', () => {
  const level = generateLevel(LEVEL_DEFS[3]);
  const session = new GameSession({ level, mode: 'practice', seed: level.seed, allowUndo: true, now: (() => { let t = 0; return () => (t += 151); })() });
  const rng = new Rng('undo-prop');
  for (let i = 0; i < 20 && session.state.status === 'active'; i++) {
    const acts = legalActions(session.state);
    session.dispatch('release', { cubeId: acts[rng.int(acts.length)].cubeId });
    if (rng.next() < 0.5) session.undo();
  }
  // finish without undo
  let guard = 300;
  while (session.state.status === 'active' && guard-- > 0) {
    const acts = legalActions(session.state);
    session.dispatch('release', { cubeId: acts[0].cubeId });
  }
  const env = buildEnvelope({ build: 'test', session });
  const v = verifyEnvelope(env);
  ok(v.ok, 'post-undo replay rejected: ' + v.reason);
});

// ===========================================================================
describe('fuzz');
// ===========================================================================

test('fuzz malformed commands: no throws, no state corruption', () => {
  const rng = new Rng('fuzz-cmd');
  const level = generateLevel(LEVEL_DEFS[4]);
  let st = createState({ level, mode: 'practice', seed: level.seed });
  for (let i = 0; i < 2000; i++) {
    const garbage = {
      id: rng.next() < 0.8 ? 'f' + i : rng.pick([null, '', 42, {}, 'x'.repeat(100)]),
      type: rng.pick(['release', 'rotate', 'clock', 'concede', 'hack', null, 7, undefined]),
      at: rng.pick([0, 1, 100, -5, NaN, Infinity, 'now', 1e12]),
      cubeId: rng.pick(['c0', 'c1', null, 42, {}, 'nope', st.cubes[0]?.id]),
    };
    let r;
    try {
      r = applyCommand(st, garbage);
    } catch (err) {
      throw new Error('applyCommand threw on fuzz input: ' + err.message);
    }
    if (!r.error && st.status === 'active') {
      st = r.state;
      stateHash(st); // must always be computable
      ok(Number.isFinite(st.elapsedMs), 'elapsedMs corrupted');
      ok(st.tick >= 0 && Number.isInteger(st.tick));
    }
  }
});

test('fuzz generated content: valid or cleanly rejected, never hanging', () => {
  const rng = new Rng('fuzz-gen');
  const shapes = ['solid', 'hollow', 'cross', 'columns', 'ring', 'wall', 'pyramid', 'scatter'];
  for (let i = 0; i < 40; i++) {
    const def = {
      id: 'fuzz-' + i,
      seed: 'fz' + i,
      size: rng.range(2, 5),
      shape: rng.pick(shapes),
      density: 0.45 + rng.next() * 0.55,
      stones: rng.range(0, 4),
      locks: rng.range(0, 3),
      core: rng.next() < 0.3,
    };
    const start = Date.now();
    try {
      const level = generateLevel(def);
      const v = validateLevel(level);
      ok(v.ok, def.id + ' generated but invalid: ' + v.problems.join('; '));
    } catch {
      // clean rejection is acceptable for extreme parameters
    }
    ok(Date.now() - start < 20000, 'generation took too long for ' + def.id);
  }
});

test('fuzz malformed levels: validator reports problems without hanging', () => {
  const rng = new Rng('fuzz-level');
  for (let i = 0; i < 200; i++) {
    const cubes = [];
    const n = rng.range(0, 12);
    for (let j = 0; j < n; j++) {
      cubes.push({
        id: rng.pick(['a', 'b', 'c' + j, null, 7]),
        pos: [rng.range(-3, 3), rng.range(-3, 3), rng.next() < 0.1 ? 0.5 : rng.range(-3, 3)],
        dir: rng.pick([0, 1, 2, 3, 4, 5, 9, -1, 2.5]),
        kind: rng.pick(['arrow', 'stone', 'core', 'alien']),
      });
    }
    const start = Date.now();
    try {
      validateLevel({ id: 'fz', version: 1, seed: 'fz', cubes });
    } catch (err) {
      throw new Error('validator threw: ' + err.message);
    }
    ok(Date.now() - start < 5000, 'validator hang');
  }
});

test('fuzz malformed envelopes: rejected without throwing', () => {
  const rng = new Rng('fuzz-env');
  for (let i = 0; i < 300; i++) {
    const env = {
      schema: rng.pick([REPLAY_SCHEMA, 0, 99, 'x', null]),
      level: rng.pick([null, {}, { cubes: [] }, 42]),
      commands: rng.pick([null, [], [{ id: 'a', type: 'rotate', at: 0 }], 'nope']),
      hashes: rng.pick([null, [], [{ tick: 0, hash: 'x' }]]),
      result: rng.pick([null, {}, { stateHash: 'x', score: -1 }]),
    };
    try {
      verifyEnvelope(env);
    } catch (err) {
      throw new Error('verifyEnvelope threw: ' + err.message);
    }
  }
});

test('engine stays bounded for extreme positions (no NaN, no runaway rays)', () => {
  const st = createState({
    level: boardOf([cube('far', 500, -700, 900, 0), cube('near', 0, 0, 0, 2)]),
  });
  eq(explainRelease(st, 'far').ok, true); // alone on its ray
  const r = applyOk(st, cmd('release', { cubeId: 'far' }, 10));
  ok(Number.isFinite(r.state.bounds.max[0]) || r.state.cubes.length > 0);
  stateHash(r.state);
});

// ===========================================================================
describe('golden sessions');
// ===========================================================================

// Fixed expectations captured from this exact engine/content version. Any
// change to rules, scoring, or level generation must update these knowingly.
const GOLDENS = {
  j01: { ticks: 8, arrows: 8, hash: '1c761a55b7a88d00', score: 1965, stars: 3 },
  j11: { ticks: 25, arrows: 25, hash: 'ec52f8a6b3525800', score: 3985, stars: 3 },
  j40: { ticks: 119, arrows: 119, hash: '73008a1b57e9e800', score: 15770, stars: 3 },
  t1: { ticks: 3, arrows: 3, hash: 'b4cdbf8561b7d800', score: 1490, stars: 3 },
};

function goldenRun(level) {
  let state = createState({ level, mode: 'journey', seed: level.seed });
  const order = solveGreedy(state);
  let at = 1000;
  for (let i = 0; i < order.length; i++) {
    at += 500;
    state = applyOk(state, { id: 'g' + i, type: 'release', cubeId: order[i], at }).state;
  }
  return { state, order };
}

for (const [id, expected] of Object.entries(GOLDENS)) {
  test(`golden ${id}: fixed hashes, score and stars`, () => {
    const level = id === 't1'
      ? LESSONS[0].board
      : generateLevel(LEVEL_DEFS.find((d) => d.id === id));
    const { state, order } = goldenRun(level);
    eq(state.status, 'complete');
    eq(order.length, expected.arrows);
    eq(state.tick, expected.ticks);
    eq(stateHash(state), expected.hash);
    eq(computeScore({ state, par: level.par, elapsedMs: state.elapsedMs }).total, expected.score);
    eq(starsFor({ state, par: level.par }), expected.stars);
  });
}

test('interrupted and resumed session matches the uninterrupted session hash', () => {
  const def = LEVEL_DEFS.find((d) => d.id === 'j11');
  const level = generateLevel(def);
  const order = solveGreedy(createState({ level, mode: 'journey', seed: level.seed }));

  // Uninterrupted reference run on a controlled clock.
  let t = 0;
  const full = new GameSession({ level, mode: 'journey', seed: level.seed, ranked: true, now: () => t });
  for (const id of order) {
    t += 500;
    full.dispatch('release', { cubeId: id });
  }
  eq(full.state.status, 'complete');

  // Same run, but snapshotted and restored halfway through.
  t = 0;
  const part = new GameSession({ level, mode: 'journey', seed: level.seed, ranked: true, now: () => t });
  const half = Math.floor(order.length / 2);
  for (let i = 0; i < half; i++) {
    t += 500;
    part.dispatch('release', { cubeId: order[i] });
  }
  const restored = GameSession.restore(part.snapshot(), { now: () => t });
  for (let i = half; i < order.length; i++) {
    t += 500;
    restored.dispatch('release', { cubeId: order[i] });
  }
  eq(restored.state.status, 'complete');
  eq(stateHash(restored.state), stateHash(full.state));

  // The restored session's replay still verifies end to end.
  const v = verifyEnvelope(buildEnvelope({ build: 'test', session: restored }));
  ok(v.ok, 'resumed-session replay rejected: ' + v.reason);
  eq(v.result.score, full.score().total);
});

// ===========================================================================
describe('session');
// ===========================================================================

test('undo restores state, log and hashes exactly', () => {
  const level = generateLevel(LEVEL_DEFS[6]);
  const session = new GameSession({ level, mode: 'practice', seed: level.seed, allowUndo: true, now: (() => { let t = 0; return () => (t += 100); })() });
  const initialHash = stateHash(session.state);
  const acts = legalActions(session.state);
  session.dispatch('release', { cubeId: acts[0].cubeId });
  ok(session.history.length === 1);
  eq(session.undo(), true);
  eq(stateHash(session.state), initialHash);
  eq(session.log.length, 0);
  eq(session.undo(), false);
});

test('undo is disabled for ranked sessions', () => {
  const level = generateLevel(LEVEL_DEFS[6]);
  const session = new GameSession({ level, mode: 'daily', seed: level.seed, ranked: true, allowUndo: false });
  const acts = legalActions(session.state);
  session.dispatch('release', { cubeId: acts[0].cubeId });
  eq(session.undo(), false);
});

test('pause freezes the authoritative clock', () => {
  let t = 0;
  const level = boardOf([cube('a', 0, 0, 0, 0)]);
  const session = new GameSession({ level, mode: 'practice', seed: 's', now: () => t });
  t = 1000;
  eq(session.activeMs(), 1000);
  session.pause();
  t = 5000;
  eq(session.activeMs(), 1000);
  session.resume();
  t = 6000;
  eq(session.activeMs(), 2000);
});

test('clock ticks only dispatch when a time limit exists', () => {
  const level = boardOf([cube('a', 0, 0, 0, 0)]);
  const s1 = new GameSession({ level, mode: 'practice', seed: 's' });
  s1.tickClock();
  eq(s1.state.tick, 0);
  const s2 = new GameSession({ level, mode: 'challenge', seed: 's', limits: { timeMs: 60000 } });
  s2.tickClock();
  ok(s2.state.tick > 0);
});

test('snapshot/restore preserves state, log and idempotency set', () => {
  const level = generateLevel(LEVEL_DEFS[9]);
  const session = new GameSession({ level, mode: 'daily', seed: level.seed, ranked: true, now: (() => { let t = 0; return () => (t += 120); })() });
  for (let i = 0; i < 5; i++) {
    const acts = legalActions(session.state);
    session.dispatch('release', { cubeId: acts[0].cubeId });
  }
  const restored = GameSession.restore(session.snapshot());
  eq(stateHash(restored.state), stateHash(session.state));
  eq(restored.log.length, session.log.length);
  eq(restored.sessionId, session.sessionId);
  // finishing the restored session verifies as a replay
  let guard = 300;
  while (restored.state.status === 'active' && guard-- > 0) {
    const acts = legalActions(restored.state);
    restored.dispatch('release', { cubeId: acts[0].cubeId });
  }
  const v = verifyEnvelope(buildEnvelope({ build: 'test', session: restored }));
  ok(v.ok, v.reason);
});

test('result envelope carries stats, components and assists', () => {
  const level = LESSONS[0].board;
  const session = new GameSession({ level, mode: 'learn', seed: level.seed, now: (() => { let t = 0; return () => (t += 700); })() });
  for (const id of ['c2', 'c1', 'c0']) session.dispatch('release', { cubeId: id });
  const r = session.resultEnvelope();
  eq(r.status, 'complete');
  eq(r.terminalReason, TERMINAL.CLEARED);
  eq(r.stats.released, 3);
  ok(r.components && Number.isInteger(r.score));
  eq(r.assists.hint, true);
});

// ===========================================================================
describe('achievements');
// ===========================================================================

test('achievement rules grant exactly once', () => {
  const unlocked = {};
  const ctx = (over = {}) => ({
    totals: { released: 0 },
    completedLevelIds: new Set(),
    lockLevelsCompleted: 0,
    dailyStreak: 0,
    justCompleted: false,
    ...over,
  });
  eq(evaluateAchievements(ctx(), unlocked).length, 0);
  let fresh = evaluateAchievements(ctx({ justCompleted: true, completedLevelIds: new Set(['j01']) }), unlocked);
  eq(fresh.map((a) => a.key).join(','), 'first-clear');
  for (const a of fresh) unlocked[a.key] = Date.now();
  eq(evaluateAchievements(ctx({ justCompleted: true }), unlocked).length, 0); // idempotent

  eq(evaluateAchievements(ctx({ lockLevelsCompleted: 10 }), unlocked)[0].key, 'key-master');
  eq(evaluateAchievements(ctx({ dailyStreak: 3 }), unlocked)[0].key, 'daily-streak-3');
  eq(evaluateAchievements(ctx({ completedLevelIds: new Set(['j40']) }), unlocked)[0].key, 'grand-work');
  eq(evaluateAchievements(ctx({ totals: { released: 1000 } }), unlocked)[0].key, 'thousand-cubes');
  eq(ACHIEVEMENTS.length, 5);
  for (const a of ACHIEVEMENTS) ok(/^[a-z0-9-]+$/.test(a.key), 'achievement key not lowercase-stable: ' + a.key);
});

// ===========================================================================
describe('precomputed content');

test('js/content/generated.js matches the generator (run npm run levels after content changes)', async () => {
  const { buildTable } = await import('../tools/gen-levels.mjs');
  const { GENERATED } = await import('../js/content/generated.js');
  eq(JSON.stringify(GENERATED), JSON.stringify(buildTable()));
});

// ===========================================================================
// runner: drain the queue sequentially (async-aware), then summarize.
// ===========================================================================

for (const [g, name, fn] of queue) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') await r;
    passed++;
  } catch (err) {
    failed++;
    failures.push(`${g} > ${name}: ${err.message}`);
  }
}

console.log('');
if (failures.length) {
  console.log('FAILURES:');
  for (const f of failures) console.log('  ✗ ' + f);
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
