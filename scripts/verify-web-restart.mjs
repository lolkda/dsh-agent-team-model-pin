import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// Stage an already installed/built release into an owned scratch profile.
// This does not install packages, reuse user settings, or restart the live GUI.
// Usage: node scripts/verify-web-restart.mjs <DSH root> <plugin root> [report.json]
const [installationArg, candidateArg, reportArg] = process.argv.slice(2);
assert.ok(installationArg && candidateArg, 'Pass the DSH installation root and candidate plugin root');
const installation = resolve(installationArg);
const candidate = resolve(candidateArg);
const reportPath = reportArg ? resolve(reportArg) : undefined;
const manifest = JSON.parse(await readFile(join(candidate, 'package.json'), 'utf8'));
const requireCandidate = createRequire(join(candidate, 'package.json'));
const exec = promisify(execFile);
const home = await mkdtemp(join(tmpdir(), 'atmp-web-restart-'));
const profile = join(home, 'profiles', 'model-pin-debug');
const report = { version: manifest.version, installation, candidate, status: 'running', phases: [], cleanup: false };
try {
  const destination = join(profile, 'node_modules', manifest.name);
  await mkdir(destination, { recursive: true });
  for (const file of ['package.json', 'cordis.patch.yml', 'dist']) {
    await cp(join(candidate, file), join(destination, file), { recursive: true });
  }
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    const target = dirname(requireCandidate.resolve(`${dependency}/package.json`));
    const link = join(profile, 'node_modules', dependency);
    await mkdir(dirname(link), { recursive: true });
    await symlink(target, link, 'dir');
  }
  await writeFile(join(profile, 'package.json'), JSON.stringify({
    name: 'model-pin-debug-profile', private: true,
    dependencies: { [manifest.name]: 'file:./candidate' },
    dsh: { profile: { bundles: [
      '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app',
      '@deepseek-ai/dsh-experimental-agent-team-profile',
      '@deepseek-ai/dsh-experimental-agent-team-web-profile', manifest.name,
    ] } },
  }, null, 2));
  await writeFile(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n');
  await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([
    { id: 'session-title-llm', disabled: true },
    { id: 'agent-presets', config: { default: 'cordis', includeShippedRoot: true, includeUserRoot: false } },
    { id: 'agent-team-model-pin', config: { scope: 'all', defaults: {}, sessions: {}, auditPath: join(home, 'pin-audit.jsonl') } },
  ], null, 2));
  const env = Object.fromEntries(['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'SYSTEMROOT'].flatMap((key) =>
    process.env[key] === undefined ? [] : [[key, process.env[key]]]));
  Object.assign(env, { DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' });
  for (const phase of ['create', 'resume']) {
    console.log(`Starting isolated DSH Web phase: ${phase}`);
    const args = [fileURLToPath(new URL('../tests/fixtures/web-restart-probe.mjs', import.meta.url)), installation, profile, phase];
    let output;
    try {
      output = await exec(process.execPath, args, { cwd: profile, env, timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
    } catch (error) {
      report.phases.push({ phase, status: 'failed', stdout: error.stdout ?? '', stderr: error.stderr ?? '', error: String(error) });
      throw error;
    }
    const line = output.stdout.split('\n').find((value) => value.startsWith('ATMP_WEB_RESTART='));
    assert.ok(line, `Missing phase result:\n${output.stdout}\n${output.stderr}`);
    const result = JSON.parse(line.slice('ATMP_WEB_RESTART='.length));
    report.phases.push({ ...result, stdout: output.stdout, stderr: output.stderr });
    assert.equal(result.status, 'passed', JSON.stringify(result));
    console.log(JSON.stringify(result));
  }
  assert.notEqual(report.phases[0].pid, report.phases[1].pid, 'resume must use a fresh DSH process');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = String(error);
  process.exitCode = 1;
  console.error(error);
} finally {
  await rm(home, { recursive: true, force: true });
  report.cleanup = true;
  if (reportPath) {
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(`Report: ${reportPath}`);
  }
}
