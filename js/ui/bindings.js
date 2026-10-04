// Control mappings. Keys are KeyboardEvent.code values, declared as
// control.* lines in starhermit.txt. Help cards are generated from the live
// bindings, and keyboard overrides (local rebinding UI, or the player's
// StarHermit bindings when signed in) are honored everywhere the action is
// used. Touch mappings remain responsive UI controls and are not remapped.

export const DEFAULT_BINDINGS = [
  { action: 'confirm', label: 'Release selected cube', keys: ['Enter', 'NumpadEnter'], gamepad: 'A / cross' },
  { action: 'cancel', label: 'Cancel / close dialog', keys: ['Escape'], gamepad: 'B / circle' },
  { action: 'pause', label: 'Pause', keys: ['KeyP'], gamepad: 'Start' },
  { action: 'navNext', label: 'Next legal target', keys: ['Tab', 'ArrowRight'], gamepad: 'D-pad right' },
  { action: 'navPrev', label: 'Previous legal target', keys: ['ArrowLeft'], gamepad: 'D-pad left' },
  { action: 'rotateLeft', label: 'Rotate assembly left', keys: ['KeyQ'], gamepad: 'Left shoulder' },
  { action: 'rotateRight', label: 'Rotate assembly right', keys: ['KeyE'], gamepad: 'Right shoulder' },
  { action: 'undo', label: 'Undo (practice)', keys: ['KeyU'], gamepad: 'X / square' },
  { action: 'hint', label: 'Hint', keys: ['KeyH'], gamepad: 'Y / triangle' },
  { action: 'camReset', label: 'Reset camera', keys: ['KeyR'], gamepad: 'Right stick press' },
];

/** { action: codes[] } defaults, the shape StarHermit.loadBindings expects. */
export function defaultCodes() {
  return Object.fromEntries(DEFAULT_BINDINGS.map((b) => [b.action, b.keys.slice()]));
}

export const GAMEPAD_BUTTONS = {
  confirm: 0,
  cancel: 1,
  undo: 2,
  hint: 3,
  rotateLeft: 4,
  rotateRight: 5,
  camReset: 11, // right-stick press
  pause: 9, // Start
  navPrev: 14,
  navNext: 15,
};

// Older saves stored KeyboardEvent.key values ('q', 'Space'); map them to codes.
export function toCode(k) {
  if (typeof k !== 'string' || !k) return null;
  if (/^[a-z]$/i.test(k)) return 'Key' + k.toUpperCase();
  if (/^[0-9]$/.test(k)) return 'Digit' + k;
  if (k === ' ') return 'Space';
  return k;
}

export function effectiveKeys(action, overrides = {}) {
  const def = DEFAULT_BINDINGS.find((b) => b.action === action);
  if (!def) return [];
  const ov = overrides[action];
  return Array.isArray(ov) && ov.length ? ov.map(toCode).filter(Boolean) : def.keys;
}

export function matchKey(event, action, overrides = {}) {
  const code = event.code;
  // Shift+Tab always steps backwards through targets (focus convention).
  if (code === 'Tab' && event.shiftKey) {
    return action === 'navPrev' ? effectiveKeys('navNext', overrides).includes('Tab') : false;
  }
  return effectiveKeys(action, overrides).includes(code);
}

const GLYPHS = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Escape: 'Esc', NumpadEnter: 'Num Enter' };
export function keyLabel(code) {
  if (GLYPHS[code]) return GLYPHS[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return code;
}

export function bindingLabel(action, overrides = {}) {
  const keys = effectiveKeys(action, overrides).map(keyLabel);
  if (action === 'navPrev' && effectiveKeys('navNext', overrides).includes('Tab')) keys.push('Shift+Tab');
  return keys.join(' / ');
}
