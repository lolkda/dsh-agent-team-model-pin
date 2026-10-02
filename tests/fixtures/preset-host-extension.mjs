/**
 * TEST-ONLY candidate host extension. Never edits the installed SDK.
 * Every transformation requires one exact rc.2 source marker; drift fails loud.
 * See patches/README.md before using the generated patch outside a fixture.
 */
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SUBAGENT_BASE_VERSION = '0.2.0-rc.2';
export const workspaceSubagentRoot = fileURLToPath(new URL('../../node_modules/@deepseek-ai/dsh-subagent/', import.meta.url));
const own = (text, before, after, label) => {
  const count = text.split(before).length - 1;
  if (count !== 1) throw new Error(`Child-setup patch source drift: ${label} expected 1 exact marker, found ${count}`);
  return text.replace(before, after);
};

const hookMethods = `/** Versioned, native, pre-publication continuable-child setup capability. */
get childSetupVersion() { return 1; }
/** Register trusted composition-only setup; its calling fiber owns the registration. */
registerChildSetup(callback) {
    if (typeof callback !== 'function') throw new TypeError('Child setup callback must be a function');
    const entry = { callback, active: true };
    return this.ctx.effect(function* () {
        this.childSetupHooks.add(entry);
        yield () => { entry.active = false; this.childSetupHooks.delete(entry); };
    }.bind(this), 'subagents.registerChildSetup()');
}
/** Snapshot registrations once; owner disposal during preparation fails closed. */
async prepareChildSetup(payload) {
    const entries = [...this.childSetupHooks];
    const commits = [];
    const assertCurrent = () => {
        payload.signal.throwIfAborted();
        if (entries.some(entry => !entry.active)) throw new Error('Child setup owner disposed during initialization');
    };
    assertCurrent();
    for (const entry of entries) {
        const prepared = await entry.callback(payload);
        assertCurrent();
        if (prepared !== undefined) {
            if (prepared === null || typeof prepared.commit !== 'function') throw new TypeError('Child setup must return void or a synchronous commit');
            commits.push(() => prepared.commit());
        }
    }
    return { commit() {
        assertCurrent();
        for (const commit of commits) {
            const returned = commit();
            // Do not let an async commit escape the publication transaction.
            if (returned !== undefined) {
                if (returned && typeof returned.then === 'function') void Promise.resolve(returned).catch(() => {});
                throw new TypeError('Child setup commit must be synchronous and return void');
            }
            assertCurrent();
        }
    } };
}
`;

const setupTail = `// Restore the child's durable identity even when the selecting plugin was removed.
// Parent fork events are not the child's selection; its header is the fallback.
if (create === undefined) {
    let presetId = child.session.header.agentPreset;
    for (const event of child.session.snapshotEvents(child.session.inheritedEventCount)) {
        if (event.type === 'agent-preset/selected') {
            if (typeof event.data?.agentPreset !== 'string' || event.data.agentPreset.length === 0) {
                throw new Error('Invalid persisted child agent-preset selection');
            }
            presetId = event.data.agentPreset;
        }
    }
    if (presetId !== undefined) {
        const presets = childCtx.get('agentPresets');
        if (presets === undefined) throw new Error('Cannot restore child preset without agentPresets');
        inputs.signal.throwIfAborted();
        await presets.mount(childCtx, presetId);
        inputs.signal.throwIfAborted();
    }
}
// Run before agent/created dispatch snapshots preset-scoped listeners.
return await this.prepareChildSetup({
    childCtx, child, parent,
    source: create === undefined ? 'resume' : 'startup',
    signal: inputs.signal,
});`;

const indent = (text, padding) => text.trimEnd().split('\n').map(line => padding + line).join('\n');
function extendRuntime(text, bundled) {
  const pad = bundled ? '\t\t' : '        ';
  text = own(text, `${pad}providers = ${bundled ? '/* @__PURE__ */ ' : ''}new Map();`, `${pad}providers = ${bundled ? '/* @__PURE__ */ ' : ''}new Map();\n${pad}childSetupHooks = new Set();`, 'runtime hook registry');
  const method = `${pad}resolveMaxDepth(configured) {`;
  const docStart = text.lastIndexOf(`${pad}/**`, text.indexOf(method));
  if (docStart < 0) throw new Error('Child-setup patch source drift: resolveMaxDepth documentation missing');
  const existingDoc = text.slice(docStart, text.indexOf(method));
  text = own(text, existingDoc + method, `${indent(hookMethods, pad)}\n${existingDoc}${method}`, 'runtime public hook methods');
  const callback = 'observeActivation: (provider, childId, parent) => this.observeActivation(provider, childId, parent)';
  const callbackAt = text.indexOf(callback);
  const callbackIndent = text.slice(text.lastIndexOf('\n', callbackAt) + 1, callbackAt);
  // Bundler leaves final object property without comma; generated module retains it.
  const suffix = bundled ? '' : ',';
  text = own(text, callbackIndent + callback + suffix, callbackIndent + callback + `,\n${callbackIndent}prepareChildSetup: payload => this.prepareChildSetup(payload)${suffix}`, 'manager host setup forwarding');
  return text;
}
function extendManager(text) {
  return own(text,
    'new ContinuableActivationRegistry(ctx, (provider, childId, parent) => host.observeActivation(provider, childId, parent), maxActiveSubagents)',
    'new ContinuableActivationRegistry(ctx, (provider, childId, parent) => host.observeActivation(provider, childId, parent), maxActiveSubagents, payload => host.prepareChildSetup(payload))',
    'manager activation setup forwarding');
}
function extendActivation(text, bundled) {
  const pad = bundled ? '\t' : '    ';
  text = own(text, `${pad}constructor(ctx, observeActivation, maxActiveSubagents) {`, `${pad}prepareChildSetup;\n${pad}constructor(ctx, observeActivation, maxActiveSubagents, prepareChildSetup) {\n${pad}${pad}this.prepareChildSetup = prepareChildSetup;`, 'activation constructor');
  text = own(text, 'const setup = (childCtx, child) => {', 'const setup = async (childCtx, child) => {', 'async unpublished setup');
  const line = `${pad.repeat(3)}applyChildComposition(childCtx, parent, inputs.composition);`;
  return own(text, line, line + '\n' + indent(setupTail, pad.repeat(3)), 'native restore and setup callback');
}

const payloadTypes = `
/** Trusted unpublished child setup. No Agent driving or publication is allowed here. */
export interface ChildSetupContext {
    readonly childCtx: import('@deepseek-ai/cordis').Context;
    readonly child: Agent;
    readonly parent: Agent;
    readonly source: 'startup' | 'resume';
    readonly signal: AbortSignal;
}
/** Composition prepared now, with a synchronous factory-publication guard if needed. */
export type ChildSetupCallback = (payload: ChildSetupContext) =>
    void | import('@deepseek-ai/dsh-agent').AgentSetupCommit |
    Promise<void | import('@deepseek-ai/dsh-agent').AgentSetupCommit>;
`;

/** Return original and transformed real package files for reviewable patch generation. */
export async function patchedSubagentFiles(sourceRoot = workspaceSubagentRoot) {
  const manifest = JSON.parse(await readFile(join(sourceRoot, 'package.json'), 'utf8'));
  if (manifest.version !== SUBAGENT_BASE_VERSION) throw new Error(`Child-setup fixture requires DSH ${SUBAGENT_BASE_VERSION}, got ${manifest.version}`);
  const changes = [];
  const edit = async (path, transform) => {
    const before = await readFile(join(sourceRoot, path), 'utf8');
    const after = transform(before);
    if (before === after) throw new Error(`Child-setup patch did not change ${path}`);
    changes.push({ path, before, after });
  };
  await edit('lib/index.js', text => extendActivation(extendManager(extendRuntime(text, true)), true));
  await edit('lib/types/index.js', text => extendRuntime(text, false));
  await edit('lib/types/continuation.js', extendManager);
  await edit('lib/types/continuation-activation.js', text => extendActivation(text, false));
  await edit('lib/types/types.d.ts', text => own(text, '/** What a caller asks for when starting a continuable background child. */', payloadTypes + '\n/** What a caller asks for when starting a continuable background child. */', 'public payload types'));
  await edit('lib/types/index.d.ts', text => {
    text = own(text, 'export type { ContinuableCreateRequest,', 'export type { ChildSetupContext, ChildSetupCallback, ContinuableCreateRequest,', 'public hook exports');
    return own(text, '    resolveMaxDepth(configured?: number', `    /** Native unpublished continuable child setup protocol; absent in stock rc.2. */\n    readonly childSetupVersion: 1;\n    registerChildSetup(callback: import('./types.ts').ChildSetupCallback): () => void;\n    private childSetupHooks;\n    private prepareChildSetup;\n    resolveMaxDepth(configured?: number`, 'public hook methods declarations');
  });
  await edit('lib/types/continuation.d.ts', text => own(text, 'interface ContinuationHost {', `interface ContinuationHost {\n    prepareChildSetup(payload: import('./types.ts').ChildSetupContext): Promise<import('@deepseek-ai/dsh-agent').AgentSetupCommit>;`, 'internal host declaration'));
  await edit('lib/types/continuation-activation.d.ts', text => own(text,
    'maxActiveSubagents: () => number);',
    `maxActiveSubagents: () => number, prepareChildSetup: (payload: import('./types.ts').ChildSetupContext) => Promise<import('@deepseek-ai/dsh-agent').AgentSetupCommit>);`,
    'internal activation declaration'));
  return changes;
}

/**
 * Import an ISOLATED copy of the real extended service sharing the caller's SDK.
 * Usage: const fixture = await loadPatchedSubagent(); t.after(fixture.dispose);
 *        ctx.plugin(fixture.module.default, config);
 * Dispose test contexts before disposing the package fixture.
 */
export async function loadPatchedSubagent({ sourceRoot = workspaceSubagentRoot, nodeModulesRoot = resolve(sourceRoot, '../..') } = {}) {
  const changes = await patchedSubagentFiles(sourceRoot);
  const directory = await mkdtemp(join(tmpdir(), 'atmp-preset-host-'));
  const root = join(directory, 'dsh-subagent');
  const dispose = () => rm(directory, { recursive: true, force: true });
  try {
    await cp(sourceRoot, root, { recursive: true });
    await symlink(nodeModulesRoot, join(directory, 'node_modules'), 'dir');
    for (const { path, after } of changes) await writeFile(join(root, path), after);
    const module = await import(pathToFileURL(join(root, 'lib/index.js')).href);
    return { module, root, dispose, [Symbol.asyncDispose]: dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
