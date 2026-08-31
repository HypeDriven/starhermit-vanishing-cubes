// Game session: the only path by which commands reach the rules engine.
// Owns command identifiers (duplicate commands are rejected idempotently),
// the ordered input log, periodic state hashes, undo history (where the
// ruleset permits), the pause-aware authoritative clock, and replay data.

import {
  createState, applyCommand, serialize, deserialize, stateHash, hintAction,
} from '../rules/engine.js';
import { computeScore, starsFor } from '../rules/scoring.js';

const CLOCK_QUANTUM_MS = 50;

let sessionSeq = 0;

export class GameSession {
  constructor({
    level, mode, seed, limits = {}, ranked = false, allowUndo = true,
    tools = { hint: true, undo: true },
    now = () => performance.now(), sessionId = null,
  }) {
    this.sessionId = sessionId || 's' + Date.now().toString(36) + '-' + sessionSeq++;
    this.level = level;
    this.ranked = ranked;
    this.tools = tools;
    this.allowUndo = allowUndo && !ranked;
    this.now = now;
    this.state = createState({ level, mode, seed, limits });
    this.initialSnapshot = serialize(this.state);
    this.log = [];
    this.hashes = [{ tick: 0, hash: stateHash(this.state) }];
    this.seenIds = new Set();
    this.history = []; // {stateJson, logLength, hashesLength}
    this.listeners = new Set();
    this.cmdSeq = 0;
    this.startedAtUnixMs = Date.now();
    this.startStamp = now();
    this.pausedAccum = 0;
    this.pauseStart = null;
    this.finished = null;
  }

  onEvents(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(events) {
    for (const fn of this.listeners) fn(events, this.state);
  }

  activeMs() {
    const n = this.now();
    const pausedNow = this.pauseStart != null ? n - this.pauseStart : 0;
    return Math.max(0, Math.round(n - this.startStamp - this.pausedAccum - pausedNow));
  }

  quantize(ms) {
    return Math.round(ms / CLOCK_QUANTUM_MS) * CLOCK_QUANTUM_MS;
  }

  pause() {
    if (this.pauseStart == null && !this.finished) this.pauseStart = this.now();
  }

  resume() {
    if (this.pauseStart != null) {
      this.pausedAccum += this.now() - this.pauseStart;
      this.pauseStart = null;
    }
  }

  get paused() {
    return this.pauseStart != null;
  }

  // type: 'release' | 'rotate' | 'clock' | 'concede', payload: {cubeId?}
  dispatch(type, payload = {}) {
    if (this.finished) return { ok: false, error: { code: 'finished' }, events: [] };
    const id = this.sessionId + '-' + this.cmdSeq++;
    const cmd = { id, type, at: this.quantize(this.activeMs()), ...payload };
    if (this.seenIds.has(id)) return { ok: true, duplicate: true, events: [] }; // idempotent

    const before = this.state;
    const { state, events, error } = applyCommand(before, cmd);
    if (error) return { ok: false, error, events: [] };

    this.seenIds.add(id);
    if (this.allowUndo && type === 'release') {
      this.history.push({
        stateJson: serialize(before),
        logLength: this.log.length,
        hashesLength: this.hashes.length,
      });
    }
    this.state = state;
    this.log.push(cmd);
    if (state.tick % 10 === 0 || state.status !== 'active') {
      this.hashes.push({ tick: state.tick, hash: stateHash(state) });
    }
    if (state.status !== 'active') {
      this.finished = { reason: state.terminalReason };
    }
    this.emit(events);
    return { ok: true, events };
  }

  undo() {
    if (!this.allowUndo || this.finished || this.history.length === 0) return false;
    const snap = this.history.pop();
    this.state = deserialize(snap.stateJson);
    this.log.length = snap.logLength;
    this.hashes.length = snap.hashesLength;
    this.emit([{ type: 'undo' }]);
    return true;
  }

  hint() {
    if (!this.tools.hint || this.finished) return null;
    return hintAction(this.state);
  }

  tickClock() {
    if (this.finished || this.paused) return;
    if (this.state.limits.timeMs != null) {
      this.dispatch('clock');
    }
  }

  score() {
    return computeScore({
      state: this.state,
      par: this.level.par,
      elapsedMs: this.state.elapsedMs,
    });
  }

  stars() {
    return starsFor({ state: this.state, par: this.level.par });
  }

  resultEnvelope() {
    const score = this.score();
    return {
      status: this.state.status,
      terminalReason: this.state.terminalReason,
      stateHash: stateHash(this.state),
      score: score.total,
      components: score.components,
      stars: this.stars(),
      stats: { ...this.state.stats },
      elapsedMs: this.state.elapsedMs,
      assists: {
        undo: this.tools.undo && this.allowUndo,
        hint: this.tools.hint,
      },
      sessionId: this.sessionId,
    };
  }

  // Durable snapshot for reconnect / background recovery.
  snapshot() {
    return JSON.stringify({
      sessionId: this.sessionId,
      level: this.level,
      ranked: this.ranked,
      tools: this.tools,
      state: serialize(this.state),
      log: this.log,
      hashes: this.hashes,
      startedAtUnixMs: this.startedAtUnixMs,
      // Clock offset so a restored session's authoritative clock continues
      // monotonically — replayed commands must never move `at` backwards.
      activeMsAtSave: this.activeMs(),
      finished: this.finished,
    });
  }

  static restore(json, opts = {}) {
    const data = JSON.parse(json);
    const s = new GameSession({
      level: data.level,
      mode: data.state ? JSON.parse(data.state).mode : 'practice',
      seed: JSON.parse(data.state).seed,
      ranked: data.ranked,
      tools: data.tools,
      ...opts,
    });
    s.sessionId = data.sessionId;
    s.state = deserialize(data.state);
    s.initialSnapshot = serialize(createState({
      level: data.level,
      mode: s.state.mode,
      seed: s.state.seed,
      limits: s.state.limits,
    }));
    s.log = data.log;
    s.hashes = data.hashes;
    s.seenIds = new Set(data.log.map((c) => c.id));
    // Command IDs are `sessionId + '-' + seq`. Undo truncates the log without
    // rewinding the counter, and failed dispatches consume a sequence number,
    // so `log.length` can collide with an ID still present in `seenIds` —
    // the next real command would be dropped as a duplicate. Resume above
    // the highest sequence ever issued instead.
    let maxSeq = -1;
    for (const c of data.log) {
      const m = /-(\d+)$/.exec(c.id);
      if (m) maxSeq = Math.max(maxSeq, Number(m[1]));
    }
    s.cmdSeq = Math.max(data.log.length, maxSeq + 1);
    s.startedAtUnixMs = data.startedAtUnixMs;
    s.finished = data.finished;
    // Continue the authoritative clock from the saved offset.
    s.startStamp = s.now() - (data.activeMsAtSave || 0);
    s.pausedAccum = 0;
    s.pauseStart = null;
    return s;
  }
}
