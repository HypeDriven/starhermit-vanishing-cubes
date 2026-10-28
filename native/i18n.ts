// Localization: the browser build's tables (js/ui/strings.js: flat keys and
// per-id maps for levels, chapters, tips, lessons, lesson steps, challenges,
// themes, achievements; js/ui/platform-strings.js for the StarHermit lines)
// plus js/ui/engine-strings.js (what this client adds or rewords), in the nine
// locales, following the runtime's interface language (Options › Language,
// else the account's preferred language, else the device's). Everything is
// drawn through T() each frame, so a change shows at once without restarting
// the round (what i18n.js onLanguage re-rendering did).
import { onPreferencesChange, preferences } from "starhermit:engine";
import * as ui from "starhermit:ui";
import { STRINGS } from "../js/ui/strings.js";
import { PLATFORM_STRINGS } from "../js/ui/platform-strings.js";
import { ENGINE_STRINGS } from "../js/ui/engine-strings.js";
import type { Explain, Level } from "./game.ts";

type Table = Record<string, unknown>;
const BASE = STRINGS as unknown as Record<string, Table>;
const EXTRA = ENGINE_STRINGS as unknown as Record<string, Table>;
const TABLES: Record<string, Table> = Object.fromEntries(Object.keys(BASE).map((l) => [l, { ...BASE[l], ...(EXTRA[l] ?? EXTRA["en-US"]) }]));
const PLAT = PLATFORM_STRINGS as unknown as Record<string, Record<string, string>>;
const EN = TABLES["en-US"]!;
export const LOCALES = Object.keys(TABLES);
let locale = "";
let dict: Table = EN;

/** The closest shipped locale for a BCP 47 tag. */
export function matchLocale(tag: string): string {
  const t = String(tag || "en-US");
  const exact = LOCALES.find((l) => l.toLowerCase() === t.toLowerCase());
  if (exact) return exact;
  const lang = t.split(/[-_]/)[0]!.toLowerCase();
  const region = (t.split(/[-_]/)[1] ?? "").toUpperCase();
  if (lang === "en") return ["GB", "IE", "AU", "NZ"].includes(region) ? "en-GB" : "en-US";
  if (lang === "es") return region === "ES" ? "es-ES" : "es-419";
  if (lang === "fr") return region === "CA" ? "fr-CA" : "fr-FR";
  if (lang === "pt") return "pt-BR";
  if (lang === "de") return "de-DE";
  if (lang === "it") return "it-IT";
  return "en-US";
}
function apply(tag: string): void {
  const loc = matchLocale(tag);
  if (loc === locale) return;
  locale = loc;
  dict = TABLES[loc]!;
  try { ui.setLanguage(locale); } catch { /* older hosts */ }
}
apply(preferences().language);
onPreferencesChange((p) => apply(p.language));

export type Vars = Record<string, string | number>;
const fill = (s: string, vars?: Vars | null): string =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] != null ? String(vars[k]) : m)) : s;
/** i18n.js t(). */
export function T(key: string, vars?: Vars | null): string { return fill(String(dict[key] ?? EN[key] ?? key), vars); }
export const hasKey = (key: string): boolean => typeof EN[key] === "string";
/** i18n.js tn(): a content name from a nested map. */
export function tn<V>(group: string, id: string | number, fallback: V): V {
  const own = (dict[group] as Record<string, unknown> | undefined)?.[id];
  if (own != null) return own as V;
  const en = (EN[group] as Record<string, unknown> | undefined)?.[id];
  return (en != null ? en : fallback) as V;
}
/** platform-strings.js. */
export function S(key: string, vars?: Vars): string {
  const table = PLAT[locale] ?? PLAT["en-US"]!;
  return fill(table[key] ?? PLAT["en-US"]![key] ?? key, vars);
}
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
