import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { findDshInstallation } from './fixtures/dsh-installation.mjs';

const exec = promisify(execFile);
const project = process.env.DSH_TEST_PACKAGE_ROOT ?? fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'));

// These are integration tests of the installed DSH, not a reimplementation of
// its resolver. DSH_TEST_INSTALL_ROOT may select another supported installation.
const installation = await findDshInstallation();

async function stageProfile(t, withPlugin) {
  const home = await mkdtemp(join(tmpdir(), 'atmp-cold-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const profile = join(home, 'profiles', 'cold-start');
  await mkdir(profile, { recursive: true });
  await writeFile(join(profile, 'package.json'), JSON.stringify({
    name: 'atmp-cold-start-fixture', private: true,
    dependencies: withPlugin ? { [manifest.name]: 'file:./candidate' } : {},
    dsh: { profile: { bundles: withPlugin ? [manifest.name] : [] } },
  }));
  await writeFile(join(profile, 'cordis.yml'), '[]\n');
  // DSH 0.1.7-rc.1 declares presets as `@deepseek-ai/dsh-agent-preset` rows
  // (`config.id` + `config.plugins`) instead of scanning preset roots, and the
  // registry moved to `@deepseek-ai/dsh-agent-preset-registry` with a
  // `{ default, selectedDefault, modeSelectionEnabled }` config.
  await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'system-prompt', name: '@deepseek-ai/dsh-system-prompt', config: {} },
    { id: 'session-projection', name: '@deepseek-ai/dsh-session-projection' },
    { id: 'agent-preset-registry', name: '@deepseek-ai/dsh-agent-preset-registry', config: { default: 'fixture' } },
    { id: 'preset-fixture', name: '@deepseek-ai/dsh-agent-preset', config: {
      id: 'fixture', order: 1, plugins: [
        { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: 'COLD_START_SCOPED_PERSONA' } },
      ],
    } },
    { id: 'fixture-io', name: './fixture-io.mjs' },
  ] }]));
  await writeFile(join(profile, 'fixture-io.mjs'), `
    export function apply(ctx) {
      ctx.provide('agentTeams', { tryMembership() { return undefined; } });
      ctx.provide('commands', { register() { return () => {}; } });
    }
  `);
  if (withPlugin) {
    const destination = join(profile, 'node_modules', manifest.name);
    await mkdir(destination, { recursive: true });
    for (const file of ['package.json', 'cordis.patch.yml', 'dist']) {
      await cp(join(project, file), join(destination, file), { recursive: true });
    }
    // Stage the exact production dependency roots from the package under test.
    // The deployment remains a distinct installation, as in the real hoisted
    // profile. No package manager, real profile, or shipped file is modified.
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      const target = dirname(require.resolve(`${dependency}/package.json`));
      const link = join(profile, 'node_modules', dependency);
      await mkdir(dirname(link), { recursive: true });
      await symlink(target, link, 'dir');
    }
  }
  return { home, profile };
}

for (const withPlugin of [false, true]) {
  test(`cold startup: ${withPlugin ? 'installed bundle' : 'clean control'} preserves persona scope`, {
    skip: installation ? false : 'Install DSH or set DSH_TEST_INSTALL_ROOT to run the real Loader integration',
    timeout: 30000,
  }, async (t) => {
    const { home, profile } = await stageProfile(t, withPlugin);
    let output;
    try {
      output = await exec(process.execPath, [
        fileURLToPath(new URL('fixtures/cold-start-probe.mjs', import.meta.url)), installation, profile,
      ], {
        cwd: profile,
        env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' },
        timeout: 20000, maxBuffer: 2 * 1024 * 1024,
      });
    } catch (error) {
      assert.fail(`The real DSH cold-start probe failed:\n${error.stdout ?? ''}\n${error.stderr ?? error.message}`);
    }
    const line = output.stdout.split('\n').find((value) => value.startsWith('ATMP_COLD_START='));
    assert.ok(line, output.stdout + output.stderr);
    const result = JSON.parse(line.slice('ATMP_COLD_START='.length));
    assert.equal(result.phase, 'complete', JSON.stringify(result));
    assert.equal(result.globalContainsPersona, false, 'preset persona must never leak into the global prompt');
    assert.equal(result.firstContainsPersona, true);
    assert.equal(result.secondContainsPersona, true);
    assert.equal(result.afterDisposeContainsPersona, true, 'disposing an Agent must not break the shared standing preset');
  });
}
