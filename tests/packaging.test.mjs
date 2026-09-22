import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('packaging: a dual-face bundle mounts its bare package name, not a Host-only subpath', async () => {
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
  const match = patch.match(/^\s+name:\s*['"]([^'"]+)['"]\s*$/m);
  assert.ok(match, 'bundle declares a plugin row');
  assert.equal(match[1], pkg.name,
    'DSH client-modules exactPackageSpecifier ignores package subpaths even when their Host entry is active');
});

test('packaging: the browser artifact registers the exact package module without executing it', async () => {
  const exported = pkg.exports['./client'];
  const entry = typeof exported === 'string' ? exported : exported.default;
  const code = await readFile(new URL(`../${entry}`, import.meta.url), 'utf8');
  let registration;
  runInNewContext(code, { window: { __ModuleLoader__: { load(value) { registration = value; } } } }, { timeout: 1000 });
  assert.equal(registration?.id, pkg.name);
  assert.equal(typeof registration.factory, 'function');
});

test('packaging: the popup uses the shared React DOM runtime, never a bundled second copy', async () => {
  assert.ok(pkg.dsh.client.external.includes('react-dom'));
  const code = await readFile(new URL('../dist/client.js', import.meta.url), 'utf8');
  assert.match(code, /require\(["']react-dom["']\)/);
  assert.doesNotMatch(code, /node_modules\/react-dom\/cjs/);
});

test('packaging: core SDKs remain host-owned instead of shadowing profile registry rows', () => {
  for (const dependency of Object.keys(pkg.dependencies ?? {})) {
    assert.doesNotMatch(dependency, /^@deepseek-ai\/(?:dsh-|cordis(?:$|-))/,
      dependency + ' must not install a second Host runtime in the profile');
  }
  assert.equal(pkg.peerDependencies?.['@deepseek-ai/dsh-agent'], pkg.devDependencies?.['@deepseek-ai/dsh-agent']);
  assert.ok(pkg.peerDependencies?.['@deepseek-ai/dsh-agent'], 'declare the supported official selector SDK');
  assert.equal(pkg.peerDependenciesMeta?.['@deepseek-ai/dsh-agent']?.optional, true,
    'the peer must not cause automatic installation; DSH supplies its own runtime fallback');
});
