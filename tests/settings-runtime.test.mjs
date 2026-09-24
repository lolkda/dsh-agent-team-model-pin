// rc.1 settings 契约的真实服务集成：这里跑的是真正的
// `@deepseek-ai/dsh-settings`（SettingsForms），只把「profile 文档持久化 +
// Loader 重挂」这一层替换成夹具——那两层由 DSH 自己的集成测试负责，而
// 「导出的 Config 是否投影出可写的 sessions 路径」「mutate 的 set/unset/CAS
// 语义」「插件读到的值是否就是刚写入的值」由本文件负责。
//
// 这套用例是 installSection 被删除后的回归防线：老实现会在 catch 里静默降级，
// 运行期钉永远读不到、/team-model set 直接报「settings 服务不可用」。
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import SettingsForms, { SettingsConflictError } from '@deepseek-ai/dsh-settings';
import * as plugin from '../src/index.ts';

const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write');
const NS = 'agent-team-model-pin';

/** 挂一个真实 SettingsForms + 假 profile/configEditor 的宿主。 */
async function harness(t, composition = { scope: 'teammates', defaults: {}, sessions: {} }) {
  const home = await mkdtemp(join(tmpdir(), 'atmp-settings-'));
  const root = new Context();
  const auditPath = join(home, 'audit.jsonl');
  // 插件 inject 的是 agentTeams/commands；没有它们 fiber 会一直 pending，
  // 也就不会被 SettingsForms 投影成可配置入口。
  await root.plugin({ name: 'atmp-settings-deps', apply(owner) {
    owner.provide('agentTeams', { tryMembership: () => undefined });
    owner.provide('commands', { register: () => () => {} });
  } });
  const fiber = await root.plugin(plugin, { ...composition, auditPath });
  // 真实 Loader 入口的形状：id 就是 settings 命名空间，fiber.runtime.Config 是插件导出的 schema。
  const entry = { id: NS, options: { id: NS, name: '@lolkda/dsh-agent-team-model-pin', config: { ...composition, auditPath } },
    fiber, ctx: fiber.ctx };
  let override = {};
  const edits = [];
  const configEditor = {
    documentPath: join(home, 'cordis.patch.yml'),
    entries: () => [entry],
    configuration: () => [{ entry, inherited: structuredClone(composition), override: structuredClone(override) }],
    /**
     * 模拟 ConfigEditor.edit 的可观测部分：校验并算出下一个 raw config，
     * 然后像 Loader 的 volatile-only 提交那样就地写进运行中的引用。
     */
    async edit(target, change) {
      const raw = structuredClone(target.options.config ?? {});
      const next = change(raw, structuredClone(composition));
      for (const [key, value] of Object.entries(next)) {
        const field = target.fiber.config[key];
        if (field !== null && typeof field === 'object' && VOLATILE_WRITE in field) field[VOLATILE_WRITE](value);
        else target.fiber.config[key] = value;
      }
      target.options.config = next;
      override = next;
      edits.push(next);
    },
  };
  const profileContext = { name: 'atmp-test', dir: home, patchPath: configEditor.documentPath, home, installAnchor: home };
  const loader = { await: () => Promise.resolve(), entries: () => [entry] };
  await root.plugin({ name: 'atmp-settings-fixture', apply(owner) {
    owner.provide('configEditor', configEditor);
    owner.provide('profileContext', profileContext);
    owner.provide('loader', loader);
  } });
  const settings = await root.plugin(SettingsForms);
  t.after(async () => { await settings.dispose(); await root.fiber.dispose(); await rm(home, { recursive: true, force: true }); });
  return {
    service: root.get('settings'), entry, fiber, edits,
    live: () => fiber.config.sessions.get(),
  };
}

test('rc.1 settings: the exported Config makes the entry describable and writable', async (t) => {
  const h = await harness(t);
  const [descriptor] = h.service.describe();
  assert.equal(descriptor.ns, NS, 'settings 命名空间就是 Loader 入口 id');
  assert.equal(descriptor.applies, 'live');
  assert.deepEqual(descriptor.value.sessions, {}, 'sessions 必须出现在投影后的表单值里');
  assert.equal(descriptor.value.scope, 'teammates');
  assert.equal(descriptor.autoGenerate, true);
  // 表单 schema 是 schemastery 的序列化形态（{uid, refs}），根节点必须可解析。
  assert.ok(descriptor.schema.refs[String(descriptor.schema.uid)], '表单 schema 必须带可解析的根节点');
});

test('rc.1 settings: a path write reaches the live plugin config without a remount', async (t) => {
  const h = await harness(t);
  const before = h.fiber.config.sessions;
  await h.service.mutate(NS, [{ op: 'set', path: ['sessions', 'lead-A'], value: { provider: 'p', model: 'm', modelDefault: true } }]);
  assert.equal(h.fiber.config.sessions, before, 'volatile 提交必须就地更新，不得换掉引用（不重挂）');
  assert.deepEqual(h.live()['lead-A'], { provider: 'p', model: 'm', modelDefault: true });
  assert.equal(h.fiber.state, 2, '插件不得被重启');
});

test('rc.1 settings: unset removes only that session and falls back to the composition value', async (t) => {
  const composition = { scope: 'teammates', defaults: {}, sessions: { 'lead-A': { provider: 'base', model: 'base-model' } } };
  const h = await harness(t, composition);
  await h.service.mutate(NS, [{ op: 'set', path: ['sessions', 'lead-A'], value: { provider: 'p', model: 'm' } }]);
  assert.deepEqual(h.live()['lead-A'], { provider: 'p', model: 'm' });
  await h.service.mutate(NS, [{ op: 'unset', path: ['sessions', 'lead-A'] }]);
  assert.deepEqual(h.live()['lead-A'], { provider: 'base', model: 'base-model' },
    'clear 只撤销 profile 覆盖，Composition 基线必须重新生效');
});

test('rc.1 settings: unset on a session without a composition value drops the key entirely', async (t) => {
  const h = await harness(t);
  await h.service.mutate(NS, [{ op: 'set', path: ['sessions', 'lead-B'], value: { followLeader: true } }]);
  assert.deepEqual(h.live()['lead-B'], { followLeader: true });
  await h.service.mutate(NS, [{ op: 'unset', path: ['sessions', 'lead-B'] }]);
  assert.equal('lead-B' in h.live(), false);
});

test('rc.1 settings: a stale revision is refused instead of overwriting', async (t) => {
  const h = await harness(t);
  const [descriptor] = h.service.describe();
  await h.service.mutate(NS, [{ op: 'set', path: ['sessions', 'lead-A'], value: { followLeader: true } }]);
  await assert.rejects(
    h.service.mutate(NS, [{ op: 'set', path: ['sessions', 'lead-A'], value: { provider: 'x', model: 'y' } }], descriptor.revision),
    (error) => error instanceof SettingsConflictError,
  );
  assert.deepEqual(h.live()['lead-A'], { followLeader: true }, '被拒绝的写入不得改变任何状态');
});

test('rc.1 settings: non-volatile configuration is not writable from the settings surface', async (t) => {
  const h = await harness(t);
  await assert.rejects(h.service.mutate(NS, [{ op: 'set', path: ['auditPath'], value: '/tmp/elsewhere.jsonl' }]), /not volatile|volatile/i);
});
