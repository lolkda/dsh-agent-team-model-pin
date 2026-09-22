import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { closeNativeClientDom, installation, mountNativeClient } from './fixtures/native-client.mjs';

after(closeNativeClientDom);
const integration = { skip: installation ? false : 'Install DSH or set DSH_TEST_INSTALL_ROOT to run the native Client integration' };
const rowNames = (panel) => [...panel.querySelectorAll('[data-atmp-open]')].map((element) => element.getAttribute('data-atmp-open'));

// This fails if the plugin omits remote.session, even though its registration
// initially wins and all tests with a fake directoryFor() would pass.
test('native Client: cold directory creation preserves the Team picker after real rendering', integration, async (t) => {
  const ui = await mountNativeClient(t);
  assert.deepEqual(ui.errors, []);
  const panel = await ui.open();
  assert.deepEqual(rowNames(panel), ['main-model', 'main-effort', 'team-model', 'team-effort']);
  assert.equal(ui.occupants().find((entry) => entry.registrant === ui.candidateName)?.active, true);
  assert.equal(panel.querySelector('[data-atmp-open="team-model"]').disabled, false);
});

test('native Client: a warm directory does not hide dependency failure on a new session', integration, async (t) => {
  const ui = await mountNativeClient(t, { warm: true });
  assert.deepEqual(ui.errors, []);
  assert.equal(rowNames(await ui.open()).length, 4);
  await ui.switchSession('lead-B');
  assert.deepEqual(ui.errors, []);
  assert.deepEqual(rowNames(await ui.open()), ['main-model', 'main-effort', 'team-model', 'team-effort']);
});

test('native Client: missing remote.session reproduces renderer abdication and native fallback', integration, async (t) => {
  const ui = await mountNativeClient(t, { omitNamespace: 'remote.session' });
  assert.equal(ui.errors.length, 1);
  assert.equal(ui.errors[0].key, 'conversation.input.model');
  assert.match(ui.errors[0].message, /remote\.session.*without inject/);
  assert.equal(ui.errors[0].abdicated, true);
  assert.equal(ui.occupants().find((entry) => entry.registrant === ui.candidateName)?.active, false);
  assert.equal(ui.occupants().find((entry) => entry.priority === 0)?.active, true);
  assert.equal(ui.trigger(), null);
  assert.ok(ui.container.querySelector('button'), 'the actual native picker must render after fallback');
});

test('native Client: Team model and effort writes leave the native main selection unchanged', integration, async (t) => {
  const ui = await mountNativeClient(t);
  assert.deepEqual(ui.errors, []);
  await ui.drill('team-model');
  await ui.choose('["team-model","p","team"]');
  await ui.drill('team-effort');
  await ui.choose('["team-effort","low"]');
  assert.deepEqual(ui.view.value.sessions['lead-A'], { provider: 'p', model: 'team', reasoningEffort: 'low' });
  assert.equal(ui.calls.main.length, 0);
  assert.equal(ui.directory('lead-A').store.getSnapshot().current.model, 'main');
  assert.equal(ui.directory('lead-A').store.getSnapshot().current.reasoningEffort, 'high');
  await ui.switchSession('lead-B');
  await ui.open();
  assert.equal(ui.view.value.sessions['lead-B'], undefined);
  assert.equal(ui.panel().querySelector('[data-atmp-open="team-model"] .atmp-cell-value').textContent, '跟随主 Agent');
  await ui.switchSession('lead-A');
  await ui.open();
  assert.equal(ui.panel().querySelector('[data-atmp-open="team-model"] .atmp-cell-value').textContent, 'team');
  assert.equal(ui.panel().querySelector('[data-atmp-open="team-effort"] .atmp-cell-value').textContent, 'Low');
  assert.deepEqual(ui.errors, []);
});

test('native Client: the main selector still drives the real shared directory', integration, async (t) => {
  const ui = await mountNativeClient(t);
  assert.deepEqual(ui.errors, []);
  await ui.drill('main-model');
  await ui.choose('["main-model","p","team"]');
  assert.equal(ui.calls.settings.length, 0);
  assert.equal(ui.calls.main[0].sessionId, 'lead-A');
  assert.equal(ui.directory('lead-A').store.getSnapshot().current.model, 'team');
});

for (const [label, options] of [
  ['read-only', { readOnly: true }],
  ['settings load failure', { describe: () => ({ ok: false, error: { code: 'offline', message: 'settings offline' } }) }],
]) {
  test(`native Client: ${label} keeps Team rows instead of abdicating`, integration, async (t) => {
    const ui = await mountNativeClient(t, options);
    assert.deepEqual(ui.errors, []);
    const panel = await ui.open();
    assert.equal(rowNames(panel).length, 4);
    assert.equal(panel.querySelector('[data-atmp-open="team-model"]').disabled, true);
    if (options.describe) assert.match(panel.querySelector('[role="alert"]').textContent, /settings offline/);
    assert.deepEqual(ui.errors, []);
  });
}

test('native Client: model catalog failure is visible without an unhandled load rejection', integration, async (t) => {
  const ui = await mountNativeClient(t, { catalog: () => ({ ok: false, error: { code: 'offline', message: 'catalog offline' } }) });
  assert.deepEqual(ui.errors, []);
  const panel = await ui.open();
  assert.equal(rowNames(panel).length, 4);
  assert.match(panel.querySelector('[role="alert"]').textContent, /catalog offline/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(ui.errors, []);
});

test('native Client: a CAS rejection stays in the menu without a false save', integration, async (t) => {
  const ui = await mountNativeClient(t, { mutate: async () => ({ ok: false, error: { code: 'settings/conflict', message: 'settings/conflict' } }) });
  assert.deepEqual(ui.errors, []);
  await ui.drill('team-model');
  await ui.choose('["team-model","p","team"]');
  assert.match(ui.panel().querySelector('[role="alert"]').textContent, /settings\/conflict/);
  assert.equal(ui.view.value.sessions['lead-A'], undefined);
  assert.deepEqual(ui.errors, []);
});

test('native Client: unloading the plugin restores the actual native picker', integration, async (t) => {
  const ui = await mountNativeClient(t);
  assert.deepEqual(ui.errors, []);
  await ui.open();
  await ui.unload();
  assert.equal(ui.trigger(), null);
  assert.equal(ui.panel(), null);
  assert.equal(ui.occupants().length, 1);
  assert.equal(ui.occupants()[0].active, true);
  assert.ok(ui.container.querySelector('button'));
  assert.deepEqual(ui.errors, []);
});
