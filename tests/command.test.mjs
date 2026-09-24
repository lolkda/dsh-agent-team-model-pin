// 命令 handler 与 agent/request 监听的假 ctx 测试（SPEC v1：§5.2 装配、§5.3 配置、§5.4 存储、
// §5.5 审计、§4 R1/R3/R4/R6/R6b、§"失败与边界"表）。
//
// 零依赖：只用 node:test + node:assert/strict，假 ctx 全部手写（不使用任何 mock 框架）。
// 覆盖目标：让 src/index.ts 的 handler 函数体与请求监听器真正被执行，
// 从而把 R6/R6b 的运行时「零写入」与 clear 返回文本变成可复现证据。
//
// 每个用例正文都注明「实现被怎样破坏会变红」，便于回归定位。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { Config, apply, inject, name as pluginName } from '../src/index.ts';

// ---------------------------------------------------------------------------
// 固定夹具
// ---------------------------------------------------------------------------

/** Lead 会话 id：teammate 的作用键就是它（SPEC 4 · R2）。 */
const LEAD_ID = 'lead-session';
/** 非团队成员 agent 的自身 id（scope='all' 时作用键）。 */
const STRANGER_ID = 'outside-agent';

const SETTINGS_NS = 'agent-team-model-pin';
const TEAM_MODEL = 'team-model';

const teammateAgent = { id: 'teammate-1' };
const leadAgent = { id: LEAD_ID };
const strangerAgent = { id: STRANGER_ID };

/** 继承路由：未被钉时应原样返回给调用方（R7/继承语义）。 */
const inheritedCall = () => ({
  provider: 'inherit-provider',
  model: 'inherit-model',
  reasoningEffort: 'low',
  temperature: 0.25,
});

const MEMBERS = new Map([
  [teammateAgent.id, { root: { id: LEAD_ID }, id: 'team-1', role: 'teammate', name: 'teammate-1' }],
  [LEAD_ID, { root: { id: LEAD_ID }, id: 'team-1', role: 'lead', name: LEAD_ID }],
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// 手写假 ctx
// ---------------------------------------------------------------------------

/**
 * 造一个驱动 `apply()` 的假宿主。
 * @param {object} [options]
 * @param {object} [options.config] 传给 apply 的组合配置。
 * @param {boolean} [options.withSettings] false → `ctx.inject(['settings'], …)` 不回调、`ctx.get('settings')` 为 undefined。
 * @param {boolean} [options.membershipThrows] true → `agentTeams.tryMembership` 抛错。
 * @param {boolean} [options.withLlm] false → `ctx.get('llm')` 为 undefined。
 * @param {string} [options.auditPath] 审计文件路径（默认落在本次用例自己的临时目录）。
 * @returns 假宿主句柄（含记录数组与清理函数）。
 */
/** cosmokit 的 volatile 引用协议符号（rc.1 的 `Volatile` 字段）。 */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write');

/**
 * 造一个 cosmokit 兼容的 volatile 引用，模拟 Loader 交给插件的那一个字段。
 * @param {unknown} value 初始解析值。
 * @returns 冻结的引用对象（get + 协议符号写入）。
 */
function liveRef(value) {
  let current = value;
  return Object.freeze({ get: () => current, [VOLATILE_WRITE]: (next) => { current = next; } });
}

function makeHarness(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'atmp-cmd-'));
  const auditPath = options.auditPath ?? join(dir, 'audit.jsonl');
  const withSettings = options.withSettings !== false;
  const withDescribe = options.withDescribe !== false;
  const membershipThrows = options.membershipThrows === true;

  const warnings = [];
  const mutateCalls = [];
  const commandDefinitions = new Map();
  const listeners = [];
  const injectCalls = [];
  const effects = [];

  // rc.1 模型：Composition 层 = cordis.patch.yml 的入口配置；运行期层 = profile 覆盖。
  // Loader 把两层合并后写进 volatile 引用，插件每次读取都拿到有效层。
  const composition = {
    scope: options.config?.scope ?? 'teammates',
    defaults: options.config?.defaults ?? {},
    sessions: options.config?.sessions ?? {},
  };
  let userSessions = {};
  const effectiveSessions = () => ({ ...composition.sessions, ...userSessions });
  const refs = {
    scope: liveRef(composition.scope),
    defaults: liveRef(composition.defaults),
    sessions: liveRef(effectiveSessions()),
  };
  /** 模拟 Loader 的 volatile 就地提交。 */
  const commit = () => { refs.sessions[VOLATILE_WRITE](effectiveSessions()); };

  const settings = {
    // rc.1 删除了 installSection；存在它反而是契约破坏。
    describe: withDescribe ? () => [{
      ns: SETTINGS_NS, revision: 1,
      base: { scope: composition.scope, defaults: composition.defaults, sessions: composition.sessions },
      user: { sessions: userSessions },
      value: { scope: composition.scope, defaults: composition.defaults, sessions: effectiveSessions() },
    }] : undefined,
    async mutate(ns, ops) {
      mutateCalls.push({ ns, ops });
      for (const op of ops) {
        const sessionId = op.path[1];
        const next = { ...userSessions };
        if (op.op === 'set') next[sessionId] = op.value;
        else delete next[sessionId];
        userSessions = next;
      }
      // 真实 SettingsForms 的 unset 会重新落回 Composition 层的继承值。
      commit();
    },
    /** 测试专用：模拟外部改写运行期层，用于验证插件每次读取都是活的。 */
    __setUserSessions(next) {
      userSessions = { ...next };
      commit();
    },
  };

  const llm = {
    listProviders: () => [{ id: 'cpa' }, { id: 'openai' }],
    async resolveModelInfo(provider, model) {
      if (provider === 'cpa' && model === 'deepseek-flash') {
        return { reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } };
      }
      throw new Error(`unknown route ${provider}/${model}`);
    },
  };

  const ctx = {
    logger: {
      warn: (...args) => warnings.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ')),
    },
    agentTeams: {
      tryMembership: (agent) => {
        if (membershipThrows) throw new Error('roster unavailable');
        return MEMBERS.get(agent.id);
      },
    },
    commands: {
      register(definition) {
        commandDefinitions.set(definition.name, definition);
        return () => commandDefinitions.delete(definition.name);
      },
    },
    inject(deps, callback) {
      injectCalls.push(deps);
      if (withSettings && deps.includes('settings')) callback({ settings });
      return () => {};
    },
    get(serviceName) {
      if (serviceName === 'settings') return withSettings ? settings : undefined;
      if (serviceName === 'llm') return options.withLlm === false ? undefined : llm;
      return undefined;
    },
    on(event, listener) {
      listeners.push({ event, listener });
      return () => {};
    },
    effect(callback) {
      effects.push(callback());
      return () => {};
    },
    // rc.1：Loader fiber 的入口 id 就是 settings 命名空间。
    fiber: { entry: { options: { id: SETTINGS_NS } } },
  };

  // 关键：除非用例显式指定，审计一律落在本用例的临时目录。
  // 否则缺省 auditPath 会指向真实 $DSH_HOME/agent-team-model-pin/audit.jsonl，
  // 污染 e2e 证据（本套件任何用例都不得写真实 DSH_HOME）。
  const auditValue = options.config?.auditPath ?? auditPath;
  // 自护栏：本套件任何用例都不得写真实 $DSH_HOME 的审计文件（那是 e2e 证据）。
  const realDshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh');
  assert.ok(
    auditValue.startsWith(tmpdir()),
    `测试必须把审计写进临时目录，实际 ${auditValue}`,
  );
  assert.ok(
    !auditValue.startsWith(realDshHome),
    `测试不得写真实 $DSH_HOME 审计文件，实际 ${auditValue}`,
  );
  // rc.1 的解析配置：volatile 字段是引用（Loader 就地提交），auditPath 是普通配置。
  apply(ctx, { scope: refs.scope, defaults: refs.defaults, sessions: refs.sessions, auditPath: auditValue });

  const command = () => {
    const definition = commandDefinitions.get(TEAM_MODEL);
    assert.ok(definition, `commands.register 没有收到 ${TEAM_MODEL} 定义`);
    return definition;
  };

  const invoke = (agent, rawInput) =>
    command().handler({ agent, rawInput, signal: new AbortController().signal });

  /** 走一遍 agent/request 瀑布：next() 返回继承路由。 */
  let requestCount = 0;
  const request = async (agent) => {
    const entries = listeners.filter((entry) => entry.event === 'agent/request');
    assert.equal(entries.length, 1, `agent/request 监听器应恰好 1 个，实际 ${entries.length} 个`);
    const original = inheritedCall();
    const out = await entries[0].listener(
      { agent, turn: 0, step: 0, signal: new AbortController().signal },
      async () => original,
    );
    requestCount += 1;
    return { original, out };
  };

  /** 读审计文件（允许半行 JSON 存在时被忽略）。 */
  const auditLines = () =>
    existsSync(auditPath)
      ? readFileSync(auditPath, 'utf8')
          .split('\n')
          .filter((line) => line.trim() !== '')
          .map((line) => JSON.parse(line))
      : [];

  /** 审计是 fire-and-forget：有界轮询等待目标行出现。 */
  const waitForAudit = async (predicate, budgetMs = 2000) => {
    const deadline = Date.now() + budgetMs;
    for (;;) {
      const hits = auditLines().filter(predicate);
      if (hits.length > 0) return hits;
      if (Date.now() > deadline) return [];
      await sleep(10);
    }
  };

  // 审计是 fire-and-forget 的串行链：清理前必须给它落地的机会，
  // 否则「删目录 → 在途写入又 mkdir 回来」会留下临时目录垃圾（实测会泄漏 2 个/轮）。
  const cleanup = async () => {
    if (requestCount > 0) {
      await sleep(30);
      rmSync(dir, { recursive: true, force: true });
      await sleep(10);
    }
    rmSync(dir, { recursive: true, force: true });
  };

  return {
    dir,
    auditPath,
    warnings,
    mutateCalls,
    commandDefinitions,
    listeners,
    injectCalls,
    effects,
    settings,
    composition,
    refs,
    command,
    invoke,
    request,
    auditLines,
    waitForAudit,
    cleanup,
  };
}

// ---------------------------------------------------------------------------
// 1. 导出面与命令注册（SPEC 5.2 / 5.2.3；rc.1 settings 契约）
// ---------------------------------------------------------------------------

test('1a 导出面：name / inject / Config 与 rc.1 契约一致', () => {
  // 破坏方式：改名、在 inject 里删掉 agentTeams/commands，或不再导出 Config
  //           （rc.1 的 settings 表单只能由导出 Config 的插件投影出来）。
  assert.equal(pluginName, 'agent-team-model-pin');
  assert.deepEqual(inject, ['agentTeams', 'commands']);
  assert.equal(typeof Config, 'function', 'rc.1 的 settings 表单来自导出的 Config schema');
  assert.equal(typeof Config.toJSON, 'function');
});

test('1b 命令注册：name=team-model 且带 input.hint；只注册一个 agent/request 监听（5.2.3/5.2.4）', (t) => {
  // 破坏方式：apply 里不调 commands.register（或注册名写错）→ command() 抛断言；
  //           去掉 input.hint → hint 断言失败；把 ctx.on 写在循环/重复插桩里 → 监听器数 !== 1。
  const h = makeHarness();
  t.after(h.cleanup);

  const definition = h.command();
  assert.equal(definition.name, TEAM_MODEL);
  assert.equal(typeof definition.input?.hint, 'string');
  assert.match(definition.input.hint, /show/);
  assert.match(definition.input.hint, /clear/);
  assert.equal(typeof definition.handler, 'function');
  assert.equal(h.listeners.filter((entry) => entry.event === 'agent/request').length, 1);
});

test('1c rc.1 settings 契约：Config 投影 volatile sessions/defaults/scope，且不再依赖 installSection', (t) => {
  // 破坏方式：把 sessions/defaults/scope 的 .volatile() 去掉 → rc.1 不会把它们
  //           投进 settings 表单，运行期写入无路可走（1c 与其后的运行期用例一起变红）。
  const h = makeHarness();
  t.after(h.cleanup);

  assert.equal(h.settings.installSection, undefined, 'rc.1 已删除 installSection，插件不得再依赖它');
  // schemastery 的序列化形态是 `{uid, refs}`：根节点在 refs[uid]，子节点用数字 id 引用。
  const json = Config.toJSON();
  const deref = (node) => (typeof node === 'number' ? json.refs[String(node)] : node);
  const root = deref(json.uid);
  assert.equal(root.type, 'object');
  const field = (name) => deref(root.dict[name]);
  assert.equal(field('scope').meta.volatile, true, 'scope 必须是 volatile 才能被 settings 写');
  assert.equal(field('defaults').meta.volatile, true, 'defaults 必须是 volatile 才能出现在表单里');
  const sessions = field('sessions');
  assert.equal(sessions.meta.volatile, true, 'sessions 必须是 volatile 才能按 session 写');
  assert.equal(sessions.type, 'dict');
  assert.equal(deref(sessions.inner).type, 'object');
  assert.equal(field('auditPath').meta?.volatile, undefined, 'auditPath 是部署配置，不参与表单');

  // 插件通过 ctx.get('settings').describe() 读取本入口的 Composition 基线。
  const [entry] = h.settings.describe();
  assert.equal(entry.ns, SETTINGS_NS, 'settings 命名空间就是 Loader 入口 id');
});

// ---------------------------------------------------------------------------
// 2. show（R6 第 1 项）
// ---------------------------------------------------------------------------

test('2a show：无钉时给出「未设置 / 沿用继承路由」语义（R6）', async (t) => {
  // 破坏方式：把 show 分支的 describePin 结果丢掉、返回自己的措辞而不是 describePin()，
  //           或让 show 返回 kind:'error'。
  const h = makeHarness();
  t.after(h.cleanup);

  for (const rawInput of ['', 'show', '  SHOW  ']) {
    const res = await h.invoke(leadAgent, rawInput);
    assert.equal(res.kind, 'success', `rawInput=${JSON.stringify(rawInput)} → ${JSON.stringify(res)}`);
    assert.match(res.text, /未设置/);
    assert.match(res.text, /沿用继承路由/);
  }
});

test('2b show：组合层有钉时文本含该三元组（R6 + R3）', async (t) => {
  // 破坏方式：show 只读运行期层而忽略 Composition 层（describeLayers 里删掉 defaults/sessions 行）→ 文本里没有三元组。
  const h = makeHarness({
    config: { scope: 'teammates', defaults: { provider: 'cpa', model: 'deepseek-flash', reasoningEffort: 'high' } },
  });
  t.after(h.cleanup);

  const res = await h.invoke(leadAgent, 'show');
  assert.equal(res.kind, 'success');
  assert.match(res.text, /provider=cpa/);
  assert.match(res.text, /model=deepseek-flash/);
  assert.match(res.text, /reasoningEffort=high/);
});

test('2c show：set 之后运行期层立即出现在文本里（R5 生效时机）', async (t) => {
  // 破坏方式：set 不写 settings（mutate 未调用）→ show 读不到运行期层 → 只有「未设置」。
  const h = makeHarness();
  t.after(h.cleanup);

  const setRes = await h.invoke(leadAgent, 'cpa deepseek-flash high');
  assert.equal(setRes.kind, 'success', JSON.stringify(setRes));

  const res = await h.invoke(leadAgent, 'show');
  assert.equal(res.kind, 'success');
  assert.match(res.text, /provider=cpa/);
  assert.match(res.text, /model=deepseek-flash/);
  assert.match(res.text, /reasoningEffort=high/);
});

// ---------------------------------------------------------------------------
// 3. set（R6 第 2 项）
// ---------------------------------------------------------------------------

test('3a set 合法：success 且 settings.mutate 恰好一次、参数精确（R6）', async (t) => {
  // 破坏方式：mutate 被调用两次、ns 写错、path 用 agent.id 而非 membership.root.id、
  //           value 里多塞字段（如 temperature）或漏掉 reasoningEffort → deepEqual 失败；
  //           先 mutate 再 assertRouteSelectable → 下面的 3b/3c 零写入断言失败。
  const h = makeHarness();
  t.after(h.cleanup);

  const res = await h.invoke(leadAgent, 'cpa deepseek-flash high');
  assert.equal(res.kind, 'success', JSON.stringify(res));
  assert.equal(h.mutateCalls.length, 1);
  assert.equal(h.mutateCalls[0].ns, SETTINGS_NS);
  assert.deepEqual(h.mutateCalls[0].ops, [
    { op: 'set', path: ['sessions', LEAD_ID], value: { provider: 'cpa', model: 'deepseek-flash', reasoningEffort: 'high' } },
  ]);
});

test('3b set 不带 effort：value 只含 provider+model（R6/R4）', async (t) => {
  // 破坏方式：为缺席的 effort 硬塞 ''、null 或 undefined 字段 → deepEqual 失败。
  const h = makeHarness();
  t.after(h.cleanup);

  const res = await h.invoke(leadAgent, 'cpa deepseek-flash');
  assert.equal(res.kind, 'success', JSON.stringify(res));
  assert.deepEqual(h.mutateCalls[0].ops, [
    { op: 'set', path: ['sessions', LEAD_ID], value: { provider: 'cpa', model: 'deepseek-flash' } },
  ]);

  const { out } = await h.request(teammateAgent);
  assert.equal(out.provider, 'cpa');
  assert.equal(out.model, 'deepseek-flash');
  assert.equal(out.reasoningEffort, undefined, 'R4：换了 route 且 pin 未给 effort → 必须丢弃继承来的 effort');
});

test('3c set：teammate 触发命令时作用键仍是 Lead 会话 id（R2）', async (t) => {
  // 破坏方式：sessionId 取 agent.id（`membership?.root?.id ?? agent.id` 退化为 agent.id）→ path 变成 teammate-1。
  const h = makeHarness();
  t.after(h.cleanup);

  const res = await h.invoke(teammateAgent, 'cpa deepseek-flash');
  assert.equal(res.kind, 'success', JSON.stringify(res));
  assert.deepEqual(h.mutateCalls[0].ops, [
    { op: 'set', path: ['sessions', LEAD_ID], value: { provider: 'cpa', model: 'deepseek-flash' } },
  ]);
});

// ---------------------------------------------------------------------------
// 4. set 非法 route → 零写入（R6 的运行时证据）
// ---------------------------------------------------------------------------

test('4 非法 route：error 且 mutate 次数为 0（零写入）', async (t) => {
  // 破坏方式：把 assertRouteSelectable 的 await 去掉 / 放进 try 外 / 先写后校验，
  //           或把校验失败吞掉仍继续 mutate → mutateCalls.length !== 0。
  const h = makeHarness();
  t.after(h.cleanup);

  const unknownProvider = await h.invoke(leadAgent, 'nope some-model');
  assert.equal(unknownProvider.kind, 'error', JSON.stringify(unknownProvider));
  assert.match(unknownProvider.text, /provider 未注册/);
  assert.equal(h.mutateCalls.length, 0, '校验失败必须零写入');

  const unknownModel = await h.invoke(leadAgent, 'cpa not-a-model');
  assert.equal(unknownModel.kind, 'error', JSON.stringify(unknownModel));
  assert.equal(h.mutateCalls.length, 0, '校验失败必须零写入');

  const badEffort = await h.invoke(leadAgent, 'cpa deepseek-flash ultra');
  assert.equal(badEffort.kind, 'error', JSON.stringify(badEffort));
  assert.match(badEffort.text, /reasoningEffort/);
  assert.equal(h.mutateCalls.length, 0, '校验失败必须零写入');

  // 校验失败后运行期层仍为空：show 必须仍是「未设置」。
  const show = await h.invoke(leadAgent, 'show');
  assert.match(show.text, /未设置/);
});

// ---------------------------------------------------------------------------
// 5. clear 与 R6b 文本
// ---------------------------------------------------------------------------

test('5a clear：unset 精确路径 + 无组合配置时明确「无生效钉」', async (t) => {
  // 破坏方式：clear 走 set 分支、path 写错、或返回 kind:'error' → 断言失败。
  const h = makeHarness();
  t.after(h.cleanup);

  const res = await h.invoke(leadAgent, 'clear');
  assert.equal(res.kind, 'success', JSON.stringify(res));
  assert.equal(h.mutateCalls.length, 1);
  assert.equal(h.mutateCalls[0].ns, SETTINGS_NS);
  assert.deepEqual(h.mutateCalls[0].ops, [{ op: 'unset', path: ['sessions', LEAD_ID] }]);
  assert.match(res.text, /无生效钉/);
});

test('5b R6b：组合配置仍钉住时，clear 文本必须说明「仍被组合配置钉住」', async (t) => {
  // 破坏方式（这正是本任务要固化的缺陷类）：
  //   - 用调用者 role 去解析 Composition 层（scope=teammates + role=lead → undefined），
  //     于是文本退化成「无生效钉」；
  //   - 或干脆不看组合层，永远返回「无生效钉」。
  const h = makeHarness({
    config: {
      scope: 'teammates',
      defaults: { provider: 'cpa', model: 'deepseek-flash' },
      sessions: { [LEAD_ID]: { model: 'per-session-model' } },
    },
  });
  t.after(h.cleanup);

  // 先钉运行期层，再清除：确保 clear 确实写了一次 unset。
  await h.invoke(leadAgent, 'cpa deepseek-flash high');
  h.mutateCalls.length = 0;

  const res = await h.invoke(leadAgent, 'clear');
  assert.equal(res.kind, 'success', JSON.stringify(res));
  assert.deepEqual(h.mutateCalls[0].ops, [{ op: 'unset', path: ['sessions', LEAD_ID] }]);
  assert.match(res.text, /仍被组合配置钉住/, `clear 文本未说明组合层：${res.text}`);
  assert.match(res.text, /per-session-model/);

  // 清除后请求回落到组合层（R6b 的「随后按 R3 继续解析」）。
  const { out } = await h.request(teammateAgent);
  assert.equal(out.provider, 'cpa');
  assert.equal(out.model, 'per-session-model');
});

test('5c clear 只移除运行期层：组合层默认钉仍在（R6b + R3）', async (t) => {
  const h = makeHarness({
    config: { scope: 'teammates', defaults: { provider: 'cpa', model: 'deepseek-flash', reasoningEffort: 'low' } },
  });
  t.after(h.cleanup);

  await h.invoke(leadAgent, 'cpa deepseek-flash high');
  const pinned = await h.request(teammateAgent);
  assert.equal(pinned.out.reasoningEffort, 'high');

  const cleared = await h.invoke(leadAgent, 'clear');
  assert.equal(cleared.kind, 'success');
  assert.match(cleared.text, /仍被组合配置钉住/);

  const after = await h.request(teammateAgent);
  assert.equal(after.out.provider, 'cpa');
  assert.equal(after.out.model, 'deepseek-flash');
  assert.equal(after.out.reasoningEffort, 'low');
});

// ---------------------------------------------------------------------------
// 6. 非法输入 → 零写入
// ---------------------------------------------------------------------------

test('6 非法输入：error 且 mutate 次数为 0', async (t) => {
  // 破坏方式：把 parseCommandInput 的 invalid 分支当 show/set 处理，或先 mutate 再解析 → mutateCalls !== 0。
  const h = makeHarness();
  t.after(h.cleanup);

  for (const rawInput of ['a', 'a b c d', 'duck']) {
    const res = await h.invoke(leadAgent, rawInput);
    assert.equal(res.kind, 'error', `rawInput=${JSON.stringify(rawInput)} → ${JSON.stringify(res)}`);
    assert.equal(typeof res.text, 'string');
    assert.ok(res.text.length > 0);
  }

  // 纯空白等价于 `/team-model` → show（R6 第 1 项），不是非法输入。
  const blank = await h.invoke(leadAgent, '   ');
  assert.equal(blank.kind, 'success', JSON.stringify(blank));

  assert.equal(h.mutateCalls.length, 0, '非法输入必须零写入');
});

// ---------------------------------------------------------------------------
// 7. 请求监听器：R1 生效范围
// ---------------------------------------------------------------------------

test('7a scope=teammates：teammate 被改写、lead 与非成员保持原配置（R1）', async (t) => {
  // 破坏方式：判定不查 role（把 inScope 结果忽略）→ lead 也被改；
  //           或改 pin 时整体替换 config（丢失 temperature）→ 字段保全断言失败；
  //           或无 pin 时返回新对象而非原配置 → deepEqual 仍过，但 identity 断言会红。
  const h = makeHarness({
    config: { scope: 'teammates', defaults: { provider: 'cpa', model: 'deepseek-flash', reasoningEffort: 'high' } },
  });
  t.after(h.cleanup);

  const teammate = await h.request(teammateAgent);
  assert.equal(teammate.out.provider, 'cpa');
  assert.equal(teammate.out.model, 'deepseek-flash');
  assert.equal(teammate.out.reasoningEffort, 'high');
  assert.equal(teammate.out.temperature, 0.25, 'pin 未涉及的字段必须保留');

  const lead = await h.request(leadAgent);
  assert.deepEqual(lead.out, inheritedCall(), 'scope=teammates 下 Lead 不得被钉');
  assert.equal(lead.out, lead.original, '未命中时应原样返回 next() 的配置对象');

  const stranger = await h.request(strangerAgent);
  assert.deepEqual(stranger.out, inheritedCall(), '非成员不得被钉');
  assert.equal(stranger.out, stranger.original);
});

test('7b scope=all：非成员以自身 agent.id 为作用键被钉（R1/R2）', async (t) => {
  // 破坏方式：sessionId 恒取 root（非成员时 undefined → 不钉）→ 该用例变红。
  const h = makeHarness({
    config: { scope: 'all', sessions: { [STRANGER_ID]: { provider: 'cpa', model: 'deepseek-flash' } } },
  });
  t.after(h.cleanup);

  const stranger = await h.request(strangerAgent);
  assert.equal(stranger.out.provider, 'cpa');
  assert.equal(stranger.out.model, 'deepseek-flash');
  assert.equal(stranger.out.reasoningEffort, undefined, '换 route 且无 effort → 丢弃继承 effort（R4）');
});

test('7c 运行期层是活 thunk：外部改写 settings.yaml 后下一次请求即生效（5.2.2 + R3/R5）', async (t) => {
  // 破坏方式：把 setSource 的值在 apply 时快照下来（`const live = current()`），
  //           而不是每次请求调用 thunk → 本例读到的是旧值/初始值。
  const h = makeHarness({
    config: { scope: 'teammates', defaults: { provider: 'cpa', model: 'deepseek-flash' } },
  });
  t.after(h.cleanup);

  const before = await h.request(teammateAgent);
  assert.equal(before.out.model, 'deepseek-flash');

  h.settings.__setUserSessions({ [LEAD_ID]: { model: 'swapped-model' } });

  const after = await h.request(teammateAgent);
  assert.equal(after.out.provider, 'cpa', 'R3 字段级合并：上层只给 model 时 provider 沿用下层');
  assert.equal(after.out.model, 'swapped-model');
});

// ---------------------------------------------------------------------------
// 8. 请求监听器边界：tryMembership 抛错
// ---------------------------------------------------------------------------

test('8 tryMembership 抛错：返回原配置、不抛、记一次告警（失败与边界表第 3 行）', async (t) => {
  // 破坏方式：去掉 tryMembership 周围的 try/catch → 本例 await 直接抛出，测试报错；
  //           或吞掉异常后返回钉住结果 → deepEqual 失败。
  const h = makeHarness({
    config: { scope: 'all', defaults: { provider: 'cpa', model: 'deepseek-flash' } },
    membershipThrows: true,
  });
  t.after(h.cleanup);

  const { original, out } = await h.request(teammateAgent);
  assert.deepEqual(out, original);
  assert.ok(
    h.warnings.some((w) => /团队成员判定失败/.test(w)),
    `应记录一次判定失败告警，实际：${JSON.stringify(h.warnings)}`,
  );
});

// ---------------------------------------------------------------------------
// 9. 审计（SPEC 5.5 + 失败与边界表第 4 行）
// ---------------------------------------------------------------------------

test('9a 命中时追加一行，字段恰为 SPEC 5.5 的 6 个', async (t) => {
  // 破坏方式：字段名写错、多塞字段（如 temperature）、from/to 记成同一个对象、
  //           或只记 hit 不记路由 → 键集合与取值断言失败。
  const h = makeHarness({
    config: { scope: 'teammates', defaults: { provider: 'cpa', model: 'deepseek-flash', reasoningEffort: 'high' } },
  });
  t.after(h.cleanup);

  const { out } = await h.request(teammateAgent);
  assert.equal(out.provider, 'cpa');

  const hits = await h.waitForAudit((rec) => rec.agentId === teammateAgent.id);
  assert.equal(hits.length, 1, `应恰好追加一行，实际：${JSON.stringify(h.auditLines())}`);
  const rec = hits[0];
  assert.deepEqual(Object.keys(rec).sort(), ['agentId', 'at', 'from', 'role', 'sessionId', 'to']);
  assert.equal(rec.sessionId, LEAD_ID, 'sessionId 必须是作用键（Lead 会话 id）');
  assert.equal(rec.role, 'teammate');
  assert.ok(!Number.isNaN(Date.parse(rec.at)), `at 必须是可解析的 ISO8601：${rec.at}`);
  assert.deepEqual(rec.from, { provider: 'inherit-provider', model: 'inherit-model', reasoningEffort: 'low' });
  assert.deepEqual(rec.to, { provider: 'cpa', model: 'deepseek-flash', reasoningEffort: 'high' });
  assert.deepEqual(Object.keys(rec.from).sort(), ['model', 'provider', 'reasoningEffort']);
  assert.deepEqual(Object.keys(rec.to).sort(), ['model', 'provider', 'reasoningEffort']);

  // 未被钉的 Lead 不产生审计行（R1 的审计侧证据）。
  await h.request(leadAgent);
  await sleep(60);
  assert.equal(h.auditLines().filter((line) => line.agentId === LEAD_ID).length, 0);
});

test('9b 审计写入失败：请求仍被钉住、不抛、且只告警一次（失败与边界表第 4 行）', async (t) => {
  // 破坏方式：把审计写进请求路径的 await（IO 失败会连累请求）→ 请求返回非钉住配置或整体抛出；
  //           或每次失败都 warn → 告警计数 > 1。
  const dir = mkdtempSync(join(tmpdir(), 'atmp-cmd-auditfail-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // auditPath 的父路径是一个普通文件 → mkdir 立即 ENOTDIR（不建议用 /proc：那里 mkdir 会挂住）。
  const blocker = join(dir, 'blocker-file');
  writeFileSync(blocker, 'x');

  const h = makeHarness({
    config: { scope: 'teammates', defaults: { provider: 'cpa', model: 'deepseek-flash' }, auditPath: join(blocker, 'audit.jsonl') },
  });
  t.after(h.cleanup);

  const first = await h.request(teammateAgent);
  const second = await h.request(teammateAgent);
  assert.equal(first.out.provider, 'cpa');
  assert.equal(second.out.provider, 'cpa');

  const deadline = Date.now() + 2000;
  while (!h.warnings.some((w) => /审计写入失败/.test(w)) && Date.now() < deadline) await sleep(10);
  await sleep(80);
  assert.equal(
    h.warnings.filter((w) => /审计写入失败/.test(w)).length,
    1,
    `审计失败只应告警一次，实际：${JSON.stringify(h.warnings)}`,
  );
});

// ---------------------------------------------------------------------------
// 10. settings 缺失（失败与边界表第 2 行）
// ---------------------------------------------------------------------------

test('10a settings 缺失：组合层仍生效（Composition 层不受 settings 影响）', async (t) => {
  // 破坏方式：把 Composition 层解析也挂在 settings 上（例如没有 settings 就整个 apply 早退）→ 不再被钉。
  const h = makeHarness({
    config: { scope: 'teammates', defaults: { provider: 'cpa', model: 'deepseek-flash' } },
    withSettings: false,
  });
  t.after(h.cleanup);

  const { out } = await h.request(teammateAgent);
  assert.equal(out.provider, 'cpa');
  assert.equal(out.model, 'deepseek-flash');
});

test('10b settings 缺失：show / set / clear 返回明确错误文本、零写入、不抛（失败与边界表第 2 行）', async (t) => {
  // 破坏方式：settings 缺失时抛 TypeError（读 undefined.mutate）→ 本用例整体报错；
  //           或静默返回 success 却什么都没写 → kind 断言失败。
  const h = makeHarness({
    config: { scope: 'teammates', defaults: { provider: 'cpa', model: 'deepseek-flash' } },
    withSettings: false,
  });
  t.after(h.cleanup);

  const show = await h.invoke(leadAgent, 'show');
  assert.equal(show.kind, 'error', JSON.stringify(show));
  assert.match(show.text, /settings 服务不可用/);
  assert.match(show.text, /Composition/, '错误文本应仍给出组合层解析结果，便于用户判断');

  const set = await h.invoke(leadAgent, 'cpa deepseek-flash high');
  assert.equal(set.kind, 'error', JSON.stringify(set));
  assert.match(set.text, /settings 服务不可用/);

  const clear = await h.invoke(leadAgent, 'clear');
  assert.equal(clear.kind, 'error', JSON.stringify(clear));
  assert.match(clear.text, /settings 服务不可用/);

  assert.equal(h.mutateCalls.length, 0, 'settings 缺失时不得发生任何写入');
  assert.equal(h.settings.installSection, undefined, 'rc.1 无 installSection，缺失 settings 不得走旧注册路径');
});

test('10c settings 缺失 + llm 缺失：set 返回错误文本而不是抛错', async (t) => {
  // 破坏方式：直接 ctx.llm.listProviders()（缺 llm 时抛）或在缺 llm 时仍 mutate → 断言失败。
  const h = makeHarness({ withLlm: false });
  t.after(h.cleanup);

  const res = await h.invoke(leadAgent, 'cpa deepseek-flash');
  assert.equal(res.kind, 'error', JSON.stringify(res));
  assert.match(res.text, /llm 服务不可用/);
  assert.equal(h.mutateCalls.length, 0);
});

// ---------------------------------------------------------------------------
// 11. 额外加固（非 SPEC 明文，但属实现已承诺的健壮性）
// ---------------------------------------------------------------------------

test('11 settings.mutate 拒绝：命令返回 error 文本而不是抛错（加固）', async (t) => {
  // 破坏方式：去掉 mutate 外层 try/catch → handler 抛错，本用例报错。
  const h = makeHarness();
  t.after(h.cleanup);

  h.settings.mutate = async () => {
    throw new Error('persist denied');
  };

  for (const rawInput of ['cpa deepseek-flash high', 'clear']) {
    const res = await h.invoke(leadAgent, rawInput);
    assert.equal(res.kind, 'error', `${rawInput} → ${JSON.stringify(res)}`);
    assert.match(res.text, /persist denied/);
  }

  const show = await h.invoke(leadAgent, 'show');
  assert.equal(show.kind, 'success', '读路径不受写失败影响');
});

test('11b 命令空输入等价于 show；effects 中登记了命令注册（5.2.3）', async (t) => {
  // 破坏方式：apply 里不用 ctx.effect 登记注册（effect 回调数变 0）→ 断言失败。
  const h = makeHarness();
  t.after(h.cleanup);

  const empty = await h.invoke(leadAgent, '');
  const show = await h.invoke(leadAgent, 'show');
  assert.equal(empty.kind, 'success');
  assert.equal(show.kind, 'success');
  assert.equal(empty.text, show.text);
  assert.ok(h.effects.length >= 1, '命令注册应作为 ctx.effect 登记，以便随 fiber 释放');
});