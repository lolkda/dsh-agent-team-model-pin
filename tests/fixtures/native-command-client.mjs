// Actual DSH command registry, popup controller/view, model directory and slot
// renderer. Transport/session retention, locale, artwork and layout are seams.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import React, { act } from 'react';
import { Context, Service } from '@deepseek-ai/cordis';
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';
import { JSDOM } from 'jsdom';
import { findDshInstallation } from './dsh-installation.mjs';

export const installation = await findDshInstallation();
const require = createRequire(import.meta.url);
const h = React.createElement;
const noop = () => {};
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
const win = dom.window;
for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'HTMLButtonElement', 'navigator']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? win : win[key] });
}
win.HTMLElement.prototype.scrollIntoView = noop; // jsdom has no scrolling layout.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
export function closeDom() { dom.window.close(); }

// Load the inspected, self-contained ranking region verbatim from the shipped
// primitives bundle. Importing the whole module in Node would execute unrelated
// CSS/markdown initializers; never replace the real fuzzy ranking with a mock.
let rankByName;
if (installation) {
  const code = await readFile(join(installation, 'node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/index.js'), 'utf8');
  const region = code.match(/\/\/#region lib\/types\/rank-by-name\.js\n([\s\S]*?)\/\/#endregion/);
  assert.ok(region, 'the native ranking module must remain identifiable; update this test boundary if DSH changes its bundle layout');
  rankByName = runInNewContext(`${region[1]}\nrankByName;`);
}
const icon = ({ className, size = 14 }) => h('svg', { className, width: size, height: size, 'aria-hidden': true });
const primitives = {
  rankByName,
  IconDataOutlineRegular: icon, IconChevronDownOutlineRegular: icon, IconChevronRightOutlineRegular: icon,
  IconChevronLeftOutlineRegular: icon, IconCheckOutlineRegular: icon, IconWarningOutlineRegular: icon,
  IconCloseFillRegular: icon, StateDot: icon,
  Toast: ({ message }) => h('div', { role: 'status' }, message),
  MenuSurface: React.forwardRef((props, ref) => h('div', { ...props, ref })),
  MenuGroup: ({ label, children }) => h('section', null, h('h3', null, label), children),
  Input: React.forwardRef((props, ref) => h('input', { ...props, ref })),
  useAnchoredMaxHeight: () => 320,
  observeStickyMenuGroups: () => noop,
};
let consoleSink;
async function loadClient(path) {
  let registration;
  runInNewContext(await readFile(path, 'utf8'), {
    window: { ...win, __ModuleLoader__: { load(value) { registration = value; } }, innerWidth: 1024, innerHeight: 768,
      addEventListener: win.addEventListener.bind(win), removeEventListener: win.removeEventListener.bind(win) },
    document: win.document, Node: win.Node, Element: win.Element, HTMLElement: win.HTMLElement,
    HTMLButtonElement: win.HTMLButtonElement, AbortController, AbortSignal, queueMicrotask, setTimeout, clearTimeout,
    console: { ...console, error: (...args) => consoleSink?.push(args) },
  });
  assert.ok(registration?.factory, `${path} must register a native browser factory`);
  return registration.factory((name) => name === '@deepseek-ai/dsh-client-ui-primitives' ? primitives : require(name));
}
const fromInstall = (name) => loadClient(join(installation, 'node_modules/@deepseek-ai', name, 'lib/client.js'));
const commands = installation ? await fromInstall('dsh-client-ui-commands') : undefined;
const native = installation ? await fromInstall('dsh-client-ui-model-selection') : undefined;
const renderer = installation ? await fromInstall('dsh-client-ui-renderer') : undefined;
const candidate = installation ? await loadClient(join(process.env.DSH_TEST_PACKAGE_ROOT ?? fileURLToPath(new URL('../..', import.meta.url)), 'dist/client.js')) : undefined;
class RemoteFacade extends Service {
  constructor(ctx) { super(ctx, 'remote'); }
  $on() { return noop; }
  get session() { return this.ctx['remote.session']; }
  get settings() { return this.ctx['remote.settings']; }
  get commands() { return this.ctx['remote.commands']; }
  get agentPresets() { return this.ctx['remote.agentPresets']; }
}

export async function mount(t, options = {}) {
  assert.ok(candidate && commands && native && renderer);
  const root = new Context();
  const container = win.document.createElement('div');
  win.document.body.append(container);
  const calls = { settings: [], main: [], executed: [], consumed: [], focused: 0, catalog: 0, presetCatalog: 0, presetWrites: [] };
  const errors = [], consoleErrors = [];
  consoleSink = consoleErrors;
  const bindings = new Map(), projections = new Map(), listeners = new Set();
  const parents = new Map(Object.entries(options.parents ?? {}));
  let currentBinding, slash, stopMount, candidateFiber;
  let language = 'zh', localeRevision = 0;
  const dictionaries = new Map(), localeListeners = new Set();
  const locale = {
    register(ns, dicts) { dictionaries.set(ns, dicts); return () => dictionaries.delete(ns); },
    bind(ns) { return (key, params = {}) => {
      let text = dictionaries.get(ns)?.[language]?.[key] ?? key;
      for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value));
      return text;
    }; },
    getSnapshot: () => localeRevision,
    subscribe(fn) { localeListeners.add(fn); return () => localeListeners.delete(fn); },
  };
  const groups = options.groups ?? [{ id: 'p', name: 'Provider', models: ['main', 'team'].map((id) => ({
    id, name: id, reasoning: { defaultEffort: 'high', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] },
  })) }];
  let view = { ns: 'agent-team-model-pin', revision: 1,
    base: { scope: 'teammates', defaults: {}, sessions: {} }, value: { sessions: {} }, ...options.view };
  // This remains a Host RPC seam, not a fake native popup: actual DSH command
  // discovery, decoration, popup, search, selection and token handling run below.
  const presetRows = options.presetRows ?? [
    { id: 'standard', name: 'Standard', description: 'Main tools', isDefault: true },
    { id: 'reviewer', name: 'Reviewer', description: 'Review tools', isDefault: false },
    { id: 'broken', name: 'Broken', broken: 'activation failed', isDefault: false },
  ];
  const commandResult = (kind, text) => ({ ok: true, value: { result: { kind, text } } });
  const applyPresetCommand = async (leadId, revision, choice, signal) => {
    if (options.presetSupported === false) return commandResult('error', 'Team preset runtime unsupported; install the pre-publication hook');
    if (options.readOnly) return commandResult('error', 'settings/read-only');
    if (revision !== view.revision) return commandResult('error', 'settings/conflict');
    if (typeof choice !== 'string' && choice !== null) return commandResult('error', 'invalid preset choice');
    if (choice !== null && !presetRows.some(row => row.id === choice && row.broken === undefined)) {
      return commandResult('error', 'preset unavailable');
    }
    signal?.throwIfAborted();
    if (options.presetApply) return options.presetApply(leadId, revision, choice, signal);
    calls.presetWrites.push({ leadId, revision, choice });
    view = { ...view, revision: view.revision + 1,
      value: { ...view.value, presetSessions: { ...view.value.presetSessions, [leadId]: choice } } };
    return commandResult('success', 'Saved for future teammates; existing teammates unchanged');
  };
  const ensureSession = async (id) => {
    if (bindings.has(id)) return bindings.get(id);
    const fiber = await root.plugin({ name: `command-session-${id}`, apply() {} });
    const projected = createSnapshotStore({ lastUsed: null, next: { provider: 'p', model: 'main', reasoningEffort: 'high' } });
    projections.set(id, projected);
    const address = parents.has(id) ? { parentSessionId: parents.get(id), childSessionId: id, mode: 'continuable' } : undefined;
    const session = { sessionId: id, projections: { faceOf: () => projected },
      getSnapshot: () => ({ openState: 'open', blank: true, subagent: address ? { address } : undefined }) };
    const binding = { sessionId: id, ctx: fiber.ctx, session };
    bindings.set(id, binding);
    fiber.ctx.on('slash/input-consume-token', (event) => { calls.consumed.push({ id, ...event }); return true; });
    return binding;
  };
  await ensureSession('lead-A');
  await ensureSession('lead-B');
  const setCurrent = async (id) => {
    const binding = await ensureSession(id);
    currentBinding = { key: id, ctx: binding.ctx, hooks: {}, keyedHooks: {}, props: { sessionId: id } };
    for (const fn of listeners) fn();
  };
  await setCurrent(options.session ?? 'lead-A');
  const sessions = {
    scope: (id) => bindings.get(id)?.ctx, binding: (id) => bindings.get(id),
    subagentAddress: (id) => bindings.get(id)?.session.getSnapshot().subagent?.address,
    sessionOf: (ctx) => [...bindings.values()].find((b) => b.ctx === ctx)?.session,
    using: async (id, _reason, fn) => fn({ binding: bindings.get(id) }),
  };
  const source = { getSnapshot: () => currentBinding,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
  // Production gateway namespaces are tracked Services. The optional variant
  // reproduces Cordis returning a fresh caller-bound Proxy on each lookup.
  const provideRemote = (ctx, name, implementation) => {
    if (!options.tracedRemotes) return ctx.provide(`remote.${name}`, implementation);
    class Namespace extends Service {
      constructor(owner) { super(owner, `remote.${name}`); }
    }
    const service = new Namespace(ctx);
    Object.assign(service, implementation);
    return service;
  };
  await root.plugin({ name: 'command-io', apply(ctx) {
    ctx.provide('locale', locale);
    ctx.provide('sessions', sessions);
    ctx.provide('conversation', { input: { for: () => ({ focus: () => { calls.focused++; } }) } });
    ctx.provide('inputTriggers', { registerSource(value) { slash = value; return () => { slash = undefined; }; } });
    provideRemote(ctx, 'commands', {
      list: async () => ({ ok: true, value: [
        { name: 'team-model', description: 'Team model', input: { hint: '<provider> <model> [effort]' } },
        ...(options.teamPreset ? [{ name: 'team-preset', description: 'Team preset for new teammates' }] : []),
      ] }),
      execute: async (...args) => {
        calls.executed.push(args);
        const [leadId, line, attachments, signal] = args;
        if (options.teamPreset && line.startsWith('/team-preset apply ')) {
          assert.deepEqual(Array.from(attachments), []);
          const match = /^\/team-preset apply (\d+) ([\s\S]+)$/.exec(line);
          if (!match) return commandResult('error', 'invalid preset apply command');
          return applyPresetCommand(leadId, Number(match[1]), JSON.parse(match[2]), signal);
        }
        return { ok: true, value: { result: { kind: 'success' } } };
      },
    });
    if (options.teamPreset && !options.omitPresetCatalog) provideRemote(ctx, 'agentPresets', {
      async list() {
        calls.presetCatalog++;
        return options.presetCatalog?.() ?? { ok: true, value: { presets: presetRows } };
      },
    });
    ctx.provide('remote.session', {
      async modelCatalog() {
        calls.catalog++;
        return options.catalog?.() ?? { ok: true, value: { default: { provider: 'p', model: 'main' }, groups, failures: [], routableProviders: groups.map(g => g.id) } };
      },
      async selectModel(request) {
        calls.main.push(structuredClone(request));
        const { sessionId, ...selection } = request;
        projections.get(sessionId).set({ lastUsed: null, next: selection });
        return { ok: true };
      },
    });
    ctx.provide('remote.settings', {
      describe: async () => options.describe?.() ?? { ok: true, value: { writable: !options.readOnly, namespaces: [view] } },
      async mutate(...args) {
        calls.settings.push(structuredClone(args));
        if (options.mutate) return options.mutate(...args);
        const [, [op], rev] = structuredClone(args);
        if (rev !== view.revision) return { ok: false, error: { code: 'settings/conflict', message: 'settings/conflict' } };
        view = { ...view, revision: view.revision + 1, value: { ...view.value, sessions: { ...view.value.sessions, [op.path[1]]: op.value } } };
        return { ok: true, value: view };
      },
    });
  } });
  await root.plugin(RemoteFacade);
  await root.plugin(renderer);
  const slots = root.get('slots');
  slots.installLocale(locale);
  slots.installScope('session', { current: source, bindingSource: () => source, renderArea: (_binding, props) => props.children });
  slots.onEntryError((key, entry, error, info) => errors.push({ key, registrant: entry.registrant, message: String(error), ...info }));
  await root.plugin({ name: 'command-frame', inject: ['slots'], apply(ctx) {
    ctx.slots.register({ name: 'root', children: {
      'conversation.input.model': { kind: 'single', scope: 'session' },
      'conversation.input.overlay': { kind: 'list', scope: 'session' },
    } }, ({ renderSlot, SessionProvider }) => h(SessionProvider, null,
      renderSlot('conversation.input.model', { locked: false }), renderSlot('conversation.input.overlay')));
  } });
  await root.plugin(commands);
  await root.plugin(native);
  const before = slots.snapshot('conversation.input.model')[0].occupants;
  candidateFiber = await root.plugin({ ...candidate, inject: candidate.inject.filter(name => name !== options.omitNamespace) });
  await act(async () => { stopMount = root.get('uiRenderer').mount(container); });
  t.after(async () => {
    try { await act(async () => { stopMount?.(); await root.fiber.dispose(); }); }
    finally { consoleSink = undefined; container.remove(); }
  });
  const session = (id = currentBinding.key) => ({ sessionId: id });
  const popup = (id = currentBinding.key) => root.get('commandUi').popupFor(bindings.get(id).ctx);
  const enter = async (line, id = currentBinding.key, envelope = { attachments: 0 }) => {
    let result;
    await act(async () => { result = await slash.matchEnter(session(id), line, AbortSignal.timeout(5000), envelope); });
    return result;
  };
  const click = async (element) => { assert.ok(element); await act(async () => { element.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); }); };
  return {
    root, slots, calls, errors, consoleErrors, container, before, candidateName: candidate.name,
    popup, enter, click, groups, presetRows, session,
    occupants: () => slots.snapshot('conversation.input.model')[0].occupants,
    panel: () => container.querySelector('[role="listbox"]'),
    candidates: async (id = currentBinding.key) => slash.candidates(session(id), { query: '', position: 'leading', signal: AbortSignal.timeout(5000) }),
    async choose(id, sessionId = currentBinding.key) {
      const controller = popup(sessionId);
      const rows = commands.filterOptions(controller.state.getSnapshot().options, controller.state.getSnapshot().search, controller.state.getSnapshot().searchMode);
      const index = rows.findIndex(row => row.id === id);
      assert.notEqual(index, -1, `missing choice ${id}: ${JSON.stringify(rows)}`);
      await act(async () => { await controller.select(index); });
    },
    async search(text) { await act(async () => { popup().setSearch(text); }); },
    async key(key) { await act(async () => {
      container.querySelector('input')?.dispatchEvent(new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    }); },
    async switchSession(id) { await act(async () => { await setCurrent(id); }); },
    async selectMain(selection, id = 'lead-A') { await act(async () => { await root.get('modelDirectories').directoryFor(id).select(selection); }); },
    async unload() { await act(async () => { await candidateFiber.dispose(); }); },
    async setLanguage(value) { await act(async () => { language = value; localeRevision++; for (const fn of localeListeners) fn(); }); },
    setView(value) { view = value; },
    get view() { return view; },
  };
}
