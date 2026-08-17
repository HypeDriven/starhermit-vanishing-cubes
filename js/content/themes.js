// Five original visual themes. Cosmetics only — never hitboxes, timing,
// information, or power. Unlocked through progression stars.

export const THEMES = [
  {
    id: 'dawn',
    name: 'Pale Dawn',
    unlockStars: 0,
    sky: { top: 0xbcd3e8, horizon: 0xf4efe4, fog: 0xdfe7ee, fogDensity: 0.011 },
    light: { key: 0xfff2dd, keyIntensity: 2.6, hemiSky: 0xcfe0f2, hemiGround: 0x9a8f80, hemiIntensity: 0.9 },
    env: { structure: 0xa9bcc9, accent: 0x7d9bb4 },
    cube: {
      arrow: 0xf6f8fa, stone: 0x8d939c, core: 0xffb63d, chevron: 0x2e3d55,
      hover: 0xd8e8ff, select: 0x9cc4ff, invalid: 0xe8b4b4, locked: 0x6f7683,
      path: 0x3f8cff,
    },
    ui: { accent: '#2f6fed' },
  },
  {
    id: 'verdant',
    name: 'Verdant Drift',
    unlockStars: 10,
    sky: { top: 0xa8cfc0, horizon: 0xeff2df, fog: 0xd6e6d8, fogDensity: 0.012 },
    light: { key: 0xfdf6d8, keyIntensity: 2.5, hemiSky: 0xc8e4cf, hemiGround: 0x7d8a72, hemiIntensity: 0.9 },
    env: { structure: 0xa3bda6, accent: 0x6f9a7e },
    cube: {
      arrow: 0xf4f8ef, stone: 0x87927f, core: 0xffc44d, chevron: 0x274035,
      hover: 0xd9f2d0, select: 0xa8e0a2, invalid: 0xe8b4b4, locked: 0x6d7a68,
      path: 0x2f9e5f,
    },
    ui: { accent: '#2e7d4f' },
  },
  {
    id: 'ember',
    name: 'Ember Dusk',
    unlockStars: 25,
    sky: { top: 0x69507a, horizon: 0xf2b880, fog: 0xc9987f, fogDensity: 0.010 },
    light: { key: 0xffd9a8, keyIntensity: 2.8, hemiSky: 0xd9a08c, hemiGround: 0x5c4a52, hemiIntensity: 0.85 },
    env: { structure: 0x745e6c, accent: 0xb2703f },
    cube: {
      arrow: 0xf7efe6, stone: 0x74604f, core: 0xffd24d, chevron: 0x4a2e35,
      hover: 0xffe2b8, select: 0xffc47e, invalid: 0xd98f8f, locked: 0x5f5360,
      path: 0xff8c42,
    },
    ui: { accent: '#c2571f' },
  },
  {
    id: 'midnight',
    name: 'Midnight Tide',
    unlockStars: 45,
    sky: { top: 0x131c33, horizon: 0x37507a, fog: 0x22314e, fogDensity: 0.013 },
    light: { key: 0xbdd2ff, keyIntensity: 2.2, hemiSky: 0x3a5070, hemiGround: 0x141a26, hemiIntensity: 0.8 },
    env: { structure: 0x35486b, accent: 0x5d82b5 },
    cube: {
      arrow: 0xdde7f4, stone: 0x55627a, core: 0x7de3ff, chevron: 0x1b2a44,
      hover: 0xa9c8ef, select: 0x7fa9e8, invalid: 0xb06a6a, locked: 0x46536e,
      path: 0x6fb7ff,
    },
    ui: { accent: '#6fa8ff' },
  },
  {
    id: 'mono',
    name: 'Paper Mono',
    unlockStars: 70,
    sky: { top: 0xd8d8d8, horizon: 0xf2f2f2, fog: 0xe2e2e2, fogDensity: 0.011 },
    light: { key: 0xffffff, keyIntensity: 2.4, hemiSky: 0xe0e0e0, hemiGround: 0x707070, hemiIntensity: 0.95 },
    env: { structure: 0x9a9a9a, accent: 0x6f6f6f },
    cube: {
      arrow: 0xfafafa, stone: 0x6e6e6e, core: 0x2b2b2b, chevron: 0x1a1a1a,
      hover: 0xd0d0d0, select: 0xa8a8a8, invalid: 0x8f8f8f, locked: 0x4a4a4a,
      path: 0x333333,
    },
    ui: { accent: '#222222' },
  },
];

export function themeById(id) {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

export function unlockedThemes(totalStars) {
  return THEMES.filter((t) => totalStars >= t.unlockStars);
}
