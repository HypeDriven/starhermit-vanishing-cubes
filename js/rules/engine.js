// Vanishing Cubes rules engine.
// Pure, deterministic, DOM-free. All state transitions happen through
// applyCommand(); nothing else may mutate rules state. State is JSON
// serializable; every applied command advances the monotonic tick.

import { cyrb53 } from './rng.js';

export const STATE_VERSION = 1;

// Grid-aligned directions. Index is stored on cubes as `dir`.
export const DIRS = Object.freeze([
  [1, 0, 0], // 0 east  +X
  [-1, 0, 0], // 1 west  -X
  [0, 1, 0], // 2 up    +Y
  [0, -1, 0], // 3 down  -Y
  [0, 0, 1], // 4 south +Z
  [0, 0, -1], // 5 north -Z
]);
export const DIR_NAMES = Object.freeze([
  'east', 'west', 'up', 'down', 'south', 'north',
]);

export const COMMAND_TYPES = Object.freeze(['release', 'rotate', 'clock', 'concede']);

export const TERMINAL = Object.freeze({
  CLEARED: 'cleared',
  MOVES: 'moves-exhausted',
  TIME: 'time-exhausted',
  NO_MOVES: 'no-legal-moves',
  CONCEDED: 'conceded',
});

const MAX_RAY_STEPS = 64;

export function posKey(pos) {
  return pos[0] + ',' + pos[1] + ',' + pos[2];
}

export function cubeById(state, id) {
  return state.cubes.find((c) => c.id === id) || null;
}

function computeBounds(cubes) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const c of cubes) {
    for (let i = 0; i < 3; i++) {
      if (c.pos[i] < min[i]) min[i] = c.pos[i];
      if (c.pos[i] > max[i]) max[i] = c.pos[i];
    }
  }
  return { min, max };
}

// level: {id, version, cubes:[{id,pos,dir,kind,lock?}], par, ...}
export function createState({ level, mode = 'practice', seed, limits = {} }) {
  const cubes = level.cubes.map((c) => ({
    id: c.id,
    pos: [c.pos[0], c.pos[1], c.pos[2]],
    dir: c.dir,
    kind: c.kind,
    lock: c.lock ? { keyId: c.lock.keyId, open: false } : null,
  }));
  return {
    version: STATE_VERSION,
    mode,
    seed: String(seed),
    levelId: level.id,
    levelVersion: level.version || 1,
    tick: 0,
    status: 'active',
    terminalReason: null,
    cubes,
    bounds: computeBounds(cubes),
    stats: { taps: 0, rotations: 0, invalid: 0, released: 0 },
    limits: {
      moves: limits.moves == null ? null : limits.moves | 0,
      timeMs: limits.timeMs == null ? null : limits.timeMs | 0,
    },
    elapsedMs: 0,
  };
}

export function remainingArrows(state) {
  let n = 0;
  for (const c of state.cubes) if (c.kind === 'arrow') n++;
  return n;
}

function occupancyMap(state) {
  const map = new Map();
  for (const c of state.cubes) map.set(posKey(c.pos), c);
  return map;
}

// First cube occupying the ray from `cube` along its arrow direction, if any.
export function firstCubeOnRay(state, cube, occ = null) {
  const map = occ || occupancyMap(state);
  const d = DIRS[cube.dir];
  const p = [cube.pos[0], cube.pos[1], cube.pos[2]];
  for (let i = 0; i < MAX_RAY_STEPS; i++) {
    p[0] += d[0];
    p[1] += d[1];
    p[2] += d[2];
    const hit = map.get(posKey(p));
    if (hit) return hit;
    const b = state.bounds;
    if (
      p[0] < b.min[0] - 1 || p[0] > b.max[0] + 1 ||
      p[1] < b.min[1] - 1 || p[1] > b.max[1] + 1 ||
      p[2] < b.min[2] - 1 || p[2] > b.max[2] + 1
    ) {
      return null;
    }
  }
  return null;
}

// Cells the ray passes through until it leaves the assembly (for previews).
export function rayCells(state, cube, maxCells = 12) {
  const occ = occupancyMap(state);
  const d = DIRS[cube.dir];
  const cells = [];
  const p = [cube.pos[0], cube.pos[1], cube.pos[2]];
  let blockedBy = null;
  for (let i = 0; i < maxCells; i++) {
    p[0] += d[0];
    p[1] += d[1];
    p[2] += d[2];
    const hit = occ.get(posKey(p));
    if (hit) {
      blockedBy = hit.id;
      break;
    }
    const b = state.bounds;
    if (
      p[0] < b.min[0] - 1 || p[0] > b.max[0] + 1 ||
      p[1] < b.min[1] - 1 || p[1] > b.max[1] + 1 ||
      p[2] < b.min[2] - 1 || p[2] > b.max[2] + 1
    ) {
      break;
    }
    cells.push([p[0], p[1], p[2]]);
  }
  return { cells, blockedBy };
}

export function explainRelease(state, cubeId) {
  if (state.status !== 'active') {
    return { ok: false, reason: 'not-active', message: 'The round is over.' };
  }
  const cube = cubeById(state, cubeId);
  if (!cube) return { ok: false, reason: 'gone', message: 'That cube is already gone.' };
  if (cube.kind === 'stone') {
    return { ok: false, reason: 'stone', message: 'Stone cubes cannot be released.' };
  }
  if (cube.kind === 'core') {
    return { ok: false, reason: 'core', message: 'The core stays put — clear everything around it.' };
  }
  if (cube.lock && !cube.lock.open) {
    const key = cubeById(state, cube.lock.keyId);
    return {
      ok: false,
      reason: 'locked',
      keyId: cube.lock.keyId,
      message: key
        ? `Locked — release the keyed cube (${key.id}) first.`
        : 'Locked — its key is missing.',
    };
  }
  const occ = occupancyMap(state);
  const hit = firstCubeOnRay(state, cube, occ);
  if (hit) {
    return {
      ok: false,
      reason: 'blocked',
      by: hit.id,
      message: `Path blocked by ${hit.kind === 'stone' ? 'a stone cube' : 'cube ' + hit.id}.`,
    };
  }
  return { ok: true };
}

// The legal-action API. Tutorials, hints and play all call this — rules are
// never duplicated outside the engine.
export function legalActions(state) {
  if (state.status !== 'active') return [];
  const occ = occupancyMap(state);
  const out = [];
  for (const c of state.cubes) {
    if (c.kind !== 'arrow') continue;
    if (c.lock && !c.lock.open) continue;
    if (firstCubeOnRay(state, c, occ)) continue;
    out.push({ type: 'release', cubeId: c.id });
  }
  return out;
}

function fail(st, reason, events) {
  st.status = 'failed';
  st.terminalReason = reason;
  events.push({ type: 'failed', reason });
}

function checkTerminalAfterTap(st, events) {
  if (st.status !== 'active') return;
  if (remainingArrows(st) === 0) {
    st.status = 'complete';
    st.terminalReason = TERMINAL.CLEARED;
    events.push({ type: 'complete' });
    return;
  }
  if (st.limits.moves != null && st.stats.taps >= st.limits.moves) {
    fail(st, TERMINAL.MOVES, events);
    return;
  }
  if (legalActions(st).length === 0) {
    fail(st, TERMINAL.NO_MOVES, events);
  }
}

// cmd: {id:string, type, at:int(ms, quantized), cubeId?}
// Returns {state, events, error?}. On `error` the returned state is the
// unchanged input state. Pure: input state is never mutated.
export function applyCommand(state, cmd) {
  if (
    !cmd || typeof cmd !== 'object' ||
    typeof cmd.id !== 'string' || cmd.id.length === 0 || cmd.id.length > 64 ||
    !COMMAND_TYPES.includes(cmd.type) ||
    !Number.isFinite(cmd.at) || cmd.at < 0
  ) {
    return { state, events: [], error: { code: 'malformed', message: 'Malformed command.' } };
  }
  if (state.status !== 'active') {
    return { state, events: [], error: { code: 'not-active', message: 'Round is not active.' } };
  }

  const st = structuredClone(state);
  const events = [];
  st.tick += 1;
  const at = Math.floor(cmd.at);
  if (at > st.elapsedMs) st.elapsedMs = at;

  // A time limit applies to every command that arrives after it expired.
  if (st.limits.timeMs != null && st.elapsedMs > st.limits.timeMs && cmd.type !== 'concede') {
    fail(st, TERMINAL.TIME, events);
    return { state: st, events };
  }

  switch (cmd.type) {
    case 'clock': {
      events.push({ type: 'clock', elapsedMs: st.elapsedMs });
      break;
    }
    case 'rotate': {
      st.stats.rotations += 1;
      events.push({ type: 'rotate', rotations: st.stats.rotations });
      break;
    }
    case 'concede': {
      fail(st, TERMINAL.CONCEDED, events);
      break;
    }
    case 'release': {
      if (typeof cmd.cubeId !== 'string') {
        return { state, events: [], error: { code: 'malformed', message: 'release needs cubeId.' } };
      }
      st.stats.taps += 1;
      const ex = explainRelease(st, cmd.cubeId);
      if (!ex.ok) {
        st.stats.invalid += 1;
        events.push({ type: 'invalid', cubeId: cmd.cubeId, reason: ex.reason, message: ex.message });
        checkTerminalAfterTap(st, events);
        break;
      }
      const cube = cubeById(st, cmd.cubeId);
      const snapshot = { id: cube.id, pos: [...cube.pos], dir: cube.dir };
      st.cubes = st.cubes.filter((c) => c.id !== cmd.cubeId);
      st.stats.released += 1;
      events.push({ type: 'release', cubeId: cmd.cubeId, pos: snapshot.pos, dir: snapshot.dir });
      for (const other of st.cubes) {
        if (other.lock && !other.lock.open && other.lock.keyId === cmd.cubeId) {
          other.lock.open = true;
          events.push({ type: 'unlock', cubeId: other.id, keyId: cmd.cubeId });
        }
      }
      checkTerminalAfterTap(st, events);
      break;
    }
  }
  return { state: st, events };
}

// Greedy solver: because releases never reduce legality (removals only open
// paths; locks only open), a greedy walk solves every solvable board. Used by
// content validation and hints.
export function solveGreedy(state) {
  let st = structuredClone(state);
  const order = [];
  let guard = 4096;
  while (st.status === 'active' && guard-- > 0) {
    const acts = legalActions(st);
    if (acts.length === 0) return null;
    const r = applyCommand(st, { id: 'solver-' + st.tick, type: 'release', cubeId: acts[0].cubeId, at: st.elapsedMs });
    if (r.error) return null;
    st = r.state;
    order.push(acts[0].cubeId);
  }
  return st.status === 'complete' ? order : null;
}

export function hintAction(state) {
  const acts = legalActions(state);
  return acts.length ? acts[0] : null;
}

// ---------- serialization ----------

export function serialize(state) {
  return JSON.stringify(state);
}

export function migrate(state) {
  // Versioned migrations. v1 is current; the function is the single place
  // future migrations attach to, and is covered by tests.
  if (!state || typeof state !== 'object') throw new Error('bad state');
  if (state.version === STATE_VERSION) return state;
  if (state.version == null || state.version > STATE_VERSION) {
    throw new Error('unsupported state version ' + state.version);
  }
  // Placeholder migration path for future versions.
  const migrated = structuredClone(state);
  migrated.version = STATE_VERSION;
  return migrated;
}

export function deserialize(json) {
  const parsed = typeof json === 'string' ? JSON.parse(json) : json;
  return migrate(parsed);
}

// Canonical JSON (sorted object keys) so hashes are stable across engines.
export function canonicalJSON(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJSON(value[k])).join(',') + '}';
}

export function stateHash(state) {
  return cyrb53(canonicalJSON(state)).toString(16);
}
