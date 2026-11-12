/**
 * Team membership across DSH 0.2.1 and 0.2.2.
 *
 * DSH 0.2.2 turned Agent Teams into an ordinary subagent tree: `agentTeams`
 * no longer exposes the old roster membership API, while `subagents.rootOf()`
 * resolves the tree root and `agentTeams.isEnabled()` says whether that root
 * has Team mode enabled. Keep the legacy `tryMembership()` path for DSH
 * 0.2.1-compatible hosts and tests; never infer support from a version number.
 */

/** Minimal Agent shape needed to resolve membership. */
export interface TeamMemberAgent { id: string }

export interface TeamMembership<TAgent extends TeamMemberAgent = TeamMemberAgent> {
  readonly root: TAgent;
  readonly id: string;
  readonly role: 'lead' | 'teammate';
  readonly name: string;
  /** Present and false when the root is a Lead but Team mode is not enabled. */
  readonly teamEnabled?: boolean;
}

interface TeamServiceLike<TAgent extends TeamMemberAgent> {
  tryMembership?(agent: TAgent): TeamMembership<TAgent> | undefined;
  isEnabled?(root: TAgent): boolean;
}

interface SubagentServiceLike<TAgent extends TeamMemberAgent> {
  rootOf?(agent: TAgent): TAgent;
  namesOf?(agent: TAgent): { readonly name?: string } | undefined;
}

interface AgentLookup<TAgent extends TeamMemberAgent> {
  get(id: string): TAgent | undefined;
}

interface ServiceHost {
  get(name: string): unknown;
}

/** Read an injected service from the context, with a direct-property fallback for unit hosts. */
function service<T>(host: ServiceHost, name: string): T | undefined {
  // Cordis contexts expose services through get(); touching an undeclared
  // property directly is rejected by the context guard. Keep a direct-property
  // fallback only for small structural unit-test hosts.
  try {
    const injected = host.get(name);
    if (injected !== undefined) return injected as T;
  } catch {
    // Fall through to the direct-property compatibility path.
  }
  try {
    return (host as unknown as Record<string, unknown>)[name] as T | undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve one exact live Agent's Team membership.
 *
 * Legacy hosts provide `agentTeams.tryMembership()` (the DSH 0.2.1 contract).
 * DSH 0.2.2 provides `subagents.rootOf()` plus `agentTeams.isEnabled()`; a
 * disabled root is not treated as a Team, so ordinary subagents remain
 * unaffected by Team-only model/preset policy.
 *
 * @param host - plugin or command host carrying the two services.
 * @param agent - exact live agent to classify.
 * @returns membership, or undefined for a non-Team or unattached Agent.
 */
export function resolveTeamMembership<TAgent extends TeamMemberAgent>(
  host: ServiceHost,
  agent: TAgent,
): TeamMembership<TAgent> | undefined {
  // Remote RPC entry points pass a durable { id } reference, while DSH's
  // subagent tree APIs require the exact live Agent object. Resolve the live
  // identity before consulting either membership API.
  const agents = service<AgentLookup<TAgent>>(host, 'agents');
  let live = agent;
  try { live = agents?.get(agent.id) ?? agent; } catch { live = agent; }

  const teams = service<TeamServiceLike<TAgent>>(host, 'agentTeams');
  if (typeof teams?.tryMembership === 'function') {
    // Preserve the legacy service's failure semantics so callers can log or
    // reject instead of silently treating a broken roster as a non-member.
    return teams.tryMembership(live);
  }

  const subagents = service<SubagentServiceLike<TAgent>>(host, 'subagents');
  if (typeof teams?.isEnabled !== 'function' || typeof subagents?.rootOf !== 'function') return undefined;
  try {
    const root = subagents.rootOf(live);
    if (root === undefined || typeof root.id !== 'string') return undefined;
    const teamEnabled = teams.isEnabled(root);
    // DSH 0.2.1 returned Lead membership even before Team mode was enabled.
    // Preserve that for the root so /team-preset remains configurable for a
    // future Team, while ordinary subagents still fall outside Team scope.
    if (!teamEnabled && root.id !== live.id) return undefined;
    const name = subagents.namesOf?.(live)?.name;
    return {
      root,
      id: root.id,
      role: root.id === live.id ? 'lead' : 'teammate',
      name: typeof name === 'string' && name.length > 0 ? name : live.id,
      ...(teamEnabled ? {} : { teamEnabled: false }),
    };
  } catch {
    return undefined;
  }
}
