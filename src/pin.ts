// Pure logic for the agent-team model pin plugin (SPEC v1, section 5.1).
// Zero imports, no filesystem, no network, erasable TypeScript syntax only.

export type Scope = 'teammates' | 'members' | 'all';
export type Pin = { provider?: string; model?: string; reasoningEffort?: string };

/** Trim a raw field; blank / non-string values count as "not set". */
function asField(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** 去空白、丢弃空串；全空则返回 undefined。 */
export function normalizePin(raw: unknown): Pin | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const src = raw as Record<string, unknown>;
  const provider = asField(src.provider);
  const model = asField(src.model);
  const reasoningEffort = asField(src.reasoningEffort);
  if (provider === undefined && model === undefined && reasoningEffort === undefined) {
    return undefined;
  }
  const out: Pin = {};
  if (provider !== undefined) out.provider = provider;
  if (model !== undefined) out.model = model;
  if (reasoningEffort !== undefined) out.reasoningEffort = reasoningEffort;
  return out;
}

/** Read one session-keyed layer; a missing key or an unpinnable layer yields undefined. */
function layerFor(layers: unknown, sessionId: string): Pin | undefined {
  if (layers === null || typeof layers !== 'object') return undefined;
  const entry = (layers as Record<string, unknown>)[sessionId];
  return normalizePin(entry);
}

function mergePin(lower: Pin | undefined, upper: Pin | undefined): Pin | undefined {
  if (upper === undefined) return lower;
  if (lower === undefined) return upper;
  const merged: Pin = {
    provider: upper.provider !== undefined ? upper.provider : lower.provider,
    model: upper.model !== undefined ? upper.model : lower.model,
    reasoningEffort:
      upper.reasoningEffort !== undefined ? upper.reasoningEffort : lower.reasoningEffort,
  };
  return normalizePin(merged);
}

function inScope(scope: Scope, role: 'lead' | 'teammate' | undefined): boolean {
  if (scope === 'teammates') return role === 'teammate';
  if (scope === 'members') return role === 'lead' || role === 'teammate';
  if (scope === 'all') return true;
  return false;
}

export function resolvePin(input: {
  scope: Scope;
  defaults?: Pin;
  configSessions?: Record<string, Pin>;
  liveSessions?: Record<string, Pin>;
  sessionId: string;
  role?: 'lead' | 'teammate';
}): Pin | undefined {
  if (!inScope(input.scope, input.role)) return undefined;
  const sessionId = input.sessionId;
  // 就近优先：运行期层 > Composition 会话层 > Composition 默认层。
  const defaults = normalizePin(input.defaults);
  const configLayer = layerFor(input.configSessions, sessionId);
  const liveLayer = layerFor(input.liveSessions, sessionId);
  return mergePin(mergePin(defaults, configLayer), liveLayer);
}

/** 按 R4 把 pin 合并进调用配置；不得改动 pin 未涉及的字段。 */
export function applyPin<T extends { provider: string; model: string; reasoningEffort?: string }>(
  config: T,
  pin: Pin,
): T {
  const normalized = normalizePin(pin);
  const next = { ...config } as T;
  if (normalized === undefined) return next;
  const routeChanged = normalized.provider !== undefined || normalized.model !== undefined;
  if (normalized.provider !== undefined) next.provider = normalized.provider;
  if (normalized.model !== undefined) next.model = normalized.model;
  if (normalized.reasoningEffort !== undefined) {
    next.reasoningEffort = normalized.reasoningEffort;
  } else if (routeChanged) {
    delete next.reasoningEffort;
  }
  return next;
}

export type CommandPlan =
  | { action: 'show' }
  | { action: 'clear' }
  | { action: 'set'; provider: string; model: string; reasoningEffort?: string }
  | { action: 'invalid'; error: string };

const USAGE = '用法：/team-model <provider> <model> [effort] | /team-model show | /team-model clear';

export function parseCommandInput(rawInput: string): CommandPlan {
  const text = typeof rawInput === 'string' ? rawInput.trim() : '';
  const tokens = text === '' ? [] : text.split(/\s+/);
  if (tokens.length === 0) return { action: 'show' };
  if (tokens.length === 1) {
    const head = tokens[0].toLowerCase();
    if (head === 'show') return { action: 'show' };
    if (head === 'clear') return { action: 'clear' };
    return { action: 'invalid', error: USAGE };
  }
  if (tokens.length === 2) {
    return { action: 'set', provider: tokens[0], model: tokens[1] };
  }
  if (tokens.length === 3) {
    return { action: 'set', provider: tokens[0], model: tokens[1], reasoningEffort: tokens[2] };
  }
  return { action: 'invalid', error: USAGE };
}

export type PinMutation =
  | { op: 'set'; path: string[]; value: Pin }
  | { op: 'unset'; path: string[] };

/** set → path ['sessions', sessionId]；clear → unset 同一路径。
 *  参数必须是**可判别联合**（v1.2 修正）：写成 `{ action: 'set' | 'clear' }` 会丢失判别字段，
 *  使 `plan.provider` 不可达，tsc 报 TS2339。 */
export function mutationFor(
  plan:
    | { action: 'set'; provider: string; model: string; reasoningEffort?: string }
    | { action: 'clear' },
  sessionId: string,
): PinMutation {
  const path = ['sessions', sessionId];
  if (plan.action === 'clear') return { op: 'unset', path };
  const value: Pin = { provider: plan.provider, model: plan.model };
  if (plan.reasoningEffort !== undefined) value.reasoningEffort = plan.reasoningEffort;
  return { op: 'set', path, value };
}

/** 人类可读描述；无钉时返回明确的"未设置"文本。 */
export function describePin(pin: Pin | undefined): string {
  const normalized = normalizePin(pin);
  if (normalized === undefined) return '当前会话未设置模型钉（沿用继承路由）';
  const parts: string[] = [];
  if (normalized.provider !== undefined) parts.push(`provider=${normalized.provider}`);
  if (normalized.model !== undefined) parts.push(`model=${normalized.model}`);
  if (normalized.reasoningEffort !== undefined) {
    parts.push(`reasoningEffort=${normalized.reasoningEffort}`);
  }
  return `当前会话模型钉：${parts.join(', ')}`;
}

export interface LlmLike {
  listProviders(): { id: string }[];
  resolveModelInfo(provider: string, model: string): Promise<{
    reasoning?: { efforts: readonly { id: string }[] };
  }>;
}

/**
 * 设置时校验（R6 的"零写入"前提）。
 * 抛出的 Error.message 必须是可直接展示给用户的一句话。
 */
export async function assertRouteSelectable(
  llm: LlmLike,
  pin: Pin,
  fallback: { provider?: string; model?: string },
): Promise<void> {
  const normalized = normalizePin(pin);
  if (normalized === undefined) return;

  const rawProviders = llm.listProviders();
  const providerIds: string[] = [];
  if (Array.isArray(rawProviders)) {
    for (const entry of rawProviders) {
      const id = asField(entry && (entry as { id?: unknown }).id);
      if (id !== undefined) providerIds.push(id);
    }
  }

  if (normalized.provider !== undefined && !providerIds.includes(normalized.provider)) {
    const known = providerIds.length > 0 ? providerIds.join(', ') : '（无）';
    throw new Error(`provider 未注册：${normalized.provider}（可用 provider：${known}）`);
  }

  const provider = normalized.provider !== undefined ? normalized.provider : asField(fallback && fallback.provider);
  const model = normalized.model !== undefined ? normalized.model : asField(fallback && fallback.model);

  // 只给 provider（且不需要校验 effort）时，注册检查即为全部校验。
  const needsModel = normalized.model !== undefined || normalized.reasoningEffort !== undefined;
  if (!needsModel) return;

  if (provider === undefined) {
    throw new Error('无法校验模型：请同时给出 provider，或在配置中设置默认 provider');
  }
  if (model === undefined) {
    throw new Error('无法校验模型：请同时给出 model，或在配置中设置默认 model');
  }
  const label = `${provider}/${model}`;

  let info: { reasoning?: { efforts: readonly { id: string }[] } } | undefined | null;
  try {
    info = await llm.resolveModelInfo(provider, model);
  } catch (err) {
    const detail = err instanceof Error && err.message ? `：${err.message}` : '';
    throw new Error(`模型不存在或不可解析：${label}${detail}`);
  }
  if (info === null || info === undefined) {
    throw new Error(`模型不存在或不可解析：${label}`);
  }

  if (normalized.reasoningEffort === undefined) return;
  const efforts = info.reasoning && Array.isArray(info.reasoning.efforts) ? info.reasoning.efforts : [];
  const ids: string[] = [];
  for (const effort of efforts) {
    const id = asField(effort && effort.id);
    if (id !== undefined) ids.push(id);
  }
  if (ids.length === 0) {
    throw new Error(`模型 ${label} 未公布 reasoning effort，无法设置 reasoningEffort=${normalized.reasoningEffort}`);
  }
  if (!ids.includes(normalized.reasoningEffort)) {
    throw new Error(
      `模型 ${label} 不支持 reasoningEffort=${normalized.reasoningEffort}（可选：${ids.join(', ')}）`,
    );
  }
}