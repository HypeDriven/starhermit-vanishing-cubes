// Headless-browser smoke test for the full client + server stack.
// Requires playwright-core (devDependency) and a Chrome/Chromium executable
// (CHROME_PATH env var, or /usr/bin/google-chrome by default).
//
// Run: npm run smoke

import { setTimeout as delay } from 'node:timers/promises';
import { startServer } from '../server.js';

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
  check('hosted status detected (' + net.trim() + ')', /online/.test(net));

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

  // Ranked submission landed on a validated board (journey level board).
  const boardRes = await (await fetch(base + '/api/v1/leaderboard?board=level-j01')).json();
  check('journey leaderboard accepted a validated entry', boardRes.entries?.length >= 1 && boardRes.entries[0].casual === false);

  // Back to modes; all six mode cards present.
  await page.click('#btn-results-exit');
  await page.waitForSelector('#screen-modes:not([hidden])');
  check('mode cards rendered (' + (await page.locator('#mode-cards .card').count()) + ')',
    (await page.locator('#mode-cards .card').count()) === 6);

  // Daily: setup shows rules facts, then a full ranked round end to end.
  await page.click('#mode-cards .card:has-text("Daily")');
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
  await page.click('#mode-cards .card:has-text("Score chase")');
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
  await page.click('#mode-cards .card:has-text("Learn")');
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

console.log(`\nsmoke: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
