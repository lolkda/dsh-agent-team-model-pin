# 1.2.3：Team 模型与推理等级菜单消失修复

## 当前状态

- 修复已打包并安装保存为 **1.2.3**，bundle 为 installed/enabled。
- 安装管理器返回 **`application: restart-required`**：不能声称 Host 已完成新模块代次激活。
- 与上述状态分别观察：当前连接页面的 Client 已实际加载 `agent-team-model-pin-ui-1.2.3`，priority -100、active true；原生 priority 0 inactive。
- 完整 **139/139 tests**、类型检查、构建、Host/Web 入口检查及 diff whitespace 检查通过，无 skipped。
- **用户随后明确确认“出现了”**，确认 Team 菜单已恢复显示，并要求启动真实 Team 队友核验模型。实际选择及保存未在该回复中逐项确认；插槽 active 不单独构成可见 UI 验收。
- 未重启当前 DSH，未删除或迁移任何 settings、会话数据。

## 1. 原因与证据

用户截图只有“模型／推理等级”两项。只读查询发现旧 Client 虽然仍登记在插槽账本中，但已经 `active: false`，原生菜单接替为 `active: true`。

DSH 的 Slot renderer 在组件渲染或 inject factory 出错后会将该注册标记为 `abdicated`，然后选择下一个仍存活的控件。因此仅检查注册、优先级或注册瞬间 active，会漏掉后续渲染错误。

[原 Client 调用路径](../src/client.ts) 在渲染时访问 `modelDirectories.directoryFor(sessionId)`。原生目录在缓存未命中时会访问 `this.ctx.remote.session`，但插件仅声明了 `remote`、`remote.settings`、`remote.agentTeams`，漏了独立受保护的 `remote.session`。

真实 Cordis 与原生模型目录的独立内存对照结果：

```text
原依赖声明                cannot get property "remote.session" without inject
仅增加 remote.session     OK
仅增加 sessions           仍报 remote.session without inject
```

随后使用真实 SlotRegistry/renderer、原生目录与原生回退组件复现了完整过程：

```text
key: conversation.input.model
registrant: agent-team-model-pin-ui-1.1.4
message: Error: cannot get property "remote.session" without inject
abdicated: true

插件 active: false
原生 active: true
```

首次新增的 9 项原生集成回归中，8 项正常行为测试失败于这一错误，故意缺依赖的反例通过。热缓存下首次渲染能通过，但切换到新的冷会话再次失败。

页面历史 Console 原始堆栈未被采集；上面的异常来自独立真实组件调用链复现，不冒充页面日志。

## 2. 最小生产变更

- [client.ts](../src/client.ts)：补充 `remote.session`；Client registrant 更新到 1.2.3。
- 同文件两处原生目录 `load()` 调用消费 Promise rejection。原生目录仍通过 store 发布可见错误，界面继续显示错误与重试；没有将请求失败当成功。
- [model-picker.ts](../src/model-picker.ts)：DOM 标记改为 `data-team-model-pin="1.2.3"`；没有调整布局、颜色或优先级。
- [package.json](../package.json) 和 [锁文件](../package-lock.json)：版本 1.2.3；新增的 Client store、Zustand、Immer 仅用于开发测试。

没有新增 Service、Remote API、设置字段或迁移。Team 仍按 LeadSessionId 和 revision 写原 namespace；主模型仍走原生目录。

与 1.2.2 tarball 比较，Host 根入口、Web Host 入口、selection-sync 和 pin 的 JS 产物 **逐字节相同**。1.2.2 的 optional-peer 核心 SDK 边界保持不变，未再次安装第二套核心 SDK。

## 3. 原生回归覆盖

[新增测试](../tests/native-client.test.mjs) 与 [测试夹具](../tests/fixtures/native-client.mjs) 使用实际发布的原生 ModelDirectoryResolver、SlotRegistry/renderer、原生回退菜单，以及真实 Cordis、React DOM 和 Client snapshot store。

仅远程传输、会话保留/投影 IO、语言数据与 SVG 图形是明确的夹具，不再假造 `directoryFor()` 来绕过模型目录依赖。RPC 夹具也进行了真实传输边界等价的结构克隆，避免把 VM 对象原型差异误判为业务错误。

10 项新增回归覆盖：

1. 冷目录首次创建后，插件继续存活且四项菜单可见。
2. 热缓存后切换新会话，仍不退出。
3. 故意移除 `remote.session`，真实 renderer 撤下插件并由原生控件接回。
4. Team 模型与 effort 保存、会话切换与设置隔离。
5. 主模型选择仍调用真正的共享模型目录。
6. 只读状态保留 Team 行并禁用。
7. settings RPC 失败显示错误，不退出组件。
8. 模型目录失败显示错误且没有未处理的 load rejection；该测试先复现失败再加入 rejection 消费。
9. CAS 冲突不假装保存成功。
10. 卸载恢复实际原生控件。

完整结果见 `artifacts/1.2.3/check.log`。对管理器实际安装产物另跑的 **13/13 原生 Client、persona 冷启动和完整 Web 恢复测试**也全部通过，见 `artifacts/1.2.3/installed-check.log`。这些独立进程测试中的模型网络输出是本地模拟，不是实际供应商请求。

## 4. 安装与浏览器验收边界

管理器安装结果：

```text
package exitCode: 0
Packages: +1
bundle: @lolkda/dsh-agent-team-model-pin
saved version: 1.2.3
enabled: true
application: restart-required
```

随后单独读取当前页面插槽，得到：

```text
agent-team-model-pin-ui-1.2.3  priority -100  active true
native                       priority    0  active false
```

这证明新的 Client 注册已到达页面，但不能代替用户实际展开、选择、刷新后检查。随后用户明确确认“出现了”；再次实时检查仍为 1.2.3 active true，并按用户要求完成了下方真实 Team 核验。当前 Host 仍按管理器报告保留 restart-required 状态；因 Host JS 与 1.2.2 完全相同，此次新增修复在 Client，但不将整包状态虚报为 applied。

## 5. 复跑

在插件项目目录执行：

```bash
npm ci
npm run check
npm run smoke:dist

# 针对管理器实际安装的候选包
DSH_TEST_PACKAGE_ROOT=/app/.dsh/profiles/web/node_modules/@lolkda/dsh-agent-team-model-pin \
  node --test tests/native-client.test.mjs tests/cold-start.test.mjs tests/web-restart.test.mjs
```

原生集成测试通过 PATH 查找 DSH，也可指定 `DSH_TEST_INSTALL_ROOT`。无 DSH 的环境明确 skipped，不能拿跳过结果作为生产渲染验收。

## 6. 安装包

`lolkda-dsh-agent-team-model-pin-1.2.3.tgz`：19 个文件，44,726 bytes。旧包保留，不发布 npm，不提交或推送 Git。

```text
SHA-256  d1abf6c8fc88e2af8b907c3f59cc3bc731ea60a6387107ec476fe31dc20846be
npm SHA1 abe9365351fed0e1ed5c2686b415bf28ad6316d2
```

## 7. 用户要求的真实 Team 核验

用户确认菜单“出现了”后，明确要求拉起一个 Team 队友询问模型。创建了只读队友 `team-model-check`，共享任务 `task-1`；队友未更改文件、配置或模型选择。

| 项目 | 结果 |
|---|---|
| 队友 ID | `9f17a5a7-1f16-4422-8be5-6328e75ab966` |
| 队友从注入运行时上下文报告的模型 | `deepseek-flash` |
| 队友报告的 provider | `cpa` |
| Host 请求审计中的模型 | `deepseek-flash` |
| Host 请求审计中的 provider | `cpa` |
| Host 请求审计中的 reasoningEffort | `high` |
| 审计记录数 | 6 |
| 任务 | `task-1`，revision 3，completed |
| 队友最终状态 | inactive，已完成，无 diagnostics |

首条审计时间 `2026-09-22T14:43:38.418Z`，从继承的 `cpa / gpt-6-astra` 改为 `cpa / deepseek-flash / high`；后续五条保持同一路由。最后一条为 `2026-09-22T14:43:56.544Z`。这证明当前 Team 策略进入了真实队友的请求链，而非只有菜单或注册状态变化。队友收到的模型身份提示与 Host 审计一致。

`artifacts/1.2.3/team-check-audit.jsonl` 仅保留该队友的六条原始 JSONL 行，原审计文件未修改。

`list_agents` 仍显示构造期 `gpt-6-astra`，属于既定显示限制，不是实际请求模型。本插件没有修改该字段；判断实际选择以请求审计为准。这次真实 Team 核验与第 3 节的离线模拟测试分开记录，不混用证据。
