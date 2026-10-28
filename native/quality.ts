// The look per graphics level: the browser build's four presets and budgets
// (js/render/gfx.js TABLE / BUDGETS, each tuned for 60 FPS on the weakest GPU
// its Auto gave it) keyed by the runtime's quality tier (frame().quality),
// with the burst multiplier scaled within the tier by the level
// (frame().levelIndex, at most 2×) as gfx.js budget() did with the hardware
// level. The runtime owns what the old Graphics section did besides: Auto
// and the level choice, render scale and pixel-ratio cap, adaptive
// resolution, the frame-rate limit and readout. The old per-category
// overrides are not offered (the runtime's Options choose a level).
import type { QualityTier } from "starhermit:engine";

export interface Budget {
  material: "lambert" | "standard" | "physical"; bevel: [number, number]; texture: number; sculpture: number; segments: number;
  motes: number; sparks: number; bloomRes: number; aoRes: number;
}
export interface Look {
  preset: QualityTier; shadows: 0 | 1024 | 2048 | 4096; ao: "off" | "on" | "high"; bloom: boolean; grade: boolean;
  antialias: "off" | "fxaa" | "smaa" | "msaa"; reflections: boolean; particles: "low" | "high"; animated: boolean; detailed: boolean; budget: Budget;
}
const TABLE: Record<QualityTier, Omit<Look, "preset" | "budget">> = {
  low: { shadows: 0, ao: "off", bloom: false, grade: false, antialias: "off", reflections: false, particles: "low", animated: true, detailed: false },
  balanced: { shadows: 1024, ao: "off", bloom: true, grade: true, antialias: "fxaa", reflections: true, particles: "high", animated: true, detailed: true },
  high: { shadows: 2048, ao: "on", bloom: true, grade: true, antialias: "smaa", reflections: true, particles: "high", animated: true, detailed: true },
  ultra: { shadows: 4096, ao: "high", bloom: true, grade: true, antialias: "msaa", reflections: true, particles: "high", animated: true, detailed: true },
};
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", bevel: [1, 2], texture: 64, sculpture: 0.5, segments: 0.5, motes: 0, sparks: 0.35, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: "standard", bevel: [2, 4], texture: 128, sculpture: 0.75, segments: 0.75, motes: 40, sparks: 0.7, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: "physical", bevel: [4, 6], texture: 256, sculpture: 1, segments: 1, motes: 70, sparks: 1, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: "physical", bevel: [5, 8], texture: 512, sculpture: 1.3, segments: 1.5, motes: 120, sparks: 1.5, bloomRes: 1, aoRes: 1 },
};
const TIER_FLOOR: Record<QualityTier, number> = { low: 0, balanced: 4, high: 10, ultra: 17 };

export function lookFor(preset: QualityTier, levelIndex: number): Look {
  const b: Budget = { ...BUDGETS[preset], bevel: [...BUDGETS[preset].bevel] as [number, number] };
  const k = Math.min(2, Math.pow(1.4, Math.max(0, levelIndex - TIER_FLOOR[preset]) / 3));
  b.sparks = Math.round(b.sparks * k * 100) / 100;
  return { preset, ...TABLE[preset], budget: b };
}
