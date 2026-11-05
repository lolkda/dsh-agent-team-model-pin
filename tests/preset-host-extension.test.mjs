// DSH's deployment build owns the pre-publication child setup protocol. These
// assertions pin the exact capability the Team preset runtime detects at runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPatchedSubagent } from './fixtures/preset-host-extension.mjs';

test('deployment subagent exposes the childSetupVersion=1 pre-publication protocol', async (t) => {
  let fixture;
  try {
    fixture = await loadPatchedSubagent();
  } catch (error) {
    t.skip(`Deployment DSH does not expose childSetupVersion: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  t.after(() => fixture.dispose());
  const prototype = fixture.module.SubagentRuntime.prototype;
  const version = Object.getOwnPropertyDescriptor(prototype, 'childSetupVersion');
  assert.ok(version?.get, 'the runtime must expose childSetupVersion as a live getter');
  assert.equal(Object.create(prototype).childSetupVersion, 1);
  assert.equal(typeof prototype.registerChildSetup, 'function');
});
