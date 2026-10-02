// Real Cordis Loader + PresetRegistry + AgentLoop + TeamService + JSONL storage.
// Only model IO is stopped at the prepared request boundary; no paid API calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { Loader } from '@deepseek-ai/cordis-plugin-loader';
import { AgentRegistry } from '@deepseek-ai/dsh-agent';
import { AgentLoop } from '@deepseek-ai/dsh-agent-loop';
import PresetRegistry from '@deepseek-ai/dsh-agent-preset-registry';
import { SessionStore } from '@deepseek-ai/dsh-session';
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection';
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import { SessionQueryEngine } from '@deepseek-ai/dsh-session-query';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import TeamService from '@deepseek-ai/dsh-experimental-agent-team';
import * as TeamTools from '@deepseek-ai/dsh-experimental-tool-agent-team';
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { installTeamPresetRuntime } from '../src/preset-runtime.ts';
import * as FullPlugin from '../src/index.ts';
import { loadPatchedSubagent } from './fixtures/preset-host-extension.mjs';

const blocks = text => [{ type: 'text', text }];
const tool = name => ({ name, description: name, parameters: { type: 'object', properties: {} },
  output: { schema: { type: 'string' }, render: (_args, value) => blocks(value) }, execute: async () => name });
const own = agent => agent.session.snapshotEvents(agent.session.inheritedEventCount);
const choices = agent => own(agent).filter(e => e.type === 'agent-preset/selected').map(e => e.data.agentPreset);
const presetOf = (h, agent) => h.root.get('agentPresets').composedPreset(agent.ctx);

async function harness(t, requested = 'beta', fullPlugin = false) {
  const home = await mkdtemp(join(tmpdir(), 'atmp-preset-team-'));
  const extended = await loadPatchedSubagent();
  const root = new Context();
  const handles = [];
  t.after(async () => {
    for (const handle of handles.reverse()) await handle.dispose();
    await root.fiber.dispose();
    await extended.dispose();
    await rm(home, { recursive: true, force: true });
  });
  const use = async (plugin, config) => { const fiber = await root.plugin(plugin, config); await fiber.await(); return fiber; };
  await use(Loader, { baseUrl: new URL('../', import.meta.url).href });
  await use(SessionStore);
  await use(SessionProjectionRegistry);
  await use(AgentRegistry);
  await use(SystemPrompt);
  await use(ToolRuntime);
  await use(JsonlPersistence, { root: join(home, 'sessions'), compression: 'none' });
  await use(SessionQueryEngine);
  const initialized = new Map();
  const requests = [];
  let holdIO = true;
  const requestWaiters = [];
  const requestAfter = count => requests.length > count ? Promise.resolve() : new Promise(resolve => requestWaiters.push(resolve));
  const failures = [];
  const stopIO = new Error('captured model IO');
  root.on('agent/error', ({ error }) => failures.push(error));
  await use({ name: 'preset-team-fixture-io', apply(ctx) {
    ctx.provide('llm', { async prepareCall(config) { return { config, async *stream(request) {
      requests.push(request); for (const wake of requestWaiters.splice(0)) wake();
      if (holdIO) await new Promise(resolve => {
        if (request.signal.aborted) resolve();
        else request.signal.addEventListener('abort', resolve, { once: true });
      });
      request.signal.throwIfAborted();
      throw stopIO;
    } }; } });
    // These policy providers are test inputs; the real delegation code stamps
    // their monotonic child restrictions, whose durable events we assert below.
    ctx.provide('commands', { register() { return () => {}; } });
    ctx.provide('approval', {});
    ctx.provide('sandboxPolicy', { overrideOf: () => 'read-only' });
    ctx.provide('permissionPresets', { current: () => 'auto' });
  } });
  root.get('loader').builtins['fixture-preset'] = {
    name: 'fixture-preset', inject: ['systemPrompt', 'tools'], apply(ctx, config) {
      ctx.systemPrompt.section({ name: 'deployment:persona-prefix', order: 10, text: `PRESET=${config.id}` });
      ctx.tools.register(tool(`probe_${config.id}`));
      ctx.on('agent/created', ({ agent }) => {
        const seen = initialized.get(agent.id) ?? [];
        seen.push(config.id); initialized.set(agent.id, seen);
      });
    },
  };
  await use(PresetRegistry, { default: 'alpha' });
  const registrations = new Map();
  for (const id of ['alpha', 'beta', 'gamma']) {
    registrations.set(id, await root.get('agentPresets').register({ id, plugins: [{ name: 'cordis:fixture-preset', config: { id } }] }));
  }
  await use(AgentLoop, {});
  await use(extended.module.default, {});
  await use(Spawn, { providerName: 'fresh' });
  root.get('subagents').registerProvider({ name: 'fork', inheritsParentContext: true,
    capabilities: { agentOptions: true, outputSchema: false, depthLimit: true, toolFilter: true, persona: true },
    start() { throw new Error('one-shot is not used'); },
    async prepareContinuable({ parent }) { return { seed: parent.session.snapshotEvents() }; },
  });
  await use(TeamService);
  await use(TeamTools, { freshProvider: 'fresh', forkProvider: 'fork' });
  let policy = requested;
  let captures = 0;
  const selector = fullPlugin ? await use(FullPlugin, {
    scope: 'teammates', presetDefault: requested,
    sessions: { lead: { provider: 'pinned', model: 'team-model', reasoningEffort: 'low' } },
    auditPath: join(home, 'audit.jsonl'),
  }) : await use({ name: 'fixture-team-preset-selector', apply(ctx) {
    installTeamPresetRuntime(ctx, () => { captures++; return policy; });
  } });
  const leadHandle = await root.get('agents').create({ sessionId: 'lead', meta: { cwd: home, agentPreset: 'alpha' },
    agentOptions: { provider: 'test', model: 'capture' },
    setup: async (ctx) => { await root.get('agentPresets').mount(ctx, 'alpha'); },
  });
  handles.push(leadHandle);
  const lead = leadHandle.agent;
  const runLead = async () => {
    holdIO = false;
    lead.followup(createUserMessage({ source: { kind: 'user' }, content: blocks('lead history') }));
    await lead.whenIdle();
    holdIO = true;
  };
  let number = 0;
  const spawn = async (context = 'fresh') => {
    const count = requests.length;
    const result = await root.get('agentTeams').spawnTeammate(lead, { name: `worker-${++number}`, description: 'fixture worker',
      prompt: blocks('work'), context, provider: context, signal: new AbortController().signal });
    const child = root.get('agents').get(result.member.id);
    assert.ok(child, 'child stays live until the captured model request is cancelled');
    await requestAfter(count);
    return child;
  };
  const resume = async child => {
    const id = child.id;
    const name = root.get('agentTeams').listMembers(lead).find(row => row.id === id).name;
    await root.get('subagents').drainContinuableChildren(lead, [id]);
    assert.equal(root.get('agents').get(id), undefined);
    const count = requests.length;
    await root.get('agentTeams').sendMessage(lead, { target: name, content: blocks('resume work'), signal: new AbortController().signal });
    const restored = root.get('agents').get(id);
    assert.ok(restored);
    await requestAfter(count);
    return restored;
  };
  return { root, home, initialized, requests, failures, stopIO, lead, selector, registrations, runLead, spawn, resume,
    captures: () => captures, setPolicy: value => { policy = value; } };
}

test('real Team fresh: target preset initializes before publication; tools, delegation and Lead stay isolated', { timeout: 15000 }, async t => {
  const h = await harness(t);
  const child = await h.spawn();
  assert.equal(presetOf(h, child), 'beta');
  assert.equal(presetOf(h, h.lead), 'alpha');
  assert.deepEqual(h.initialized.get(child.id), ['beta']);
  assert.deepEqual(h.initialized.get(h.lead.id), ['alpha']);
  assert.deepEqual(choices(child), ['beta']);
  const tools = h.root.get('tools');
  assert.ok(tools.get('probe_beta', child));
  assert.equal(tools.get('probe_alpha', child), undefined);
  assert.ok(tools.get('send_message', child), 'real Host-level Team tools survive target preset binding');
  const text = h.requests.at(-1).messages.flatMap(m => m.content.filter(b => b.type === 'text').map(b => b.text)).join('\n');
  assert.match(text, /PRESET=beta/);
  assert.doesNotMatch(text, /PRESET=alpha/);
  assert.ok(own(child).some(e => e.type === 'approval/policy' && e.data.policy === 'never'));
  assert.ok(own(child).some(e => e.type === 'sandbox/mode' && e.data.mode === 'read-only'));
  assert.ok(own(child).some(e => e.type === 'permission/preset' && e.data.preset === 'auto'));
  assert.ok(h.failures.every(e => e === h.stopIO));
});

test('real Team fork: inherited history is preserved but only child-owned preset controls new initialization', { timeout: 15000 }, async t => {
  const h = await harness(t);
  h.lead.session.append('agent-preset/selected', { agentPreset: 'alpha' });
  await h.runLead();
  const child = await h.spawn('fork');
  assert.ok(child.session.inheritedEventCount > 0);
  const inherited = child.session.snapshotEvents().slice(0, child.session.inheritedEventCount);
  assert.ok(inherited.some(e => e.type === 'agent-preset/selected' && e.data.agentPreset === 'alpha'));
  assert.ok(inherited.some(e => e.type === 'turn/end'));
  assert.equal(presetOf(h, child), 'beta');
  assert.deepEqual(h.initialized.get(child.id), ['beta']);
  assert.deepEqual(choices(child), ['beta']);
});

test('real Team cold resume: policy changes affect future children only; native restore works after plugin removal', { timeout: 15000 }, async t => {
  const h = await harness(t);
  let first = await h.spawn();
  h.setPolicy('gamma');
  const second = await h.spawn();
  assert.equal(presetOf(h, second), 'gamma');
  assert.equal(presetOf(h, first), 'beta');
  const captures = h.captures();
  first = await h.resume(first);
  assert.equal(h.captures(), captures, 'cold resume never consults current creation policy');
  assert.equal(presetOf(h, first), 'beta');
  assert.deepEqual(choices(first), ['beta']);
  assert.deepEqual(h.initialized.get(first.id), ['beta', 'beta']);
  await h.selector.dispose();
  first = await h.resume(first);
  assert.equal(presetOf(h, first), 'beta', 'native host patch owns restoration even without selecting plugin');
  assert.deepEqual(choices(first), ['beta']);
  assert.ok(h.root.get('tools').get('send_message', first));
});

test('real Team follow pins inherited identity; unknown preset fails creation without model IO', { timeout: 15000 }, async t => {
  const h = await harness(t, null);
  const child = await h.spawn();
  assert.equal(presetOf(h, child), 'alpha');
  assert.deepEqual(choices(child), ['alpha']);
  h.setPolicy('missing-preset');
  const count = h.requests.length;
  await assert.rejects(h.spawn(), /preset|预设/i);
  assert.equal(h.requests.length, count);
  assert.equal(h.root.get('agentTeams').listMembers(h.lead).at(-1).status, 'failed');
});

test('real Team preset choice is frozen before later setup callbacks change future policy', { timeout: 15000 }, async t => {
  const h = await harness(t);
  let changed = false;
  h.root.get('subagents').registerChildSetup(() => {
    if (!changed) { changed = true; h.setPolicy('gamma'); }
  });
  const first = await h.spawn();
  assert.equal(presetOf(h, first), 'beta');
  assert.deepEqual(choices(first), ['beta']);
  const second = await h.spawn();
  assert.equal(presetOf(h, second), 'gamma');
});

test('real Team missing persisted preset refuses cold resume instead of changing identity', { timeout: 15000 }, async t => {
  const h = await harness(t);
  const child = await h.spawn();
  await h.root.get('subagents').drainContinuableChildren(h.lead, [child.id]);
  await h.registrations.get('beta')();
  h.setPolicy('gamma');
  const count = h.requests.length;
  // Team mailbox may retain a failed delivery as queued; inspect the underlying
  // direct-child delivery boundary, which must reject the invalid restore.
  await assert.rejects(h.root.get('subagents').sendMessage(h.lead, child.id, blocks('retry'),
    { signal: new AbortController().signal }), /unavailable|preset|预设/i);
  assert.equal(h.root.get('agents').get(child.id), undefined);
  assert.equal(h.requests.length, count);
  assert.equal(presetOf(h, h.lead), 'alpha');
});

test('real ordinary continuable subagent is not affected by Team creation policy', { timeout: 15000 }, async t => {
  const h = await harness(t);
  const result = await h.root.get('subagents').startContinuable({ provider: 'fresh', label: 'ordinary child',
    request: { parent: h.lead, prompt: blocks('ordinary') }, signal: new AbortController().signal });
  const child = h.root.get('agents').get(result.childId);
  assert.ok(child);
  assert.equal(presetOf(h, child), 'alpha');
  assert.deepEqual(h.initialized.get(child.id), ['alpha']);
  assert.deepEqual(choices(child), []);
  assert.equal(h.captures(), 0);
  assert.equal(h.root.get('agentTeams').tryMembership(child), undefined);
});


test('complete plugin: creation preset and request-time model/effort pins coexist on real Team child', { timeout: 15000 }, async t => {
  const h = await harness(t, 'beta', true);
  const child = await h.spawn();
  assert.equal(presetOf(h, child), 'beta');
  assert.deepEqual(h.initialized.get(child.id), ['beta']);
  assert.deepEqual(choices(child), ['beta']);
  const request = h.requests.at(-1);
  assert.equal(request.provider, 'pinned');
  assert.equal(request.model, 'team-model');
  assert.equal(request.reasoningEffort, 'low');
  assert.equal(h.lead.options.model, 'capture');
  assert.equal(presetOf(h, h.lead), 'alpha');
});
