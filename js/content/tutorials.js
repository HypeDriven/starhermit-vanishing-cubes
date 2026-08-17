// Learn mode: interactive lessons that introduce one rule at a time and
// require the player to perform the action. Steps are verified against the
// same legal-action API used by play.

const cube = (id, x, y, z, dir, kind = 'arrow', lock = null) => ({
  id, pos: [x, y, z], dir, kind, lock,
});

export const LESSONS = [
  {
    id: 't1',
    name: 'Release',
    goal: 'Release every cube.',
    board: {
      id: 'lesson-t1', version: 1, name: 'Release', seed: 'lesson-t1', theme: 'dawn',
      mechanics: [],
      cubes: [
        cube('c0', -1, 0, 0, 0),
        cube('c1', 0, 0, 0, 0),
        cube('c2', 1, 0, 0, 0),
      ],
      par: { taps: 4, rotations: 2, timeMs: 30000 },
    },
    steps: [
      {
        text: 'Each cube has an arrow. If its path to the sky is clear, tapping releases it. Release the highlighted cube.',
        focus: 'c2',
        require: { type: 'release', cubeId: 'c2' },
      },
      {
        text: 'The path ahead of the next cube is now open. Release it.',
        focus: 'c1',
        require: { type: 'release', cubeId: 'c1' },
      },
      {
        text: 'One more. Clear the board to finish the lesson.',
        focus: 'c0',
        require: { type: 'release', cubeId: 'c0' },
      },
    ],
  },
  {
    id: 't2',
    name: 'Blocked paths',
    goal: 'Learn why some cubes cannot leave yet.',
    board: {
      id: 'lesson-t2', version: 1, name: 'Blocked paths', seed: 'lesson-t2', theme: 'dawn',
      mechanics: [],
      cubes: [
        cube('c0', 0, 0, 0, 0),
        cube('c1', 1, 0, 0, 0),
      ],
      par: { taps: 4, rotations: 2, timeMs: 30000 },
    },
    steps: [
      {
        text: 'The left cube points east, but another cube sits in its way. Try tapping it — the game will explain why it cannot move.',
        focus: 'c0',
        require: { type: 'invalid', cubeId: 'c0', reason: 'blocked' },
      },
      {
        text: 'Blocked cubes become free once the cubes in front of them leave. Release the right cube first.',
        focus: 'c1',
        require: { type: 'release', cubeId: 'c1' },
      },
      {
        text: 'Now the path is clear. Finish the board.',
        focus: 'c0',
        require: { type: 'release', cubeId: 'c0' },
      },
    ],
  },
  {
    id: 't3',
    name: 'Turn to see',
    goal: 'Rotate the assembly to read every arrow.',
    board: {
      id: 'lesson-t3', version: 1, name: 'Turn to see', seed: 'lesson-t3', theme: 'dawn',
      mechanics: [],
      cubes: [
        cube('c0', 0, 0, 0, 5), // points away from the default camera
        cube('c1', 1, 0, 0, 0),
        cube('c2', 0, 1, 0, 2),
        cube('c3', 1, 1, 0, 2),
      ],
      par: { taps: 5, rotations: 3, timeMs: 45000 },
    },
    steps: [
      {
        text: 'Some arrows face away from you. Rotate the assembly: drag on empty sky, or press Q / E.',
        require: { type: 'rotate' },
      },
      {
        text: 'Better. Rotations are counted, and staying under par earns a star. Now clear the board in any order.',
        require: { type: 'complete' },
      },
    ],
  },
  {
    id: 't4',
    name: 'Quiet stones',
    goal: 'Stones never move.',
    board: {
      id: 'lesson-t4', version: 1, name: 'Quiet stones', seed: 'lesson-t4', theme: 'verdant',
      mechanics: ['stone'],
      cubes: [
        cube('s0', 0, 0, 0, 2, 'stone'),
        cube('c1', 1, 0, 0, 0),
        cube('c2', -1, 0, 0, 1),
        cube('c3', 0, 1, 0, 2),
        cube('c4', 0, -1, 0, 3),
      ],
      par: { taps: 6, rotations: 3, timeMs: 45000 },
    },
    steps: [
      {
        text: 'The grey cube is stone. It has no arrow and can never leave. Try it to see the explanation.',
        focus: 's0',
        require: { type: 'invalid', cubeId: 's0', reason: 'stone' },
      },
      {
        text: 'Every arrow here points past the stone into open sky. Clear the board.',
        require: { type: 'complete' },
      },
    ],
  },
  {
    id: 't5',
    name: 'Turning keys',
    goal: 'Unlock banded cubes by releasing their key.',
    board: {
      id: 'lesson-t5', version: 1, name: 'Turning keys', seed: 'lesson-t5', theme: 'ember',
      mechanics: ['lock'],
      cubes: [
        cube('key1', 1, 0, 0, 0),
        cube('locked1', 0, 0, 0, 1, 'arrow', { keyId: 'key1' }),
        cube('c2', -1, 0, 0, 1),
      ],
      par: { taps: 5, rotations: 3, timeMs: 45000 },
    },
    steps: [
      {
        text: 'The banded cube is locked. Try to release it.',
        focus: 'locked1',
        require: { type: 'invalid', cubeId: 'locked1', reason: 'locked' },
      },
      {
        text: 'Its key is the glowing cube. Release the key to open the lock.',
        focus: 'key1',
        require: { type: 'release', cubeId: 'key1' },
      },
      {
        text: 'Unlocked. Clear the board to finish.',
        require: { type: 'complete' },
      },
    ],
  },
  {
    id: 't6',
    name: 'Under par',
    goal: 'Score by finishing under par taps and rotations.',
    board: {
      id: 'lesson-t6', version: 1, name: 'Under par', seed: 'lesson-t6', theme: 'dawn',
      mechanics: [],
      cubes: [
        cube('c0', 0, 0, 0, 2),
        cube('c1', 1, 0, 0, 0),
        cube('c2', 0, 1, 0, 2),
        cube('c3', 1, 1, 0, 2),
      ],
      par: { taps: 4, rotations: 2, timeMs: 40000 },
    },
    steps: [
      {
        text: 'Every board has pars for taps and rotations. Finishing under par earns stars and efficiency bonuses — wasted taps and spins cost them. Clear the board.',
        require: { type: 'complete' },
      },
    ],
  },
];

export function lessonById(id) {
  return LESSONS.find((l) => l.id === id) || null;
}
