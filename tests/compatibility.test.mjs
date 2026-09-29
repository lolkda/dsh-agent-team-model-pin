import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { findDshInstallation } from './fixtures/dsh-installation.mjs';

const installation = await findDshInstallation();
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Fails if a runtime-version bound is reintroduced. Use DSH's actual checker,
// including its prerelease policy, not a local imitation of semver acceptance.
test('compatibility: DSH accepts the bundle without exact-version exemptions', {
  skip: installation ? false : 'Install DSH or set DSH_TEST_INSTALL_ROOT for the real compatibility checker',
}, async () => {
  const { evaluatePluginCompatibility } = await import(pathToFileURL(join(
    installation, 'node_modules/@deepseek-ai/dsh-app-boot/lib/index.js',
  )).href);
  for (const version of ['0.1.7-rc.1', '0.2.0-rc.2', '0.2.0', '0.2.1-rc.1', '1.0.0']) {
    assert.equal(evaluatePluginCompatibility(pkg, {}, version), undefined,
      `DSH ${version} must not be rejected merely by its version number (not an API compatibility guarantee)`);
  }
});
