// Cloud-save merge: when the cloud copy and this device's copy have both
// moved on (boot load, or a write refused because another device saved
// first), progress from both sides is kept — never one side dropped.

const maxNum = (a, b) => Math.max(Number(a) || 0, Number(b) || 0);

function mergeMax(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = k in out ? maxNum(out[k], v) : v;
  return out;
}

/** Progression: best stars/scores per id, unions of lessons, best daily per day, larger totals. */
export function mergeProgression(remote = {}, local = {}) {
  const dailies = { ...(remote.dailies || {}) };
  for (const [day, d] of Object.entries(local.dailies || {})) {
    const o = dailies[day];
    if (!o) { dailies[day] = d; continue; }
    const better = (d.score ?? 0) > (o.score ?? 0) ? d : o;
    dailies[day] = { ...better, completed: !!(o.completed || d.completed) };
  }
  const tutorials = { ...(remote.tutorials || {}) };
  for (const [k, v] of Object.entries(local.tutorials || {})) tutorials[k] = !!(tutorials[k] || v);
  return {
    ...remote,
    ...local,
    journeyStars: mergeMax(remote.journeyStars, local.journeyStars),
    tutorials,
    totals: mergeMax(remote.totals, local.totals),
    dailies,
    challengeBest: mergeMax(remote.challengeBest, local.challengeBest),
    practiceBest: mergeMax(remote.practiceBest, local.practiceBest),
    levelBest: mergeMax(remote.levelBest, local.levelBest),
    theme: local.theme || remote.theme,
    lastSessionId: local.lastSessionId || remote.lastSessionId || null,
  };
}

/** Achievements: union, earliest unlock time kept. */
export function mergeAchievements(remote = {}, local = {}) {
  const out = { ...remote };
  for (const [k, v] of Object.entries(local)) {
    out[k] = k in out ? Math.min(Number(out[k]) || Infinity, Number(v) || Infinity) : v;
    if (out[k] === Infinity) out[k] = v;
  }
  return out;
}

/** Personal-record boards: union per board, one entry per session, best first, top 100. */
export function mergeBoards(remote = {}, local = {}) {
  const entries = {};
  const names = new Set([...Object.keys(remote.entries || {}), ...Object.keys(local.entries || {})]);
  for (const name of names) {
    const seen = new Set();
    entries[name] = [...(local.entries?.[name] || []), ...(remote.entries?.[name] || [])]
      .filter((e) => {
        const id = e.sessionId ?? JSON.stringify(e);
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .sort((a, b) => b.score - a.score || (a.invalid ?? 0) - (b.invalid ?? 0) || (a.elapsedMs ?? 0) - (b.elapsedMs ?? 0))
      .slice(0, 100);
  }
  return { ...remote, ...local, entries };
}
