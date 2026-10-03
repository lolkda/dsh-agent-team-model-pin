# Team 创建时预设选择 · 1.5.0-rc.1

## 确认的产品目标

- 每个 Lead 会话一条未来队友创建策略，不提供每个队友独立 UI、不提供热切换。
- 从已注册的 Agent preset 目录选择完整预设组合，默认继承 Lead。
- 只对新建 Team 队友生效。模型、思考等级和 preset 分开保存。
- fresh/fork 同样支持；历史不重写；冷恢复保持队友自己的预设身份。
- 不改变 Lead 或普通 subagent；权限和 Team 角色限制必须保留。
- 错误显式报告；不做静默默认回退，不在实际未生效时报告成功。

## 为什么需要宿主扩展

已核对的原版 SDK 为 DSH 0.2.0-rc.2。continuation activation 的 setup 归宿主管理，provider 只能贡献 seed。`agent/created` 是 awaited，但 Cordis 在进入第一个监听器前已按旧 scope 过滤并快照回调列表。即使 prepend 回调中调用 `agentPresets.mount()`，旧预设的初始化仍可能运行，新预设的初始化不会补发。重新 dispatch 或修改内部监听器均不可接受。

因此完整实现需要可检测的 `subagents.childSetupVersion = 1` / `registerChildSetup()` 接口。创建前回调在未发布的 child scope 内、原生 delegation composition 之后、Session/Agent created 事件之前完成；返回的 commit 在发布前验证取消/插件卸载等条件。原版宿主缺少接口时不启用预设写入，保留旧模型功能。人工配置的固定预设也不能在不支持的宿主上悄悄运行。

补丁仅作为源文件和验收工件提供，不自动安装或修改系统中的 DSH。测试应加载隔离的补丁候选，不 monkeypatch 运行中的 AgentRegistry/TeamService。

## 配置与命令

- `presetDefault?: string | null`
- `presetSessions?: Record<LeadSessionId, string | null>`
- undefined 继承配置；null 显式继承 Lead；非空字符串为 preset ID。
- 用户仅使用裸 `/team-preset` 打开原生 popupSelect；不提供手动参数入口。非 Web 调用只提示使用选择面板，不读取/修改策略。
- 面板内部通过本插件 `teamSettings.preset(agentId, revision, choice)` RPC 调用 Host，验证宿主能力、目录、CAS、成员身份和取消状态；该协议不出现在用户命令目录或参数提示中。
- 面板选择「跟随主 Agent」保存 null，可压过组合默认。
- preset 写入只触及 `presetSessions`，旧 Pin 归一化和请求选择算法不改。

## 生命周期要求

1. 在创建边界读取一次 Lead 策略，后续异步设置变化不改变该次决策。
2. 验证父 Agent 为活跃 Team Lead，child id 已在其 provisioning/active roster；不能要求未发布的 child 已在 AgentRegistry 中。
3. 绑定新预设后才发布 Session/Agent，确保目标预设 scoped 初始化运行而旧预设初始化不运行。
4. 把确定的身份写入 child 自己的日志后缀，排除 fork 继承历史。
5. Resume 不采用当前 Team 策略，不向有历史的 Session 调用面向空白会话的 select。
6. 子会话自己的限制留在自身 scope；预设切换不移除 delegated policy。
7. 冷恢复绑定已持久化身份；缺失/损坏的 preset 必须阻止错误身份运行。

## 验收矩阵

- 字段归一化、显式 null、default/session 优先级、错误配置。
- Host RPC unknown/broken/missing-service/unsupported/CAS/取消均零写入。
- 原生弹层可搜索、active 标记、只读、缺失目录、移除预设、冲突、重复提交、换会话、关闭、卸载。
- settings 的独立路径证明 model/effort 与 preset 不会相互抹掉。
- 真实 Cordis + AgentLoop + PresetRegistry 验证所选 preset 的提示词/工具及 created 初始化作用域。
- 真实 Team spawn、fork seed、冷恢复及后续策略变化；有明确的无模型网络 IO 捕获边界。
- 缺少宿主扩展时不能假通过；所有 skip 明确记载，不冒充运行验证。
- 全量旧回归、typecheck、build、dist smoke 和发布包内容。


## 1.5.0-rc.4 标题与保存接口分离

三个用户入口统一为原生 client contribution，由 `label()` 提供中英文标题；Host 不注册同名 slash 命令。面板不再通过 `commands.execute` 保存，而是 `$mount` 本插件公开 Typert Remote 描述符，调用 `remote.teamSettings.preset`。Host 使用公开 Remote 标记及 binding，让 Gateway 解析并验证实时 Agent lookup、参数键集合和取消信号；业务入口继续验证参数类型、预设和配置 revision。

所有修改均在本插件内，不修改 DSH 的 UI 命令注册器或执行核心。旧文字参数操作在 Web 输入层明确拒绝，用户只使用选择面板。模型原有业务逻辑保留在 `teamSettings.model` RPC，便于完整回归，但不新增手动菜单入口。
