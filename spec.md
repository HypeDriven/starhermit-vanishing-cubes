# Vanishing Cubes — Product and Game Specification

**Document status:** running specification. Section 0 describes the game as it ships, on the StarHermit engine; the later sections are the original design intent.  
**Game index:** 12  
**Genre:** Three-dimensional direction puzzle  
**Players:** 1 player; optional asynchronous score comparison  
**Targets:** desktop browsers, mobile browsers, landscape and portrait where practical  
**Rendering direction:** Three.js-first presentation with a fully usable semantic HTML interface layer


## 0. Vanishing Cubes on the StarHermit engine

Vanishing Cubes is a StarHermit engine **script game** (engine 1.29.0, `engine.minor=31`, entry `native/main.ts`), played natively by the StarHermit client and in browsers by the engine's web runtime (the loader `index.html` and `starhermit-files.json`, written by `npm run package`).

**Modules.** The rules (`js/rules/engine.js`, scoring, generator, rng), the session (`js/session/session.js`), the merge helpers and the content (`js/content/*`) are the browser build's ES modules, imported unchanged (engine.js clones states as JSON: the native interpreter has no structuredClone). `js/content/generated.js` holds the 40 Journey stages and the 8 challenge boards precomputed by `tools/gen-levels.mjs` (generation takes seconds natively); a unit test checks it matches the generator. Practice and Daily boards are generated on a `starhermit:script` worker (`native/gen-worker.js`) with a "Preparing the board…" line after 300 ms. `native/render.ts` draws the sculpture on `starhermit:scene`, `native/screens.ts` the UI on `starhermit:ui` (styles: `tools/ui-style.css` → `assets/ui-style.json`), `native/audio.ts` the sound, `native/platform.ts` saves and the platform, `native/i18n.ts` the nine locales.

**Screens.** Top bar (brand, sync state, Profile, Help, Settings); Title (Play / Resume, Daily challenge, Journey, Scores, All modes, Sign in or Invite, progress line); Modes (Learn, Journey, Daily, Practice, Challenge, Score chase); per-mode setup; Scores (the StarHermit high-score board when signed in, personal records per Daily/challenge board, a display-name filter); How to play (controls from the live bindings); Results (headline, stars, score breakdown, achievements, personal record, leaderboard line, Retry / Next / Modes). Dialogs: Pause (Resume, Settings, Help, Restart, Leave), Settings, Profile, Board list.

**Play layout.** At ≥ 1024 logical px: the objective rail (stats, live score breakdown, par, tip) and the actions rail (Undo, Hint, rotations, Reset camera, Board list, selection) beside the playfield. Narrower: Info / Tools drawers and a bottom quick-action tray (a right-hand column on short landscape screens). The HUD shows the stage and cubes left, the clock on timed rounds and Pause. A 3-2-1 countdown (any press skips it) starts each round. The camera is fitted to the playfield rectangle with a lens shift.

**Controls.** Keys: Enter release selected cube (or select the first clear one), ←/→ previous/next clear cube, Q/E rotate the assembly, W/A/S/D orbit the camera (new), R reset camera, U undo (Practice), H hint, P or Escape pause. Tab belongs to the runtime's focus and no longer cycles cubes; action names are lowercase, so key bindings saved under the browser build's names do not carry over. Pads: South release, East cancel, West undo, North hint, shoulders rotate, D-pad cycle, left stick orbit, right-stick press reset, Start pause. Pointer and touch: tap a cube to select and release it, drag to orbit (each ~60° of drag counts as one rotation), optional tap-to-grab camera. Clear cubes are named areas over the 3D view (screen readers, play scripts, browser checks); the Board list lists every cube with a release button for the clear ones.

**Settings.** The game's own: captions for sounds, colour palette (default / colour-blind safe / mono safe), left-handed layout, tap-to-grab camera, timing assistance, cosmetic theme (unlocked by stars), replay lessons. Sound volumes, graphics level, language, key bindings, reduced motion, high contrast and text size are the runtime's Options ("More options" opens them).

**Graphics.** The old presets map to the runtime's tier (`frame().quality`): Low (Lambert, no shadows, no post), Balanced (Standard, 1024 shadows, bloom, grade, FXAA, reflections), High (clear-coated Physical, 2048 shadows, GTAO, SMAA), Ultra (4096 shadows, full GTAO, MSAA, larger budgets). Lights and shadows use the r180 page's own values (no compensation at minor 23); reflections use RoomEnvironment through PMREM at environmentIntensity 0.14.

**Audio.** The recorded one-shots in `sfx/`, a generative pad and wind bed rendered into clips (music bus; the runtime has no ambience bus).

**Platform.** One save document (`js/migrate.js`: options, progression, profile, achievements, personal-record boards, the resumable round) on the device and, signed in, the cloud slot; conflicting copies merge progress. The browser build's cloud slot (`game:<slug>`) is merged in once and replaced; its settings KV mirror is read once for the game's own options. Finished Daily and Challenge rounds of signed-in players post their score to the `high-score` board through `score-script.js`, which range-checks it (scores are not replay-verified). The Daily uses the platform clock's UTC day when available, else the device's. Telemetry, presence and activity bookkeeping had no route and are gone.

**Checks.** `npm test`: rules/content/replay/fuzz/session tests (`tests/run-tests.js`), i18n coverage of `native/*.ts`, save migration tests, and `tests/native.mjs` (web index up to date, tsc, `starhermit check` with no warnings, render-check play scripts: Journey 1 cleared, two lessons on a DPR-3 phone, every screen and dialog, a challenge sideways, today's Daily). `npm run test:browser` plays the web package in GPU Chrome at desktop, DPR-3 phone and DPR-3 landscape.

**Known limitations.** The old build's camera fit frames the board tightly (kept). Keyboard bindings under the old action names are not migrated. Guests' old browser localStorage progress cannot migrate (cloud saves do).

## 1. Product vision

Vanishing Cubes is a game in which players rotate a cube assembly and release blocks whose arrow path is clear. Its signature setting is a floating impossible sculpture in a pale sky. The product should feel immediately understandable, responsive within one input, and polished enough that the board or playfield itself is the visual hero. Sessions should begin quickly, make the next useful action obvious without solving the game for the player, and end with a clear explanation of score and progress.

The experience must be original. Do not copy names, layouts, characters, iconography, writing, audio, progression maps, or level data from an existing title. Use an original visual language, original procedural assets, and internally authored content.

### Design pillars

1. **Readable before spectacular:** legal actions, hazards, selection, ownership, and goals remain legible with effects disabled.
2. **One-input confidence:** every press, tap, drag, key, or pointer action gives immediate visual and sonic acknowledgment.
3. **Short path to play:** a returning player reaches the primary playfield in at most two deliberate actions.
4. **Fair mastery:** randomness is seeded and inspectable; outcomes never depend on hidden purchases or invisible stat boosts.
5. **Scalable beauty:** the same art direction survives low-power mobile hardware and high-resolution desktop displays.

## 2. Core game design

### Objective and rules contract

Rotate a cube assembly and release blocks whose arrow path is clear.

The rules engine must represent legal actions independently from rendering. It must expose legal-action queries, deterministic resolution, serializable state, a monotonically increasing turn/tick number, and a terminal-state reason. Tutorials and hints call the same legal-action API used by play rather than duplicating rules.

### Core loop

The repeated loop is: **rotate the assembly, test a visible arrow, release clear cubes, and expose the core**. Input is locked only during the shortest non-interruptible resolution phase. Cosmetic animation may continue after the logical state is ready, but skip/fast-forward must settle every object into the exact deterministic end state.

### Scoring and victory

Reward completion under par taps and camera rotations; include transparent path preview. Results show a component breakdown rather than one unexplained total. Store integers for score and simulation units; format values only in presentation. Ties use, in order: primary objective completion, fewer invalid actions, lower authoritative elapsed time, then stable session identifier.

### Modes

- **Learn:** interactive lessons introduce one rule at a time and require the player to perform the action.
- **Journey:** authored progression with gradually combined mechanics and periodic mastery stages.
- **Daily:** one shared seed and ruleset per UTC day, synchronized to platform time.
- **Practice:** selectable difficulty, restart, undo where rules permit, and no effect on competitive rating.
- **Challenge:** constrained goals such as move limits, speed targets, altered layouts, or restricted tools.
- **Score chase:** asynchronous global and friends comparisons using validated seeds and rulesets.

### Difficulty and content generation

- Represent content as versioned data: identifier, seed, initial state, goals, allowed mechanics, par values, tutorial flags, and presentation theme.
- Run offline validators to prove basic legality, reachable goals, bounded duration, and absence of soft locks. Logic puzzles additionally require a unique or explicitly accepted solution class.
- Difficulty is measured from solution depth, branching factor, time pressure, motor precision, hidden information, and recovery options—not merely larger numbers.
- Introduce one new concept in isolation, combine it with one known concept, then test mastery before adding another.
- Daily seeds are immutable after publication. If content is defective, mark the day excluded from ranking rather than silently replacing it.

### Game-state model

`boot → title → profile-ready → mode-select → preparing → tutorial/countdown → active ↔ paused/reconnecting → resolving → results → progression`.

Every transition has one owner and an explicit reason. Backgrounding pauses solo simulation. In hosted play, the authoritative clock continues where rules require it, while the returning client receives a fresh snapshot and a concise “while you were away” summary.

## 3. Interaction and user-interface design

### Information hierarchy

1. **Primary:** playfield, current objective, legal interaction target, and immediate danger or turn state.
2. **Secondary:** score/progress, remaining moves or time, opponent/party status where applicable.
3. **Tertiary:** settings, social controls, cosmetics, help, and history.

The Three.js canvas fills the game region but is never the only UI. Menus, text, forms, chat, settings, and assistive descriptions use semantic HTML over or beside the canvas. Maintain a single shared layout model so DOM labels align with projected Three.js targets.

### Responsive layouts

- **Wide desktop (≥1024 CSS px):** centered playfield, objective/progression rail on the left, contextual actions and social/status rail on the right. Maximum line length is 70 characters.
- **Compact desktop/tablet:** playfield remains central; secondary rails collapse into drawers. Pointer hover may preview but never be required.
- **Portrait mobile:** top safe-area status bar, square or perspective-fit playfield, bottom thumb-zone action tray, and sheet-based secondary panels. Never place critical controls under browser chrome or display cutouts.
- **Landscape mobile:** reserve a narrow status rail; preserve at least 44×44 CSS-pixel targets and 8-pixel separation. The quick-action tray is a right-hand column below the top HUD (the HUD's own pause hides since the tray has one) and disappears while a drawer is open.
- React to resize, orientation, device-pixel-ratio, safe-area insets, virtual keyboard, and visibility changes without losing input or restarting the round.
- **Large screens (above 1600×1000):** the shared `ui-scale.js` sets `--ui-scale` (`min(w/1600, h/1000)`, capped at 2.5); the top bar, rails (and their grid tracks), HUD, banners, toasts, screens and modals zoom by it with viewport units divided by it, while the WebGL canvas stays unzoomed and fills the remaining playfield. Each screen opens scrolled to its top and centres its content only when it fits.

### Screens and overlays

- **Title/home:** Play is dominant; daily challenge, journey progress, and profile are one level below.
- **Mode setup:** show rules, expected duration, player count, assists, and whether the result is ranked before commitment.
- **Play HUD:** objective, progress, current actor/state, pause, and only context-relevant actions.
- **Pause/settings:** resume first; audio, graphics, controls, accessibility, help, and leave are clearly separated.
- **Results:** outcome headline, score breakdown, progress, achievements, comparison, replay/retry, and next recommended action.
- **Help:** visual rule cards generated from current control mappings and representative legal states.
- Daily challenge, local practice, pause, resume, results, and progression are first-class screens.

### Input

- Pointer/touch: raycast only against explicit interaction layers; use pointer capture for drags; cancel safely on lost capture.
- Touch: distinguish tap, drag, and camera gesture by distance/time thresholds; never require multi-touch for core play.
- Keyboard: directional navigation among legal targets, confirm, cancel, pause, undo/hint where valid, and camera reset.
- Gamepad: focus navigation, primary/secondary actions, pause, and remappable axes/buttons.
- Prevent accidental double commits with action identifiers, not arbitrary long debounce timers. Provide visible drag origin, target preview, and invalid-action explanation.

### Accessibility

- Full keyboard operation and visible focus; DOM equivalents for canvas controls; headings and live regions for objective, turn, score, errors, and results.
- Color is reinforced by shape, texture, icon, or label. Include contrast-safe and common color-vision palettes.
- Reduced-motion mode removes camera swoops, shake, parallax, rapid particles, and large scaling while preserving event timing.
- Independent sliders for music, effects, ambience, and voice; captions/text cues for meaningful audio; no audio-only gameplay.
- Options for larger text, high contrast, left-handed controls, hold-versus-toggle, timing assistance, haptics off, and tutorial replay.
- Announce Three.js board state through a concise navigable model rather than describing every decorative object.

## 4. Visual and audio design

### Visual contract

The subject is the active playfield at near-tabletop to room scale, framed so state changes occupy most of the screen. The scene is a floating impossible sculpture in a pale sky. Use an authored camera, original procedural geometry, restrained environmental storytelling, and a deterministic visual seed. The no-post-processing baseline must still communicate hierarchy, depth, selection, and state.

### Three.js scene design

- Use physically based lighting and color management with one dominant key, soft environment fill, and contact grounding. Gameplay colors are tested after tone mapping.
- Build reusable semantic meshes for active pieces, board cells, obstacles, targets, and environment modules. Geometry detail follows silhouette importance and camera distance.
- Use instancing for repeated pieces and props, pooled effects, texture atlases where appropriate, and explicit disposal on scene changes.
- Separate render layers for environment, gameplay, selection/ghosts, effects, and UI anchors. Cosmetic particles never intercept raycasts.
- Selection uses a combination of lift/pose, outline or rim, and grounded marker—not bloom alone. Legal targets preview before commit; invalid targets explain why.
- Event hierarchy: input acknowledgment < legal move < combo/goal < round completion. Reserve camera motion, strong emission, and dense particles for the highest tier.
- Audio uses original short transients tied to logical events, layered material impacts, quiet ambience, and adaptive music stems. Randomized pitch/variant is seeded for replay consistency where recording matters.

### Camera and motion

- Choose orthographic or low-distortion perspective according to depth requirements; expose framing constants rather than magic offsets.
- Camera transitions use authored duration/easing or critically damped springs and remain interruptible. Never animate by cumulative per-frame lerp.
- Decorative motion is paused or reduced when hidden. Gameplay animation derives from simulation state and interpolation alpha, not frame count.
- Camera shake is low-amplitude, event-tiered, disabled by reduced motion, and never changes raycast truth.

### Graphics-skill routing

During implementation, begin with `threejs-skill-router` and load only the following retained skills because they materially affect this visual target:

- `threejs-camera-direction` for deliberate framing and input-safe camera transitions
- `threejs-procedural-geometry` for authored, inspectable meshes instead of primitive-only placeholders
- `threejs-procedural-materials` for coherent PBR surfaces, perceptual parameters, and readable state masks
- `threejs-procedural-animation` for deterministic motion phases, springs, and interruption-safe transitions
- `threejs-procedural-vfx` for bounded particles, trails, impact accents, and event hierarchy
- `threejs-exposure-color-grading` for tone mapping, adaptation limits, and accessible color separation
- `threejs-image-pipeline` for explicit depth/color ownership and pass ordering
- `threejs-visual-validation` for fixed-view captures, seed sweeps, and performance evidence

Follow the skill pack's acceptance gate: deterministic seeds, debug views for controlling fields, perceptually grouped parameters, mechanism-backed quality tiers, and a readable no-post baseline. Do not add an effect merely because a skill exists.

### Graphics

**Graphics.** The renderer uses ACES filmic tone mapping with sRGB output, one warm key directional light whose PCF shadow box is fitted to the current board's bounding sphere, and a hemisphere sky fill. With reflections on, a PMREM-filtered room environment lights PBR materials (the hemisphere fill drops to keep totals balanced): arrow cubes are glazed ceramic with a clear coat, chevrons and the core carry their own clear coat, and the core's emission rises when bloom can carry it (hierarchy never depends on it). The sky dome has a gradient, a sun glow toward the key light and procedural cloud banks that drift slowly; sculpture modules use a mottled stone texture; soft round light motes drift around the board and release bursts use round sprites. Surface detail adds smoother cube bevels and fine glaze/stone grain. Optional post-processing (three.js EffectComposer, same r180 revision as the core): GTAO contact darkening, bloom with a scene-linear threshold so only emissive cores, the sun glow and hot highlights glow, a colour grade (gentle S-curve, slight saturation, warm highlights/cool shadows) with vignette, and FXAA, SMAA or MSAA. The title screen shows the theme's sky with drifting clouds (Surface detail on; drift only with an animated background). Decorative motion — clouds, motes, module bob — stops under reduced motion or a static background. The Settings panel's **Graphics** section offers a quality preset (Auto, chosen from the StarHermit hardware level — see below; Low; Balanced; High; Ultra), a render scale (50–200% of the preset's), one override per category — shadows (off/1024²/2048²/4096²), ambient occlusion (off/on/high), bloom, colour grade, anti-aliasing (off/FXAA/SMAA/MSAA), reflections, particles (low/high), sky animation (static/animated) and surface detail (plain/detailed), each "From preset (…)" by default — adaptive resolution (averages ~90 frames; steps the scale down by 0.1 to 60% when frames exceed 26 ms and back up by 0.05 below 14 ms) and a frame-rate readout (bottom-left of the playfield, never over controls), plus a summary line "GPU · Level N · cost · W×H px" ("Level" localized). The device pixel ratio is capped per preset (Low 1, Balanced 1.5, High/Ultra 2) and multiplied by the preset scale, the user scale and the adaptive scale. Choosing a preset clears overrides; changes apply immediately without reload, are saved in the settings document (`graphics`, cloud-saved with the rest) and keep keyboard focus on the changed control. Low is a single direct render with no post chain and no canvas MSAA. If the post chain cannot be built the game renders without it and the panel says so. The Graphics section's strings are localised in the nine game locales and follow the game language (§5 Localization). The game's own settings redraw inside `#settings-own`; the shared Sound / Language / Report sections (`game-options.js`) mount after it inside `#settings-body` and are never rebuilt by the game. `body[data-gfx-preset]` and `#gl[data-gfx-preset]` expose the resolved preset.

**Hardware-level detection.** `js/render/gpu-level.js` (`window.StarHermitGpu`, never edited here) rates the WebGL renderer string plus device facts (`detectSystem()`: phone/tablet, cores, memory, screen, ASTC) on the StarHermit hardware level 0–20 (0 = Galaxy S20 / Intel UHD or weaker, every software renderer; 20 = RTX 5090; each level ≈ 1.23×; laptop parts two levels below the desktop part; phones, tablets and ≤ 4 GB machines capped at 9). `js/render/gfx.js` maps it with `presetForLevel(level, { low: 0, balanced: 4, high: 10, ultra: 17 })`, so Auto picks Ultra on strong GPUs; adaptive resolution still steps down when frames are slow. Headless SwiftShader is level 0 → Low. Phones and tablets pace Auto FPS at half the display refresh rate ("Auto (half refresh rate)") and start at 16 simultaneous sounds (shared `game-options.js`).

**Per-preset budgets** (`BUDGETS` / `budget()` in `js/render/gfx.js`). Each preset holds 60 FPS on the weakest GPU Auto gives it — Low at level 0, Balanced 4, High 10, Ultra 17. Cubes, arrows, picking, legal-target visibility and rules are identical on every preset; only visuals change. Burst sparks scale up within the preset on faster GPUs (`StarHermitGpu.scaleBudget`, ≤ 2×; the burst pool is 2048 points). A budget change rebuilds the cube materials and geometry in place; changing preset also rebuilds the sculpture.

| Budget | Low | Balanced | High | Ultra |
|---|---|---|---|---|
| Shading (cubes, chevrons, lock bands, sculpture) | Lambert | Standard | Physical glaze + clear coat (Reflections on); Standard sculpture | as High |
| Cube bevel / corner segments (Detail on; plain ≤ 2 / 4) | 1 / 2 | 2 / 4 | 4 / 6 | 5 / 8 |
| Cube panel texture (grain with Detail on; stone ≤ 256) | 64 px | 128 px | 256 px | 512 px |
| Sculpture modules (staircases, arcs, obelisks) | ½ | ¾ | full | 1.3× |
| Arc / sky / disc segments | ½ | ¾ | full | 1½× |
| Light motes (Particles high) | 0 | 40 | 70 | 120 |
| Release / unlock / completion bursts | 0.35× | 0.7× | 1× | 1.5× |
| Bloom / GTAO resolution | ½ | ½ | ½ | full |
| Pixel-ratio cap × render scale | 1 × 0.8 | 1.5 × 1 | 2 × 1 | 2 × 1.25 |

**Benchmark** (`node tools/gfx-bench.mjs vanishing-cubes`, hook `tests/gfx-bench.mjs`: preset chosen in Settings → Graphics, then Hard practice — 4×4×4 with stones, locks and a core — cleared with Tab + Enter and the rotate button, retried from results). Measured 2026-10-18 on the AMD Radeon iGPU (level 2), projected to each preset's floor level:

- Desktop 1920×1080: PASS low typical 0.39 / slow 0.82 ms, CPU p90 0.50 ms; PASS balanced 0.74 / 0.21 ms, CPU 0.70 ms; PASS high 0.77 / 0.76 ms, CPU 1.00 ms; PASS ultra 2.20 / 2.96 ms, CPU 1.00 ms.
- Mobile 390×844 @ DPR 3: PASS low 0.00 / 0.29 ms, CPU 0.60 ms; PASS balanced 0.00 / 0.14 ms, CPU 0.70 ms.

Files: `js/render/gfx.js` (pure quality model: presets, categories, hardware-level detection, `BUDGETS`/`budget`, `resolve`, `describe`), `js/render/gpu-level.js` (shared StarHermit copy, classic script loaded before `js/main.js`), `js/render/cubeviews.js` (per-budget cube LOD, textures and materials), `js/render/scene.js` (`setGraphics`, `graphicsInfo`, post chain, adaptive resolution), `js/ui/gfx-strings.js` (Graphics panel strings), `vendor/addons/` (three.js r180 postprocessing, shaders and RoomEnvironment addons, mapped as `three/addons/`).

### Performance budgets

- Target 60 fps at the default tier and a stable 30 fps fallback on constrained mobile hardware.
- Default active gameplay: ≤150 draw calls desktop, ≤90 mobile; ≤350k visible triangles desktop, ≤140k mobile; transient particles ≤20k desktop and ≤5k mobile.
- Cap device pixel ratio by quality tier; dynamically lower render scale before dropping simulation rate. UI text remains native resolution.
- Avoid runtime shader compilation during active play by prewarming required variants. Avoid per-frame allocations in simulation/render loops.
- Quality tiers independently control shadows, environment detail, particles, post effects, antialiasing, and render scale; they never alter rules or visibility of hazards.

## 5. Technical architecture

### Client modules

- `bootstrap`: host handshake, capability detection, asset manifest, lifecycle.
- `rules`: pure deterministic state transitions, legality, scoring, seeded random stream.
- `session`: local or hosted commands, snapshots, prediction policy, reconnect, replay.
- `render`: Three.js scene graph, semantic entity views, camera, lighting, VFX, quality.
- `ui`: responsive DOM shell, focus, localization, settings, overlays, accessibility mirror.
- `audio`: buses, event mapping, focus/background behavior, decode and memory policy.
- `content`: versioned levels, themes, tutorials, validation metadata.
- `platform`: token-aware REST/WebSocket adapter, retries, rate-limit handling, telemetry consent.

No module may mutate rules state except through a validated command. Rendering consumes immutable snapshots plus interpolation data. UI state and simulation state are separate so closing a drawer cannot affect a match.

### Localization

- Every player-facing string ships in nine locales (en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT): markup (`data-i18n`, `data-i18n-aria`), title, mode cards, setup screens, HUD and rails, board mirror, results, scores, help (including control names), settings, profile, toasts, announcements, sound captions, refusal explanations and all content names (40 levels, chapters and blurbs, level tips, lessons with goals and every step, challenges and blurbs, themes, achievements). Strings live in `js/ui/strings.js`; `js/ui/i18n.js` provides `t()`/`tn()`, `levelName()`, `refusalText()` and sets `<html lang>`. Engine refusals carry a reason code (plus key/blocking cube) and the UI localizes them; authored English stays in the content modules as data.
- Settings → **Language → Game language** (from the shared `game-options.js`, rendered from the `sh-language.js` instance in the Settings dialog — reachable from the top bar on every screen and from the pause menu) offers **Automatic — <resolved language>** plus the nine locales by native name, with a sync status line. It is the only language selector.
- Resolution (`sh-language.js`, loaded before the modules): explicit game choice → for Automatic, the StarHermit account's `preferredLanguage` (`GET /api/v1/me/language`, signed in only) → `navigator.languages` → en-US. The choice (`auto` or a locale) is stored per player in `localStorage['vanishing-cubes.language.<user|guest>']` and, signed in, in the per-player settings key `ui.language` as `{ choice }`; a failed settings read never overwrites it and the game never writes the platform preference. The game's settings mirror only syncs its own keys (never `ui.*`). `?lang=<tag>` forces a locale for the page load and hides the selector.
- A change applies immediately: the visible screen, HUD, rails, board mirror, tutorial banner, results and open dialogs re-render in place; a running round, its clock and selection are untouched.
- Portrait phones: the HUD objective chip wraps rather than truncating, top-bar and HUD buttons keep their size while the sync chip shrinks, and quick-action tray labels wrap inside their buttons.

### Determinism, replay, and security

- Fixed simulation step where physics exists; quantize authoritative inputs and define stable collision/order rules.
- Use separate seeded random streams for rules, content decoration, and audiovisual variants. Cosmetic randomness never changes rules.
- Replay envelope: schema version, build/content version, seed, initial hash, timestamp offset, ordered commands, periodic state hashes, terminal result.
- Validate all network input for identity, session membership, turn/tick, bounds, rate, payload size, and legal action. Reject duplicates idempotently by command ID.
- Treat client clocks, scores, inventories, roles, physics outcomes, and completion claims as untrusted in competitive contexts.

### Loading and resilience

- Show useful progress by asset group; load core rules/UI first and scenic assets lazily. Provide procedural low-detail substitutes if optional assets fail.
- Cache immutable hashed assets and the last safe local snapshot. Updates activate between rounds, never during one.
- Recover WebGL context by rebuilding GPU resources from retained CPU descriptors. If 3D is unavailable, present a clear compatibility message and preserve account/session state.
- Background tabs reduce rendering to zero or a low heartbeat while preserving required network lifecycle.

## 6. StarHermit integration

### Packaging and launch
- Ship a browser distribution with `starhermit.txt` at its root, `name=Vanishing Cubes`, and `launch=index.html`. Keep source files, secrets, design documents, and source maps outside the uploaded distribution.
- `index.html` loads the canonical `starhermit-sdk.js` (unmodified copy of `tools/starhermit-sdk.js`) and calls `StarHermit.init()` before any module runs. The SDK reads `#game_token=` / `#access_token=`, strips it from the URL, takes the slug from the `game_scope` claim and renews the launch token; tokens never reach local storage. `js/platform/platform.js` wraps the SDK.
- Without a token the game makes no network calls at all (no dev-server probe, activity, presence or telemetry) and uses the device clock. When renewal is refused it toasts "signed out", re-offers sign-in and keeps playing locally.
- Daily boundaries use the device clock's UTC day in both modes (the platform API reachable by a launch token has no time route).

### Identity, profile, presence, and preferences
- Guests play locally with an editable profile name. On `*.starhermit.com` without a token the title shows **Sign in with StarHermit**; it is hidden when signed in and when running locally.
- Signed in, the profile name is the account nickname (fallback `Player <id prefix>`) and the title shows **Invite a friend**, which copies `StarHermit.inviteLink()` to the clipboard with a toast. These strings are localized in all nine locales. No presence calls are made.
- Audio, graphics, accessibility and telemetry-consent settings are mirrored to the per-game settings KV on change; on start the platform values win over local ones.
- Keyboard actions are declared as `control.*` lines in `starhermit.txt` and matched by `event.code` (Shift+Tab always steps to the previous target). Help lists the effective keys. The Settings rebinding UI stores overrides locally and, when signed in, persists them with `setControl` / `resetControls`; on start the player's StarHermit bindings replace local overrides. Touch mappings remain responsive UI controls.
- The settings, progression, profile, achievements and boards documents are cloud-saved together in the `game:<slug>` slot through `StarHermit.loadJSON`/`saveJSON`. On start the cloud copy is merged in: progression, achievements and personal-record boards are merged (`js/session/merge.js`) so neither device loses progress — best stars, best scores and larger totals per id, unions of lessons and achievements (earliest unlock), the better daily score per day with completion kept, boards unioned per session; settings and profile take the newer revision. The merge is written back when this device had something the cloud lacked. Local saves are mirrored (debounced ~2 s, conditional on the version last loaded) and flushed on `pagehide`/hidden; the top bar shows the sync state. When another device saved first the SDK refuses the write and emits `saveconflict`: the game reloads the cloud copy, merges it the same way and saves again. localStorage remains the offline cache. Never place credentials or private chat in saves.
- Settings → **Report a problem** (signed in only, from `game-options.js`) files a bug report through `StarHermit.reportBug` with a small non-personal `context.json` (viewport, language, FPS cap, audio limit); uncaught errors are filed as crash reports through `StarHermit.captureCrashes` (SDK-capped).

### Discovery, activity, and social layer
- Entitlement or catalog state belongs to host-owned chrome; the game stays playable without promotional interruption. No launch-activity calls are made (no route is reachable with a launch token).
- The invite link and friends-filtered boards are the social layer; there is no gameplay chat or voice in this solo game.

### Achievements and leaderboards
- Declare a small static achievement set: first completion, mechanic mastery, a sustained streak, a difficult content milestone, and an accessibility-neutral long-term goal. Keys are stable, lowercase identifiers; unlocks are idempotent.
- Scores reads the game's platform board with `StarHermit.leaderboard()` (friends filter passes `scope=friends`), resolving user ids to nicknames. Signed in, every finished ranked round (Daily or Challenge) posts its score through `StarHermit.submitScores({ 'high-score': score })`; `score-script.js` posts it to the `high-score` board (integer, higher is better, 0–100,000). The results card shows "Posting score to the leaderboard…", then "Leaderboard rank: #N" (or "Score posted to the leaderboard." / "Score not posted to the leaderboard."), localized in `js/ui/platform-strings.js`; standalone posts nothing and shows no line. Personal bests are also kept locally (labeled casual) and cloud-saved. If the game has no platform board, only local records are shown.
- Achievements stay local (part of the cloud-saved document); there is no client or script unlock path on-platform.

### Sessions and transport
- The game is solo. The bundled `server.js` is a local dev server (static hosting plus replay-validated boards, activity, presence and telemetry routes); the client no longer calls it. Hosted play uses only the platform routes above; its only platform session is the short practice session that posts a ranked score, so there is no matchmaking or replays. Ordinary practice runs locally and offline after initial load.
- A daily session records content version, seed, settings affecting difficulty, an ordered input log, score components, and final checksum. Reconnect from the durable session snapshot rather than trusting cached client state.
- Realtime rooms, peer relay, matchmaking, backfill, and voice are intentionally not used because they add no value to this ruleset.

### Publishing and operations
- The platform script is `score-script.js` (`server=score-script.js` in `starhermit.txt`; canonical copy in the games repo's `tools/score-script.js`): it range-checks a ranked round's score and posts it to the `high-score` board. The bundled `server.js` is the local development server; achievements have no script-owned path.
- Define control defaults, achievement metadata, and versioned settings before release. Publish immutable build assets, verify the launch path, maintain migration tests for saves, and expose no secret configuration to the client.
- Capture anonymous funnel events only for start, tutorial step, round end, retry, settings change, and error category. Avoid raw text, precise personal data, and cross-title tracking.

## 7. Content, economy, and retention

- Launch scope: tutorial sequence, at least 40 authored stages or equivalent procedural depth, daily challenge, practice, five visual themes, and a mastery track.
- Cosmetic rewards may alter materials, trails, board surrounds, ambience, or profile flourishes, but never hitboxes, timing windows, information, or power.
- Reward cadence: early feedback every session, meaningful unlock every 3–5 sessions, and long-term goals visible without manipulative countdowns.
- No real-money wagering, paid random rewards, forced advertising, energy pressure, punitive streak loss, or purchases that affect competitive outcomes.
- Notifications, if ever added by the host, are opt-in, frequency-capped, quiet-hour aware, and never use false urgency.

## 8. Analytics and privacy

Measure tutorial completion, first meaningful action time, session duration bands, level attempts, quit state, input modality, performance tier, reconnect success, and accessibility feature usage only in aggregate. Use random session identifiers, short retention, and explicit consent where required. Never collect message content, drawings, voice, private board notes, or exact pointer trails as analytics.

Success targets for the first public test: median first-play time under 20 seconds, tutorial completion above 80%, crash-free sessions above 99.5%, p95 input acknowledgment below 100 ms locally, and at least 95% of supported mobile sessions holding their selected frame-rate tier.

## 9. Testing and acceptance criteria

### Rules and content

- Unit-test every legal action, invalid-action reason, scoring component, terminal state, and serialization migration.
- Property-test deterministic replay: the same version, seed, and commands produce identical state hashes.
- Fuzz malformed commands and generated content; prove no hangs, NaN physics, impossible mandatory states, or unbounded loops.
- Golden-test representative easy, medium, hard, interrupted, resumed, and terminal sessions.

### Interface and accessibility

- Test pointer, coarse touch, keyboard-only, gamepad, screen reader, zoom to 200%, reduced motion, high contrast, safe areas, and both mobile orientations.
- Verify focus restoration after every modal, meaningful live announcements, no keyboard traps, and no hover-only instructions.
- Confirm all critical labels fit translated strings at 30% expansion and support right-to-left layout where localized.

### Graphics and performance

- Produce fixed-camera captures for every quality tier, deterministic seed sweeps, no-post baselines, debug-view mosaics, and 10-minute temporal stability runs.
- Profile CPU, GPU, memory, shader compilation, draw calls, triangles, texture memory, and garbage collection on representative desktop and mobile classes.
- Verify effects cannot obscure legal targets, alter picking, leak resources, or continue expensive updates while hidden.

### Platform and network

- Test expired/rotated tokens, privacy settings, rate limits, offline start, reconnect at each game state, duplicate commands, out-of-order events, server restart, and version mismatch.
- Verify achievement idempotency, leaderboard validation, friends-only filtering, cloud-save conflict handling, activity start/end pairing, and server-time countdown accuracy.
- For hosted sessions, test disconnect/rejoin, abandonment, timeout, invitation expiry, result reconciliation, replay access, moderation controls, and authoritative cheat attempts.

## 10. Definition of done and non-goals

This specification is ready for implementation when rules examples, content schema, wireframes for all responsive breakpoints, visual target frames, accessibility annotations, authoritative message schema, achievement definitions, leaderboard definitions, and performance test devices are approved.

This document does **not** authorize implementation, asset production, monetization work, native wrappers, real-money systems, or copying any existing product. The initial build should favor one excellent core loop and a coherent original visual identity over feature breadth.

## Browser interference

`browser-guard.js` (loaded from `index.html`) suppresses browser UI that gets in the way of play: the right-click context menu, the iOS long-press callout, copy / cut / paste, and page text selection. Text fields (inputs, textareas, selects, contenteditable) keep normal selection, context menu and clipboard behaviour.


## Sound and frame-rate options

The options panel includes Sound controls for master, music, effects and UI volume, a mute that preserves volume levels, and an Auto or manual concurrent-sound limit (1–64). Changes apply immediately with perceptual volume curves. A shared allocator bounds Web Audio and media playback, including loops and scheduled sources. Graphics includes Auto display refresh or a custom maximum frame rate from 1–1000 FPS; rendering is paced independently of simulation and input. Preferences persist locally, with FPS stored per detected GPU, and reconcile with Starhermit settings when signed in. The controls support keyboard and touch input and the supported English, Spanish, German, French, Portuguese and Italian locales.
