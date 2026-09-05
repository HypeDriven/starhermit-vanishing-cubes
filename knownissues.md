# Known Issues — Vanishing Cubes

QA pass 2026-08-20. Static review driven by Qwen3.8 27B on vision182 (HauhauCS Q2_K_P, 8192-token
context), alongside the game's own unit tests and headless-browser smoke suite. Every defect below
was reproduced with a script against the real modules — none is a model claim taken on trust.

A follow-up verification pass (see "Resolved" below) confirmed against the current source that all
previously-identified defects have been addressed; fixes are committed. No known defect remains
open.

## Test results

| Check | Result |
| --- | --- |
| `npm test` (`tests/run-tests.js`) | 76 passed, 0 failed |
| `node --check` on all modules (`js/**/*.js`, `server.js`, `tests/*`) | clean, no failures |
| `tests/e2e.mjs` | not present |
| `npm run smoke` (`tests/smoke.mjs`, headless Chrome) | PASS — 40 passed, 0 failed, no uncaught page errors, no console errors |

`tests/smoke.mjs` starts its own server on an ephemeral port, so no fixed port was needed. The
manual API probes below used port 39701 from the assigned range.

## Resolved defects

### 1. Ranked leaderboard tie-break fields are taken from the client and never checked against the validated replay

**RESOLVED 2026-08-26.** `verifySubmission` (server.js:238-239) now cross-checks `invalid` and
`elapsedMs` against `verdict.result` (rejecting with `invalid-mismatch` / `elapsed-mismatch`), and
the stored record (server.js:355-366) takes `invalid`, `elapsedMs`, and `durationMs` from the
validated replay instead of the client claim. Verified with a scripted liar submission → 400.

- **File:** `server.js:238-239` (`verifySubmission`) and `server.js:355-366` (record construction)
- **Trigger:** Submit a genuine, replay-validated run to a ranked board (`level-j07`) but set the
  top-level `invalid` and `elapsedMs` fields to `0`.
- **Behaviour before fix:** `verifySubmission` only cross-checked two fields against the replay
  result; `verdict.result.invalid` / `verdict.result.elapsedMs` were computed but discarded, and the
  stored record used the client's claims. `compareResults` (`js/rules/scoring.js:53`) broke ties on
  `invalid` then `elapsedMs`, so a liar won every tie while still being `validated: true`.
- **Expected:** spec.md §5 — "Treat client clocks, scores, inventories, roles, physics outcomes, and
  completion claims as untrusted in competitive contexts." Every ranked field that affects ordering
  must come from `verdict.result`.
- **Resolution:** cross-check the two ordering fields against the validated replay and store them
  from `verdict.result`.

### 2. Replay validation trusts client command timestamps, so the time bonus is forgeable on a ranked board

**RESOLVED 2026-08-26.** `verifySubmission` (server.js:243-244) now enforces a minimal human
cadence: the validated replay's `elapsedMs` must cover `(released + invalid) * MIN_MS_PER_TAP`
(120 ms), else the submission is rejected as `implausibly-fast`. The documented all-`at=0` forgery
now fails this check; verified with a scripted forged envelope → 400, while honest runs (≥137 ms/tap
in tests) still validate.

- **File:** `server.js:243-244` (`verifySubmission`); cadence guard in `js/rules/replay.js`
- **Trigger:** Play a level honestly, then rewrite every command's `at` field to `0` before
  submitting. All timestamps stay non-decreasing, so the `clock-order` guard passes.
- **Behaviour before fix:** `state.elapsedMs` was derived purely from `cmd.at` and `computeScore`
  paid `Math.floor((par.timeMs - elapsedMs) / 1000) * 5` for it. `verifyEnvelope` had no wall-clock
  cross-check, so the forged envelope verified as authoritative and scored strictly higher.
- **Expected:** spec.md §5 as quoted above; the file header of `server.js` claims "Score claims on
  ranked boards are validated authoritatively".
- **Resolution:** require the claimed elapsed time to cover a minimal human per-tap cadence.

### 3. After undo + a further move, resuming from a snapshot silently swallows the player's next release

**RESOLVED 2026-08-26.** `GameSession.restore` (js/session/session.js:204-209) no longer rebuilds
the counter as `cmdSeq = log.length`; it resumes above the highest sequence number present in the
restored log (`max(seq) + 1`, still at least `log.length`), so post-restore command IDs can never
collide with IDs still in `seenIds` — covering both the undo-truncation drift and the
failed-dispatch gap. Verified with the scripted repro: the release after restore now applies
(`ok=true duplicate=false`).

- **File:** `js/session/session.js:79-81` (`dispatch`), `js/session/session.js:107-115` (`undo`),
  `js/session/session.js:204-209` (`GameSession.restore`)
- **Trigger:** In any mode where undo is allowed (Practice / Learn — `allowUndo && !ranked`):
  release a cube, release another, release a third, press **undo**, release once more, then let the
  page background or reload so `resumeSnapshot()` runs. The next cube tap does nothing.
- **Behaviour before fix:** Command IDs are `sessionId + '-' + cmdSeq`. `undo()` truncated the log
  but never rewound `cmdSeq`, so post-undo commands were written with IDs numerically *above*
  `log.length`. `restore()` rebuilt the counter as `cmdSeq = log.length`, which collided with an ID
  already in `seenIds`; `dispatch` treated the collision as an idempotent duplicate and dropped the
  command while returning `{ ok: true, duplicate: true }`.
- **Expected:** A restored session must continue issuing fresh command IDs; a legal release after a
  resume must apply. spec.md §3 "One-input confidence: every press, tap, drag, key, or pointer
  action gives immediate visual and sonic acknowledgment."
- **Resolution:** resume `cmdSeq` above the highest sequence number present in the restored log.

### 4. `saveDoc` can throw on a full quota (suspected — confirmed and resolved)

**RESOLVED 2026-08-26.** `rawSet` (js/session/persistence.js:58-67) now wraps the write in
try/catch and degrades to a console warning, matching the "storage full — non-fatal" policy already
used by the snapshot writer in `js/main.js`.

- **File:** `js/session/persistence.js:58-67` (`rawSet`)
- **Concern:** `rawSet` originally called `localStorage.setItem` without a try/catch, so a full
  storage quota could crash a progression/profile/settings save.
- **Resolution:** wrap in try/catch and degrade to a warning (non-fatal).

## Suspected — not confirmed

### 1. `resolveConflict` treats a higher revision number as a strict descendant

- **File:** `js/session/persistence.js:110-119`
- **Concern:** spec.md §6 asks to "Resolve conflicts by preserving both snapshots and asking the
  player when neither is a strict descendant." The implementation resolves silently whenever
  `remoteDoc.rev !== localDoc.rev`, and only treats *equal* revisions with differing payloads as a
  conflict. Two devices that each save independently from a common ancestor will reach different
  revision counts, and the higher counter overwrites the other with no prompt.
- **Why unconfirmed:** revisions are plain counters with no lineage information, so there is no way
  to prove from the source alone that divergence with unequal counters actually occurs in the
  shipped cloud-save flow; that depends on host behaviour not present in this distribution.
- **Decision 2026-08-26:** left as-is. Without lineage data there is no safe minimal fix — treating
  every unequal-revision pair as a conflict would prompt the player on routine single-device saves.

### 2. Score-submission handler sorts the live store array in place on the duplicate path

- **File:** `server.js:337-342`
- **Concern:** `boardEntries(entry.board).sort(compareResults)` returns `store.boards[board]`
  directly (not a copy), so the idempotent-resubmit path mutates the stored ordering as a side
  effect of a read (note: the leaderboard GET at `server.js:318` already copies via `.slice()`).
- **Why unconfirmed:** the array is re-sorted on every write anyway, so no incorrect output was
  observed; flagged as latent rather than proven.
- **Decision 2026-08-26:** left as-is. The in-place sort only reorders an array that is re-sorted by
  `compareResults` on every subsequent write, so no observable behaviour changes; copying on a read
  path would be churn without a defect.

## Checked, no defects found

- **Rules engine core** (`js/rules/engine.js`): `applyCommand` purity (input state never mutated),
  monotonic `tick`, terminal ordering (completion is evaluated before the move limit, so clearing
  the board on the final permitted tap correctly yields `cleared` rather than `moves-exhausted`),
  lock/key unlocking, `explainRelease` invalid reasons, and `legalActions` agreement with
  `explainRelease`.
- **Ray casting bounds** (`js/rules/engine.js:97-117`): `MAX_RAY_STEPS = 64` was checked against the
  content limits — `validateLevel` rejects any cube outside `|8|` on each axis
  (`js/rules/generator.js:289-291`), giving a maximum span of 17 cells, so the step cap can never
  truncate a ray and report a blocked path as clear. `state.bounds` is deliberately frozen at
  creation; because released cubes leave the occupancy map, the stale (larger) bounds cannot change
  a hit/miss result.
- **`solveGreedy`** (`js/rules/engine.js:297`): the monotonicity claim in its comment holds —
  removals only unblock and locks only open — so greedy really does solve every solvable board.
- **Content generation** (`js/rules/generator.js`, `js/content/levels.js`,
  `js/content/challenges.js`): `validateLevel` proves solvability, uniqueness of ids/positions, and
  key integrity for every level; the shipped 40 journey stages plus challenges all generate.
- **Serialization/migration** (`engine.js:319-352`): canonical (key-sorted) JSON hashing, v1
  round-trip, and rejection of future versions.
- **Server input validation** (`server.js:161-183`, `readBody`, rate limiting): body size cap,
  board-id regex, name truncation, integer/range checks, token-bucket rate limiting, and idempotent
  resubmission by `sessionId` all behave as documented. Malformed JSON and oversize bodies are
  rejected without crashing the process.
- **Content binding** (`server.js:200-207`): submitted levels are hash-compared against a
  server-side regeneration, so fabricated boards with inflated par values are rejected — the
  `content-mismatch` path works.
- **Static file serving:** `spec.md` is not served (verified by `tests/smoke.mjs`).
- **Client runtime:** the headless smoke suite exercised title → journey → full round → results,
  daily, learn/tutorial, concede, pause/resume, keyboard-only release, the accessible board mirror,
  leaderboard submission and friends filtering, and portrait-mobile layout with 44 px touch targets —
  all 40 checks pass with zero console errors and zero uncaught page errors.

## Not tested

- **Gamepad input** — no gamepad available in headless Chrome.
- **WebGL context-loss recovery** — requires driver-level context loss that the software renderer in
  this environment does not reproduce.
- **Real hosted StarHermit integration** (launch tokens, account sign-in, presence, cloud save
  conflict prompts) — only the bundled local `/api/v1` surface exists here.
- **Performance budgets** (draw calls, triangle counts, 10-minute stability, mobile frame tiers) —
  the machine has no GPU-backed browser; all rendering ran under SwiftShader software rasterization,
  so timing numbers would be meaningless.
- **Screen-reader behaviour** — the DOM live regions and board mirror were verified structurally,
  but no assistive technology was driven.
