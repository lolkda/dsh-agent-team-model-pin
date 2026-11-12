import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTeamMenuData, saveTeamMenuChoice } from '../src/team-menu-data.ts';

const NS = 'agent-team-model-pin';
const labels = {
  follow: 'Follow main Agent',
  modelDefault: 'Model default',
  unavailable: 'Unavailable',
  readOnly: 'Read only',
  missing: 'Missing Team settings',
  catalogUnavailable: 'Catalog unavailable',
  saveUnavailable: 'Save unavailable',
  noModel: 'No model',
};
const displayPreset = row => ({ name: row.name ?? row.id, ...(row.description === undefined ? {} : { description: row.description }) });

function harness(overrides = {}) {
  const writes = [];
  const view = {
    ns: NS,
    revision: 6,
    base: { defaults: { provider: 'provider-a', model: 'main' }, scope: 'teammates' },
    value: {
      presetSessions: { lead: 'coder' },
      sessions: { lead: { followLeader: true } },
      ...overrides.view,
    },
  };
  const directory = {
    current: { provider: 'provider-a', model: 'main', reasoningEffort: 'high' },
    groups: [
      { id: 'provider-a', name: 'Provider A', models: [
        { id: 'main', name: 'Main', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } },
        { id: 'other', name: 'Other', reasoning: { efforts: [{ id: 'low', name: 'Low' }] } },
      ] },
      { id: 'provider-b', name: 'Provider B', models: [
        { id: 'team', name: 'Team', reasoning: { efforts: [{ id: 'high', name: 'High' }] } },
      ] },
    ],
    failures: [],
    error: null,
  };
  const calls = { preset: [], list: 0, describe: 0, mutate: [] };
  const remote = {
    settings: {
      async describe() {
        calls.describe++;
        return { ok: true, value: { writable: true, namespaces: [structuredClone(view)] } };
      },
      async mutate(ns, ops, revision) {
        calls.mutate.push({ ns, ops, revision });
        if (overrides.failMutate) return { ok: false, error: { message: 'write failed' } };
        return { ok: true, value: structuredClone(view) };
      },
    },
    agentPresets: {
      async list() {
        calls.list++;
        if (overrides.catalogError) return { ok: false, error: { message: 'catalog failed' } };
        return { ok: true, value: { presets: [
          { id: 'coder', name: 'Coder', description: 'Writes code' },
          { id: 'standard', name: 'Standard' },
          { id: 'broken', name: 'Broken', broken: 'cannot mount' },
        ] } };
      },
    },
    teamSettings: {
      async preset(agentId, revision, choice) {
        calls.preset.push({ agentId, revision, choice });
        return { ok: true, value: { kind: 'success', text: 'saved' } };
      },
    },
  };
  const sessions = {
    binding() { return { session: { getSnapshot: () => ({}) } }; },
  };
  const ctx = {
    remote,
    sessions,
    modelDirectories: { directoryFor: () => ({ load: async () => structuredClone(directory), store: { getSnapshot: () => directory } }) },
  };
  return { ctx, view, calls, directory };
}

test('loadTeamMenuData exposes preset, model and effort current values and options', async () => {
  const h = harness();
  const data = await loadTeamMenuData(h.ctx, 'lead', labels, displayPreset);
  assert.equal(data.preset.current, 'Coder');
  assert.equal(data.preset.options[1].active, true);
  assert.equal(data.preset.options[1].detail, 'Writes code');
  assert.equal(data.preset.error, undefined);
  assert.equal(data.model.current, 'Follow main Agent');
  assert.equal(data.model.options[0].active, true);
  assert.equal(data.model.options[1].detail, undefined);
  assert.equal(data.effort.current, 'Follow main Agent');
  assert.equal(data.effort.options.length, 4);
  assert.deepEqual(data.effort.options.map(option => option.label), ['Follow main Agent', 'Model default', 'Low', 'High']);
  assert.equal(data.effort.options[0].active, true);
  assert.equal(data.effort.options[1].active, false);
  assert.equal(data.preset.revision, 6);
  assert.equal(h.calls.list, 1);
  assert.equal(h.calls.describe, 1);
});

test('loadTeamMenuData reflects explicit model and effort pins', async () => {
  const h = harness({ view: { sessions: { lead: {
    provider: 'provider-b', model: 'team', reasoningEffort: 'high',
  } } } });
  const data = await loadTeamMenuData(h.ctx, 'lead', labels, displayPreset);
  assert.equal(data.model.current, 'Team');
  assert.equal(data.model.options.find(option => option.id.includes('provider-b')).active, true);
  assert.equal(data.effort.current, 'High');
  assert.equal(data.effort.options.find(option => option.id.includes('high')).active, true);
});

test('loadTeamMenuData keeps a catalog failure local to the preset row', async () => {
  const h = harness({ catalogError: true });
  const data = await loadTeamMenuData(h.ctx, 'lead', labels, displayPreset);
  assert.match(data.preset.error, /catalog failed/);
  assert.equal(data.preset.current, 'coder');
  assert.equal(data.model.error, undefined);
  assert.equal(data.effort.error, undefined);
});

test('saveTeamMenuChoice delegates preset saves and writes model/effort pins through settings', async () => {
  const h = harness();
  await saveTeamMenuChoice(h.ctx, 'lead', { kind: 'preset', preset: null }, 6, labels);
  assert.deepEqual(h.calls.preset, [{ agentId: 'lead', revision: 6, choice: null }]);

  await saveTeamMenuChoice(h.ctx, 'lead', { kind: 'model', provider: 'provider-b', model: 'team' }, 6, labels);
  assert.equal(h.calls.mutate.length, 1);
  assert.deepEqual(h.calls.mutate[0].ops[0], {
    op: 'set', path: ['sessions', 'lead'], value: { provider: 'provider-b', model: 'team', modelDefault: true },
  });

  await saveTeamMenuChoice(h.ctx, 'lead', { kind: 'effort', effort: 'low' }, 6, labels);
  assert.equal(h.calls.mutate.length, 2);
  assert.equal(h.calls.mutate[1].ops[0].value.reasoningEffort, 'low');
});

test('saveTeamMenuChoice writes follow and model-default choices', async () => {
  const h = harness();
  await saveTeamMenuChoice(h.ctx, 'lead', { kind: 'model', follow: true }, 6, labels);
  await saveTeamMenuChoice(h.ctx, 'lead', { kind: 'effort', modelDefault: true }, 6, labels);
  assert.deepEqual(h.calls.mutate[0].ops[0].value, { followLeader: true });
  assert.equal(h.calls.mutate[1].ops[0].value.modelDefault, true);
});
