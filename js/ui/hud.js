// Play HUD: objective, progress, remaining moves/time, live score preview,
// and only context-relevant actions (undo where the ruleset permits, hint
// where tools allow). Values are stored as integers and only formatted here.

import { remainingArrows } from '../rules/engine.js';

export function formatMs(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

function el(id) {
  return document.getElementById(id);
}

export function updateHUD(session, level, selectionText = '') {
  const state = session.state;
  const left = remainingArrows(state);
  el('stat-left').textContent = String(left);
  el('stat-taps').textContent = String(state.stats.taps);
  el('stat-rotations').textContent = String(state.stats.rotations);

  const hasMoves = state.limits.moves != null;
  const hasTime = state.limits.timeMs != null;
  el('row-moves').hidden = !hasMoves;
  el('row-time').hidden = !hasTime;
  el('hud-clock').hidden = !hasTime;
  if (hasMoves) {
    el('stat-moves').textContent = String(Math.max(0, state.limits.moves - state.stats.taps));
  }
  if (hasTime) updateClock(session);

  const objective = level.mechanics?.includes('core')
    ? 'Release every cube to expose the core'
    : 'Release every cube';
  el('objective-text').textContent = objective + '.';
  el('hud-objective').textContent = `${level.name} — ${left} left`;

  el('par-text').textContent =
    `Par: ${level.par.taps} taps · ${level.par.rotations} rotations · ${formatMs(level.par.timeMs)}`;
  el('tip-text').textContent = level.tip || '';

  // Live score preview (component breakdown, always visible).
  const score = session.score();
  const c = score.components;
  el('score-preview').innerHTML = '';
  const rows = [
    ['Released', c.release],
    ['Completion', c.completion],
    ['Tap efficiency', c.tapEfficiency],
    ['Rotation efficiency', c.rotationEfficiency],
    ['Time bonus', c.timeBonus],
    ['Invalid taps', -c.invalidPenalty],
  ];
  for (const [label, value] of rows) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<span></span><span></span>`;
    row.children[0].textContent = label;
    row.children[1].textContent = String(value);
    el('score-preview').appendChild(row);
  }
  const total = document.createElement('div');
  total.className = 'row total';
  total.innerHTML = '<span></span><span></span>';
  total.children[0].textContent = 'Total';
  total.children[1].textContent = String(score.total);
  el('score-preview').appendChild(total);

  // Context-relevant actions.
  const canUndo = session.allowUndo && session.history.length > 0 && !session.finished;
  const canHint = session.tools.hint && !session.finished;
  for (const id of ['btn-undo', 'tray-undo']) el(id).disabled = !canUndo;
  for (const id of ['btn-hint', 'tray-hint']) el(id).disabled = !canHint;

  if (selectionText) el('selection-info').textContent = selectionText;
}

export function updateClock(session) {
  const state = session.state;
  if (state.limits.timeMs == null) return;
  const remaining = Math.max(0, state.limits.timeMs - session.activeMs());
  const text = formatMs(remaining);
  el('stat-time').textContent = text;
  el('hud-clock').textContent = '⏱ ' + text;
  el('hud-clock').style.color = remaining < 15000 ? 'var(--danger)' : '';
}

export function setSelectionInfo(text) {
  el('selection-info').textContent = text;
}
