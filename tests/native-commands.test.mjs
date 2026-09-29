import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFile } from 'node:fs/promises';
import { act } from 'react';
import { mount, installation, closeDom } from './fixtures/native-command-client.mjs';

after(closeDom);
const integration = { skip: installation ? false : 'Install DSH or set DSH_TEST_INSTALL_ROOT for native command integration' };
const state = (ui) => ui.popup().state.getSnapshot();

// These fail if the plugin resumes replacing the composer, registers a
// colliding command, or bypasses the native popup's settings transaction.
test('native commands: the original model selector remains the sole occupant', integration, async (t) => {
  const ui = await mount(t);
  assert.deepEqual(ui.errors, []);
  assert.deepEqual(ui.occupants(), ui.before);
  assert.equal(ui.occupants().length, 1);
  assert.equal(ui.container.querySelector('[data-team-model-pin]'), null);
  assert.ok(ui.container.querySelector('button[aria-haspopup="menu"]'));
});

test('native commands: host decoration and contribution coexist without name collisions', integration, async (t) => {
  const ui = await mount(t);
  const rows = await ui.candidates();
  assert.equal(rows.filter(row => row.name === 'team-model').length, 1);
  assert.equal(rows.filter(row => row.name === 'team-effort').length, 1);
  assert.equal(await ui.enter('/team-model'), 'handled');
  assert.equal(state(ui).command, 'team-model');
  assert.equal(state(ui).status, 'ready');
  assert.ok(ui.panel());
  assert.deepEqual(ui.calls.executed, []);
});

test('native commands: selecting Team model persists only the opening Lead pin', integration, async (t) => {
  const ui = await mount(t);
  await ui.enter('/team-model');
  assert.equal(state(ui).options.find(row => row.active)?.id, '["team-follow"]');
  await ui.choose('["team-model","p","team"]');
  assert.deepEqual(ui.view.value.sessions['lead-A'], { provider: 'p', model: 'team', modelDefault: true });
  assert.equal(ui.view.value.sessions['lead-B'], undefined);
  assert.deepEqual(ui.calls.main, []);
  assert.equal(state(ui).open, false);
  assert.equal(ui.calls.consumed.length, 1);
});

test('native commands: search and keyboard selection use the official popup shell', integration, async (t) => {
  const ui = await mount(t);
  await ui.enter('/team-model');
  await ui.search('team');
  assert.equal(ui.panel().querySelectorAll('[role="option"]').length, 1);
  assert.match(ui.panel().textContent, /team/);
  await ui.key('Enter');
  assert.equal(ui.view.value.sessions['lead-A'].model, 'team');
  assert.equal(state(ui).open, false);
});

test('native commands: fixed-model effort and model default preserve the selected route', integration, async (t) => {
  const ui = await mount(t);
  await ui.enter('/team-model');
  await ui.choose('["team-model","p","team"]');
  await ui.enter('/team-effort');
  assert.equal(state(ui).options.some(row => row.id === '["team-effort","inherit"]'), false);
  await ui.choose('["team-effort","low"]');
  assert.deepEqual(ui.view.value.sessions['lead-A'], { provider: 'p', model: 'team', reasoningEffort: 'low' });
  await ui.enter('/team-effort');
  assert.equal(state(ui).options.find(row => row.active)?.id, '["team-effort","low"]');
  await ui.choose('["team-effort",null]');
  assert.deepEqual(ui.view.value.sessions['lead-A'], { provider: 'p', model: 'team', modelDefault: true });
});

test('native commands: follow mode supports custom effort and returning to inherited effort', integration, async (t) => {
  const ui = await mount(t);
  await ui.enter('/team-effort');
  assert.equal(state(ui).options.find(row => row.active)?.id, '["team-effort","inherit"]');
  await ui.choose('["team-effort","low"]');
  assert.deepEqual(ui.view.value.sessions['lead-A'], { followLeader: true, reasoningEffort: 'low' });
  await ui.enter('/team-effort');
  await ui.choose('["team-effort","inherit"]');
  assert.deepEqual(ui.view.value.sessions['lead-A'], { followLeader: true });
});

test('native commands: explicit follow overrides a composition pin', integration, async (t) => {
  const ui = await mount(t, { view: { base: { scope: 'teammates', defaults: { provider: 'p', model: 'team', reasoningEffort: 'low' } } } });
  await ui.enter('/team-model');
  assert.equal(state(ui).options.find(row => row.active)?.id, '["team-model","p","team"]');
  await ui.choose('["team-follow"]');
  assert.deepEqual(ui.view.value.sessions['lead-A'], { followLeader: true });
});

test('native commands: a non-reasoning model allows clearing effort but offers no arbitrary levels', integration, async (t) => {
  const ui = await mount(t, { groups: [{ id: 'p', name: 'Provider', models: [{ id: 'main', name: 'Plain' }] }] });
  await ui.enter('/team-effort');
  assert.deepEqual(Array.from(state(ui).options, row => row.id), ['["team-effort","inherit"]', '["team-effort",null]']);
});

for (const [name, options, pattern] of [
  ['read-only', { readOnly: true }, /只读|read.only/i],
  ['missing settings namespace', { describe: () => ({ ok: true, value: { writable: true, namespaces: [] } }) }, /就绪|ready/i],
  ['settings transport failure', { describe: () => ({ ok: false, error: { message: 'settings offline' } }) }, /settings offline/],
  ['catalog failure', { catalog: () => ({ ok: false, error: { code: 'offline', message: 'catalog offline' } }) }, /catalog offline/],
]) test(`native commands: ${name} stays in the official error panel`, integration, async (t) => {
  const ui = await mount(t, options);
  await ui.enter('/team-model');
  assert.equal(state(ui).status, 'failed');
  assert.match(ui.container.querySelector('[role="alert"]').textContent, pattern);
  assert.equal(ui.calls.settings.length, 0);
  assert.deepEqual(ui.errors, []);
  assert.deepEqual(ui.occupants(), ui.before);
});

test('native commands: CAS conflict retains the token and never reports success', integration, async (t) => {
  const ui = await mount(t);
  await ui.enter('/team-model');
  ui.setView({ ...ui.view, revision: 2 });
  await ui.choose('["team-model","p","team"]');
  assert.equal(state(ui).open, true);
  assert.match(state(ui).error, /settings\/conflict/);
  assert.deepEqual(ui.calls.consumed, []);
  assert.equal(ui.view.value.sessions['lead-A'], undefined);
});

test('native commands: a scoped popup never writes the currently viewed other session', integration, async (t) => {
  const ui = await mount(t);
  await ui.enter('/team-model');
  await ui.switchSession('lead-B');
  await ui.choose('["team-model","p","team"]', 'lead-A');
  assert.equal(ui.view.value.sessions['lead-A'].model, 'team');
  assert.equal(ui.view.value.sessions['lead-B'], undefined);
});

test('native commands: a child session uses its Lead catalog and settings key', integration, async (t) => {
  const ui = await mount(t, { session: 'mate-A', parents: { 'mate-A': 'lead-A' } });
  const rows = await ui.candidates();
  assert.equal(rows.filter(row => row.name === 'team-model').length, 1);
  await ui.enter('/team-model');
  assert.equal(state(ui).status, 'ready');
  await ui.choose('["team-model","p","team"]');
  assert.equal(ui.view.value.sessions['lead-A'].model, 'team');
  assert.equal(ui.view.value.sessions['mate-A'], undefined);
  assert.deepEqual(ui.calls.main, []);
});

test('native commands: changing the followed main route invalidates an open effort choice', integration, async (t) => {
  const ui = await mount(t);
  await ui.enter('/team-effort');
  await ui.selectMain({ provider: 'p', model: 'team' });
  await ui.choose('["team-effort","low"]');
  assert.equal(ui.calls.settings.length, 0);
  assert.match(state(ui).error, /重新打开|reopen/i);
});

test('native commands: a fixed Team route stays editable when the main model changes', integration, async (t) => {
  const ui = await mount(t, { view: { value: { sessions: { 'lead-A': { provider: 'p', model: 'team' } } } } });
  await ui.enter('/team-effort');
  await ui.selectMain({ provider: 'p', model: 'team' });
  await ui.choose('["team-effort","low"]');
  assert.equal(state(ui).open, false);
  assert.deepEqual(ui.view.value.sessions['lead-A'], { provider: 'p', model: 'team', reasoningEffort: 'low' });
});

test('native commands: unload dismisses open Team popups and restores host bare command behavior', integration, async (t) => {
  const ui = await mount(t);
  await ui.enter('/team-model');
  await ui.unload();
  assert.equal(state(ui).open, false);
  assert.equal((await ui.candidates()).some(row => row.name === 'team-effort'), false);
  assert.ok((await ui.enter('/team-model')).claim);
  assert.deepEqual(ui.occupants(), ui.before);
});

test('native commands: existing argued host commands still use the native claim path', integration, async (t) => {
  const ui = await mount(t);
  for (const args of ['show', 'clear', 'p team low']) {
    const result = await ui.enter(`/team-model ${args}`);
    assert.equal(result.claim.name, 'team-model');
    await result.claim.submit(args, undefined, []);
    assert.equal(ui.calls.executed.at(-1)[1], `/team-model ${args}`);
  }
  assert.equal(state(ui).open, false);
});

test('native commands: the shared native /model picker still changes the main model only', integration, async (t) => {
  const ui = await mount(t);
  await ui.enter('/model');
  const option = state(ui).options.find(row => row.label === 'team');
  assert.ok(option);
  await ui.choose(option.id);
  assert.equal(ui.calls.main.at(-1).model, 'team');
  assert.deepEqual(ui.calls.settings, []);
});

test('native commands: failed loading retries through the real panel button', integration, async (t) => {
  let attempts = 0;
  const ui = await mount(t, { describe: () => ++attempts === 1 ? { ok: false, error: { message: 'try again' } } : undefined });
  await ui.enter('/team-model');
  assert.equal(state(ui).status, 'failed');
  await ui.click(ui.container.querySelector('[role="alert"] button'));
  assert.equal(state(ui).status, 'ready');
  assert.ok(ui.panel());
});

test('native commands: reopening after a conflict loads the fresh revision', integration, async (t) => {
  const ui = await mount(t);
  await ui.enter('/team-model');
  ui.setView({ ...ui.view, revision: 2 });
  await ui.choose('["team-model","p","team"]');
  assert.match(state(ui).error, /settings\/conflict/);
  await ui.key('Escape');
  await ui.enter('/team-model');
  await ui.choose('["team-model","p","team"]');
  assert.equal(ui.calls.settings.at(-1)[2], 2);
  assert.equal(ui.view.value.sessions['lead-A'].model, 'team');
  assert.equal(state(ui).open, false);
});

test('native commands: removing a model from the live directory rejects a stale choice', integration, async (t) => {
  const ui = await mount(t);
  await ui.enter('/team-model');
  const store = ui.root.get('modelDirectories').directoryFor('lead-A').store;
  await act(async () => { store.set({ ...store.getSnapshot(), groups: [] }); });
  await ui.choose('["team-model","p","team"]');
  assert.equal(ui.calls.settings.length, 0);
  assert.match(state(ui).error, /no longer available/);
});

test('native commands: Escape aborts a pending settings load without consuming the draft', integration, async (t) => {
  let settle;
  const pending = new Promise(resolve => { settle = resolve; });
  const ui = await mount(t, { describe: () => pending });
  await ui.enter('/team-model');
  assert.equal(state(ui).status, 'pending');
  await ui.key('Escape');
  assert.equal(state(ui).open, false);
  await act(async () => { settle({ ok: true, value: { writable: true, namespaces: [ui.view] } }); });
  assert.equal(state(ui).open, false);
  assert.deepEqual(ui.calls.settings, []);
  assert.deepEqual(ui.calls.consumed, []);
});

test('native commands: native single-flight blocks duplicate writes and permits retry after failure', integration, async (t) => {
  let settle;
  const pending = new Promise(resolve => { settle = resolve; });
  let attempts = 0;
  const ui = await mount(t, { mutate: () => ++attempts === 1 ? pending : { ok: true, value: { revision: 2 } } });
  await ui.enter('/team-model');
  let selecting;
  await act(async () => { selecting = ui.popup().select(2); });
  assert.equal(state(ui).submitting, true);
  await ui.choose('["team-model","p","team"]');
  assert.equal(ui.calls.settings.length, 1);
  await act(async () => { settle({ ok: false, error: { message: 'temporary failure' } }); await selecting; });
  assert.equal(state(ui).open, true);
  assert.match(state(ui).error, /temporary failure/);
  await ui.choose('["team-model","p","team"]');
  assert.equal(ui.calls.settings.length, 2);
  assert.equal(state(ui).open, false);
});

for (const namespace of ['remote.session', 'remote.settings']) {
  test(`native commands: missing ${namespace} is visible without replacing the native model control`, integration, async (t) => {
    const ui = await mount(t, { omitNamespace: namespace });
    // The visible native picker already warmed A's directory. Open B's command
    // first to exercise guarded cold creation, then render its error panel.
    await ui.enter('/team-model', 'lead-B');
    await ui.switchSession('lead-B');
    assert.equal(state(ui).status, 'failed');
    assert.ok(state(ui).error.includes(namespace), state(ui).error);
    assert.equal(ui.calls.settings.length, 0);
    assert.deepEqual(ui.occupants(), ui.before);
  });
}

test('native commands: language changes affect the next opening without remounting', integration, async (t) => {
  const ui = await mount(t);
  await ui.setLanguage('en');
  await ui.enter('/team-model');
  assert.equal(state(ui).options[0].label, 'Follow main Agent');
  assert.equal(ui.container.querySelector('input').placeholder, 'Search Team models…');
});

test('native commands: client marker follows the package version without a custom DOM marker', integration, async (t) => {
  const ui = await mount(t);
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(ui.candidateName, `agent-team-model-pin-ui-${pkg.version}`);
  assert.equal(ui.container.querySelector('[data-team-model-pin]'), null);
});
