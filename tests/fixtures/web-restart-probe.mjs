import assert from 'node:assert/strict';
import { realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [installation, profileDir, phase] = process.argv.slice(2);
assert.ok(['create', 'resume'].includes(phase));
const fromInstall = (name) => import(pathToFileURL(join(installation, 'node_modules', name, 'lib/index.js')).href);
const { runProfile } = await import(pathToFileURL(join(installation, 'lib/profile-boot.js')).href);
const { loadProfileDirectory } = await fromInstall('@deepseek-ai/dsh-app-boot');
const { createLaunchEnvironmentSnapshot } = await fromInstall('@deepseek-ai/dsh-launch-environment');
const { LlmAdapter, createUserMessage } = await fromInstall('@deepseek-ai/dsh-llm');
const installRequire = createRequire(join(installation, 'package.json'));
const packageName = '@lolkda/dsh-agent-team-model-pin';
const provider = 'atmp-offline-debug';
const primaryId = 'session-atmp-restart-primary';
const secondaryId = 'session-atmp-restart-secondary';
const requests = [];
const failures = [];
const handles = [];
let ctx;
let stage = 'boot';
let result;

// Real adapter contract, but deterministic local output: never provider/network IO.
class OfflineAdapter extends LlmAdapter {
  providerInfo(id) { return { id, name: 'ATMP offline restart test' }; }
  async resolveModel(selectedProvider, model) {
    return { provider: selectedProvider, id: model, name: model,
      context: { contextWindow: 1000000 }, inputModalities: ['text'],
      reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] },
    };
  }
  async *stream(options) {
    const system = options.messages.filter((message) => message.role === 'system')
      .flatMap((message) => message.content.filter((block) => block.type === 'text').map((block) => block.text)).join('\n');
    assert.ok(Object.isFrozen(options), 'real AgentLoop must freeze the provider request');
    assert.ok(system.includes(`ATMP_DEBUG_IDENTITY=${options.provider}/${options.model}`),
      'the persisted system prompt must identify the exact provider request route');
    requests.push({ sessionId: options.sessionId, provider: options.provider, model: options.model,
      ...(options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort }), promptMatchesRoute: true });
    const text = `OFFLINE_REPLY ${phase} ${options.model}`;
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'block-end', index: 0, block: { type: 'text', text } };
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

try {
  const environment = createLaunchEnvironmentSnapshot([{ source: 'process', values: Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => value !== undefined),
  ) }]);
  const profile = loadProfileDirectory('atmp-web-restart', profileDir, join(installation, 'package.json'));
  ({ ctx } = await runProfile({ environment, profile: 'model-pin-debug',
    resolvedProfile: { profile, installAnchor: join(installation, 'package.json') },
    args: ['--no-open', '--host', '127.0.0.1', '--port', '0'], patchFiles: [],
  }));
  stage = 'activation';
  const entry = [...ctx.get('loader').entries()].find((item) => item.options.name === packageName);
  assert.equal(entry?.fiber?.state, 2, 'candidate Host plugin must be active');
  assert.ok(ctx.get('clientModules').clientPath(packageName), 'the full Web boot must discover the Client artifact');
  const coreModules = {};
  for (const name of ['dsh-agent', 'dsh-scope', 'dsh-system-prompt', 'dsh-agent-presets', 'dsh-agent-loop']) {
    const packageId = `@deepseek-ai/${name}`;
    const resolved = ctx.get('pluginPackages').packageOf(packageId, pathToFileURL(join(profileDir, 'package.json')).href);
    const expected = await realpath(dirname(installRequire.resolve(`${packageId}/package.json`)));
    assert.equal(await realpath(resolved.dir), expected, `${packageId} must remain deployment-owned`);
    coreModules[packageId] = expected;
  }
  const baseUrl = `http://127.0.0.1:${ctx.get('webServer').port}`;
  let page = await fetch(ctx.get('connection').authenticatedUrl(baseUrl), { redirect: 'manual', signal: AbortSignal.timeout(5000) });
  if (page.headers.has('location')) {
    const cookie = page.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    page = await fetch(new URL(page.headers.get('location'), baseUrl), { headers: { cookie }, signal: AbortSignal.timeout(5000) });
  }
  assert.equal(page.status, 200, 'the independently started DSH must serve its own Web page');
  const html = await page.text();
  assert.match(html, /__DSH_BOOT__/);
  assert.ok(html.includes(packageName), 'served boot graph must include the candidate Client');
  ctx.on('agent/error', ({ error }) => { failures.push({ message: String(error), stack: error?.stack }); });
  ctx.get('llm').registerAdapter([provider], new OfflineAdapter());
  const setup = async (agentCtx) => {
    await ctx.get('agentPresets').mount(agentCtx, 'cordis');
    agentCtx.systemPrompt.section({ name: 'atmp-debug-identity', order: 999999,
      text: 'ATMP_DEBUG_IDENTITY={{provider}}/{{model}}' });
  };
  const acquire = async (id) => {
    const options = { provider, model: 'main-model', reasoningEffort: 'high' };
    const handle = phase === 'create'
      ? await ctx.get('agentLoop').createAgent(ctx, {
        sessionId: id, meta: { cwd: profileDir, agentPreset: 'cordis' }, agentOptions: options, setup,
      })
      : await ctx.get('agentLoop').resume(ctx, { resumeSessionId: id, agentOptions: options, setup });
    handles.push(handle);
    assert.equal(ctx.get('agentPresets').composedPreset(handle.agent.ctx), 'cordis');
    return handle.agent;
  };
  const converse = async (agent, expectedModel, expectedEffort) => {
    const count = requests.length;
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: `offline restart smoke: ${phase}` }] }));
    await agent.whenIdle();
    assert.deepEqual(failures, [], 'no Agent error may be swallowed');
    assert.equal(requests.length, count + 1, 'one completed offline model request per conversation');
    const request = requests.at(-1);
    assert.equal(request.model, expectedModel);
    assert.equal(request.reasoningEffort, expectedEffort);
    assert.equal(agent.session.requestHeader().config.model, expectedModel);
    const assistant = agent.session.deriveMessages().filter((message) => message.role === 'assistant').at(-1);
    assert.equal(assistant?.content[0]?.text, `OFFLINE_REPLY ${phase} ${expectedModel}`);
    assert.equal(await ctx.get('sessions').flush(agent.session), true, 'real persistence must participate');
  };
  stage = phase === 'create' ? 'create-shipped-preset' : 'cold-resume-shipped-preset';
  const primary = await acquire(primaryId);
  const secondary = await acquire(secondaryId);
  let restoredMessages = 0;
  if (phase === 'create') {
    await converse(primary, 'main-model', 'high');
    await ctx.get('settings').mutate('agent-team-model-pin', [{ op: 'set', path: ['sessions', primaryId],
      value: { provider, model: 'team-pinned', modelDefault: true } }]);
  } else {
    restoredMessages = primary.session.deriveMessages().filter((message) => message.role === 'assistant').length;
    assert.equal(restoredMessages, 2, 'two first-process responses must survive actual disk resume');
    assert.equal(ctx.get('settings').get('agent-team-model-pin').sessions[primaryId].model, 'team-pinned',
      'the per-session pin must survive a new DSH process');
  }
  stage = 'conversation';
  await converse(primary, 'team-pinned', undefined);
  await converse(secondary, 'main-model', 'high');
  assert.equal(primary.options.model, 'main-model', 'the plugin must not rewrite Agent construction options');
  result = { phase, status: 'passed', pid: process.pid, url: baseUrl, hostActive: true, clientDiscovered: true,
    shippedPreset: 'cordis', restoredMessages, requests, failures, coreModules };
} catch (error) {
  result = { phase, stage, status: 'failed', pid: process.pid, error: String(error), stack: error.stack, requests, failures };
  process.exitCode = 1;
} finally {
  for (const handle of handles.reverse()) await handle.dispose();
  await ctx?.fiber.dispose();
  console.log('ATMP_WEB_RESTART=' + JSON.stringify(result));
}
