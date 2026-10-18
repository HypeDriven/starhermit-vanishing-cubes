// Headless-browser end-to-end test for the full client + server stack
// (formerly tests/smoke.mjs; `npm run smoke` still runs it).
// Requires playwright-core (devDependency) and a Chrome/Chromium executable
// (CHROME_PATH env var, or /usr/bin/google-chrome by default).
//
// Run: npm run test:e2e

import { setTimeout as delay } from 'node:timers/promises';
import { startServer } from './test-server.mjs';
import { launchToken, stubStarHermit } from './starhermit-e2e.mjs';

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.log('smoke: playwright-core not installed — skipping (npm i -D playwright-core to enable)');
  process.exit(0);
}

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) {
    passed++;
    console.log('  ✓ ' + name);
  } else {
    failed++;
    console.error('  ✗ ' + name);
  }
}

async function waitActive(page) {
  await page.waitForFunction(() => window.__vc && window.__vc.app.state === 'active', { timeout: 15000 });
}

// Releases every remaining cube through the accessible DOM board mirror.
async function clearBoardViaMirror(page) {
  for (let i = 0; i < 300; i++) {
    const left = Number(await page.locator('#stat-left').textContent());
    if (left === 0) return;
    await page.click('#btn-board-list');
    const btns = page.locator('#board-list button:not([disabled])');
    if ((await btns.count()) > 0) await btns.first().click();
    await page.click('#btn-board-close');
    await delay(50);
  }
  throw new Error('board did not clear via mirror');
}

const server = await startServer(0);
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
console.log(`smoke: server on ${base}`);

let browser;
try {
  browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
  });
} catch (err) {
  console.error('smoke: could not launch Chrome at', CHROME, '-', err.message);
  process.exit(2);
}

const pageErrors = [];
const consoleErrors = [];

try {
  // --- API sanity --------------------------------------------------------
  const time = await (await fetch(base + '/api/v1/time')).json();
  check('GET /api/v1/time returns unixMs', Number.isFinite(time.unixMs));
  const badSubmit = await (await fetch(base + '/api/v1/scores', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ board: 'daily-2026-01-01', score: -5 }),
  })).json();
  check('malformed score submission rejected with structured error', !!badSubmit.error);
  const forbidden = await fetch(base + '/spec.md');
  check('spec.md is not served', forbidden.status === 403 || forbidden.status === 404);

  // --- desktop pass ------------------------------------------------------
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#screen-title:not([hidden])', { timeout: 10000 });
  check('title screen shown', true);
  check('Play is dominant', await page.locator('#btn-play').isVisible());

  const net = await page.locator('#net-status').textContent();
  check('status reported (' + net.trim() + ')', /local play|online/.test(net));

  // Help screen renders rule cards from live bindings.
  await page.click('#btn-help');
  await page.waitForSelector('#screen-help:not([hidden])');
  const ruleCards = await page.locator('.rule-card').count();
  check('help rule cards rendered (' + ruleCards + ')', ruleCards >= 4);
  await page.click('#screen-help [data-nav="title"]');

  // Mode select lists all six modes.
  await page.click('#btn-play'); // goes straight into journey (short path to play)
  await page.waitForSelector('#screen-game:not([hidden])', { timeout: 10000 });
  check('one action reaches the playfield', true);
  await page.waitForFunction(
    () => document.getElementById('stat-left').textContent !== '–'
      && Number(document.getElementById('stat-left').textContent) > 0,
    { timeout: 10000 },
  );
  const cubesTotal = Number(await page.locator('#stat-left').textContent());
  check('HUD reports cubes to release (' + cubesTotal + ')', cubesTotal > 0);
  const canvasBox = await page.locator('#gl').boundingBox();
  check('WebGL canvas is sized', !!canvasBox && canvasBox.width > 200 && canvasBox.height > 200);

  // Accessible board list releases a cube through the DOM mirror.
  await page.click('#btn-board-list');
  await page.waitForSelector('#modal-board:not([hidden])');
  const clearButtons = page.locator('#board-list button:not([disabled])');
  const clearCount = await clearButtons.count();
  check('board list shows clear cubes (' + clearCount + ')', clearCount > 0);
  await clearButtons.first().click();
  await delay(150);
  const leftAfterOne = Number(await page.locator('#stat-left').textContent());
  check('release via board list decrements count', leftAfterOne === cubesTotal - 1);
  await page.click('#btn-board-close');

  // Keyboard play: Tab selects a legal target, Enter releases it.
  await page.locator('#gl').focus();
  await page.keyboard.press('Tab');
  await delay(100);
  await page.keyboard.press('Enter');
  await delay(150);
  const leftAfterTwo = Number(await page.locator('#stat-left').textContent());
  check('keyboard Tab+Enter releases a cube', leftAfterTwo === cubesTotal - 2);

  // Pause / resume restores focus and state.
  await page.keyboard.press('p');
  await page.waitForSelector('#modal-pause:not([hidden])');
  check('pause modal opens', true);
  await page.click('#btn-resume');
  await delay(100);
  check('resume closes modal', await page.locator('#modal-pause').isHidden());

  // Finish the board through the board mirror → results with breakdown.
  await clearBoardViaMirror(page);
  await page.waitForSelector('#screen-results:not([hidden])', { timeout: 15000 });
  check('results screen reached after clearing the board', true);
  const rows = await page.locator('#results-table tbody tr').count();
  check('score breakdown has component rows (' + rows + ')', rows >= 6);
  const totalText = await page.locator('#results-table tr.total td:last-child').textContent();
  check('total score is a number (' + totalText + ')', /^\d+$/.test(totalText.trim()));
  const headline = await page.locator('#results-heading').textContent();
  check('outcome headline: ' + headline.trim(), /cleared/i.test(headline));

  // Progression persisted.
  const stars = await page.evaluate(() => {
    const raw = localStorage.getItem('vc.progression');
    if (!raw) return 0;
    const doc = JSON.parse(raw);
    return Object.keys(doc.payload.journeyStars || {}).length;
  });
  check('journey progression persisted to localStorage', stars >= 1);

  // Clients never submit scores to the server board; the personal record is
  // kept in the local boards document (cloud-mirrored when hosted).
  const boardsDoc = await page.evaluate(() => {
    const raw = localStorage.getItem('vc.boards');
    return raw ? JSON.parse(raw) : null;
  });
  check('journey personal record kept locally',
    !!boardsDoc?.payload?.entries?.['level-j01']?.length);

  // Back to modes; all six mode cards present.
  await page.click('#btn-results-exit');
  await page.waitForSelector('#screen-modes:not([hidden])');
  check('mode cards rendered (' + (await page.locator('#mode-cards .card').count()) + ')',
    (await page.locator('#mode-cards .card').count()) === 6);

  // Daily: setup shows rules facts, then a full ranked round end to end.
  await page.click('#mode-cards .card[data-mode="daily"]');
  await page.waitForSelector('#screen-setup:not([hidden])');
  check('daily setup shows ranked facts', /ranked/i.test(await page.locator('#setup-body').textContent()));
  await page.click('#setup-body .btn.primary');
  await page.waitForSelector('#screen-game:not([hidden])');
  await waitActive(page);
  const dailyTotal = Number(await page.locator('#stat-left').textContent());
  check('daily round starts (' + dailyTotal + ' cubes)', dailyTotal > 0);
  await clearBoardViaMirror(page);
  await page.waitForSelector('#screen-results:not([hidden])', { timeout: 15000 });
  check('daily round completes with results', true);
  await page.click('#btn-results-exit');
  await page.waitForSelector('#screen-modes:not([hidden])');

  // Scores screen: global boards render; the daily board has our entry;
  // the friends filter re-requests with names.
  await page.click('#mode-cards .card[data-mode="score-chase"]');
  await page.waitForSelector('#screen-scores:not([hidden])');
  await page.waitForFunction(
    () => {
      const tables = document.querySelectorAll('#scores-body .board-table');
      if (tables.length < 9) return false;
      return ![...document.querySelectorAll('#scores-body .board-table tbody')].some((t) =>
        t.textContent.includes('Loading'));
    },
    { timeout: 15000 },
  );
  check('scores screen renders all boards', (await page.locator('#scores-body .board-table').count()) >= 9);
  const dailyRows = await page.locator('#scores-body .board-table').first().textContent();
  check('daily board shows this run’s entry', /Guest/.test(dailyRows));
  await page.fill('.friends-form input', 'Guest');
  await page.click('.friends-form button[type="submit"]');
  await delay(500);
  check('friends filter applies', (await page.locator('.friends-form .muted').textContent()).includes('Guest'));
  check('friends board still shows the entry', /Guest/.test(await page.locator('#scores-body .board-table').first().textContent()));
  await page.click('#screen-scores [data-nav="title"]');
  await page.waitForSelector('#screen-title:not([hidden])');
  check('title exposes All modes entry point', await page.locator('#btn-modes').isVisible());
  await page.click('#btn-modes');
  await page.waitForSelector('#screen-modes:not([hidden])');

  // Learn lesson: banner instructs, required action advances the lesson.
  await page.click('#mode-cards .card[data-mode="learn"]');
  await page.waitForSelector('#screen-setup:not([hidden])');
  await page.locator('#setup-body .level-grid .card').first().click();
  await page.waitForSelector('#screen-game:not([hidden])');
  await page.waitForSelector('#tutorial-banner:not([hidden])', { timeout: 10000 });
  const tut1 = await page.locator('#tutorial-text').textContent();
  check('tutorial banner instructs (' + tut1.slice(0, 40) + '…)', tut1.length > 20);
  await page.click('#btn-board-list');
  await page.locator('#board-list button:not([disabled])').first().click();
  await page.click('#btn-board-close');
  await delay(400);
  const tut2 = await page.locator('#tutorial-text').textContent();
  check('lesson advances after the required action', tut2 !== tut1);
  await page.keyboard.press('Escape'); // pause
  await page.waitForSelector('#modal-pause:not([hidden])');
  await page.click('#btn-leave-round');
  await page.waitForSelector('#screen-results:not([hidden])', { timeout: 10000 });
  check('concede ends the round with results', true);

  await page.close();

  // --- portrait mobile pass ----------------------------------------------
  const mob = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  mob.on('pageerror', (err) => pageErrors.push('mobile: ' + err.message));
  await mob.goto(base + '/', { waitUntil: 'networkidle' });
  await mob.waitForSelector('#screen-title:not([hidden])', { timeout: 10000 });
  await mob.tap('#btn-play');
  await mob.waitForSelector('#screen-game:not([hidden])', { timeout: 10000 });
  check('mobile: playfield reachable', true);
  check('mobile: thumb tray visible', await mob.locator('#tray-bottom').isVisible());
  check('mobile: drawer buttons visible', await mob.locator('#btn-drawer-left').isVisible());
  await mob.tap('#btn-drawer-left');
  check('mobile: objective drawer opens', await mob.locator('#rail-left.open').count() === 1);
  const pauseBox = await mob.locator('#btn-pause').boundingBox();
  check('mobile: touch target ≥44px', !!pauseBox && pauseBox.width >= 44 && pauseBox.height >= 44);
  await mob.close();

  // --- graphics settings (desktop + mobile) ------------------------------
  const gfxConsole = [];
  const watch = (pg, tag) => {
    pg.on('pageerror', (err) => pageErrors.push(tag + ': ' + err.message));
    pg.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') gfxConsole.push(tag + ': ' + msg.text());
    });
  };
  const gfxPreset = (pg) => pg.evaluate(() => document.body.dataset.gfxPreset);

  const gd = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  watch(gd, 'gfx-desktop');
  await gd.goto(base + '/', { waitUntil: 'networkidle' });
  await gd.waitForSelector('#screen-title:not([hidden])');
  check('gfx: software GPU resolves Auto to Low', (await gfxPreset(gd)) === 'low');
  await gd.click('#btn-play');
  await gd.waitForSelector('#screen-game:not([hidden])');
  await waitActive(gd);
  await gd.keyboard.press('Escape');
  await gd.waitForSelector('#modal-pause:not([hidden])');
  await gd.click('#btn-pause-settings');
  await gd.waitForSelector('#modal-settings:not([hidden])');
  await gd.locator('#gfx-preset').scrollIntoViewIfNeeded();
  check('gfx: Graphics section visible in settings', await gd.locator('#gfx-section').isVisible());
  check('gfx: Auto option names the detected tier',
    /\(.*Low.*\)/.test(await gd.locator('#gfx-preset option[value="auto"]').textContent()));
  await gd.selectOption('#gfx-preset', 'low');
  check('gfx: Low applied', (await gfxPreset(gd)) === 'low');
  await gd.focus('#gfx-preset');
  await gd.selectOption('#gfx-preset', 'high');
  check('gfx: High applied', (await gfxPreset(gd)) === 'high');
  check('gfx: summary shows High cost', /2048² shadows/.test(await gd.locator('#gfx-summary').textContent()));
  check('gfx: summary shows the hardware level (SwiftShader = Level 0)', / · Level 0 · /.test(await gd.locator('#gfx-summary').textContent()));
  check('gfx: focus stays on the preset control', await gd.evaluate(() => document.activeElement?.id === 'gfx-preset'));
  await gd.selectOption('#gfx-bloom', 'off');
  check('gfx: bloom override applied', !/bloom/.test(await gd.locator('#gfx-summary').textContent()));
  await gd.selectOption('#gfx-preset', 'ultra');
  check('gfx: preset clears overrides', (await gd.locator('#gfx-bloom').inputValue()) === 'preset');
  await gd.waitForTimeout(400); // render a few Ultra frames
  await gd.selectOption('#gfx-preset', 'high');
  await gd.selectOption('#gfx-bloom', 'off');
  await gd.check('#gfx-show-fps');
  check('gfx: frame-rate readout shown', await gd.locator('#fps-meter').isVisible());
  await gd.click('#btn-settings-close');
  await gd.waitForTimeout(400); // render a few High frames
  await gd.reload({ waitUntil: 'networkidle' });
  await gd.waitForSelector('#screen-title:not([hidden])');
  check('gfx: preset survives reload', (await gfxPreset(gd)) === 'high');
  await gd.click('#btn-settings');
  await gd.waitForSelector('#modal-settings:not([hidden])');
  check('gfx: override survives reload', (await gd.locator('#gfx-bloom').inputValue()) === 'off');
  await gd.selectOption('#gfx-preset', 'auto');
  check('gfx: back to Auto', (await gfxPreset(gd)) === 'low');
  await gd.click('#btn-settings-close');
  await gd.close();

  const gm = await browser.newPage({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  watch(gm, 'gfx-mobile');
  await gm.goto(base + '/', { waitUntil: 'networkidle' });
  await gm.waitForSelector('#screen-title:not([hidden])');
  await gm.tap('#btn-play');
  await gm.waitForSelector('#screen-game:not([hidden])');
  await gm.tap('#btn-settings');
  await gm.waitForSelector('#modal-settings:not([hidden])');
  await gm.locator('#gfx-preset').scrollIntoViewIfNeeded();
  await gm.selectOption('#gfx-preset', 'high');
  check('gfx mobile: High applied', (await gfxPreset(gm)) === 'high');
  await gm.locator('#gfx-reflections').scrollIntoViewIfNeeded();
  await gm.selectOption('#gfx-reflections', 'off');
  check('gfx mobile: override applied', !/reflections/.test(await gm.locator('#gfx-summary').textContent()));
  const fits = await gm.evaluate(() => {
    const card = document.querySelector('#modal-settings .modal-card').getBoundingClientRect();
    const sel = document.getElementById('gfx-shadows').getBoundingClientRect();
    return card.left >= 0 && card.right <= innerWidth && card.bottom <= innerHeight
      && sel.left >= card.left && sel.right <= card.right
      && document.documentElement.scrollWidth <= innerWidth;
  });
  check('gfx mobile: panel fits the viewport', fits);
  await gm.locator('#btn-settings-close').scrollIntoViewIfNeeded();
  await gm.tap('#btn-settings-close');
  await gm.reload({ waitUntil: 'networkidle' });
  await gm.waitForSelector('#screen-title:not([hidden])');
  check('gfx mobile: preset survives reload', (await gfxPreset(gm)) === 'high');
  await gm.close();

  const realGfx = gfxConsole.filter((e) => !/GPU stall|GroupMarkerNotSet|swiftshader|Automatic fallback to software WebGL/i.test(e));
  check('gfx: no console errors or warnings (Low…Ultra)', realGfx.length === 0);
  if (realGfx.length) console.error(realGfx.join('\n'));

  // --- language + report (signed in, stubbed StarHermit API) -------------
  // Automatic follows the account's preferred language (fr-CA); choosing
  // Italian in Settings relabels in place and PUTs ui.language; Report a
  // problem posts to /reports; a German round shows German HUD text at 390 px
  // without overlaps; Automatic from the pause menu re-renders mid-round.
  for (const [tag, opts] of [
    ['desktop', { viewport: { width: 1280, height: 800 } }],
    ['mobile', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
  ]) {
    const ctx = await browser.newContext(opts);
    const lp = await ctx.newPage();
    const langErrors = [];
    lp.on('pageerror', (err) => pageErrors.push('lang-' + tag + ': ' + err.message));
    lp.on('console', (msg) => {
      if ((msg.type() === 'error' || msg.type() === 'warning') && !/GPU stall|GroupMarkerNotSet|swiftshader|Automatic fallback to software WebGL/i.test(msg.text())) langErrors.push(msg.text());
    });
    const calls = await stubStarHermit(lp, { preferredLanguage: 'fr-CA' });
    await lp.goto('about:blank');
    await lp.goto(base + '/index.html#game_token=' + launchToken(), { waitUntil: 'load' });
    await lp.waitForSelector('#screen-title:not([hidden])', { timeout: 15000 });
    await lp.waitForFunction(() => document.documentElement.lang === 'fr-CA', null, { timeout: 15000 });
    check(`lang ${tag}: Automatic follows the account language (fr-CA)`, (await lp.textContent('#btn-play')).trim() === 'Jouer');
    await lp.click('#btn-settings');
    await lp.waitForSelector('#modal-settings:not([hidden])');
    const choice = lp.locator('#modal-settings [data-game-language="choice"]');
    await choice.scrollIntoViewIfNeeded();
    check(`lang ${tag}: Automatic label resolved`, (await choice.locator('option').first().textContent()).trim() === 'Automatique — Français (Canada)');
    check(`lang ${tag}: one language selector`, (await lp.locator('[data-game-language="choice"]').count()) === 1);
    await choice.selectOption('it-IT');
    await lp.waitForFunction(() => document.documentElement.lang === 'it-IT');
    await lp.waitForFunction(() => /Salvato/.test(document.querySelector('[data-game-language="status"]').textContent));
    check(`lang ${tag}: ui.language saved`, calls.settings['ui.language']?.choice === 'it-IT');
    const rel = await lp.evaluate(() => ({
      h: document.getElementById('settings-heading').textContent,
      gfx: document.querySelector('#gfx-section h3').textContent,
      a11y: [...document.querySelectorAll('#settings-own h3')].map((h) => h.textContent).join('|'),
      stillMounted: !!document.querySelector('#settings-body > [data-game-options-fps]'),
    }));
    check(`lang ${tag}: Settings relabelled in place (${rel.h} / ${rel.gfx})`, rel.h === 'Impostazioni' && rel.gfx === 'Grafica' && /Accessibilità/.test(rel.a11y) && rel.stillMounted);
    await lp.locator('[data-game-report="title"]').scrollIntoViewIfNeeded();
    await lp.fill('[data-game-report="title"]', 'Test report');
    await lp.click('[data-game-report="send"]');
    await lp.waitForFunction(() => /Grazie/.test(document.querySelector('[data-game-report="status"]').textContent));
    check(`lang ${tag}: Report a problem posted to /reports`, calls.reports?.[0]?.kind === 'bug');
    await lp.screenshot({ path: `/tmp/vanishing-cubes-e2e-language-${tag}.png` });
    await choice.selectOption('de-DE');
    await lp.waitForFunction(() => document.documentElement.lang === 'de-DE');
    await lp.locator('#btn-settings-close').scrollIntoViewIfNeeded();
    await lp.click('#btn-settings-close');
    await lp.waitForFunction(() => document.getElementById('btn-play').textContent === 'Spielen');
    await lp.screenshot({ path: `/tmp/vanishing-cubes-e2e-german-title-${tag}.png` });
    await lp.click('#btn-play');
    await waitActive(lp);
    await lp.waitForFunction(() => /– noch \d+/.test(document.getElementById('hud-objective').textContent));
    const leftBefore = Number(await lp.locator('#stat-left').textContent());
    const layout = await lp.evaluate(() => {
      const vis = (e) => e && e.offsetParent !== null;
      const r = (e) => e.getBoundingClientRect();
      const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const chips = ['hud-objective', 'btn-pause', 'btn-drawer-left', 'btn-drawer-right'].map((id) => document.getElementById(id)).filter(vis);
      const tray = [...document.querySelectorAll('#tray-bottom .btn, #topbar .btn')].filter(vis);
      const cut = [...chips, ...tray].some((e) => r(e).right > innerWidth + 1 || r(e).left < -1 || e.scrollWidth > e.clientWidth + 1);
      let clash = false;
      for (let i = 0; i < chips.length; i++) for (let j = i + 1; j < chips.length; j++) if (overlap(r(chips[i]), r(chips[j]))) clash = true;
      return { cut, clash, scrollX: document.documentElement.scrollWidth > innerWidth };
    });
    check(`lang ${tag}: German HUD fits without overlaps ${JSON.stringify(layout)}`, !layout.cut && !layout.clash && !layout.scrollX);
    await lp.screenshot({ path: `/tmp/vanishing-cubes-e2e-german-play-${tag}.png` });
    await lp.click('#btn-pause');
    await lp.waitForSelector('#modal-pause:not([hidden])');
    check(`lang ${tag}: pause in German`, (await lp.textContent('#pause-heading')).trim() === 'Pausiert');
    await lp.click('#btn-pause-settings');
    await lp.waitForSelector('#modal-settings:not([hidden])');
    await choice.scrollIntoViewIfNeeded();
    await choice.selectOption('auto');
    await lp.waitForFunction(() => document.documentElement.lang === 'fr-CA');
    await lp.locator('#btn-settings-close').scrollIntoViewIfNeeded();
    await lp.click('#btn-settings-close');
    check(`lang ${tag}: pause re-rendered in French`, (await lp.textContent('#pause-heading')).trim() === 'En pause');
    await lp.click('#btn-resume');
    await lp.waitForFunction(() => /— encore \d+/.test(document.getElementById('hud-objective').textContent));
    check(`lang ${tag}: round kept going (${leftBefore} cubes left)`, Number(await lp.locator('#stat-left').textContent()) === leftBefore && (await lp.textContent('#objective-text')).startsWith('Libérez'));
    check(`lang ${tag}: no console errors or warnings`, langErrors.length === 0);
    if (langErrors.length) console.error(langErrors.join('\n'));
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}

const realPageErrors = pageErrors.filter((e) => !/WebGL|GroupMarkerNotSet|swiftshader/i.test(e));
check('no uncaught page errors', realPageErrors.length === 0);
if (realPageErrors.length) console.error(realPageErrors.join('\n'));
const realConsoleErrors = consoleErrors.filter((e) => !/WebGL|GPU|swiftshader|font/i.test(e));
check('no console errors', realConsoleErrors.length === 0);
if (realConsoleErrors.length) console.error(realConsoleErrors.join('\n'));

console.log(`\ne2e: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
