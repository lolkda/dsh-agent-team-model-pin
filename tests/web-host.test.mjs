// Host 半边在 rc.1 settings 模型下的契约：
//   * 运行期钉 = 本插件 profile 入口配置的 volatile `sessions` 字段（Loader 就地提交）；
//   * Composition 基线只能由 `settings.describe()` 读出（命名空间 = 入口 id）；
//   * 请求路径只读 live 引用，因此一次 settings 写入在下一次组装即生效，无需重挂。
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../src/index.ts';

const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write');

/** 造一个 cosmokit 兼容的 volatile 引用（Loader 交给插件的那一个字段）。 */
function liveRef(initial) {
  let current = initial;
  return { read: () => current, write: (next) => { current = next; },
    ref: Object.freeze({ get: () => current, [VOLATILE_WRITE]: (next) => { current = next; } }) };
}

async function harness(t, config = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'team-ui-host-'));
  const root = { id: 'lead', session: { requestHeader: () => ({ config: { provider: 'main', model: 'main-model', reasoningEffort: 'high' } }) } };
  const sessions = liveRef(config.sessions ?? {});
  const composition = { scope: config.scope ?? 'teammates', defaults: config.defaults ?? {}, sessions: config.compositionSessions ?? {} };
  let describeCalls = 0;
  let mutateCalls = 0;
  let listener;
  let definition;
  const settings = {
    // 真实 SettingsForms 的同步视图：base = Composition 层，user = profile 覆盖。
    // 没有 profile 配置入口的部署不提供 describe()。
    describe: config.noDescribe ? undefined : () => {
      describeCalls += 1;
      return [{ ns: 'agent-team-model-pin', revision: 1, base: composition,
        user: { sessions: sessions.read() },
        value: { ...composition, sessions: sessions.read() } }];
    },
    async mutate() { mutateCalls += 1; },
  };
  const ctx = {
    logger: { warn() {} },
    agentTeams: { tryMembership: (agent) => ({ root, id: 'team', name: agent.id, role: agent.id === root.id ? 'lead' : 'teammate' }) },
    commands: { register(value) { definition = value; return () => {}; } },
    inject(deps, cb) { if (deps.includes('settings')) cb({ settings }); },
    get(name) { return name === 'settings' ? settings : undefined; },
    on(event, cb) { if (event === 'agent/request') listener = cb; return () => {}; },
    effect(callback) { callback(); return () => {}; },
    fiber: { entry: { options: { id: 'agent-team-model-pin' } } },
  };
  apply(ctx, { ...config, sessions: sessions.ref, auditPath: join(dir, 'audit.jsonl') });
  t.after(async () => { await new Promise((resolve) => setTimeout(resolve, 80)); await rm(dir, { recursive: true, force: true }); });
  return {
    get describeCalls() { return describeCalls; },
    get mutateCalls() { return mutateCalls; },
    setLive(value) { sessions.write(value); },
    invoke(rawInput) { return definition.handler({ agent: root, rawInput, signal: new AbortController().signal }); },
    request(agent = { id: 'child' }) { return listener({ agent }, async () => ({ provider: 'stale', model: 'stale-model', reasoningEffort: 'low', temperature: 0.5 })); },
  };
}

test('UI Host: a pin in the entry config applies without any settings round-trip', async (t) => {
  const h = await harness(t, { sessions: { lead: { provider: 'p', model: 'm' } } });
  assert.deepEqual(await h.request(), { provider: 'p', model: 'm', temperature: 0.5 });
});

test('UI Host: a settings write is visible on the next request without a remount', async (t) => {
  const h = await harness(t, { sessions: { lead: { provider: 'p', model: 'm' } } });
  assert.deepEqual(await h.request(), { provider: 'p', model: 'm', temperature: 0.5 });
  h.setLive({ lead: { provider: 'q', model: 'n', reasoningEffort: 'high' } });
  assert.deepEqual(await h.request(), { provider: 'q', model: 'n', reasoningEffort: 'high', temperature: 0.5 });
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
  // 真实部署没有 profile 配置入口时 describe 不存在；插件必须仍然工作。
  const shown = await h.invoke('show');
  assert.equal(shown.kind, 'success', JSON.stringify(shown));
  assert.equal(h.describeCalls, 0);
  assert.match(shown.text, /运行期层（settings）= .*m/);
  assert.match(shown.text, /Composition 层= 不可用/);
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
