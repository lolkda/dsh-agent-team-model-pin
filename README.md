# dsh-agent-team-model-pin

**一句话**：Agent Team 的 teammate 默认继承 Lead 的模型；本插件把队友实际发出的模型请求钉到指定的 `provider / model / reasoningEffort`，可按 session 改写，改完下一个请求即生效。

**机制一句话**：拦 `agent/request` 瀑布，在 `next()` 返回的 `LlmCallConfig` 上按解析结果改写 `provider / model / reasoningEffort`；不改官方包、不改任何 shipped preset。

契约源：[`docs/SPEC.md`](docs/SPEC.md)（**v1.3**，源码 TS + 发布构建产物；v1.1–v1.3 的裁定见其第 9 节）。独立验证报告见 [`docs/VERIFICATION-REPORT.md`](docs/VERIFICATION-REPORT.md)。

---

## 1. 配置

插件行的 `config` 共四项（默认值即 `cordis.patch.yml` 里的中性配置）：

```yaml
- id: agent-team-model-pin
  name: '@lolkda/dsh-agent-team-model-pin'
  config:
    scope: teammates        # teammates | members | all，默认 teammates
    defaults: {}            # { provider?, model?, reasoningEffort? }，默认空（不钉）
    sessions: {}            # { "<sessionId>": { provider?, model?, reasoningEffort? } }，默认空
    auditPath: ''           # 空 → $DSH_HOME/agent-team-model-pin/audit.jsonl
```

| 字段 | 类型 | 默认 | 含义 |
|---|---|---|---|
| `scope` | `teammates` \| `members` \| `all` | `teammates` | `teammates` 只对 `role === 'teammate'` 生效；`members` 含 Lead；`all` 连非团队成员也生效（此时作用键取 `agent.id`）。非法值只告警一次并回退 `teammates`。 |
| `defaults` | Pin | `{}` | Composition 默认层。 |
| `sessions` | `{ [sessionId]: Pin }` | `{}` | Composition 会话层，键是**作用键**（见下）。 |
| `auditPath` | string | `''` | 审计文件路径；空串/全空白 → `$DSH_HOME/agent-team-model-pin/audit.jsonl`，`DSH_HOME` 未设置时回退 `~/.dsh/agent-team-model-pin/audit.jsonl`。非字符串只告警并回退默认值。 |

`Pin = { provider?: string; model?: string; reasoningEffort?: string }`，逐字段去首尾空白，**空串或全空白视为未设置该字段**。

**作用键**：队友的作用键是 `membership.root.id`（即它的 Lead 会话 id），所以"在会话 A 设的钉"只影响 A 的队友；`scope='all'` 的非成员用自身 `agent.id`。

配置非法值一律**只告警不抛**，对应层按空处理。

---

## 2. 命令

| 语法 | 行为 |
|---|---|
| `/team-model` 或 `/team-model show` | 查看本会话的有效钉、来源层、作用键与 scope；不写入任何状态。 |
| `/team-model <provider> <model> [effort]` | 写入**运行期层**（settings）；先校验 route，校验失败则 `{ kind: 'error', text }` 且**零写入**。 |
| `/team-model clear` | 清除本会话的**运行期层**。 |

其它形态（1 个非关键字 token，或 ≥4 个 token）→ `{ kind: 'error', text: '用法：/team-model <provider> <model> [effort] | /team-model show | /team-model clear' }`，**不写入任何状态**。

细则（与实现逐字一致）：

- `show` / `clear` 单 token 比较前会 `trim()` 且**大小写不敏感**。
- 两 token 形态按 arity 解析为 `set(provider=token0, model=token1)`，所以 `/team-model clear me` 会被当作"把 provider 设成 `clear`、model 设成 `me`"，随后被 route 校验以"provider 未注册"拒绝——错误文本 + 零写入，不构成误写风险。
- **`clear` 只清运行期层**，Composition 层（`config.sessions` / `config.defaults`）不受影响。清完后若该作用键仍被组合配置钉住，返回文本会明确说明，例如：
  `已清除本会话（<sessionId>）的运行期钉；但该作用键仍被组合配置钉住：当前会话模型钉：provider=…, model=…（来自 Composition 层，需改组合配置才能解除）。`
  仅当组合层也无钉时，才返回 `已清除本会话（<sessionId>）的运行期钉；当前无生效钉。`
- `settings` 服务不可用时：`show` 返回错误文本并附带 Composition 层解析结果；`set` / `clear` 返回明确错误文本，**不抛**。
- `set` 时 `llm` 服务不可用 → 错误文本，零写入。

`set` 的校验（`provider` 已注册；`provider+model` 能被 `resolveModelInfo` 解析；只给 `model` 用 fallback provider；给 `effort` 时模型必须公布该 effort）失败会抛出一句可直接展示的错误，命令侧转成 `{ kind: 'error', text: '校验失败，未写入任何状态：…' }`。

---

## 3. 三层解析与字段级部分覆盖

解析顺序（**就近优先**）：

1. **运行期层** —— settings 命名空间 `agent-team-model-pin` 下的 `sessions["<sessionId>"]`（`/team-model` 写入的层，持久化到 `$DSH_HOME/settings.yaml`）；
2. **Composition 会话层** —— `config.sessions["<sessionId>"]`；
3. **Composition 默认层** —— `config.defaults`。

**字段级合并**：高层的某个字段为 `undefined`（或空串，归一化后等同未设置）就沿用低层该字段；层整体缺失视为"无该层"。

例：`defaults = { provider: alpha, model: a-1, reasoningEffort: high }`，运行期层 `{ model: a-2 }` → 有效钉 `{ provider: alpha, model: a-2, reasoningEffort: high }`。

**effort 语义（R4）**：pin 指定了 `provider` 或 `model` → 丢弃被继承的 `reasoningEffort`，除非 pin 自己给了 effort；pin 只给 effort → 保留原 `provider` / `model`。其它调用配置字段（`temperature` / `maxTokens` / `stop` 等）不被触碰。

**生效时机（R5）**：请求进入 `agent/request` 时按当时解析结果改写；不回改历史请求；不影响已存在队友的存活；改钉**无需重启、无需重建队友**。

---

## 4. 审计

每次实际改写追加一行 JSONL 到 `auditPath`（默认 `/app/.dsh/agent-team-model-pin/audit.jsonl`；目录不存在时首次写入自动 `mkdir -p`）。每行字段（SPEC 5.5）：

```json
{"at":"<ISO8601>","sessionId":"…","agentId":"…","role":"teammate","from":{"provider":"…","model":"…","reasoningEffort":"…"},"to":{"provider":"…","model":"…","reasoningEffort":"…"}}
```

- `from` = 被拦请求原来的路由，`to` = 改写后的路由，`reasoningEffort` 为 `undefined` 时该键不出现。
- `role` 只在团队成员身上存在；`scope='all'` 命中的非成员省略该字段（不写 `null`）。
- 写入是**串行 fire-and-forget**，不 `await`，不阻塞模型请求；写失败（含文件不可写）只记一次 `logger.warn`，**绝不抛错、绝不阻断请求**。

---

## 5. 安装与卸载

安装在当前 profile 层，对所有 session 生效。`plugin_manager` 需要 danger-full-access 权限或本次调用的审批。

**安装**

```
plugin_manager  action=install_bundle  target=/app/project/dsh-files/dsh-agent-team-model-pin
```

（`target` 用包的**绝对路径**（本地 `link:` 安装）或包名 `@lolkda/dsh-agent-team-model-pin`（发布到 npm 后）；包内 `dsh.bundle.patch = ./cordis.patch.yml`，行 id `agent-team-model-pin`。）

装完用 `plugin_manager action=list_plugins` 确认行 `include:agent-team-model-pin` 的 `fiberPhase` 为 `active`。若结果为 restart-required，该能力**尚未**可用，需重启进程后才生效。

**卸载**

```
plugin_manager  action=remove_bundle  target=@lolkda/dsh-agent-team-model-pin
```

**开发期前提**：包内 `node_modules` 必须是装好的，在包目录执行一次

```
npm install
```

`@deepseek-ai/schemastery` 是 **`dependencies`**（v1.3 起，不再是 peerDependency），`npm install` 会把它落地为包内真实目录 `node_modules/@deepseek-ai/schemastery`。因此**不再需要**手工创建符号链接（v1.3 已取消该前提）。

**发布形态是 `dist/`**：消费者实际加载的是**构建产物**（`exports` → `dist/index.js` + `dist/index.d.ts`），所以从干净检出开始必须先构建：

```
npm install        # 装依赖（含 devDependencies：typescript、@types/node）
npm run build      # tsc -p tsconfig.build.json → dist/
```

`dist/` 已被 `.gitignore` 忽略、不进仓库。若 `dist/` 缺失，profile 加载该包会因入口文件不存在而失败（插件行不会 `active`）。

**卸载后**：`$DSH_HOME/settings.yaml` 里的 `agent-team-model-pin` 段落与审计文件是独立数据，不会被自动删除，需要时手动清理。

---

## 6. 仓库与发布

- **仓库**：<https://github.com/lolkda/dsh-agent-team-model-pin>
- **许可证**：MIT（见 [`LICENSE`](../LICENSE)）
- **发布包名**：`@lolkda/dsh-agent-team-model-pin`（`publishConfig.access = public`，registry 为 `registry.npmjs.org`）

**脚本**

| 脚本 | 作用 |
|---|---|
| `npm run typecheck` | `tsc -p tsconfig.json`（`noEmit`，只做类型检查） |
| `npm run build` | `tsc -p tsconfig.build.json` → `dist/`（含 `.d.ts`；`rewriteRelativeImportExtensions` 把 emit 的 `./pin.ts` 改写为 `./pin.js`） |
| `npm test` | `node --test tests/*.test.mjs`（测试直接加载源码 `.ts`，靠 Node type stripping） |
| `npm run check` | 依次跑 `typecheck` → `build` → `test` |
| `npm run smoke:dist` | 断言 `dist` 入口导出的 `name` 与 `apply` 形态 |
| `prepare` | `npm run build`；由 npm 在 **`npm install` / `npm ci` / `npm pack` / `npm publish` / git 安装**时自动触发，因此 `dist/` 不会因被 `.gitignore` 忽略而缺失 |
| `prepublishOnly` | `check` + `smoke:dist`；**`npm publish` 会自动先跑它**，所以发布会带上构建产物 |

**CI**（[`.github/workflows/ci.yml`](../.github/workflows/ci.yml)）：push / PR / 手动触发，Node 24，依次 `npm ci --no-audit --no-fund` → typecheck → build → test → `smoke:dist` → `npm pack --dry-run`（最后一步只打印将要发布的文件清单，**不发布**）。

**发布**（[`.github/workflows/release.yml`](../.github/workflows/release.yml)）：

- 推 `v*` 标签 → 真实发布 `npm publish --provenance --access public`。工作流会校验标签等于 `v` + `package.json.version`，不匹配即失败。
- 或手动 `workflow_dispatch`，其 `dry_run` 输入**默认为 true** → 跑完整流水线但只执行 `npm publish --dry-run`。

**认证走 npm trusted publishing（OIDC），不需要任何 secret**：与其它 `lolkda/dsh-*` 插件一致，工作流只声明 `id-token: write`，npm 用这个 OIDC 令牌换取一次性发布凭据，因此**没有 `NPM_TOKEN` 需要轮换**。一次性前提是在 npmjs.com 为该包登记 Trusted Publisher（Settings → Trusted Publisher）：

| 字段 | 值 |
|---|---|
| Publisher | GitHub Actions |
| Organization or user | `lolkda` |
| Repository | `dsh-agent-team-model-pin` |
| Workflow filename | `release.yml` |

未登记时，工作流会在 `Publish` 步骤以 `npm error code E404 / 404 Not Found - PUT https://registry.npmjs.org/@lolkda%2fdsh-agent-team-model-pin` 失败——注意此时 **provenance 已经签名成功**，说明 OIDC 交换本身是通的，缺的只是这次登记。

**打包**：`files` 只含 `dist`、`cordis.patch.yml`、`README.md`、`LICENSE`，而 `dist/` 被 `.gitignore` 忽略——这个组合本来会让干净检出打出的 tarball 缺少 `dist/`。现在由 **`prepare`**（`npm run build`）兜住：npm 在 `npm install` / `npm ci` / `npm pack` / `npm publish` 时会自动运行它，所以

- `npm ci && rm -rf dist && npm pack --dry-run` → `prepare` 自动重建 `dist/`，tarball 仍是 **8 个文件**（含 4 个 `dist/**`）；
- `npm publish` 另有 `prepublishOnly`（`check` + `smoke:dist`）把关。

唯一会失败的情形是**连依赖都没装**就打包（例如刚 clone 完直接 `npm pack`）：此时 `prepare` 里的 `tsc` 不存在，`npm pack` 会**明确报错退出**（`sh: 1: tsc: not found`，exit 127），而不是静默产出空壳包。先 `npm ci` 或 `npm install` 即可。

---

## 7. 已知限制

- **不改 `list_agents` 的 `model` 列显示**。该列读 Agent 构造期 `options.model`，钉只作用于实际请求，所以 roster 里显示的仍是继承来的模型——"显示值"与"实际请求路由"可能不一致，以审计文件为准。
- **运行期不校验、不回退 route**。校验只发生在 `/team-model` 设置那一刻；之后 provider/model 下架也不会自动失效。这是有意的：避免过期配置打死整个会话。
- **单进程、共享 cwd**。不做跨进程协作，无 worktree / 文件锁；审计文件是进程内串行追加，多进程同时写同一路径没有互斥保证。
- **slash 命令需人类在输入框触发**。模型侧无法敲 `/team-model`；自动化验证只能覆盖"命令注册成功 + 解析逻辑单测"。
- **不管普通 `subagent` / `subagent_fork`** 的模型选择（它们另有 `agentOptions` / `modelSelectionSettings` 机制）。
- **审计写入不阻塞请求**，极端情况下审计行可能略滞后于请求返回。