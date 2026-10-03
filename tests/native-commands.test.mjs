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

test('native commands: localized client contributions coexist with unrelated Host commands', integration, async (t) => {
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

test('native commands: unload dismisses and removes Team popup contributions', integration, async (t) => {
  const ui = await mount(t);
  await ui.enter('/team-model');
  await ui.unload();
  assert.equal(state(ui).open, false);
  assert.equal((await ui.candidates()).some(row => row.name === 'team-effort'), false);
  assert.equal(await ui.enter('/team-model'), undefined);
  assert.deepEqual(ui.occupants(), ui.before);
});

test('native commands: unrelated argued Host commands retain their native claim path', integration, async (t) => {
  const ui = await mount(t);
  for (const args of ['show', 'clear', 'p team low']) {
    const result = await ui.enter(`/host-example ${args}`);
    assert.equal(result.claim.name, 'host-example');
    await result.claim.submit(args, undefined, []);
    assert.equal(ui.calls.executed.at(-1)[1], `/host-example ${args}`);
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

test('native preset command: root client contribution opens native options without changing main controls', integration, async (t) => {
  const ui = await mount(t, { teamPreset: true });
  const rows = await ui.candidates();
  assert.equal(rows.filter(row => row.name === 'team-preset').length, 1);
  assert.equal(await ui.enter('/team-preset'), 'handled');
  assert.equal(state(ui).command, 'team-preset');
  assert.equal(state(ui).status, 'ready');
  assert.ok(ui.panel());
  assert.deepEqual(Array.from(state(ui).options, row => row.label), ['跟随主 Agent', 'Standard', 'Reviewer']);
  assert.equal(state(ui).options[0].active, true);
  assert.match(state(ui).options[2].detail, /之后新建.*现有队友/);
  assert.equal(state(ui).options.some(row => row.id.includes('broken')), false);
  assert.deepEqual(ui.occupants(), ui.before);
  assert.equal(ui.container.querySelector('[data-team-model-pin]'), null);
  assert.deepEqual(ui.calls.presetCalls, []);
  assert.deepEqual(ui.calls.settings, []);
  assert.deepEqual(ui.errors, []);
});

test('native preset command: search and keyboard send the guarded plugin RPC payload, never direct settings writes', integration, async (t) => {
  const ui = await mount(t, { teamPreset: true, view: { value: { sessions: { 'lead-A': { model: 'team' } }, presetSessions: { 'lead-B': 'standard' } } } });
  await ui.enter('/team-preset');
  await ui.search('review');
  assert.equal(ui.panel().querySelectorAll('[role="option"]').length, 1);
  await ui.key('Enter');
  assert.equal(ui.calls.presetCalls.length, 1);
  const [leadId, revision, choice, signal] = ui.calls.presetCalls[0];
  assert.equal(leadId, 'lead-A');
  assert.equal(revision, 1);
  assert.equal(choice, 'reviewer');
  assert.ok(signal instanceof AbortSignal);
  assert.deepEqual(ui.calls.presetWrites, [{ leadId: 'lead-A', revision: 1, choice: 'reviewer' }]);
  assert.deepEqual(ui.calls.settings, []);
  assert.deepEqual(ui.calls.main, []);
  assert.equal(ui.view.value.sessions['lead-A'].model, 'team');
  assert.equal(ui.view.value.presetSessions['lead-A'], 'reviewer');
  assert.equal(ui.view.value.presetSessions['lead-B'], 'standard');
  assert.equal(state(ui).open, false);
  assert.equal(ui.calls.consumed.length, 1);
  assert.equal(ui.calls.presetCatalog, 2, 'list on open and validation immediately before submit');
});

test('native preset command: child contribution targets its Lead, explicit follow overrides configured default', integration, async (t) => {
  const ui = await mount(t, { teamPreset: true, session: 'mate-A', parents: { 'mate-A': 'lead-A' },
    view: { base: { presetDefault: 'reviewer' } } });
  assert.equal((await ui.candidates()).filter(row => row.name === 'team-preset').length, 1);
  await ui.enter('/team-preset');
  assert.equal(state(ui).options.find(row => row.active)?.id, '["team-preset","reviewer"]');
  await ui.choose('["team-preset",null]');
  assert.equal(ui.calls.presetCalls[0][0], 'lead-A');
  assert.deepEqual(ui.calls.presetCalls[0].slice(0, 3), ['lead-A', 1, null]);
  assert.equal(ui.view.value.presetSessions['lead-A'], null);
  assert.equal(ui.view.value.presetSessions['mate-A'], undefined);
  assert.deepEqual(ui.calls.settings, []);
  await ui.enter('/team-preset');
  assert.equal(state(ui).options.find(row => row.active)?.id, '["team-preset",null]');
});

test('native preset command: unsupported Host cannot save or consume the input token', integration, async (t) => {
  const ui = await mount(t, { teamPreset: true, presetSupported: false });
  await ui.enter('/team-preset');
  await ui.choose('["team-preset","reviewer"]');
  assert.equal(state(ui).open, true);
  assert.match(state(ui).error, /runtime unsupported/);
  assert.match(ui.container.querySelector('[role="alert"]').textContent, /runtime unsupported/);
  assert.equal(ui.calls.presetCalls.length, 1);
  assert.deepEqual(ui.calls.presetWrites, []);
  assert.deepEqual(ui.calls.settings, []);
  assert.deepEqual(ui.calls.consumed, []);
  assert.equal(ui.view.value.presetSessions, undefined);
  assert.deepEqual(ui.occupants(), ui.before);
});

test('native preset command: missing catalog only fails its own popup and leaves model menus available', integration, async (t) => {
  const ui = await mount(t, { teamPreset: true, omitPresetCatalog: true });
  await ui.enter('/team-preset');
  assert.equal(state(ui).status, 'failed');
  assert.match(state(ui).error, /预设目录不可用|catalog is unavailable/);
  await ui.key('Escape');
  await ui.enter('/team-model');
  assert.equal(state(ui).status, 'ready');
  assert.equal(state(ui).command, 'team-model');
  assert.deepEqual(ui.occupants(), ui.before);
  assert.deepEqual(ui.calls.presetCalls, []);
  assert.deepEqual(ui.calls.settings, []);
});

test('native preset command: Host CAS conflict preserves existing policy and requires reopen', integration, async (t) => {
  const ui = await mount(t, { teamPreset: true });
  await ui.enter('/team-preset');
  ui.setView({ ...ui.view, revision: 2, value: { ...ui.view.value, presetSessions: { 'lead-A': 'standard' } } });
  await ui.choose('["team-preset","reviewer"]');
  assert.match(state(ui).error, /settings\/conflict/);
  assert.deepEqual(ui.calls.presetCalls[0].slice(0, 3), ['lead-A', 1, 'reviewer']);
  assert.deepEqual(ui.calls.presetWrites, []);
  assert.deepEqual(ui.calls.settings, []);
  assert.equal(ui.view.value.presetSessions['lead-A'], 'standard');
  assert.deepEqual(ui.calls.consumed, []);
  await ui.key('Escape');
  await ui.enter('/team-preset');
  await ui.choose('["team-preset","reviewer"]');
  assert.deepEqual(ui.calls.presetCalls[1].slice(0, 3), ['lead-A', 2, 'reviewer']);
  assert.equal(ui.view.value.presetSessions['lead-A'], 'reviewer');
});

test('native preset command: removed or broken catalog option fails before invoking Host apply', integration, async (t) => {
  const ui = await mount(t, { teamPreset: true });
  await ui.enter('/team-preset');
  ui.presetRows.find(row => row.id === 'reviewer').broken = 'preset stopped';
  await ui.choose('["team-preset","reviewer"]');
  assert.match(state(ui).error, /已移除或无法加载|removed or cannot be loaded/);
  assert.deepEqual(ui.calls.presetCalls, []);
  assert.deepEqual(ui.calls.presetWrites, []);
  assert.deepEqual(ui.calls.settings, []);
});

test('native preset command: model menu writes and native main picker preserve the independent preset policy', integration, async (t) => {
  const ui = await mount(t, { teamPreset: true });
  await ui.enter('/team-preset');
  await ui.choose('["team-preset","reviewer"]');
  await ui.enter('/team-model');
  await ui.choose('["team-model","p","team"]');
  assert.equal(ui.view.value.presetSessions['lead-A'], 'reviewer');
  await ui.enter('/model');
  await ui.choose(state(ui).options.find(row => row.label === 'team').id);
  assert.equal(ui.calls.main.at(-1).model, 'team');
  assert.equal(ui.view.value.presetSessions['lead-A'], 'reviewer');
  assert.equal(ui.calls.presetCalls.length, 1, 'only the preset picker invokes the preset RPC');
  assert.equal(ui.calls.settings.length, 1, 'the Team model picker retains its independent model mutation');
  assert.deepEqual(ui.occupants(), ui.before);
});


test('native preset popup works with production-shaped traced Remote namespace services', integration, async (t) => {
  const ui = await mount(t, { teamPreset: true, tracedRemotes: true });
  await ui.enter('/team-preset');
  assert.equal(state(ui).status, 'ready');
  assert.ok(state(ui).options.some(row => row.id === '["team-preset","reviewer"]'));
  await ui.choose('["team-preset","reviewer"]');
  assert.equal(ui.view.value.presetSessions['lead-A'], 'reviewer');
  assert.deepEqual(ui.calls.settings, []);
  assert.equal(ui.calls.presetCalls.length, 1);
  assert.deepEqual(ui.errors, []);
  assert.deepEqual(ui.occupants(), ui.before);
});

test('native preset popup localizes built-ins, searches Chinese names and saves the original ID', integration, async t => {
  const ui = await mount(t, { teamPreset: true, tracedRemotes: true,
    presetRows: ['standard', 'ptc', 'minimal', 'cordis'].map(id => ({ id, isDefault: id === 'standard' })) });
  await ui.enter('/team-preset');
  assert.equal(state(ui).status, 'ready');
  assert.deepEqual(Array.from(state(ui).options, row => row.label), ['跟随主 Agent', '标准模式', 'PTC 模式', '极简模式', '创造模式']);
  assert.match(state(ui).options[4].detail, /^cordis · 用对话定制 DSH/);
  await ui.search('创造');
  assert.equal(ui.panel().querySelectorAll('[role="option"]').length, 1);
  await ui.key('Enter');
  assert.deepEqual(ui.calls.presetCalls[0].slice(0, 3), ['lead-A', 1, 'cordis']);
  assert.equal(ui.view.value.presetSessions['lead-A'], 'cordis');
  assert.deepEqual(ui.calls.settings, []);
  await ui.setLanguage('en');
  await ui.enter('/team-preset');
  assert.deepEqual(Array.from(state(ui).options, row => row.label), ['Follow main Agent', 'Standard mode', 'PTC mode', 'Minimal mode', 'Creator mode']);
  assert.equal(state(ui).options.find(row => row.active).id, '["team-preset","cordis"]');
  assert.deepEqual(ui.errors, []);
  assert.deepEqual(ui.occupants(), ui.before);
});


test('all Team commands have localized titles and one row in root and child menus', integration, async t => {
  const ui = await mount(t, { teamPreset: true, parents: { 'mate-A': 'lead-A' } });
  for (const language of ['zh', 'en']) {
    await ui.setLanguage(language);
    for (const sessionId of ['lead-A', 'mate-A']) {
      await ui.switchSession(sessionId);
      const rows = await ui.candidates();
      const labels = language === 'zh' ? ['Team 模型', 'Team 推理等级', 'Team 预设'] : ['Team model', 'Team reasoning effort', 'Team preset'];
      for (const [index, name] of ['team-model', 'team-effort', 'team-preset'].entries()) {
        const found = rows.filter(row => row.name === name);
        assert.equal(found.length, 1, name);
        assert.equal(found[0].label, labels[index]);
      }
    }
  }
  assert.deepEqual(ui.calls.executed, []);
  assert.deepEqual(ui.errors, []);
});


test('retired Team argument syntax is refused instead of entering the conversation model', integration, async t => {
  const ui = await mount(t, { teamPreset: true });
  for (const line of ['/team-model p team low', '/team-preset set reviewer', '/team-effort high']) {
    await assert.rejects(ui.enter(line), /选择面板|without arguments/);
  }
  assert.deepEqual(ui.calls.executed, []);
  assert.deepEqual(ui.calls.presetCalls, []);
  assert.deepEqual(ui.calls.settings, []);
  assert.equal((await ui.candidates()).some(row => row.name === 'team-settings-input-guard'), false);
});
