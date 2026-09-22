# 1.2.2：安装后重启无法对话的修复报告

## 结论

**已复现、修复并安装 1.2.2。** 当前 `web` profile 的安装管理器返回 `application: applied`；独立 DSH Web 进程的创建、持久化、退出、冷恢复和恢复后对话验证通过。未重启用户当前的 3080 服务。

此次根因是 **1.2.1 的核心 SDK 依赖安装方式破坏了宿主模块单实例边界**，不是模型 API、推理等级 Default 或 persona 文本本身出错。

验证环境：Node 24.21.0；DSH 0.1.6-alpha.2；Linux；profile 使用 `nodeLinker: hoisted`、`autoInstallPeers: false`。

## 1. 可重复的故障链

1. 1.2.1 把 `dsh-agent`、`dsh-scope`、`dsh-system-prompt` 等核心 SDK 显式放入生产 `dependencies`。
2. DSH 的 bundle 清单优先从部署目录读取，但 YAML 中的裸插件行从 **profile 的模块解析位置**加载。本地已经安装的核心包优先于 deployment fallback。
3. 于是全局 `systemPrompt` 注册器可能来自 profile 副本，而官方 `agent-presets` / `agent-loop` 仍从部署目录导入 scope。
4. `dsh-scope` 的标签是模块内的 `Symbol("dsh.scope")`，关联关系也存放在模块内的 WeakMap。两个同版本的包也不是同一个实例。
5. profile 注册器读不到 deployment scope 的标签，把官方 preset 的 scoped persona 误当成 global；global 默认 persona 已存在，所以挂载失败。

真实 Loader 回归首先观察到：

```text
clean control: PASS
installed 1.2.1 topology: FAIL

RemoteError: agent-presets: preset "fixture" failed to mount:
failed to apply loader entry persona (@deepseek-ai/dsh-persona):
prompt section "deployment:persona-prefix" is already registered
(for a per-agent override, register through that agent's `agent.ctx` instead)
```

这里的错误名称按实际运行输出记录，包含冒号 `deployment:persona-prefix`。测试使用独立临时 profile、真实 Loader/runtime resolver/AgentPresets，自建只有 persona 的测试 preset；没有改 shipped preset。

**为什么旧测试没拦住：** 原有 126 项测试把核心 SDK 从同一个 workspace 直接导入，绕过了 profile Loader 的双来源解析。旧打包测试还错误地强制安装这些核心依赖。现在该断言已被相反的所有权约束和真实冷启动回归替换。

## 2. 修复范围

主要修改在 [package.json](../package.json) 及 [锁文件](../package-lock.json)：

- 生产依赖仅保留 `@deepseek-ai/schemastery`。
- `@deepseek-ai/dsh-agent@0.1.6-alpha.2` 声明为 **optional peer**，不触发自动安装另一套核心 SDK。
- DSH / Cordis SDK 作为开发依赖，供类型检查和测试使用。
- 运行时仍复用公开的 `installModelSelection()`，由 DSH 自己的 runtime resolver 提供部署实例。

没有重写模型同步算法，没有硬编码生产安装路径，没有改 scope 实现，没有改官方 preset，也没有通过改名或吞异常规避重复注册。

与原始 1.2.1 tarball 比较，以下产物逐字节一致：`selection-sync`、`pin`、`client`、`model-picker`、`ui-state`、`picker-layout`、Web Host bundle。Host 根入口仅更新了依赖归属的说明注释。原有工作区未提交修改没有被回滚。

## 3. 验证结果

### 自动回归

`artifacts/1.2.2/check.log`：

```text
npm run check
  typecheck: PASS
  build: PASS
  tests: 129
  pass: 129
  fail: 0
  skipped: 0

npm run smoke:dist: PASS
git diff --check: PASS
```

新增回归：

- [cold-start.test.mjs](../tests/cold-start.test.mjs)：干净对照与安装形态；插件必须 active，官方选择器必须是 deployment 的同一个模块实例；global 与两会话 persona 隔离，释放一个会话不破坏另一个。
- [web-restart.test.mjs](../tests/web-restart.test.mjs)：启动两个完整 DSH Web 进程，加载官方 `cordis`，验证真实持久化及冷恢复。此项已纳入 `npm test`。
- [packaging.test.mjs](../tests/packaging.test.mjs)：禁止生产依赖重新安装宿主核心 SDK，要求 optional peer 合约。

没有 DSH 安装的普通开发/CI 环境会明确跳过真实启动测试；本次环境中 **没有跳过**。

### 对实际安装产物进行的独立 Web 验证

使用管理器安装后的实际插件文件，而不是只验证 TypeScript 源码。以其产物构建唯一临时 profile，启用原生 base/Web/Agent Teams bundle 及本插件。两个进程由 DSH 原生 `runProfile()` 启动，各自使用独立 loopback 端口并实际返回带 `__DSH_BOOT__` 的 Web 页面。

`artifacts/1.2.2/web-restart-summary.json`：

| 阶段 | 结果 |
|---|---|
| 新进程 PID 1225 创建 | 官方 `cordis` 挂载成功；Host active；Client 产物被发现；Web HTTP 200 |
| 主测试会话第一次请求 | `main-model / high`，提示词与冻结请求一致 |
| 保存 pin 后下一次请求 | `team-pinned`，清除继承 effort，提示词与冻结请求一致 |
| 第二会话请求 | 仍为 `main-model / high`，未串配置 |
| 完全退出后新进程 PID 1243 恢复 | 从磁盘恢复两条既有 assistant 响应；pin 设置仍在 |
| 恢复后继续对话 | 仍为 `team-pinned`；第二会话继续保持原路由；无 Agent error |
| 模块身份 | Agent / Scope / SystemPrompt / AgentPresets / AgentLoop 均解析到部署目录 |
| 清理 | 两进程退出，临时 profile、设置和会话存储已删除 |

之后完整项目测试再次从新的临时目录重复运行了 Web 创建/冷恢复流程，并通过。

**验证边界：** 模型输出使用实现真实 `LlmAdapter` 协议的本地模拟器，不调用外部供应商。本测试显式在独立 profile 使用 `scope=all` 和两个普通 Agent，避免创建实际 Agent Team 队友；默认 teammates 策略由既有回归覆盖。未把用户的其它第三方插件或私有设置复制到测试 profile。

### 调试中发现并修正的测试夹具问题

最初的 Web 探针发送消息时遗漏了必需的 `source: { kind: 'user' }`。完整 Web 中的 `repeat-tool-reminder` 因此抛出 `TypeError ... reading 'kind'`。补齐符合公开消息合约的 source 后通过，**没有为此改动插件业务代码或官方包**。失败输出分别保存在 `artifacts/1.2.2/web-restart.json` 和 `artifacts/1.2.2/web-restart-trace.json`，没有被后续成功结果覆盖。

## 4. 当前安装与页面状态

- 管理器安装 1.2.2：package manager exit 0，`Packages: +1`，`application: applied`，无 warning 或待批准 build。
- bundle 清单：`@lolkda/dsh-agent-team-model-pin@1.2.2`，installed、enabled。
- 实际 profile 中没有新安装 `dsh-agent`、`dsh-scope`、`dsh-system-prompt`、`dsh-session` 的物理核心副本。
- 当前连接页面 `conversation.input.model`：插件 priority **-100**、active **true**，原生 priority 0 inactive。
- Client registrant 仍为 `agent-team-model-pin-ui-1.1.4`，因为 UI 产物没有变化；Host 1.2.2 的证据来自安装版本和真实冷启动测试，不能用 Client 标记推断。
- 没有重启当前 3080 服务，没有删除用户 settings 或会话，没有发布 npm、提交或推送 Git。

页面验证仅到实时插槽选中；未进行浏览器截图、真实鼠标点选或手机触控验收。

## 5. 复跑命令

在插件项目目录执行：

```bash
npm run check
npm run smoke:dist

# 检查管理器实际安装后的发布产物
DSH_TEST_PACKAGE_ROOT=/app/.dsh/profiles/web/node_modules/@lolkda/dsh-agent-team-model-pin \
  node --test tests/cold-start.test.mjs tests/web-restart.test.mjs

# 单独启动两个隔离的完整 DSH Web 进程，并保存摘要/日志
node scripts/verify-web-restart.mjs \
  /usr/local/lib/node_modules/@deepseek-ai/dsh \
  /app/.dsh/profiles/web/node_modules/@lolkda/dsh-agent-team-model-pin \
  artifacts/1.2.2/recheck.json
```

启动测试通过 PATH 查找 DSH；也可设置 `DSH_TEST_INSTALL_ROOT`。生产插件本身不会探测或硬编码这些路径。Web 验证每阶段最多运行 60 秒，临时资源在 finally 中释放。

## 6. 安装包与其它故障环境的恢复

`lolkda-dsh-agent-team-model-pin-1.2.2.tgz`：19 个文件，44,034 bytes。

```text
SHA-256  3c67addd914af5f33a722011a96543a13d118a1d2c485f7ad8267874d19f308f
npm SHA1 480ea83291bc19da35d42e74eb98937c30d63b93
```

当前环境已经安装激活，无需重复安装。其它仍停留在 1.2.1 的环境，建议通过管理器先移除旧 bundle，再安装 1.2.2，重启该 DSH 并刷新页面；**仅禁用旧插件行不保证移除污染解析的依赖**。移除插件不要求删除用户 settings 或会话。若其它插件也安装了核心 SDK，需要检查其依赖归属，而不是手动删官方 persona 或直接改 node_modules。

`lolkda-dsh-agent-team-model-pin-1.2.1.tgz` 保留未改，SHA-256 为 `3ae9811a7d865e980b4fdd0a16c738f6f1361ad6187cebcfbc0e9005a62f9a9a`。
