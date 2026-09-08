import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'vanishing-cubes-test-'));
process.env.VANISHING_CUBES_DATA_DIR = dir;
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
export const { startServer } = await import('../server.js');
