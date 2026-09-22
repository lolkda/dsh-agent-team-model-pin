// Test-only integration boundary: actual Cordis, native ModelDirectoryResolver,
// native SlotRegistry/renderer and native fallback picker. Only transport,
// session retention/projection IO, locale and SVG artwork are fixtures.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import React, { act } from 'react';
import { Context, Service } from '@deepseek-ai/cordis';
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';
import { JSDOM, VirtualConsole } from 'jsdom';
import { findDshInstallation } from './dsh-installation.mjs';

export const installation = await findDshInstallation();
const require = createRequire(import.meta.url);
const h = React.createElement;
const noop = () => {};
const domErrors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (error) => domErrors.push(error));
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/', pretendToBeVisual: true, virtualConsole,
});
const win = dom.window;
for (const key of ['window', 'document', 'Node', 'HTMLElement', 'HTMLButtonElement', 'navigator']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? win : win[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const icon = ({ className, size = 14 }) => h('svg', { className, width: size, height: size, 'aria-hidden': true });
const primitives = {
  IconDataOutline16: icon, IconChevronDownOutline14: icon, IconChevronRightOutline14: icon,
  IconChevronLeftOutline14: icon, IconCheckOutline16: icon, IconWarningOutline16: icon,
  Toast: ({ message }) => h('div', { role: 'status' }, message),
};
let consoleSink;
async function loadClient(path) {
  let registration;
  runInNewContext(await readFile(path, 'utf8'), {
    window: { ...win, __ModuleLoader__: { load(value) { registration = value; } },
      innerWidth: 1024, innerHeight: 768, addEventListener: win.addEventListener.bind(win),
      removeEventListener: win.removeEventListener.bind(win), visualViewport: win.visualViewport },
    document: win.document, Node: win.Node, HTMLElement: win.HTMLElement, HTMLButtonElement: win.HTMLButtonElement,
    queueMicrotask, console: { ...console, error: (...args) => consoleSink?.push(args) },
  });
  assert.ok(registration?.factory, `${path} must declare a browser factory`);
  return registration.factory((name) => name === '@deepseek-ai/dsh-client-ui-primitives' ? primitives : require(name));
}
const native = installation ? await loadClient(join(installation, 'node_modules/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js')) : undefined;
const renderer = installation ? await loadClient(join(installation, 'node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js')) : undefined;
const candidate = installation ? await loadClient(join(process.env.DSH_TEST_PACKAGE_ROOT ?? fileURLToPath(new URL('../..', import.meta.url)), 'dist/client.js')) : undefined;
export function closeNativeClientDom() { dom.window.close(); }

// Each namespace is a real sibling Cordis service. Nested lookups retain the
// actual caller context, so native directory creation cannot skip RPC guards.
class RemoteFacade extends Service {
  constructor(ctx) { super(ctx, 'remote'); }
  $on() { return noop; }
  get session() { return this.ctx['remote.session']; }
  get settings() { return this.ctx['remote.settings']; }
  get agentTeams() { return this.ctx['remote.agentTeams']; }
}

export async function mountNativeClient(t, options = {}) {
  assert.ok(native && renderer && candidate, 'the integration requires an installed DSH');
  const root = new Context();
  const container = win.document.createElement('div');
  win.document.body.append(container);
  const errors = [];
  const consoleErrors = [];
  consoleSink = consoleErrors;
  const calls = { settings: [], main: [], catalog: 0 };
  const bindings = new Map();
  const projected = new Map();
  const bindingListeners = new Set();
  let currentBinding;
  let localeSnapshot = { revision: 0 };
  const localeListeners = new Set();
  const dictionaries = new Map();
  const locale = {
    register(ns, dicts) {
      dictionaries.set(ns, dicts.zh);
      localeSnapshot = { revision: localeSnapshot.revision + 1 };
      for (const listener of localeListeners) listener();
      return () => dictionaries.delete(ns);
    },
    bind(ns) { return (key) => dictionaries.get(ns)?.[key] ?? key; },
    getSnapshot: () => localeSnapshot,
    subscribe(fn) { localeListeners.add(fn); return () => localeListeners.delete(fn); },
  };
  const groups = [{ id: 'p', name: 'Provider', models: ['main', 'team'].map((id) => ({
    id, name: id, reasoning: { defaultEffort: 'high', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] },
  })) }];
  let view = { ns: 'agent-team-model-pin', revision: 1,
    base: { scope: 'teammates', defaults: {}, configuredSessions: {} }, value: { sessions: {} } };
  let stopMount;
  let candidateFiber;
  let stopped = false;
  t.after(async () => {
    if (stopped) return;
    stopped = true;
    try { await act(async () => { stopMount?.(); await root.fiber.dispose(); }); }
    finally { consoleSink = undefined; container.remove(); }
  });
  const ensureSession = async (id) => {
    if (bindings.has(id)) return bindings.get(id);
    const fiber = await root.plugin({ name: `native-client-session-${id}`, apply() {} });
    const projection = createSnapshotStore({ lastUsed: null, next: { provider: 'p', model: 'main', reasoningEffort: 'high' } });
    projected.set(id, projection);
    const binding = { sessionId: id, ctx: fiber.ctx, session: { projections: { faceOf: () => projection } } };
    bindings.set(id, binding);
    return binding;
  };
  const source = {
    getSnapshot: () => currentBinding,
    subscribe(fn) { bindingListeners.add(fn); return () => bindingListeners.delete(fn); },
  };
  const setCurrent = async (id) => {
    const binding = await ensureSession(id);
    currentBinding = { key: id, ctx: binding.ctx, hooks: {}, keyedHooks: {}, props: { sessionId: id } };
    for (const listener of bindingListeners) listener();
  };
  await setCurrent('lead-A');
  await root.plugin({ name: 'native-client-io', apply(ctx) {
    ctx.provide('locale', locale);
    ctx.provide('commandUi', { register: () => noop });
    ctx.provide('sessions', {
      scope: (id) => bindings.get(id)?.ctx, binding: (id) => bindings.get(id), subagentAddress: () => undefined,
    });
    ctx.provide('remote.session', {
      async modelCatalog() {
        calls.catalog++;
        if (options.catalog) return options.catalog();
        return { ok: true, value: { default: { provider: 'p', model: 'main' }, groups, failures: [], routableProviders: ['p'] } };
      },
      async selectModel(request) {
        calls.main.push(structuredClone(request));
        const { sessionId, ...selection } = request;
        projected.get(sessionId).set({ lastUsed: null, next: selection });
        return { ok: true };
      },
    });
    ctx.provide('remote.settings', {
      async describe() {
        return options.describe?.() ?? { ok: true, value: { writable: !options.readOnly, namespaces: [view] } };
      },
      async mutate(...args) {
        calls.settings.push(structuredClone(args));
        if (options.mutate) return options.mutate(...args);
        const [, [op], revision] = structuredClone(args);
        assert.equal(revision, view.revision);
        view = { ...view, revision: view.revision + 1, value: { sessions: { ...view.value.sessions, [op.path[1]]: op.value } } };
        return { ok: true, value: view };
      },
    });
    ctx.provide('remote.agentTeams', { view: async (id) => ({ ok: true, value: { members: [{ id, role: 'lead' }], tasks: [] } }) });
  } });
  await root.plugin(RemoteFacade);
  await root.plugin(renderer);
  const slots = root.get('slots');
  slots.installLocale(locale);
  slots.installScope('session', { current: source, bindingSource: () => source, renderArea: (_binding, props) => props.children });
  slots.onEntryError((key, entry, error, info) => errors.push({ key, registrant: entry.registrant, message: String(error), ...info }));
  await root.plugin({ name: 'native-client-frame', inject: ['slots'], apply(ctx) {
    ctx.slots.register({ name: 'root', children: { 'conversation.input.model': { kind: 'single', scope: 'session' } } },
      ({ renderSlot, SessionProvider }) => h(SessionProvider, null, renderSlot('conversation.input.model', { locked: false })));
  } });
  await root.plugin(native);
  if (options.warm) await root.get('modelDirectories').directoryFor('lead-A').load();
  candidateFiber = await root.plugin({ ...candidate, inject: candidate.inject.filter((name) => name !== options.omitNamespace) });
  const originalConsoleError = console.error;
  console.error = (...args) => consoleErrors.push(args);
  try { await act(async () => { stopMount = root.get('uiRenderer').mount(container); }); }
  finally { console.error = originalConsoleError; }
  const trigger = () => container.querySelector('[data-team-model-pin]');
  const panel = () => win.document.querySelector('[data-atmp-pane]');
  const click = async (element) => {
    assert.ok(element, 'the native-rendered control must exist');
    await act(async () => element.dispatchEvent(new win.MouseEvent('click', { bubbles: true })));
  };
  const open = async () => { if (!panel()) await click(trigger()); return panel(); };
  const drill = async (pane) => { await open(); await click(panel().querySelector(`[data-atmp-open="${pane}"]`)); };
  const choose = async (id) => click([...win.document.querySelectorAll('[data-atmp-choice]')].find((item) => item.getAttribute('data-atmp-choice') === id));
  return { root, slots, errors, consoleErrors, calls, trigger, panel, open, drill, choose, click, container,
    candidateName: candidate.name,
    get view() { return view; },
    directory: (id) => root.get('modelDirectories').directoryFor(id),
    occupants: () => slots.snapshot('conversation.input.model')[0].occupants,
    async switchSession(id) {
      const original = console.error;
      console.error = (...args) => consoleErrors.push(args);
      try { await act(async () => { await setCurrent(id); }); }
      finally { console.error = original; }
    },
    async unload() { await act(async () => { await candidateFiber.dispose(); }); },
  };
}
