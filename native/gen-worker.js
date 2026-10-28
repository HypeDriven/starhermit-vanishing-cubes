// Board generation off the game's thread (starhermit:script worker, a module):
// js/rules/generator.js generateLevel, unchanged. In: { id, def }. Out: { id, level }.
import { generateLevel } from '../js/rules/generator.js';

globalThis.onmessage = (e) => {
  const d = e.data;
  let level = null;
  try { level = generateLevel(d.def); } catch { level = null; }
  postMessage({ id: d.id, level });
};
