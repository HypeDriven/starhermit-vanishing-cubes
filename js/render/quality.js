// Graphics quality tiers. Tiers independently control shadows, environment
// detail, particles, antialiasing and render scale — never rules, and never
// the visibility of hazards or legal targets.

export const TIERS = {
  low: {
    label: 'Low',
    dprCap: 1,
    shadowMapSize: 0,
    particleMultiplier: 0.3,
    envDetail: 0.4,
    renderScale: 0.8,
    antialias: false,
  },
  medium: {
    label: 'Medium',
    dprCap: 1.5,
    shadowMapSize: 1024,
    particleMultiplier: 0.7,
    envDetail: 0.7,
    renderScale: 1,
    antialias: true,
  },
  high: {
    label: 'High',
    dprCap: 2,
    shadowMapSize: 2048,
    particleMultiplier: 1,
    envDetail: 1,
    renderScale: 1,
    antialias: true,
  },
};

export function detectTier() {
  try {
    const ua = navigator.userAgent || '';
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
    const mem = navigator.deviceMemory || 4;
    const cores = navigator.hardwareConcurrency || 4;
    if (mobile && (mem <= 3 || cores <= 4)) return 'low';
    if (mobile) return 'medium';
    if (mem >= 8 && cores >= 8) return 'high';
    return 'medium';
  } catch {
    return 'medium';
  }
}
