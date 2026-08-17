// Replay envelopes: schema version, build/content version, seed, initial
// hash, quantized ordered commands, periodic state hashes, terminal result.
// Verification re-runs the deterministic engine and compares every checkpoint.

import { createState, applyCommand, stateHash, serialize, deserialize } from './engine.js';
import { computeScore } from './scoring.js';

export const REPLAY_SCHEMA = 1;

export function buildEnvelope({ build, session }) {
  const initial = deserialize(session.initialSnapshot);
  return {
    schema: REPLAY_SCHEMA,
    build,
    contentVersion: session.state.levelVersion,
    seed: session.state.seed,
    mode: session.state.mode,
    levelId: session.state.levelId,
    level: session.level,
    limits: session.state.limits,
    initialHash: stateHash(initial),
    startedAtUnixMs: session.startedAtUnixMs,
    commands: session.log.slice(),
    hashes: session.hashes.slice(),
    result: session.resultEnvelope(),
  };
}

// Returns {ok:true, result} or {ok:false, reason}.
export function verifyEnvelope(env) {
  try {
    if (!env || typeof env !== 'object') return { ok: false, reason: 'empty' };
    if (env.schema !== REPLAY_SCHEMA) return { ok: false, reason: 'schema' };
    if (!env.level || !Array.isArray(env.commands)) return { ok: false, reason: 'shape' };
    if (env.commands.length > 20000) return { ok: false, reason: 'too-long' };

    let state = createState({
      level: env.level,
      mode: env.mode,
      seed: env.seed,
      limits: env.limits || {},
    });
    if (stateHash(state) !== env.initialHash) return { ok: false, reason: 'initial-hash' };

    const seen = new Set();
    const checkpoints = new Map((env.hashes || []).map((h) => [h.tick, h.hash]));
    let lastAt = 0;
    let guard = 0;
    for (const cmd of env.commands) {
      if (++guard > 20000) return { ok: false, reason: 'unbounded' };
      if (seen.has(cmd.id)) continue; // duplicates are idempotent
      seen.add(cmd.id);
      if (!Number.isFinite(cmd.at) || cmd.at < lastAt) return { ok: false, reason: 'clock-order' };
      lastAt = cmd.at;
      const r = applyCommand(state, cmd);
      if (r.error) return { ok: false, reason: 'command-' + r.error.code };
      state = r.state;
      const expected = checkpoints.get(state.tick);
      if (expected != null && expected !== stateHash(state)) {
        return { ok: false, reason: 'checkpoint@' + state.tick };
      }
    }
    if (state.status === 'active') return { ok: false, reason: 'unfinished' };
    if (stateHash(state) !== env.result.stateHash) return { ok: false, reason: 'final-hash' };

    const score = computeScore({ state, par: env.level.par, elapsedMs: state.elapsedMs });
    if (score.total !== env.result.score) return { ok: false, reason: 'score-mismatch' };
    return {
      ok: true,
      result: {
        stateHash: stateHash(state),
        score: score.total,
        components: score.components,
        completed: state.status === 'complete',
        terminalReason: state.terminalReason,
        invalid: state.stats.invalid,
        elapsedMs: state.elapsedMs,
        released: state.stats.released,
      },
    };
  } catch (err) {
    return { ok: false, reason: 'exception' };
  }
}
