import assert from 'node:assert/strict';
import test from 'node:test';
import * as pin from '../src/pin.ts';

const leader = { provider: 'main', model: 'main-model', reasoningEffort: 'high' };
const stale = { provider: 'old', model: 'old-team', reasoningEffort: 'low', temperature: 0.2 };

test('UI: following the leader explicitly overrides composition pins', () => {
  assert.deepEqual(pin.resolvePin({
    scope: 'teammates', role: 'teammate', sessionId: 'lead',
    defaults: { provider: 'static', model: 'static-model', reasoningEffort: 'high' },
    liveSessions: { lead: { followLeader: true } },
  }), { followLeader: true });
});

test('UI: model default clears an effort inherited from lower layers', () => {
  assert.deepEqual(pin.resolvePin({
    scope: 'teammates', role: 'teammate', sessionId: 'lead',
    defaults: { reasoningEffort: 'high' },
    liveSessions: { lead: { provider: 'p', model: 'm', modelDefault: true } },
  }), { provider: 'p', model: 'm', modelDefault: true });
});

test('UI: normalize preserves only true mode flags', () => {
  assert.deepEqual(pin.normalizePin({ followLeader: true, reasoningEffort: ' low ' }),
    { reasoningEffort: 'low', followLeader: true });
  assert.equal(pin.normalizePin({ followLeader: false, modelDefault: 'yes' }), undefined);
});

test('UI: model default removes a stale effort from a logged request', () => {
  assert.deepEqual(pin.applyPin(stale, { modelDefault: true }),
    { provider: 'old', model: 'old-team', temperature: 0.2 });
});

test('UI: follow restores the leader route instead of retaining a previous Team pin', () => {
  assert.equal(typeof pin.applyTeamPin, 'function', 'a leader-aware request policy is required');
  assert.deepEqual(pin.applyTeamPin(stale, { followLeader: true }, leader),
    { ...leader, temperature: 0.2 });
  assert.deepEqual(stale, { provider: 'old', model: 'old-team', reasoningEffort: 'low', temperature: 0.2 });
});

test('UI: follow permits a Team-only effort and model default', () => {
  assert.equal(typeof pin.applyTeamPin, 'function');
  assert.deepEqual(pin.applyTeamPin(stale, { followLeader: true, reasoningEffort: 'low' }, leader),
    { ...leader, reasoningEffort: 'low', temperature: 0.2 });
  assert.deepEqual(pin.applyTeamPin(stale, { followLeader: true, modelDefault: true }, leader),
    { provider: 'main', model: 'main-model', temperature: 0.2 });
});

test('UI: clearing the last pin follows the leader; absent leader is a safe no-op', () => {
  assert.equal(typeof pin.applyTeamPin, 'function');
  assert.deepEqual(pin.applyTeamPin(stale, undefined, leader), { ...leader, temperature: 0.2 });
  assert.equal(pin.applyTeamPin(stale, undefined), stale);
});

test('UI: legacy effort-only pins still preserve the inherited request route', () => {
  assert.deepEqual(pin.applyTeamPin(stale, { reasoningEffort: 'high' }, leader),
    { ...stale, reasoningEffort: 'high' });
});

test('UI: explicit fixed routes do not leak the leader effort', () => {
  assert.equal(typeof pin.applyTeamPin, 'function');
  assert.deepEqual(pin.applyTeamPin(stale, { provider: 'p', model: 'm', modelDefault: true }, leader),
    { provider: 'p', model: 'm', temperature: 0.2 });
});

test('UI: Team session and lead-role isolation is unchanged', () => {
  const input = { scope: 'teammates', sessionId: 'one', liveSessions: { one: { followLeader: true } } };
  assert.equal(pin.resolvePin({ ...input, role: 'lead' }), undefined);
  assert.equal(pin.resolvePin({ ...input, role: 'teammate', sessionId: 'two' }), undefined);
});

// Intentionally load the real module if it exists; the initial RED is an
// assertion about the missing feature, not an import/setup error.
let ui;
try { ui = await import('../src/ui-state.ts'); } catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}

const groups = [{ id: 'p', name: 'Provider', models: [
  { id: 'm', name: 'Model', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'high' } },
  { id: 'plain', name: 'Plain model' },
] }];

test('UI: selecting a model uses exact catalog ids and resets the old effort', () => {
  assert.equal(typeof ui?.modelPin, 'function', 'catalog-backed UI state is required');
  assert.deepEqual(ui.modelPin(groups, 'p', 'm'), { provider: 'p', model: 'm', modelDefault: true });
  assert.throws(() => ui.modelPin(groups, 'missing', 'm'));
});

test('UI: effort choices reject unsupported values before a settings write', () => {
  assert.equal(typeof ui?.effortPin, 'function');
  assert.deepEqual(ui.effortPin(groups, { provider: 'p', model: 'm' }, { provider: 'p', model: 'm' }, 'low'),
    { provider: 'p', model: 'm', reasoningEffort: 'low' });
  assert.throws(() => ui.effortPin(groups, { provider: 'p', model: 'plain' }, undefined, 'high'));
});

test('UI: following with an effort does not freeze the main model', () => {
  assert.equal(typeof ui?.effortPin, 'function');
  assert.deepEqual(ui.effortPin(groups, { provider: 'p', model: 'm' }, { followLeader: true }, 'low'),
    { followLeader: true, reasoningEffort: 'low' });
});

test('UI: a settings mutation addresses only the selected session and preserves CAS', () => {
  assert.equal(typeof ui?.writeTeamPin, 'function');
  const calls = [];
  const remote = { settings: { mutate: async (...args) => { calls.push(args); return { ok: true, value: { revision: 5 } }; } } };
  return ui.writeTeamPin(remote, 'lead-A', { followLeader: true }, 4).then((value) => {
    assert.equal(value.revision, 5);
    assert.deepEqual(calls, [['agent-team-model-pin', [{ op: 'set', path: ['sessions', 'lead-A'], value: { followLeader: true } }], 4]]);
  });
});

test('UI: rejected settings writes never report success', async () => {
  assert.equal(typeof ui?.writeTeamPin, 'function');
  await assert.rejects(ui.writeTeamPin({ settings: { mutate: async () => ({ ok: false, error: { message: 'settings/conflict' } }) } },
    'lead-A', { followLeader: true }, 4), /settings\/conflict/);
});

test('UI: effective state uses immutable composition base and the current session only', () => {
  assert.equal(typeof ui?.readTeamPin, 'function');
  // rc.1 的 namespace view：base = Composition 基线（scope/defaults/sessions），
  // value = 解析后的层（Composition ∪ profile 覆盖）。
  const view = { base: { scope: 'teammates', defaults: { provider: 'p', model: 'm' }, sessions: {} },
    value: { scope: 'all', defaults: { provider: 'wrong', model: 'wrong' }, sessions: { A: { followLeader: true }, B: { reasoningEffort: 'low' } } } };
  assert.deepEqual(ui.readTeamPin(view, 'A'), { followLeader: true });
  assert.deepEqual(ui.readTeamPin(view, 'B'), { provider: 'p', model: 'm', reasoningEffort: 'low' });
});

test('UI: a composition pin in base.sessions is honored when the resolved layer omits it', () => {
  assert.equal(typeof ui?.readTeamPin, 'function');
  const view = { base: { scope: 'teammates', defaults: {}, sessions: { A: { provider: 'base', model: 'base-model' } } },
    value: { sessions: {} } };
  assert.deepEqual(ui.readTeamPin(view, 'A'), { provider: 'base', model: 'base-model' });
  assert.equal(ui.readTeamPin(view, 'B'), undefined);
});

 test('UI: root scope is taken from the durable subagent address, never a teammate id', () => {
  assert.equal(typeof ui?.teamSessionKey, 'function');
  // DSH 0.1.7-rc.1 removed the client `remote.agentTeams` namespace; the Team
  // root key now comes from the client Session face's durable direct-parent
  // address, exactly as the shipped Agent Team UI derives it.
  const face = (parentSessionId) => ({ getSnapshot: () => ({ subagent: parentSessionId === undefined ? undefined : { address: { parentSessionId, childSessionId: 'child', mode: 'continuable' } } }) });
  const sessions = { binding: (id) => ({ session: face(id === 'child' ? 'lead' : undefined) }) };
  assert.equal(ui.teamSessionKey('child', sessions), 'lead');
  assert.equal(ui.teamSessionKey('ordinary', sessions), 'ordinary');
  assert.equal(ui.teamSessionKey('unknown', { binding: () => undefined }), 'unknown');
  assert.equal(ui.teamSessionKey('broken', { binding: () => ({ session: { getSnapshot: () => { throw new Error('gone'); } } }) }), 'broken');
});

test('UI: command description accurately reports follow and model-default modes', () => {
  assert.match(pin.describePin({ followLeader: true }), /跟随主 Agent/);
  assert.match(pin.describePin({ provider: 'p', model: 'm', modelDefault: true }), /模型默认/);
});

// Native command integration now covers catalog rendering, read-only state,
// supported effort rows, and retention of the untouched main model selector.
