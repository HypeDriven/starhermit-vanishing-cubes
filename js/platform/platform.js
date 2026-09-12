// Platform adapter: hosted mode is activated by a launch token in the URL
// fragment (#game_token=<jwt>), sent as Authorization: Bearer on every REST
// call; without a token the game runs locally, using its own dev-server
// endpoints when one is reachable. Tokens live in memory only — never
// persisted. Structured {"error":...} responses and rate limits surface as
// recoverable UI states.

import { loadDoc, saveDoc } from '../session/persistence.js';

const API_TIMEOUT_MS = 3500;
const HEARTBEAT_MS = 30000;
const TOKEN_REFRESH_MS = 45 * 60 * 1000; // launch tokens live 60 min
const TOKEN_REFRESH_RETRY_MS = 60 * 1000;
const CLOUD_SAVE_DEBOUNCE_MS = 2000;
const CLOUD_DOC_NAMES = ['settings', 'progression', 'profile', 'achievements', 'boards'];

// Minimal ZIP writer/reader (stored entries only, no compression).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zipStore(name, dataBytes) {
  const enc = new TextEncoder();
  const nameB = enc.encode(name);
  const crc = crc32(dataBytes);
  const out = [];
  const u16 = (v) => out.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (v) => out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  u32(0x04034b50); u16(20); u16(0); u16(0); u16(0); u16(0);
  u32(crc); u32(dataBytes.length); u32(dataBytes.length);
  u16(nameB.length); u16(0);
  const local = out.length;
  const head = new Uint8Array(out);
  const cd = [];
  const c16 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff);
  const c32 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  c32(0x02014b50); c16(20); c16(20); c16(0); c16(0); c16(0); c16(0);
  c32(crc); c32(dataBytes.length); c32(dataBytes.length);
  c16(nameB.length); c16(0); c16(0); c16(0); c16(0); c32(0); c32(0); // attrs + local-header offset
  const cdHead = new Uint8Array(cd);
  const cdOff = head.length + nameB.length + dataBytes.length;
  const parts = [head, nameB, dataBytes, cdHead, nameB];
  const eocd = [];
  const e32 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  const e16 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff);
  e32(0x06054b50); e16(0); e16(0); e16(1); e16(1);
  e32(cdHead.length + nameB.length); e32(cdOff); e16(0);
  parts.push(new Uint8Array(eocd));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  return buf;
}
function unzipFirstEntry(zipBytes) {
  // Stored single-entry reader: scan local headers for compression 0.
  const dv = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  let off = 0;
  while (off + 30 <= zipBytes.length && dv.getUint32(off, true) === 0x04034b50) {
    const method = dv.getUint16(off + 8, true);
    const size = dv.getUint32(off + 18, true);
    const nameLen = dv.getUint16(off + 26, true);
    const extraLen = dv.getUint16(off + 28, true);
    const dataOff = off + 30 + nameLen + extraLen;
    if (method !== 0) throw new Error('unsupported zip entry');
    return zipBytes.slice(dataOff, dataOff + size);
  }
  throw new Error('bad zip');
}
function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function base64ToBytes(b64) {
  const s = atob(b64);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

function authHeaders(extra = {}) {
  const headers = { ...extra };
  const token = platform.token;
  if (token && !('authorization' in headers) && !('Authorization' in headers)) {
    headers.authorization = 'Bearer ' + token;
  }
  return headers;
}

async function fetchJson(url, options = {}, timeoutMs = API_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, headers: authHeaders(options.headers), signal: ctrl.signal });
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

async function fetchBytes(url, options = {}, timeoutMs = API_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, headers: authHeaders(options.headers), signal: ctrl.signal });
    if (res.status === 404) return { ok: true, none: true };
    if (res.status === 429) return { ok: false, error: 'rate-limited' };
    if (!res.ok) return { ok: false, error: 'http-' + res.status };
    return { ok: true, data: new Uint8Array(await res.arrayBuffer()) };
  } catch (err) {
    return { ok: false, error: 'offline' };
  } finally {
    clearTimeout(timer);
  }
}

// Decode a JWT payload (base64url) without verifying the signature.
function decodeJwtPayload(token) {
  const part = token.split('.')[1];
  if (!part) throw new Error('bad-jwt');
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const json = typeof atob !== 'undefined'
    ? atob(b64)
    : Buffer.from(b64, 'base64').toString('utf8');
  return JSON.parse(json);
}

function randomId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export const platform = {
  hosted: false, // true iff a launch token was read from the URL
  devServer: false, // local dev: own server.js reachable (no token)
  timeOffsetMs: 0,
  token: null, // memory only
  scope: null, // game slug from the token's game_scope (never hard-coded)
  userId: null,
  nickname: null,
  syncState: 'offline', // 'synced' | 'saving' | 'offline'
  activityId: null,
  _lastHeartbeat: 0,
  _telemetryQueue: [],
  _telemetryConsent: false,
  _boards: null,
  _profileCache: new Map(),
  _gameInfoCache: null,
  _refreshTimer: null,
  _cloudTimer: null,
  _cloudSaving: false,
  _flushWired: false,

  async init() {
    if (typeof location !== 'undefined') {
      let token = null;
      // Primary launch path: #game_token=<jwt>[&session_id=<guid>]. Read once,
      // then strip so the token cannot leak via history.
      if (location.hash.length > 1) {
        const frag = new URLSearchParams(location.hash.slice(1));
        token = frag.get('game_token');
        if (token) {
          const rest = location.hash.slice(1).split('&')
            .filter((p) => !p.startsWith('game_token=') && !p.startsWith('session_id='));
          history.replaceState(null, '', location.pathname + location.search + (rest.length ? '#' + rest.join('&') : ''));
        }
      }
      // Local-dev fallback only (?token=/?scope=); the platform never sends these.
      if (!token) {
        const params = new URLSearchParams(location.search);
        token = params.get('token');
        this.scope = params.get('scope');
        if (token) {
          const url = new URL(location.href);
          url.searchParams.delete('token');
          history.replaceState(null, '', url);
        }
      }
      if (token) {
        this.token = token;
        try {
          const payload = decodeJwtPayload(token);
          this.userId = typeof payload.sub === 'string' ? payload.sub : null;
          if (typeof payload.game_scope === 'string' && payload.game_scope) this.scope = payload.game_scope;
        } catch {
          console.warn('platform: malformed launch token');
        }
        this.hosted = true;
        this._setSync('offline');
        this._scheduleTokenRefresh();
        this._wireFlush();
      }
    }
    if (!this.hosted) {
      // Online probe for local dev only: the game's own server.js provides
      // time sync plus activity/presence/telemetry endpoints.
      const sentAt = Date.now();
      const r = await fetchJson('/api/v1/time');
      if (r.ok && r.data && Number.isFinite(r.data.unixMs)) {
        const rtt = Date.now() - sentAt;
        this.timeOffsetMs = r.data.unixMs - (sentAt + rtt / 2);
        this.devServer = true;
      }
    }
    return this.hosted;
  },

  now() {
    return Date.now() + this.timeOffsetMs;
  },

  utcDateKey(d = null) {
    return new Date(d == null ? this.now() : d).toISOString().slice(0, 10);
  },

  statusText() {
    if (!this.hosted) return 'local play';
    const label = { synced: 'synced', saving: 'saving…', offline: 'save offline' }[this.syncState];
    return 'online · ' + (label || this.syncState);
  },

  _setSync(state) {
    this.syncState = state;
    if (typeof document !== 'undefined') {
      const el = document.getElementById('net-status');
      if (el) el.textContent = this.statusText();
    }
  },

  _wireFlush() {
    if (this._flushWired || typeof window === 'undefined') return;
    this._flushWired = true;
    window.addEventListener('pagehide', () => this.flushCloudSave());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flushCloudSave();
    });
  },

  // ---------- token refresh ----------

  _scheduleTokenRefresh() {
    clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => this._refreshToken(), TOKEN_REFRESH_MS);
  },

  async _refreshToken() {
    if (!this.hosted || !this.token || !this.scope) return;
    const r = await fetchJson(`/api/v1/games/${encodeURIComponent(this.scope)}/launch-token`, { method: 'POST' });
    const next = r.ok && r.data && (r.data.token || r.data.launchToken);
    if (typeof next === 'string' && next) {
      this.token = next;
      try {
        const payload = decodeJwtPayload(next);
        if (typeof payload.sub === 'string') this.userId = payload.sub;
      } catch { /* keep the previous identity */ }
      this._scheduleTokenRefresh();
    } else {
      this._refreshTimer = setTimeout(() => this._refreshToken(), TOKEN_REFRESH_RETRY_MS);
    }
  },

  // ---------- identity ----------

  // Nickname only — never the username. Never GET /api/v1/me (403 under a
  // launch token's game scope).
  async profileName(userId) {
    if (this._profileCache.has(userId)) return this._profileCache.get(userId);
    let name = null;
    const r = await fetchJson(`/api/v1/users/${encodeURIComponent(userId)}/profile`);
    if (r.ok && r.data && typeof r.data.nickname === 'string' && r.data.nickname) name = r.data.nickname;
    if (!name) name = 'Player ' + String(userId).slice(0, 8);
    this._profileCache.set(userId, name);
    return name;
  },

  async loadProfile() {
    if (!this.hosted || !this.userId) return null;
    this.nickname = await this.profileName(this.userId);
    return this.nickname;
  },

  // ---------- cloud save (hosted mirror of the localStorage docs) ----------

  _cloudPayload() {
    const docs = {};
    for (const name of CLOUD_DOC_NAMES) {
      docs[name] = loadDoc(name, name === 'boards' ? { entries: {} } : {});
    }
    return { savedAt: Date.now(), docs };
  },

  scheduleCloudSave() {
    if (!this.hosted || !this.scope) return;
    clearTimeout(this._cloudTimer);
    this._cloudTimer = setTimeout(() => this.flushCloudSave(), CLOUD_SAVE_DEBOUNCE_MS);
    this._setSync('saving');
  },

  async flushCloudSave() {
    clearTimeout(this._cloudTimer);
    if (!this.hosted || !this.scope || this._cloudSaving) return;
    this._cloudSaving = true;
    this._setSync('saving');
    try {
      const json = new TextEncoder().encode(JSON.stringify(this._cloudPayload()));
      const r = await fetchJson(`/api/v1/me/cloud-saves/${encodeURIComponent(this.scope)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dataBase64: bytesToBase64(zipStore('save.json', json)) }),
      });
      this._setSync(r.ok ? 'synced' : 'offline');
    } catch {
      this._setSync('offline');
    } finally {
      this._cloudSaving = false;
    }
  },

  // Remote-preferred: on conflict the remote snapshot wins (see applyRemoteDocs
  // in main.js); localStorage stays the offline cache.
  async loadCloudSave() {
    if (!this.hosted || !this.scope) return null;
    const r = await fetchBytes(`/api/v1/me/cloud-saves/${encodeURIComponent(this.scope)}`);
    if (r.none) {
      this._setSync('synced');
      return null;
    }
    if (!r.ok) {
      this._setSync('offline');
      return null;
    }
    try {
      const remote = JSON.parse(new TextDecoder().decode(unzipFirstEntry(r.data)));
      this._setSync('synced');
      return remote && typeof remote === 'object' ? remote : null;
    } catch (err) {
      console.warn('platform: unreadable cloud save', err);
      this._setSync('offline');
      return null;
    }
  },

  applyRemoteBoards(remoteDoc) {
    if (!remoteDoc || typeof remoteDoc !== 'object') return;
    const local = loadDoc('boards', { entries: {} });
    if (remoteDoc.rev < local.rev) return;
    this._boards = remoteDoc.payload && typeof remoteDoc.payload === 'object' ? remoteDoc.payload : { entries: {} };
    saveDoc('boards', this._boards, remoteDoc.rev || 0);
  },

  // ---------- activity & presence (local dev server only) ----------

  async activityStart(mode) {
    this.activityId = randomId();
    if (this.devServer) {
      await fetchJson('/api/v1/activity', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ activityId: this.activityId, kind: 'play', mode }),
      });
    }
    return this.activityId;
  },

  async activityEnd() {
    if (this.devServer && this.activityId) {
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
    if (!this.devServer || t - this._lastHeartbeat < HEARTBEAT_MS) return;
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
    this.scheduleCloudSave();
  },

  // Personal record only: clients never submit scores to a game leaderboard —
  // platform scripts own ranked entries. The record is kept locally (and
  // cloud-mirrored when hosted).
  // entry: {board, name, score, completed, invalid, elapsedMs, sessionId, mode}
  async submitScore(entry) {
    const boards = this._localBoards();
    const list = boards.entries[entry.board] || (boards.entries[entry.board] = []);
    // Idempotent resubmission, one entry per session.
    const dup = list.findIndex((e) => e.sessionId === entry.sessionId);
    if (dup !== -1) {
      return { ok: true, rank: dup + 1, validated: false, casual: true, duplicate: true };
    }
    list.push({ ...entry, validated: false, casual: true, at: Date.now() });
    list.sort((a, b) => b.score - a.score || a.invalid - b.invalid || a.elapsedMs - b.elapsedMs);
    boards.entries[entry.board] = list.slice(0, 100);
    this._saveLocalBoards();
    const rank = list.findIndex((e) => e.sessionId === entry.sessionId) + 1;
    return { ok: true, rank, validated: false, casual: true };
  },

  // Read-only platform board for the whole game, when the platform declares a
  // leaderboardId. Resolves userIds to nicknames via the profile helper.
  // Returns null when hosted data is unavailable (caller shows local records).
  async globalBoard(scope = 'global') {
    if (!this.hosted || !this.scope) return null;
    if (!this._gameInfoCache) {
      this._gameInfoCache = await fetchJson(`/api/v1/games/${encodeURIComponent(this.scope)}`);
    }
    const g = this._gameInfoCache;
    const leaderboardId = g.ok && g.data && g.data.leaderboardId;
    if (!leaderboardId) return null;
    const q = `?page=1&pageSize=50${scope === 'friends' ? '&friendsOnly=1' : ''}`;
    const r = await fetchJson(`/api/v1/leaderboards/${encodeURIComponent(leaderboardId)}/entries${q}`);
    if (!r.ok) return { ok: false, error: r.error };
    const raw = Array.isArray(r.data.entries) ? r.data.entries : [];
    const entries = [];
    for (const e of raw.slice(0, 50)) {
      const userId = e.userId ?? e.user_id ?? null;
      entries.push({
        ...e,
        name: e.name || (userId != null ? await this.profileName(userId) : 'Player'),
      });
    }
    return { ok: true, entries, casual: false, me: (g.data && g.data.me) || null };
  },

  // Per-board personal records (this device).
  async leaderboard(board, scope = 'global', withNames = []) {
    const boards = this._localBoards();
    let list = (boards.entries[board] || []).slice(0, 50);
    if (scope === 'friends' && withNames.length) {
      list = list.filter((e) => withNames.includes(e.name));
    }
    return { ok: true, entries: list, casual: true };
  },

  // ---------- telemetry (local dev server only; anonymous funnel events) ----------

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
    if (!consent || !this.devServer || this._telemetryQueue.length === 0) return;
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
