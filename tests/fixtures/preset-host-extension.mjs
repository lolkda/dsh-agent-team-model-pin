/**
 * TEST-ONLY candidate host extension. Never edits the installed SDK.
 *
 * The published `@deepseek-ai/dsh-subagent@0.2.2-rc.1` predates the
 * `childSetupVersion = 1` protocol. Tests prefer the exact subagent shipped in
 * a deployment that already exposes the protocol; otherwise they copy the npm
 * package into an isolated directory and apply one exact, test-only source
 * transform. Every marker must occur once, so a future package change fails
 * loud instead of silently testing a different host.
 */
import { access, cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findDshInstallation } from './dsh-installation.mjs';

export const SUBAGENT_BASE_VERSION = '0.2.2-rc.1';
export const workspaceSubagentRoot = fileURLToPath(new URL('../../node_modules/@deepseek-ai/dsh-subagent/', import.meta.url));
const projectNodeModules = fileURLToPath(new URL('../../node_modules/', import.meta.url));

const own = (text, before, after, label) => {
  const count = text.split(before).length - 1;
  if (count !== 1) throw new Error(`Child-setup patch source drift: ${label} expected 1 exact marker, found ${count}`);
  return text.replace(before, after);
};

const hookMethods = `\t\t/** Versioned, native, pre-publication continuable-child setup capability. */
\t\tget childSetupVersion() { return 1; }
\t\t/** Register trusted composition-only setup; its calling fiber owns the registration. */
\t\tregisterChildSetup(callback) {
\t\t    if (typeof callback !== 'function') throw new TypeError('Child setup callback must be a function');
\t\t    const entry = { callback, active: true };
\t\t    return this.ctx.effect(function* () {
\t\t        this.childSetupHooks.add(entry);
\t\t        yield () => { entry.active = false; this.childSetupHooks.delete(entry); };
\t\t    }.bind(this), 'subagents.registerChildSetup()');
\t\t}
\t\t/** Snapshot registrations once; owner disposal during preparation fails closed. */
\t\tasync prepareChildSetup(payload) {
\t\t    const entries = [...this.childSetupHooks];
\t\t    const commits = [];
\t\t    const assertCurrent = () => {
\t\t        payload.signal.throwIfAborted();
\t\t        if (entries.some(entry => !entry.active)) throw new Error('Child setup owner disposed during initialization');
\t\t    };
\t\t    assertCurrent();
\t\t    for (const entry of entries) {
\t\t        const prepared = await entry.callback(payload);
\t\t        assertCurrent();
\t\t        if (prepared !== undefined) {
\t\t            if (prepared === null || typeof prepared.commit !== 'function') throw new TypeError('Child setup must return void or a synchronous commit');
\t\t            commits.push(() => prepared.commit());
\t\t        }
\t\t    }
\t\t    return { commit() {
\t\t        assertCurrent();
\t\t        for (const commit of commits) {
\t\t            const returned = commit();
\t\t            // Do not let an async commit escape the publication transaction.
\t\t            if (returned !== undefined) {
\t\t                if (returned && typeof returned.then === 'function') void Promise.resolve(returned).catch(() => {});
\t\t                throw new TypeError('Child setup commit must be synchronous and return void');
\t\t            }
\t\t            assertCurrent();
\t\t        }
\t\t    } };
\t\t}
`;

const setupTail = `\t\t\t\t// Restore the child's durable identity even when the selecting plugin was removed.
\t\t\t\t// Parent fork events are not the child's selection; its header is the fallback.
\t\t\t\tif (create === undefined) {
\t\t\t\t    let presetId = child.session.header.agentPreset;
\t\t\t\t    for (const event of child.session.snapshotEvents(child.session.inheritedEventCount)) {
\t\t\t\t        if (event.type === 'agent-preset/selected') {
\t\t\t\t            if (typeof event.data?.agentPreset !== 'string' || event.data.agentPreset.length === 0) {
\t\t\t\t                throw new Error('Invalid persisted child agent-preset selection');
\t\t\t\t            }
\t\t\t\t            presetId = event.data.agentPreset;
\t\t\t\t        }
\t\t\t\t    }
\t\t\t\t    if (presetId !== undefined) {
\t\t\t\t        const presets = childCtx.get('agentPresets');
\t\t\t\t        if (presets === undefined) throw new Error('Cannot restore child preset without agentPresets');
\t\t\t\t        inputs.signal.throwIfAborted();
\t\t\t\t        await presets.mount(childCtx, presetId);
\t\t\t\t        inputs.signal.throwIfAborted();
\t\t\t\t    }
\t\t\t\t}
\t\t\t\t// Run before agent/created dispatch snapshots preset-scoped listeners.
\t\t\t\treturn await this.host.prepareChildSetup({
\t\t\t\t    childCtx, child, parent,
\t\t\t\t    source: create === undefined ? 'resume' : 'startup',
\t\t\t\t    signal: inputs.signal,
\t\t\t\t});`;

const docMarker = `\t\t/**\n\t\t* Resolve a delegation tool's depth policy against the current user setting.`;
const outputMarker = `\t\t\t\tif (inputs.outputSchema !== void 0) structured = attachStructuredRuntime(childCtx, inputs.outputSchema, () => this.resident.get(childId)?.ownedChildren.size === 0 && child.inbox.nextStep.length === 0 && child.inbox.nextTurn.length === 0);`;
const callback = `\t\t\t\t\tobserveActivation: (provider, childId, parent) => this.observeActivation(provider, childId, parent)`;
const providers = `\t\tproviders = /* @__PURE__ */ new Map();`;

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

function extendTypes(text) {
  return own(text, '/** One managed child execution and its result delivery policy. */', `${payloadTypes}/** One managed child execution and its result delivery policy. */`, 'public child setup types');
}

function extendIndexTypes(text) {
  text = own(text, 'export type { ContinuableCreateRequest,', 'export type { ChildSetupContext, ChildSetupCallback, ContinuableCreateRequest,', 'public hook type exports');
  return own(text, '    protected [Service.init](): Promise<void>;', `    protected [Service.init](): Promise<void>;\n    /** Native unpublished continuable child setup protocol; absent in stock DSH. */\n    readonly childSetupVersion: 1;\n    registerChildSetup(callback: import('./types.ts').ChildSetupCallback): () => void;\n    private childSetupHooks;\n    private prepareChildSetup;`, 'public hook members');
}

function extendManagerTypes(text) {
  return own(text, 'interface SubagentHost {', `interface SubagentHost {\n    prepareChildSetup(payload: import('./types.ts').ChildSetupContext): Promise<import('@deepseek-ai/dsh-agent').AgentSetupCommit>;`, 'internal host declaration');
}


function extendRuntime(text) {
  text = own(text, providers, `${providers}\n\t\tchildSetupHooks = new Set();`, 'runtime hook registry');
  text = own(text, docMarker, `${hookMethods}${docMarker}`, 'runtime public hook methods');
  text = own(text, callback, `${callback},\n\t\t\t\t\tprepareChildSetup: payload => this.prepareChildSetup(payload)`, 'manager host setup forwarding');
  return own(text, outputMarker, `${setupTail}\n${outputMarker}`, 'native restore and setup callback');
}

/** Return original and transformed real package files for reviewable patch generation. */
export async function patchedSubagentFiles(sourceRoot = workspaceSubagentRoot) {
  const manifest = JSON.parse(await readFile(join(sourceRoot, 'package.json'), 'utf8'));
  if (manifest.version !== SUBAGENT_BASE_VERSION) {
    throw new Error(`Child-setup fixture requires DSH ${SUBAGENT_BASE_VERSION}, got ${manifest.version}`);
  }
  const changes = [];
  const edit = async (path, transform) => {
    const before = await readFile(join(sourceRoot, path), 'utf8');
    const after = transform(before);
    if (before === after) throw new Error(`Child-setup patch did not change ${path}`);
    changes.push({ path, before, after });
  };
  await edit('lib/index.js', extendRuntime);
  await edit('lib/types/types.d.ts', extendTypes);
  await edit('lib/types/index.d.ts', extendIndexTypes);
  await edit('lib/types/manager.d.ts', extendManagerTypes);
  return changes;
}

async function hasChildSetup(sourceRoot) {
  try {
    return (await readFile(join(sourceRoot, 'lib/index.js'), 'utf8')).includes('childSetupVersion');
  } catch {
    return false;
  }
}

async function packageExists(sourceRoot) {
  try {
    await access(join(sourceRoot, 'package.json'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Load an isolated copy of the real subagent runtime.
 * @param {{sourceRoot?: string, nodeModulesRoot?: string}} [options] Test seams.
 * @returns The module, copied root, and idempotent disposer.
 */
export async function loadPatchedSubagent({ sourceRoot = process.env.DSH_TEST_SUBAGENT_ROOT, nodeModulesRoot = projectNodeModules } = {}) {
  const explicit = sourceRoot !== undefined;
  const installation = explicit ? undefined : await findDshInstallation();
  const candidates = explicit
    ? [sourceRoot]
    : [
        installation ? join(installation, 'node_modules/@deepseek-ai/dsh-subagent') : undefined,
        installation ? join(dirname(installation), 'dsh-subagent') : undefined,
        workspaceSubagentRoot,
      ];
  let source;
  let patch = true;
  for (const candidate of candidates.filter(Boolean)) {
    if (!(await packageExists(candidate))) continue;
    if (await hasChildSetup(candidate)) {
      source = candidate;
      patch = false;
      break;
    }
    source ??= candidate;
  }
  if (source === undefined) throw new Error('No DSH subagent runtime is available for the preset fixture');
  const directory = await mkdtemp(join(tmpdir(), 'atmp-preset-host-'));
  const root = join(directory, 'dsh-subagent');
  const dispose = () => rm(directory, { recursive: true, force: true });
  try {
    // Keep the package layout, but never copy its dependency tree: the
    // symlink below makes it resolve the project's single SDK instance.
    await cp(source, root, {
      recursive: true,
      filter: (path) => path === source || !dirname(path).endsWith('node_modules'),
    });
    await symlink(nodeModulesRoot, join(directory, 'node_modules'), 'dir');
    if (patch) {
      for (const change of await patchedSubagentFiles(source)) {
        await writeFile(join(root, change.path), change.after);
      }
    }
    const module = await import(pathToFileURL(join(root, 'lib/index.js')).href);
    return { module, root, dispose, [Symbol.asyncDispose]: dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
