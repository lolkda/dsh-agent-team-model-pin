import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import TypertRegistry from '@deepseek-ai/dsh-typert-registry';
import { TypertGatewayService } from '@deepseek-ai/dsh-api-gateway';
import * as ClientRemote from '../node_modules/@deepseek-ai/dsh-api-gateway/lib/types/client/index.js';
import { installTeamSettingsRpc } from '../src/team-settings-rpc.ts';
import { TEAM_SETTINGS_REMOTE } from '../src/team-settings-remote.ts';

test('real public Gateway mounts plugin RPC without a Host slash command or native modification', async t => {
  const host = new Context(), client = new Context();
  t.after(async () => { await client.fiber.dispose(); await host.fiber.dispose(); });
  await host.plugin(TypertRegistry); await host.plugin(TypertGatewayService, {});
  const lead = { id: 'lead' }; const calls = [];
  await host.get('typert').lookups.register('agent', { parameter: 'agent', wire: 'agentId', hostTypeSymbol: 'Agent', wireTypeSymbol: 'SessionId', resolve: id => id === lead.id ? lead : undefined });
  let owner;
  owner = await host.plugin({ name: 'test-team-settings', apply(ctx) {
    installTeamSettingsRpc(ctx, { model: async input => { calls.push(input); return { kind: 'success', text: 'model' }; },
      preset: async input => { calls.push(input); return { kind: 'success', text: input.rawInput }; } });
  } });
  const gateway = host.get('typertGateway');
  const direct = await gateway.invoke({ namespace: 'teamSettings', method: 'preset', args: { agentId: 'lead', revision: 7, choice: '标准 "quoted"' } });
  assert.equal(direct.kind, 'success');
  assert.equal(calls[0].agent, lead);
  assert.equal(calls[0].rawInput, 'apply 7 "标准 \\"quoted\\""');
  assert.ok(calls[0].signal instanceof AbortSignal);
  await assert.rejects(gateway.invoke({ namespace: 'teamSettings', method: 'preset', args: { agentId: 'absent', revision: 7, choice: 'x' } }));
  await assert.rejects(gateway.invoke({ namespace: 'teamSettings', method: 'preset', args: { agentId: 'lead', revision: 7, choice: 'x', extra: true } }));
  assert.equal((await gateway.invoke({ namespace: 'teamSettings', method: 'preset', args: { agentId: 'lead', revision: -1, choice: 'x' } })).kind, 'error');
  await client.plugin(TypertRegistry);
  await client.plugin({ name: 'test-rpc-carrier', apply(ctx) {
    ctx.provide('connection', { start: () => ({ stop() {} }), registerGenerationSource: () => () => {},
      rpc: { open() { throw new Error('streams are not used'); }, async call(prefix, endpoint, payload, signal) {
        assert.equal(prefix, '/api'); const [namespace, method] = endpoint.split('/');
        return { ok: true, value: await gateway.invoke({ namespace, method, args: payload.args, signal }) };
      } },
    });
  } });
  await client.plugin(ClientRemote);
  const stop = await client.get('remote').$mount(TEAM_SETTINGS_REMOTE);
  const remote = client.get('remote.teamSettings');
  assert.equal((await remote.preset('lead', 8, null)).value.kind, 'success');
  assert.equal(calls.at(-1).rawInput, 'apply 8 null');
  assert.equal((await remote.model('lead', 'show')).value.text, 'model');
  const aborted = new AbortController(); aborted.abort(new Error('cancelled'));
  const count = calls.length;
  assert.equal((await remote.preset('lead', 9, 'x', aborted.signal)).ok, false);
  assert.equal(calls.length, count);
  await stop();
  assert.equal(remote.preset, undefined, 'withdrawn namespace exposes no callable save method');
  await owner.dispose();
  await assert.rejects(gateway.invoke({ namespace: 'teamSettings', method: 'preset', args: { agentId: 'lead', revision: 8, choice: null } }));
});
