import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { AgentRegistry } from '@deepseek-ai/dsh-agent';
import { AgentLoop } from '@deepseek-ai/dsh-agent-loop';
import { SessionStore } from '@deepseek-ai/dsh-session';
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import * as plugin from '../src/index.ts';

// Exercise the actual Loop -> prompt admission -> frozen LLM request path.
// The model IO boundary deliberately stops AFTER the real request is captured.
test('actual AgentLoop: captured model request and persisted prompt share the selected route', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'atmp-loop-'));
  const root = new Context();
  const owned = [];
  const use = async (entry, config) => { const fiber = await root.plugin(entry, config); owned.push(fiber); return fiber; };
  await use(SessionStore);
  await use(SessionProjectionRegistry);
  await use(AgentRegistry);
  await use(SystemPrompt);
  const requests = [];
  const failures = [];
  const sentinel = new Error('test model IO stopped after capture');
  root.on('agent/error', ({ error }) => failures.push(error));
  let lead;
  let pins = { 'loop-lead': { provider: 'cpa', model: 'deepseek-flash', modelDefault: true } };
  await use({ name: 'loop-test-io', apply(owner) {
    owner.provide('tools', {});
    owner.provide('llm', { async prepareCall(config) {
      return { config, stream(request) { requests.push(request); throw sentinel; } };
    } });
    owner.provide('commands', { register() { return () => {}; } });
    owner.provide('agentTeams', { tryMembership(agent) {
      return { root: agent.id === 'loop-mate' ? lead : agent, id: 'loop-team', name: agent.id, role: agent.id === 'loop-mate' ? 'teammate' : 'lead' };
    } });
    owner.provide('settings', {
      // rc.1: the runtime store is the plugin entry config's volatile `sessions`
      // field; the Loader commits settings writes into the reference in place.
      describe: () => [{ ns: 'agent-team-model-pin', revision: 1,
        base: { scope: 'teammates', defaults: {}, sessions: {} },
        user: { sessions: pins },
        value: { scope: 'teammates', defaults: {}, sessions: pins } }],
      async mutate() {},
    });
  } });
  await use(AgentLoop, {});
  root.get('systemPrompt').section({ name: 'identity-proof', order: 100, text: 'request-identity={{provider}}/{{model}}' });
  const pluginFiber = await use(plugin, { scope: 'teammates', defaults: {}, sessions: pins, auditPath: join(dir, 'audit.jsonl') });
  const liveSessions = pluginFiber.config.sessions;
  const setPins = (value) => { pins = value; liveSessions[Symbol.for('cosmokit.volatile.write')](value); };
  t.after(async () => {
    for (const fiber of owned.reverse()) await fiber.dispose();
    await new Promise((resolve) => setTimeout(resolve, 60));
    await rm(dir, { recursive: true, force: true });
  });
  const loop = root.get('agentLoop');
  lead = await loop.create('loop-lead', { provider: 'cpa', model: 'gpt-6-astra', reasoningEffort: 'max' }, { cwd: dir });
  const mate = await loop.create('loop-mate', { provider: 'cpa', model: 'gpt-6-astra', reasoningEffort: 'max' }, { cwd: dir });
  const run = async () => {
    mate.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'report the model' }] }));
    await mate.whenIdle();
    return requests.at(-1);
  };
  const first = await run();
  assert.equal(requests.length, 1);
  assert.equal(first.provider, 'cpa');
  assert.equal(first.model, 'deepseek-flash');
  assert.equal(first.reasoningEffort, undefined);
  assert.ok(Object.isFrozen(first));
  const text = first.messages.flatMap((message) => message.content.filter((block) => block.type === 'text').map((block) => block.text)).join('\n');
  assert.match(text, /request-identity=cpa\/deepseek-flash/);
  assert.equal(mate.session.requestHeader().config.model, 'deepseek-flash');
  assert.equal(mate.options.model, 'gpt-6-astra');
  setPins({ 'loop-lead': { provider: 'cpa', model: 'gpt-6-astra', reasoningEffort: 'low' } });
  const second = await run();
  assert.equal(requests.length, 2);
  assert.equal(second.model, 'gpt-6-astra');
  assert.equal(second.reasoningEffort, 'low');
  const latestSystem = second.messages.filter((message) => message.role === 'system').at(-1);
  assert.match(latestSystem.content[0].text, /request-identity=cpa\/gpt-6-astra/);
  assert.equal(failures.length, 2);
  assert.ok(failures.every((error) => error === sentinel));
});
