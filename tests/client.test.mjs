// Real Cordis enforces service injection, real SlotCore elects the component,
// and real React DOM renders its portal into jsdom. Geometry is tested
// separately; these tests are not screenshots of a real phone or tablet.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import React, { act } from 'react';
import { Context } from '@deepseek-ai/cordis';
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots';
import { JSDOM } from 'jsdom';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/' });
const win = dom.window;
for (const key of ['window', 'document', 'Node', 'HTMLElement', 'HTMLButtonElement', 'navigator']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? win : win[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
const require = createRequire(import.meta.url);
const icon = ({ className, size = 14 }) => React.createElement('svg', { className, width: size, height: size, 'aria-hidden': true });
const compiled = await build({ entryPoints: ['src/client.ts'], bundle: true, write: false,
  format: 'cjs', platform: 'node', external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'] });
const module = { exports: {} };
runInNewContext(compiled.outputFiles[0].text, {
  module, exports: module.exports, window: win, document: win.document, Node: win.Node,
  HTMLElement: win.HTMLElement, HTMLButtonElement: win.HTMLButtonElement, queueMicrotask, console,
  require(name) {
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return {
      // DSH 0.1.7-rc.1 names the product icon set by glyph + stroke weight.
      // Legacy Menu is present only so the old implementation reaches the
      // failing assertions. The repaired view does not import this component.
      Menu: ({ anchor, open }) => React.createElement(React.Fragment, null, anchor, open && React.createElement('div', { 'data-legacy-menu': true })),
      IconDataOutlineRegular: icon, IconChevronDownOutlineRegular: icon,
      IconChevronRightOutlineRegular: icon, IconChevronLeftOutlineRegular: icon, IconCheckOutlineRegular: icon,
    };
    return require(name);
  },
});
after(() => dom.window.close());

async function click(element) {
  assert.ok(element, 'the requested control must be present');
  await act(async () => element.dispatchEvent(new win.MouseEvent('click', { bubbles: true })));
}
async function key(element, value, shiftKey = false) {
  await act(async () => element.dispatchEvent(new win.KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true })));
}

async function mount(t, options = {}) {
  Object.defineProperty(win, 'innerWidth', { configurable: true, value: options.width ?? 1024 });
  Object.defineProperty(win, 'innerHeight', { configurable: true, value: options.height ?? 768 });
  let strings;
  let Seat;
  const listeners = new Set();
  const slotsDisposers = [];
  const core = new SlotCore();
  const disposeRoot = core.register({ name: 'root', children: {
    'conversation.input.model': { kind: 'single', scope: 'session' },
  } }, () => null);
  const originalPicker = () => React.createElement('original-picker');
  core.register({ name: 'conversation.input.model', priority: 0 }, originalPicker);
  const calls = { settings: [], main: [], describe: 0 };
  const groups = [{ id: 'p', name: 'Provider', models: ['main', 'team'].map((id) => ({
    id, name: id, reasoning: { defaultEffort: 'high', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] },
  })) }];
  let state = { current: { provider: 'p', model: 'main', ...(options.omitEffort ? {} : { reasoningEffort: options.initialEffort ?? 'high' }) },
    groups, failures: [], status: 'ready', error: null };
  let view = { ns: 'agent-team-model-pin', revision: 1,
    base: { scope: 'teammates', defaults: {}, sessions: {} }, value: { sessions: {} } };
  const directory = {
    store: { getSnapshot: () => state, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } },
    load: async () => state,
    select: async (selection) => { calls.main.push(structuredClone(selection)); state = { ...state, current: selection }; listeners.forEach((fn) => fn()); return { ok: true }; },
  };
  const context = new Context();
  const providers = [];
  // DSH 0.1.7-rc.1 dropped the client `remote.agentTeams` namespace. The Team
  // root key comes from the client Session face's durable direct-parent
  // address, so the fixture models the real `sessions` service surface.
  const parents = new Map([['lead-A', undefined], ['lead-B', undefined], ['child-A', 'lead-A']]);
  const services = {
    locale: { register(ns, dicts) { strings = dicts.zh; return () => {}; },
      bind() { return (name) => strings[name]; }, subscribe() { return () => {}; } },
    modelDirectories: { directoryFor: () => directory },
    sessions: {
      binding: (id) => parents.has(id) ? { session: { getSnapshot: () => ({ subagent: parents.get(id) === undefined
        ? undefined : { address: { parentSessionId: parents.get(id), childSessionId: id, mode: 'continuable' } } }) } } : undefined,
    },
    remote: {
      settings: {
        describe: async () => { calls.describe++; return { ok: true, value: { writable: true, namespaces: [view] } }; },
        mutate: async (...args) => {
          calls.settings.push(structuredClone(args));
          if (options.mutate) return options.mutate(...args);
          const [, [op]] = args;
          view = { ...view, revision: view.revision + 1, value: { sessions: { ...view.value.sessions, [op.path[1]]: op.value } } };
          return { ok: true, value: view };
        },
      },
    },
    slots: {
      inject(name, fn) { assert.equal(name, 'conversation.input.model'); const dispose = fn(); slotsDisposers.push(dispose); return dispose; },
      register(spec, component) { Seat = component; return core.register(spec, component); },
    },
  };
  // Each RPC namespace is its own sibling Cordis service, not a plain
  // nested object. The transport facade delegates namespace reads to the
  // REAL Cordis resolver so a missing qualified inject cannot be hidden.
  const namespaces = { 'remote.session': {}, 'remote.settings': services.remote.settings };
  services.remote = {};
  const providerFiber = await context.plugin({ name: 'test-service-provider', apply(owner) {
    for (const [name, value] of Object.entries({ ...services, ...namespaces })) providers.push(owner.provide(name, value));
  } });
  const plugin = {
    name: module.exports.name,
    inject: module.exports.inject.filter((name) => name !== options.omitNamespace),
    apply(scope) {
      void scope.remote;
      const facade = new Proxy({}, { get(_target, key) {
        return key === 'settings' ? scope['remote.settings'] : undefined;
      } });
      return module.exports.apply(scope.extend({ remote: facade }));
    },
  };
  const fiber = await context.plugin(plugin);
  const winner = core.entriesOfSlot('conversation.input.model')[0];
  assert.equal(winner?.component, Seat, 'the real DSH registry must elect the Team picker');
  const container = win.document.createElement('div');
  win.document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(winner.component, { sessionId: options.sessionId ?? 'lead-A', locked: false })));
  let stopped = false;
  const unload = async () => {
    if (stopped) return;
    stopped = true;
    await act(async () => root.unmount());
    await fiber.dispose();
    for (const dispose of slotsDisposers.splice(0).reverse()) dispose();
    for (const dispose of providers.reverse()) await dispose();
    await providerFiber.dispose();
    container.remove();
  };
  t.after(async () => { await unload(); disposeRoot(); });
  const trigger = () => container.querySelector('[data-team-model-pin]');
  const panel = () => win.document.querySelector('[data-atmp-pane]');
  const open = async () => { if (!panel()) await click(trigger()); assert.ok(panel(), 'opening must render one anchored panel'); };
  const drill = async (pane) => { await open(); await click(panel()?.querySelector(`[data-atmp-open="${pane}"]`)); };
  const choose = async (id) => click([...win.document.querySelectorAll('[data-atmp-choice]')].find((item) => item.getAttribute('data-atmp-choice') === id));
  return { calls, core, originalPicker, unload, trigger, panel, open, drill, choose };
}

test('packaging: the client version marker is in lockstep with package.json', async (t) => {
  // 破坏方式：只改 package.json 版本而忘了 src 的 CLIENT_VERSION（或反之）→
  //           registrant 与 DOM 调试标记会指向一个不存在的版本，排障时误导。
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(module.exports.name, `agent-team-model-pin-ui-${manifest.version}`);
  const ui = await mount(t);
  await ui.open();
  assert.equal(ui.trigger().getAttribute('data-team-model-pin'), manifest.version);
});

test('real Cordis: Team settings load through an explicitly injected remote service', async (t) => {
  for (const namespace of ['remote.settings', 'sessions']) {
    assert.ok(module.exports.inject.includes(namespace), `the GUI requires the qualified service ${namespace}`);
  }
  const ui = await mount(t);
  assert.ok(ui.calls.describe > 0, 'remote access must reach the Host API, not fail the Cordis injection guard');
  await ui.open();
  assert.equal(ui.panel().querySelector('[data-atmp-open="team-model"]').disabled, false);
  assert.equal(ui.panel().querySelector('[role="alert"]'), null);
});

for (const namespace of ['remote.settings', 'sessions']) {
  test(`real Cordis: omitting ${namespace} reproduces the qualified GUI guard error`, async (t) => {
    const ui = await mount(t, { omitNamespace: namespace });
    await ui.open();
    if (namespace === 'remote.settings') assert.equal(ui.calls.describe, 0);
    const error = ui.panel().querySelector('[role="alert"]').textContent;
    assert.ok(error.includes(`"${namespace}" without inject`), error);
  });
}

test('real Cordis: a delegated child seat edits the pin of its Lead session', async (t) => {
  const ui = await mount(t, { sessionId: 'child-A' });
  assert.ok(ui.calls.describe > 0);
  await ui.drill('team-model');
  await ui.choose('["team-model","p","team"]');
  assert.deepEqual(ui.calls.settings, [['agent-team-model-pin', [{ op: 'set', path: ['sessions', 'lead-A'],
    value: { provider: 'p', model: 'team', modelDefault: true } }], 1]]);
});

test('real SlotCore + React DOM: native-looking trigger and original/Team rows', async (t) => {
  const ui = await mount(t);
  await ui.open();
  assert.deepEqual([...ui.panel().querySelectorAll('[data-atmp-open]')].map((row) => row.dataset.atmpOpen),
    ['main-model', 'main-effort', 'team-model', 'team-effort']);
  const style = win.getComputedStyle(ui.trigger());
  assert.equal(style.height, '28px');
  assert.equal(style.fontSize, '13px');
  assert.equal(style.backgroundColor, 'rgba(0, 0, 0, 0)');
});

for (const width of [320, 375, 768]) {
  test(`touch-only navigation at ${width}px replaces the pane without a side submenu`, async (t) => {
    const ui = await mount(t, { width, height: 640 });
    await ui.open();
    const card = ui.panel();
    await ui.drill('main-model');
    assert.equal(ui.panel(), card, 'drilling keeps the SAME anchored card');
    assert.equal(win.document.querySelectorAll('[data-atmp-pane]').length, 1);
    assert.equal(ui.panel().dataset.atmpPane, 'main-model');
    assert.ok(ui.panel().querySelector('[data-atmp-choice]'));
    assert.equal(win.getComputedStyle(ui.panel().querySelector('[data-atmp-scroll]')).overflowY, 'auto');
    await click(ui.panel().querySelector('[data-atmp-back]'));
    assert.equal(ui.panel().dataset.atmpPane, 'root');
    await ui.drill('main-effort');
    await ui.choose('["main-effort","low"]');
    assert.equal(ui.calls.main.at(-1).reasoningEffort, 'low');
    assert.equal(ui.panel(), null);
  });
}

test('React DOM: selecting Team model writes only the Team session settings', async (t) => {
  const ui = await mount(t);
  await ui.drill('team-model');
  await ui.choose('["team-model","p","team"]');
  assert.deepEqual(ui.calls.settings, [['agent-team-model-pin', [{ op: 'set', path: ['sessions', 'lead-A'],
    value: { provider: 'p', model: 'team', modelDefault: true } }], 1]]);
  assert.equal(ui.calls.main.length, 0);
});

test('React DOM: main model still uses the shared directory and model default effort', async (t) => {
  const ui = await mount(t);
  await ui.drill('main-model');
  await ui.choose('["main-model","p","team"]');
  assert.deepEqual(ui.calls.main, [{ provider: 'p', model: 'team', reasoningEffort: 'high' }]);
  assert.equal(ui.calls.settings.length, 0);
});

test('native compatibility: an omitted main effort displays the model default', async (t) => {
  const ui = await mount(t, { omitEffort: true });
  assert.equal(ui.trigger().querySelector('.atmp-trigger-effort')?.textContent, 'High');
  await ui.open();
  assert.equal(ui.panel().querySelector('[data-atmp-open="main-effort"] .atmp-cell-value').textContent, 'High');
});

test('native compatibility: selecting the current main model does not reset its effort', async (t) => {
  const ui = await mount(t, { initialEffort: 'low' });
  await ui.drill('main-model');
  await ui.choose('["main-model","p","main"]');
  assert.equal(ui.calls.main.length, 0);
  assert.equal(ui.trigger().querySelector('.atmp-trigger-effort')?.textContent, 'Low');
});

test('keyboard navigation returns to root before closing and restores trigger focus', async (t) => {
  const ui = await mount(t);
  await ui.drill('team-effort');
  await key(ui.panel(), 'Escape');
  assert.equal(ui.panel().dataset.atmpPane, 'root');
  await key(ui.panel(), 'Escape');
  assert.equal(ui.panel(), null);
  assert.equal(win.document.activeElement, ui.trigger());
});

test('outside pointerdown closes the touch popup', async (t) => {
  const ui = await mount(t);
  await ui.open();
  await act(async () => win.document.body.dispatchEvent(new win.MouseEvent('pointerdown', { bubbles: true })));
  assert.equal(ui.panel(), null);
});

test('a pending save locks the trigger; failure stays visible in the same pane', async (t) => {
  let settle;
  const ui = await mount(t, { mutate: () => new Promise((resolve) => { settle = resolve; }) });
  t.after(() => settle?.({ ok: false, error: { message: 'settings/conflict' } }));
  await ui.drill('team-model');
  await ui.choose('["team-model","p","team"]');
  assert.equal(ui.trigger().disabled, true);
  const reads = ui.calls.describe;
  await click(ui.trigger());
  assert.equal(ui.calls.describe, reads);
  await act(async () => settle({ ok: false, error: { message: 'settings/conflict' } }));
  assert.match(ui.panel().querySelector('[role="alert"]').textContent, /settings\/conflict/);
  assert.equal(ui.trigger().disabled, false);
});

test('unloading restores the original picker and removes the portaled card', async (t) => {
  const ui = await mount(t);
  await ui.open();
  await ui.unload();
  assert.equal(ui.core.entriesOfSlot('conversation.input.model')[0].component, ui.originalPicker);
  assert.equal(ui.panel(), null);
});
