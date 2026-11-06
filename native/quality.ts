// The look per graphics level. The engine's level table (levelSettings()) owns
// shadows and their map size, AO, bloom, the grade and anti-aliasing; the
// game's art (materials, bevels, texture sizes, sculpture, segments, motes,
// sparks, reflections) stays the browser build's four presets (js/render/gfx.js
// TABLE / BUDGETS) keyed by the runtime's quality tier, with the sparks and
// motes scaled within the tier by the level's particle budget (at most 2×).
// The runtime owns what the old Graphics section did besides: Auto and the
// level choice, render scale and pixel-ratio cap, adaptive resolution, the
// frame-rate limit and readout. The old per-category overrides are not offered
// (the runtime's Options choose a level).
import { levelSettings, type GraphicsLevel, type LevelSettings, type QualityTier } from "starhermit:engine";

export interface Budget {
  material: "lambert" | "standard" | "physical"; bevel: [number, number]; texture: number; sculpture: number; segments: number;
  motes: number; sparks: number;
}
interface Art { reflections: boolean; particles: "low" | "high"; animated: boolean; detailed: boolean }
export interface Look extends Art {
  preset: QualityTier;
  shadows: number; // the level's shadowMapSize, 0 = off
  ao: { resolution: number; samples: number; denoiseSamples: number } | null;
  bloom: number | null; // the level's bloom resolution
  grade: boolean;
  antialias: LevelSettings["antialias"];
  budget: Budget;
}
const ART: Record<QualityTier, Art> = {
  low: { reflections: false, particles: "low", animated: true, detailed: false },
  balanced: { reflections: true, particles: "high", animated: true, detailed: true },
  high: { reflections: true, particles: "high", animated: true, detailed: true },
  ultra: { reflections: true, particles: "high", animated: true, detailed: true },
};
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", bevel: [1, 2], texture: 64, sculpture: 0.5, segments: 0.5, motes: 0, sparks: 0.35 },
  balanced: { material: "standard", bevel: [2, 4], texture: 128, sculpture: 0.75, segments: 0.75, motes: 40, sparks: 0.7 },
  high: { material: "physical", bevel: [4, 6], texture: 256, sculpture: 1, segments: 1, motes: 70, sparks: 1 },
  ultra: { material: "physical", bevel: [5, 8], texture: 512, sculpture: 1.3, segments: 1.5, motes: 120, sparks: 1.5 },
};
const ANCHOR: Record<QualityTier, GraphicsLevel> = { low: "quantum", balanced: "molecular", high: "terrestrial", ultra: "galactic" };

export function lookFor(s: LevelSettings = levelSettings()): Look {
  const preset = s.quality;
  const k = Math.min(2, s.particles / levelSettings(ANCHOR[preset]).particles);
  const b = BUDGETS[preset];
  return {
    preset, ...ART[preset],
    shadows: s.shadows ? s.shadowMapSize : 0,
    ao: s.ao && { resolution: s.ao.resolution, samples: s.ao.samples, denoiseSamples: s.ao.denoiseSamples },
    bloom: s.bloom ? s.bloom.resolution : null,
    grade: s.grade,
    antialias: s.antialias,
    budget: { ...b, bevel: [...b.bevel] as [number, number], texture: Math.min(b.texture, s.maxTextureSize),
      sparks: Math.round(b.sparks * k * 100) / 100, motes: Math.round(b.motes * k) },
  };
}
