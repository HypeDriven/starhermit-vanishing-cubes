// Platform adapter over the canonical StarHermit SDK (`starhermit-sdk.js`,
// global `StarHermit`, initialised from index.html before any module runs).
// Hosted mode = the SDK holds a launch token (#game_token / #access_token,
// already stripped from the URL). Without one the game runs locally and makes
// no network calls at all. Tokens live in the SDK's memory only.

import { loadDoc, saveDoc } from '../session/persistence.js';

const CLOUD_DOC_NAMES = ['settings', 'progression', 'profile', 'achievements', 'boards'];

function randomId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export const platform = {
  hosted: false, // true iff the SDK holds a launch token
  devServer: false, // kept for callers; the client never probes a dev server
  timeOffsetMs: 0,
  sh: null, // StarHermit SDK instance (tests may inject one before init)
  scope: null, // game slug from the token's game_scope (never hard-coded)
  userId: null,
  nickname: null,
  syncState: 'offline', // 'synced' | 'saving' | 'offline'
  activityId: null,
  onAuthChange: null, // (signedIn) => void
  _boards: null,
  _flushWired: false,

  get token() {
    return this.sh ? this.sh.token : null;
  },

  async init() {
    this.sh = this.sh || globalThis.StarHermit || null;
    const sh = this.sh;
    if (!sh || !sh.token) return false;
    this.hosted = true;
    this.userId = sh.userId;
    this.scope = sh.slug;
    sh.on('saved', (ok) => this.hosted && this._setSync(ok ? 'synced' : 'offline'));
    sh.on('auth', (e) => {
      if (e && e.signedIn) return;
      this.hosted = false;
      this._setSync('offline');
      if (this.onAuthChange) this.onAuthChange(false);
    });
    this._setSync('offline');
    this._wireFlush();
    return true; // daily boundaries use the device clock (UTC day)
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

  // ---------- sign-in, invites ----------

  canSignIn() {
    return !!(this.sh && this.sh.canSignIn());
  },

  signIn() {
    return !!(this.sh && this.sh.signIn());
  },

  inviteLink() {
    return this.hosted ? this.sh.inviteLink() : null;
  },

  // ---------- identity ----------

  // Nickname (fallback "Player <id prefix>") — never /api/v1/me.
  async profileName(userId) {
    const p = this.hosted ? await this.sh.profile(userId) : null;
    return p ? p.displayName : 'Player ' + String(userId).slice(0, 6);
  },

  async loadProfile() {
    if (!this.hosted || !this.userId) return null;
    this.nickname = await this.profileName(this.userId);
    return this.nickname;
  },

  // ---------- settings KV & controls ----------

  async getSettings() {
    return this.hosted ? this.sh.getSettings() : {};
  },

  patchSettings(obj) {
    if (this.hosted) this.sh.patchSettings(obj);
  },

  async loadBindings(defaults) {
    if (this.hosted) return this.sh.loadBindings(defaults);
    const out = {};
    for (const k of Object.keys(defaults)) out[k] = defaults[k].slice();
    return out;
  },

  setControl(action, codes) {
    if (!this.hosted) return Promise.resolve(null);
    return this.sh.setControl(action, codes).catch(() => null);
  },

  resetControls() {
    return this.hosted ? this.sh.resetControls() : Promise.resolve(null);
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
    if (!this.hosted) return;
    this._setSync('saving');
    this.sh.saveJSON(this._cloudPayload(), 2000);
  },

  flushCloudSave() {
    if (!this.hosted) return Promise.resolve(false);
    return this.sh.flushSave(true);
  },

  // Remote-preferred: on conflict the remote snapshot wins (see applyRemoteDocs
  // in main.js); localStorage stays the offline cache.
  async loadCloudSave() {
    if (!this.hosted) return null;
    const remote = await this.sh.loadJSON();
    this._setSync('synced');
    return remote && typeof remote === 'object' ? remote : null;
  },

  applyRemoteBoards(remoteDoc) {
    if (!remoteDoc || typeof remoteDoc !== 'object') return;
    const local = loadDoc('boards', { entries: {} });
    if (remoteDoc.rev < local.rev) return;
    this._boards = remoteDoc.payload && typeof remoteDoc.payload === 'object' ? remoteDoc.payload : { entries: {} };
    saveDoc('boards', this._boards, remoteDoc.rev || 0);
  },

  // ---------- activity, presence, telemetry ----------
  // No route for these is reachable with a launch token, and standalone play
  // makes no network calls, so they are local bookkeeping only.

  async activityStart() {
    this.activityId = randomId();
    return this.activityId;
  },

  async activityEnd() {
    this.activityId = null;
  },

  heartbeat() {},

  telemetry() {},

  setTelemetryConsent() {},

  // ---------- leaderboards ----------

  // Signed in: post a finished ranked round to the platform leaderboards
  // (score-script.js); resolves { posted, rank } — rank on high-score, or null.
  async postScore(score) {
    if (!this.hosted || typeof this.sh.submitScores !== 'function') return { posted: false, rank: null };
    const keys = await this.sh.submitScores({ 'high-score': score }).catch(() => []);
    if (!keys || !keys.includes('high-score')) return { posted: false, rank: null };
    try {
      const r = await this.sh.leaderboard('high-score', { pageSize: 100 });
      const me = ((r && r.items) || []).find((i) => i.userId === this.sh.userId);
      return { posted: true, rank: me ? me.rank : null };
    } catch { return { posted: true, rank: null }; }
  },

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
    if (!this.hosted) return null;
    const r = await this.sh.leaderboard(null, { pageSize: 50, scope: scope === 'friends' ? 'friends' : undefined });
    if (!r.board) return null;
    const entries = [];
    for (const e of (r.items || []).slice(0, 50)) {
      entries.push({
        ...e,
        name: e.name || e.nickname || (e.userId != null ? await this.profileName(e.userId) : 'Player'),
      });
    }
    return { ok: true, entries, casual: false, me: r.me || null };
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

};
