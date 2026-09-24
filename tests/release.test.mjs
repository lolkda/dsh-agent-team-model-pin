import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { planRelease } from '../scripts/release-plan.mjs';

const exec = promisify(execFile);
const project = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
const ci = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const release = await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');

// A literal pin is how the release gate drifted: it verified against
// 0.1.6-alpha.2 while package.json already shipped 0.1.7-rc.1. The workflows must
// read the version out of package.json so the gate cannot disagree with the
// bytes it publishes.
const literalDshPin = /@deepseek-ai\/dsh@\d/;
const deriveFromManifest = /devDependencies\["@deepseek-ai\/dsh-agent"\]/;

// A real registry stand-in: the plan's whole job is to read the registry's
// dist-tags, so these tests serve that over HTTP instead of stubbing npm.
async function withRegistry(t, responses) {
  const pending = [...responses];
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    const next = pending.length > 1 ? pending.shift() : pending[0];
    response.writeHead(next.status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(next.body ?? {}));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  return { registry: `http://127.0.0.1:${port}`, requests };
}

function runCli({ registry }, t) {
  const outputFile = join(tmpdir(), `atmp-github-output-${process.pid}-${Math.random().toString(16).slice(2)}.txt`);
  t.after(() => rm(outputFile, { force: true }));
  return writeFile(outputFile, '').then(async () => {
    const env = {
      ...process.env,
      GITHUB_OUTPUT: outputFile,
      RELEASE_PLAN_REGISTRY: registry,
      RELEASE_PLAN_RETRY_MS: '5', // the retry must not make the suite slow
    };
    try {
      const { stdout } = await exec(process.execPath, [join(project, 'scripts/release-plan.mjs')], { cwd: project, env });
      return { out: stdout, outputs: await readFile(outputFile, 'utf8') };
    } catch (error) {
      return { out: error.stdout ?? '', outputs: await readFile(outputFile, 'utf8'), error };
    }
  });
}

test('release: every workflow derives the DSH runtime version from package.json', () => {
  for (const [name, workflow] of [['ci', ci], ['release', release]]) {
    assert.ok(!literalDshPin.test(workflow),
      `${name}.yml pins a literal DSH version; it must read package.json so the gate cannot drift from what ships`);
    assert.ok(deriveFromManifest.test(workflow),
      `${name}.yml must derive the DSH runtime version from package.json`);
  }
});

test('release: the README gate installs the DSH runtime package.json pins, not a literal', () => {
  assert.ok(!literalDshPin.test(readme),
    'README.md pins a literal DSH version that drifts from package.json');
  assert.ok(deriveFromManifest.test(readme), 'README.md must show the deriving command');
});

test('release: the publish job publishes the tarball the verify job built', () => {
  const publishJob = release.slice(release.indexOf('\n  publish:'));
  assert.ok(/actions\/upload-artifact@/.test(release),
    'the verify job must hand the packed tarball to the publish job');
  assert.ok(/actions\/download-artifact@/.test(release));
  assert.ok(/npm publish "\$\{\{ steps\.tarball\.outputs\.tarball \}\}"/.test(publishJob),
    'the publish step must publish the downloaded tarball, not a freshly packed directory');
  // Comments may talk about the rule; only real command lines may break it.
  const commands = publishJob.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
  assert.ok(!/npm (ci|run build)\b/.test(commands),
    'the publish job must not rebuild: the bytes that passed the gate are the bytes that ship');
  assert.ok(/tarball="\$\(realpath /.test(publishJob),
    'the tarball path must be absolute: npm reads a two-segment relative path as the owner/repo git shorthand and runs `git ls-remote` instead of publishing the file');
  const specs = [...release.matchAll(/npm publish "([^"]+)"/g)].map((match) => match[1]);
  assert.equal(specs.length, 2, 'each publish path (dry run, trusted publishing) must name its tarball');
  for (const spec of specs) {
    assert.ok(spec.includes('steps.tarball.outputs.tarball'),
      `a publish step names ${spec} instead of the tarball the verify job built`);
  }
});

test('release: publishing needs no long-lived token', () => {
  assert.ok(!/secrets\./.test(release),
    'a 2FA-protected account cannot publish from CI with a token (npm answers EOTP), so the release must not read a token secret');
  assert.ok(/id-token: write/.test(release), 'trusted publishing and provenance need the OIDC token');
  assert.ok(/--provenance/.test(release), 'the published tarball must carry its build attestation');
});

test('release: a package that does not exist stops the release with the bootstrap steps', () => {
  const publishJob = release.slice(release.indexOf('\n  publish:'));
  assert.ok(/npm trust github/.test(publishJob),
    'the failure has to name the trusted publisher registration, because npm only accepts one for a package that already exists');
  assert.ok(/first_publish == 'true'/.test(publishJob),
    'the check must key off the plan rather than failing later with npm\'s bare 404');
});

test('release: a prerelease stops before publishing while the bare name would install nothing', () => {
  const publishJob = release.slice(release.indexOf('\n  publish:'));
  const guard = publishJob.indexOf('latest_missing');
  const publish = publishJob.indexOf('Publish with OIDC');
  assert.ok(guard !== -1 && guard < publish,
    'trusted publishing cannot write dist-tags, so the refusal must run before the upload, not after it');
});

test('release: every plan output the workflow reads is one the plan script writes', async () => {
  const script = await readFile(new URL('../scripts/release-plan.mjs', import.meta.url), 'utf8');
  const written = new Set([...script.matchAll(/`([a-z_]+)=\$\{/g)].map((match) => match[1]));
  assert.ok(written.size >= 4, 'the plan script must publish its fields to GITHUB_OUTPUT');
  const read = [...release.matchAll(/steps\.plan\.outputs\.([a-z_]+)/g)].map((match) => match[1]);
  assert.ok(read.length >= 4, 'the workflow must key its decisions off the plan');
  for (const key of read) {
    assert.ok(written.has(key),
      `the workflow reads steps.plan.outputs.${key}, but release-plan.mjs never writes it — GitHub substitutes an empty string, so the check would silently stop working`);
  }
});

test('release: the post-publish check reads endpoints that answer fresh', () => {
  const publishJob = release.slice(release.indexOf('\n  publish:'));
  // Comments are allowed to explain the rule; only command lines can break it.
  const commands = publishJob.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
  assert.ok(!/npm view/.test(commands),
    'npm view reads the full package document, which answered a stale 404 for minutes after the first publish');
  assert.ok(/-\/package\/\$\{escaped\}\/dist-tags/.test(publishJob),
    'the tag check must read the endpoint that is fresh while the package document lags');
});

test('release: a tag must name the version in package.json', () => {
  assert.ok(/does not match package\.json version/.test(release));
});

test('release: a manual run is a dry run unless dry_run is turned off', () => {
  assert.ok(/dry_run:/.test(release));
  assert.ok(/default: true/.test(release),
    'publishing is irreversible, so the manual trigger must not publish by default');
});

test('release-plan: a prerelease with a live latest tag never moves latest', () => {
  const plan = planRelease({ version: '1.3.0-rc.1', existingTags: { latest: '1.2.3', next: '1.2.4-rc.1' } });
  assert.equal(plan.distTag, 'next');
  assert.equal(plan.latestMissing, false);
});

test('release-plan: a stable version publishes to latest and does not touch next', () => {
  const plan = planRelease({ version: '1.3.0', existingTags: { latest: '1.2.3', next: '1.3.0-rc.1' } });
  assert.equal(plan.distTag, 'latest');
  assert.equal(plan.latestMissing, false);
});

test('release-plan: a prerelease with no latest anywhere is flagged, because trusted publishing cannot set dist-tags', () => {
  const plan = planRelease({ version: '1.3.0-rc.1', existingTags: { next: '1.3.0-rc.1' } });
  assert.equal(plan.latestMissing, true);
});

test('release-plan: a first publish is flagged as needing the manual bootstrap', () => {
  const plan = planRelease({ version: '1.3.0-rc.1', existingTags: {} });
  assert.equal(plan.firstPublish, true, 'npm only accepts a trusted publisher for a package that already exists');
  assert.equal(plan.latestMissing, true);
});

test('release-plan: the plan describes the version package.json declares', () => {
  const plan = planRelease({ version: pkg.version, existingTags: {} });
  assert.equal(plan.version, pkg.version);
  assert.equal(plan.name, undefined, 'the caller owns the package name; the plan only decides the tag');
  assert.ok(plan.distTag === 'next' || plan.distTag === 'latest');
});

// The CLI runs against the real package.json, so these expectations follow the
// shape of the version the repository is on. The version→tag mapping itself is
// covered by the planRelease cases above, which is where a release that changes
// the shape belongs; hardcoding `next` here only made the suite go red on the
// day the version stopped being a prerelease.
const manifestPrerelease = pkg.version.includes('-');
const manifestTag = manifestPrerelease ? 'next' : 'latest';

test('release-plan CLI: a package the registry does not have is a first publish', async (t) => {
  const { registry, requests } = await withRegistry(t, [{ status: 404, body: { error: 'Not found' } }]);
  const { out, outputs, error } = await runCli({ registry }, t);
  assert.equal(error, undefined, 'a missing package is the expected first-release state, not a failure');
  const plan = JSON.parse(out);
  assert.equal(plan.name, pkg.name);
  assert.equal(plan.version, pkg.version);
  assert.equal(plan.distTag, manifestTag);
  assert.equal(plan.firstPublish, true);
  assert.match(outputs, new RegExp(`^dist_tag=${manifestTag}$`, 'm'));
  assert.match(outputs, new RegExp(`^latest_missing=${manifestPrerelease}$`, 'm'));
  assert.equal(plan.latestMissing, manifestPrerelease,
    'only a prerelease would leave the bare package name uninstallable');
  assert.equal(requests[0], `/-/package/${pkg.name.replace('/', '%2f')}/dist-tags`,
    'the plan must read the package-scoped dist-tags endpoint, whose answer is the one the publish path itself uses');
});

test('release-plan CLI: a just-published package whose edge cache still answers 404 is not reported as unpublished', async (t) => {
  // Exactly what the CDN did minutes after the first publish: the packument was
  // still 404 while dist-tags already answered. Reading it as "never published"
  // would refuse a release that is only waiting out replication.
  const { registry, requests } = await withRegistry(t, [
    { status: 404, body: { error: 'Not found' } },
    { status: 200, body: { next: '1.3.0-rc.1', latest: '1.3.0-rc.1' } },
  ]);
  const { out, outputs } = await runCli({ registry }, t);
  const plan = JSON.parse(out);
  assert.equal(plan.firstPublish, false, 'a stale 404 must not stop a release of a package that exists');
  assert.equal(plan.latestMissing, false);
  assert.ok(requests.length >= 2, `the read must be retried before concluding "not published" (got ${requests.length} request(s))`);
  assert.match(outputs, /^first_publish=false$/m);
});

test('release-plan CLI: live dist-tags decide the tag and the latest repair', async (t) => {
  const { registry } = await withRegistry(t, [{ status: 200, body: { latest: '1.2.3', next: '1.2.4-rc.1' } }]);
  const { out, outputs } = await runCli({ registry }, t);
  const plan = JSON.parse(out);
  assert.equal(plan.distTag, manifestTag);
  assert.equal(plan.latestMissing, false, 'a live latest tag means the bare package name already installs');
  assert.equal(plan.firstPublish, false);
  assert.deepEqual(plan.existingTags, { latest: '1.2.3', next: '1.2.4-rc.1' });
  assert.match(outputs, /^latest_missing=false$/m);
});

test('release-plan CLI: a registry failure that is not a 404 fails instead of guessing', async (t) => {
  const { registry } = await withRegistry(t, [{ status: 503, body: { error: 'service unavailable' } }]);
  const { out, error } = await runCli({ registry }, t);
  assert.notEqual(error, undefined, 'a registry outage must not be mistaken for "not published yet"');
  assert.equal(out.includes('"distTag"'), false, 'no plan may be emitted from a failed registry read');
  assert.match(error.stderr, /503|dist-tags/);
});
