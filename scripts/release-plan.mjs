// Decides which npm dist-tag a release publishes under, and whether the publish
// must additionally claim `latest`.
//
// Rule: a stable version owns `latest`; a prerelease owns `next`. A prerelease
// also claims `latest` only while the registry has no `latest` at all — without
// it `npm install <pkg>` (and the plugin manager behind it) resolves to nothing,
// which is a worse first release than an rc on `latest`. Once a stable release
// owns `latest`, later prereleases never move it.
//
// Run directly (`node scripts/release-plan.mjs`) to query the registry and print
// the plan as JSON on stdout; with GITHUB_OUTPUT set it also appends the
// `key=value` lines the release workflow consumes.

import { execFile } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** @returns {{version: string, prerelease: boolean, distTag: 'next'|'latest', alsoLatest: boolean, firstPublish: boolean}} */
export function planRelease({ version, existingTags = {} }) {
  if (typeof version !== 'string' || version === '') throw new Error('planRelease needs a version');
  const prerelease = version.includes('-');
  return {
    version,
    prerelease,
    distTag: prerelease ? 'next' : 'latest',
    alsoLatest: prerelease && existingTags.latest === undefined,
    firstPublish: Object.keys(existingTags).length === 0,
  };
}

// A registry read that fails for any reason other than "no such package" must
// stop the release: treating an outage as "not published yet" would publish a
// prerelease straight onto `latest`.
async function readDistTags(name, registry) {
  try {
    const { stdout } = await exec('npm', ['view', name, 'dist-tags', '--json', '--registry', registry], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch (error) {
    const detail = `${error.stderr ?? ''}${error.message ?? ''}`;
    if (/E404|is not in this registry/.test(detail)) return {};
    throw new Error(`cannot read dist-tags for ${name} from ${registry}: ${detail.trim()}`);
  }
}

async function main() {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const registry = manifest.publishConfig?.registry ?? 'https://registry.npmjs.org/';
  const existingTags = await readDistTags(manifest.name, registry);
  const plan = planRelease({ version: manifest.version, existingTags });

  process.stdout.write(`${JSON.stringify({ name: manifest.name, registry, existingTags, ...plan }, null, 2)}\n`);
  process.stderr.write(
    `${manifest.name}@${plan.version}: publish under --tag ${plan.distTag}`
    + `${plan.alsoLatest ? ' and also point latest at it (the registry has no latest yet)' : ''}\n`
    + `existing dist-tags: ${plan.firstPublish ? '(none — first publish)' : JSON.stringify(existingTags)}\n`,
  );

  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, [
      `name=${manifest.name}`,
      `version=${plan.version}`,
      `dist_tag=${plan.distTag}`,
      `also_latest=${plan.alsoLatest}`,
      `first_publish=${plan.firstPublish}`,
      '',
    ].join('\n'));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`release-plan failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
