# Vanishing Cubes

A three-dimensional direction puzzle. Rotate a floating cube assembly in a pale
sky and release blocks whose arrow path is clear. Expose the core.

## Run

- **Hosted / full experience:** `node server.js` (or `npm start`) then open
  `http://localhost:8080`. The Node server serves the static client and
  provides `/api/v1/time`, score submission with authoritative replay
  validation, leaderboards, activity/presence, and telemetry intake.
- **Offline:** open `index.html` through any static file server (ES modules
  require HTTP). All solo modes work offline; leaderboards fall back to local
  storage and are labeled *casual*.

## Modes

Learn (interactive lessons), Journey (40 authored stages in five chapters),
Daily (one shared seed per UTC day, ranked), Practice (selectable difficulty,
undo, unranked), Challenge (move limits and speed targets, ranked), and Score
chase (global and friends-filtered boards).

## Layout

- `index.html`, `css/`, `js/` — browser client (no build step; ES modules).
- `vendor/` — pinned Three.js 0.180.0.
- `server.js` — static server + authoritative API (time, scores, boards).
- `js/rules/` — pure deterministic rules engine (no DOM, no Three.js).
- `js/content/` — versioned levels, tutorials, challenges, themes, achievements.
- `tests/run-tests.js` — unit / property / fuzz / golden / server-API tests
  (`npm test`).
- `tests/smoke.mjs` — headless-browser smoke test (`npm run smoke`; requires
  `playwright-core` and a Chrome executable, `CHROME_PATH` to override).
- `tests/captures.mjs` — fixed-view screenshot captures for visual validation
  (`npm run captures`, writes `tests/artifacts/`).

## Packaging

`starhermit.txt` declares `name=Vanishing Cubes`, `launch=index.html`,
`server=server.js`. Upload only the distribution files: this directory minus
`tests/`, `data/`, `node_modules/`, `spec.md`, and any source maps or secrets.
