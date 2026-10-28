// The game's data and the StarHermit platform (what js/session/persistence.js,
// js/platform/platform.js and the JS SDK did):
// - one save document (js/migrate.js: the game's own options, progression,
//   profile, achievements, the personal-record boards and the resumable
//   round) in starhermit:storage `saves` — on the device and, signed in, the
//   player's cloud slot. Two devices' copies merge on a conflict (mergeDocs:
//   the browser build's saveconflict merge). The slot the browser build wrote
//   (its { savedAt, docs } mirror under game:<slug>) shows as foreign: it is
//   merged in and replaced once;
// - the browser build's settings KV mirror is read once for the game's own
//   options, then its keys go;
// - the player, the invite link, the platform clock for the Daily's UTC day,
//   the game's high-score board, and posting a finished ranked round through
//   score-script.js (a practice session whose socket carries
//   { type: 'result', scores }, as the JS SDK's submitScores did).
import type { JsonValue } from "starhermit:engine";
import { connectGame, inviteLink as fetchInviteLink, leaderboards, onPlayerChange, player, serverNow, serverTime, sessions, type Leaderboard } from "starhermit:platform";
import { saves, settings as kv } from "starhermit:storage";
import { Migrate, type BoardEntry, type GameSettings, type SaveDoc } from "./game.ts";

export let doc: SaveDoc = Migrate.emptyDoc();
let lastSavedAt = 0;
const listeners = new Set<() => void>();
/** fn() after progress from the account (another device, the browser build) was merged in. */
export function onMerged(fn: () => void): void { listeners.add(fn); }
const progressKey = (d: SaveDoc): string => JSON.stringify([d.progression, d.achievements, d.boards, d.profile]);

export function save(): void {
  try { saves.save(doc as unknown as JsonValue, { schema: 1 }); lastSavedAt = saves.load()?.savedAt ?? lastSavedAt; }
  catch (e) { console.warn(`save: ${String(e)}`); }
}
function adopt(next: SaveDoc): void {
  const before = progressKey(doc);
  doc = next;
  if (progressKey(doc) !== before) for (const fn of listeners) fn();
}
saves.onConflict((mine, remote) => ({ merged: Migrate.mergeDocs(remote.data, mine?.data ?? doc) as unknown as JsonValue }));
saves.onStatus((_status, state) => {
  if (state === "foreign") { migrateForeign(); return; }
  const cur = saves.load();
  if (cur && cur.savedAt !== lastSavedAt) {
    lastSavedAt = cur.savedAt;
    const merged = Migrate.mergeDocs(cur.data, doc);
    if (JSON.stringify(merged) !== JSON.stringify(doc)) adopt(merged);
  }
});
function migrateForeign(): void {
  const old = saves.foreign();
  if (!old) return;
  let parsed: unknown = null;
  try { parsed = old.text != null ? JSON.parse(old.text) : null; } catch { parsed = null; }
  const from = Migrate.fromForeign(parsed);
  const next = from ? Migrate.mergeDocs(from, doc) : doc;
  if (from && doc.profile.name === "Guest") next.profile = from.profile;
  adopt(next);
  try { saves.save(doc as unknown as JsonValue, { schema: 1, replaceForeign: true }); lastSavedAt = saves.load()?.savedAt ?? lastSavedAt; }
  catch (e) { console.warn(`save: ${String(e)}`); }
}
const LEGACY_KEYS = ["audio", "graphics", "accessibility", "telemetryConsent"];
function importLegacy(): void {
  const keys = kv.legacyKeys();
  if (!keys || !keys.length) return;
  const old: Record<string, unknown> = {};
  for (const k of keys) old[k] = kv.legacy(k);
  let done = false;
  try { done = kv.get("legacyImported") === true; } catch { done = true; }
  if (!done) {
    const patch = Migrate.pickLegacy(old);
    if (Object.keys(patch).length) { doc.settings = { ...doc.settings, ...patch }; save(); }
    try { kv.set("legacyImported", true); } catch { /* next time */ }
  }
  for (const k of keys) if (LEGACY_KEYS.includes(k) || k.startsWith("ui.")) kv.removeLegacy(k);
}

/** Reads the device's save (from onStart). */
export function initPlatform(): void {
  const cur = saves.load();
  lastSavedAt = cur?.savedAt ?? 0;
  doc = Migrate.normalizeDoc(cur?.data ?? null);
  kv.onLegacy(importLegacy);
  importLegacy();
  if (saves.state() === "foreign") migrateForeign();
  refreshPlayer();
  void serverTime().then(() => undefined, () => undefined);
}
export function setOptions(patch: Partial<GameSettings>): void { doc.settings = { ...doc.settings, ...patch }; save(); }
/** platform.js statusText: null for a guest, else saving | synced | offline. */
export function syncState(): "saving" | "synced" | "offline" | null {
  if (!player()) return null;
  const st = saves.state();
  if (st === "error" || st === "read-blocked") return "offline";
  if (st === "loading" || st === "foreign" || st === "uploading" || saves.status() === "pending") return "saving";
  return "synced";
}
export function flush(): void { void saves.flush().catch(() => undefined); }

// --- the player and the clock ----------------------------------------------------------------
export function signedIn(): boolean { return !!player(); }
export function displayName(): string | null { return player()?.displayName ?? null; }
let invite: string | null = null;
export function inviteLink(): string | null { return player() ? invite : null; }
function refreshPlayer(): void {
  invite = null;
  board = undefined;
  if (!player()) return;
  fetchInviteLink().then((u) => { invite = u; }, () => { invite = null; });
}
onPlayerChange(() => refreshPlayer());
/** The platform's clock when it answered, else the device's. */
export function nowMs(): number { try { return serverNow() ?? Date.now(); } catch { return Date.now(); } }
export function utcDateKey(ms: number = nowMs()): string { return new Date(ms).toISOString().slice(0, 10); }

// --- personal-record boards (platform.js submitScore / leaderboard) ---------------------------
export function recordLocal(entry: Omit<BoardEntry, "at">): number {
  const list = doc.boards.entries[entry.board] ?? (doc.boards.entries[entry.board] = []);
  const dup = list.findIndex((e) => e.sessionId === entry.sessionId);
  if (dup !== -1) return dup + 1;
  list.push({ ...entry, at: Date.now() });
  list.sort((a, b) => b.score - a.score || a.invalid - b.invalid || a.elapsedMs - b.elapsedMs);
  doc.boards.entries[entry.board] = list.slice(0, 100);
  save();
  return doc.boards.entries[entry.board]!.findIndex((e) => e.sessionId === entry.sessionId) + 1;
}

// --- the high-score board ----------------------------------------------------------------------
let board: Leaderboard | null | undefined;
async function highScoreBoard(): Promise<Leaderboard | null> {
  if (board !== undefined) return board;
  const list = await leaderboards.list();
  board = list.find((b) => b.key === "high-score") ?? list[0] ?? null;
  return board;
}
export interface Entry { rank: number; name: string; score: number; me: boolean }
/** The top 20 (friends only on request); null when there is none. */
export async function fetchBoard(friends: boolean): Promise<Entry[] | null> {
  try {
    const b = await highScoreBoard();
    if (!b || (friends && !player())) return null;
    const r = await leaderboards.entries(b.id, { pageSize: 20, ...(friends ? { friendsOnly: true } : {}) });
    const meId = player()?.userId;
    return r.items.slice(0, 20).map((e, i) => ({ rank: e.rank ?? i + 1, name: e.displayName || e.username || "", score: e.score ?? 0, me: e.userId === meId }));
  } catch { return null; }
}
export interface Posted { posted: boolean; rank: number | null }
/** Signed in only, through score-script.js (range-checked there); { posted, rank }. Never rejects. */
export async function postScore(total: number): Promise<Posted> {
  const me = player();
  if (!me) return { posted: false, rank: null };
  const score = Math.max(0, Math.round(total));
  let accepted: string[] = [];
  try {
    const sessionId = await sessions.practice();
    accepted = await new Promise<string[]>((resolve) => {
      const socket = connectGame(sessionId);
      let done = false;
      const finish = (list: string[]): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.close();
        resolve(list);
      };
      const timer = setTimeout(() => finish([]), 15000);
      socket.on("open", () => { socket.sendCommand({ type: "result", scores: { "high-score": score } }); });
      socket.on("game", (d) => {
        const m = d as { type?: string; accepted?: string[] } | null;
        if (m && m.type === "result-ack") finish(Array.isArray(m.accepted) ? m.accepted : []);
      });
      socket.on("error", () => finish([]));
      socket.on("stopped", () => finish([]));
      socket.on("abandoned", () => finish([]));
    });
  } catch { return { posted: false, rank: null }; }
  if (!accepted.includes("high-score")) return { posted: false, rank: null };
  try {
    const b = await highScoreBoard();
    if (!b) return { posted: true, rank: null };
    const r = await leaderboards.entries(b.id, { pageSize: 100 });
    const mine = r.items.find((e) => e.userId === me.userId);
    return { posted: true, rank: mine ? mine.rank : null };
  } catch { return { posted: true, rank: null }; }
}
