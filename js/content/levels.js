// Journey: 40 authored stages in five chapters. Authored as versioned data —
// identifier, fixed seed, initial-state generator parameters, goals, allowed
// mechanics, par values, tutorial flags, and presentation theme. Boards are
// produced (and proven solvable) by the seeded generator; seeds are immutable
// after publication.

export const CHAPTERS = [
  { id: 1, name: 'First Light', blurb: 'Learn to read the assembly.' },
  { id: 2, name: 'Quiet Stones', blurb: 'Stones never move. Route around them.' },
  { id: 3, name: 'Turning Keys', blurb: 'Locked cubes open when their key is released.' },
  { id: 4, name: 'Open Air', blurb: 'Sparse sculptures in a wider sky.' },
  { id: 5, name: 'Grand Works', blurb: 'Everything, at once, at scale.' },
];

const L = (id, name, chapter, seed, gen, extra = {}) => ({
  id,
  version: 1,
  name,
  chapter,
  seed,
  theme: ['dawn', 'verdant', 'ember', 'midnight', 'mono'][chapter - 1],
  mechanics: extra.mechanics || [],
  mastery: !!extra.mastery,
  tip: extra.tip || '',
  parScale: extra.parScale,
  parRotations: extra.parRotations,
  ...gen,
});

export const LEVEL_DEFS = [
  // Chapter 1 — First Light
  L('j01', 'First Step', 1, 1101, { size: 2, shape: 'solid' }, {
    tip: 'Tap a cube whose arrow points into open sky.',
  }),
  L('j02', 'Turn Around', 1, 1102, { size: 2, shape: 'solid' }, {
    tip: 'Drag or press Q/E to rotate the assembly and find clear paths.',
  }),
  L('j03', 'Little Hollow', 1, 1103, { size: 3, shape: 'hollow' }),
  L('j04', 'Crossing', 1, 1104, { size: 3, shape: 'cross' }),
  L('j05', 'The Wall', 1, 1105, { size: 3, shape: 'wall' }),
  L('j06', 'Columns', 1, 1106, { size: 3, shape: 'columns' }),
  L('j07', 'Full House', 1, 1107, { size: 3, shape: 'solid' }),
  L('j08', 'Mastery: First Light', 1, 1108, { size: 3, shape: 'solid', density: 0.9 }, {
    mastery: true,
    tip: 'Clear the board under par taps and rotations for three stars.',
  }),

  // Chapter 2 — Quiet Stones
  L('j09', 'One Stone', 2, 1201, { size: 3, shape: 'solid', stones: 1 }, {
    mechanics: ['stone'],
    tip: 'Grey stone cubes can never be released.',
  }),
  L('j10', 'Pebble Ring', 2, 1202, { size: 3, shape: 'ring', stones: 1 }, { mechanics: ['stone'] }),
  L('j11', 'Heart of Stone', 2, 1203, { size: 3, shape: 'solid', stones: 2, core: true }, {
    mechanics: ['stone', 'core'],
    tip: 'Expose the golden core by clearing everything around it.',
  }),
  L('j12', 'Stepping Stones', 2, 1204, { size: 3, shape: 'columns', stones: 2 }, {
    mechanics: ['stone'],
  }),
  L('j13', 'Hollow Core', 2, 1205, { size: 3, shape: 'hollow', stones: 1, core: true }, {
    mechanics: ['stone', 'core'],
  }),
  L('j14', 'Pyramid Scheme', 2, 1206, { size: 3, shape: 'pyramid', stones: 2 }, {
    mechanics: ['stone'],
  }),
  L('j15', 'Quarry', 2, 1207, { size: 4, shape: 'solid', stones: 3, density: 0.8 }, {
    mechanics: ['stone'],
  }),
  L('j16', 'Mastery: Quiet Stones', 2, 1208, { size: 4, shape: 'solid', stones: 4, density: 0.85 }, {
    mechanics: ['stone'],
    mastery: true,
  }),

  // Chapter 3 — Turning Keys
  L('j17', 'First Key', 3, 1301, { size: 3, shape: 'solid', locks: 1 }, {
    mechanics: ['lock'],
    tip: 'A banded cube is locked. Release its glowing key cube first.',
  }),
  L('j18', 'Two Turns', 3, 1302, { size: 3, shape: 'solid', locks: 2 }, { mechanics: ['lock'] }),
  L('j19', 'Locked Ring', 3, 1303, { size: 3, shape: 'ring', locks: 1 }, { mechanics: ['lock'] }),
  L('j20', 'Stone and Key', 3, 1304, { size: 3, shape: 'solid', stones: 2, locks: 1 }, {
    mechanics: ['stone', 'lock'],
  }),
  L('j21', 'Keyhole Columns', 3, 1305, { size: 3, shape: 'columns', stones: 1, locks: 2 }, {
    mechanics: ['stone', 'lock'],
  }),
  L('j22', 'Triple Turn', 3, 1306, { size: 4, shape: 'hollow', locks: 3 }, { mechanics: ['lock'] }),
  L('j23', 'The Vault', 3, 1307, { size: 4, shape: 'solid', stones: 2, locks: 3, core: true, density: 0.85 }, {
    mechanics: ['stone', 'lock', 'core'],
  }),
  L('j24', 'Mastery: Turning Keys', 3, 1308, { size: 4, shape: 'solid', stones: 2, locks: 4, density: 0.85 }, {
    mechanics: ['stone', 'lock'],
    mastery: true,
  }),

  // Chapter 4 — Open Air
  L('j25', 'Drift', 4, 1401, { size: 4, shape: 'scatter', density: 0.55 }),
  L('j26', 'Sparse Steps', 4, 1402, { size: 4, shape: 'pyramid' }),
  L('j27', 'Wide Wall', 4, 1403, { size: 4, shape: 'wall' }),
  L('j28', 'Floating Ring', 4, 1404, { size: 5, shape: 'ring' }),
  L('j29', 'Open Stones', 4, 1405, { size: 4, shape: 'scatter', density: 0.6, stones: 3 }, {
    mechanics: ['stone'],
  }),
  L('j30', 'Keyed Drift', 4, 1406, { size: 4, shape: 'scatter', density: 0.6, locks: 2 }, {
    mechanics: ['lock'],
  }),
  L('j31', 'Sculpture Garden', 4, 1407, { size: 4, shape: 'columns', stones: 2, locks: 2 }, {
    mechanics: ['stone', 'lock'],
  }),
  L('j32', 'Mastery: Open Air', 4, 1408, { size: 4, shape: 'scatter', density: 0.7, stones: 3, locks: 3, core: true }, {
    mechanics: ['stone', 'lock', 'core'],
    mastery: true,
  }),

  // Chapter 5 — Grand Works
  L('j33', 'Grand Solid', 5, 1501, { size: 4, shape: 'solid', stones: 3, locks: 2 }, {
    mechanics: ['stone', 'lock'],
  }),
  L('j34', 'Deep Hollow', 5, 1502, { size: 5, shape: 'hollow', stones: 4, locks: 2 }, {
    mechanics: ['stone', 'lock'],
  }),
  L('j35', 'Mastery: Grand Works I', 5, 1503, { size: 5, shape: 'hollow', stones: 4, locks: 3, core: true }, {
    mechanics: ['stone', 'lock', 'core'],
    mastery: true,
  }),
  L('j36', 'Grand Cross', 5, 1504, { size: 5, shape: 'cross', stones: 2, locks: 2 }, {
    mechanics: ['stone', 'lock'],
  }),
  L('j37', 'High Columns', 5, 1505, { size: 5, shape: 'columns', stones: 3, locks: 3 }, {
    mechanics: ['stone', 'lock'],
  }),
  L('j38', 'Grand Pyramid', 5, 1506, { size: 5, shape: 'pyramid', stones: 3, locks: 2 }, {
    mechanics: ['stone', 'lock'],
  }),
  L('j39', 'The Impossible', 5, 1507, { size: 5, shape: 'scatter', density: 0.5, stones: 4, locks: 4 }, {
    mechanics: ['stone', 'lock'],
    parScale: 1.15,
  }),
  L('j40', 'Final Light', 5, 1508, { size: 5, shape: 'solid', stones: 6, locks: 4, core: true }, {
    mechanics: ['stone', 'lock', 'core'],
    mastery: true,
    parScale: 1.2,
    tip: 'The grand work. Take it apart, cube by cube.',
  }),
];

// Practice difficulty presets — selectable difficulty, no competitive effect.
export const PRACTICE_DEFS = {
  easy: { id: 'practice-easy', name: 'Easy practice', size: 2, shape: 'solid', seedSalt: 'p-easy' },
  medium: {
    id: 'practice-medium', name: 'Medium practice', size: 3, shape: 'solid',
    stones: 1, locks: 1, seedSalt: 'p-medium', mechanics: ['stone', 'lock'],
  },
  hard: {
    id: 'practice-hard', name: 'Hard practice', size: 4, shape: 'solid', density: 0.9,
    stones: 3, locks: 2, core: true, seedSalt: 'p-hard', mechanics: ['stone', 'lock', 'core'],
  },
};

// Daily ruleset — one shared seed per UTC day, immutable after publication.
export function dailyDef(dateKey) {
  // dateKey: YYYY-MM-DD (UTC). Deterministic pick of shape family by date.
  const dayNum = Number(dateKey.replaceAll('-', ''));
  const shapes = ['solid', 'hollow', 'columns', 'scatter', 'pyramid'];
  const shape = shapes[dayNum % shapes.length];
  return {
    id: 'daily-' + dateKey,
    version: 1,
    name: 'Daily — ' + dateKey,
    chapter: 0,
    seed: 'daily:' + dateKey,
    theme: ['dawn', 'verdant', 'ember', 'midnight', 'mono'][dayNum % 5],
    mechanics: ['stone', 'lock'],
    tip: 'One shared board for everyone, today only.',
    size: 3 + (dayNum % 2), // 3 or 4
    shape,
    density: shape === 'scatter' ? 0.7 : 1,
    stones: 2,
    locks: 2,
    core: dayNum % 3 === 0,
  };
}
