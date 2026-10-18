// Graphics quality model: presets, per-category overrides, hardware-level
// detection, per-preset budgets and a cost summary. Pure (no three.js) so the settings panel, the renderer and the
// unit tests agree on what a setting means. Tiers never alter rules, picking,
// or the visibility of legal targets and hazards.

export const PRESETS = ['low', 'balanced', 'high', 'ultra'];

// Category → allowed tiers, cheapest first.
export const CATEGORIES = {
  shadows: ['off', 'low', 'medium', 'high'],
  ao: ['off', 'on', 'high'],
  bloom: ['off', 'on'],
  grade: ['off', 'on'],
  antialias: ['off', 'fxaa', 'smaa', 'msaa'],
  reflections: ['off', 'on'],
  particles: ['low', 'high'],
  background: ['static', 'animated'],
  detail: ['plain', 'detailed'],
};

// Each preset is a row of tiers, a render scale (multiplies the capped device
// pixel ratio) and a device-pixel-ratio cap.
const TABLE = {
  low: { scale: 0.8, dprCap: 1, shadows: 'off', ao: 'off', bloom: 'off', grade: 'off', antialias: 'off', reflections: 'off', particles: 'low', background: 'animated', detail: 'plain' },
  balanced: { scale: 1, dprCap: 1.5, shadows: 'low', ao: 'off', bloom: 'on', grade: 'on', antialias: 'fxaa', reflections: 'on', particles: 'high', background: 'animated', detail: 'detailed' },
  high: { scale: 1, dprCap: 2, shadows: 'medium', ao: 'on', bloom: 'on', grade: 'on', antialias: 'smaa', reflections: 'on', particles: 'high', background: 'animated', detail: 'detailed' },
  ultra: { scale: 1.25, dprCap: 2, shadows: 'high', ao: 'high', bloom: 'on', grade: 'on', antialias: 'msaa', reflections: 'on', particles: 'high', background: 'animated', detail: 'detailed' },
};

export const SHADOW_MAP = { off: 0, low: 1024, medium: 2048, high: 4096 };

// Legacy `graphics.tier` values from earlier builds.
const LEGACY = { auto: 'auto', low: 'low', medium: 'balanced', high: 'high' };

// StarHermit hardware level (0–20, gpu-level.js → window.StarHermitGpu) at which Auto starts choosing
// each preset. 0 = Galaxy S20 / Intel UHD or weaker, 20 = RTX 5090; phones, tablets and ≤ 4 GB machines
// are capped at level 9 (Balanced); software renderers are level 0 (Low).
export const LEVELS = { low: 0, balanced: 4, high: 10, ultra: 17 };

/*
 * Per-preset asset and effect budgets, each tuned to hold 60 FPS on the weakest GPU Auto gives the preset
 * (Low: level 0 phones / Intel UHD; Balanced: level 4 Iris Xe; High: level 10 GTX 1070; Ultra: level 17
 * RTX 4080; measured with tests/gfx-bench.mjs). Rules, picking and the visibility of legal targets are
 * identical on every preset.
 *   material  cubes, chevrons, lock bands and the sculpture: 'lambert' (Low) | 'standard' (Balanced) |
 *             'physical' (clear-coated glaze with Reflections on; High/Ultra)
 *   bevel     rounded-cube bevel segments and corner curve segments (cube LOD)
 *   texture   cube panel texture size in px (grain with Surface detail on)
 *   sculpture multiplies the floating staircases, arcs and obelisks around the board
 *   segments  multiplies arc, sky and ring segments
 *   motes     ambient light motes (Particles high)
 *   sparks    multiplies release / unlock / completion burst counts, then scaled by the hardware level
 *             within the preset (≤ 2×)
 *   bloomRes / aoRes  bloom and GTAO resolution as a fraction of the frame
 */
export const BUDGETS = {
  low: { material: 'lambert', bevel: [1, 2], texture: 64, sculpture: 0.5, segments: 0.5, motes: 0, sparks: 0.35, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: 'standard', bevel: [2, 4], texture: 128, sculpture: 0.75, segments: 0.75, motes: 40, sparks: 0.7, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: 'physical', bevel: [4, 6], texture: 256, sculpture: 1, segments: 1, motes: 70, sparks: 1, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: 'physical', bevel: [5, 8], texture: 512, sculpture: 1.3, segments: 1.5, motes: 120, sparks: 1.5, bloomRes: 1, aoRes: 1 },
};

const gpuApi = () => globalThis.StarHermitGpu;

/** Hardware level 0–20 for an unmasked renderer string plus StarHermitGpu.detectSystem() facts. */
export function detectLevel(gpu, system = {}) {
  const G = gpuApi();
  if (!G) return LEVELS.balanced;
  return G.detectLevel({ webgl: true, webgl2: true, ...system, gpu: String(gpu || '') });
}

/** Auto preset for a hardware level: Low 0, Balanced 4, High 10, Ultra 17. */
export function presetForLevel(level) {
  const G = gpuApi();
  if (G) return G.presetForLevel(level, LEVELS);
  return PRESETS.filter((p) => LEVELS[p] <= level).pop() || 'low';
}

/** Best preset for this GPU; phones and tablets are capped at Balanced by the hardware level. */
export function detectPreset(gpu, system = {}) {
  return presetForLevel(detectLevel(gpu, system || {}));
}

/** A preset's concrete budget for a hardware level (sparks scale within the preset, ≤ 2×). */
export function budget(preset, level) {
  const b = { ...(BUDGETS[preset] || BUDGETS.balanced) };
  const G = gpuApi(), floor = LEVELS[preset] ?? 0;
  const k = G ? Math.min(2, G.scaleBudget(1, Number.isFinite(level) ? level : floor, floor)) : 1;
  b.sparks = Math.round(b.sparks * k * 100) / 100;
  return b;
}

/** Normalise a saved graphics object (migrates the legacy `tier` field). */
export function normalize(saved) {
  const s = { ...(saved && typeof saved === 'object' ? saved : {}) };
  if ('tier' in s) {
    if (!PRESETS.includes(s.preset)) s.preset = LEGACY[s.tier] || 'auto';
    delete s.tier;
  }
  if (!PRESETS.includes(s.preset)) s.preset = 'auto';
  return s;
}

/**
 * Resolve saved settings into concrete tiers.
 * `saved`: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: tier }.
 * A category missing or set to 'preset' follows the preset.
 */
export function resolve(saved, detected, level) {
  const s = normalize(saved);
  const auto = !PRESETS.includes(s.preset) || s.preset === 'auto';
  const preset = auto ? (PRESETS.includes(detected) ? detected : 'balanced') : s.preset;
  const row = TABLE[preset];
  const userScale = clamp(Number(s.render_scale) || 1, 0.5, 2);
  const out = { preset, auto, userScale, scale: row.scale * userScale, dprCap: row.dprCap };
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    out[cat] = tiers.includes(s[cat]) ? s[cat] : row[cat];
  }
  out.level = Number.isFinite(level) ? level : LEVELS[preset];
  out.budget = budget(preset, out.level);
  out.adaptive = s.adaptive !== false;
  out.showFps = !!s.show_fps;
  // Post-processing runs only when something needs it; Low stays a direct render.
  out.post = out.ao !== 'off' || out.bloom === 'on' || out.grade === 'on' || out.antialias !== 'off';
  return out;
}

/** Apply a preset choice: choosing a preset clears every per-category override. */
export function choosePreset(saved, preset) {
  const s = normalize(saved);
  const next = { preset: preset === 'auto' || PRESETS.includes(preset) ? preset : 'auto' };
  for (const k of ['render_scale', 'adaptive', 'show_fps']) if (k in s) next[k] = s[k];
  return next;
}

/** Set (or clear, with 'preset') one category override. */
export function setOverride(saved, cat, tier) {
  const s = normalize(saved);
  if (!CATEGORIES[cat]) return s;
  if (CATEGORIES[cat].includes(tier)) s[cat] = tier;
  else delete s[cat];
  return s;
}

/** The preset's own tier for a category (for "From preset (…)" labels). */
export function presetTier(preset, cat) {
  return TABLE[preset]?.[cat];
}

const EN = {
  noShadows: 'no shadows',
  shadows: '{n}² shadows',
  ao: 'ambient occlusion',
  aoHigh: 'full ambient occlusion',
  bloom: 'bloom',
  reflections: 'reflections',
  noAa: 'no anti-aliasing',
  px: '{w}×{h} px',
};

/** Cost summary. `words` optionally localises the fragments (keys as in EN). */
export function describe(r, pixels, words = EN) {
  const w = { ...EN, ...words };
  const parts = [
    r.shadows === 'off' ? w.noShadows : w.shadows.replace('{n}', SHADOW_MAP[r.shadows]),
    r.ao === 'off' ? null : r.ao === 'high' ? w.aoHigh : w.ao,
    r.bloom === 'on' ? w.bloom : null,
    r.reflections === 'on' ? w.reflections : null,
    r.antialias === 'off' ? w.noAa : r.antialias.toUpperCase(),
    pixels ? w.px.replace('{w}', pixels[0]).replace('{h}', pixels[1]) : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
