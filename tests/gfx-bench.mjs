// Graphics benchmark hook for tools/gfx-bench.mjs (dev-only): picks a preset in Settings → Graphics,
// starts Hard practice (4×4×4 with stones, locks and a core) and keeps releasing cubes the way a
// keyboard player does (Tab selects a legal target, Enter releases it), turning the assembly now and
// then with the on-screen rotate button, so flyouts, release bursts, motes and the sky all animate.
// A cleared board is retried from the results screen.
export const presets = ['low', 'balanced', 'high', 'ultra'];
export const levels = { low: 0, balanced: 4, high: 10, ultra: 17 };

export async function setPreset(page, preset) {
  await page.waitForSelector('#screen-title:not([hidden])', { timeout: 20000 });
  await page.click('#btn-settings');
  await page.waitForSelector('#modal-settings:not([hidden])');
  await page.locator('#gfx-preset').scrollIntoViewIfNeeded();
  await page.selectOption('#gfx-preset', preset);
  await page.waitForFunction((p) => document.body.dataset.gfxPreset === p, preset);
  await page.click('#btn-settings-close');
  await page.waitForSelector('#modal-settings', { state: 'hidden' });
}

export async function start(page) {
  await page.click('#btn-modes');
  await page.waitForSelector('#screen-modes:not([hidden])');
  await page.click('#mode-cards .card[data-mode="practice"]');
  await page.waitForSelector('#screen-setup:not([hidden])');
  await page.locator('#setup-body .level-grid .card').nth(2).click();
  await page.waitForSelector('#screen-game:not([hidden])', { timeout: 15000 });
  await page.waitForFunction(() => window.__vc && window.__vc.app.state === 'active', null, { timeout: 15000 });
  let open = true, n = 0;
  page.once('close', () => { open = false; });
  (async () => {
    while (open) {
      try {
        if (await page.locator('#screen-results:not([hidden])').count()) {
          await page.click('#btn-retry', { timeout: 3000 });
          await page.waitForFunction(() => window.__vc && window.__vc.app.state === 'active', null, { timeout: 15000 });
        } else if (n % 6 === 5) {
          await page.click('#btn-rot-left', { timeout: 2000 });
        } else {
          await page.locator('#gl').focus();
          await page.keyboard.press('Tab');
          await page.keyboard.press('Enter');
        }
      } catch (e) { if (!open) return; if (process.env.BENCH_DEBUG) console.error('hook:', e.message.split('\n')[0]); }
      n++;
      await new Promise((r) => setTimeout(r, 450));
    }
  })();
  await page.waitForTimeout(1500);
}
