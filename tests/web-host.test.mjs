import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../src/index.ts';

async function harness(t, config = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'team-ui-host-'));
  const root = { id: 'lead', session: { requestHeader: () => ({ config: { provider: 'main', model: 'main-model', reasoningEffort: 'high' } }) } };
  let live = {};
  let section;
  let listener;
  const settings = {
    installSection(owner, ns, schema, entry, hooks) {
      section = { ns, schema, entry };
      hooks.setSource(() => schema({ ...entry, sessions: live }));
    },
    async mutate() {},
  };
  const ctx = {
    logger: { warn() {} },
    agentTeams: { tryMembership: (agent) => ({ root, id: 'team', name: agent.id, role: agent.id === root.id ? 'lead' : 'teammate' }) },
    commands: { register() { return () => {}; } },
    inject(deps, cb) { if (deps.includes('settings')) cb({ settings }); },
    get(name) { return name === 'settings' ? settings : undefined; },
    on(event, cb) { if (event === 'agent/request') listener = cb; return () => {}; },
    effect() {},
  };
  apply(ctx, { ...config, auditPath: join(dir, 'audit.jsonl') });
  t.after(async () => { await new Promise((resolve) => setTimeout(resolve, 80)); await rm(dir, { recursive: true, force: true }); });
  return {
    get section() { return section; },
    setLive(value) { live = value; },
    request(agent = { id: 'child' }) { return listener({ agent }, async () => ({ provider: 'stale', model: 'stale-model', reasoningEffort: 'low', temperature: 0.5 })); },
  };
}

test('UI Host: describe exposes immutable composition metadata, not runtime writes', async (t) => {
  const h = await harness(t, { defaults: { provider: 'p', model: 'm' } });
  assert.deepEqual(h.section.entry.defaults, { provider: 'p', model: 'm' });
  assert.deepEqual(h.section.entry.configuredSessions, {});
  assert.equal(h.section.entry.scope, 'teammates');
  assert.deepEqual(h.section.entry.sessions, {});
});

test('UI Host: schema preserves the explicit follow choice and restores the main route', async (t) => {
  const h = await harness(t, { defaults: { provider: 'p', model: 'm' } });
  const parsed = h.section.schema({ sessions: { lead: { followLeader: true } } });
  assert.deepEqual(parsed.sessions.lead, { followLeader: true });
  h.setLive(parsed.sessions);
  assert.deepEqual(await h.request(), { provider: 'main', model: 'main-model', reasoningEffort: 'high', temperature: 0.5 });
});

test('UI Host: live Team effort does not modify the Lead request', async (t) => {
  const h = await harness(t);
  h.setLive({ lead: { followLeader: true, reasoningEffort: 'low' } });
  assert.deepEqual(await h.request(), { provider: 'main', model: 'main-model', reasoningEffort: 'low', temperature: 0.5 });
  assert.deepEqual(await h.request({ id: 'lead' }), { provider: 'stale', model: 'stale-model', reasoningEffort: 'low', temperature: 0.5 });
});

test('UI Host: model default is applied even when the composition pins high effort', async (t) => {
  const h = await harness(t, { defaults: { reasoningEffort: 'high' } });
  h.setLive({ lead: { provider: 'p', model: 'm', modelDefault: true } });
  assert.deepEqual(await h.request(), { provider: 'p', model: 'm', temperature: 0.5 });
});
