# SPEC · Agent Team 模型钉插件（冻结契约）

> 本文件是本次开发的**唯一契约源**。`core-dev`、`plugin-dev`、`verifier` 的任务输入都是它。
> 任何实现与本文冲突，以本文为准；需要改契约时先回报 Lead，由 Lead 更新本文后各方再动。
> 冻结时间：本次开发开始前。版本：v1.3（源码 TS + 发布构建产物；v1.1/v1.2/v1.3 的裁定见第 9 节）。

## 1. 目标与成功标准

用一个 profile 级 **TypeScript** Host 插件，把 **Agent Team 队友实际发出的模型请求**钉到指定
`provider / model / reasoningEffort`，可按 session 改写、改完下一次请求即生效。

成功标准（全部可观察）：

1. 队友的模型请求走钉住的路由；Lead 自身的请求不受影响。
2. 同一 profile 下，会话 A 的钉不影响会话 B。
3. 改钉后**无需重启**、**无需重建队友**，下一个请求生效；已发出的请求不回改。
4. `/team-model` 可查看 / 设置 / 清除当前会话的钉；非法输入报错且**零写入**。
5. 每次改写追加一行审计，可证明"钉在哪、对谁生效"。

## 2. 非目标

- 不改动、不替换、不 patch `@deepseek-ai/dsh-experimental-agent-team` 与 `@deepseek-ai/dsh-tool-agent-team`。
- 不改任何 shipped preset，不改 host 组合的其它行。
- 不做跨进程协作；不提供 worktree / 文件锁。
- 不管普通 `subagent` / `subagent_fork` 的模型选择（它们另有 `agentOptions` / `modelSelectionSettings` 机制）。
- 不新增 Service、不新增 Remote、不新增面向模型的工具 schema。
- 不修改 `list_agents` 里 Lead/队友的 `model` 显示（该列读 Agent 构造期 `options.model`）。

## 3. 事实基础（已查证，决定了方案形态）

- 队友今天继承 Lead 的模型：team 服务调用
  `ctx.subagents.startContinuable({ …, request: { prompt, parent } })`，**没有**传 `agentOptions`
  （`dsh-experimental-agent-team/lib/index.js:573`）；而底层协议支持
  `{ provider, model, reasoningEffort, maxTokens }`（`dsh-subagent/lib/types/types.d.ts:162`）。
  → 在不改官方包的前提下钉模型，只能拦请求。
- 唯一受支持的拦截点是 `agent/request` 瀑布：
  `(payload: { agent, turn, step, signal }, next) => Promise<LlmCallConfig>`，
  `LlmCallConfig = { provider, model, reasoningEffort?, temperature?, maxTokens?, stop? }`。
  DSH 自身的模型选择走同一条路（`dsh-agent/lib/types/model-selection.js:62`）。
- 无标签监听器保持全局（`dsh-scope` README），因此**一个** profile 级监听器即可覆盖所有 agent。
- 身份判定：`ctx.agentTeams.tryMembership(agent)` → `{ root, id, role: 'lead'|'teammate', name } | undefined`（同步、不抛）。
- 编辑器：`ctx.commands.register({ name, description, input: { hint }, handler })`，
  handler 收到 `{ agent, rawInput, signal }`，返回 `{ kind: 'success', text? } | { kind: 'error', text }`。
- 存储：settings 命名空间 `installSection(owner, ns, schema, entry, hooks)` / `get(ns)` /
  `mutate(ns, [{ op: 'set'|'unset', path }])`，持久化到 `/app/.dsh/settings.yaml`。
- 校验：`ctx.llm.listProviders()`、`ctx.llm.resolveModelInfo(provider, model)`。
- `@deepseek-ai/schemastery@3.18.2` 已存在于 profile 根 `node_modules`，运行时可逐级上溯解析。

## 4. 行为契约

**R1 生效范围**：`scope='teammates'`（默认）只对 `role === 'teammate'` 生效；
`'members'` 含 Lead；`'all'` 含非团队成员（此时作用键取 `agent.id`）。

**R2 作用键 = Lead 会话**：队友的作用键是 `membership.root.id`。因此"在会话 A 设的钉"只影响 A 的队友；
`scope='all'` 的非成员用自身 `agent.id`。

**R3 三层解析、就近优先**：运行期层（settings，按 sessionId 分键）
> Composition 层 `config.sessions[sessionId]` > Composition 默认层 `config.defaults`。
**字段级合并**：只写 `model` 就只换模型，`provider` / `reasoningEffort` 沿用下层。
某一层对该 session 缺失（`undefined`）视为"无该层"。

**R4 effort 语义**：pin 指定了 `provider` 或 `model` → 丢弃继承的 `reasoningEffort`，除非 pin 自己给了 effort；
pin 只给 effort → 保留原 `provider` / `model`。

**R5 生效时机**：请求进入 `agent/request` 时读取当前解析结果；不回改历史；不影响已存在队友的存活。

**R6 命令语法**：
- `/team-model` 或 `/team-model show` → 查看当前会话的有效钉与来源层。
- `/team-model <provider> <model> [effort]` → 设置该会话的运行期层。
- `/team-model clear` → 清除该会话的运行期层。
- 其它形态 → `{ kind: 'error', text }`，且**不写入任何状态**。

**R6b clear 的确切含义**：只移除**运行期层**；随后按 R3 继续解析。若 Composition 层仍钉住，
命令的返回文本必须明确说明"仍被组合配置钉住"。

**R7 不改 roster 显示**：`list_agents` 的 `model` 列读 Agent 构造期 `options.model`，本插件不动它。

### 失败与边界

| 情形 | 行为 |
|---|---|
| `agentTeams` 服务缺失 | 插件不激活（`inject` 依赖），不报错、不抛 |
| `settings` 服务缺失 | Composition 层仍生效；命令返回明确错误文本，不抛 |
| 审计文件不可写 | 记一次日志后继续，**绝不阻断模型请求** |
| 未知 / 已失效 agent | `tryMembership` 返回 `undefined` → 不钉、不抛 |
| 运行期 pin 含空串 | 视为未设置该字段 |
| 运行期 route 非法 | **不校验、不回退**（错误留在设置那一刻，避免过期配置打死整个会话） |

## 5. 接口冻结

### 5.1 `src/pin.ts`（纯逻辑，零依赖，可单测）

```ts
export type Scope = 'teammates' | 'members' | 'all';
export type Pin = { provider?: string; model?: string; reasoningEffort?: string };

/** 去空白、丢弃空串；全空则返回 undefined。 */
export function normalizePin(raw: unknown): Pin | undefined;

export function resolvePin(input: {
  scope: Scope;
  defaults?: Pin;
  configSessions?: Record<string, Pin>;
  liveSessions?: Record<string, Pin>;
  sessionId: string;
  role?: 'lead' | 'teammate';
}): Pin | undefined;

/** 按 R4 把 pin 合并进调用配置；不得改动 pin 未涉及的字段。 */
export function applyPin<T extends { provider: string; model: string; reasoningEffort?: string }>(
  config: T,
  pin: Pin,
): T;

export type CommandPlan =
  | { action: 'show' }
  | { action: 'clear' }
  | { action: 'set'; provider: string; model: string; reasoningEffort?: string }
  | { action: 'invalid'; error: string };

export function parseCommandInput(rawInput: string): CommandPlan;

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
): PinMutation;

/** 人类可读描述；无钉时返回明确的"未设置"文本。 */
export function describePin(pin: Pin | undefined): string;

export interface LlmLike {
  listProviders(): { id: string }[];
  resolveModelInfo(provider: string, model: string): Promise<{
    reasoning?: { efforts: readonly { id: string }[] };
  }>;
}

/**
 * 设置时校验（R6 的"零写入"前提）：
 * - 只给 provider：必须已注册，否则抛错；
 * - 给 provider + model：`resolveModelInfo` 能解析即接受（目录只是建议）；
 * - 只给 model：用 fallback.provider 校验；
 * - 给 effort：模型公布的 efforts 必须包含它；模型未公布 reasoning 时拒绝显式 effort。
 * 抛出的 Error.message 必须是可直接展示给用户的一句话。
 */
export function assertRouteSelectable(
  llm: LlmLike,
  pin: Pin,
  fallback: { provider?: string; model?: string },
): Promise<void>;
```

### 5.2 `src/index.ts`（插件入口）

导出：`name = 'agent-team-model-pin'`、`inject = ['agentTeams', 'commands']`、`apply(ctx, config)`。
（**不导出** `Config`，配置由自己的 `normalizeConfig` 处理，避免依赖 schemastery 的加载期解析；
schemastery 仅用于 settings 段落 schema。）

`apply` 必须完成：

1. 归一化配置：`{ scope, defaults, sessions, auditPath }`，非法值只告警不抛。
2. `ctx.inject(['settings'], (s) => s.settings.installSection(ctx, 'agent-team-model-pin', schema, { sessions: {} }, hooks))`，
   并在 `setSource` 中保存 thunk，供请求路径**同步**读取运行期层。
3. 注册全局命令 `team-model`（`input.hint` 给出语法提示）。
4. 注册**一个**全局 `agent/request` 监听：

```ts
ctx.on('agent/request', async ({ agent }, next) => {
  const config = await next();
  const m = ctx.agentTeams.tryMembership(agent);
  const sessionId = m?.root.id ?? agent.id;
  const pin = resolvePin({ scope, defaults, configSessions, liveSessions: live().sessions, sessionId, role: m?.role });
  if (!pin) return config;
  audit({ sessionId, agentId: agent.id, role: m?.role, from: config, pin });
  return applyPin(config, pin);
});
```

5. 审计：每次改写追加一行 JSONL；写失败只记一次日志。

### 5.3 配置形态

```yaml
- id: agent-team-model-pin
  name: '@local/dsh-agent-team-model-pin'
  config:
    scope: teammates        # teammates | members | all
    defaults: {}            # { provider?, model?, reasoningEffort? }
    sessions: {}            # { "<sessionId>": { provider?, model?, reasoningEffort? } }
    auditPath: ''           # 空 → $DSH_HOME/agent-team-model-pin/audit.jsonl
```

### 5.4 运行期存储

settings 命名空间 `agent-team-model-pin`：`{ sessions: { "<sessionId>": { provider?, model?, reasoningEffort? } } }`。
命令写入走 `settings.mutate(ns, [mutationFor(plan, sessionId)])`。

### 5.5 审计行格式（每行一个 JSON 对象）

```json
{"at":"<ISO8601>","sessionId":"…","agentId":"…","role":"teammate","from":{"provider":"…","model":"…","reasoningEffort":"…"},"to":{"provider":"…","model":"…","reasoningEffort":"…"}}
```

## 6. 语言与构建约束（v1.3：源码 TS + 发布构建产物）

**源码形态（开发者与测试直接加载）**

- 只写**可擦除语法**：禁止 `enum`、`namespace`、参数属性、装饰器、`import =`。
- **相对导入必须显式带 `.ts` 扩展名**（如 `import { resolvePin } from './pin.ts'`），这样 `tests/*.test.mjs` 可以用 Node v24.21 的 type stripping 直接 `import` 源码
  （实测 `process.features.typescript === 'strip'`，无警告）。

**发布形态（消费者实际加载的字节）**

- 包 `exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } }`，由 `npm run build`（`tsc -p tsconfig.build.json`）产出到 `dist/`。
  `tsconfig.build.json` 必须显式 `rootDir: "src"`，并启用 `rewriteRelativeImportExtensions`，使 emit 的 `./pin.ts` 被改写为 `./pin.js`。
- `files` 只含 `dist`、`cordis.patch.yml`、`README.md`、`LICENSE`（源码、测试、docs 留在仓库、不进 tarball）。
- 运行时依赖是 `dependencies`（不是 peer）：`@deepseek-ai/schemastery` 固定 `3.18.2`，保证 profile 安装时能解析。
- 构建期依赖：`devDependencies.typescript` 与 `@types/node`；`tsconfig.json` 的 `types: ["node"]`。
- 脚本：`typecheck` / `build` / `test` / `check`（前四者串联）/ `smoke:dist`（断言 `dist` 入口的 `name` 与 `apply`）/ `prepare`（`build`；覆盖 `npm pack`、`npm publish` 与 git 安装，避免 `.gitignore` 忽略 `dist/` 后打出空壳包）/ `prepublishOnly`（`check` + `smoke:dist`）。
- **不再要求**手工 `node_modules` 符号链接：`npm install` 会把 `schemastery` 装进包内 `node_modules`，`link:` 安装下的 realpath 上溯即可解析。


## 7. 验收

### 7.1 单元（`node --test tests/pin.test.mjs`）

| # | 场景 | 期望 |
|---|---|---|
| A1 | `scope=teammates`，role=teammate / lead | 前者得 pin，后者 `undefined` |
| A2 | 会话 A 有钉、会话 B 无 | A 得 pin，B `undefined` |
| A3 | `defaults` + session 层只写 `model` | 三层字段级合并结果正确 |
| A4 | 运行期层覆盖 Composition 层；clear 后回落 | 就近优先；回落正确 |
| A5 | 仅改 effort / 仅改 model | 前者保留路由；后者丢弃继承 effort |
| A6 | `/team-model`、`show`、`clear`、`a b`、`a b c`、`a`、`a b c d` | 前五个形态分别解析为 `show`/`show`/`clear`/`set`/`set`；后两者 `invalid` |
| A7 | `assertRouteSelectable`：未知 provider / 未知 model / 非法 effort / 合法三元组 | 前三者抛错，后者通过 |

### 7.2 端到端（**Lead 执行**，teammate 不参与）

1. `plugin_manager install_bundle`（空配置）→ 行 `active`（同时是 `.ts` 入口加载成功的证据）。
2. 临时设钉（本会话 per-session 钉 X + defaults 钉 Y）→ 只创建 1 个 fresh teammate 做一件小事 →
   读审计 JSONL：出现该队友 sessionId、路由 = X；Lead 无记录。
3. 读该队友会话记录，确认落库请求路由是 X。
4. 恢复中性配置，确认插件仍 `active`、`list_agents` 无残留。

### 7.3 明确无法由模型侧验证

- slash 命令的**触发**（我作为模型不能敲命令）：命令侧只证实**注册成功** + 解析逻辑被单测覆盖。
- `/` 菜单里的可见性：需人类敲一次 `/team-model` 确认。

## 8. 团队协作规则（写作用域）

| 成员 | 写作用域 | 说明 |
|---|---|---|
| Lead | `docs/SPEC.md` | 契约唯一源；安装/e2e/最终审查也归 Lead |
| `core-dev` | `src/pin.ts`、`tests/` | 严格 TDD：先写测试并**看到失败**，再写实现 |
| `plugin-dev` | `src/index.ts`、`package.json`、`cordis.patch.yml`、`tsconfig.json` | 依赖 5.1 的冻结接口 |
| `verifier` | `README.md`、`docs/VERIFICATION-REPORT.md` | 不写实现；独立复跑与逐条核对 |

- 只动自己的 write scope；跨文件需求走 `send_message` 找 Lead。
- Bash / 格式化器 / 代码生成不受 fs 版本守卫保护，最终 diff 与验收测试由 Lead 统一执行。
- **重要**：插件装入 profile 后，**开发队友本身也是 `role==='teammate'`**。
  因此安装时用**空配置**（行 active 但不钉任何人），开发期队友不受影响；只在 e2e 时临时设钉，验证完立即恢复。

## 9. 契约空白处的裁定（Lead 裁定 · v1.1 / v1.2 / v1.3）

实现过程中暴露的空白点由 Lead 裁定如下，**均不改变第 4–7 节的行为**，`verifier` 应据此判定"符合"，不再计为偏离：

| # | 空白点 | 裁定 |
|---|---|---|
| 9.1 | 只给 `model`、但 `fallback.provider` 缺失 | 抛可展示错误（无法校验即拒绝）。属 5.1 的"用 fallback.provider 校验"的缺失态，取 fail-closed |
| 9.2 | 只给 `provider` 时是否顺带解析 `fallback.model` | **不解析**，只查该 provider 是否已注册；严格贴合 5.1 文字 |
| 9.3 | `applyPin` 是否可原地修改入参 | 返回新对象，不修改调用方 config；"改路由且 pin 未给 effort"时删除 `reasoningEffort` 键（语义等于 R4） |
| 9.4 | `parseCommandInput` 对 `show` / `clear` 做 trim + 大小写不敏感匹配 | 接受。`/team-model clear me` 这类两 token 形态仍按 arity 解析为 `set(provider='clear', model='me')`，随后被 9.5 的 route 校验拒绝（provider 未注册 → 错误文本、零写入），不构成误写风险 |
| 9.5 | 运行期 route 合法性 | 不变：设置时校验（R6 零写入），运行期不校验不回退 |
| 9.6 | `resolvePin` 遇到非法 `scope` 值 | fail-closed 返回 `undefined`（非法 scope 不钉任何人）；`normalizeConfig` 已对该值告警 |
| 9.7 | 命令侧"当前有没有钉"该按谁判 | 命令文本与 `assertRouteSelectable` 的 fallback 用**作用键上、与调用者 role 无关**的解析（等价于内部 `scope='all'`）；请求路径仍按真实 role + `scope` 过滤。理由：R6b 要求 Lead 敲 `/team-model clear` 时能如实告知"组合配置仍钉着队友"，若按调用者 role（lead）过滤会误报"无钉" |
| 9.8 | 审计默认路径 | `auditPath: ''` → `$DSH_HOME/agent-team-model-pin/audit.jsonl`（本机为 `/app/.dsh/agent-team-model-pin/audit.jsonl`，目录不存在时首次命中自动创建）；e2e 使用该默认值 |
| 9.9 | 非成员（`scope='all'`）命中时审计行的 `role` | 省略该字段（`undefined` 不序列化），不写 `null` |
| 9.10 | 审计写入是否阻塞请求 | 不阻塞：串行 fire-and-forget 链，不 `await`；代价是极端情况下审计可能略滞后于请求返回（SPEC 5.2 伪代码同为不 `await`） |
| 9.11 | `mutationFor` 的参数类型（**v1.2 契约修正**） | 5.1 原签名 `{ action: 'set' \| 'clear' }` 丢失判别字段，`plan.provider/model/reasoningEffort` 在 tsc 下不可达（TS2339 ×4）。改为可判别联合；行为不变 |
| 9.12 | 类型检查的可执行性 | 本机离线、包内无 `@types/node`，因此 `tsc -p tsconfig.json --noEmit` 会报 `node:*` 与 `AbortSignal` 未定义（环境限制，非代码缺陷）。Lead 用工作区内已有的 `@types` 复跑以隔离代码缺陷：`tsc -p tsconfig.json --noEmit --typeRoots <dsh-file-manager-ts>/node_modules/@types --types node`。联网后应把 `@types/node` 加为 devDependency 并在 `types` 中声明 |
| 9.13 | 包名与发布形态（**v1.3 变更**） | 为发布到 npm，包名由 `@local/dsh-agent-team-model-pin` 改为 `@lolkda/dsh-agent-team-model-pin`（`@local` 无法发布）；`private` 移除；入口由 `src/index.ts` 改为构建产物 `dist/index.js`（见第 6 节）；`schemastery` 由 peerDependency 改为 dependency。行为契约（第 4–5 节）未变 |
| 9.14 | `dist/index.d.ts` 保留 `'./pin.ts'` 说明符 | `rewriteRelativeImportExtensions` 只改写 emit 的 JS，类型导入在 `.d.ts` 中保持 `.ts`。**实测消费者可用**：以 `moduleResolution: nodenext` 编译一个只 `import { apply, name, inject }` 的消费者文件，无报错；且 `const n: number = name` 正确报 TS2322，证明类型真的解析到 `pin.d.ts` 而非退化为 `any`（TS 会剥离 `.ts` 扩展名后再查找）。故不为此改动源码说明符 |
| 9.15 | 手工 `node_modules` 符号链接前提已取消 | 9.13 把 `schemastery` 改为 dependency 后，`npm install` 会在包内 `node_modules` 落地真实目录，`link:` 安装下的 realpath 上溯可直接解析；原符号链接属过渡期权宜，README 已随之更新 |

