import { AsyncLocalStorage } from 'node:async_hooks';
import { installModelSelection } from '@deepseek-ai/dsh-agent';
import type { ModelSelection, ModelSelectionRef, PreStepDecision } from '@deepseek-ai/dsh-agent';
import type { Context } from '@deepseek-ai/cordis';
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm';
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt';
import { applyTeamPin } from './pin.ts';
import type { Pin } from './pin.ts';

export interface SyncRoute {
  provider: string;
  model: string;
  reasoningEffort?: string;
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
}
export interface SyncAgent {
  id: string;
  ctx?: Context;
  options?: Partial<SyncRoute>;
  session?: { requestHeader(): { config: SyncRoute; adapterDefaults?: { reasoningEffort?: true } } | undefined };
}
export interface SyncPolicy {
  sessionId: string;
  role?: 'lead' | 'teammate';
  pin?: Pin;
  leader?: Pin;
}
export interface SyncAudit { agent: SyncAgent; policy: SyncPolicy; from: SyncRoute; to: SyncRoute }
interface Frame {
  policy: SyncPolicy | undefined;
  selected: ModelSelection | undefined;
  assembled: ModelSelection | undefined;
}
interface Admission { turn: number; step: number; frame: Frame }
type Listener = (...args: unknown[]) => unknown;

function effective(policy: SyncPolicy | undefined): policy is SyncPolicy {
  if (!policy) return false;
  const pin = policy.pin;
  return pin?.provider !== undefined || pin?.model !== undefined || pin?.reasoningEffort !== undefined || pin?.modelDefault === true
    || ((!pin || pin.followLeader === true) && !!policy.leader?.provider && !!policy.leader.model);
}
function selectionOf(route: SyncRoute): ModelSelection {
  if (!route.provider || !route.model) throw new Error('agent-team-model-pin: 无法在组装时确定完整模型选择');
  return Object.freeze({ provider: route.provider, model: route.model,
    ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort as NonNullable<ModelSelection['reasoningEffort']> }) });
}
/**
 * Whether one message is the official durable model-switch notice.
 *
 * `installModelSelection` tags its notice through the `MessageSourceMap`
 * declaration of `@deepseek-ai/dsh-agent`: DSH 0.1.7-rc.1 uses the standalone
 * `'model-selection'` kind, while 0.1.6-alpha.2 nested it as
 * `kind: 'plugin', plugin: 'model-selection'`. Both are recognized so the
 * superseded-notice filter survives the source-shape change.
 */
function isModelNotice(source: unknown): boolean {
  if (!source || typeof source !== 'object') return false;
  const value = source as Record<string, unknown>;
  if (value.form !== 'notice') return false;
  return value.kind === 'model-selection'
    || (value.kind === 'plugin' && value.plugin === 'model-selection');
}

/**
 * Use the public selector, adapting only its event boundary and selection source.
 * Frames are assembly-local; admitted requests refer to their exact turn/step.
 * Preview calls cannot overwrite a running step's selection or audit policy.
 */
export function installTeamModelSync(
  host: Context,
  capture: (agent: SyncAgent) => SyncPolicy | undefined,
  audit: (record: SyncAudit) => void,
): { has(agent: SyncAgent): boolean } {
  const bindings = new Map<SyncAgent, { dispose(): void; headerObserved: boolean }>();
  const attach = (agent: SyncAgent, created = false): void => {
    if (!agent.ctx || bindings.has(agent)) return;
    const scoped = agent.ctx;
    const frames = new AsyncLocalStorage<Frame>();
    const pending = new WeakMap<AbortSignal, Frame>();
    const admitted = new WeakMap<AbortSignal, Admission>();
    const state = { dispose: () => {}, headerObserved: !created && agent.session?.requestHeader() !== undefined };
    let refreshNotice: (() => void) | undefined;
    let disposed = false;
    const ref: ModelSelectionRef = {
      get current() { return frames.getStore()?.selected; },
      get assembled() { return frames.getStore()?.assembled; },
      set assembled(value) {
        const frame = frames.getStore();
        if (!frame) throw new Error('agent-team-model-pin: selector outside its assembly/request frame');
        frame.assembled = value;
      },
    };
    const seed = (): SyncRoute => {
      const header = agent.session?.requestHeader();
      if (state.headerObserved && header) {
        const value = { ...header.config };
        if (header.adapterDefaults?.reasoningEffort === true) delete value.reasoningEffort;
        return value;
      }
      const options = agent.options;
      const sameRoute = header?.config.provider === options?.provider && header?.config.model === options?.model;
      const persistedEffort = sameRoute && header?.adapterDefaults?.reasoningEffort !== true ? header?.config.reasoningEffort : undefined;
      const effort = options?.reasoningEffort ?? persistedEffort;
      return { provider: options?.provider ?? '', model: options?.model ?? '', ...(effort === undefined ? {} : { reasoningEffort: effort }) };
    };
    const selectorContext = new Proxy(scoped, {
      get(target, key) {
        if (key !== 'on') return Reflect.get(target, key, target);
        return (event: string, listener: Listener, options?: { prepend?: boolean }) => {
          if (event === 'system-prompt/assemble') {
            return target.on(event, async (assembly, context, next) => {
              const policy = capture(agent);
              const frame: Frame = { policy, selected: undefined, assembled: undefined };
              const base = seed();
              const active = effective(policy);
              if (active) {
                // Supply the Loop's proposal as the baseline BEFORE ordinary
                // selectors. Their pending selection can still replace it.
                const provisional = applyTeamPin(base, policy.pin, policy.leader);
                assembly.variables = { ...assembly.variables,
                  provider: base.provider || provisional.provider,
                  model: base.model || provisional.model };
              }
              const assembled = await next();
              if (disposed) throw new Error('agent-team-model-pin: selection owner disposed during assembly');
              if (active) {
                const selectedBase = { ...base,
                  provider: assembled.variables.provider ?? base.provider,
                  model: assembled.variables.model ?? base.model };
                frame.selected = selectionOf(applyTeamPin(selectedBase, policy.pin, policy.leader));
              }
              // Let the official implementation interpolate the resolved pair
              // and capture it; do not recreate its request/notice algorithms.
              const out = await frames.run(frame, () => listener(assembled, context, () => Promise.resolve(assembled))) as PromptAssembly;
              if (context.signal) {
                pending.set(context.signal, frame);
                // A native picker may have been installed since our binding.
                // Put the final-notice filter outside all current selectors.
                refreshNotice?.();
              }
              return out;
            }, { ...options, prepend: true });
          }
          if (event === 'agent/pre-step') {
            const register = () => target.on(event, async (payload, next) => {
              const frame = pending.get(payload.signal);
              if (frame) admitted.set(payload.signal, { turn: payload.turn, step: payload.step, frame });
              let decision = await next();
              if (!frame) return decision;
              if (frame.selected && decision.kind === 'enter') {
                // Only discard newly produced native model notices superseded
                // by Team policy. Preserve the original input and all history.
                const originals = new Set(payload.messages.map((message) => message.id));
                decision = { ...decision, messages: decision.messages.filter((message) => originals.has(message.id) || !isModelNotice(message.source)) };
              }
              const out = await frames.run(frame, () => listener(payload, () => Promise.resolve(decision))) as PreStepDecision;
              if (out.kind === 'reject') admitted.delete(payload.signal);
              return out;
            }, { ...options, prepend: true });
            let stop = register();
            refreshNotice = () => { stop(); stop = register(); };
            return () => { refreshNotice = undefined; stop(); };
          }
          if (event === 'agent/request') {
            return target.on(event, async (payload, next) => {
              const entry = admitted.get(payload.signal);
              if (!entry || entry.turn !== payload.turn || entry.step !== payload.step) {
                throw new Error('agent-team-model-pin: request has no admitted model-selection snapshot; 请重新组装提示词');
              }
              const frame = entry.frame;
              const from = await next();
              if (disposed) throw new Error('agent-team-model-pin: selection owner disposed during request');
              const to = await frames.run(frame, () => listener(payload, () => Promise.resolve(from))) as LlmCallConfig;
              if (frame.selected && frame.policy) {
                const expected = applyTeamPin(from, frame.policy.pin, frame.policy.leader);
                if (to.provider !== expected.provider || to.model !== expected.model || to.reasoningEffort !== expected.reasoningEffort) {
                  throw new Error('agent-team-model-pin: model selection conflict，组装后的模型路由发生变化；请让选路参与提示词组装');
                }
              }
              if (frame.policy && (frame.selected || frame.policy.pin)) audit({ agent, policy: frame.policy, from, to });
              return to;
            }, { ...options, prepend: true });
          }
          return Reflect.apply(target.on, target, [event, listener, options]);
        };
      },
    });
    const dispose = installModelSelection(selectorContext, ref);
    state.dispose = () => { disposed = true; dispose(); };
    bindings.set(agent, state);
  };
  host.on('agent/created', ({ agent }) => { attach(agent, true); });
  host.on('agent/disposed', ({ agent }) => {
    bindings.get(agent)?.dispose();
    bindings.delete(agent);
  });
  host.on('session/event', (session, event) => {
    if (event.type !== 'request/header') return;
    for (const [agent, state] of bindings) if (agent.session === session) state.headerObserved = true;
  });
  const registry = host.get('agents');
  if (registry) for (const agent of registry.list()) attach(agent);
  host.effect(() => () => {
    for (const state of bindings.values()) state.dispose();
    bindings.clear();
  });
  return { has: (agent) => bindings.has(agent) };
}
