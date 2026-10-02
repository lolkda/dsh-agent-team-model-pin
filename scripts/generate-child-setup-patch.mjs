/** Rebuild review artifacts from the exact SDK fixture; never modifies that SDK. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { patchedSubagentFiles, SUBAGENT_BASE_VERSION } from '../tests/fixtures/preset-host-extension.mjs';

const directory = await mkdtemp(join(tmpdir(), 'atmp-host-patch-review-'));
try {
  const files = await patchedSubagentFiles();
  let patch = '';
  for (const file of files) {
    const before = join(directory, 'before');
    const after = join(directory, 'after');
    await writeFile(before, file.before);
    await writeFile(after, file.after);
    try {
      patch += execFileSync('diff', ['-u', '--label', `a/${file.path}`, before, '--label', `b/${file.path}`, after], { encoding: 'utf8' });
    } catch (error) {
      if (error.status !== 1) throw error;
      patch += error.stdout;
    }
  }
  await writeFile(new URL('../patches/dsh-subagent-child-setup-v1.patch', import.meta.url), patch);
  await writeFile(new URL('../patches/dsh-subagent-child-setup-v1.baseline.json', import.meta.url), JSON.stringify({
    package: '@deepseek-ai/dsh-subagent',
    version: SUBAGENT_BASE_VERSION,
    files: Object.fromEntries(files.map(file => [file.path, {
      beforeSha256: createHash('sha256').update(file.before).digest('hex'),
      afterSha256: createHash('sha256').update(file.after).digest('hex'),
    }])),
  }, null, 2) + '\n');
  console.log(`Generated candidate child-setup host patch (${files.length} package files). No installed SDK was changed.`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
