/**
 * Team preset selection belongs to unpublished child composition, NOT to the
 * request pipeline or agent/created. Cordis snapshots scoped creation listeners
 * before dispatch; rebinding there would run the old preset's initializers.
 *
 * Requires the explicitly advertised native child-setup extension. Stock rc.2
 * keeps all model-only behavior and rejects explicitly configured preset work.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { AgentPresetRegistry } from '@deepseek-ai/dsh-agent-preset-registry';
import { supportsTeamPresetRuntime } from './preset-capability.ts';

export { supportsTeamPresetRuntime } from './preset-capability.ts';
export type TeamPresetCapture = (leadId: string) => string | null | undefined;

/** Version-one native seam, after child-local composition and before publication. */
export interface TeamPresetChildSetup {
  childCtx: Context;
  child: Agent;
  parent: Agent;
  source: 'startup' | 'resume';
  signal: AbortSignal;
}
export interface TeamPresetSetupCommit { commit(): void }
interface ChildSetupRuntime {
  readonly childSetupVersion: 1;
  registerChildSetup(callback: (input: TeamPresetChildSetup) => Promise<TeamPresetSetupCommit | void>): () => void;
}
interface Teams {
  tryMembership(agent: Agent): { role: 'lead' | 'teammate'; root: Agent } | undefined;
  listMembers(parent: Agent): readonly { id: string; role: 'lead' | 'teammate'; status?: string }[];
}
type Presets = Pick<AgentPresetRegistry, 'mount' | 'composedPreset'>;
interface ServiceAccess { get(name: string): unknown }

function service<T>(host: ServiceAccess, name: string): T | undefined {
  return host.get(name) as T | undefined;
}
function presetId(value: unknown, origin: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`agent-team-model-pin: invalid ${origin} Agent preset identity`);
  }
  return value;
}

/** Only the child's own suffix can override its creation header, never fork history. */
function ownSelection(agent: Agent): string | undefined {
  let selected: string | undefined;
  for (const event of agent.session.snapshotEvents(agent.session.inheritedEventCount)) {
    if (event.type === 'agent-preset/selected') selected = presetId(event.data.agentPreset, 'persisted');
  }
  return selected;
}
function requirePresets(host: ServiceAccess): Presets {
  const api = service<Partial<Presets>>(host, 'agentPresets');
  if (typeof api?.mount !== 'function' || typeof api.composedPreset !== 'function') {
    throw new Error('agent-team-model-pin: agentPresets service unavailable; refusing to run a teammate under an unintended preset');
  }
  return api as Presets;
}

/**
 * Apply per-Lead policy once to FUTURE Team members; restoration is driven only
 * by the child's log/header. This never enumerates or recomposes live Agents.
 * The native activation still owns policies, persona/tool restrictions, registry
 * publication and failure cleanup. Ordinary subagents and Leads are untouched.
 */
export function installTeamPresetRuntime(host: Context, capture: TeamPresetCapture): void {
  const access = host as unknown as ServiceAccess;
  let attached: object | undefined;
  {
    // Compatibility guard only: NEVER mount from this late event. A manually
    // edited explicit setting must not silently run a child with the Lead preset.
    host.on('agent/created', ({ agent, source }) => {
      if (attached !== undefined) return;
      const membership = service<Teams>(access, 'agentTeams')?.tryMembership(agent);
      if (membership?.role !== 'teammate') return;
      if (source === 'resume') {
        // Old/custom model-only drivers may not expose the native Session log.
        if (!agent.session?.header || typeof agent.session.snapshotEvents !== 'function') return;
        const expected = ownSelection(agent) ?? agent.session.header.agentPreset;
        if (expected === undefined) return;
        const current = service<Partial<Presets>>(access, 'agentPresets')?.composedPreset?.(agent.ctx);
        if (current !== expected) {
          throw new Error('agent-team-model-pin: DSH 缺少安全的预设恢复接口，队友当前预设与持久记录不符；已拒绝恢复。');
        }
        return;
      }
      if (source !== 'startup') return;
      const requested = capture(membership.root.id);
      if (requested === null || requested === undefined) return;
      presetId(requested, 'configured');
      throw new Error('agent-team-model-pin: 当前 DSH 缺少安全的队友创建前预设接口（childSetupVersion=1）；本次队友创建已拒绝，未以其他预设继续运行。');
    });
  }
  // The plugin's required dependencies intentionally exclude subagents. Bind
  // when it appears, and let Cordis remove this registration on service unload.
  host.inject(['subagents'], childHost => {
    if (!supportsTeamPresetRuntime(childHost as unknown as ServiceAccess)) return;
    installNativePresetRuntime(childHost, capture);
    const identity = {};
    attached = identity;
    childHost.effect(() => () => { if (attached === identity) attached = undefined; });
  });
}

function installNativePresetRuntime(host: Context, capture: TeamPresetCapture): void {
  const access = host as unknown as ServiceAccess;
  let active = true;
  const runtime = service<ChildSetupRuntime>(access, 'subagents')!;
  const stop = runtime.registerChildSetup(async ({ childCtx, child, parent, source, signal }) => {
    const teams = service<Teams>(access, 'agentTeams');
    const membership = teams?.tryMembership(parent);
    if (!teams || membership?.role !== 'lead' || membership.root !== parent) return;
    // tryMembership(child) is deliberately NOT used: this child is unpublished.
    if (child.session.header.parentSession !== parent.id
      || !teams.listMembers(parent).some(row => row.id === child.id && row.role === 'teammate' && row.status !== 'failed')) return;

    const assertInitializing = (): void => {
      signal.throwIfAborted();
      if (!active) throw new Error('agent-team-model-pin: preset selector disposed during child initialization');
      if (child.ctx !== childCtx || service<{ get(id: string): Agent | undefined }>(access, 'agents')?.get(child.id) !== undefined) {
        throw new Error('agent-team-model-pin: preset setup requires the exact unpublished child; live preset switching is forbidden');
      }
    };
    assertInitializing();
    const recorded = ownSelection(child);
    let selected: string | undefined;
    let presets: Presets | undefined;

    if (source === 'resume') {
      // Never consult current Team policy, even for pre-feature teammates.
      selected = recorded ?? child.session.header.agentPreset;
      if (selected === undefined) return;
      selected = presetId(selected, 'persisted');
      presets = requirePresets(access);
      if (presets.composedPreset(childCtx) !== selected) await presets.mount(childCtx, selected);
    } else if (source === 'startup') {
      // Capture synchronously before the first await: concurrent menu changes
      // affect future creations, not this one in-flight child.
      const requested = capture(parent.id);
      if (requested === null || requested === undefined) {
        const available = service<Partial<Presets>>(access, 'agentPresets');
        if (typeof available?.composedPreset !== 'function') return;
        selected = available.composedPreset(childCtx);
        if (selected === undefined) return; // preset-free baseline composition
        presets = requirePresets(access);
        // Keep the exact inherited revision; do not remount to a newer revision.
      } else {
        selected = presetId(requested, 'configured');
        presets = requirePresets(access);
        await presets.mount(childCtx, selected);
      }
      if (recorded !== undefined && recorded !== selected) {
        throw new Error('agent-team-model-pin: another initializer selected a conflicting child Agent preset');
      }
    } else {
      throw new Error('agent-team-model-pin: unknown child preset initialization source');
    }

    assertInitializing();
    const identity = presetId(selected, 'resolved');
    const boundPresets = presets!;
    return { commit() {
      assertInitializing();
      if (boundPresets.composedPreset(childCtx) !== identity) {
        throw new Error('agent-team-model-pin: child preset changed before publication; refusing mismatched initialization');
      }
      // Append during setup's commit, before persistence/publication. Even
      // 'follow Lead' records a concrete identity so later parent changes cannot
      // change this teammate. Resumes must never add a new selection event.
      if (source === 'startup' && recorded === undefined) {
        child.session.append('agent-preset/selected', { agentPreset: identity });
      }
    } };
  });
  host.effect(() => () => { active = false; stop(); });
}
