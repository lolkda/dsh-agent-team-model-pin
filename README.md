# dsh-agent-team-model-pin

DSH Agent Team 模型选择插件。**1.4.0 起通过原生 `/team-model` 和 `/team-effort` 搜索选择面板设置队友模型，不再替换输入框的原生模型选择器，也不提供仿原生 CSS 或常驻按钮。**

源码为 TypeScript，不修改 DSH 官方包或 shipped preset。行为契约见 [SPEC](docs/SPEC.md)，1.0.0 的历史独立验收见 [验证报告](docs/VERIFICATION-REPORT.md)。

## 1.5.0-rc.1：为新队友指定 Agent 预设（候选版）

**模型与思考等级继续兼容原有宿主；新增预设功能需要宿主的创建前接口，原版 DSH `0.2.0-rc.2` 不具备。**

本包不会修改官方包、替换运行中的工厂、安装第二份 SDK，也不会在 `agent/created` 后偷偷换预设。随包提供 `patches/` 下可审查的宿主扩展补丁，需由宿主维护者单独应用、验证及重启；或者使用实现相同接口的 DSH。接口按 `subagents.childSetupVersion === 1` 和 `registerChildSetup()` 实际能力检测，不能只靠版本号判断。未经扩展的宿主仍能使用 `/team-model`、`/team-effort`，但 `/team-preset` 保存会明确报错并保持零写入。

### 使用与生效边界

**只需输入 `/team-preset`，在原生弹层搜索并选择预设。** 不需要填写 ID 或参数。

列表包含「跟随主 Agent」和可用的 Agent 预设，当前选择带标记；点击或按 Enter 即可保存。只保留这一种用户交互，不提供文字子命令或非 Web 命令行配置入口。

- 这是 **Agent 预设组合**，不是在任务 prompt 里写一段角色描述。目标预设的工具、提示词和初始化应在队友首次发布之前就生效。
- 以 Lead 会话 ID 保存；从子会话选择也配置同一个 Team。只影响之后新建的队友，不改变 Lead、已有队友或普通非 Team subagent；不受模型设置的 `scope=members/all` 扩大影响。
- 每个队友创建时确定预设身份；`fresh` 和 `fork` 都适用。fork 的历史保留，不把父历史里旧的预设选择当作子会话的新选择。
- 冷恢复读取队友自身保存的身份，不读取后来修改的 Team 创建策略。预设定义的版本仍遵守 DSH 本身的加载机制，本功能不永久归档完整 preset YAML/插件代码。
- 保留子 Agent 已有的沙箱、审批策略、persona/toolFilter 等限制。不从 Lead 复制额外工具来规避目标预设的能力边界。Team 协作工具应按 DSH 的 Host 组合提供。
- 指定预设不存在、无法加载或宿主缺少必要接口时明确失败，不静默使用另一个预设。保存时及实际创建时均须验证，保存成功不保证未来被删除的 preset 仍能创建。
- 面板保存时由 Host 校验预设和宿主能力，并检查配置版本；发生冲突时重新打开面板即可。

预设与模型、思考等级分开保存，不会相互覆盖。开发配置和验收细节见 [预设功能规范](docs/PRESET-SPEC.md)。

## 1.3.1：取消 DSH 版本绑定，验证 0.2.0-rc.2

- 运行时 `@deepseek-ai/dsh-agent` 为 optional peer `*`，不再绑定到 `0.1.7-rc.1`，无需 `dsh plugin allow-version`。DSH 的兼容检查包含预发布版本，因此 `0.2.0-rc.2` 也不会被版本号拦截。
- `*` 只取消版本号限制，**不保证未来破坏性 API 变更仍兼容**。仍要求宿主提供 `installModelSelection()`、volatile Settings、Agent Teams 和原生 Web 模型目录等接口；保留已有请求冲突检查，不吞掉真实运行错误。
- 开发 SDK 固定为 `0.2.0-rc.2`，只用于可复现的类型检查和回归测试，不会作为运行时依赖安装到 Profile。CI/发布从开发依赖读取验证版本，不再要求它与 peer 字符串相等。
- 保持模型钉、提示词/请求快照、Lead 会话键、CAS 保存及审计行为不变；升级不需要配置迁移。修正冷启动测试的误报：配置了插件但被跳过时必须失败。

不修改 DSH 核心或内置 preset，不依赖版本豁免，也不在 Profile 安装第二份核心 SDK。

### 延续的 Settings 与 Client 接口

- Host 导出 `Config`，`scope/defaults/sessions` 使用原生 volatile 引用；设置写入当前 Profile patch，旧 `agent-team-model-pin:` 段由 DSH 自动导入。
- Client 用 `sessions` 的持久父地址确定 Lead 会话，不再访问已删除的 `remote.agentTeams`；1.4.0 的菜单、图标与交互由原生命令 UI 提供。
- 模型通知识别新版 `source.kind = 'model-selection'`；UI 的组合层读取 `base.sessions`。
- 保持 Loader entry id 为 `agent-team-model-pin`；Client 用此 id 寻址配置，手动改名不在本版支持范围。
- 以下旧版本章节是历史修复记录；本版运行时与配置接口以本节和更新后的 SPEC 为准。

## 1.4.0：原生命令选择面板

在输入框输入以下命令，或从 `/` 命令列表选中它。**不需要手动输入 provider/model 参数**：

| 命令 | 原生选择面板 |
|---|---|
| `/team-model` | 「跟随主 Agent」和按提供商分组的模型；支持原生模糊搜索 |
| `/team-effort` | 当前有效 Team 模型支持的推理等级和「模型默认」；模型跟随时另有「跟随主 Agent」 |

- 输入框模型按钮和 `/model` 完全由 DSH 原生插件管理，本插件不再注册 `conversation.input.model`。主模型的搜索、布局、状态提示直接跟随 DSH 升级。
- 当前选择有勾选标记。方向键、Enter/Tab 选择、Escape 关闭、搜索框、错误显示和防重复提交均来自原生 `popupSelect`，插件只提供选项与保存回调。
- 设置以 Lead 会话 ID 保存；子会话也写入其 Lead 的 Team 配置，从 Lead 目录读取选项，不修改主模型。
- **跟随主 Agent**覆盖组合配置里的固定模型，跟随时仍可单独指定 Team effort；固定模型的 effort 菜单不会提供会改变模型路由的「跟随」项。
- **模型默认**清除继承 effort；选择固定 Team 模型也会恢复模型默认。无推理等级的模型不显示任意等级，但允许清除旧 effort。
- 保存使用打开菜单时的 revision。加载失败可点原生「重试」；临时保存失败可重新选择。CAS 冲突或打开期间主模型发生变化时，关闭后重新打开，避免覆盖并发修改。
- 不带参数的 `/team-model` 使用原生 host-command decoration，不与后端命令重名注册；带参数的 `show`、`clear`、`<provider> <model> [effort]` 继续走原后端命令。`/team-effort` 是 Web 客户端选择入口，不新增后端命令。
- 旧 Team 配置无需迁移。默认 `scope=teammates` 不影响 Lead；高级配置主动设置 `members/all` 时仍遵守该扩大后的作用范围。

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

安装影响当前 profile 的所有会话，Team 配置则按会话隔离。Web UI 需要 DSH 原生命令 UI（含 `decorate` / `popupSelect`）、模型目录及 Agent Teams 功能；开发与集成测试使用 `0.2.0-rc.2`。

**升级必须区分保存与激活**：

- `application: applied` 后仍需核对 Host 插件行及 Client 插槽是否实际激活。
- `application: restart-required` 表示升级包已保存，但**新代码尚未加载**。应重启当前 DSH 服务，再刷新原页面；只刷新浏览器不能替换 Host 已缓存的模块。
- 已加载后修改 Team 设置不需要重启。不要把配置即时生效误解为代码升级也能即时生效。

**客户端发现**：默认 bundle 必须挂载包根 `@lolkda/dsh-agent-team-model-pin`，不能使用 `/web` 子路径。DSH 的客户端扫描器会跳过包子路径，即使该 Host 行显示 active。浏览器工件为 `dist/client.js`；1.4.0 只注册命令菜单，主模型插槽始终由原生插件持有。

**历史 1.1.2 插槽修复**：旧选择器曾以 priority -100 替换原生控件。此方案及其专用布局测试在 1.4.0 被撤销，改由原生命令菜单回归验证。

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

以上是历史 1.2.3 的四项菜单验收。1.4.0 安装后应改为检查 `/team-model`、`/team-effort` 原生面板能打开并保存，且主模型控件仍由 DSH 原生插件提供。只看到 bundle enabled 不算界面验收；若管理器返回 restart-required，应重启 DSH 再刷新浏览器，不把刷新浏览器当作 Host 重启。

## 命令仍然保留

```text
/team-model
/team-model cpa deepseek-flash low
/team-model clear
```

`show` 只读查看配置；非 Web 调用不带参数时也沿用 show，Web 中裸命令改为打开原生选择面板。`set` 在写入前校验 route 与 effort，非法输入不写入。`clear` 只移除运行期层，若组合层仍有钉会明确说明；原生菜单的「跟随主 Agent」则可显式覆盖组合层。

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

测试需要 Node 24（直接导入可擦除 TypeScript）。插件客户端本身不包含 React 组件、CSS 或 DOM 操作，选择面板由 DSH 提供。测试使用真实 Cordis、CommandUiRuntime、PopupSelectController、原生 PopupSelectView、模型目录及 Slot renderer，在 React/jsdom 中覆盖命令碰撞、搜索、键盘选择、错误/重试、关闭、单次提交和会话隔离。传输、会话 IO、图标和布局容器是测试夹具；原生排序代码直接取自已安装 DSH，不伪造模糊匹配。它们不代替当前运行页面或手机/pad 的实际布局验收。

`dist/` 不提交进 Git，但 `prepare` 自动构建。npm 包只含 `dist`、bundle patch、README、LICENSE 和 package metadata，不含源代码、测试或开发依赖。

`artifacts/` 是本地验证证据，**不进 Git**：其中的 Web 重启探针会记录带会话 token 的 `dsh web` 入口 URL。

### 集成测试不能被静默跳过

`native-commands`、`compatibility`、`cold-start`、`web-restart` 套件在机器上没有 DSH 安装时会 `skip`，而 `node --test` 仍然退出 0。CI 与发布工作流因此都会先安装 `@deepseek-ai/dsh`、显式固定 `DSH_TEST_INSTALL_ROOT`，再用 TAP 摘要断言 `# skipped 0`；跳过即为失败。本地想跑完整门禁：

```bash
# 版本从 package.json 读，避免门禁和实际发布的包对不上
npm install --global "@deepseek-ai/dsh@$(node -p 'require("./package.json").devDependencies["@deepseek-ai/dsh-agent"]')"
export DSH_TEST_INSTALL_ROOT="$(npm root -g)/@deepseek-ai/dsh"
npm run check
```

### 发布

- 仓库：<https://github.com/lolkda/dsh-agent-team-model-pin>（public）
- [CI](.github/workflows/ci.yml)：push / PR / 手动验证，含上面的跳过守卫。
- [发布工作流](.github/workflows/release.yml)：`v*` 标签推送即真实发布；手动触发默认 dry-run（`dry_run=false` 才真实发布）。**标签名必须等于 `v` + `package.json` 的 version**，否则 `verify` 直接失败。

流程是 `verify` → 打包 → `publish`，两步之间用 artifact 传递 tarball：

1. `verify`：`npm ci` → 从 `package.json` 的 devDependency 读出 DSH 验证版本并安装（runtime peer 为 `*`，不与开发版本作字符串相等比较）→ typecheck → build → 测试（`# skipped 0` 守卫）→ `smoke:dist` → 标签校验 → `npm pack` 出 tarball → 校验包内必须含 `dist/*` 与 bundle patch、且不含 `src/`、`tests/`、`docs/`。
2. `publish`：只下载上一步的 tarball 再 `npm publish <tarball>`，**不重新构建**。发布 tarball 时 npm 不跑生命周期脚本，所以「发出去的字节」就是「被验证过的字节」，不会因为在另一台机器上重打包而产生差异。

`dist-tag` 由 [scripts/release-plan.mjs](scripts/release-plan.mjs) 依据**实时 registry 状态**决定（回归见 [tests/release.test.mjs](tests/release.test.mjs)）：

| 版本形态 | 发布到 | 说明 |
|---|---|---|
| 正式版（`1.3.0`） | `latest` | 不动 `next` |
| 预发布（`1.3.0-rc.1`），registry 已有 `latest` | `next` | 绝不移动 `latest` |
| 预发布，registry 还没有 `latest` | **不发布**（发布前中止） | trusted publishing 写不了 dist-tag，此时 `npm install <包名>` 解析不到任何版本；工作流宁可中止也不发一个装不上的包 |

发布使用 **npm trusted publishing（OIDC）**：GitHub 签发短期身份令牌，npm 用它换取本包的发布权，`npm publish --provenance` 记录构建来源。仓库里**不保存任何长期令牌**，CI 里也不会出现 2FA 提示。

不能改成用 token 发布：本账号开启了「写操作强制 2FA」，CI 里用 granular token 发布会直接被 npm 拒绝（`EOTP: This operation requires a one-time password`），而 npm 正在撤回「可绕过 2FA 的 token 用于直接发布」这条路；`npm publish`、`npm dist-tag add`、`npm trust` 三个动作实测都要求 OTP。OIDC 是唯一可行的 CI 发布方式。

两个 npm 侧前提，都只需要做一次，且都必须由维护者带 2FA 在 CI 之外完成。**本仓库两项都已完成**（首个版本 `1.3.0-rc.1` 手工上传，trust 已登记为 `github / lolkda/dsh-agent-team-model-pin / release.yml`，权限 `publish, stage publish`），因此现在推送 `v*` 标签即自动发布。下面记录当初是怎么做的，供新包复用：

1. **包必须已存在**。npm 只允许给**已存在的包**登记 trusted publisher（`npm trust` 的 Prerequisites 原文是 “Package must exist”），新包做 staged publish 也会返回 404。所以首次发布要手工上传一次本工作流产出的、已通过门禁的 tarball：

   ```bash
   npm publish <tarball> --access public --tag next      # 会交互式提示输入 6 位验证码
   npm dist-tag add @lolkda/dsh-agent-team-model-pin@<version> latest
   ```

2. **登记 trusted publisher**：

   ```bash
   npm trust github @lolkda/dsh-agent-team-model-pin \
     --repo lolkda/dsh-agent-team-model-pin --file release.yml --allow-publish -y
   ```

   等价的一次性网页配置：npmjs.com → 该包 → Settings → Trusted Publisher

   ```
   publisher:            GitHub Actions
   organization or user: lolkda
   repository:           dsh-agent-team-model-pin
   workflow filename:    release.yml
   ```

完成后推送 `v*` 标签即自动发布，带 provenance，不再需要任何令牌。未登记时 OIDC 发布会以裸 404 失败——**provenance 签名成功只证明构建来源，不证明 npm 授权了这次上传**；工作流会捕获该失败并打印上面这份排查清单。包还不存在时，工作流在发布前就停下并打印上面那份 bootstrap 步骤，不会以 npm 的裸 404 收场。

- MIT，见 [LICENSE](LICENSE)。
