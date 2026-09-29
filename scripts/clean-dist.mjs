import assert from 'node:assert/strict';
import { realpath, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Only erase this checkout's generated directory, never a redirected symlink.
const target = fileURLToPath(new URL('../dist', import.meta.url));
let resolved;
try { resolved = await realpath(target); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (resolved !== undefined) {
  assert.equal(resolved, target, 'refuse to clean a redirected dist directory');
  await rm(target, { recursive: true, force: true });
}
