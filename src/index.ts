/**
 * Agent Team 模型钉插件（Host 半边）。
 *
 * 目标：把 Agent Team 队友实际发出的模型请求钉到指定 `provider / model / reasoningEffort`，
 * 按 session 选择，在下一次提示词组装时生效；本步重试复用已组装快照。
 *
 * 契约源：`docs/SPEC.md`（v1）。本文件只做装配：三层解析、命令解析、route 校验等纯逻辑
 * 全部来自 `./pin.ts`，此处不重复实现。
 *
 * 仅使用可擦除 TypeScript 语法；相对导入带 `.ts`。官方
 * @deepseek-ai/dsh-agent 选择器由宿主 runtime resolver 提供，不能另装核心运行时。
 *
 * @module @lolkda/dsh-agent-team-model-pin
 */
import z from '@deepseek-ai/schemastery';
import { appendFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  applyTeamPin,
  assertRouteSelectable,
  describePin,
  mutationFor,
  normalizePin,
  parseCommandInput,
  resolvePin,
} from './pin.ts';
import type { CommandPlan, LlmLike, Pin, Scope } from './pin.ts';
import type { Context } from '@deepseek-ai/cordis';
import { installTeamModelSync } from './selection-sync.ts';

/** settings 命名空间（SPEC 5.4）。 */
const SETTINGS_NS = 'agent-team-model-pin';

/** 配置 scope 的合法取值（SPEC 4 · R1）。 */
const SCOPES: readonly Scope[] = ['teammates', 'members', 'all'];

/** 配置缺省 scope。 */
const DEFAULT_SCOPE: Scope = 'teammates';

const ENV = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;

/* ------------------------------------------------------------------ *
 * 结构类型：不引入 @deepseek-ai/* 的类型包，仅按实际用到的成员声明
 * ------------------------------------------------------------------ */

type Role = 'lead' | 'teammate';

/** Agent 的结构视图。 */
interface AgentLike {
  id: string;
  ctx?: Context;
  session?: { requestHeader(): { config: LlmCallConfigLike } | undefined };
  options?: Partial<LlmCallConfigLike>;
}

/** `ctx.agentTeams.tryMembership` 的返回值（SPEC 3）。 */
interface MembershipLike {
  root: AgentLike;
  id: string;
  role: Role;
  name: string;
}

/** `agent/request` 瀑布的调用配置（SPEC 3）。 */
interface LlmCallConfigLike {
  provider: string;
  model: string;
  reasoningEffort?: string;
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
}

/** settings 段落内的 per-session 钉表。 */
type PinDict = Record<string, Pin>;

/** settings 段落值（SPEC 5.4）。 */
interface SettingsValue {
  sessions?: PinDict;
  /** Read-only composition metadata consumed from SettingsNamespaceView.base. */
  defaults?: Pin;
  configuredSessions?: PinDict;
  scope?: Scope;
}

/** `setSource` 收到的同步读取 thunk。 */
type SettingsSource = () => SettingsValue;

/** settings 段落 hooks（仅用到 setSource / onChange）。 */
interface SettingsHooks {
  setSource(current: SettingsSource): void;
  onChange(): void;
}

/** `ctx.settings` 用到的两个方法。 */
interface SettingsLike {
  installSection(
    owner: PluginCtx,
    ns: string,
    schema: unknown,
    entry: SettingsValue,
    hooks: SettingsHooks,
  ): void;
  mutate(ns: string, ops: readonly unknown[]): Promise<void>;
}

/** 命令结果（SPEC 3）。 */
type CommandResultLike = { kind: 'success'; text?: string } | { kind: 'error'; text: string };

/** 命令调用入参。 */
interface CommandInvocationLike {
  agent: AgentLike;
  rawInput: string;
  signal: AbortSignal;
}

/** 命令定义。 */
interface CommandDefinitionLike {
  name: string;
  description: string;
  input?: { hint: string };
  handler: (invocation: CommandInvocationLike) => CommandResultLike | Promise<CommandResultLike>;
}

/** 瀑布监听器。 */
type RequestListener = (
  payload: { agent: AgentLike; turn: number; step: number; signal: AbortSignal },
  next: () => Promise<LlmCallConfigLike>,
) => Promise<LlmCallConfigLike>;

/** 插件上下文（只声明本插件用到的成员）。 */
interface PluginCtx {
  logger: { warn(format: unknown, ...params: unknown[]): void };
  agentTeams: { tryMembership(agent: AgentLike): MembershipLike | undefined };
  commands: { register(definition: CommandDefinitionLike): () => void };
  inject(deps: string[], callback: (child: { settings: SettingsLike }) => void): unknown;
  get(name: string): unknown;
  on(event: string, listener: RequestListener): () => void;
  effect(callback: () => unknown): unknown;
}

/** 归一化后的插件配置（SPEC 5.3）。 */
interface NormalizedConfig {
  scope: Scope;
  defaults: Pin | undefined;
  sessions: PinDict;
  auditPath: string;
}

/** 审计行的一侧路由（SPEC 5.5）。 */
interface AuditRoute {
  provider: string;
  model: string;
  reasoningEffort?: string;
}

/** 审计行（SPEC 5.5）。 */
interface AuditRecord {
  at: string;
  sessionId: string;
  agentId: string;
  role?: Role;
  from: AuditRoute;
  to: AuditRoute;
}

/** settings 段落的 schema：`{ sessions: { "<sessionId>": { provider?, model?, reasoningEffort? } } }`。 */
const PIN_SCHEMA = z.object({
  provider: z.string(),
  model: z.string(),
  reasoningEffort: z.string(),
  followLeader: z.boolean(),
  modelDefault: z.boolean(),
});
const SETTINGS_SCHEMA = z.object({
  sessions: z.dict(PIN_SCHEMA),
  defaults: PIN_SCHEMA,
  configuredSessions: z.dict(PIN_SCHEMA),
  scope: z.string(),
});

/** 段落的 Composition 基准层（空 → 未设置任何运行期钉）。 */
const SETTINGS_ENTRY: SettingsValue = { sessions: {} };

/** 把任意异常压成一句可展示的文本。 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 默认审计路径：`$DSH_HOME/agent-team-model-pin/audit.jsonl`，DSH_HOME 缺省回退 `~/.dsh`。 */
function defaultAuditPath(): string {
  const home = ENV?.DSH_HOME?.trim();
  const root = home !== undefined && home.length > 0 ? home : join(homedir(), '.dsh');
  return join(root, 'agent-team-model-pin', 'audit.jsonl');
}

/** 只保留路由三字段（其余字段由 JSON.stringify 丢弃 undefined）。 */
function routeOf(config: { provider: string; model: string; reasoningEffort?: string }): AuditRoute {
  return {
    provider: config.provider,
    model: config.model,
    reasoningEffort: config.reasoningEffort,
  };
}

/**
 * 逐层构造宿主上下文无关的 `resolvePin` 入参。
 * @param scope 生效范围。
 * @param defaults Composition 默认层。
 * @param configSessions Composition per-session 层。
 * @param liveSessions 运行期层。
 * @param sessionId 作用键。
 * @param role 调用方团队角色。
 * @returns 三层解析结果。
 */
function resolveLayer(input: {
  scope: Scope;
  defaults: Pin | undefined;
  configSessions: PinDict;
  liveSessions: PinDict;
  sessionId: string;
  role?: Role;
}): Pin | undefined {
  return resolvePin({
    scope: input.scope,
    defaults: input.defaults,
    configSessions: input.configSessions,
    liveSessions: input.liveSessions,
    sessionId: input.sessionId,
    role: input.role,
  });
}

export const name = 'agent-team-model-pin';

export const inject = ['agentTeams', 'commands'];

/**
 * 安装插件：归一化配置、安装 settings 段落、注册 `/team-model` 命令、
 * 安装 Agent 作用域的官方选择器；仅无作用域旧驱动使用全局兼容监听，命中时追加审计。
 * @param ctx 插件上下文（`agentTeams` 与 `commands` 已注入）。
 * @param config 组合配置（任意形态；非法值只告警不抛）。
 */
export function apply(ctx: PluginCtx, config: unknown): void {
  const warned = new Set<string>();
  const warnOnce = (key: string, text: string): void => {
    if (warned.has(key)) return;
    warned.add(key);
    ctx.logger.warn(text);
  };

  /* ---------- 1. 配置归一化：非法值只告警一次，绝不抛 ---------- */

  const raw = config !== null && typeof config === 'object' ? (config as Record<string, unknown>) : {};

  let scope: Scope = DEFAULT_SCOPE;
  if (raw.scope !== undefined) {
    if (typeof raw.scope === 'string' && (SCOPES as readonly string[]).includes(raw.scope)) {
      scope = raw.scope as Scope;
    } else {
      warnOnce(
        'scope',
        `agent-team-model-pin: 配置 scope 非法（期望 ${SCOPES.join(' | ')}），已回退为 ${DEFAULT_SCOPE}`,
      );
    }
  }

  const safeNormalize = (value: unknown, key: string, label: string): Pin | undefined => {
    if (value === undefined || value === null) return undefined;
    try {
      const pin = normalizePin(value);
      if (pin === undefined) return undefined;
      if (typeof pin !== 'object') {
        warnOnce(key, `agent-team-model-pin: 配置 ${label} 非法（期望对象），该层按空处理`);
        return undefined;
      }
      return pin;
    } catch (error) {
      warnOnce(key, `agent-team-model-pin: 配置 ${label} 非法（${errorText(error)}），该层按空处理`);
      return undefined;
    }
  };

  const defaults = safeNormalize(raw.defaults, 'defaults', 'defaults');

  const sessions: PinDict = {};
  if (raw.sessions !== undefined && raw.sessions !== null) {
    if (typeof raw.sessions !== 'object' || Array.isArray(raw.sessions)) {
      warnOnce('sessions', 'agent-team-model-pin: 配置 sessions 非法（期望以 sessionId 为键的对象），该层按空处理');
    } else {
      for (const [sessionId, value] of Object.entries(raw.sessions as Record<string, unknown>)) {
        if (sessionId.trim().length === 0) {
          warnOnce('sessions-key', 'agent-team-model-pin: 配置 sessions 存在空 sessionId，已忽略该条');
          continue;
        }
        const pin = safeNormalize(value, 'sessions-value', `sessions["${sessionId}"]`);
        if (pin !== undefined) sessions[sessionId] = pin;
      }
    }
  }

  let auditPath = defaultAuditPath();
  if (raw.auditPath !== undefined && raw.auditPath !== null) {
    if (typeof raw.auditPath === 'string') {
      const trimmed = raw.auditPath.trim();
      if (trimmed.length > 0) auditPath = trimmed;
    } else {
      warnOnce('auditPath', `agent-team-model-pin: 配置 auditPath 非法（期望字符串），已回退为 ${defaultAuditPath()}`);
    }
  }

  /* ---------- 2. settings 段落：setSource 保存同步可读 thunk ---------- */

  let liveSource: SettingsSource = () => SETTINGS_ENTRY;

  ctx.inject(['settings'], (settingsCtx) => {
    try {
      settingsCtx.settings.installSection(ctx, SETTINGS_NS, SETTINGS_SCHEMA, {
        ...SETTINGS_ENTRY, defaults: defaults ?? {}, configuredSessions: sessions, scope,
      }, {
        setSource: (current: SettingsSource) => {
          liveSource = current;
        },
        onChange: () => {
          /* 每次请求都重新调用 thunk 读取，无需在此缓存 */
        },
      });
    } catch (error) {
      warnOnce(
        'settings-install',
        `agent-team-model-pin: settings 段落安装失败，运行期层不可用（Composition 层仍生效）：${errorText(error)}`,
      );
    }
  });

  /** 同步读取运行期层；任何异常都退化为「无该层」，绝不打断请求。 */
  const readLiveSessions = (): PinDict => {
    try {
      const value = liveSource();
      const live = value !== null && typeof value === 'object' ? value.sessions : undefined;
      if (live === undefined || live === null || typeof live !== 'object' || Array.isArray(live)) return {};
      return live as PinDict;
    } catch (error) {
      warnOnce('settings-read', `agent-team-model-pin: 读取运行期 settings 失败，本层按空处理：${errorText(error)}`);
      return {};
    }
  };

  const settingsService = (): SettingsLike | undefined => {
    const found = ctx.get('settings');
    return found !== null && typeof found === 'object' ? (found as SettingsLike) : undefined;
  };

  const llmService = (): LlmLike | undefined => {
    const found = ctx.get('llm');
    return found !== null && typeof found === 'object' ? (found as unknown as LlmLike) : undefined;
  };

  /* ---------- 3. 三层解析（就近优先）与审计 ---------- */

  const effectivePin = (sessionId: string, role?: Role): Pin | undefined => {
    try {
      return resolveLayer({
        scope,
        defaults,
        configSessions: sessions,
        liveSessions: readLiveSessions(),
        sessionId,
        role,
      });
    } catch (error) {
      warnOnce('resolve', `agent-team-model-pin: 钉解析失败，本次不改写：${errorText(error)}`);
      return undefined;
    }
  };

  /**
   * 解析**该作用键上存在什么钉**，不按 role 过滤（`scope='all'`）。
   *
   * 命令文本回答的是「这个 session 上有没有钉」，而不是「敲命令的人自己被不被钉」：
   * 例如 scope=teammates 时 Lead 敲 `/team-model show|clear`，被描述的对象是本会话的队友。
   * @param sessionId 作用键。
   * @param includeLive 是否包含运行期层。
   * @returns 三层合并结果（role 无关）。
   */
  const sessionKeyPin = (sessionId: string, includeLive: boolean): Pin | undefined => {
    try {
      return resolveLayer({
        scope: 'all',
        defaults,
        configSessions: sessions,
        liveSessions: includeLive ? readLiveSessions() : {},
        sessionId,
      });
    } catch (error) {
      warnOnce('resolve-session-key', `agent-team-model-pin: 作用键解析失败：${errorText(error)}`);
      return undefined;
    }
  };

  let auditTail: Promise<void> = Promise.resolve();
  let auditDirReady = false;
  let auditWarned = false;

  /** 追加一行审计；失败只告警一次，绝不抛、绝不阻断请求。 */
  const audit = (record: AuditRecord): void => {
    auditTail = auditTail.then(async () => {
      try {
        if (!auditDirReady) {
          await mkdir(dirname(auditPath), { recursive: true });
          auditDirReady = true;
        }
        await appendFile(auditPath, `${JSON.stringify(record)}\n`, 'utf8');
      } catch (error) {
        if (!auditWarned) {
          auditWarned = true;
          warnOnce(
            'audit',
            `agent-team-model-pin: 审计写入失败（后续不再重复告警，模型请求不受影响）：${errorText(error)}`,
          );
        }
      }
    });
  };

  /* ---------- 4. 命令 /team-model ---------- */

  const describeLayers = (sessionId: string, role?: Role): string => {
    const live = readLiveSessions()[sessionId];
    return [
      `作用键（Lead 会话 id）：${sessionId}${role === undefined ? '' : `（调用方 role=${role}）`}`,
      `scope：${scope}`,
      `该作用键上的钉（不按 role 过滤）= ${describePin(sessionKeyPin(sessionId, true))}`,
      `调用方自身生效钉= ${describePin(effectivePin(sessionId, role))}`,
      `运行期层（settings）= ${describePin(live)}`,
      `Composition 层 sessions= ${describePin(sessions[sessionId])}`,
      `Composition 层 defaults=${describePin(defaults)}`,
      '解析顺序（就近优先）：运行期 > Composition.sessions > Composition.defaults，且为字段级合并。',
    ].join('\n');
  };

  ctx.effect(() =>
    ctx.commands.register({
      name: 'team-model',
      description: '查看 / 设置 / 清除本会话团队队友的模型钉（provider / model / reasoningEffort）',
      input: { hint: '<provider> <model> [effort] | show | clear' },
      handler: async ({ agent, rawInput }): Promise<CommandResultLike> => {
        let plan: CommandPlan;
        try {
          plan = parseCommandInput(typeof rawInput === 'string' ? rawInput : '');
        } catch (error) {
          return { kind: 'error', text: `命令解析失败：${errorText(error)}` };
        }
        if (plan.action === 'invalid') return { kind: 'error', text: plan.error };

        let membership: MembershipLike | undefined;
        try {
          membership = ctx.agentTeams.tryMembership(agent);
        } catch (error) {
          warnOnce('command-membership', `agent-team-model-pin: 团队成员判定失败，按非成员处理：${errorText(error)}`);
        }
        const sessionId = membership?.root?.id ?? agent.id;
        const role = membership?.role;

        if (plan.action === 'show') {
          const settings = settingsService();
          const sessionPin = sessionKeyPin(sessionId, true);
          if (settings === undefined) {
            return {
              kind: 'error',
              text: [
                'settings 服务不可用：无法读取运行期层，因而无法给出完整的有效钉。',
                `Composition 层解析结果（不按 role 过滤）：${describePin(sessionKeyPin(sessionId, false))}`,
                describeLayers(sessionId, role),
              ].join('\n'),
            };
          }
          const effective = effectivePin(sessionId, role);
          const notes: string[] = [`当前会话生效钉：${describePin(effective)}`, describeLayers(sessionId, role)];
          if (scope === DEFAULT_SCOPE && role === 'lead') {
            notes.push(
              `注意：scope=${DEFAULT_SCOPE} 只对队友生效，Lead 自身不会被钉住；本会话的队友使用「该作用键上的钉」：${describePin(sessionPin)}`,
            );
          }
          if (effective === undefined && sessionPin !== undefined) {
            notes.push('说明：该作用键上存在钉，但调用方角色不在 scope 内，因此调用方自身不会被钉。');
          }
          return { kind: 'success', text: notes.join('\n') };
        }

        const settings = settingsService();
        if (settings === undefined) {
          return {
            kind: 'error',
            text: `settings 服务不可用：无法${plan.action === 'set' ? '写入' : '清除'}运行期钉（Composition 层不受影响，仍照常生效）。`,
          };
        }

        if (plan.action === 'set') {
          const llm = llmService();
          if (llm === undefined) {
            return { kind: 'error', text: 'llm 服务不可用：无法校验 provider / model，已放弃写入（零写入）。' };
          }
          const sessionPin = sessionKeyPin(sessionId, true);
          const fallback = { provider: sessionPin?.provider, model: sessionPin?.model };
          const pin: Pin = {
            provider: plan.provider,
            model: plan.model,
            ...(plan.reasoningEffort === undefined || plan.reasoningEffort.length === 0
              ? {}
              : { reasoningEffort: plan.reasoningEffort }),
          };
          try {
            await assertRouteSelectable(llm, pin, fallback);
          } catch (error) {
            return { kind: 'error', text: `校验失败，未写入任何状态：${errorText(error)}` };
          }
          try {
            await settings.mutate(SETTINGS_NS, [mutationFor(plan, sessionId)]);
          } catch (error) {
            return { kind: 'error', text: `写入运行期钉失败：${errorText(error)}` };
          }
          return {
            kind: 'success',
            text: [
              `已设置本会话（${sessionId}）运行期钉：${describePin(pin)}`,
              `scope=${scope}${scope === DEFAULT_SCOPE && role === 'lead' ? '（只作用于队友，Lead 自身不受影响）' : ''}`,
              '下一次提示词组装时生效；本步重试沿用同一选择，已存在的队友无需重建。',
            ].join('\n'),
          };
        }

        try {
          await settings.mutate(SETTINGS_NS, [mutationFor(plan, sessionId)]);
        } catch (error) {
          return { kind: 'error', text: `清除运行期钉失败：${errorText(error)}` };
        }
        const composition = sessionKeyPin(sessionId, false);
        return {
          kind: 'success',
          text:
            composition === undefined
              ? `已清除本会话（${sessionId}）的运行期钉；当前无生效钉。`
              : `已清除本会话（${sessionId}）的运行期钉；但该作用键仍被组合配置钉住：${describePin(composition)}（来自 Composition 层，需改组合配置才能解除）。`,
        };
      },
    }),
  );

  /* ---------- 5. Scoped prompt/request selection and legacy compatibility ---------- */

  const synchronized = installTeamModelSync(ctx as unknown as Context, (agent) => {
    try {
      const membership = ctx.agentTeams.tryMembership(agent);
      const sessionId = membership?.root.id ?? agent.id;
      const pin = effectivePin(sessionId, membership?.role);
      if (pin === undefined && membership?.role !== 'teammate') return undefined;
      const root = membership?.role === 'teammate' ? membership.root : undefined;
      const leader = root?.session?.requestHeader()?.config ?? root?.options;
      return {
        sessionId,
        ...(membership?.role === undefined ? {} : { role: membership.role }),
        ...(pin === undefined ? {} : { pin: { ...pin } }),
        ...(leader === undefined ? {} : { leader: { ...leader } }),
      };
    } catch (error) {
      warnOnce('request', 'agent-team-model-pin: 团队成员判定失败，本次不改写：' + errorText(error));
      return undefined;
    }
  }, ({ agent, policy, from, to }) => {
    audit({ at: new Date().toISOString(), sessionId: policy.sessionId, agentId: agent.id,
      role: policy.role, from: routeOf(from), to: routeOf(to) });
  });

  ctx.on('agent/request', async ({ agent }, next) => {
    if (synchronized.has(agent)) return next();
    // Older/nonstandard drivers without an Agent-scoped Context keep their
    // request-only contract; the standard Loop is owned by the selector above.
    const config = await next();
    let membership: MembershipLike | undefined;
    let sessionId = agent.id;
    let pin: Pin | undefined;
    try {
      membership = ctx.agentTeams.tryMembership(agent);
      sessionId = membership?.root?.id ?? agent.id;
      pin = effectivePin(sessionId, membership?.role);
    } catch (error) {
      warnOnce('request', `agent-team-model-pin: 团队成员判定失败，本次不改写：${errorText(error)}`);
      return config;
    }
    if (pin === undefined && membership?.role !== 'teammate') return config;
    let pinned: LlmCallConfigLike;
    try {
      const root = membership?.role === 'teammate' ? membership.root : undefined;
      const leader = root?.session?.requestHeader()?.config ?? root?.options;
      pinned = applyTeamPin(config, pin, leader);
      if (pin === undefined && pinned === config) return config;
    } catch (error) {
      warnOnce('apply', `agent-team-model-pin: 钉应用失败，本次不改写：${errorText(error)}`);
      return config;
    }
    audit({
      at: new Date().toISOString(),
      sessionId,
      agentId: agent.id,
      role: membership?.role,
      from: routeOf(config),
      to: routeOf(pinned),
    });
    return pinned;
  });
}