// Challenge mode: constrained goals — exact move limits, speed targets,
// altered layouts. All challenges are ranked (no undo, no hints).

export const CHALLENGES = [
  {
    id: 'ch-exact-1',
    name: 'Exact Measure',
    blurb: 'No wasted taps. The move limit equals the cube count.',
    def: { id: 'ch-exact-1', seed: 6101, size: 3, shape: 'solid', name: 'Exact Measure', theme: 'dawn' },
    limitKind: 'exact-moves',
    ranked: true,
  },
  {
    id: 'ch-exact-2',
    name: 'Exact Measure II',
    blurb: 'A hollow work with a stone, and not one tap to spare.',
    def: { id: 'ch-exact-2', seed: 6102, size: 3, shape: 'hollow', stones: 1, name: 'Exact Measure II', theme: 'verdant', mechanics: ['stone'] },
    limitKind: 'exact-moves',
    ranked: true,
  },
  {
    id: 'ch-speed-1',
    name: 'Ninety Seconds',
    blurb: 'Clear the assembly before the sky dims.',
    def: { id: 'ch-speed-1', seed: 6103, size: 3, shape: 'solid', name: 'Ninety Seconds', theme: 'ember' },
    limitKind: 'time',
    timeMs: 90000,
    ranked: true,
  },
  {
    id: 'ch-speed-2',
    name: 'Two Minutes, Grand',
    blurb: 'A larger work, a longer fuse.',
    def: { id: 'ch-speed-2', seed: 6104, size: 4, shape: 'solid', stones: 2, locks: 1, name: 'Two Minutes, Grand', theme: 'ember', mechanics: ['stone', 'lock'] },
    limitKind: 'time',
    timeMs: 120000,
    ranked: true,
  },
  {
    id: 'ch-sparse-1',
    name: 'Thin Air',
    blurb: 'A scattered altered layout — read the gaps.',
    def: { id: 'ch-sparse-1', seed: 6105, size: 4, shape: 'scatter', density: 0.5, name: 'Thin Air', theme: 'midnight' },
    limitKind: 'exact-moves',
    ranked: true,
  },
  {
    id: 'ch-core-1',
    name: 'Core Exposure',
    blurb: 'Expose the core before time runs out.',
    def: { id: 'ch-core-1', seed: 6107, size: 4, shape: 'solid', density: 0.9, stones: 4, locks: 2, core: true, name: 'Core Exposure', theme: 'midnight', mechanics: ['stone', 'lock', 'core'] },
    limitKind: 'time',
    timeMs: 150000,
    ranked: true,
  },
  {
    id: 'ch-grand-1',
    name: 'Grand Constraint',
    blurb: 'A deep hollow work with two taps of slack.',
    def: { id: 'ch-grand-1', seed: 6108, size: 4, shape: 'hollow', stones: 3, locks: 2, name: 'Grand Constraint', theme: 'mono', mechanics: ['stone', 'lock'] },
    limitKind: 'slack-moves',
    slack: 2,
    ranked: true,
  },
  {
    id: 'ch-blind-1',
    name: 'No Instruments',
    blurb: 'No hints, no undo, and a strict count.',
    def: { id: 'ch-blind-1', seed: 6106, size: 3, shape: 'solid', stones: 1, locks: 1, name: 'No Instruments', theme: 'verdant', mechanics: ['stone', 'lock'] },
    limitKind: 'slack-moves',
    slack: 1,
    ranked: true,
  },
];

// Compute concrete engine limits for a challenge given its generated level.
export function challengeLimits(challenge, level) {
  const arrows = level.cubes.filter((c) => c.kind === 'arrow').length;
  switch (challenge.limitKind) {
    case 'exact-moves':
      return { moves: arrows };
    case 'slack-moves':
      return { moves: arrows + (challenge.slack || 0) };
    case 'time':
      return { timeMs: challenge.timeMs };
    default:
      return {};
  }
}
