// The browser build's DOM shell (index.html + js/ui/screens.js, hud.js and
// a11y.js over css/main.css) as starhermit:ui, built every frame: the top bar
// (brand, sync chip, Profile, Help, Settings), the screens (title, mode
// cards, the per-mode setup lists, Scores, How to play, results) on the pale
// paper, the play layout — on wide windows (≥ 1024 px) the objective rail
// (stats, live score breakdown, par, tip) and the actions rail (Undo, Hint,
// rotations, camera reset, Board list, the selection line) beside the
// playfield; narrower, both rails are drawers behind Info / Tools and a
// bottom quick-action tray (a right-hand column on short landscape
// screens) — the HUD chips, the countdown, the lesson banner, toasts, and
// the dialogs (pause, the game's settings, profile, the board list). The
// rectangles left for the playfield go to render.ts, which fits the
// sculpture there. Old graphics / sound / language / key-binding panels are
// the runtime's Options now (Settings links to them).
import { frame, openMenu } from "starhermit:engine";
import { bindingLabel, primaryPointer } from "starhermit:input";
import * as ui from "starhermit:ui";
import * as draw from "starhermit:draw";
import { CHALLENGES, CHAPTERS, Engine, LESSONS, LEVEL_DEFS, THEMES, journeyLevel, type Level } from "./game.ts";
import { S, T, dirName, formatMs, levelName, levelTip, playerName, tn } from "./i18n.ts";
import * as platform from "./platform.ts";
import * as render from "./render.ts";
import * as audio from "./audio.ts";
import {
  app, attemptRelease, canHint, canUndo, closeModal, currentTheme, dailyLevel, dailyStreak, doHint, doRotate, doUndo, fresh, goTitle, helpBack,
  invite, later, leaveRound, levelSummary, loadBoard, next, openBoardList, openHelp, openModes, openProfile, openScores, openSettings,
  openSetup, pauseGame, playButton, prepareRound, preparingVisible, progression, resetCamera, restartRound, resumeGame, retry, selectionText,
  setField, setName, setOption, setTheme, settings, signIn, timeLeftMs, totalStars, tutorialText,
} from "./main.ts";
import { token } from "./style.ts";

// ------------------------------------------------------------------ layout
interface Layout { lw: number; lh: number; sc: number; ox: number; oy: number; wide: boolean; phone: boolean; short: boolean }
const lastSize = new Map<string, ui.Rect>();
function layoutNow(): Layout {
  const f = frame();
  const sc = ui.preferences().scale;
  const sa = f.safeArea;
  const lw = Math.max(1, (f.width - sa.left - sa.right) / sc), lh = Math.max(1, (f.height - sa.top - sa.bottom) / sc);
  const short = lh <= 500 && lw > lh;
  return { lw, lh, sc, ox: sa.left, oy: sa.top, wide: lw >= 1024 && !short, phone: lw <= 700 && lh >= lw, short };
}
const textWidth = (text: string, style: string, kind?: "button"): number =>
  ui.measureText(text, { ...(kind ? { kind } : {}), style: [style] }).width / ui.preferences().scale;
/** Text up to `width` wide: one label when it fits, else a paragraph. */
function para(text: string, width: number, cls = "text", id?: string): void {
  if (!text) return;
  const u = id ? ui.style(cls).id(id) : ui.style(cls);
  if (textWidth(text, cls) <= width) u.label(text);
  else u.paragraph(text, Math.max(20, width));
}
interface Btn { id: string; text: string; style?: string; act: () => void; disabled?: boolean; width?: number; name?: string; selected?: boolean }
const buttonWidth = (text: string, style: string): number => textWidth(text, style, "button") + 2;
function button(b: Btn): void {
  const style = b.style ?? "btn";
  const opts: ui.ButtonOptions = {};
  if (b.disabled) opts.disabled = true;
  if (b.selected) opts.selected = true;
  const s: ui.Style = {};
  if (b.width != null) {
    s.width = b.width;
    if (buttonWidth(b.text, style) > b.width) opts.content = () => { ui.style("wrap").paragraph(b.text, Math.max(20, b.width! - (style === "btn-tray" ? 12 : 34))); };
  }
  if (b.name && !opts.content) opts.content = () => { ui.style(style === "btn-primary" ? "wrap-white" : "wrap").label(b.text); };
  if (ui.style(style, s).id(b.id).button(b.name ?? b.text, opts) && fresh()) later(() => { audio.play("ui"); b.act(); });
}
/** .screen-actions / flex-wrap rows: buttons at their widths in rows that wrap at `width`. */
function flow(label: string, list: Btn[], width: number, gap = 8, align: ui.Align = "center"): ui.Rect {
  const rows: Btn[][] = [[]];
  let used = 0;
  const bw = (b: Btn): number => Math.min(width, b.width ?? buttonWidth(b.text, b.style ?? "btn"));
  for (const b of list) {
    const w = bw(b);
    if (rows[rows.length - 1]!.length && used + gap + w > width) { rows.push([]); used = 0; }
    used += (rows[rows.length - 1]!.length ? gap : 0) + w;
    rows[rows.length - 1]!.push(b);
  }
  return ui.column(label, () => {
    rows.forEach((row, ri) => ui.row(`${label}-r${ri}`, () => { for (const b of row) button({ ...b, width: bw(b) }); }, { spacing: gap }));
  }, { spacing: gap, width, align });
}
/** A wrapping check box (ui.checkbox labels do not wrap on phones). */
function toggleRow(id: string, label: string, on: boolean, w: number, set: (v: boolean) => void): void {
  ui.row(`${id}-row`, () => {
    para(label, w - 56, "text", `${id}-label`);
    ui.spacer();
    const res = ui.id(id).widget(label, {
      role: "checkbox", checked: on, size: { width: 44, height: 44 },
      draw: (r, st) => {
        const s = st.scale, box = 22 * s, bx = r.x + (r.width - box) / 2, by = r.y + (r.height - box) / 2;
        draw.roundRect(bx, by, box, box, 5, on ? token("accent") : "#ffffff");
        draw.strokeRoundRect(bx, by, box, box, 5, token("ink-soft"), 1.5);
        if (on) draw.text("✓", bx + box / 2, by + box * 0.05, { size: box * 0.85, color: "#ffffff", align: "center", weight: "bold" });
      },
    });
    if (res.activated && fresh()) later(() => set(!on));
  }, { width: w, align: "center", spacing: 10 });
}
function selectRow(id: string, label: string, index: number, options: string[], w: number, set: (i: number) => void): void {
  const narrow = w < 420;
  const build = (): void => {
    para(label, narrow ? w : w * 0.45, "text", `${id}-label`);
    if (!narrow) ui.spacer();
    const pick = ui.style({ width: narrow ? w : Math.min(w * 0.5, 260) }).id(id).select(label, index, options);
    if (pick !== index && fresh()) later(() => set(pick));
  };
  if (narrow) ui.column(`${id}-row`, build, { width: w, spacing: 4 });
  else ui.row(`${id}-row`, build, { width: w, align: "center", spacing: 10 });
}
function kv(id: string, k: string, v: string, w: number, cls = "small-ink", line = true): void {
  ui.row(id, () => { ui.style(cls).label(k); ui.spacer(); ui.style(cls).label(v); }, { width: w, ...(line ? { style: "row-line" } : {}) });
}
const hex = (n: number): string => "#" + n.toString(16).padStart(6, "0");
function mixHex(a: number, b: number, k: number): string {
  const ch = (n: number, sh: number): number => (n >> sh) & 255;
  return hex([16, 8, 0].reduce((acc, sh) => acc | (Math.round(ch(a, sh) + (ch(b, sh) - ch(a, sh)) * k) << sh), 0));
}

// ------------------------------------------------------------------ the frame
const TOP_H = 52;
export function drawScreens(): void {
  const L = layoutNow();
  const f = frame();
  const inPlay = !!app.session && ["countdown", "active", "paused", "resolving"].includes(app.phase) && !app.screen;
  backdrop(L, inPlay);
  topBar(L);
  if (inPlay) game(L);
  else { render.setView(f.width, f.height, null); setField(null); }
  if (app.screen) screen(L, app.screen);
  if (app.phase === "preparing") overlayLine(L, T("preparing"), preparingVisible());
  if (app.modal) modal(L, app.modal);
  toasts(L, inPlay);
  if (app.focusNext && primaryPointer() !== "coarse") {
    const age = f.frame - app.openedFrame;
    if (age >= 1) ui.setFocus(app.focusNext);
    if (age >= 3) app.focusNext = null;
  } else app.focusNext = null;
}
/** The page background: the paper, the title's pale sky (Detailed tiers) and the playfield's gradient. */
function backdrop(L: Layout, inPlay: boolean): void {
  const f = frame();
  if (inPlay) return;
  if (app.screen === "title" && f.quality !== "low" && !ui.preferences().highContrast) {
    const t = currentTheme();
    draw.box(0, 0, f.width, f.height, { background: { type: "linear", stops: [hex(t.sky.top), mixHex(t.sky.top, t.sky.horizon, 1 / 3), mixHex(t.sky.top, t.sky.horizon, 2 / 3), hex(t.sky.horizon), hex(t.sky.horizon)] }, radius: 0 } as ui.Style);
  } else draw.box(0, 0, f.width, f.height, "paper");
  void L;
}

// ------------------------------------------------------------------ top bar
function topBar(L: Layout): void {
  const pad = 12;
  ui.place("topbar", { x: 0, y: 0 }, () => {
    ui.row("topbar-row", () => {
      ui.id("brand").widget(L.phone ? "" : "Vanishing Cubes", { role: "image", size: { width: 22, height: 22 }, draw: (r, st) => brandMark(r, st.scale) });
      if (!L.phone) ui.style("brand").label("Vanishing Cubes");
      ui.spacer();
      const sync = platform.syncState();
      const net = sync == null ? T("netLocal") : T("netOnline", { state: T({ synced: "netSynced", saving: "netSaving", offline: "netOffline" }[sync]) });
      ui.column("net", () => { ui.style("net").label(net); }, { style: "net-chip" });
      const list: Btn[] = [
        { id: "btn-profile", text: T("profile"), style: "btn-ghost", act: openProfile },
        { id: "btn-help", text: T("help"), style: "btn-ghost", act: openHelp },
        { id: "btn-settings", text: T("settings"), style: "btn-ghost", act: openSettings },
      ];
      for (const b of list) button(b);
    }, { style: "topbar", width: L.lw, height: TOP_H, spacing: L.phone ? 5 : 7, align: "center", padding: { start: pad, end: pad } });
  });
}
function brandMark(r: ui.Rect, s: number): void {
  draw.roundRect(r.x, r.y, r.width, r.height, 5, "#f4f6f8");
  draw.strokeRoundRect(r.x, r.y, r.width, r.height, 5, "#1c2733", 2);
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  draw.line(cx - 5 * s, cy, cx + 4 * s, cy, "#1c2733", 2.5);
  draw.line(cx + 4 * s, cy, cx, cy - 4 * s, "#1c2733", 2.5);
  draw.line(cx + 4 * s, cy, cx, cy + 4 * s, "#1c2733", 2.5);
}

// ------------------------------------------------------------------ menu screens
function screen(L: Layout, o: NonNullable<typeof app.screen>): void {
  const maxW = o === "modes" ? 980 : o === "results" ? 560 : o === "title" ? 720 : 720;
  const w = Math.min(L.lw - (L.phone ? 24 : 32), maxW);
  const top = TOP_H + 4;
  const maxH = L.lh - top - 8;
  const key = `screen-${o}`;
  const prev = lastSize.get(key);
  const scroll = !!prev && prev.height / L.sc + 40 > maxH;
  const opening = frame().frame - app.openedFrame <= 6;
  const body = (): void => { lastSize.set(key, ui.column(`${key}-in`, () => buildScreen(o, w - (scroll ? 16 : 0), L), { spacing: 14, width: w - (scroll ? 16 : 0), align: "center" })); };
  const centred = !scroll && (o === "title" || o === "results");
  ui.place("screen", centred ? { anchor: "center", y: top / 2 } : { anchor: "top", y: top + 16 }, () => {
    if (scroll) ui.scrollArea(`${key}-scroll`, { width: w + 4, height: maxH - 24 }, body, opening && !app.focusNext ? { scrollTo: { top: 0 } } : undefined);
    else body();
  });
  if (ui.back() && fresh() && !app.modal) {
    if (o === "setup" || o === "scores") later(openModes);
    else if (o === "help") later(helpBack);
    else if (o === "modes") later(goTitle);
  }
}
function buildScreen(o: NonNullable<typeof app.screen>, w: number, L: Layout): void {
  switch (o) {
    case "title": titleScreen(w); break;
    case "modes": modesScreen(w); break;
    case "setup": setupScreen(w); break;
    case "scores": scoresScreen(w); break;
    case "help": helpScreen(w); break;
    case "results": resultsScreen(w); break;
  }
  void L;
}
function backButton(act: () => void): void { flow("back", [{ id: "btn-back", text: T("back"), style: "btn-ghost", act: () => { audio.play("back"); act(); } }], 400); }

function titleScreen(w: number): void {
  const title = "Vanishing Cubes";
  const tw = textWidth(title, "title");
  if (tw <= w) ui.style("title").heading(title);
  else ui.style("title", { text: { size: Math.max(36, (60 * w) / tw) } }).heading(title);
  para(T("tagline"), Math.min(w, 420), "tagline", "tagline");
  ui.spacer(0.0001);
  button({ id: "btn-play", text: platform.doc.snapshot ? T("resume") : T("play"), style: "btn-xl", act: playButton });
  const list: Btn[] = [
    { id: "btn-daily", text: T("dailyChallenge"), act: () => openSetup("daily") },
    { id: "btn-journey", text: T("modeJourney"), act: () => openSetup("journey") },
    { id: "btn-scores", text: T("scores"), act: openScores },
    { id: "btn-modes", text: T("allModes"), act: openModes },
  ];
  if (!platform.signedIn()) list.push({ id: "btn-signin", text: S("signIn"), act: signIn });
  else if (platform.inviteLink()) list.push({ id: "btn-invite", text: S("invite"), act: invite });
  flow("title-secondary", list, w, 12);
  const p = progression();
  const done = Object.keys(p.journeyStars).length;
  para(done ? T("titleProgress", { done, stars: totalStars(), streak: dailyStreak() }) : T("titleEmpty"), w, "center-dim", "title-progress");
}
const modeId = (m: string): string => `mode-${m}`;
function card(id: string, title: string, lines: { text: string; cls: string }[], w: number, act: (() => void) | null, badge?: { text: string; ranked: boolean }): void {
  const innerW = w - 34;
  const res = ui.style(act ? "card" : "card", { width: w }).id(id).button(title, {
    ...(act ? {} : { disabled: true }),
    content: () => {
      ui.column(`${id}-c`, () => {
        if (badge) ui.column(`${id}-b`, () => { ui.style("badge-text").label(badge.text.toUpperCase()); }, { style: badge.ranked ? "badge" : "badge-casual" });
        para(title, innerW, "card-h");
        for (const l of lines) para(l.text, innerW, l.cls);
      }, { spacing: 5, width: innerW });
    },
  });
  if (res && act && fresh()) later(() => { audio.play("confirm"); act(); });
}
function grid(label: string, items: ((w: number) => void)[], w: number, minW: number, gap = 12): void {
  const cols = Math.max(1, Math.min(items.length, Math.floor((w + gap) / (minW + gap))));
  const cw = (w - gap * (cols - 1)) / cols;
  for (let i = 0; i < items.length; i += cols) {
    ui.row(`${label}-${i}`, () => { for (const it of items.slice(i, i + cols)) it(cw); }, { spacing: gap, width: w, align: "start" });
  }
}
function modesScreen(w: number): void {
  ui.style("h2").heading(T("chooseMode"));
  const p = progression();
  const stars = totalStars(), completed = Object.keys(p.journeyStars).length;
  const lessonsDone = LESSONS.filter((l) => p.tutorials[l.id]).length;
  const today = platform.utcDateKey();
  const cards: [string, string, string, boolean, string, () => void][] = [
    ["learn", T("modeLearn"), T("modeLearnBlurb"), false, T("nLessons", { n: lessonsDone, total: LESSONS.length }), () => openSetup("learn")],
    ["journey", T("modeJourney"), T("modeJourneyBlurb"), false, T("nStages", { n: completed, stars }), () => openSetup("journey")],
    ["daily", T("modeDaily"), T("modeDailyBlurb"), true, p.dailies[today]?.completed ? T("completedToday") : today, () => openSetup("daily")],
    ["practice", T("modePractice"), T("modePracticeBlurb"), false, "", () => openSetup("practice")],
    ["challenge", T("modeChallenge"), T("modeChallengeBlurb"), true, T("nChallenges", { n: CHALLENGES.length }), () => openSetup("challenge")],
    ["score-chase", T("modeScores"), T("modeScoresBlurb"), true, "", openScores],
  ];
  grid("mode-grid", cards.map(([id, name, blurb, ranked, status, act]) => (cw: number) =>
    card(modeId(id), name, [{ text: blurb, cls: "card-p" }, ...(status ? [{ text: status, cls: "small" }] : [])], cw, act,
      { text: ranked ? T("badgeRanked") : T("badgeCasual"), ranked })), w, 220);
  backButton(goTitle);
}
function facts(id: string, list: [string, string][], w: number): void {
  const text = list.map(([k, v]) => `${k}: ${v}`).join("   ");
  para(text, w, "small", id);
}
function panel(id: string, w: number, build: (iw: number) => void): void {
  ui.column(id, () => build(w - 36), { style: "panel", width: w, spacing: 10 });
}
function setupScreen(w: number): void {
  const mode = app.setupMode;
  ui.style("h2").heading(T("setupH_" + mode));
  const p = progression();
  if (mode === "learn") {
    panel("setup-learn", w, (iw) => {
      ui.style("h3").label(T("lessonsH"));
      facts("facts", [[T("factRules"), T("factRulesLearn")], [T("factPlayers"), "1"], [T("factRanked"), T("no")]], iw);
      grid("lessons", LESSONS.map((l) => (cw: number) => card(`lesson-${l.id}`, (p.tutorials[l.id] ? "✓ " : "") + tn("lessons", l.id, l.name),
        [{ text: tn("lessonGoals", l.id, l.goal), cls: "card-p" }], cw, () => prepareRound({ mode: "learn", lessonId: l.id }))), iw, 150, 10);
    });
  } else if (mode === "journey") {
    const starsOf = (id: string): number => p.journeyStars[id] || 0;
    for (const ch of CHAPTERS) {
      const idx = LEVEL_DEFS.map((d, i) => [d, i] as const).filter(([d]) => d.chapter === ch.id);
      if (!idx.length) continue;
      ui.column(`chapter-${ch.id}`, () => {
        para(T("chapterH", { n: ch.id, name: tn("chapters", ch.id, ch.name) }), w, "h3");
        para(tn("chapterBlurbs", ch.id, ch.blurb), w, "small");
      }, { width: w, spacing: 2 });
      grid(`stages-${ch.id}`, idx.map(([d, i]) => (cw: number) => {
        const unlocked = i === 0 || starsOf(LEVEL_DEFS[i - 1]!.id) > 0;
        const st = starsOf(d.id);
        card(`stage-${d.id}`, levelName(d as unknown as Level), [
          { text: levelSummary(journeyLevel(i)), cls: "card-p" },
          { text: st ? "★".repeat(st) + "☆".repeat(3 - st) : unlocked ? T("notCleared") : T("locked"), cls: "stars-inline" },
        ], cw, unlocked ? () => prepareRound({ mode: "journey", levelIndex: i }) : null);
      }), w, 150, 10);
    }
  } else if (mode === "daily") {
    const d = dailyLevel();
    const key = platform.utcDateKey();
    const doneToday = p.dailies[key] ?? null;
    panel("setup-daily", w, (iw) => {
      if (!d) { para(T("preparing"), iw, "dim", "daily-preparing"); return; }
      ui.style("h3").label(levelName(d));
      facts("facts", [[T("factSeed"), key], [T("factRules"), levelSummary(d)], [T("factExpected"), formatMs(d.par.timeMs)], [T("factPlayers"), "1"],
        [T("factAssists"), T("hintsOnly")], [T("factRanked"), platform.signedIn() ? T("rankedHosted") : T("rankedOffline")]], iw);
      if (doneToday) para(T("todaysBest", { score: doneToday.score, status: doneToday.completed ? T("cleared") : T("notClearedShort") }), iw, "dim");
      flow("daily-start", [{ id: "btn-start-daily", text: doneToday ? T("playAgain") : T("startDaily"), style: "btn-primary", act: () => prepareRound({ mode: "daily" }) }], iw, 8, "start");
    });
  } else if (mode === "practice") {
    panel("setup-practice", w, (iw) => {
      ui.style("h3").label(T("difficultyH"));
      facts("facts", [[T("factUndo"), T("allowed")], [T("factHints"), T("allowed")], [T("factRanked"), T("neverRanked")]], iw);
      grid("diffs", ["easy", "medium", "hard"].map((diff) => (cw: number) => {
        const best = p.practiceBest[diff];
        card(`diff-${diff}`, T("diff_" + diff), [{ text: T("diffBlurb_" + diff) + (best != null ? " " + T("bestN", { n: best }) : ""), cls: "card-p" }], cw,
          () => prepareRound({ mode: "practice", difficulty: diff }));
      }), iw, 150, 10);
    });
  } else if (mode === "challenge") {
    panel("setup-challenge", w, (iw) => {
      facts("facts", [[T("factUndo"), T("disabled")], [T("factHints"), T("disabled")], [T("factRanked"), platform.signedIn() ? T("rankedHosted") : T("rankedOffline")]], iw);
      grid("challenges", CHALLENGES.map((c) => (cw: number) => {
        const best = p.challengeBest[c.id];
        card(`challenge-${c.id}`, tn("challenges", c.id, c.name), [{ text: tn("challengeBlurbs", c.id, c.blurb) + (best != null ? " " + T("bestN", { n: best }) : ""), cls: "card-p" }], cw,
          () => prepareRound({ mode: "challenge", challengeId: c.id }));
      }), iw, 150, 10);
    });
  }
  backButton(openModes);
}

// ------------------------------------------------------------------ scores (screens.js renderScores)
let friendText = "";
let friendNames: string[] = [];
function boardTable(id: string, title: string, rows: { name: string; score: number; invalid?: number; time?: number; me?: boolean }[] | null, note: string | null, w: number): void {
  panel(id, w, (iw) => {
    ui.style("h3").label(title);
    if (note) para(note, iw, "small");
    const cols = [36, 0, 70, 70, 80];
    const nameW = iw - cols[0]! - cols[2]! - cols[3]! - cols[4]!;
    const narrow = nameW < 90;
    const line = (k: string, cells: string[], cls: string): void => {
      ui.row(k, () => {
        ui.style(cls, { width: cols[0] }).label(cells[0]!);
        ui.style(cls, { width: narrow ? iw - cols[0]! - 70 : nameW }).label(cells[1]!);
        ui.style(cls, { width: 70, text: { align: "end" } }).label(cells[2]!);
        if (!narrow) { ui.style(cls, { width: 70, text: { align: "end" } }).label(cells[3]!); ui.style(cls, { width: 80, text: { align: "end" } }).label(cells[4]!); }
      }, { width: iw, style: "row-line" });
    };
    line(`${id}-head`, ["#", T("colPlayer"), T("colScore"), T("colInvalid"), T("colTime")], "small-b");
    if (!rows) { para(T("boardUnavailable", { error: "—" }), iw, "small"); return; }
    if (!rows.length) { para(T("noEntries"), iw, "small"); return; }
    rows.slice(0, 10).forEach((r, i) => line(`${id}-${i}`, [String(i + 1), playerName(r.name) + (r.me ? T("youTag") : ""), String(r.score),
      r.invalid != null ? String(r.invalid) : "", r.time != null ? formatMs(r.time) : ""], "small-ink"));
  });
}
function scoresScreen(w: number): void {
  ui.style("h2").heading(T("scores"));
  para(platform.signedIn() ? T("scoresHosted") : T("scoresOffline"), w, "small", "scores-note");
  ui.row("friends", () => {
    ui.style("text").label(T("friendsLabel"));
    friendText = ui.style({ width: Math.max(120, Math.min(320, w - 260)) }).id("friends-field").textField("friends-field", friendText, { maxChars: 200, placeholder: T("friendsPlaceholder") });
    const submitted = ui.submitted(T("friendsLabel"));
    if ((ui.style("btn").id("btn-compare").button(friendNames.length ? T("clearFilter") : T("compare")) || submitted) && fresh()) later(() => {
      if (friendNames.length) { friendNames = []; friendText = ""; }
      else friendNames = friendText.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20);
      app.scoresFriends = friendNames.length > 0;
      loadBoard();
    });
  }, { spacing: 8, width: w, align: "center" });
  if (friendNames.length) para(T("showing", { names: friendNames.join(", ") }), w, "small");
  if (platform.signedIn()) {
    const b = app.board;
    if (b && !b.loading && !b.entries) para(T("noGlobalBoard"), w, "small");
    else boardTable("board-global", T("globalAll"), b?.loading ? [] : (b?.entries ?? []).map((e) => ({ name: e.name, score: e.score, me: e.me })), null, w);
  }
  const p = progression();
  const boards = [
    { id: "daily-" + platform.utcDateKey(), name: T("dailyName", { date: platform.utcDateKey() }) },
    ...CHALLENGES.map((c) => ({ id: "challenge-" + c.id, name: tn("challenges", c.id, c.name) })),
  ];
  for (const bd of boards) {
    let list = platform.doc.boards.entries[bd.id] ?? [];
    if (friendNames.length) list = list.filter((e) => friendNames.includes(e.name));
    boardTable(`board-${bd.id}`, bd.name, list.map((e) => ({ name: e.name, score: e.score, invalid: e.invalid, time: e.elapsedMs, me: e.sessionId === p.lastSessionId })), T("casualBoard"), w);
  }
  backButton(openModes);
}

// ------------------------------------------------------------------ help (generated from live bindings)
const BIND_ACTIONS = ["confirm", "cancel", "pause", "nav_next", "nav_prev", "rotate_left", "rotate_right", "undo", "hint", "cam_reset"];
const OLD_NAME: Record<string, string> = { nav_next: "navNext", nav_prev: "navPrev", rotate_left: "rotateLeft", rotate_right: "rotateRight", cam_reset: "camReset" };
function helpScreen(w: number): void {
  ui.style("h2").heading(T("howToPlay"));
  const cards: [string, string][] = [[T("helpGoal"), T("helpGoalText")], [T("helpStones"), T("helpStonesText")], [T("helpScoring"), T("helpScoringText")], [T("helpReading"), T("helpReadingText")]];
  cards.forEach(([h, b], i) => panel(`rule-${i}`, w, (iw) => { para(h, iw, "h3"); para(b, iw, "dim"); }));
  panel("rule-controls", w, (iw) => {
    para(T("helpControls"), iw, "h3");
    for (const a of BIND_ACTIONS) {
      const old = OLD_NAME[a] ?? a;
      const keys = safeLabel(a, "keyboard"), pad = safeLabel(a, "gamepad");
      para(`${T("bind_" + old)}: ${keys}${pad ? " · " + T("gamepadN", { button: pad }) : ""}`, iw, "small-ink", `bind-${a}`);
    }
    para(T("helpTouch"), iw, "dim");
  });
  backButton(helpBack);
}
function safeLabel(action: string, device: "keyboard" | "gamepad"): string { try { return bindingLabel(action, device); } catch { return ""; } }

// ------------------------------------------------------------------ results (screens.js renderResults)
const HEADLINES: Record<string, string> = { cleared: "headCleared", "moves-exhausted": "headMoves", "time-exhausted": "headTime", conceded: "headConceded", "no-legal-moves": "headNoMoves" };
function resultsScreen(w: number): void {
  const r = app.results;
  if (!r) return;
  ui.column("results-card", () => {
    const iw = w - 48;
    para(T(HEADLINES[r.result.terminalReason] ?? "headOver"), iw, "h2c", "results-heading");
    para(`${levelName(r.level)} · ${T("modeName_" + r.mode)} · ${formatMs(r.result.elapsedMs)}`, iw, "center-dim", "results-sub");
    if (r.result.stars > 0) ui.style("stars").label("★".repeat(r.result.stars) + "☆".repeat(3 - r.result.stars), { tooltip: T("starsOf3", { n: r.result.stars }) });
    const c = r.result.components;
    const rows: [string, number][] = [
      [T("rowReleasedN", { n: r.result.stats.released }), c.release], [T("rowCompletion"), c.completion], [T("rowTapEff"), c.tapEfficiency],
      [T("rowRotEff"), c.rotationEfficiency], [T("rowTime"), c.timeBonus], [T("rowInvalidN", { n: r.result.stats.invalid }), -c.invalidPenalty],
    ];
    ui.column("score-table", () => {
      rows.forEach(([k, v], i) => kv(`sr-${i}`, k, String(v), iw, "text"));
      ui.row("sr-total", () => { ui.style("text-b").label(T("total")); ui.spacer(); ui.style("text-b").id("results-total").label(String(r.result.score)); }, { width: iw, style: "row-total" });
    }, { width: iw, spacing: 0 });
    for (const a of r.achievements) {
      const [name, desc] = tn<string[]>("achievements", a.key, [a.name, a.desc]);
      ui.column(`ach-${a.key}`, () => para(T("achievementChip", { name: name!, desc: desc! }), iw - 30, "ach-text"), { style: "ach" });
    }
    const parts: string[] = [];
    if (r.rank) parts.push(T("rankCasual", { rank: r.rank }));
    if (r.previousBest != null) parts.push(r.result.score > r.previousBest ? T("newBest", { n: r.previousBest }) : T("personalBest", { n: r.previousBest }));
    if (parts.length) para(parts.join(" "), iw, "center-dim", "results-comparison");
    if (r.lb) para(S(r.lb.key, r.lb.vars), iw, "center-dim", "results-lb");
    const acts: Btn[] = [{ id: "btn-retry", text: T("retry"), act: retry }];
    if (r.nextLabel !== "modes") acts.push({ id: "btn-next", text: T(r.nextLabel), style: "btn-primary", act: next });
    acts.push({ id: "btn-results-exit", text: T("modes"), style: "btn-ghost", act: () => { audio.play("back"); openModes(); } });
    flow("results-actions", acts, iw, 12);
  }, { style: "results", width: w, spacing: 10, align: "center" });
}

// ------------------------------------------------------------------ the game layout
function game(L: Layout): void {
  const s = app.session!, st = s.state, level = app.level!;
  const f = frame();
  const sc = L.sc;
  const RAIL = 250;
  const top = TOP_H;
  const trayH = !L.wide && !L.short ? 60 : 0;
  const trayColW = L.short ? 64 : 0;
  // the playfield rectangle (logical), what the rails and tray leave
  const fx = L.wide ? RAIL : 0, fy = top, fw = L.lw - (L.wide ? 2 * RAIL : 0) - trayColW, fh = L.lh - top - trayH;
  const left = settings().leftHanded;
  const pfx = L.wide && left ? fx : fx; // the rails swap with left-handed on wide screens
  const fieldRect = { x: L.ox + pfx * sc, y: L.oy + fy * sc, width: fw * sc, height: fh * sc };
  render.setView(f.width, f.height, fieldRect);
  setField(fieldRect);
  const playing = app.phase === "active";
  // named areas over the clear cubes (screen readers, play scripts, browser checks)
  if (playing && !app.modal) {
    const legal = Engine.legalActions(st).map((a) => a.cubeId);
    for (const id of legal) {
      const rc = render.cubeRect(id, f.width, f.height);
      if (rc && rc.x > fieldRect.x && rc.y > fieldRect.y && rc.x + rc.width < fieldRect.x + fieldRect.width && rc.y + rc.height < fieldRect.y + fieldRect.height) {
        ui.target(T("mirrorClearAria", { cube: describe(st.cubes.find((c) => c.id === id)!), status: T("stClear") }), rc, { role: "button" });
      }
    }
  }
  const railL = (w: number): void => objectiveRail(w, level);
  const railR = (w: number): void => actionsRail(w);
  if (L.wide) {
    const lx = left ? L.lw - RAIL : 0, rx = left ? 0 : L.lw - RAIL;
    ui.place("rail-left", { x: lx, y: top }, () => { ui.column("rail-l", () => railL(RAIL - 29), { style: left ? "rail-right" : "rail-left", width: RAIL, height: L.lh - top, spacing: 6 }); });
    ui.place("rail-right", { x: rx, y: top }, () => { ui.column("rail-r", () => railR(RAIL - 29), { style: left ? "rail-left" : "rail-right", width: RAIL, height: L.lh - top, spacing: 8 }); });
  }
  // the HUD over the playfield
  const hudW = fw - 16;
  ui.place("hud-top", { x: fx + 8, y: top + 8 }, () => {
    ui.row("hud-top-row", () => {
      if (!L.wide) button({ id: "btn-drawer-left", text: T("info"), style: "btn-ghost", name: T("openObjective"), act: () => { app.railOpen = app.railOpen === "left" ? null : "left"; } });
      const clock = timeLeftMs();
      const reserve = (L.wide ? 0 : buttonWidth(T("info"), "btn-ghost") + buttonWidth(T("tools"), "btn-ghost") + 16)
        + (clock != null ? textWidth("⏱ " + formatMs(clock), "chip-text") + 40 : 0) + (L.short ? 0 : buttonWidth("II", "btn-ghost") + 8);
      ui.column("hud-chip", () => para(T("hudLeft", { name: levelName(level), n: Engine.remainingArrows(st) }), Math.max(60, Math.min(hudW * 0.6, hudW - reserve - 40)), "chip-text", "hud-objective"), { style: "chip" });
      ui.spacer();
      if (clock != null) ui.column("hud-clock", () => { ui.style("chip-text", clock < 15000 ? { text: { color: token("danger") } } : {}).id("hud-clock-text").label("⏱ " + formatMs(clock)); }, { style: "chip" });
      if (!L.wide) button({ id: "btn-drawer-right", text: T("tools"), style: "btn-ghost", name: T("openActions"), act: () => { app.railOpen = app.railOpen === "right" ? null : "right"; } });
      if (!L.short) button({ id: "btn-pause", text: "II", name: T("pause"), style: "btn-ghost", act: () => pauseGame("user") });
    }, { width: hudW, spacing: 8, align: "center" });
  });
  if (app.phase === "countdown") {
    const size = Math.min(144, Math.max(64, fw * 0.18));
    ui.place("countdown", { x: fx + fw / 2 - 100, y: fy + fh / 2 - size * 0.7 }, () => {
      ui.column("countdown-col", () => { ui.style("countdown", { text: { size } }).id("countdown").label(String(app.countdown)); }, { width: 200, align: "center" });
    });
  }
  const banner = tutorialText();
  if (banner) {
    const bw = Math.min(560, fw * 0.92);
    const h = lastSize.get("banner")?.height ?? 60 * sc;
    ui.place("banner", { x: fx + (fw - bw) / 2, y: fy + fh - 16 - h / sc }, () => {
      lastSize.set("banner", ui.column("banner-col", () => para(banner, bw - 36, "text", "tutorial-text"), { style: "banner", width: bw }));
    });
  }
  // compact: the quick-action tray (bottom; a right-hand column on short landscape)
  if (!L.wide) {
    const acts: Btn[] = [
      { id: "tray-undo", text: T("undo"), act: doUndo, disabled: !canUndo() || !playing },
      { id: "tray-hint", text: T("hint"), act: doHint, disabled: !canHint() || !playing },
      { id: "tray-rot-left", text: "⟲", name: T("rotateLeft"), act: () => doRotate(1) },
      { id: "tray-rot-right", text: "⟳", name: T("rotateRight"), act: () => doRotate(-1) },
      { id: "tray-pause", text: T("pause"), act: () => pauseGame("user"), disabled: !playing },
    ];
    if (left) acts.reverse();
    if (L.short) {
      ui.place("tray", { x: L.lw - trayColW, y: top + 4 }, () => {
        ui.column("tray-col", () => { for (const a of acts) button({ ...a, style: "btn-tray", width: 58 }); }, { width: trayColW, spacing: 6, align: "center" });
      });
    } else {
      const bw = Math.min(120, (L.lw - 24 - 4 * 8) / 5);
      ui.place("tray", { anchor: "bottom", y: 0 }, () => {
        ui.row("tray-row", () => { for (const a of acts) button({ ...a, style: "btn-tray", width: bw }); }, { style: "tray", width: L.lw, height: trayH, spacing: 8, align: "center", justify: "center" });
      });
    }
    if (app.railOpen) {
      const dw = Math.min(300, L.lw * 0.84);
      const onLeft = app.railOpen === "left";
      // the scrim outside the drawer closes it
      const scrim = ui.place("drawer-scrim", { x: onLeft ? dw : 0, y: top }, () => {
        const r = ui.id("drawer-scrim").widget(T("close"), { role: "button", size: { width: L.lw - dw, height: L.lh - top }, draw: (rc) => draw.rect(rc.x, rc.y, rc.width, rc.height, "#1c273326") });
        if (r.activated && fresh()) later(() => { app.railOpen = null; });
      });
      void scrim;
      ui.place("drawer", { x: onLeft ? 0 : L.lw - dw, y: top }, () => {
        ui.column("drawer-col", () => (onLeft ? railL : railR)(dw - 29), { style: onLeft ? "rail-left" : "rail-right", width: dw, height: L.lh - top - trayH, spacing: 8 });
      });
    }
  }
  if (ui.back() && fresh() && !app.modal && playing) later(() => pauseGame("user"));
}
function objectiveRail(w: number, level: Level): void {
  const s = app.session!, st = s.state;
  ui.style("rail-h").label(T("objectiveH").toUpperCase());
  para(level.mechanics.includes("core") ? T("objectiveCore") : T("objective"), w, "text", "objective-text");
  ui.column("stats", () => {
    kv("stat-left", T("cubesLeft"), String(Engine.remainingArrows(st)), w, "text");
    kv("stat-taps", T("taps"), String(st.stats.taps), w, "text");
    kv("stat-rot", T("rotations"), String(st.stats.rotations), w, "text");
    if (st.limits.moves != null) kv("stat-moves", T("movesLeft"), String(Math.max(0, st.limits.moves - st.stats.taps)), w, "text");
    const tl = timeLeftMs();
    if (tl != null) kv("stat-time", T("timeLeft"), formatMs(tl), w, "text");
  }, { width: w, spacing: 0 });
  ui.style("rail-sub").label(T("scoreSoFar"));
  const sc = s.score(), c = sc.components;
  ui.column("score-preview", () => {
    const rows: [string, number][] = [[T("rowReleased"), c.release], [T("rowCompletion"), c.completion], [T("rowTapEff"), c.tapEfficiency],
      [T("rowRotEff"), c.rotationEfficiency], [T("rowTime"), c.timeBonus], [T("rowInvalid"), -c.invalidPenalty]];
    rows.forEach(([k, v], i) => kv(`sp-${i}`, k, String(v), w, "small-ink", false));
    ui.row("sp-total", () => { ui.style("small-b").label(T("total")); ui.spacer(); ui.style("small-b").label(String(sc.total)); }, { width: w, style: "row-total" });
  }, { width: w, spacing: 1 });
  para(T("parLine", { taps: level.par.taps, rotations: level.par.rotations, time: formatMs(level.par.timeMs) }), w, "small", "par-text");
  para(levelTip(level), w, "small", "tip-text");
}
function actionsRail(w: number): void {
  const playing = app.phase === "active";
  ui.style("rail-h").label(T("actions").toUpperCase());
  const acts: Btn[] = [
    { id: "btn-undo", text: T("undo"), act: doUndo, disabled: !canUndo() || !playing },
    { id: "btn-hint", text: T("hint"), act: doHint, disabled: !canHint() || !playing },
    { id: "btn-rot-left", text: T("rotLeftBtn"), name: T("rotateLeft"), act: () => doRotate(1) },
    { id: "btn-rot-right", text: T("rotRightBtn"), name: T("rotateRight"), act: () => doRotate(-1) },
    { id: "btn-cam-reset", text: T("resetCamera"), act: resetCamera },
    { id: "btn-board-list", text: T("boardList"), act: openBoardList },
  ];
  for (const a of acts) button({ ...a, width: w });
  ui.style("rail-sub").label(T("selection"));
  para(selectionText(), w, "small", "selection-info");
}
function describe(c: { id: string; kind: string; pos: number[]; dir: number }): string {
  return T("describe_" + c.kind, { id: c.id, x: c.pos[0]!, y: c.pos[1]!, z: c.pos[2]!, dir: dirName(c.dir) });
}

// ------------------------------------------------------------------ dialogs
function modal(L: Layout, m: NonNullable<typeof app.modal>): void {
  const wide = m === "settings" || m === "board";
  const w = Math.min(L.lw - 32, wide ? 620 : L.short ? 520 : 380);
  const iw = w - 48;
  const maxH = L.lh - 48;
  const key = `modal-${m}`;
  const prev = lastSize.get(key);
  const scroll = m !== "pause" && !!prev && prev.height / L.sc + 60 > maxH;
  const opening = frame().frame - app.openedFrame <= 6;
  ui.style("modal").dialog(key, "", true, () => {
    const body = (): void => { lastSize.set(key, ui.column(`${key}-in`, () => buildModal(m, iw - (scroll ? 16 : 0)), { spacing: 10, width: iw - (scroll ? 16 : 0) })); };
    ui.column(`${key}-card`, () => {
      if (scroll) ui.scrollArea(`${key}-scroll`, { width: iw + 4, height: maxH - 120 }, body, opening ? { scrollTo: { top: 0 } } : undefined);
      else body();
      modalFooter(m, iw);
    }, { width: w, spacing: 12, padding: 0 });
  });
  if (ui.back() && fresh() && frame().frame - app.openedFrame > 1) later(() => { if (m === "pause") resumeGame(); else closeModal(); });
}
function buildModal(m: NonNullable<typeof app.modal>, w: number): void {
  if (m === "pause") {
    ui.style("h2").heading(T("paused"));
    const list: Btn[] = [
      { id: "btn-resume", text: T("resume"), style: "btn-primary", act: resumeGame },
      { id: "btn-pause-settings", text: T("settings"), act: openSettings },
      { id: "btn-pause-help", text: T("help"), act: openHelp },
      { id: "btn-restart-round", text: T("restartRound"), act: restartRound },
      { id: "btn-leave-round", text: T("leaveRound"), style: "btn-danger", act: leaveRound },
    ];
    // two columns when the window is short (all five stay in view, outside any scroll area)
    if (w >= 300 && layoutNow().short) flow("pause-actions", list.map((b) => ({ ...b, width: (w - 10) / 2 })), w, 10);
    else for (const b of list) button({ ...b, width: w });
    return;
  }
  if (m === "settings") { settingsBody(w); return; }
  if (m === "profile") {
    ui.style("h2").heading(T("profile"));
    const signed = platform.signedIn();
    para(signed ? T("profileHosted", { name: playerName(platform.displayName()) }) : T("profileGuest"), w, "small");
    para(signed ? T("accountNickname") : T("displayName"), w, "text");
    if (signed) para(platform.displayName() ?? "", w, "text-b", "profile-name");
    else {
      const cur = platform.doc.profile.name === "Guest" ? T("guest") : platform.doc.profile.name;
      nameDraft = nameDraft ?? cur;
      nameDraft = ui.style({ width: w }).id("profile-name").textField("profile-name", nameDraft, { maxChars: 24 });
      if (ui.submitted(T("displayName")) || ui.submitted("profile-name")) later(() => { setName(nameDraft ?? ""); });
    }
    const p = progression();
    para(T("profileStats", { stars: totalStars(), stages: Object.keys(p.journeyStars).length, released: p.totals.released, streak: dailyStreak() }), w, "dim", "profile-stats");
    return;
  }
  if (m === "board") {
    ui.style("h2").heading(T("boardList"));
    para(T("boardListText"), w, "small");
    const st = app.session?.state;
    if (!st) return;
    const legal = new Set(Engine.legalActions(st).map((a) => a.cubeId));
    const arrows = st.cubes.filter((c) => c.kind === "arrow"), others = st.cubes.filter((c) => c.kind !== "arrow");
    const item = (c: (typeof st.cubes)[number]): void => {
      const clear = legal.has(c.id), locked = !!c.lock && !c.lock.open;
      const status = c.kind === "stone" ? T("stImmovable") : c.kind === "core" ? T("stExpose") : clear ? T("stClear") : locked ? T("stLocked", { key: c.lock!.keyId }) : T("stBlocked");
      const name = describe(c);
      const label = clear ? T("mirrorClearAria", { cube: name, status }) : `${name} — ${status}`;
      const tagCls = c.kind !== "arrow" ? "tag" : clear ? "tag-clear" : "tag-blocked";
      if (ui.style("btn-mirror", { width: w }).id(`mirror-${c.id}`).button(label, {
        ...(clear ? {} : { disabled: true }),
        content: () => { ui.row(`mi-${c.id}`, () => { para(name, w - 150, "small-ink"); ui.spacer(); ui.style(tagCls).label(status); }, { width: w - 26 }); },
      }) && clear && fresh()) later(() => { app.modal = null; attemptRelease(c.id); });
    };
    ui.column("board-list", () => { for (const c of arrows) item(c); for (const c of others) item(c); }, { spacing: 5, width: w });
  }
}
let nameDraft: string | null = null;
function modalFooter(m: NonNullable<typeof app.modal>, w: number): void {
  if (m === "pause") return;
  const text = m === "board" ? T("close") : T("done");
  flow(`${m}-footer`, [{ id: `btn-${m}-close`, text, style: "btn-primary", act: () => { if (m === "profile") nameDraft = null; closeModal(); } }], w);
}
const PALETTES = ["default", "cvd-safe", "mono-safe"];
function settingsBody(w: number): void {
  ui.style("h2").heading(T("settings"));
  const s = settings();
  ui.style("rail-h").label(T("gameOptions").toUpperCase());
  toggleRow("opt-captions", T("captions"), !!s.captions, w, (v) => setOption({ captions: v }));
  selectRow("opt-palette", T("colorPalette"), Math.max(0, PALETTES.indexOf(s.palette)), [T("palDefault"), T("palCvd"), T("palMono")], w, (i) => setOption({ palette: PALETTES[i]! }));
  toggleRow("opt-left", T("leftHanded"), !!s.leftHanded, w, (v) => setOption({ leftHanded: v }));
  toggleRow("opt-drag", T("dragToggle"), !!s.dragToggle, w, (v) => setOption({ dragToggle: v }));
  toggleRow("opt-timing", T("timingAssist"), !!s.timingAssist, w, (v) => setOption({ timingAssist: v }));
  para(T("themeRow"), w, "text");
  const stars = totalStars();
  ui.row("swatches", () => {
    for (const th of THEMES) {
      const unlocked = stars >= th.unlockStars;
      const name = tn("themes", th.id, th.name);
      const label = unlocked ? name : T("themeLocked", { name, n: th.unlockStars });
      const r = ui.style("swatch", { width: 56, height: 56 }).id(`theme-${th.id}`).widget(label, {
        role: "radio", checked: progression().theme === th.id, size: { width: 56, height: 56 },
        draw: (rc, st) => {
          draw.box(rc.x, rc.y, rc.width, rc.height, { background: { type: "linear", stops: [hex(th.sky.top), hex(th.sky.horizon)] }, radius: 10,
            border: { width: 2, color: progression().theme === th.id ? token("accent") : token("panel-border") } } as ui.Style);
          if (!unlocked) draw.rect(rc.x, rc.y, rc.width, rc.height, "#ffffff99");
          const sz = 9 * st.scale;
          draw.rect(rc.x + 2 * st.scale, rc.y + rc.height - sz * 1.6, rc.width - 4 * st.scale, sz * 1.5, "#ffffffcc");
          draw.text(unlocked ? name : `${th.unlockStars}★`, rc.x + rc.width / 2, rc.y + rc.height - sz * 1.5, { size: sz, color: "#1c2733", align: "center", maxWidth: rc.width - 4 });
        },
      });
      if (r.activated && unlocked && fresh()) later(() => setTheme(th.id));
    }
  }, { spacing: 8, width: w });
  flow("replay", [{ id: "btn-replay-lessons", text: T("replayLessons"), act: () => { app.modal = null; app.modalReturn = null; if (app.phase === "paused") leaveRoundQuiet(); openSetup("learn"); } }], w, 8, "start");
  ui.style("rail-h").label(T("runtimeOptions").toUpperCase());
  para(T("runtimeOptionsNote"), w, "small");
  flow("runtime", [{ id: "btn-runtime-options", text: T("runtimeOptions"), act: () => { try { openMenu(); } catch { /* host */ } } }], w, 8, "start");
}
function leaveRoundQuiet(): void { app.session = null; app.phase = "menu"; render.clearBoard(); }

// ------------------------------------------------------------------ toasts and the preparing line
function toasts(L: Layout, inPlay: boolean): void {
  if (!app.toasts.length) return;
  const w = Math.min(L.lw - 32, 520);
  ui.place("toasts", { anchor: "top", y: inPlay ? TOP_H + 58 : TOP_H + 12 }, () => {
    ui.column("toasts-col", () => {
      app.toasts.forEach((t, i) => {
        const tw = Math.min(w, textWidth(t.text, "toast-text") + 36);
        ui.column(`toast-${i}`, () => para(t.text, tw - 32, "toast-text", `toast-text-${i}`), { style: "toast", width: tw, align: "center" });
      });
    }, { spacing: 6, align: "center", width: w });
  });
}
function overlayLine(L: Layout, text: string, show: boolean): void {
  if (!show) return;
  const w = Math.min(L.lw - 32, textWidth(text, "toast-text") + 40);
  ui.place("preparing", "center", () => { ui.column("preparing-col", () => para(text, w - 32, "toast-text", "preparing-text"), { style: "toast", width: w, align: "center" }); });
}
