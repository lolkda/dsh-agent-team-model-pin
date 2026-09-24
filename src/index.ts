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
import type { Context, Volatile } from '@deepseek-ai/cordis';
import { installTeamModelSync } from './selection-sync.ts';

/**
 * settings 命名空间 = Loader 入口 id（SPEC 5.4 的 rc.1 形态）。
 * `cordis.patch.yml` 用的就是这个 id，也是 `entryId()` 在 fiber 不可用时的回退值。
 */
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

/** One redacted settings form descriptor as the rc.1 service describes it. */
interface SettingsDescriptorLike {
  ns: string;
  base?: unknown;
  user?: unknown;
  value?: unknown;
  revision?: number;
}

/**
 * The rc.1 `ctx.settings` surface this plugin uses.
 *
 * DSH 0.1.7-rc.1 replaced the per-plugin `installSection` registration with
 * schema-derived configuration forms: a plugin's exported `Config` is the form,
 * the profile entry id is the namespace, and only `volatile` fields are
 * projected and writable at runtime. `describe()` is synchronous and
 * `mutate()` writes path-addressed edits into the profile entry.
 */
interface SettingsLike {
  describe?(): SettingsDescriptorLike[];
  mutate(ns: string, ops: readonly unknown[], expectedRevision?: number): Promise<void>;
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
  /** Loader fiber owning this plugin; its entry id is the rc.1 settings namespace. */
  fiber?: { entry?: { options?: { id?: string } } };
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

/**
 * One session-keyed pin as stored in configuration (all fields optional).
 */
interface PinConfig {
  provider?: string;
  model?: string;
  reasoningEffort?: string;
  followLeader?: boolean;
  modelDefault?: boolean;
}

/**
 * Resolved shape of this plugin's configuration.
 *
 * `Volatile` is the public cordis reference type: the Loader keeps one live
 * reference per volatile field and commits settings writes into it in place, so
 * the plugin reads the current value without being remounted. `Config` below is
 * the schema that produces it, and `apply` reads its fields through this key set.
 */
export interface PluginConfig {
  scope: Volatile<string | undefined>;
  defaults: Volatile<PinConfig | undefined>;
  sessions: Volatile<Record<string, PinConfig> | undefined>;
  auditPath: string;
}

/**
 * One session-keyed pin entry. The fields stay ordinary; the *owning* node is
 * volatile, which is the unit rc.1 projects into a form and commits in place.
 */
function pinSchema(): ReturnType<typeof z.object> {
  return z.object({
    provider: z.string(),
    model: z.string(),
    reasoningEffort: z.string(),
    followLeader: z.boolean(),
    modelDefault: z.boolean(),
  });
}

/**
 * The plugin's rc.1 configuration schema.
 *
 * DSH 0.1.7-rc.1 derives a plugin's settings form from this export: only
 * `volatile` fields appear in the form, are writable through
 * `settings.mutate`/`remote.settings.mutate`, and are committed into the
 * running fiber without a remount. The profile entry id declared by
 * `cordis.patch.yml` (`agent-team-model-pin`) is the settings namespace, so the
 * `sessions` dict here is both the composition layer and the runtime store.
 * `auditPath` stays ordinary configuration: it is deployment-owned and never
 * edited by the model menu.
 *
 * Each volatile node owns a fresh schema instance because schemastery refuses
 * a volatile node nested inside another one.
 */
export const Config = z.object({
  scope: z.string().volatile(),
  defaults: pinSchema().volatile(),
  sessions: z.dict(pinSchema()).volatile(),
  auditPath: z.string(),
});

/** `isVolatile` from @deepseek-ai/cosmokit: a globally keyed reference protocol. */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write');

/**
 * Whether one resolved config field is a cordis volatile reference.
 * Reads the reference protocol symbol directly so no extra runtime dependency
 * is added and ESM/CJS copies of cosmokit still agree.
 * @param value Candidate config field.
 * @returns Whether `value` exposes the volatile read/write protocol.
 */
function isConfigRef(value: unknown): value is { get(): unknown } {
  return value !== null && typeof value === 'object' && VOLATILE_WRITE in value
    && typeof (value as { get?: unknown }).get === 'function';
}

/**
 * Read one resolved config field, live.
 *
 * A Loader-resolved config carries volatile references; a plain object (unit
 * tests, direct `apply` calls) carries the value itself. Volatile references
 * are read on every call, so a settings write is visible without a remount.
 * @param field Config field as received by `apply`.
 * @returns The current value, or undefined when unset.
 */
function configValue(field: unknown): unknown {
  return isConfigRef(field) ? field.get() : field;
}

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

  // The Loader hands over the schema-resolved config (volatile fields are
  // references); a direct `apply` call may hand over plain values instead.
  const raw: Partial<Record<keyof PluginConfig, unknown>> =
    config !== null && typeof config === 'object' ? (config as Record<string, unknown>) : {};

  /**
   * Effective scope, read live. A volatile `scope` field can be rewritten by a
   * settings write, so the value is resolved per call instead of captured.
   * @returns The configured scope, or the documented default when absent/invalid.
   */
  const liveScope = (): Scope => {
    const configured = configValue(raw.scope);
    if (configured === undefined) return DEFAULT_SCOPE;
    if (typeof configured === 'string' && (SCOPES as readonly string[]).includes(configured)) {
      return configured as Scope;
    }
    warnOnce(
      'scope',
      `agent-team-model-pin: 配置 scope 非法（期望 ${SCOPES.join(' | ')}），已回退为 ${DEFAULT_SCOPE}`,
    );
    return DEFAULT_SCOPE;
  };

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

  /** Normalize one session-keyed layer; malformed entries are dropped, never thrown. */
  const safeNormalizeSessions = (value: unknown, key: string, label: string): PinDict => {
    const out: PinDict = {};
    if (value === undefined || value === null) return out;
    if (typeof value !== 'object' || Array.isArray(value)) {
      warnOnce(key, `agent-team-model-pin: 配置 ${label} 非法（期望以 sessionId 为键的对象），该层按空处理`);
      return out;
    }
    for (const [sessionId, entry] of Object.entries(value as Record<string, unknown>)) {
      if (sessionId.trim().length === 0) {
        warnOnce(`${key}-key`, `agent-team-model-pin: 配置 ${label} 存在空 sessionId，已忽略该条`);
        continue;
      }
      const pin = safeNormalize(entry, `${key}-value`, `${label}["${sessionId}"]`);
      if (pin !== undefined) out[sessionId] = pin;
    }
    return out;
  };

  /** Effective defaults, read live from the resolved entry config. */
  const liveDefaults = (): Pin | undefined => safeNormalize(configValue(raw.defaults), 'defaults', 'defaults');

  /**
   * Effective per-session store, read live.
   *
   * In rc.1 the Loader-resolved entry config already merges the composition
   * layer with the profile override, so this single read is the effective layer
   * and a settings write is visible on the very next prompt assembly.
   */
  const liveSessions = (): PinDict => safeNormalizeSessions(configValue(raw.sessions), 'sessions', 'sessions');

  let auditPath = defaultAuditPath();
  const configuredAuditPath = configValue(raw.auditPath);
  if (configuredAuditPath !== undefined && configuredAuditPath !== null) {
    if (typeof configuredAuditPath === 'string') {
      const trimmed = configuredAuditPath.trim();
      if (trimmed.length > 0) auditPath = trimmed;
    } else {
      warnOnce('auditPath', `agent-team-model-pin: 配置 auditPath 非法（期望字符串），已回退为 ${defaultAuditPath()}`);
    }
  }

  /* ---------- 2. rc.1 settings：入口配置即运行期存储 ---------- */

  /**
   * The rc.1 settings namespace is the Loader entry id that owns this plugin.
   * `cordis.patch.yml` declares `agent-team-model-pin`, so the fallback keeps a
   * deployment that mounts the plugin without a profile patch addressable.
   */
  const entryId = (): string => {
    const id = ctx.fiber?.entry?.options?.id;
    return typeof id === 'string' && id.length > 0 ? id : SETTINGS_NS;
  };

  const settingsService = (): SettingsLike | undefined => {
    const found = ctx.get('settings');
    return found !== null && typeof found === 'object' ? (found as SettingsLike) : undefined;
  };

  /**
   * The service's synchronous view of this plugin's own settings entry.
   * `base` is the composition layer beneath the profile override and `user` is
   * the stored override; both are absent on a deployment without a configurable
   * profile entry, which degrades the layer display instead of failing.
   */
  const descriptor = (): SettingsDescriptorLike | undefined => {
    const settings = settingsService();
    if (settings === undefined || typeof settings.describe !== 'function') return undefined;
    try {
      const list = settings.describe();
      if (!Array.isArray(list)) return undefined;
      const id = entryId();
      return list.find((item) => item !== null && typeof item === 'object' && item.ns === id);
    } catch (error) {
      warnOnce('settings-describe', `agent-team-model-pin: 读取 settings 描述失败：${errorText(error)}`);
      return undefined;
    }
  };

  /** Composition baseline (the layer the runtime pins override), when describable. */
  const composition = (): { sessions: PinDict; defaults: Pin | undefined } | undefined => {
    const item = descriptor();
    if (item === undefined) return undefined;
    const base = item.base !== null && typeof item.base === 'object' && !Array.isArray(item.base)
      ? (item.base as Record<string, unknown>) : {};
    return {
      sessions: safeNormalizeSessions(base.sessions, 'composition-sessions', 'Composition.sessions'),
      defaults: safeNormalize(base.defaults, 'composition-defaults', 'Composition.defaults'),
    };
  };

  const llmService = (): LlmLike | undefined => {
    const found = ctx.get('llm');
    return found !== null && typeof found === 'object' ? (found as unknown as LlmLike) : undefined;
  };

  /* ---------- 3. 就近优先解析与审计 ---------- */

  const effectivePin = (sessionId: string, role?: Role): Pin | undefined => {
    try {
      return resolveLayer({
        scope: liveScope(),
        defaults: liveDefaults(),
        configSessions: liveSessions(),
        liveSessions: {},
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
   * @param includeLive true → 有效层（Composition ∪ 运行期）；false → 仅 Composition 基线。
   * @returns 合并结果（role 无关）。
   */
  const sessionKeyPin = (sessionId: string, includeLive: boolean): Pin | undefined => {
    try {
      const baseline = includeLive ? undefined : composition();
      return resolveLayer({
        scope: 'all',
        defaults: includeLive ? liveDefaults() : baseline?.defaults,
        configSessions: includeLive ? liveSessions() : baseline?.sessions ?? {},
        liveSessions: {},
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
    const effective = liveSessions();
    const baseline = composition();
    return [
      `作用键（Lead 会话 id）：${sessionId}${role === undefined ? '' : `（调用方 role=${role}）`}`,
      `scope：${liveScope()}`,
      `该作用键上的钉（不按 role 过滤）= ${describePin(sessionKeyPin(sessionId, true))}`,
      `调用方自身生效钉= ${describePin(effectivePin(sessionId, role))}`,
      `运行期层（settings）= ${describePin(effective[sessionId])}`,
      baseline === undefined
        ? `Composition 层= 不可用（本部署未提供 settings 描述：无 profile 配置入口）`
        : `Composition 层 sessions= ${describePin(baseline.sessions[sessionId])}`,
      ...(baseline === undefined ? [] : [`Composition 层 defaults=${describePin(baseline.defaults)}`]),
      '解析顺序（就近优先）：运行期 > Composition.sessions > Composition.defaults，且为字段级合并。',
      '说明：rc.1 把运行期钉写进本插件的 profile 入口配置（命名空间 agent-team-model-pin）；clear 只撤销该覆盖，Composition 基线随之重新生效。',
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
          if (liveScope() === DEFAULT_SCOPE && role === 'lead') {
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
            await settings.mutate(entryId(), [mutationFor(plan, sessionId)]);
          } catch (error) {
            return { kind: 'error', text: `写入运行期钉失败：${errorText(error)}` };
          }
          return {
            kind: 'success',
            text: [
              `已设置本会话（${sessionId}）运行期钉：${describePin(pin)}`,
              `scope=${liveScope()}${liveScope() === DEFAULT_SCOPE && role === 'lead' ? '（只作用于队友，Lead 自身不受影响）' : ''}`,
              '下一次提示词组装时生效；本步重试沿用同一选择，已存在的队友无需重建。',
            ].join('\n'),
          };
        }

        try {
          await settings.mutate(entryId(), [mutationFor(plan, sessionId)]);
        } catch (error) {
          return { kind: 'error', text: `清除运行期钉失败：${errorText(error)}` };
        }
        const baseline = sessionKeyPin(sessionId, false);
        return {
          kind: 'success',
          text:
            baseline === undefined
              ? `已清除本会话（${sessionId}）的运行期钉；当前无生效钉。`
              : `已清除本会话（${sessionId}）的运行期钉；但该作用键仍被组合配置钉住：${describePin(baseline)}（来自 Composition 层，需改组合配置才能解除）。`,
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