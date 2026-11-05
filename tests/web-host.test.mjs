// Host half in the DSH 0.2.2 model-selection contract:
//   * the runtime pin remains the plugin entry config's volatile `sessions` field;
//   * the effective route is written through the Agent-owned `agent.model.select()`;
//   * the standard Loop captures that selection at the next step boundary.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../src/index.ts';

const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write');

/** Cosmokit-compatible volatile reference (the field the Loader hands to apply). */
function liveRef(initial) {
  let current = initial;
  return { read: () => current, write: (next) => { current = next; },
    ref: Object.freeze({ get: () => current, [VOLATILE_WRITE]: (next) => { current = next; } }) };
}

function agent(id, options, ctx) {
  const listeners = new Map();
  const model = {
    value: options ? { ...options } : undefined,
    current() { return this.value ? { ...this.value } : undefined; },
    select(selection) { this.value = { ...selection }; },
  };
  const events = {
    on(event, cb) {
      const set = listeners.get(event) ?? new Set();
      set.add(cb);
      listeners.set(event, set);
      return () => set.delete(cb);
    },
    emit(event, payload) {
      for (const cb of listeners.get(event) ?? []) cb(payload);
    },
  };
  const value = {
    id,
    ctx: { on: events.on },
    options: options ? { ...options } : {},
    session: { requestHeader: () => ({ config: { provider: 'main', model: 'main-model', reasoningEffort: 'high' } }) },
    model,
    claim() { events.emit('agent/inbox/claimed', { message: { id: `m-${id}` }, turn: 1 }); },
  };
  return value;
}

async function harness(t, config = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'team-ui-host-'));
  const sessions = liveRef(config.sessions ?? {});
  const composition = { scope: config.scope ?? 'teammates', defaults: config.defaults ?? {}, sessions: config.compositionSessions ?? {} };
  let describeCalls = 0;
  const services = new Map();
  const rootAgent = agent('lead', { provider: 'main', model: 'main-model', reasoningEffort: 'high' });
  const childAgent = agent('child', { provider: 'stale', model: 'stale-model', reasoningEffort: 'low' });
  const agents = [rootAgent, childAgent];
  const settings = {
    describe: config.noDescribe ? undefined : () => {
      describeCalls += 1;
      return [{ ns: 'agent-team-model-pin', revision: 1, base: composition,
        user: { sessions: sessions.read() },
        value: { ...composition, sessions: sessions.read() } }];
    },
    async mutate() {},
  };
  const ctx = {
    logger: { warn() {} },
    provide(name, value) { services.set(name, value); },
    agents: { list: () => agents },
    agentTeams: { tryMembership: (value) => value.id === rootAgent.id
      ? { root: rootAgent, id: 'team', name: 'lead', role: 'lead' }
      : { root: rootAgent, id: 'team', name: value.id, role: 'teammate' } },
    commands: { register(value) { services.set(`command:${value.name}`, value); return () => services.delete(`command:${value.name}`); } },
    inject(_deps, cb) { cb({ get: name => services.get(name) }); },
    get(name) { return services.get(name) ?? (name === 'settings' ? settings : name === 'agents' ? { list: () => agents } : undefined); },
    on(event, cb) { services.set(`event:${event}`, cb); return () => services.delete(`event:${event}`); },
    effect(callback) { callback(); return () => {}; },
    fiber: { entry: { options: { id: 'agent-team-model-pin' } } },
  };
  apply(ctx, { ...config, defaults: config.defaults ?? {}, sessions: sessions.ref, auditPath: join(dir, 'audit.jsonl') });
  t.after(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); await rm(dir, { recursive: true, force: true }); });
  return {
    get describeCalls() { return describeCalls; },
    setLive(value) { sessions.write(value); },
    invoke(rawInput) { return services.get('teamSettings').model(rootAgent, rawInput, new AbortController().signal); },
    childAgent,
    rootAgent,
  };
}

test('UI Host: a pin in the entry config applies without any settings round-trip', async (t) => {
  const h = await harness(t, { sessions: { lead: { provider: 'p', model: 'm' } } });
  h.childAgent.claim();
  assert.deepEqual(h.childAgent.model.current(), { provider: 'p', model: 'm' });
});

test('UI Host: a settings write is visible on the next step without a remount', async (t) => {
  const h = await harness(t, { sessions: { lead: { provider: 'p', model: 'm' } } });
  h.childAgent.claim();
  assert.deepEqual(h.childAgent.model.current(), { provider: 'p', model: 'm' });
  h.setLive({ lead: { provider: 'q', model: 'n', reasoningEffort: 'high' } });
  h.childAgent.claim();
  assert.deepEqual(h.childAgent.model.current(), { provider: 'q', model: 'n', reasoningEffort: 'high' });
});

test('UI Host: the composition baseline is read from settings.describe()', async (t) => {
  const h = await harness(t, { compositionSessions: { lead: { provider: 'base', model: 'base-model' } } });
  const shown = await h.invoke('show');
  assert.equal(shown.kind, 'success', JSON.stringify(shown));
  assert.ok(h.describeCalls > 0, 'Composition 基线只能由 settings.describe() 给出');
  assert.match(shown.text, /Composition 层 sessions= .*base-model/);
  assert.match(shown.text, /agent-team-model-pin/);
});

test('UI Host: without a describable entry the layer split degrades instead of failing', async (t) => {
  const h = await harness(t, { sessions: { lead: { provider: 'p', model: 'm' } }, noDescribe: true });
  const shown = await h.invoke('show');
  assert.equal(shown.kind, 'success', JSON.stringify(shown));
  assert.equal(h.describeCalls, 0);
  assert.match(shown.text, /运行期层（settings）= .*m/);
  assert.match(shown.text, /Composition 层= 不可用/);
});

test('UI Host: live Team effort does not modify the Lead agent', async (t) => {
  const h = await harness(t);
  h.setLive({ lead: { followLeader: true, reasoningEffort: 'low' } });
  h.childAgent.claim();
  assert.deepEqual(h.childAgent.model.current(), { provider: 'main', model: 'main-model', reasoningEffort: 'low' });
  assert.deepEqual(h.rootAgent.model.current(), { provider: 'main', model: 'main-model', reasoningEffort: 'high' });
});

test('UI Host: model default is applied even when the composition pins high effort', async (t) => {
  const h = await harness(t, { defaults: { reasoningEffort: 'high' } });
  h.setLive({ lead: { provider: 'p', model: 'm', modelDefault: true } });
  h.childAgent.claim();
  assert.deepEqual(h.childAgent.model.current(), { provider: 'p', model: 'm' });
});
