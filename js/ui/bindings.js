// Control mappings. Help cards are generated from the live bindings, and
// keyboard overrides are honored everywhere the action is used. Touch
// mappings remain responsive UI controls and are not remapped.

export const DEFAULT_BINDINGS = [
  { action: 'confirm', label: 'Release selected cube', keys: ['Enter'], gamepad: 'A / cross' },
  { action: 'cancel', label: 'Cancel / close dialog', keys: ['Escape'], gamepad: 'B / circle' },
  { action: 'pause', label: 'Pause', keys: ['p'], gamepad: 'Start' },
  { action: 'navNext', label: 'Next legal target', keys: ['Tab', 'ArrowRight'], gamepad: 'D-pad right' },
  { action: 'navPrev', label: 'Previous legal target', keys: ['Shift+Tab', 'ArrowLeft'], gamepad: 'D-pad left' },
  { action: 'rotateLeft', label: 'Rotate assembly left', keys: ['q'], gamepad: 'Left shoulder' },
  { action: 'rotateRight', label: 'Rotate assembly right', keys: ['e'], gamepad: 'Right shoulder' },
  { action: 'undo', label: 'Undo (practice)', keys: ['u'], gamepad: 'X / square' },
  { action: 'hint', label: 'Hint', keys: ['h'], gamepad: 'Y / triangle' },
  { action: 'camReset', label: 'Reset camera', keys: ['r'], gamepad: 'Right stick press' },
];

export const GAMEPAD_BUTTONS = {
  confirm: 0,
  cancel: 1,
  undo: 2,
  hint: 3,
  rotateLeft: 4,
  rotateRight: 5,
  camReset: 9,
  pause: 9 + 0, // Start is index 9; pause and camReset share? keep Start = pause
  navPrev: 14,
  navNext: 15,
};
// Start pauses; camera reset lives on right-stick press.
GAMEPAD_BUTTONS.camReset = 11;
GAMEPAD_BUTTONS.pause = 9;

export function effectiveKeys(action, overrides = {}) {
  const def = DEFAULT_BINDINGS.find((b) => b.action === action);
  if (!def) return [];
  const ov = overrides[action];
  return Array.isArray(ov) && ov.length ? ov : def.keys;
}

export function matchKey(event, action, overrides = {}) {
  const keys = effectiveKeys(action, overrides);
  const key = event.key;
  for (const k of keys) {
    if (k === 'Shift+Tab' && key === 'Tab' && event.shiftKey) return true;
    if (k === key) return true;
    if (k.length === 1 && key.toLowerCase() === k) return true;
  }
  if (keys.includes('Tab') && key === 'Tab' && !event.shiftKey) return true;
  return false;
}

export function bindingLabel(action, overrides = {}) {
  const keys = effectiveKeys(action, overrides);
  return keys.map((k) => (k === ' ' ? 'Space' : k)).join(' / ');
}
