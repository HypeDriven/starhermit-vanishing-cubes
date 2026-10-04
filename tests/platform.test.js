// Platform adapter + canonical StarHermit SDK with a stubbed fetch and a fake
// launch fragment: token read, profile name, cloud save in game:<slug>,
// settings KV patch, control overrides — and zero fetches standalone.
// Run: node --test tests/platform.test.js (part of npm test)

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { platform } from '../js/platform/platform.js';
import { defaultCodes, matchKey, bindingLabel } from '../js/ui/bindings.js';

const SDK_SRC = fs.readFileSync(new URL('../starhermit-sdk.js', import.meta.url), 'utf8');
function loadSdk() {
  const m = { exports: {} };
  new Function('module', 'exports', SDK_SRC)(m, m.exports);
  return m.exports;
}
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const SLUG = 'cubes-test';
const USER = 'abcdef12-3456-7890-abcd-ef1234567890';
const JWT = 'x.' + b64url({ sub: USER, game_scope: SLUG, exp: Math.floor(Date.now() / 1000) + 3600 }) + '.y';
const noTimers = { setTimeout: () => 0, clearTimeout: () => {} };

function fakeWindow(hash) {
  return {
    location: { hash, search: '', pathname: '/', hostname: 'localhost', href: 'http://localhost/' + hash, origin: 'http://localhost' },
    history: { state: null, replaceState(_s, _t, url) { this.url = url; } },
  };
}
function stubServer() {
  const calls = [];
  const state = { save: null, settings: {}, controls: null };
  const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ url, method, auth: init.headers && init.headers.Authorization });
    if (url === '/api/v1/time') return json({ unixMs: Date.now() });
    if (url === `/api/v1/users/${USER}/profile`) return json({ nickname: 'Cube Cora' });
    if (url.startsWith('/api/v1/me/cloud-saves/')) {
      if (method === 'PUT') {
        state.save = Buffer.from(JSON.parse(init.body).dataBase64, 'base64');
        return new Response(null, { status: 204 });
      }
      return state.save ? new Response(state.save) : new Response(null, { status: 404 });
    }
    if (url === `/api/v1/games/${SLUG}/settings`) {
      if (method === 'PATCH') Object.assign(state.settings, JSON.parse(init.body).settings);
      return json({ settings: state.settings });
    }
    if (url === `/api/v1/games/${SLUG}/controls`) {
      if (method === 'PUT') { state.controls = JSON.parse(init.body).bindings; return json({ ok: true }); }
      return json({ actions: [{ action: 'hint', codes: ['KeyY'] }] });
    }
    return new Response(null, { status: 404 });
  };
  return { fetch, calls, state };
}

test('standalone: no token means no fetch at all', async () => {
  const srv = stubServer();
  const sh = loadSdk().create({ window: fakeWindow(''), fetch: srv.fetch });
  sh.init();
  platform.sh = sh;
  assert.equal(await platform.init(), false);
  assert.equal(platform.hosted, false);
  assert.equal(platform.canSignIn(), false);
  platform.scheduleCloudSave();
  await platform.flushCloudSave();
  platform.patchSettings({ audio: {} });
  assert.deepEqual(await platform.getSettings(), {});
  assert.equal(await platform.loadCloudSave(), null);
  assert.equal(await platform.globalBoard(), null);
  await platform.setControl('hint', ['KeyY']);
  await platform.activityStart('journey');
  platform.telemetry('start');
  assert.equal(srv.calls.length, 0);
});

test('hosted: token, profile, cloud save game:<slug>, settings, controls', async () => {
  const srv = stubServer();
  const win = fakeWindow('#game_token=' + JWT);
  const sh = loadSdk().create({ window: win, fetch: srv.fetch, ...noTimers });
  sh.init();
  assert.equal(sh.token, JWT);
  assert.equal(win.history.url, '/');
  platform.sh = sh;
  assert.equal(await platform.init(), true);
  assert.equal(platform.scope, SLUG);
  assert.equal(await platform.loadProfile(), 'Cube Cora');

  platform.scheduleCloudSave();
  await platform.flushCloudSave();
  const put = srv.calls.find((c) => c.method === 'PUT');
  assert.equal(put.url, '/api/v1/me/cloud-saves/' + encodeURIComponent('game:' + SLUG));
  const back = await platform.loadCloudSave();
  assert.ok(back.docs && 'settings' in back.docs);

  platform.patchSettings({ telemetryConsent: true });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(srv.state.settings, { telemetryConsent: true });
  assert.equal((await platform.getSettings()).telemetryConsent, true);

  const bound = await platform.loadBindings(defaultCodes());
  assert.deepEqual(bound.hint, ['KeyY']);
  assert.deepEqual(bound.undo, ['KeyU']);
  await platform.setControl('undo', ['KeyZ']);
  assert.deepEqual(srv.state.controls, { undo: ['KeyZ'] });
  assert.match(platform.inviteLink(), new RegExp(`/game-invite/${USER}/${SLUG}$`));
  assert.ok(srv.calls.every((c) => c.auth === 'Bearer ' + JWT));

  let seen = null;
  platform.onAuthChange = (v) => { seen = v; };
  sh.signOut('expired');
  assert.equal(seen, false);
  assert.equal(platform.hosted, false);
});

test('bindings route by event.code; legacy key overrides migrate', () => {
  assert.ok(matchKey({ code: 'KeyQ' }, 'rotateLeft'));
  assert.ok(matchKey({ code: 'Tab', shiftKey: true }, 'navPrev'));
  assert.ok(!matchKey({ code: 'Tab', shiftKey: true }, 'navNext'));
  assert.ok(matchKey({ code: 'KeyZ' }, 'undo', { undo: ['z'] }));
  assert.equal(bindingLabel('rotateLeft'), 'Q');
});
