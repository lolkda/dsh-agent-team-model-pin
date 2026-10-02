import test from 'node:test';
import assert from 'node:assert/strict';
import { installPresetCommand } from '../src/preset-command.ts';
import { parsePresetSave, resolvePresetPolicy } from '../src/preset-policy.ts';

const NS = 'agent-team-model-pin';
function harness(options = {}) {
  let definition;
  const settings = { presetDefault: 'base', presetSessions: {}, sessions: { lead: { provider: 'p', model: 'm', reasoningEffort: 'high' } } };
  let revision = 7;
  const writes = [];
  const presets = new Map([['coder', { id: 'coder', name: 'Coder' }], ['broken', { id: 'broken', broken: 'cannot mount' }], ['show', { id: 'show' }]]);
  const catalog = {
    async resolve(id) { await options.onResolve?.(); if (!presets.has(id)) throw new Error('unknown preset'); return presets.get(id); },
  };
  const service = {
    describe: () => [{ ns: NS, revision }],
    async mutate(ns, ops, expected) {
      if (options.readOnly) throw new Error('read only');
      if (revision !== expected) throw new Error('settings/conflict');
      assert.equal(ns, NS);
      writes.push({ ops, expected });
      for (const op of ops) {
        assert.equal(op.path[0], 'presetSessions');
        if (op.op === 'set') settings.presetSessions[op.path[1]] = op.value;
        else delete settings.presetSessions[op.path[1]];
      }
      revision++;
    },
  };
  const host = {
    get(name) { return ({ settings: options.noSettings ? undefined : service, agentPresets: options.noPresets ? undefined : catalog,
      subagents: options.unsupported ? {} : { childSetupVersion: 1, registerChildSetup() {} } })[name]; },
    agentTeams: { tryMembership(agent) { return agent.id === 'stranger' ? undefined : { root: { id: agent.id === 'mate' ? 'lead' : agent.id }, role: agent.id === 'mate' ? 'teammate' : 'lead' }; } },
    commands: { register(value) { definition = value; return () => { definition = undefined; }; } },
    effect(callback) { return callback(); },
  };
  installPresetCommand(host, () => NS);
  return { definition, settings, writes, service, catalog, presets, bump: () => { revision++; },
    invoke: (rawInput, agent = 'lead', signal = new AbortController().signal) => definition.handler({ agent: { id: agent }, rawInput, signal }) };
}

test('preset policy: explicit null overrides defaults; own keys only; invalid values fail loudly', () => {
  assert.equal(resolvePresetPolicy('coder', {}, 'lead'), 'coder');
  assert.equal(resolvePresetPolicy('coder', { lead: null }, 'lead'), null);
  assert.equal(resolvePresetPolicy('coder', Object.create({ lead: 'inherited-prototype' }), 'lead'), 'coder');
  assert.equal(resolvePresetPolicy(undefined, {}, 'lead'), undefined);
  assert.equal(resolvePresetPolicy('base', { lead: ' coder ' }, 'lead'), 'coder');
  assert.throws(() => resolvePresetPolicy('base', { lead: '' }, 'lead'), /非空/);
  assert.throws(() => resolvePresetPolicy('base', [], 'lead'), /对象/);
});

test('internal popup save parsing accepts only strict CAS payloads, not manual preset commands', () => {
  assert.deepEqual(parsePresetSave('apply 7 "coder"'), { revision: 7, choice: 'coder' });
  assert.deepEqual(parsePresetSave('apply 7 null'), { revision: 7, choice: null });
  for (const input of ['', 'set', 'set coder', 'list', 'show', 'clear', 'follow', 'coder',
    'apply -1 "coder"', 'apply 9007199254740992 "coder"', 'apply 7 {}', 'apply 7 true', 'apply 7 ""', 'apply 7 undefined']) {
    assert.equal(parsePresetSave(input), undefined, input);
  }
});

test('Host preset save uses Lead ID, opening revision, and preserves model/effort + other sessions', async () => {
  const h = harness();
  h.settings.presetSessions.other = 'other-preset';
  const beforeModel = structuredClone(h.settings.sessions);
  assert.equal((await h.invoke('apply 7 "coder"', 'mate')).kind, 'success');
  assert.equal(h.settings.presetSessions.lead, 'coder');
  assert.equal(h.settings.presetSessions.mate, undefined);
  assert.equal(h.settings.presetSessions.other, 'other-preset');
  assert.deepEqual(h.settings.sessions, beforeModel);
  assert.equal(h.writes[0].expected, 7);
});

test('popup follow selection writes explicit null without clearing unrelated settings', async () => {
  const h = harness();
  h.settings.presetSessions.lead = 'coder';
  const beforeModel = structuredClone(h.settings.sessions);
  assert.equal((await h.invoke('apply 7 null')).kind, 'success');
  assert.equal(h.settings.presetSessions.lead, null);
  assert.equal(resolvePresetPolicy(h.settings.presetDefault, h.settings.presetSessions, 'lead'), null);
  assert.deepEqual(h.settings.sessions, beforeModel);
});

for (const [label, options, input, pattern] of [
  ['unsupported host', { unsupported: true }, 'apply 7 "coder"', /创建前预设接口/],
  ['missing registry', { noPresets: true }, 'apply 7 "coder"', /agentPresets/],
  ['missing settings', { noSettings: true }, 'apply 7 "coder"', /settings/],
  ['read-only', { readOnly: true }, 'apply 7 "coder"', /read only/],
  ['unknown', {}, 'apply 7 "no-such-preset"', /unknown/],
  ['broken', {}, 'apply 7 "broken"', /不可用/],
  ['stale revision', {}, 'apply 6 "coder"', /revision/],
]) test(`Host refuses ${label} with zero writes`, async () => {
  const h = harness(options);
  const result = await h.invoke(input);
  assert.equal(result.kind, 'error');
  assert.match(result.text, pattern);
  assert.equal(h.writes.length, 0);
});

test('bare command points to the panel; all removed manual aliases are rejected with zero writes', async () => {
  const h = harness();
  h.settings.presetSessions.lead = 'coder';
  assert.equal(h.definition.input, undefined, 'no argument hint in the user command catalog');
  for (const input of ['', 'list', 'set coder', 'coder', 'show', 'follow', 'clear']) {
    const result = await h.invoke(input);
    assert.equal(result.kind, 'error', input);
    assert.match(result.text, /选择面板/);
  }
  assert.equal(h.settings.presetSessions.lead, 'coder');
  assert.equal(h.writes.length, 0);
});

test('preset removed/changed during validation and cancellation never overwrite newer settings', async () => {
  let h;
  h = harness({ onResolve: () => h.bump() });
  assert.match((await h.invoke('apply 7 "coder"')).text, /settings\/conflict/);
  assert.equal(h.writes.length, 0);
  const controller = new AbortController();
  const other = harness({ onResolve: () => controller.abort(new Error('cancelled')) });
  assert.match((await other.invoke('apply 7 "coder"', 'lead', controller.signal)).text, /cancelled/);
  assert.equal(other.writes.length, 0);
});

test('popup save rejects nonmembers and accepts preset IDs matching former CLI keywords', async () => {
  const h = harness();
  assert.equal((await h.invoke('apply 7 "coder"', 'stranger')).kind, 'error');
  assert.equal(h.writes.length, 0);
  assert.equal((await h.invoke('apply 7 "show"')).kind, 'success');
  assert.equal(h.settings.presetSessions.lead, 'show');
});
