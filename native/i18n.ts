// Localization: assets/strings.json (generated from the browser build's tables:
// flat keys plus group.id keys for levels, chapters, tips, lessons, lesson steps,
// challenges, themes and achievements, in the nine locales) on the engine's
// strings, which follow the interface language the runtime reports (Options ›
// Language, else the account's preferred language, else the device's), own the
// locale fallback and the account strings (`starhermit.*`). Everything is drawn
// through T() each frame, so a change shows at once without restarting the
// round (what i18n.js onLanguage re-rendering did).
import {files, preferences, strings} from "starhermit:engine";

// Locale tables are split per language. Only the player's fallback chain is
// parsed and kept (en-US first, so it remains the default). Other locales stay
// in the package until the language changes.
const __stringLocales = new Set<string>();
let __stringsBusy = false;
let __stringsWatching = false;
function loadGameStrings(dir: string): void {
  if (__stringsBusy) return;
  __stringsBusy = true;
  try {
    let tag = "en";
    try {
      const language = preferences().language;
      if (language) tag = language;
    } catch { /* preferences are not ready while the module is still loading */ }
    const want = stringLocalesFor(tag);
    const ordered = [...want.filter((locale) => locale === "en-US"), ...want.filter((locale) => locale !== "en-US")];
    const batch: { [locale: string]: unknown } = {};
    for (const locale of ordered) {
      if (__stringLocales.has(locale)) continue;
      const path = `${dir}/${locale}.json`;
      if (!files.exists(path)) continue;
      const table = files.readJson(path);
      if (!table || typeof table !== "object" || Array.isArray(table)) continue;
      batch[locale] = table;
    }
    const added = Object.keys(batch);
    if (added.length) {
      strings.load(batch);
      for (const locale of added) __stringLocales.add(locale);
    }
  } finally {
    __stringsBusy = false;
  }
  if (!__stringsWatching) {
    __stringsWatching = true;
    strings.onChange(() => loadGameStrings(dir));
  }
}
function stringLocalesFor(tag: string): string[] {
  const out: string[] = [];
  const add = (locale: string): void => { if (locale && !out.includes(locale)) out.push(locale); };
  const bits = tag.replace(/_/g, "-").split("-").filter(Boolean);
  const language = (bits[0] || "en").toLowerCase();
  const regionBit = bits.slice(1).find((part) => /^[A-Za-z]{2}$/.test(part) || /^\d{3}$/.test(part));
  const region = regionBit ? (/^\d{3}$/.test(regionBit) ? regionBit : regionBit.toUpperCase()) : "";
  add(region ? `${language}-${region}` : language);
  if (bits.length > 2) {
    add(bits.map((part, index) => index === 0 ? language : (/^[A-Za-z]{2}$/.test(part) ? part.toUpperCase() : part)).join("-"));
  }
  if (language === "en" && region && region !== "US" && region !== "CA") add("en-001");
  if (language === "en" && region && region !== "US") add("en-GB");
  if (language === "es" && region !== "ES") add("es-419");
  if (language === "es") add("es-ES");
  if (language === "fr") add("fr-FR");
  if (language === "fr" && region === "CA") add("fr-CA");
  if (language === "de") add("de-DE");
  if (language === "pt" && region !== "BR") add("pt-PT");
  if (language === "pt") add("pt-BR");
  if (language === "it") add("it-IT");
  if (language === "nl") add("nl-NL");
  if (language === "ja") add("ja-JP");
  if (language === "zh") {
    const traditional = region === "HK" || region === "TW" || region === "MO";
    add(traditional ? "zh-HK" : "zh-CN");
    if (!traditional) add("zh-SG");
  }
  if (language === "yue") add("yue-HK");
  if (language === "ru") add("ru-FI");
  add(language);
  add("en-US");
  return out;
}
import * as ui from "starhermit:ui";
import type { Explain, Level } from "./game.ts";

loadGameStrings("assets/l10n/strings");
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
