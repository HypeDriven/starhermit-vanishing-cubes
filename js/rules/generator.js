// Seeded content generator + offline validator.
// Every generated level is proven solvable by the engine's own greedy solver
// before it is handed out, so soft locks are impossible by construction.

import { Rng } from './rng.js';
import { DIRS, createState, solveGreedy, legalActions, applyCommand, posKey } from './engine.js';

const MAX_CUBES = 150;
const MAX_ATTEMPTS = 400;

// ---------- shapes (occupied cell sets) ----------
// Cells are filtered in integer index space (0..n-1 per axis, center c) and
// then mapped to integer world coordinates. Even sizes sit half a cell off
// the origin; coordinates always stay integers, as the validator requires.

function cellsFor(shape, size) {
  const n = size;
  const o = -Math.floor((n - 1) / 2); // integer centering offset
  const c = (n - 1) / 2; // center in index space (integer for odd n)
  const all = [];
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      for (let z = 0; z < n; z++) {
        all.push([x, y, z]);
      }
    }
  }
  const central = (v) => Math.abs(v - c) < 0.6; // center layer (two layers for even n)
  let picked;
  switch (shape) {
    case 'solid':
      picked = all;
      break;
    case 'hollow':
      picked = all.filter(
        ([x, y, z]) => !(x > 0 && x < n - 1 && y > 0 && y < n - 1 && z > 0 && z < n - 1),
      );
      break;
    case 'cross': {
      picked = all.filter(([x, y, z]) => {
        const ax = central(x) ? 1 : 0;
        const ay = central(y) ? 1 : 0;
        const az = central(z) ? 1 : 0;
        return ax + ay + az >= 2;
      });
      break;
    }
    case 'columns': {
      const out = [];
      for (let x = 0; x < n; x++) {
        for (let z = 0; z < n; z++) {
          if ((x + z) % 2 === 0) {
            for (let y = 0; y < n; y++) out.push([x, y, z]);
          }
        }
      }
      picked = out;
      break;
    }
    case 'ring': {
      picked = all.filter(([x, y, z]) => {
        const onPlane = y === Math.round(c);
        const edge = Math.abs(x - c) > c - 1.01 || Math.abs(z - c) > c - 1.01;
        return onPlane && edge;
      });
      break;
    }
    case 'wall': {
      picked = all.filter(([, y]) => y === Math.round(c));
      break;
    }
    case 'pyramid': {
      picked = all.filter(([x, y, z]) => {
        const layer = y; // 0..n-1
        const r = c - layer / 2;
        return Math.abs(x - c) <= r + 0.01 && Math.abs(z - c) <= r + 0.01;
      });
      break;
    }
    case 'scatter':
      picked = all; // density pass trims later
      break;
    default:
      picked = all;
  }
  return picked.map(([x, y, z]) => [x + o, y + o, z + o]);
}

function neighborCount(set, pos) {
  let n = 0;
  for (const d of DIRS) {
    if (set.has(posKey([pos[0] + d[0], pos[1] + d[1], pos[2] + d[2]]))) n++;
  }
  return n;
}

// ---------- generation ----------

function tryGenerate(def, rng) {
  const size = def.size;
  let cells = cellsFor(def.shape || 'solid', size);

  const density = def.density == null ? 1 : def.density;
  if (density < 1) {
    rng.shuffle(cells);
    const keep = Math.max(4, Math.round(cells.length * density));
    cells = cells.slice(0, keep);
  }
  if (cells.length < 2 || cells.length > MAX_CUBES) return null;

  const cellSet = new Set(cells.map(posKey));

  // Stones: prefer well-surrounded cells so they genuinely block paths.
  const stoneTarget = Math.min(def.stones || 0, Math.max(0, cells.length - 4));
  const byCoverage = cells
    .slice()
    .sort((a, b) => neighborCount(cellSet, b) - neighborCount(cellSet, a));
  const stoneCells = [];
  const pool = byCoverage.slice(0, Math.max(stoneTarget * 3, stoneTarget));
  rng.shuffle(pool);
  for (const c of pool) {
    if (stoneCells.length >= stoneTarget) break;
    stoneCells.push(c);
  }
  const stoneSet = new Set(stoneCells.map(posKey));

  // Optional core: the most central stone becomes the core to expose.
  let coreKey = null;
  if (def.core) {
    let best = null;
    let bestD = Infinity;
    for (const c of stoneCells.length ? stoneCells : cells) {
      const d = c[0] * c[0] + c[1] * c[1] + c[2] * c[2];
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    coreKey = posKey(best);
    if (!stoneSet.has(coreKey)) {
      stoneSet.add(coreKey);
      stoneCells.push(best);
    }
  }

  const arrowCells = cells.filter((c) => !stoneSet.has(posKey(c)));
  if (arrowCells.length < 1) return null;

  // Peel-order generation: repeatedly remove a cube that currently has at
  // least one clear ray (stones always block), and give it one of its
  // currently-clear directions. This mirrors how the board is solved, so the
  // puzzle is solvable by construction — the validator still proves it.
  const dirSet = def.dirSet && def.dirSet.length ? def.dirSet : [0, 1, 2, 3, 4, 5];
  const arrows = new Map(); // posKey -> dir
  const order = [];
  {
    const remaining = new Set(arrowCells.map(posKey));
    const occ = new Set(cells.map(posKey));
    let guard = 4096;
    while (remaining.size && guard-- > 0) {
      const free = [];
      for (const k of remaining) {
        const pos = k.split(',').map(Number);
        const valid = [];
        for (const di of dirSet) {
          const d = DIRS[di];
          const p = [pos[0], pos[1], pos[2]];
          let clear = true;
          for (let step = 0; step < 64; step++) {
            p[0] += d[0];
            p[1] += d[1];
            p[2] += d[2];
            if (occ.has(posKey(p))) {
              clear = false;
              break;
            }
            if (Math.abs(p[0]) > size && Math.abs(p[1]) > size && Math.abs(p[2]) > size) break;
          }
          if (clear) valid.push(di);
        }
        if (valid.length) free.push({ k, pos, valid });
      }
      if (!free.length) return null;
      const chosen = rng.pick(free);
      arrows.set(chosen.k, rng.pick(chosen.valid));
      remaining.delete(chosen.k);
      occ.delete(chosen.k);
      order.push(chosen.pos);
    }
    if (guard <= 0) return null;
  }
  const orderIndex = new Map(order.map((c, i) => [posKey(c), i]));

  // Locks: locked cube must come later in the removal order than its key.
  const cubes = [];
  let seq = 0;
  for (const cell of cells) {
    const k = posKey(cell);
    const isStone = stoneSet.has(k);
    const kind = k === coreKey ? 'core' : isStone ? 'stone' : 'arrow';
    cubes.push({
      id: 'c' + seq++,
      pos: cell,
      dir: kind === 'arrow' ? arrows.get(k) : rng.pick(dirSet),
      kind,
      lock: null,
      _order: orderIndex.has(k) ? orderIndex.get(k) : -1,
    });
  }
  const arrowCubes = cubes.filter((c) => c.kind === 'arrow').sort((a, b) => a._order - b._order);
  const lockTarget = Math.min(def.locks || 0, Math.floor(arrowCubes.length / 3));
  let placed = 0;
  let guard = 200;
  while (placed < lockTarget && guard-- > 0) {
    const locked = arrowCubes[rng.range(2, arrowCubes.length - 1)];
    if (!locked || locked.lock) continue;
    const keyPool = arrowCubes.filter((c) => c._order < locked._order - 1 && !c.lock);
    if (!keyPool.length) continue;
    const key = rng.pick(keyPool);
    locked.lock = { keyId: key.id };
    placed++;
  }
  for (const c of cubes) delete c._order;

  const arrowsCount = arrowCubes.length;
  const par = {
    taps: arrowsCount + Math.max(1, Math.round(arrowsCount * 0.12)),
    rotations: def.parRotations != null ? def.parRotations : 2 + Math.ceil(size / 2),
    timeMs: Math.round(arrowsCount * (2600 + size * 250) * (def.parScale || 1)),
  };

  return {
    id: def.id,
    version: def.version || 1,
    name: def.name || def.id,
    chapter: def.chapter || 0,
    theme: def.theme || 'dawn',
    mechanics: def.mechanics || [],
    tip: def.tip || '',
    mastery: !!def.mastery,
    seed: def.seed,
    generator: {
      shape: def.shape || 'solid',
      size,
      density,
      stones: stoneTarget,
      locks: lockTarget,
      dirSet,
    },
    cubes,
    par,
  };
}

export function generateLevel(def) {
  const rng = new Rng('level:' + def.seed);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const level = tryGenerate(def, rng.fork('attempt-' + attempt));
    if (!level) continue;
    const v = validateLevel(level);
    if (v.ok) return level;
  }
  throw new Error('generator failed for level def ' + def.id);
}

// ---------- validation ----------

export function validateLevel(level) {
  const problems = [];
  if (!level || !Array.isArray(level.cubes)) {
    return { ok: false, problems: ['no cubes'] };
  }
  if (level.cubes.length === 0) problems.push('empty');
  if (level.cubes.length > MAX_CUBES) problems.push('too many cubes: ' + level.cubes.length);
  const ids = new Set();
  const positions = new Set();
  let arrows = 0;
  for (const c of level.cubes) {
    if (ids.has(c.id)) problems.push('duplicate id ' + c.id);
    ids.add(c.id);
    const k = posKey(c.pos);
    if (positions.has(k)) problems.push('overlapping position ' + k);
    positions.add(k);
    if (!Number.isInteger(c.pos[0]) || !Number.isInteger(c.pos[1]) || !Number.isInteger(c.pos[2])) {
      problems.push('non-integer position');
    }
    if (!Number.isInteger(c.dir) || c.dir < 0 || c.dir > 5) problems.push('bad dir on ' + c.id);
    if (!['arrow', 'stone', 'core'].includes(c.kind)) problems.push('bad kind on ' + c.id);
    if (c.kind === 'arrow') arrows++;
    if (Math.abs(c.pos[0]) > 8 || Math.abs(c.pos[1]) > 8 || Math.abs(c.pos[2]) > 8) {
      problems.push('out of bounds ' + c.id);
    }
  }
  if (arrows === 0) problems.push('no arrow cubes');
  for (const c of level.cubes) {
    if (c.lock) {
      const key = level.cubes.find((k2) => k2.id === c.lock.keyId);
      if (!key) problems.push('lock ' + c.id + ' references missing key');
      else if (key.kind !== 'arrow') problems.push('lock ' + c.id + ' key is not an arrow cube');
    }
  }
  if (problems.length === 0) {
    const state = createState({ level, seed: level.seed, mode: 'validate' });
    const solution = solveGreedy(state);
    if (!solution) problems.push('unsolvable');
    else if (solution.length !== arrows) problems.push('solution does not clear board');
  }
  return { ok: problems.length === 0, problems };
}

// Difficulty is measured from solution depth, branching factor and mechanics —
// not merely bigger numbers. Used for journey ordering and par sanity.
export function difficultyOf(level) {
  let state = createState({ level, seed: level.seed, mode: 'validate' });
  const depth = level.cubes.filter((c) => c.kind === 'arrow').length;
  let branchSum = 0;
  let steps = 0;
  let guard = 4096;
  while (state.status === 'active' && guard-- > 0) {
    const acts = legalActions(state);
    if (!acts.length) break;
    branchSum += acts.length;
    steps++;
    const r = applyCommandForDifficulty(state, acts[0].cubeId);
    state = r;
  }
  const branching = steps ? branchSum / steps : 0;
  const mechanics = (level.mechanics || []).length;
  const score = depth * 1.0 + branching * 2.5 + mechanics * 6 + (level.generator.size - 2) * 4;
  return { depth, branching: Math.round(branching * 100) / 100, mechanics, score: Math.round(score * 10) / 10 };
}

function applyCommandForDifficulty(state, cubeId) {
  return applyCommand(state, {
    id: 'diff-' + state.tick,
    type: 'release',
    cubeId,
    at: state.elapsedMs,
  }).state;
}
