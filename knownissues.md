# Known Issues — Vanishing Cubes

QA pass 2026-08-20. Static review driven by Qwen3.8 27B on vision182 (HauhauCS Q2_K_P, 8192-token
context), alongside the game's own unit tests and headless-browser smoke suite. Every defect below
was reproduced with a script against the real modules — none is a model claim taken on trust.

## Test results

| Check | Result |
| --- | --- |
| `npm test` (`tests/run-tests.js`) | 76 passed, 0 failed |
| `node --check` on all modules (`js/**/*.js`, `server.js`, `tests/*`) | clean, no failures |
| `tests/e2e.mjs` | not present |
| `npm run smoke` (`tests/smoke.mjs`, headless Chrome) | PASS — 40 passed, 0 failed, no uncaught page errors, no console errors |

`tests/smoke.mjs` starts its own server on an ephemeral port, so no fixed port was needed. The
manual API probes below used port 39701 from the assigned range.

## Confirmed defects

### 1. Ranked leaderboard tie-break fields are taken from the client and never checked against the validated replay

**FIXED 2026-08-26.** `verifySubmission` (server.js:233-234) now cross-checks `invalid` and
`elapsedMs` against `verdict.result` (rejecting with `invalid-mismatch` / `elapsed-mismatch`), and
the stored record (server.js:348-360) takes `invalid`, `elapsedMs`, and `durationMs` from the
validated replay instead of the client claim. Verified with a scripted liar submission → 400.

- **File:** `server.js:233-234` (`verifySubmission`) and `server.js:340-357` (record construction)
- **Trigger:** Submit a genuine, replay-validated run to a ranked board (`level-j07`) but set the
  top-level `invalid` and `elapsedMs` fields to `0`.
- **Behaviour:** `verifySubmission` only cross-checks two fields against the replay result:

  ```js
  if (verdict.result.score !== entry.score) return bad('score-mismatch');
  if (verdict.result.completed !== entry.completed) return bad('completion-mismatch');
  ```

  `verdict.result.invalid` and `verdict.result.elapsedMs` are computed but discarded. The stored
  record then uses the *client's* `entry.invalid` / `entry.elapsedMs` (and `durationMs`). Since
  `compareResults` (`js/rules/scoring.js:53`) breaks ties on `invalid`, then `elapsedMs`, a liar
  wins every tie while still being flagged `validated: true` (not casual).
- **Expected:** spec.md §5 — "Treat client clocks, scores, inventories, roles, physics outcomes, and
  completion claims as untrusted in competitive contexts." Every ranked field that affects ordering
  should come from `verdict.result`.
- **Evidence:** two submissions carrying the *identical* replay envelope, one honest, one lying:

  ```
  TRUE replay: invalid = 2 elapsedMs = 29000 score = 4030
  honest 200 {"ok":true,"rank":1,"validated":true,"casual":false}
  liar   200 {"ok":true,"rank":1,"validated":true,"casual":false}
  BOARD: 1. liar   score 4030 invalid 0 elapsedMs 0     casual false
         2. honest score 4030 invalid 2 elapsedMs 29000 casual false
  ```

### 2. Replay validation trusts client command timestamps, so the time bonus is forgeable on a ranked board

**FIXED 2026-08-26.** `verifySubmission` (server.js) now enforces a minimal human cadence: the
validated replay's `elapsedMs` must cover `(released + invalid) * MIN_MS_PER_TAP` (120 ms), else the
submission is rejected as `implausibly-fast`. The documented all-`at=0` forgery now fails this
check; verified with a scripted forged envelope → 400, while honest runs (≥137 ms/tap in tests)
still validate.

- **File:** `js/rules/engine.js:241-242` (`applyCommand`), `js/rules/replay.js:49-67`
  (`verifyEnvelope`), `js/rules/scoring.js:27-29` (`computeScore`)
- **Trigger:** Play a level honestly, then rewrite every command's `at` field to `0` before
  submitting. All timestamps stay non-decreasing, so the `clock-order` guard passes.
- **Behaviour:** `state.elapsedMs` is derived purely from `cmd.at`
  (`if (at > st.elapsedMs) st.elapsedMs = at;`) and `computeScore` pays
  `Math.floor((par.timeMs - elapsedMs) / 1000) * 5` for it. `verifyEnvelope` has no wall-clock
  cross-check — it never compares `state.elapsedMs` with `env.startedAtUnixMs`, command count, or
  anything server-side. The forged envelope verifies as authoritative and scores strictly higher.
- **Expected:** spec.md §5 as quoted above; the file header of `server.js` claims "Score claims on
  ranked boards are validated authoritatively".
- **Evidence:** identical command sequence on `j07` (par `timeMs` 90450), only `cmd.at` differs:

  ```
  honest (4 s per tap) -> elapsedMs = 108000 | verifyEnvelope.ok = true | timeBonus =   0 | total = 3835
  forged (all at = 0)  -> elapsedMs =      0 | verifyEnvelope.ok = true | timeBonus = 450 | total = 4285
  ```

### 3. After undo + a further move, resuming from a snapshot silently swallows the player's next release

**FIXED 2026-08-26.** `GameSession.restore` (js/session/session.js:199) no longer rebuilds the
counter as `cmdSeq = log.length`; it resumes above the highest sequence number present in the
restored log (`max(seq) + 1`, still at least `log.length`), so post-restore command IDs can never
collide with IDs still in `seenIds` — covering both the undo-truncation drift and the
failed-dispatch gap. Verified with the scripted repro above: the release after restore now applies
(`ok=true duplicate=false`).

- **File:** `js/session/session.js:79-81` (`dispatch`), `js/session/session.js:107-115` (`undo`),
  `js/session/session.js:199` (`GameSession.restore`)
- **Trigger:** In any mode where undo is allowed (Practice / Learn — `allowUndo && !ranked`):
  release a cube, release another, release a third, press **undo**, release once more, then let the
  page background or reload so `resumeSnapshot()` runs (`js/main.js:1071-1073`). The next cube tap
  does nothing.
- **Behaviour:** Command IDs are `sessionId + '-' + cmdSeq`. `undo()` truncates `this.log`
  (`this.log.length = snap.logLength`) but never rewinds `cmdSeq`, so the post-undo commands are
  written into the log with IDs numerically *above* `log.length`. `restore()` then rebuilds the
  counter as `s.cmdSeq = data.log.length`, which now collides with an ID already present in
  `seenIds`. `dispatch` treats the collision as an idempotent duplicate and drops the command —
  while returning `{ ok: true, duplicate: true }`. `js/main.js:629` (`attemptRelease`) ignores the
  return value, so the player gets no feedback at all: the tap is simply lost.
- **Expected:** A restored session must continue issuing fresh command IDs; a legal release after a
  resume must apply. spec.md §3 "One-input confidence: every press, tap, drag, key, or pointer
  action gives immediate visual and sonic acknowledgment."
- **Evidence:**

  ```
  three releases:  ok=true duplicate=false  released 0->1, 1->2, 2->3
  cmdSeq = 3   log ids = 0,1,2
  undo: true
  one more release: ok=true duplicate=false  released 2->3
  cmdSeq = 4   log ids = 0,1,3
  after restore: cmdSeq = 3   seenIds = 0,1,3
  release after restore: ok=true duplicate=true  released 3->3   <-- input lost
  ```

  The same drift occurs for any `dispatch` that errors before reaching `this.log.push(cmd)`, because
  `cmdSeq` is incremented at `session.js:79` before `applyCommand` is called.

## Suspected — not confirmed

### 1. `resolveConflict` treats a higher revision number as a strict descendant

- **File:** `js/session/persistence.js:104-113`
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

### 2. `saveDoc` can throw on a full quota

**FIXED 2026-08-26.** `rawSet` (js/session/persistence.js:58) now wraps the write in try/catch and
degrades to a console warning, matching the "storage full — non-fatal" policy already used by the
snapshot writer in `js/main.js`.

- **File:** `js/session/persistence.js:58-61` (`rawSet`), `js/session/persistence.js:88-98`
- **Concern:** `rawSet` calls `localStorage.setItem` without a try/catch. `js/main.js:560-570`
  wraps its own snapshot write in `try/catch`, but progression/profile/settings saves via `saveDoc`
  are not wrapped by all callers.
- **Why unconfirmed:** could not exercise a genuinely full quota in headless Chrome within this pass.

### 3. Score-submission handler sorts the live store array in place on the duplicate path

- **File:** `server.js:328-331`
- **Concern:** `boardEntries(entry.board).sort(compareResults)` returns `store.boards[board]`
  directly (not a copy), so the idempotent-resubmit path mutates the stored ordering as a side
  effect of a read.
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
