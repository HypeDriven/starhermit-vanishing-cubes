// Accessibility layer: live announcements, toasts, focus management for
// modals, body-level presentation classes, the DOM board mirror (a concise
// navigable model of the Three.js board — not a description of decorative
// objects), and CVD-safe palette adjustment of theme colors.

import { DIR_NAMES } from '../rules/engine.js';

const liveEl = () => document.getElementById('sr-live');
const assertiveEl = () => document.getElementById('sr-assertive');

export function announce(message, assertive = false) {
  const el = assertive ? assertiveEl() : liveEl();
  if (!el) return;
  el.textContent = '';
  // Force re-announcement of identical consecutive messages.
  requestAnimationFrame(() => {
    el.textContent = message;
  });
}

export function toast(message, { assertive = false, ms = 2600 } = {}) {
  const region = document.getElementById('toast-region');
  if (region) {
    const div = document.createElement('div');
    div.className = 'toast';
    div.textContent = message;
    region.appendChild(div);
    setTimeout(() => div.remove(), ms);
  }
  announce(message, assertive);
}

// ---------- body presentation classes ----------

export function applyA11yClasses(settings) {
  const b = document.body;
  const a = settings.accessibility;
  b.classList.toggle('reduced-motion', !!a.reducedMotion);
  b.classList.toggle('high-contrast', !!a.highContrast);
  b.classList.toggle('large-text', !!a.largeText);
  b.classList.toggle('left-handed', !!a.leftHanded);
}

// ---------- CVD-safe palette adjustment ----------

// Okabe-Ito colors: safe across common color-vision deficiencies. Selection
// is always reinforced by shape (outline + lift + ring), color is never the
// only channel.
const CVD_SAFE = {
  select: 0x56b4e9, // sky blue
  hover: 0xbfe3ff,
  path: 0x0072b2, // blue
  core: 0xe69f00, // orange
  invalid: 0xd55e00, // vermillion
};

export function paletteAdjust(theme, palette) {
  if (palette === 'default' || !palette) return theme;
  const adjusted = structuredClone(theme);
  Object.assign(adjusted.cube, CVD_SAFE);
  return adjusted;
}

// ---------- modal focus management ----------

const modalStack = [];

export function openModal(el) {
  const previouslyFocused = document.activeElement;
  modalStack.push({ el, previouslyFocused });
  el.hidden = false;
  document.body.classList.add('modal-open');
  const focusables = el.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );
  if (focusables.length) focusables[0].focus();
  el.addEventListener('keydown', trapKeys);
}

export function closeModal(el) {
  const index = modalStack.findIndex((m) => m.el === el);
  if (index === -1) {
    el.hidden = true;
    return;
  }
  const [entry] = modalStack.splice(index, 1);
  el.hidden = true;
  el.removeEventListener('keydown', trapKeys);
  if (!modalStack.length) document.body.classList.remove('modal-open');
  const prev = entry.previouslyFocused;
  if (prev && typeof prev.focus === 'function') prev.focus();
}

export function isModalOpen(el) {
  return modalStack.some((m) => m.el === el);
}

function trapKeys(event) {
  if (event.key !== 'Tab') return;
  const el = event.currentTarget;
  const focusables = [...el.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  )].filter((n) => !n.disabled);
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

// ---------- DOM board mirror ----------

const KIND_LABEL = { arrow: 'Cube', stone: 'Stone', core: 'Core' };

export function buildBoardList(listEl, state, legalIds, onRelease) {
  listEl.textContent = '';
  const arrows = state.cubes.filter((c) => c.kind === 'arrow');
  const others = state.cubes.filter((c) => c.kind !== 'arrow');
  const describe = (c) => {
    const [x, y, z] = c.pos;
    return `${KIND_LABEL[c.kind]} ${c.id} at (${x}, ${y}, ${z}), facing ${DIR_NAMES[c.dir]}`;
  };
  for (const c of arrows) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    const clear = legalIds.has(c.id);
    const locked = c.lock && !c.lock.open;
    const status = clear ? 'clear' : locked ? `locked (key ${c.lock.keyId})` : 'blocked';
    btn.innerHTML = '';
    const name = document.createElement('span');
    name.textContent = describe(c);
    const tag = document.createElement('span');
    tag.className = 'tag ' + (clear ? 'clear' : 'blocked');
    tag.textContent = status;
    btn.append(name, tag);
    btn.disabled = !clear;
    btn.setAttribute(
      'aria-label',
      `${describe(c)} — ${status}${clear ? '. Activate to release.' : ''}`,
    );
    if (clear) btn.addEventListener('click', () => onRelease(c.id));
    li.appendChild(btn);
    listEl.appendChild(li);
  }
  for (const c of others) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    btn.disabled = true;
    const name = document.createElement('span');
    name.textContent = describe(c);
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = c.kind === 'stone' ? 'immovable' : 'expose me';
    btn.append(name, tag);
    li.appendChild(btn);
    listEl.appendChild(li);
  }
}
