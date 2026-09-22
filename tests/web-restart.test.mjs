import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { findDshInstallation } from './fixtures/dsh-installation.mjs';

const exec = promisify(execFile);
const installation = await findDshInstallation();
const candidate = process.env.DSH_TEST_PACKAGE_ROOT ?? fileURLToPath(new URL('..', import.meta.url));

test('real DSH Web: a fresh process restores shipped cordis sessions and model pins', {
  skip: installation ? false : 'Install DSH or set DSH_TEST_INSTALL_ROOT to run the Web restart integration',
  timeout: 150000,
}, async () => {
  let output;
  try {
    output = await exec(process.execPath, [
      fileURLToPath(new URL('../scripts/verify-web-restart.mjs', import.meta.url)), installation, candidate,
    ], { timeout: 140000, maxBuffer: 8 * 1024 * 1024 });
  } catch (error) {
    assert.fail(`Real DSH Web restart failed:\n${error.stdout ?? ''}\n${error.stderr ?? error.message}`);
  }
  const phases = output.stdout.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line));
  assert.deepEqual(phases.map(({ phase, status }) => ({ phase, status })), [
    { phase: 'create', status: 'passed' }, { phase: 'resume', status: 'passed' },
  ]);
  assert.notEqual(phases[0].pid, phases[1].pid);
  assert.equal(phases[1].restoredMessages, 2);
  assert.ok(phases.every((phase) => phase.hostActive && phase.clientDiscovered && phase.shippedPreset === 'cordis'));
  assert.ok(phases.every((phase) => phase.failures.length === 0));
  assert.ok(phases.every((phase) => phase.requests.every((request) => request.promptMatchesRoute)));
});
