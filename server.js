// Vanishing Cubes — authoritative game script (StarHermit `server=` entry).
//
// Zero-dependency Node server that:
//   1. serves the static browser distribution (index.html, js/, css/, vendor/),
//   2. exposes the same-origin API the client platform adapter expects:
//      - GET  /api/v1/time          platform time (round-trip adjusted client-side)
//      - POST /api/v1/scores        score submission w/ replay validation
//      - GET  /api/v1/leaderboard   global / friends-filtered boards
//      - POST /api/v1/activity      play activity start
//      - POST /api/v1/activity/end  play activity end (playtime accounting)
//      - POST /api/v1/presence      throttled presence heartbeats
//      - POST /api/v1/telemetry     anonymous funnel events (aggregate counts only)
//
// Score claims on ranked boards are validated authoritatively: the submitted
// replay envelope is re-executed through the same deterministic rules engine
// the client uses, the submitted content is compared against a server-side
// regeneration from the published seed, and score/limits must match exactly.
// Boards without valid replays are rejected; unknown boards are casual-only.
//
// No secrets are configured or exposed. All API errors use {"error":"..."}.

import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyEnvelope } from './js/rules/replay.js';
import { generateLevel } from './js/rules/generator.js';
import { canonicalJSON } from './js/rules/engine.js';
import { compareResults } from './js/rules/scoring.js';
import { cyrb53 } from './js/rules/rng.js';
import { LEVEL_DEFS, dailyDef } from './js/content/levels.js';
import { CHALLENGES, challengeLimits } from './js/content/challenges.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, 'data');
const PORT = Number(process.env.PORT || 8080);
const BUILD = '1.0.0';
const CONTENT_VERSION = 1;

// Days with defective content are excluded from ranking rather than silently
// replaced. Empty at launch; operations add date keys here when needed.
const EXCLUDED_DAILY_DAYS = new Set();

const MAX_BODY_BYTES = 256 * 1024;
const MAX_BOARD_ENTRIES = 200;
const MAX_NAME_LEN = 24;
const MAX_PLAUSIBLE_SCORE = 500000; // casual claims without a replay

// ---------------------------------------------------------------------------
// storage
// ---------------------------------------------------------------------------

let store = { version: 1, boards: {}, telemetry: {}, activity: { sessions: 0, totalMs: 0 } };
let storeLoaded = false;
let saveTimer = null;

async function loadStore() {
  try {
    const raw = await readFile(path.join(DATA_DIR, 'store.json'), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 1 && parsed.boards) {
      store = parsed;
    }
  } catch { /* first run — fresh store */ }
  storeLoaded = true;
}

function saveStoreSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      await mkdir(DATA_DIR, { recursive: true });
      await writeFile(path.join(DATA_DIR, 'store.json'), JSON.stringify(store));
    } catch (err) {
      console.warn('store save failed:', err.message);
    }
  }, 400);
}

// ---------------------------------------------------------------------------
// rate limiting (token buckets per remote address)
// ---------------------------------------------------------------------------

const buckets = new Map();
function rateAllow(key, limit, perMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.windowStart > perMs) {
    b = { windowStart: now, count: 0 };
    buckets.set(key, b);
  }
  b.count++;
  return b.count <= limit;
}
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [k, b] of buckets) if (b.windowStart < cutoff) buckets.delete(k);
}, 60 * 1000).unref();

// ---------------------------------------------------------------------------
// authoritative content
// ---------------------------------------------------------------------------

const levelCache = new Map();

function hashLevel(level) {
  return cyrb53(canonicalJSON(level)).toString(16);
}

function authoritativeLevel(levelId) {
  if (levelCache.has(levelId)) return levelCache.get(levelId);
  let def = null;
  if (levelId.startsWith('daily-')) {
    const dateKey = levelId.slice(6);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
    def = dailyDef(dateKey);
  } else if (levelId.startsWith('level-')) {
    def = LEVEL_DEFS.find((d) => d.id === levelId.slice(6)) || null;
  } else if (levelId.startsWith('challenge-')) {
    const ch = CHALLENGES.find((c) => c.id === levelId.slice(10));
    def = ch ? ch.def : null;
  }
  if (!def) return null;
  try {
    const level = generateLevel(def);
    levelCache.set(levelId, level);
    return level;
  } catch {
    return null;
  }
}

function expectedLimitsFor(board) {
  if (!board.startsWith('challenge-')) return { moves: null, timeMs: null };
  const ch = CHALLENGES.find((c) => c.id === board.slice(10));
  if (!ch) return null;
  const level = authoritativeLevel(board);
  if (!level) return null;
  const limits = challengeLimits(ch, level);
  return {
    moves: limits.moves == null ? null : limits.moves,
    timeMs: limits.timeMs == null ? null : limits.timeMs,
  };
}

function boardRanked(board) {
  return (
    /^daily-\d{4}-\d{2}-\d{2}$/.test(board) ||
    /^challenge-[a-z0-9-]+$/.test(board) ||
    /^level-[a-z0-9]+$/.test(board)
  );
}

// ---------------------------------------------------------------------------
// validation helpers
// ---------------------------------------------------------------------------

function bad(reason) {
  return { ok: false, reason };
}

function validateSubmission(body) {
  if (!body || typeof body !== 'object') return bad('shape');
  const e = body;
  if (typeof e.board !== 'string' || e.board.length > 64 || !/^[a-z0-9-]+$/.test(e.board)) {
    return bad('board');
  }
  if (typeof e.name !== 'string') return bad('name');
  e.name = e.name.slice(0, MAX_NAME_LEN) || 'Guest';
  if (!Number.isInteger(e.score) || e.score < 0 || e.score > 100000000) return bad('score');
  if (typeof e.completed !== 'boolean') return bad('completed');
  if (!Number.isInteger(e.invalid) || e.invalid < 0 || e.invalid > 100000) return bad('invalid');
  if (!Number.isInteger(e.elapsedMs) || e.elapsedMs < 0 || e.elapsedMs > 6 * 3600 * 1000) {
    return bad('elapsed');
  }
  if (typeof e.sessionId !== 'string' || e.sessionId.length > 80) return bad('session');
  if (!Number.isInteger(e.contentVersion)) return bad('content-version');
  return { ok: true, entry: e };
}

function verifySubmission(entry) {
  // Returns { status: 'validated' | 'casual' | reject-reason }
  const ranked = boardRanked(entry.board);
  if (!ranked) {
    // Casual board: plausibility checks only, replay optional.
    if (entry.score > MAX_PLAUSIBLE_SCORE) return bad('implausible');
    return { status: 'casual' };
  }
  if (entry.contentVersion !== CONTENT_VERSION) return bad('stale-version');
  if (entry.board.startsWith('daily-')) {
    const dateKey = entry.board.slice(6);
    if (EXCLUDED_DAILY_DAYS.has(dateKey)) return bad('day-excluded');
    const today = new Date().toISOString().slice(0, 10);
    if (dateKey > today) return bad('future-daily');
  }
  if (!entry.replay) return bad('missing-replay');

  // Content binding: the submitted level must equal a server-side
  // regeneration from the published seed — clients cannot invent boards.
  const authoritative = authoritativeLevel(entry.board);
  if (!authoritative) return bad('unknown-content');
  const submitted = entry.replay.level;
  if (!submitted || hashLevel(submitted) !== hashLevel(authoritative)) {
    return bad('content-mismatch');
  }

  // Difficulty-affecting limits must match the ruleset. Timing assistance
  // (1.5x relaxed clock) is honored but demotes the entry to casual.
  let casual = false;
  const expected = expectedLimitsFor(entry.board);
  if (expected) {
    const got = entry.replay.limits || {};
    const gotMoves = got.moves == null ? null : got.moves;
    const gotTime = got.timeMs == null ? null : got.timeMs;
    const exact = gotMoves === expected.moves && gotTime === expected.timeMs;
    const relaxed =
      expected.timeMs != null &&
      gotTime === Math.round(expected.timeMs * 1.5) &&
      gotMoves === expected.moves &&
      entry.assists && entry.assists.timingAssist === true;
    if (!exact) {
      if (!relaxed) return bad('limits-mismatch');
      casual = true;
    }
  }
  if (entry.assists && entry.assists.undo === true) casual = true; // undo runs are casual

  const verdict = verifyEnvelope(entry.replay);
  if (!verdict.ok) return bad('replay-' + verdict.reason);
  if (verdict.result.score !== entry.score) return bad('score-mismatch');
  if (verdict.result.completed !== entry.completed) return bad('completion-mismatch');
  return { status: casual ? 'casual' : 'validated' };
}

// ---------------------------------------------------------------------------
// API handlers
// ---------------------------------------------------------------------------

function json(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('too-large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function boardEntries(board) {
  return store.boards[board] || [];
}

function publicEntry(e, i) {
  return {
    rank: i + 1,
    name: e.name,
    score: e.score,
    completed: e.completed,
    invalid: e.invalid,
    elapsedMs: e.elapsedMs,
    sessionId: e.sessionId,
    casual: !e.validated,
    at: e.at,
  };
}

const api = {
  'GET /api/v1/time'(req, res) {
    json(res, 200, { unixMs: Date.now(), build: BUILD });
  },

  'GET /api/v1/leaderboard'(req, res, url) {
    const board = String(url.searchParams.get('board') || '');
    const scope = String(url.searchParams.get('scope') || 'global');
    if (!/^[a-z0-9-]{1,64}$/.test(board)) return json(res, 400, { error: 'board' });
    let entries = boardEntries(board);
    if (scope === 'friends') {
      // Friends filtering is display-name based (no social graph exists yet);
      // names arrive client-side and are never stored.
      const withNames = String(url.searchParams.get('with') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 50);
      entries = entries.filter((e) => withNames.includes(e.name));
    }
    const sorted = entries.slice().sort(compareResults).slice(0, 50);
    json(res, 200, { entries: sorted.map(publicEntry), casual: false });
  },

  async 'POST /api/v1/scores'(req, res, url, ip) {
    if (!rateAllow('submit:' + ip, 20, 60 * 1000)) {
      return json(res, 429, { error: 'rate-limited' }, { 'retry-after': '60' });
    }
    let parsed;
    try {
      parsed = JSON.parse((await readBody(req)).toString('utf8'));
    } catch {
      return json(res, 400, { error: 'bad-json' });
    }
    const check = validateSubmission(parsed);
    if (!check.ok) return json(res, 400, { error: check.reason });
    const entry = check.entry;

    // Idempotency: a resubmitted session is accepted silently.
    const list = boardEntries(entry.board);
    if (list.some((e) => e.sessionId === entry.sessionId)) {
      const rank = boardEntries(entry.board).sort(compareResults)
        .findIndex((e) => e.sessionId === entry.sessionId) + 1;
      return json(res, 200, { ok: true, rank, duplicate: true, validated: true });
    }

    const verdict = verifySubmission(entry);
    if ('reason' in verdict && typeof verdict.reason === 'string' && !verdict.status) {
      return json(res, 400, { error: verdict.reason });
    }

    const record = {
      board: entry.board,
      name: entry.name,
      score: entry.score,
      completed: entry.completed,
      invalid: entry.invalid,
      elapsedMs: entry.elapsedMs,
      sessionId: entry.sessionId,
      ruleset: String(entry.ruleset || '').slice(0, 24),
      contentVersion: entry.contentVersion,
      seed: String(entry.seed || '').slice(0, 64),
      assists: {
        undo: !!(entry.assists && entry.assists.undo),
        hint: !!(entry.assists && entry.assists.hint),
        timingAssist: !!(entry.assists && entry.assists.timingAssist),
      },
      durationMs: entry.elapsedMs,
      validated: verdict.status === 'validated',
      at: Date.now(),
    };
    list.push(record);
    list.sort(compareResults);
    store.boards[entry.board] = list.slice(0, MAX_BOARD_ENTRIES);
    saveStoreSoon();
    const rank = store.boards[entry.board].findIndex((e) => e.sessionId === entry.sessionId) + 1;
    json(res, 200, { ok: true, rank, validated: record.validated, casual: !record.validated });
  },

  async 'POST /api/v1/activity'(req, res) {
    try {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      if (typeof body.activityId !== 'string' || body.activityId.length > 64) {
        return json(res, 400, { error: 'activity' });
      }
      activitySessions.set(body.activityId, Date.now());
      json(res, 200, { ok: true });
    } catch {
      json(res, 400, { error: 'bad-json' });
    }
  },

  async 'POST /api/v1/activity/end'(req, res) {
    try {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      const started = activitySessions.get(body.activityId);
      if (started) {
        activitySessions.delete(body.activityId);
        store.activity.sessions++;
        store.activity.totalMs += Math.max(0, Date.now() - started);
        saveStoreSoon();
      }
      json(res, 200, { ok: true });
    } catch {
      json(res, 400, { error: 'bad-json' });
    }
  },

  async 'POST /api/v1/presence'(req, res) {
    try {
      await readBody(req);
    } catch { /* ignore */ }
    json(res, 200, { ok: true });
  },

  async 'POST /api/v1/telemetry'(req, res) {
    // Aggregate counters only — never raw text, identifiers, or trails.
    const ALLOWED = new Set(['start', 'tutorial-step', 'round-end', 'retry', 'settings-change', 'error']);
    try {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      const events = Array.isArray(body.events) ? body.events.slice(0, 50) : [];
      for (const ev of events) {
        if (!ev || !ALLOWED.has(ev.event)) continue;
        store.telemetry[ev.event] = (store.telemetry[ev.event] || 0) + 1;
      }
      if (events.length) saveStoreSoon();
      json(res, 200, { ok: true });
    } catch {
      json(res, 400, { error: 'bad-json' });
    }
  },
};

const activitySessions = new Map();

// ---------------------------------------------------------------------------
// static file serving
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
};

// Never served: design docs, server config, tests, data, VCS, dotfiles.
const BLOCKED_FILES = new Set(['spec.md', 'server.js', 'package.json', 'package-lock.json', '.DS_Store']);
const BLOCKED_DIRS = ['tests', 'data', 'node_modules', '.git'];

function safeResolve(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const rel = clean === '/' ? 'index.html' : clean.replace(/^\/+/, '');
  const resolved = path.resolve(ROOT, rel);
  if (!resolved.startsWith(ROOT + path.sep) && resolved !== ROOT) return null;
  const parts = rel.split('/');
  const base = parts[parts.length - 1];
  if (base.startsWith('.') || BLOCKED_FILES.has(base)) return null;
  if (parts.some((p) => BLOCKED_DIRS.includes(p))) return null;
  return resolved;
}

function serveStatic(req, res, urlPath) {
  const file = safeResolve(urlPath);
  if (!file) return json(res, 403, { error: 'forbidden' });
  const ext = path.extname(file).toLowerCase();
  const mime = MIME[ext] || (path.basename(file) === 'starhermit.txt' ? 'text/plain; charset=utf-8' : null);
  if (!mime) return json(res, 404, { error: 'not-found' });

  // Immutable assets (vendor, versioned js/css) cache hard; the entry page
  // always revalidates so updates activate between rounds, never during one.
  const immutable = ext !== '.html' && !/^index\.html?$/.test(path.basename(file));
  const headers = {
    'content-type': mime,
    'cache-control': immutable ? 'public, max-age=3600' : 'no-cache',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy':
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
      "connect-src 'self'; img-src 'self' data:; worker-src 'none'; frame-ancestors 'self'",
  };
  const stream = createReadStream(file);
  stream.on('open', () => {
    res.writeHead(200, headers);
    stream.pipe(res);
  });
  stream.on('error', () => {
    if (!res.headersSent) json(res, 404, { error: 'not-found' });
    else res.end();
  });
}

// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const route = req.method + ' ' + url.pathname;
  const ip = req.socket.remoteAddress || 'unknown';

  if (url.pathname.startsWith('/api/')) {
    if (!rateAllow('api:' + ip, 240, 60 * 1000)) {
      return json(res, 429, { error: 'rate-limited' }, { 'retry-after': '60' });
    }
    const handler = api[route];
    if (!handler) return json(res, 404, { error: 'not-found' });
    try {
      return await handler(req, res, url, ip);
    } catch (err) {
      console.error('api error', route, err);
      return json(res, 500, { error: 'internal' });
    }
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json(res, 405, { error: 'method' });
  }
  serveStatic(req, res, url.pathname);
});

export async function startServer(port = PORT) {
  await loadStore();
  return new Promise((resolve) => {
    server.listen(port, () => {
      const address = server.address();
      console.log(`Vanishing Cubes ${BUILD} listening on http://localhost:${address.port}`);
      resolve(server);
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  startServer();
}
