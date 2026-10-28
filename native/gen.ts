// Practice and Daily boards are generated on a starhermit:script worker
// (native/gen-worker.js): js/rules/generator.js takes up to ~0.4 s natively
// for a hard board, so main.ts shows "Preparing the board…" after 300 ms and
// the frame never stalls. Without a worker the generator runs on the game's
// thread as the browser build's did.
import { worker, type Worker } from "starhermit:script";
import { generateLevel, type Level, type LevelDef } from "./game.ts";

let w: Worker | null = null;
let failed = false;
let nextId = 1;
let waiting: { id: number; done: (l: Level | null) => void } | null = null;
function ensure(): Worker | null {
  if (w || failed) return w;
  try {
    w = worker("native/gen-worker.js", { type: "module" });
    w.on("message", (m) => {
      const r = m as unknown as { id: number; level: Level | null };
      if (!waiting || waiting.id !== r.id) return;
      const job = waiting;
      waiting = null;
      job.done(r.level);
    });
    w.on("error", (msg) => { if (!/not responding/i.test(msg)) console.warn(`gen worker: ${msg}`); });
    w.on("stopped", () => { failed = true; w = null; const job = waiting; waiting = null; if (job) job.done(null); });
  } catch (e) { console.warn(`gen worker: ${String(e)}`); failed = true; w = null; }
  return w;
}
export function warm(): void { ensure(); }
export function cancel(): void { waiting = null; }
export function busy(): boolean { return !!waiting; }
export function request(def: LevelDef, done: (l: Level | null) => void): void {
  const sync = (): void => { let l: Level | null = null; try { l = generateLevel(def); } catch { l = null; } done(l); };
  const wk = ensure();
  if (!wk) { sync(); return; }
  const id = nextId++;
  waiting = { id, done };
  try { wk.post({ id, def: JSON.parse(JSON.stringify(def)) }); }
  catch (e) { waiting = null; console.warn(`gen worker: ${String(e)}`); sync(); }
}
