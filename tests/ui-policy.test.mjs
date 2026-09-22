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
  const view = { base: { scope: 'teammates', defaults: { provider: 'p', model: 'm' } },
    value: { defaults: { provider: 'wrong', model: 'wrong' }, sessions: { A: { followLeader: true }, B: { reasoningEffort: 'low' } } } };
  assert.deepEqual(ui.readTeamPin(view, 'A'), { followLeader: true });
  assert.deepEqual(ui.readTeamPin(view, 'B'), { provider: 'p', model: 'm', reasoningEffort: 'low' });
});

 test('UI: root scope is taken from Team view, never a teammate id', () => {
  assert.equal(typeof ui?.teamSessionKey, 'function');
  assert.equal(ui.teamSessionKey('child', { members: [{ id: 'lead', role: 'lead' }, { id: 'child', role: 'teammate' }] }), 'lead');
  assert.equal(ui.teamSessionKey('ordinary', { members: [] }), 'ordinary');
});

 test('UI: late responses from a previous session are ignored', () => {
  assert.equal(typeof ui?.isCurrentRequest, 'function');
  assert.equal(ui.isCurrentRequest({ sessionId: 'A', generation: 1 }, { sessionId: 'B', generation: 2 }), false);
  assert.equal(ui.isCurrentRequest({ sessionId: 'B', generation: 1 }, { sessionId: 'B', generation: 2 }), false);
  assert.equal(ui.isCurrentRequest({ sessionId: 'B', generation: 2 }, { sessionId: 'B', generation: 2 }), true);
});

test('UI: command description accurately reports follow and model-default modes', () => {
  assert.match(pin.describePin({ followLeader: true }), /跟随主 Agent/);
  assert.match(pin.describePin({ provider: 'p', model: 'm', modelDefault: true }), /模型默认/);
});

const copy = { model: 'Model', effort: 'Effort', teamModel: 'Team model', teamEffort: 'Team effort', follow: 'Follow main Agent', modelDefault: 'Model default', unsupported: 'Not supported', unavailable: 'Select model' };
test('UI menu: retains the main controls and adds two Team controls in the same menu', () => {
  assert.equal(typeof ui?.buildMenu, 'function');
  const menu = ui.buildMenu(groups, { provider: 'p', model: 'm', reasoningEffort: 'high' }, undefined, copy);
  assert.deepEqual(menu.map((row) => row.id), ['main-model', 'main-effort', 'team-divider', 'team-model', 'team-effort']);
  assert.equal(menu[3].value, 'Follow main Agent');
  assert.equal(menu[3].submenu[0].id, '["team-follow"]');
  assert.equal(menu[3].submenu[1].detail, 'Provider');
  assert.equal(menu[4].submenu.some((row) => row.id === '["team-effort","low"]'), true);
});

test('UI menu: read-only Team settings do not disable main-model selection', () => {
  assert.equal(typeof ui?.buildMenu, 'function');
  const menu = ui.buildMenu(groups, { provider: 'p', model: 'm' }, undefined, copy, false, true);
  assert.equal(menu[0].disabled, false);
  assert.equal(menu[3].disabled, true);
});

test('UI menu: a plain model never offers arbitrary reasoning levels', () => {
  assert.equal(typeof ui?.buildMenu, 'function');
  const menu = ui.buildMenu(groups, { provider: 'p', model: 'm' }, { provider: 'p', model: 'plain' }, copy);
  assert.equal(menu[4].disabled, true);
  assert.equal(menu[4].value, 'Not supported');
});
