import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { agentEvents, assembleContextFor, installModelSelection } from '@deepseek-ai/dsh-agent';
import { createScope } from '@deepseek-ai/dsh-scope';
import { SystemPrompt, renderPrompt } from '@deepseek-ai/dsh-system-prompt';
import * as plugin from '../src/index.ts';

// Real dispatcher, scopes, interpolation, and native model selector.
// Only commands, settings persistence and roster data are external IO fixtures.
async function harness(t, initial = {}, config = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'atmp-sync-'));
  const root = new Context();
  const promptFiber = await root.plugin(SystemPrompt, {});
  const prompts = root.get('systemPrompt');
  prompts.variable('provider', ({ agent }) => agent?.options.provider);
  prompts.variable('model', ({ agent }) => agent?.options.model);
  prompts.section({ name: 'identity', order: 100, text: 'provider={{provider}}; model={{model}}' });
  const agents = new Map();
  const memberships = new Map();
  const scopes = [];
  let pins = initial;
  let fiber;
  const providers = await root.plugin({ name: 'sync-test-services', apply(owner) {
    owner.provide('agents', { list: () => [...agents.values()], get: (id) => agents.get(id) });
    owner.provide('agentTeams', { tryMembership: (agent) => memberships.get(agent) });
    owner.provide('commands', { register() { return () => {}; } });
    owner.provide('settings', {
      describe: () => [{ ns: 'agent-team-model-pin', revision: 1,
        base: { scope: 'teammates', defaults: {}, sessions: {} },
        user: { sessions: pins },
        value: { scope: 'teammates', defaults: {}, sessions: pins } }],
      async mutate() {},
    });
  } });
  const make = async (id, { lead, header, options, source = 'startup' } = {}) => {
    let currentHeader = header;
    const session = { id, header: { cwd: process.cwd(), ...(lead ? { parentSession: lead.id } : {}) }, requestHeader: () => currentHeader };
    const agent = { id, session, options: Object.freeze(options ?? { provider: 'cpa', model: 'gpt-6-astra', reasoningEffort: 'max' }) };
    const scope = createScope(root, agent);
    scopes.push(scope);
    agent.ctx = scope.ctx;
    agents.set(id, agent);
    memberships.set(agent, { root: lead ?? agent, id: `team:${lead?.id ?? id}`, role: lead ? 'teammate' : 'lead', name: id });
    agent.commit = (cfg) => {
      currentHeader = { config: { ...cfg } };
      root.emit('session/event', session, { type: 'request/header', data: { header: currentHeader, reason: 'change' } });
    };
    agent.drop = async () => {
      agents.delete(id);
      await scope.dispose();
      agentEvents(root, agent).emit('agent/disposed', {});
    };
    if (fiber) await agentEvents(root, agent).serial('agent/created', { source });
    return agent;
  };
  const lead = await make('lead-A');
  const existing = await make('existing', { lead });
  fiber = await root.plugin(plugin, { scope: 'teammates', defaults: {}, sessions: initial, ...config, auditPath: join(dir, 'audit.jsonl') });
  // The real schema resolution produced the volatile store reference the plugin
  // reads; committing into it models one Loader settings write.
  const liveSessions = fiber.config.sessions;
  const counters = new Map();
  const prepare = async (agent, { base, signal, turn = 1, beforeAdmission } = {}) => {
    const step = (counters.get(agent) ?? 0) + 1;
    counters.set(agent, step);
    const control = signal ?? new AbortController().signal;
    const payload = { turn, step, signal: control };
    const assembly = await prompts.assemble(assembleContextFor(agent, control));
    if (beforeAdmission) await beforeAdmission();
    const user = { id: `user:${agent.id}:${step}`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'continue' }] };
    const decision = await agentEvents(root, agent).waterfall('agent/pre-step', { ...payload, messages: [user] }, async () => ({ kind: 'enter', messages: [user] }));
    const text = renderPrompt(assembly);
    const request = async ({ commit = true } = {}) => {
      const inherited = typeof base === 'function' ? base() : base ?? agent.session.requestHeader()?.config ?? { ...agent.options, temperature: 0.3 };
      const value = await agentEvents(root, agent).waterfall('agent/request', payload, async () => Object.freeze({ ...inherited }));
      if (commit) agent.commit(value);
      return value;
    };
    return { text, assembly, decision, request, payload, user };
  };
  t.after(async () => {
    await fiber.dispose();
    for (const scope of scopes.reverse()) await scope.dispose();
    await providers.dispose();
    await promptFiber.dispose();
    await new Promise((resolve) => setTimeout(resolve, 70));
    await rm(dir, { recursive: true, force: true });
  });
  return { root, prompts, lead, existing, make, prepare,
    setPins(value) { pins = value; liveSessions[Symbol.for('cosmokit.volatile.write')](value); },
    unload: () => fiber.dispose(),
    async audit() { await new Promise((resolve) => setTimeout(resolve, 40)); return (await readFile(join(dir, 'audit.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); },
  };
}
const flash = { provider: 'cpa', model: 'deepseek-flash', modelDefault: true };

test('sync: existing teammate prompt and request both use the Team model', async (t) => {
  const h = await harness(t, { 'lead-A': flash });
  const step = await h.prepare(h.existing);
  assert.match(step.text, /model=deepseek-flash/);
  const cfg = await step.request();
  assert.equal(cfg.model, 'deepseek-flash');
  assert.equal(cfg.reasoningEffort, undefined);
  assert.equal(cfg.temperature, 0.3);
  assert.equal(h.existing.options.model, 'gpt-6-astra');
});

test('sync: setting changes and retries cannot split the current step', async (t) => {
  const h = await harness(t, { 'lead-A': flash });
  const step = await h.prepare(h.existing);
  h.setPins({ 'lead-A': { provider: 'other', model: 'next-model', reasoningEffort: 'low' } });
  assert.equal((await step.request()).model, 'deepseek-flash');
  assert.equal((await step.request()).model, 'deepseek-flash');
  const next = await h.prepare(h.existing);
  assert.match(next.text, /provider=other; model=next-model/);
  assert.equal((await next.request()).reasoningEffort, 'low');
});

test('sync: two Teams and the Lead have independent prompt variables', async (t) => {
  const h = await harness(t, { 'lead-A': flash, 'lead-B': { provider: 'p2', model: 'm2', reasoningEffort: 'high' } });
  const secondLead = await h.make('lead-B');
  const second = await h.make('mate-B', { lead: secondLead });
  const [a, b, main] = await Promise.all([h.prepare(h.existing), h.prepare(second), h.prepare(h.lead)]);
  assert.match(a.text, /model=deepseek-flash/);
  assert.match(b.text, /provider=p2; model=m2/);
  assert.match(main.text, /model=gpt-6-astra/);
  assert.equal((await main.request()).model, 'gpt-6-astra');
  assert.equal((await b.request()).model, 'm2');
  assert.equal((await a.request()).model, 'deepseek-flash');
});

test('sync: fresh and resumed teammates get the first-step override', async (t) => {
  const h = await harness(t, { 'lead-A': flash });
  const first = await h.make('fresh', { lead: h.lead });
  const initial = await h.prepare(first);
  assert.match(initial.text, /model=deepseek-flash/);
  await initial.request();
  await first.drop();
  const resumed = await h.make('fresh', { lead: h.lead, source: 'resume', header: { config: { provider: 'stale', model: 'stale-model' } } });
  const next = await h.prepare(resumed);
  assert.match(next.text, /model=deepseek-flash/);
  assert.equal((await next.request()).model, 'deepseek-flash');
});

test('sync: preview assembly does not replace an admitted step snapshot', async (t) => {
  const h = await harness(t, { 'lead-A': flash });
  const step = await h.prepare(h.existing);
  h.setPins({ 'lead-A': { provider: 'p2', model: 'preview-model' } });
  const preview = renderPrompt(await h.prompts.assemble(assembleContextFor(h.existing)));
  assert.match(preview, /model=preview-model/);
  assert.equal((await step.request()).model, 'deepseek-flash');
});

test('sync: clearing a pin follows and snapshots the Lead route', async (t) => {
  const h = await harness(t, { 'lead-A': flash });
  await (await h.prepare(h.existing)).request();
  h.lead.commit({ provider: 'main', model: 'main-model', reasoningEffort: 'high' });
  h.setPins({});
  const next = await h.prepare(h.existing);
  assert.match(next.text, /provider=main; model=main-model/);
  h.lead.commit({ provider: 'changed', model: 'later-model' });
  const request = await next.request();
  assert.equal(request.model, 'main-model');
  assert.equal(request.reasoningEffort, 'high');
});

test('sync: legacy effort-only pin keeps the teammate route across steps', async (t) => {
  const h = await harness(t, { 'lead-A': { reasoningEffort: 'low' } });
  h.lead.commit({ provider: 'unrelated', model: 'leader-model' });
  const first = await h.prepare(h.existing);
  assert.match(first.text, /model=gpt-6-astra/);
  assert.equal((await first.request()).reasoningEffort, 'low');
  h.existing.commit({ provider: 'own', model: 'own-model', reasoningEffort: 'high' });
  const next = await h.prepare(h.existing);
  assert.match(next.text, /provider=own; model=own-model/);
  assert.equal((await next.request()).model, 'own-model');
});

test('sync: native selector and notices agree with the effective Team route', async (t) => {
  const h = await harness(t, { 'lead-A': flash });
  const native = { current: { provider: 'native', model: 'native-model', reasoningEffort: 'high' }, assembled: undefined };
  const stop = installModelSelection(h.existing.ctx, native);
  t.after(stop);
  h.existing.commit({ provider: 'before', model: 'before-model' });
  const step = await h.prepare(h.existing);
  assert.match(step.text, /model=deepseek-flash/);
  assert.equal((await step.request()).model, 'deepseek-flash');
  // DSH 0.1.7-rc.1 tags the durable model-switch notice with source.kind
  // 'model-selection'; 0.1.6-alpha.2 used kind 'plugin' + plugin 'model-selection'.
  const notices = step.decision.messages.filter((message) => message.source?.kind === 'model-selection');
  assert.equal(notices.length, 1);
  assert.match(notices[0].content[0].text, /deepseek-flash/);
  assert.doesNotMatch(notices[0].content[0].text, /native-model/);
  assert.ok(step.decision.messages.includes(step.user));
});

test('sync: partial pin respects the ordinary selected route', async (t) => {
  const h = await harness(t, { 'lead-A': { reasoningEffort: 'low' } });
  const native = { current: { provider: 'native', model: 'native-model', reasoningEffort: 'high' }, assembled: undefined };
  const stop = installModelSelection(h.existing.ctx, native);
  t.after(stop);
  const step = await h.prepare(h.existing);
  assert.match(step.text, /provider=native; model=native-model/);
  const cfg = await step.request();
  assert.equal(cfg.model, 'native-model');
  assert.equal(cfg.reasoningEffort, 'low');
});

test('sync: unloading removes selection and notice hooks', async (t) => {
  const h = await harness(t, { 'lead-A': flash });
  await (await h.prepare(h.existing)).request();
  await h.unload();
  const next = await h.prepare(h.existing, { base: { provider: 'cpa', model: 'gpt-6-astra' } });
  assert.match(next.text, /model=gpt-6-astra/);
  assert.equal((await next.request()).model, 'gpt-6-astra');
  assert.equal(next.decision.messages.length, 1);
});

test('sync: audit preserves the pre-override and selected routes', async (t) => {
  const h = await harness(t, { 'lead-A': flash });
  await (await h.prepare(h.existing)).request();
  const records = await h.audit();
  assert.equal(records.length, 1);
  assert.equal(records[0].from.model, 'gpt-6-astra');
  assert.equal(records[0].to.model, 'deepseek-flash');
  assert.deepEqual(Object.keys(records[0]).sort(), ['at', 'sessionId', 'agentId', 'role', 'from', 'to'].sort());
});

test('sync: cold resume uses construction route before its first header', async (t) => {
  const h = await harness(t, { 'lead-A': { reasoningEffort: 'low' } });
  const agent = await h.make('cold', { lead: h.lead, source: 'resume', header: { config: { provider: 'old', model: 'old-model' } } });
  const step = await h.prepare(agent, { base: { ...agent.options, temperature: 0.3 } });
  assert.match(step.text, /provider=cpa; model=gpt-6-astra/);
  assert.equal((await step.request()).model, 'gpt-6-astra');
});

test('sync: scoped request without an assembled admission is rejected', async (t) => {
  const h = await harness(t, { 'lead-A': flash });
  await assert.rejects(agentEvents(h.root, h.existing).waterfall('agent/request', {
    turn: 1, step: 1, signal: new AbortController().signal,
  }, async () => ({ ...h.existing.options })), /snapshot|组装/i);
});

test('sync: late route-only changes cannot send mismatched model identity', async (t) => {
  const h = await harness(t, { 'lead-A': { reasoningEffort: 'low' } });
  const stop = h.existing.ctx.on('agent/request', async (_payload, next) => ({ ...await next(), provider: 'late', model: 'late-model' }));
  t.after(stop);
  const step = await h.prepare(h.existing);
  await assert.rejects(step.request(), /conflict|不一致|失配/i);
});

test('sync: preview before admission does not steal the execution selection', async (t) => {
  const h = await harness(t, { 'lead-A': flash });
  const step = await h.prepare(h.existing, { beforeAdmission: async () => {
    h.setPins({ 'lead-A': { provider: 'other', model: 'preview' } });
    await h.prompts.assemble(assembleContextFor(h.existing));
  } });
  assert.match(step.text, /model=deepseek-flash/);
  assert.equal((await step.request()).model, 'deepseek-flash');
});
