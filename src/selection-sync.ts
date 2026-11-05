import type { Context } from '@deepseek-ai/cordis';
import { installModelSelection } from '@deepseek-ai/dsh-agent';
import { applyTeamPin } from './pin.ts';
import type { Pin } from './pin.ts';

/**
 * The route shape this plugin reads from an Agent and hands to `agent.model`.
 *
 * DSH 0.2.2 replaced the mutable `ModelSelectionRef` argument of
 * `installModelSelection()` with the Agent-owned `Model` API:
 *
 * - `agent.model.current()` returns the pending choice, then the latest
 *   request's choice, then the Agent's live options;
 * - `agent.model.select(route)` records the complete selection for the next
 *   step whose preparation has not begun.
 *
 * The plugin must therefore choose a route *before* the Loop captures its
 * step selection. `agent/inbox/claimed` is emitted synchronously by the
 * standard Loop before `model.current()`, and `agent/status = running` is
 * emitted before the first turn starts. Both are safe places to call
 * `select()`. The deprecated `agent/request` waterfall must not change the
 * provider/model/effort anymore: DSH 0.2.2 rejects a replacement that differs
 * from the selection fixed at step preparation.
 */
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
  model?: {
    current(): Readonly<SyncRoute> | undefined;
    select(selection: Readonly<SyncRoute>): void;
  };
}

export interface SyncPolicy {
  sessionId: string;
  role?: 'lead' | 'teammate';
  pin?: Pin;
  leader?: Pin;
}

export interface SyncAudit {
  agent: SyncAgent;
  policy: SyncPolicy;
  from: SyncRoute;
  to: SyncRoute;
}

interface Binding {
  dispose(): void;
}

type Logger = { warn(format: unknown, ...params: unknown[]): void };

function routeOf(route: Partial<SyncRoute> | undefined): SyncRoute | undefined {
  if (!route || typeof route.provider !== 'string' || typeof route.model !== 'string'
    || route.provider.length === 0 || route.model.length === 0) return undefined;
  return {
    provider: route.provider,
    model: route.model,
    ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort }),
  };
}

function sameRoute(left: SyncRoute | undefined, right: SyncRoute): boolean {
  return left !== undefined && left.provider === right.provider && left.model === right.model
    && left.reasoningEffort === right.reasoningEffort;
}

/**
 * Install the Team model policy on every live and future Agent.
 *
 * The policy is captured live on each step boundary instead of being frozen
 * with an AsyncLocalStorage frame. That matches DSH 0.2.2's durable
 * `model/selection` projection: the next step reads the recorded choice, and a
 * setting change while an Agent is idle is visible on its next step without a
 * remount. Retries reuse the step's captured selection by design; the Loop
 * keeps `modelSelection` fixed across retries.
 *
 * @param host Profile-level Cordis context.
 * @param capture Per-Agent policy resolver (membership, pin, Lead route).
 * @param audit Audit recorder for actual route rewrites.
 * @returns Live membership test and an explicit refresh after a settings write.
 */
export function installTeamModelSync(
  host: Context,
  capture: (agent: SyncAgent) => SyncPolicy | undefined,
  audit: (record: SyncAudit) => void,
): { has(agent: SyncAgent): boolean; refresh(): void } {
  const bindings = new Map<SyncAgent, Binding>();
  const logger = (host as unknown as { logger?: Logger }).logger;
  const warned = new Set<string>();
  const warnOnce = (key: string, message: string): void => {
    if (warned.has(key)) return;
    warned.add(key);
    logger?.warn(message);
  };
  let disposed = false;

  const apply = (agent: SyncAgent): void => {
    if (disposed || !agent.model || typeof agent.model.select !== 'function') return;
    let policy: SyncPolicy | undefined;
    try {
      policy = capture(agent);
    } catch (error) {
      warnOnce('capture', `agent-team-model-pin: 团队成员判定失败，本次不改写：${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (!policy) return;
    if (policy.pin === undefined && policy.role !== 'teammate') return;
    const current = routeOf(agent.model.current?.());
    const fallback = routeOf(agent.options);
    const base = current ?? fallback;
    if (base === undefined) {
      warnOnce('route', 'agent-team-model-pin: Agent 尚无完整 provider/model，无法写入 Team 模型选择');
      return;
    }
    let desired: SyncRoute;
    try {
      desired = routeOf(applyTeamPin(base, policy.pin, policy.leader)) as SyncRoute;
    } catch (error) {
      warnOnce('apply', `agent-team-model-pin: 钉应用失败，本次不改写：${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (!desired) return;
    try {
      agent.model.select(desired);
    } catch (error) {
      warnOnce('select', `agent-team-model-pin: 写入模型选择失败，本次不改写：${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (!sameRoute(base, desired)) {
      audit({ agent, policy, from: base, to: desired });
    }
  };

  const attach = (agent: SyncAgent): void => {
    if (disposed || !agent.ctx || !agent.model || bindings.has(agent)) return;
    const applyNow = (): void => apply(agent);
    const stopStatus = agent.ctx.on('agent/status', (payload: { status?: string }) => {
      if (payload?.status === 'running') applyNow();
    }, { prepend: true });
    const stopClaim = agent.ctx.on('agent/inbox/claimed', () => { applyNow(); }, { prepend: true });
    let stopNotice: (() => void) | undefined;
    try {
      // Team children are created by the subagent manager, not by the Web
      // session controller, so they do not get the native model-switch notice
      // owner automatically. Install the official notice listener for Team
      // teammates only; ordinary sessions already have one.
      if (capture(agent)?.role === 'teammate') stopNotice = installModelSelection(agent.ctx);
    } catch {
      // Membership is optional at agent/created; a later status/claim pass
      // still applies the policy even if this early notice check cannot resolve.
    }
    bindings.set(agent, {
      dispose() {
        stopStatus();
        stopClaim();
        stopNotice?.();
      },
    });
  };

  host.on('agent/created', ({ agent }) => { attach(agent as SyncAgent); });
  host.on('agent/disposed', ({ agent }) => {
    const binding = bindings.get(agent as SyncAgent);
    if (binding === undefined) return;
    binding.dispose();
    bindings.delete(agent as SyncAgent);
  });
  const registry = host.get('agents') as { list(): SyncAgent[] } | undefined;
  if (registry) for (const agent of registry.list()) attach(agent);

  host.effect(() => () => {
    disposed = true;
    for (const binding of bindings.values()) binding.dispose();
    bindings.clear();
  });

  return {
    has: agent => bindings.has(agent),
    refresh: () => { for (const agent of bindings.keys()) apply(agent); },
  };
}
