// Scoring. All stored values are integers; formatting happens only in the
// presentation layer. Results expose a component breakdown, never a single
// unexplained total.

export const SCORE = Object.freeze({
  PER_RELEASE: 100,
  COMPLETION: 1000,
  TAP_EFFICIENCY: 25, // per tap saved under par
  ROTATION_EFFICIENCY: 15, // per rotation saved under par
  TIME_PER_SECOND: 5, // per second under par (completed only)
  INVALID_PENALTY: 30,
});

// par: {taps, rotations, timeMs}
export function computeScore({ state, par, elapsedMs }) {
  const completed = state.status === 'complete';
  const release = state.stats.released * SCORE.PER_RELEASE;
  const completion = completed ? SCORE.COMPLETION : 0;
  // Efficiency bonuses reward *completion* under par — an abandoned round
  // with few taps must not score them.
  const tapEfficiency = completed
    ? Math.max(0, par.taps - state.stats.taps) * SCORE.TAP_EFFICIENCY
    : 0;
  const rotationEfficiency = completed
    ? Math.max(0, par.rotations - state.stats.rotations) * SCORE.ROTATION_EFFICIENCY
    : 0;
  const timeBonus = completed
    ? Math.max(0, Math.floor((par.timeMs - elapsedMs) / 1000)) * SCORE.TIME_PER_SECOND
    : 0;
  const invalidPenalty = state.stats.invalid * SCORE.INVALID_PENALTY;
  const total = Math.max(
    0,
    release + completion + tapEfficiency + rotationEfficiency + timeBonus - invalidPenalty,
  );
  return {
    components: { release, completion, tapEfficiency, rotationEfficiency, timeBonus, invalidPenalty },
    total,
  };
}

// 0..3 stars: complete, at/under tap par, at/under rotation par.
export function starsFor({ state, par }) {
  if (state.status !== 'complete') return 0;
  let stars = 1;
  if (state.stats.taps <= par.taps) stars += 1;
  if (state.stats.rotations <= par.rotations) stars += 1;
  return stars;
}

// Board ordering, best first: primary metric (score); ties break by primary
// objective completion, fewer invalid actions, lower authoritative elapsed
// time, then stable session identifier. Returns negative when a ranks before b.
export function compareResults(a, b) {
  if (a.score !== b.score) return b.score - a.score;
  const ca = a.completed ? 1 : 0;
  const cb = b.completed ? 1 : 0;
  if (ca !== cb) return cb - ca;
  if (a.invalid !== b.invalid) return a.invalid - b.invalid;
  if (a.elapsedMs !== b.elapsedMs) return a.elapsedMs - b.elapsedMs;
  const sa = String(a.sessionId || '');
  const sb = String(b.sessionId || '');
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}
