// Platform adapter: same-origin /api routes when hosted, graceful local
// fallback otherwise. Launch/account tokens are read from the URL and kept in
// memory only — never persisted. Structured {"error":...} responses and rate
// limits surface as recoverable UI states.

import { loadDoc, saveDoc } from '../session/persistence.js';

const API_TIMEOUT_MS = 3500;
const HEARTBEAT_MS = 30000;

async function fetchJson(url, options = {}, timeoutMs = API_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (res.status === 429) return { ok: false, error: 'rate-limited' };
    if (!res.ok) return { ok: false, error: (body && body.error) || 'http-' + res.status };
    return { ok: true, data: body };
  } catch (err) {
    return { ok: false, error: 'offline' };
  } finally {
    clearTimeout(timer);
  }
}

function randomId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export const platform = {
  hosted: false,
  timeOffsetMs: 0,
  token: null, // memory only
  scope: null,
  activityId: null,
  _lastHeartbeat: 0,
  _telemetryQueue: [],
  _boards: null,

  async init() {
    if (typeof location !== 'undefined') {
      const params = new URLSearchParams(location.search);
      this.token = params.get('token');
      this.scope = params.get('scope');
      if (this.token) {
        // Scrub the token from the address bar so it cannot leak via history.
        const url = new URL(location.href);
        url.searchParams.delete('token');
        history.replaceState(null, '', url);
      }
    }
    const sentAt = Date.now();
    const r = await fetchJson('/api/v1/time');
    if (r.ok && r.data && Number.isFinite(r.data.unixMs)) {
      const rtt = Date.now() - sentAt;
      this.timeOffsetMs = r.data.unixMs - (sentAt + rtt / 2);
      this.hosted = true;
    }
    return this.hosted;
  },

  now() {
    return Date.now() + this.timeOffsetMs;
  },

  utcDateKey(d = null) {
    return new Date(d == null ? this.now() : d).toISOString().slice(0, 10);
  },

  // ---------- activity & presence ----------

  async activityStart(mode) {
    this.activityId = randomId();
    if (this.hosted) {
      await fetchJson('/api/v1/activity', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ activityId: this.activityId, kind: 'play', mode }),
      });
    }
    return this.activityId;
  },

  async activityEnd() {
    if (this.hosted && this.activityId) {
      await fetchJson('/api/v1/activity/end', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ activityId: this.activityId }),
      });
    }
    this.activityId = null;
  },

  heartbeat() {
    const t = Date.now();
    if (!this.hosted || t - this._lastHeartbeat < HEARTBEAT_MS) return;
    this._lastHeartbeat = t;
    fetchJson('/api/v1/presence', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ activityId: this.activityId, at: t }),
    });
  },

  // ---------- leaderboards ----------

  _localBoards() {
    if (!this._boards) this._boards = loadDoc('boards', { entries: {} }).payload;
    return this._boards;
  },

  _saveLocalBoards() {
    const { rev } = loadDoc('boards', { entries: {} });
    saveDoc('boards', this._boards, rev);
  },

  // entry: {board, name, score, completed, invalid, elapsedMs, sessionId,
  //         mode, ruleset, contentVersion, seed, assists, durationMs, replay}
  async submitScore(entry) {
    if (this.hosted) {
      const r = await fetchJson('/api/v1/scores', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(entry),
      });
      if (r.ok) return { ok: true, rank: r.data.rank, validated: !!r.data.validated };
      if (r.error !== 'offline') return { ok: false, error: r.error };
      // fall through to local on offline
    }
    const boards = this._localBoards();
    const list = boards.entries[entry.board] || (boards.entries[entry.board] = []);
    list.push({ ...entry, replay: undefined, validated: false, casual: true, at: Date.now() });
    list.sort((a, b) => b.score - a.score || a.invalid - b.invalid || a.elapsedMs - b.elapsedMs);
    boards.entries[entry.board] = list.slice(0, 100);
    this._saveLocalBoards();
    const rank = list.findIndex((e) => e.sessionId === entry.sessionId) + 1;
    return { ok: true, rank, validated: false, casual: true };
  },

  async leaderboard(board, scope = 'global', withNames = []) {
    const withQ = withNames.length ? '&with=' + encodeURIComponent(withNames.join(',')) : '';
    if (this.hosted) {
      const r = await fetchJson(`/api/v1/leaderboard?board=${encodeURIComponent(board)}&scope=${scope}${withQ}`);
      if (r.ok) return { ok: true, entries: r.data.entries, casual: !!r.data.casual };
      if (r.error !== 'offline') return { ok: false, error: r.error };
    }
    const boards = this._localBoards();
    let list = (boards.entries[board] || []).slice(0, 50);
    if (scope === 'friends' && withNames.length) {
      list = list.filter((e) => withNames.includes(e.name));
    }
    return { ok: true, entries: list, casual: true };
  },

  // ---------- telemetry (anonymous funnel events only) ----------

  telemetry(event, data = {}) {
    const allowed = ['start', 'tutorial-step', 'round-end', 'retry', 'settings-change', 'error'];
    if (!allowed.includes(event)) return;
    const clean = { event, t: Date.now() };
    if (event === 'tutorial-step') clean.step = String(data.step || '').slice(0, 16);
    if (event === 'round-end') {
      clean.mode = String(data.mode || '').slice(0, 16);
      clean.outcome = String(data.outcome || '').slice(0, 16);
    }
    if (event === 'error') clean.category = String(data.category || '').slice(0, 24);
    this._telemetryQueue.push(clean);
    if (this._telemetryQueue.length > 40) this._telemetryQueue.shift();
    this._flushTelemetry();
  },

  _flushTelemetry(consentGiven = null) {
    const consent = consentGiven ?? this._telemetryConsent;
    if (!consent || !this.hosted || this._telemetryQueue.length === 0) return;
    const batch = this._telemetryQueue.splice(0, this._telemetryQueue.length);
    fetchJson('/api/v1/telemetry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: batch }),
    });
  },

  setTelemetryConsent(consent) {
    this._telemetryConsent = !!consent;
    this._flushTelemetry(true);
  },
};
