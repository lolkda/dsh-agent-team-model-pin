import test from 'node:test';
import assert from 'node:assert/strict';
import { Context, Service } from '@deepseek-ai/cordis';
import { installPresetCommand } from '../src/preset-client.ts';

const ns = 'agent-team-model-pin';
const session = (sessionId = 'lead-A') => ({ sessionId });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function harness(options = {}) {
  const state = {
    view: { ns, revision: 4, base: {}, value: { sessions: { 'lead-A': { provider: 'p', model: 'm' } } }, ...options.view },
    rows: [
      { id: 'standard', name: 'Standard', description: 'Full tools', isDefault: true },
      { id: 'reviewer', name: 'Reviewer', description: 'Review tools', isDefault: false },
      { id: 'broken', name: 'Broken', broken: 'activation failure', isDefault: false },
    ],
    writable: true, supported: true, calls: [], executed: [], directWrites: 0, lists: 0, describes: 0, dismissed: [],
    parents: new Map(Object.entries(options.parents ?? { 'mate-A': 'lead-A' })),
    bindings: new Map(), effects: [], registrations: new Map(), decorations: new Map(), language: options.language ?? 'en',
  };
  const bind = id => ({ session: { getSnapshot: () => {
    const parentSessionId = state.parents.get(id);
    return parentSessionId ? { subagent: { address: { parentSessionId } } } : {};
  } } });
  for (const id of ['lead-A', 'lead-B', 'mate-A']) state.bindings.set(id, bind(id));
  const dictionaries = new Map();
  const remote = {
    settings: {
      async describe() {
        state.describes++;
        if (state.describe) return state.describe();
        return { ok: true, value: { writable: state.writable, namespaces: [structuredClone(state.view)] } };
      },
      async mutate() {
        state.directWrites++;
        assert.fail('Client must not bypass the Host capability gate with settings.mutate');
      },
    },
    commands: {
      async execute(agentId, line, attachments, signal) {
        state.executed.push({ agentId, line, attachments, signal });
        if (state.execute) return state.execute(agentId, line, attachments, signal);
        const error = text => ({ ok: true, value: { result: { kind: 'error', text } } });
        if (!state.supported) return error('unsupported Team preset runtime');
        if (!state.writable) return error('settings/read-only');
        const match = /^\/team-preset apply (\d+) ([\s\S]+)$/.exec(line);
        assert.ok(match, 'Host apply grammar must carry revision and JSON choice');
        const revision = Number(match[1]);
        const choice = JSON.parse(match[2]);
        assert.ok(typeof choice === 'string' || choice === null);
        if (revision !== state.view.revision) return error('settings/conflict');
        const namespace = ns;
        const ops = [{ op: 'set', path: ['presetSessions', agentId], value: choice }];
        state.calls.push({ namespace, ops, revision });
        if (state.mutate) {
          const result = await state.mutate(namespace, ops, revision);
          return result.ok ? { ok: true, value: { result: { kind: 'success' } } } : error(result.error.message);
        }
        state.view.value.presetSessions ??= {};
        state.view.value.presetSessions[agentId] = choice;
        state.view.revision++;
        return { ok: true, value: { result: { kind: 'success', text: 'Saved for future teammates' } } };
      },
    },
    agentPresets: {
      async list() {
        state.lists++;
        if (state.list) return state.list();
        return { ok: true, value: { presets: structuredClone(state.rows) } };
      },
    },
  };
  if (options.absentCatalog) delete remote.agentPresets;
  if (options.absentCommands) delete remote.commands;
  const ctx = {
    commandUi: {
      decorate(row) { state.decorations.set(row.name, row); return () => state.decorations.delete(row.name); },
      register(row) { state.registrations.set(row.name, row); return () => state.registrations.delete(row.name); },
      dismiss(name) { state.dismissed.push(name); },
    },
    sessions: { binding: id => state.bindings.get(id) },
    remote,
    locale: {
      register(name, values) { dictionaries.set(name, values); return () => dictionaries.delete(name); },
      bind(name) { return key => dictionaries.get(name)?.[state.language]?.[key] ?? key; },
    },
    effect(callback) { const dispose = callback(); state.effects.push(dispose); return dispose; },
  };
  const install = () => installPresetCommand(ctx);
  if (options.install !== false) install();
  const ui = () => state.decorations.get('team-preset').ui;
  const open = async (id = 'lead-A', controller = new AbortController()) => {
    const spec = ui();
    const rows = await spec.options(session(id), controller.signal);
    return { rows, controller, choose: preset => spec.onSelect(rows.find(row => row.id === JSON.stringify(['team-preset', preset])), session(id)) };
  };
  return { ctx, state, install, ui, open, rebind: id => state.bindings.set(id, bind(id)),
    unload: () => { for (const dispose of state.effects.splice(0).reverse()) dispose(); } };
}

test('preset popup is native, decorates root host command and contributes only for children', () => {
  const h = harness();
  const root = h.state.decorations.get('team-preset');
  const child = h.state.registrations.get('team-preset');
  assert.equal(root.available(session()), true);
  assert.equal(root.available(session('mate-A')), false);
  assert.equal(child.available(session()), false);
  assert.equal(child.available(session('mate-A')), true);
  assert.equal(child.available(session('absent')), false);
  assert.equal(root.ui, child.ui);
  assert.equal(root.ui.kind, 'popupSelect');
  assert.equal(root.ui.searchMode, 'fuzzy-label');
  assert.match(root.description(), /future teammates/);
  assert.match(root.ui.searchLabels().placeholder, /presets/);
});

test('preset popup lists follow and usable presets, never a broken preset', async () => {
  const h = harness();
  const popup = await h.open();
  assert.deepEqual(popup.rows.map(row => row.id), ['["team-preset",null]', '["team-preset","standard"]', '["team-preset","reviewer"]']);
  assert.equal(popup.rows[0].active, true);
  assert.equal(popup.rows[1].active, false, 'registry default is not a Team override');
  assert.match(popup.rows[2].detail, /reviewer.*Review tools.*new teammates/);
  h.state.language = 'zh';
  assert.match(h.ui().searchLabels().placeholder, /预设/);
  assert.match(h.state.decorations.get('team-preset').description(), /现有队友不变/);
});

for (const [label, view, selected] of [
  ['composition default', { base: { presetDefault: 'reviewer' } }, 'reviewer'],
  ['resolved default', { base: { presetDefault: 'standard' }, value: { presetDefault: 'reviewer' } }, 'reviewer'],
  ['composition session', { base: { presetDefault: 'standard', presetSessions: { 'lead-A': 'reviewer' } } }, 'reviewer'],
  ['resolved session', { base: { presetSessions: { 'lead-A': 'standard' } }, value: { presetSessions: { 'lead-A': 'reviewer' } } }, 'reviewer'],
  ['explicit session null', { base: { presetDefault: 'standard', presetSessions: { 'lead-A': 'reviewer' } }, value: { presetSessions: { 'lead-A': null } } }, null],
  ['explicit default null', { base: { presetDefault: 'standard' }, value: { presetDefault: null } }, null],
]) test(`preset popup resolves ${label} without losing explicit null`, async () => {
  const h = harness({ view });
  const popup = await h.open();
  assert.equal(popup.rows.find(row => row.active)?.id, JSON.stringify(['team-preset', selected]));
});

test('unknown configured preset is not misrepresented as following Lead', async () => {
  const h = harness({ view: { value: { presetSessions: { 'lead-A': 'removed' } } } });
  const popup = await h.open();
  assert.equal(popup.rows.some(row => row.active), false);
});

test('saving addresses only the opening Lead preset path, preserves model and other preset policies', async () => {
  const h = harness({ view: { value: { sessions: { 'lead-A': { model: 'fixed' } },
    presetDefault: 'standard', presetSessions: { 'lead-B': 'standard' } } } });
  const popup = await h.open('mate-A');
  await popup.choose('reviewer');
  assert.deepEqual(h.state.calls, [{ namespace: ns, ops: [{ op: 'set', path: ['presetSessions', 'lead-A'], value: 'reviewer' }], revision: 4 }]);
  assert.deepEqual(h.state.view.value, { sessions: { 'lead-A': { model: 'fixed' } }, presetDefault: 'standard',
    presetSessions: { 'lead-B': 'standard', 'lead-A': 'reviewer' } });
  assert.equal(h.state.lists, 2, 'catalog revalidated before write');
  assert.deepEqual(h.state.executed, [{ agentId: 'lead-A', line: '/team-preset apply 4 \"reviewer\"', attachments: [], signal: popup.controller.signal }]);
  assert.equal(h.state.directWrites, 0);
});

test('follow explicitly writes null so a configured baseline does not become active again', async () => {
  const h = harness({ view: { base: { presetDefault: 'reviewer' } } });
  const popup = await h.open();
  await popup.choose(null);
  assert.deepEqual(h.state.calls[0].ops, [{ op: 'set', path: ['presetSessions', 'lead-A'], value: null }]);
  assert.equal((await h.open()).rows[0].active, true);
});

test('missing catalog does not fail installation and gives clear error only when opening preset menu', async () => {
  const h = harness({ absentCatalog: true });
  assert.equal(h.state.decorations.size, 1);
  await assert.rejects(h.open(), /catalog is unavailable/);
  assert.equal(h.state.calls.length, 0);
});

test('guarded unavailable Remote getter never breaks plugin installation', async () => {
  const h = harness({ install: false });
  Object.defineProperty(h.ctx.remote, 'agentPresets', { get() { throw new Error('cannot get property without inject'); } });
  assert.doesNotThrow(h.install);
  await assert.rejects(h.open(), /catalog is unavailable/);
});

test('optional Cordis namespace is resolved through the injected child, not undeclared parent', async (t) => {
  const h = harness({ install: false });
  const root = new Context();
  class RemoteFacade extends Service {
    constructor(ctx) { super(ctx, 'remote'); }
    get settings() { return this.ctx['remote.settings']; }
    get agentPresets() { return this.ctx['remote.agentPresets']; }
    get commands() { return this.ctx['remote.commands']; }
  }
  const services = await root.plugin({ name: 'preset-test-services', apply(ctx) {
    ctx.provide('commandUi', h.ctx.commandUi);
    ctx.provide('sessions', h.ctx.sessions);
    ctx.provide('locale', h.ctx.locale);
    ctx.provide('remote.settings', h.ctx.remote.settings);
    ctx.provide('remote.commands', h.ctx.remote.commands);
    new RemoteFacade(ctx);
  } });
  const mounted = await root.plugin({ name: 'preset-test-client',
    inject: ['commandUi', 'sessions', 'locale', 'remote', 'remote.settings'], apply: installPresetCommand });
  t.after(async () => { await mounted.dispose(); await services.dispose(); });
  await assert.rejects(h.open(), /catalog is unavailable/);
  const catalog = await root.plugin({ name: 'preset-test-catalog', apply(ctx) { ctx.provide('remote.agentPresets', h.ctx.remote.agentPresets); } });
  // Cordis settles dynamic child activation after its required service appears.
  await catalog.await();
  await new Promise(resolve => setImmediate(resolve));
  const popup = await h.open();
  assert.equal(popup.rows.length, 3);
  await popup.choose('reviewer');
  await catalog.dispose();
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(h.open(), /catalog is unavailable/);
});

for (const [label, setup, pattern] of [
  ['read-only', h => { h.state.writable = false; }, /read-only/],
  ['missing plugin settings', h => { h.state.describe = () => ({ ok: true, value: { writable: true, namespaces: [] } }); }, /not ready/],
  ['settings RPC failure', h => { h.state.describe = () => ({ ok: false, error: { message: 'settings offline' } }); }, /settings offline/],
  ['catalog RPC failure', h => { h.state.list = () => ({ ok: false, error: { message: 'catalog offline' } }); }, /catalog offline/],
  ['malformed catalog', h => { h.state.list = () => ({ ok: true, value: { presets: [{}] } }); }, /invalid data/],
  ['invalid revision', h => { h.state.view.revision = NaN; }, /valid revision/],
]) test(`preset popup ${label} rejects without writing`, async () => {
  const h = harness(); setup(h);
  await assert.rejects(h.open(), pattern);
  assert.equal(h.state.calls.length, 0);
});

for (const [label, change] of [
  ['removed', h => { h.state.rows = h.state.rows.filter(row => row.id !== 'reviewer'); }],
  ['broken', h => { h.state.rows.find(row => row.id === 'reviewer').broken = 'failure after opening'; }],
]) test(`preset becomes ${label} after opening: save revalidation rejects without writes`, async () => {
  const h = harness();
  const popup = await h.open(); change(h);
  await assert.rejects(popup.choose('reviewer'), /removed or cannot be loaded/);
  assert.equal(h.state.calls.length, 0);
});

test('catalog outage during save is surfaced and retry remains possible', async () => {
  const h = harness();
  const popup = await h.open();
  h.state.list = () => ({ ok: false, error: { message: 'save catalog offline' } });
  await assert.rejects(popup.choose('reviewer'), /save catalog offline/);
  assert.equal(h.state.calls.length, 0);
  delete h.state.list;
  await popup.choose('reviewer');
  assert.equal(h.state.calls.length, 1);
});

test('CAS uses opening revision and propagates conflict without overwriting settings', async () => {
  const h = harness();
  const popup = await h.open();
  h.state.view.revision++;
  h.state.view.value.presetSessions = { 'lead-A': 'standard' };
  await assert.rejects(popup.choose('reviewer'), /settings\/conflict/);
  assert.equal(h.state.executed[0].line, '/team-preset apply 4 \"reviewer\"');
  assert.equal(h.state.calls.length, 0);
  assert.equal(h.state.directWrites, 0);
  assert.equal(h.state.view.value.presetSessions['lead-A'], 'standard');
});

for (const [label, change] of [
  ['close', (_h, p) => p.controller.abort()],
  ['unload', h => h.unload()],
  ['session detached', h => h.state.bindings.delete('mate-A')],
  ['same id rebound', h => h.rebind('mate-A')],
  ['parent changed', h => h.state.parents.set('mate-A', 'lead-B')],
]) test(`${label} after opening invalidates every old preset choice`, async () => {
  const h = harness();
  const popup = await h.open('mate-A'); change(h, popup);
  await assert.rejects(popup.choose('reviewer'));
  assert.equal(h.state.calls.length, 0);
});

test('session context mismatch and forged choice never select a preset', async () => {
  const h = harness();
  const popup = await h.open();
  const row = popup.rows.find(row => row.id.includes('reviewer'));
  await assert.rejects(h.ui().onSelect(row, session('lead-B')), /Reopen/);
  await assert.rejects(h.ui().onSelect({ ...row }, session()), /Reopen/);
  assert.equal(h.state.calls.length, 0);
});

test('new popup invalidates prior choices even if the old controller was not aborted', async () => {
  const h = harness();
  const old = await h.open();
  await h.open();
  await assert.rejects(old.choose('reviewer'), /Reopen/);
  assert.equal(h.state.calls.length, 0);
});

test('closing during asynchronous catalog revalidation prevents the settings write', async () => {
  const h = harness();
  const popup = await h.open();
  const later = deferred(); h.state.list = () => later.promise;
  const saving = popup.choose('reviewer');
  popup.controller.abort();
  later.resolve({ ok: true, value: { presets: h.state.rows } });
  await assert.rejects(saving);
  assert.equal(h.state.calls.length, 0);
});

test('binding change during settings load prevents publishing options from the stale load', async () => {
  const h = harness();
  const later = deferred(); h.state.describe = () => later.promise;
  const opening = h.open('mate-A');
  h.state.parents.set('mate-A', 'lead-B');
  later.resolve({ ok: true, value: { writable: true, namespaces: [h.state.view] } });
  await assert.rejects(opening, /Reopen/);
  assert.equal(h.state.lists, 0);
});

test('late mutation success after close cannot claim success for the next popup', async () => {
  const h = harness();
  const popup = await h.open();
  const sent = deferred(), done = deferred();
  h.state.mutate = async () => { sent.resolve(); return done.promise; };
  const saving = popup.choose('reviewer');
  await sent.promise;
  popup.controller.abort();
  done.resolve({ ok: true, value: h.state.view });
  await assert.rejects(saving);
  assert.equal(h.state.calls.length, 1, 'already submitted writes cannot be revoked');
});

test('duplicate selection is rejected while pending and after successful commit', async () => {
  const h = harness();
  const popup = await h.open();
  const later = deferred(); h.state.list = () => later.promise;
  const saving = popup.choose('reviewer');
  await assert.rejects(popup.choose('reviewer'), /Reopen/);
  later.resolve({ ok: true, value: { presets: h.state.rows } });
  await saving;
  await assert.rejects(popup.choose('reviewer'), /Reopen/);
  assert.equal(h.state.calls.length, 1);
});

test('unload removes only preset registrations and dismisses its native popup', () => {
  const h = harness();
  h.unload();
  assert.equal(h.state.decorations.size, 0);
  assert.equal(h.state.registrations.size, 0);
  assert.deepEqual(h.state.dismissed, ['team-preset']);
});


test('unsupported Host capability is surfaced as failure with zero direct or Host writes', async () => {
  const h = harness();
  const popup = await h.open();
  h.state.supported = false;
  await assert.rejects(popup.choose('reviewer'), /unsupported Team preset runtime/);
  assert.equal(h.state.executed.length, 1);
  assert.equal(h.state.calls.length, 0);
  assert.equal(h.state.directWrites, 0);
  assert.equal(h.state.view.value.presetSessions, undefined);
});

test('missing command namespace is optional at installation but saving has no settings fallback', async () => {
  const h = harness({ absentCommands: true });
  await assert.rejects(h.open(), /command is unavailable/);
  assert.equal(h.state.calls.length, 0);
  assert.equal(h.state.directWrites, 0);
});

for (const [label, response, pattern] of [
  ['command removed', { ok: true, value: undefined }, /command is unavailable/],
  ['command RPC rejected', { ok: false, error: { message: 'gateway unavailable' } }, /gateway unavailable/],
  ['Host handler rejected', { ok: true, value: { result: { kind: 'error', text: 'Host rejected preset' } } }, /Host rejected preset/],
]) test(`${label} cannot masquerade as a successful preset save`, async () => {
  const h = harness();
  const popup = await h.open();
  h.state.execute = () => response;
  await assert.rejects(popup.choose('reviewer'), pattern);
  assert.equal(h.state.calls.length, 0);
  assert.equal(h.state.directWrites, 0);
});

test('preset IDs are JSON-escaped in Host command payload, not interpolated as arguments', async () => {
  const h = harness();
  const id = 'reviewer \"quoted\"\nwith whitespace';
  h.state.rows.push({ id, name: 'Custom preset' });
  const popup = await h.open();
  await popup.choose(id);
  assert.equal(h.state.executed[0].line, `/team-preset apply 4 ${JSON.stringify(id)}`);
  assert.equal(h.state.view.value.presetSessions['lead-A'], id);
  assert.equal(h.state.directWrites, 0);
});
