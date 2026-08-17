// Fixed-view captures for visual validation: boots the real server, drives
// the client through title, gameplay (small and large boards, rotated),
// results, and a portrait-mobile pass, saving PNGs to tests/artifacts/.
// Requires playwright-core + a Chrome executable (same setup as smoke.mjs).
//
// Run: npm run captures

import { mkdir } from 'node:fs/promises';
import { startServer } from '../server.js';

await mkdir(new URL('./artifacts/', import.meta.url), { recursive: true });
const { chromium } = await import('playwright-core');
const server = await startServer(0);
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(base + '/', { waitUntil: 'networkidle' });
await page.waitForSelector('#screen-title:not([hidden])');
await page.click('#btn-play');
await page.waitForSelector('#screen-game:not([hidden])');
await new Promise(r => setTimeout(r, 2600));
await page.screenshot({ path: 'tests/artifacts/10-game-j01-refit.png' });

// selection with path preview on a front-facing clear cube
await page.locator('#gl').focus();
await page.keyboard.press('Tab');
await new Promise(r => setTimeout(r, 600));
await page.screenshot({ path: 'tests/artifacts/11-selection-refit.png' });

// big board: jump to j33 via localStorage unlock then setup
await page.evaluate(async () => {
  const { loadDoc, saveDoc } = await import('./js/session/persistence.js');
  const { payload, rev } = loadDoc('progression', {});
  payload.journeyStars = {};
  for (let i = 1; i <= 32; i++) payload.journeyStars['j' + String(i).padStart(2, '0')] = 1;
  saveDoc('progression', payload, rev);
  location.reload();
});
await page.waitForSelector('#screen-title:not([hidden])');
await page.click('#btn-play'); // resumes nothing; goes to j33 (first uncleared)
await page.waitForSelector('#screen-game:not([hidden])');
await new Promise(r => setTimeout(r, 3000));
await page.screenshot({ path: 'tests/artifacts/12-game-j33.png' });
await page.keyboard.press('q');
await new Promise(r => setTimeout(r, 900));
await page.screenshot({ path: 'tests/artifacts/13-game-j33-rotated.png' });
await page.keyboard.press('Escape');
await page.waitForSelector('#modal-pause:not([hidden])');
await page.click('#btn-leave-round');
await page.waitForSelector('#screen-results:not([hidden])');
await page.screenshot({ path: 'tests/artifacts/15-results-fixed.png' });
await page.close();

// mobile portrait re-fit
const mob = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await mob.goto(base + '/', { waitUntil: 'networkidle' });
await mob.waitForSelector('#screen-title:not([hidden])');
await mob.tap('#btn-play');
await mob.waitForSelector('#screen-game:not([hidden])');
await new Promise(r => setTimeout(r, 2600));
await mob.screenshot({ path: 'tests/artifacts/14-mobile-refit.png' });
await mob.close();

await browser.close();
server.close();
console.log('shots saved');
process.exit(0);
await page.keyboard.press('Escape');
await page.waitForSelector('#modal-pause:not([hidden])');
await page.click('#btn-leave-round');
await page.waitForSelector('#screen-results:not([hidden])');
