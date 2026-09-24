// Decides which npm dist-tag a release publishes under, and whether the release
// must stop instead of publishing.
//
// Rule: a stable version owns `latest`; a prerelease owns `next`. A prerelease
// released while the registry has no `latest` at all is `latestMissing`: the
// bare package name would install nothing, and trusted publishing — the only
// credential this repository has — covers `npm publish` only, never
// `npm dist-tag add`. Such a release must stop before uploading, and the
// maintainer resolves it out of band. `firstPublish` says the package is not on
// the registry at all, which npm's trusted publishing cannot fix either: npm
// only accepts a trusted publisher for a package that already exists.
//
// Run directly (`node scripts/release-plan.mjs`) to query the registry and print
// the plan as JSON on stdout; with GITHUB_OUTPUT set it also appends the
// `key=value` lines the release workflow consumes.
// RELEASE_PLAN_REGISTRY and RELEASE_PLAN_RETRY_MS override the registry and the
// 404 retry delay; the tests point them at a local stand-in.

import { appendFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/** @returns {{version: string, prerelease: boolean, distTag: 'next'|'latest', latestMissing: boolean, firstPublish: boolean}} */
export function planRelease({ version, existingTags = {} }) {
  if (typeof version !== 'string' || version === '') throw new Error('planRelease needs a version');
  const prerelease = version.includes('-');
  return {
    version,
    prerelease,
    distTag: prerelease ? 'next' : 'latest',
    latestMissing: prerelease && existingTags.latest === undefined,
    firstPublish: Object.keys(existingTags).length === 0,
  };
}

// The publish path itself uses this endpoint (`npm dist-tag ls`), and it
// answers from the same replication the publish just wrote to. The full
// package document is the wrong source: minutes after the first publish this
// repository's CDN edge still answered 404 for the packument while dist-tags
// already returned the version, which read as "never published" and refused a
// perfectly good release.
const RETRY_DELAY_MS = Number(process.env.RELEASE_PLAN_RETRY_MS ?? 2000);
const ATTEMPTS = 3;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A registry read that fails for any reason other than "no such package" must
// stop the release: treating an outage as "not published yet" would publish a
// prerelease straight onto `latest`.
async function readDistTags(name, registry) {
  const base = registry.replace(/\/+$/, '');
  const url = `${base}/-/package/${name.replace('/', '%2f')}/dist-tags`;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let response
    try {
      response = await fetch(url, { headers: { accept: 'application/json' } })
    } catch (error) {
      throw new Error(`cannot read dist-tags for ${name} from ${base}: ${error.message}`)
    }
    if (response.ok) return await response.json();
    if (response.status !== 404) {
      throw new Error(`cannot read dist-tags for ${name} from ${base}: HTTP ${response.status}`);
    }
    // "This package does not exist yet" is a legitimate answer, and so is a
    // stale edge cache; wait and ask again before concluding the former.
    if (attempt < ATTEMPTS) await delay(RETRY_DELAY_MS);
  }
  return {};
}

async function main() {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const registry = process.env.RELEASE_PLAN_REGISTRY
    ?? manifest.publishConfig?.registry
    ?? 'https://registry.npmjs.org/';
  const existingTags = await readDistTags(manifest.name, registry);
  const plan = planRelease({ version: manifest.version, existingTags });

  process.stdout.write(`${JSON.stringify({ name: manifest.name, registry, existingTags, ...plan }, null, 2)}\n`);
  process.stderr.write(
    `${manifest.name}@${plan.version}: publish under --tag ${plan.distTag}`
    + `${plan.latestMissing ? ' — the registry has no latest tag, so this release must not be published' : ''}\n`
    + `existing dist-tags: ${plan.firstPublish ? '(none — first publish)' : JSON.stringify(existingTags)}\n`,
  );

  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, [
      `name=${manifest.name}`,
      `version=${plan.version}`,
      `dist_tag=${plan.distTag}`,
      `latest_missing=${plan.latestMissing}`,
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
