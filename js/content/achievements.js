// Static achievement set. Keys are stable lowercase identifiers; unlocks are
// idempotent (evaluated against the already-unlocked set).

export const ACHIEVEMENTS = [
  {
    key: 'first-clear',
    name: 'First Light',
    desc: 'Complete your first stage.',
  },
  {
    key: 'key-master',
    name: 'Turning Every Key',
    desc: 'Complete 10 Journey stages that use locks.',
  },
  {
    key: 'daily-streak-3',
    name: 'Steady Hand',
    desc: 'Complete the Daily on 3 consecutive UTC days.',
  },
  {
    key: 'grand-work',
    name: 'Grand Work',
    desc: 'Complete the final Journey stage, Final Light.',
  },
  {
    key: 'thousand-cubes',
    name: 'Cube Miller',
    desc: 'Release 1,000 cubes in total.',
  },
];

// ctx: {
//   totals: {released},
//   completedLevelIds: Set,
//   lockLevelsCompleted: number,
//   dailyStreak: number,
// }
// unlocked: object map key -> unix ms. Returns newly unlocked achievement defs.
export function evaluateAchievements(ctx, unlocked) {
  const fresh = [];
  const grant = (key) => {
    if (!unlocked[key]) fresh.push(ACHIEVEMENTS.find((a) => a.key === key));
  };
  if (ctx.completedLevelIds.size > 0 || ctx.justCompleted) grant('first-clear');
  if (ctx.lockLevelsCompleted >= 10) grant('key-master');
  if (ctx.dailyStreak >= 3) grant('daily-streak-3');
  if (ctx.completedLevelIds.has('j40')) grant('grand-work');
  if (ctx.totals.released >= 1000) grant('thousand-cubes');
  return fresh;
}
