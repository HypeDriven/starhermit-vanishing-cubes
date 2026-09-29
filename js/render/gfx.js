// Graphics quality model: presets, per-category overrides, GPU detection and a
// cost summary. Pure (no three.js) so the settings panel, the renderer and the
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

/**
 * Best preset for this GPU, from the unmasked renderer string when the browser
 * exposes it. Touch/mobile devices are capped at Balanced.
 */
export function detectPreset(gpu, { mobile = false } = {}) {
  const g = String(gpu || '').toLowerCase();
  let p = 'balanced';
  if (/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/.test(g)) p = 'low';
  else if (/nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|amd radeon(?! graphics)|apple m\d/.test(g)) p = 'high';
  if (mobile && (p === 'high' || p === 'ultra')) p = 'balanced';
  return p;
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
export function resolve(saved, detected) {
  const s = normalize(saved);
  const auto = !PRESETS.includes(s.preset) || s.preset === 'auto';
  const preset = auto ? (PRESETS.includes(detected) ? detected : 'balanced') : s.preset;
  const row = TABLE[preset];
  const userScale = clamp(Number(s.render_scale) || 1, 0.5, 2);
  const out = { preset, auto, userScale, scale: row.scale * userScale, dprCap: row.dprCap };
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    out[cat] = tiers.includes(s[cat]) ? s[cat] : row[cat];
  }
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
