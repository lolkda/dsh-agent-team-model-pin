# dsh-agent-team-model-pin

DSH Agent Team 模型选择插件。**1.1.0 起直接在输入框原来的模型菜单里选择 Team 模型与推理等级**，无需手输命令。

源码为 TypeScript，不修改 DSH 官方包或 shipped preset。行为契约见 [SPEC](docs/SPEC.md)，1.0.0 的历史独立验收见 [验证报告](docs/VERIFICATION-REPORT.md)。本轮 DSH 0.1.7-rc.1 适配由 Agent Team 分工实现，由 Lead 统一审查、构建和安装。

## DSH 0.1.7-rc.1 适配版

本地修复版为 `1.3.0-rc.1`。不修改 DSH 核心或内置 preset，不依赖版本豁免，也不在 Profile 安装第二份核心 SDK。

- Host 导出 `Config`，`scope/defaults/sessions` 使用原生 volatile 引用；设置写入当前 Profile patch，旧 `agent-team-model-pin:` 段由 DSH 自动导入。
- Client 用 `sessions` 的持久父地址确定 Lead 会话，不再访问已删除的 `remote.agentTeams`；使用新版 `OutlineRegular` 图标。
- 模型通知识别新版 `source.kind = 'model-selection'`；UI 的组合层读取 `base.sessions`。
- 保持 Loader entry id 为 `agent-team-model-pin`；Client 用此 id 寻址配置，手动改名不在本版支持范围。
- 以下旧版本章节是历史修复记录；本版运行时与配置接口以本节和更新后的 SPEC 为准。

## 直接在菜单里选

点击输入框右下角现有的模型按钮。桌面、手机和平板均只显示一个弹层：**点击进入选项列表，用返回按钮回到根菜单**，不需要 hover，也不向侧面展开第二个菜单：

```text
模型                  当前主模型  ›
推理等级                   High  ›
──────────────────────────────────
Team 模型          跟随主 Agent  ›
Team 推理等级      跟随主 Agent  ›
```

- 上面两项继续控制**主 Agent**，通过 DSH 原有共享模型目录完成选择。
- 下面两项控制**当前会话的 Team**，以 Lead 会话 ID 保存；切换会话不会串配置。
- 模型按提供商的目录顺序展示，并显示提供商名称；推理等级只列出该模型支持的选项。
- **跟随主 Agent**可覆盖组合配置里的固定模型；跟随时也可以单独指定 Team 的推理等级。
- **模型默认**清除此前继承的推理等级。切换 Team 模型会自动恢复模型默认，不把旧模型的 effort 带过去。
- 保存带 revision 校验；冲突或失败直接显示在菜单中，不会假装成功。失败时可以点「重试」。
- 默认 `scope=teammates` 不影响 Lead；高级配置主动设置 `members/all` 时仍遵守该扩大后的作用范围。

保存后从已有队友的下一次提示词组装生效，无需重建队友；当前步骤及其重试保持同一选择，已发出的请求不会被修改。跟随源是 Lead 已生效的请求路由；尚未进入提示词组装的主模型选择仍受 DSH 原生生效边界控制。

## 安装与升级

本地开发：

```bash
npm ci
npm run check
```

本适配版应先构建并 `npm pack --ignore-scripts`，再通过插件管理器安装生成的 `.tgz` 绝对路径；不要直接链接带有开发版 SDK 的工作区。下面的旧目录式示例仅作历史记录：

```text
plugin_manager action=install_bundle target=/app/project/dsh-files/dsh-agent-team-model-pin
```

安装影响当前 profile 的所有会话，Team 配置则按会话隔离。Web UI 需要启用 DSH 原生模型选择器及 Agent Teams Web 功能。

**升级必须区分保存与激活**：

- `application: applied` 后仍需核对 Host 插件行及 Client 插槽是否实际激活。
- `application: restart-required` 表示升级包已保存，但**新代码尚未加载**。应重启当前 DSH 服务，再刷新原页面；只刷新浏览器不能替换 Host 已缓存的模块。
- 已加载后修改 Team 设置不需要重启。不要把配置即时生效误解为代码升级也能即时生效。

**1.1.1 修复客户端发现**：默认 bundle 必须挂载包根 `@lolkda/dsh-agent-team-model-pin`，不能使用 `/web` 子路径。DSH 的客户端扫描器会跳过包子路径，即使该 Host 行显示 active。浏览器工件为 `dist/client.js`，只接管 `conversation.input.model`；卸载后由原生选择器接回。

**1.1.2 修复插槽优先级**：DSH 单插槽按 priority 升序选中最低值，原生选择器是 0。插件现使用 **-100**，而不是会被原生控件遮住的 100。测试通过真实 DSH `SlotCore` 选出组件后再用 React 渲染，并验证卸载恢复原生选择器，不再用假注册器预设插件获胜。

卸载：

```text
plugin_manager action=remove_bundle target=@lolkda/dsh-agent-team-model-pin
```

用户配置与审计是独立数据，卸载不会删除它们。

## 1.1.3 交互修复

- 恢复原生模型按钮的尺寸、字体和透明背景，以及原生风格的圆角菜单；不再另加 Team 标记挤占按钮空间。
- 模型与推理等级在同一个弹层中切换，点击即可进入，有返回按钮；长列表在弹层内部滚动，不会向屏幕外再开一个侧菜单。
- 按可视视口限制弹层位置和宽高，兼容窄屏与软键盘造成的可视区域变化。
- **1.1.4 注入补正**：必须同时声明 `remote`、`remote.settings`、`remote.agentTeams`，只声明根 facade 不够。两类 RPC 命名空间均有独立的正向与缺失注入回归；本次不修改 1.1.3 的界面或样式。
- 保留主模型的默认推理等级显示，重复选择当前主模型不会把现有推理等级重置。

## 1.2.0 提示词与请求同步

- 复用 DSH 公开的 `installModelSelection()`，在 Agent 作用域内同步提示词的 `model/provider` 和请求目标，不修改 `agent.options` 或 prompt-manager。
- 选择在提示词组装时捕获；设置中途改变不会影响当前步骤或重试。无信号的预览也不会替换正在执行的快照。
- 与原生模型选择器共存时，Team 规则仍优先；只保留与最终目标一致的新模型切换通知，用户文本和历史记录不改。
- 保留旧式部分字段钉、跟随、模型默认及六字段审计。新的/恢复的 Agent 和已有 Agent 均接入，卸载移除对应监听。
- 标准作用域请求未经组装或出现晚期选路冲突时明确报错，避免发送错误的模型说明。没有 Agent 作用域的旧式自定义驱动保留请求级兼容，不承诺提示词同步。
- 需要提供该官方选择器的 DSH SDK（本次验证版本 `0.1.6-alpha.2`）。本版只改 Host，Client 代码及样式与 1.1.4 保持一致；Client 注册标识仍为 1.1.4，不能拿它证明本次 Host 升级。
- 新增真实 Cordis/Scope/SystemPrompt/原生选择器回归及真实 AgentLoop 的冻结请求集成验证；测试里的模型 IO 为捕获边界，不冒充真实模型调用。

### 1.2.2 修复安装后重启无法对话

**请跳过 1.2.1，使用已包含本节修复的 1.2.3。** 1.2.1 把 DSH 核心 SDK 放进 `dependencies`，会在 hoisted profile 中安装第二套 `system-prompt` / `scope` 等包。重启时 Loader 的全局注册器来自 profile，官方 preset/AgentLoop 仍使用部署目录的 scope；两份 scope 标签不相识，使 persona 被当成全局重复注册，报 `deployment:persona-prefix ... already registered`。

1.2.2 修复的是**发布依赖边界**，不重写模型同步或菜单：

- 核心 SDK / Cordis 只作为开发依赖；运行时由 DSH 自己的 profile resolver 提供。
- `dsh-agent` 声明为 **optional peer**（本版支持 `0.1.6-alpha.2`），避免包管理器自动再安装一套核心包；仍复用宿主的公开 `installModelSelection()`。
- 不改 shipped preset、全局注册器、scope 实现或 prompt-manager，也不吞掉重复注册错误。
- 新增真实 Loader → runtime resolver → AgentPresets → persona 冷启动回归；检查插件确实 active、官方选择器是宿主同一个模块实例，以及两个会话的 persona 隔离与释放。

`autoInstallPeers: false` 不表示 DSH 运行时无法提供 SDK。**脱离 DSH 启动器单独用 `node import()` 检查已安装插件，不能作为安装失败的证据**；它没有启动 DSH 的模块回退解析器。开发源码可通过 `npm ci` 安装开发依赖后检查。

若仍装着 1.2.1，建议先在插件管理器中**移除旧 bundle**（只禁用不一定清除污染解析的核心依赖），再安装 1.2.3、重启该 DSH、刷新页面。保留原有 settings 和会话数据；若同一 profile 的其它插件也显式安装核心 SDK，需另行检查其依赖归属，不要手删 SDK 或官方 persona。

真实启动回归需要 PATH 中可找到 DSH，或设置 `DSH_TEST_INSTALL_ROOT` 为 DSH 安装根；测试在唯一临时目录和独立 Node 进程中运行，无 DSH 环境时明确显示 skipped。可用 `DSH_TEST_PACKAGE_ROOT` 指向已安装或已解包的候选插件以检查最终产物。

### 1.2.3 修复 Team 菜单消失

此前 Client 漏声明了 `remote.session`。原生模型目录在首次创建时会读取这个命名空间，触发 `cannot get property "remote.session" without inject`，DSH 随后撤下出错组件并显示原生的“模型／推理等级”两项。已有目录缓存可能使热安装看似正常，刷新或切换新会话后才暴露问题。

- 补齐 `remote.session` 依赖，保持 priority -100、原菜单布局和 Team 设置格式不变。
- 原生模型目录加载失败继续通过其 store 显示错误，同时消费 Promise rejection，避免未处理拒绝。
- Client registrant 为 `agent-team-model-pin-ui-1.2.3`，组件 DOM 标记为 `data-team-model-pin="1.2.3"`。
- 新增真实原生模型目录、SlotRegistry/renderer 与原生回退组件的冷/热目录测试。旧 UI 测试的假 `directoryFor()` 没有覆盖这一调用链，不能再用它单独证明 UI 可用。
- 1.2.2 的 Host 冷启动修复保留；没有重新安装核心 SDK，没有改 Host 模型同步、settings 或历史会话。

安装后要在当前页面真正展开菜单，确认四项控制均存在并能保存。只看到 bundle enabled 或注册瞬间 active 不算界面验收；已出错的旧 Client 需要加载新版本，必要时刷新原页面。若管理器返回 restart-required，新 Host 尚未生效，按安装结果处理，不把刷新浏览器当作 Host 重启。

## 命令仍然保留

```text
/team-model
/team-model cpa deepseek-flash low
/team-model clear
```

`show`（或无参数）只读查看配置；`set` 在写入前校验 route 与 effort，非法输入不写入。`clear` 只移除运行期层，若组合层仍有钉会明确说明；菜单的「跟随主 Agent」则可显式覆盖组合层。

## 高级配置

默认使用中性配置，不固定任何模型：

```yaml
- id: agent-team-model-pin
  name: '@lolkda/dsh-agent-team-model-pin'
  config:
    scope: teammates        # teammates | members | all
    defaults: {}
    sessions: {}
    auditPath: ''
```

普通 Pin 字段为 `provider? / model? / reasoningEffort?`，优先级为：

1. settings 的 `agent-team-model-pin.sessions[LeadSessionId]`
2. 组合配置 `sessions[LeadSessionId]`
3. 组合配置 `defaults`

普通字段继续逐字段合并。UI 增加两个显式标志：`followLeader: true` 忽略下层固定路由，`modelDefault: true` 清除继承 effort。它们只供策略解析，不会传给 LLM 提供商。

UI 复用 `settings.describe/mutate`，组合元数据只取不可变 `base`，保存只改选中会话的路径并携带 namespace revision。没有新增 Remote、Service 或模型工具。

## 审计与限制

默认审计位置：`$DSH_HOME/agent-team-model-pin/audit.jsonl`。每行包含 `at/sessionId/agentId/role/from/to`，异步串行追加；失败告警一次，不阻断模型请求。

- `list_agents` 的 `model` 列仍是构造期显示值，不等于实际请求路由，以审计为准。
- 不管理普通 `subagent/subagent_fork` 的模型选择。
- Provider 下架后不会在请求时自动换到其它模型，请重新选择有效路由。
- 审计不提供跨进程写锁。

## 开发、测试与发布

| 命令 | 用途 |
|---|---|
| `npm run typecheck` | 严格 TypeScript 检查 |
| `npm run build` | tsc 生成声明与 JS，esbuild 生成 Web Host 入口和浏览器 lazy factory |
| `npm test` | 原有回归、UI 策略、Host 装配、React 组件测试 |
| `npm run test:tap` | 同一套测试，TAP 输出，供 CI 判定是否有用例被跳过 |
| `npm run check` | typecheck → build → test |
| `npm run smoke:dist` | 检查两个 Host 入口与浏览器脚本语法 |
| `npm pack --dry-run` | `prepare` 自动构建后核对发布文件 |

测试需要 Node 24（直接导入可擦除 TypeScript）。浏览器使用 Harness 的共享 React、React DOM 与原生图标，**不打包第二份 React/React DOM**。单面板保持原生 ModelSelect 的布局与主题规范。测试使用真实 Cordis、SlotCore、React DOM 和 jsdom，覆盖注入、点击、返回、焦点和保存；纯几何测试覆盖窄视口边界。它们不代替真实手机/pad 的布局与触控验收。

`dist/` 不提交进 Git，但 `prepare` 自动构建。npm 包只含 `dist`、bundle patch、README、LICENSE 和 package metadata，不含源代码、测试或开发依赖。

`artifacts/` 是本地验证证据，**不进 Git**：其中的 Web 重启探针会记录带会话 token 的 `dsh web` 入口 URL。

### 集成测试不能被静默跳过

`native-client`、`cold-start`、`web-restart` 三个套件在机器上没有 DSH 安装时会 `skip`，而 `node --test` 仍然退出 0。CI 与发布工作流因此都会先安装 `@deepseek-ai/dsh`、显式固定 `DSH_TEST_INSTALL_ROOT`，再用 TAP 摘要断言 `# skipped 0`；跳过即为失败。本地想跑完整门禁：

```bash
npm install --global @deepseek-ai/dsh@0.1.6-alpha.2
export DSH_TEST_INSTALL_ROOT="$(npm root -g)/@deepseek-ai/dsh"
npm run check
```

### 发布

- 仓库：<https://github.com/lolkda/dsh-agent-team-model-pin>（public）
- [CI](.github/workflows/ci.yml)：push / PR / 手动验证，含上面的跳过守卫。
- [发布工作流](.github/workflows/release.yml)：`verify` 通过后才 `publish`；`v*` 标签推送即真实发布，手动触发默认 dry-run（`dry_run=false` 才真实发布）。

工作流按仓库实际持有的凭据二选一：

| 凭据 | 行为 | 适用阶段 |
|---|---|---|
| 仓库 secret `NPM_TOKEN` | `npm publish` 使用 granular access token | **首次发布唯一可行路径**，也是回退路径 |
| 无 secret | `npm publish --provenance`，走 npm trusted publishing（OIDC） | 包已存在且已登记 trusted publisher 之后 |

首次发布必须用 token（或本地 `npm publish`）：npm 只允许为**已存在于 registry 的包**配置 trusted publisher，所以 OIDC 无法创建包。首次发布后在 npmjs.com 的该包 Settings → Trusted Publisher 登记：

```
publisher:            GitHub Actions
organization or user: lolkda
repository:           dsh-agent-team-model-pin
workflow filename:    release.yml
```

登记后即可删掉 `NPM_TOKEN`，发布不再依赖长期令牌。未登记时 OIDC 发布会以裸 404 失败——**provenance 签名成功只证明构建来源，不证明 npm 授权了这次上传**；工作流会捕获该失败并打印上面这份排查清单。

- MIT，见 [LICENSE](LICENSE)。
