// Native extension owner/transaction tests. Payload here is a driver seam;
// full AgentLoop + Team publication is exercised by preset-runtime.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { loadPatchedSubagent, patchedSubagentFiles, workspaceSubagentRoot } from './fixtures/preset-host-extension.mjs';

async function harness(t) {
  const fixture = await loadPatchedSubagent();
  const root = new Context();
  await root.plugin(fixture.module.default, {});
  t.after(async () => { await root.fiber.dispose(); await fixture.dispose(); });
  const service = root.get('subagents');
  return { fixture, root, service,
    async owner(callback) {
      return await root.plugin({ name: 'test-child-composition', inject: ['subagents'], apply(ctx) { ctx.subagents.registerChildSetup(callback); } });
    },
  };
}
const payload = signal => ({ source: 'startup', signal, child: {}, childCtx: {}, parent: {} });

test('host patch uses isolated package bytes, not a mutation of the installed SDK', async t => {
  const before = await readFile(join(workspaceSubagentRoot, 'lib/index.js'), 'utf8');
  const h = await harness(t);
  assert.equal(h.service.childSetupVersion, 1);
  assert.equal(typeof h.service.registerChildSetup, 'function');
  assert.equal(await readFile(join(workspaceSubagentRoot, 'lib/index.js'), 'utf8'), before);
  assert.notEqual(h.fixture.root, workspaceSubagentRoot);
  const changes = await patchedSubagentFiles();
  for (const { path, after } of changes) assert.equal(await readFile(join(h.fixture.root, path), 'utf8'), after);
});

test('native setup awaits callbacks in order, returns commit without publishing it early', async t => {
  const h = await harness(t);
  const events = [];
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  await h.owner(async () => { events.push('a-start'); await pending; events.push('a-end'); return { commit() { events.push('a-commit'); } }; });
  await h.owner(() => { events.push('b'); return { commit() { events.push('b-commit'); } }; });
  const work = h.service.prepareChildSetup(payload(new AbortController().signal));
  await Promise.resolve();
  assert.deepEqual(events, ['a-start']);
  release();
  const prepared = await work;
  assert.deepEqual(events, ['a-start', 'a-end', 'b']);
  prepared.commit();
  assert.deepEqual(events, ['a-start', 'a-end', 'b', 'a-commit', 'b-commit']);
});

test('native setup refuses owner removal during callback or before publication', async t => {
  const h = await harness(t);
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const owner = await h.owner(async () => { await wait; });
  const work = h.service.prepareChildSetup(payload(new AbortController().signal));
  await owner.dispose();
  release();
  await assert.rejects(work, /owner disposed/);
  const nextOwner = await h.owner(() => ({ commit() {} }));
  const prepared = await h.service.prepareChildSetup(payload(new AbortController().signal));
  await nextOwner.dispose();
  assert.throws(() => prepared.commit(), /owner disposed/);
});

test('native setup refuses cancellation before callback, after await and at commit', async t => {
  const h = await harness(t);
  const pre = new AbortController(); pre.abort(new Error('before'));
  await assert.rejects(h.service.prepareChildSetup(payload(pre.signal)), /before/);
  const controller = new AbortController();
  const owner = await h.owner(() => { controller.abort(new Error('during')); });
  await assert.rejects(h.service.prepareChildSetup(payload(controller.signal)), /during/);
  await owner.dispose();
  const atCommit = new AbortController();
  const prepared = await h.service.prepareChildSetup(payload(atCommit.signal));
  atCommit.abort(new Error('commit cutoff'));
  assert.throws(() => prepared.commit(), /commit cutoff/);
});

test('native setup snapshots registration set and rejects async/nonvoid commit', async t => {
  const h = await harness(t);
  let entered = false;
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const first = await h.owner(async () => { await wait; });
  const work = h.service.prepareChildSetup(payload(new AbortController().signal));
  const second = await h.owner(() => { entered = true; });
  release();
  (await work).commit();
  assert.equal(entered, false);
  (await h.service.prepareChildSetup(payload(new AbortController().signal))).commit();
  assert.equal(entered, true);
  await first.dispose(); await second.dispose();
  await h.owner(() => ({ async commit() {} }));
  const prepared = await h.service.prepareChildSetup(payload(new AbortController().signal));
  assert.throws(() => prepared.commit(), /synchronous/);
});

test('native setup refuses malformed callback result and exposes callback failure', async t => {
  const h = await harness(t);
  const owner = await h.owner(() => 7);
  await assert.rejects(h.service.prepareChildSetup(payload(new AbortController().signal)), /return void/);
  await owner.dispose();
  await h.owner(() => { throw new Error('invalid target composition'); });
  await assert.rejects(h.service.prepareChildSetup(payload(new AbortController().signal)), /invalid target composition/);
});


test('review patch applies exactly and matches the tested native candidate bytes', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'atmp-host-patch-apply-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, 'package');
  await cp(workspaceSubagentRoot, root, { recursive: true });
  const patch = fileURLToPath(new URL('../patches/dsh-subagent-child-setup-v1.patch', import.meta.url));
  const baseline = JSON.parse(await readFile(new URL('../patches/dsh-subagent-child-setup-v1.baseline.json', import.meta.url), 'utf8'));
  const hash = text => createHash('sha256').update(text).digest('hex');
  for (const { path, before, after } of await patchedSubagentFiles()) {
    assert.equal(hash(before), baseline.files[path].beforeSha256);
    assert.equal(hash(after), baseline.files[path].afterSha256);
  }
  const dryRun = execFileSync('patch', ['--dry-run', '--fuzz=0', '-p1', '-i', patch], { cwd: root, encoding: 'utf8' });
  assert.doesNotMatch(dryRun, /offset|fuzz|FAILED/i);
  execFileSync('patch', ['--fuzz=0', '-p1', '-i', patch], { cwd: root });
  for (const { path, after } of await patchedSubagentFiles()) assert.equal(await readFile(join(root, path), 'utf8'), after);
});
