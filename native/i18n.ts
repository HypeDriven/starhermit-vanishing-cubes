// Localization: assets/strings.json (generated from the browser build's tables:
// flat keys plus group.id keys for levels, chapters, tips, lessons, lesson steps,
// challenges, themes and achievements, in the nine locales) on the engine's
// strings, which follow the interface language the runtime reports (Options ›
// Language, else the account's preferred language, else the device's), own the
// locale fallback and the account strings (`starhermit.*`). Everything is drawn
// through T() each frame, so a change shows at once without restarting the
// round (what i18n.js onLanguage re-rendering did).
import { strings } from "starhermit:engine";
import * as ui from "starhermit:ui";
import type { Explain, Level } from "./game.ts";

strings.load("assets/strings.json");
strings.defaultLocale = "en-US";
ui.setLanguage(strings.locale);
strings.onChange((locale) => ui.setLanguage(locale));

export type Vars = Record<string, string | number>;
/** i18n.js t(). */
export function T(key: string, vars?: Vars | null): string { return strings.t(key, vars ?? undefined); }
export const hasKey = (key: string): boolean => strings.has(key);
/** i18n.js tn(): a content name by group and id (an achievement is [name, description]). */
export function tn<V extends string | string[]>(group: string, id: string | number, fallback: V): V {
  const key = `${group}.${id}`;
  if (typeof fallback === "string") return (strings.has(key) ? strings.t(key) : fallback) as V;
  return fallback.map((text, i) => (strings.has(`${key}.${i}`) ? strings.t(`${key}.${i}`) : text)) as V;
}
/** The engine's account strings (signIn, invite, inviteCopied, inviteLink, signedOut, leaderboard…). */
export function S(key: string, vars?: Vars): string { return strings.t(`starhermit.${key}`, vars); }
/** i18n.js levelName. */
export function levelName(level: { id: string; name: string } | null): string {
  if (!level) return "";
  const id = String(level.id || "");
  let m: RegExpExecArray | null;
  if ((m = /^lesson-(t\d+)$/.exec(id))) return tn("lessons", m[1]!, level.name);
  if ((m = /^practice-(easy|medium|hard)/.exec(id))) return T("practiceName", { level: T("diff_" + m[1]) });
  if ((m = /^daily-(.+)$/.exec(id))) return T("dailyName", { date: m[1]! });
  if (/^ch-/.test(id)) return tn("challenges", id, level.name);
  return tn("levels", id, level.name);
}
export function levelTip(level: Level | null): string {
  if (!level || !level.tip) return "";
  return /^daily-/.test(String(level.id)) ? T("tipDaily") : tn("tips", level.id, level.tip);
}
export const lessonStep = (lessonId: string, index: number, fallback: string): string => tn("lessonSteps", lessonId + "." + index, fallback);
export const dirName = (dir: number): string => T("dir_" + dir);
export function refusalText(ex: Explain | null | undefined): string {
  if (!ex || ex.ok) return "";
  switch (ex.reason) {
    case "not-active": return T("rsnNotActive");
    case "gone": return T("rsnGone");
    case "stone": return T("rsnStone");
    case "core": return T("rsnCore");
    case "locked": return ex.keyId ? T("rsnLocked", { key: ex.keyId }) : T("rsnLockedNoKey");
    case "blocked": return ex.byStone ? T("rsnBlockedStone") : T("rsnBlockedBy", { id: ex.by ?? "" });
    default: return ex.message || T("rsnDefault");
  }
}
export function playerName(name: string | null | undefined): string {
  if (name == null || name === "Guest" || name === "") return T("guest");
  const m = /^Player (\S+)$/.exec(String(name));
  return m ? T("playerN", { id: m[1]! }) : String(name);
}
/** hud.js formatMs. */
export function formatMs(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60), s = total % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}
