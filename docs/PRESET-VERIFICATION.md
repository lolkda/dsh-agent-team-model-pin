# 1.5.0-rc.1 预设功能候选验收

## 交付状态

本报告记录发布前验收：实现、宿主补丁候选、回归测试及本地 npm 包已生成。验收时尚未发布 npm、安装到用户 Profile 或重启用户服务；测试没有修改正在运行的 DSH。后续发布与部署状态以工作流和实际安装版本为准。

**原版 DSH 0.2.0-rc.2 不具备本功能需要的创建前接口。** 此版本必须配合 `patches/` 的显式宿主扩展或等效升级；未经扩展的宿主只能继续原有模型功能，预设保存明确失败，不虚报生效。

## 验证边界

- 使用项目固定版本的真实 Cordis、Loader、PresetRegistry、AgentLoop、TeamService、原生 Team 工具及 JSONL 持久化后端。
- 宿主扩展通过隔离的真实 npm 包副本加载；原 node_modules SDK 和全局运行安装没有被补丁修改。
- 实际验证了指定 preset 的 scoped `agent/created` 初始化，而不只是检查 Session 中存在一个字符串。
- LLM IO 为可取消的请求捕获边界，没有调用付费模型或用生成文本冒充验证。
- 浏览器菜单使用现有真实 DSH 原生弹层/controller 的 jsdom 集成测试；旧 Web 进程重启用例仍通过。本轮没有声称已部署到用户的浏览器。

## 覆盖

- Host 命令、配置优先级、独立路径、显式 null、未知/损坏 preset、缺失能力、权限只读、CAS、取消、零写入。
- Native `/team-preset` 搜索、标记、错误面板、键盘、子会话 Lead 地址、不支持的 Host 和目录变化。
- fresh、带已结束 Lead turn 和旧 preset 记录的 fork、冷恢复、修改未来策略不影响旧队友。
- 卸载选择插件后，宿主仍能按原持久化身份恢复；预设删除后拒绝错误身份恢复。
- 目标 preset 工具与提示词可见，旧 preset 工具不可见；原生 `send_message` 等 Host Team 工具保留。
- 子 Agent 的 `approval/policy=never`、sandbox 和 permission preset 委托记录保留。
- 普通非 Team continuable child 不读取 Team 策略。
- 完整插件同时启用 preset 和 model/effort，真实 Team child 的新 preset 与实际请求路由均正确。
- 宿主钩子的取消、owner 卸载、异步准备、同步 commit、错误回滚以及注册集合快照。
- 补丁零偏移/零模糊匹配应用，结果字节与实际测试的候选包及 SHA-256 清单一致。

## 本次结果

- `npm run check`：类型检查、构建成功；**247 项测试通过，0 失败、0 跳过**。
- `npm run smoke:dist`：Host/Web 入口及浏览器产物语法通过。
- `git diff --check`：通过。
- 本地 npm 包包含 28 个文件，包括宿主补丁、基线哈希及人工应用说明；没有把核心 SDK 打进生产依赖。

## 复现命令

```bash
npm run check
npm run smoke:dist
node scripts/generate-child-setup-patch.mjs
node --test tests/preset-host-extension.test.mjs tests/preset-runtime.test.mjs
npm pack --ignore-scripts --pack-destination artifacts/preset-1.5.0-rc.1
```

本地候选包：`artifacts/preset-1.5.0-rc.1/lolkda-dsh-agent-team-model-pin-1.5.0-rc.1.tgz`，SHA-256 见同目录 `SHA256SUMS`。该目录不纳入 Git。

## 1.5.0-rc.2：RPC 代理身份误判修复

- 原用例只把 Remote facade 做成 Service，命名空间仍为普通对象，漏掉了实际 SDK 每次读取命名空间都会产生新代理的行为。
- 将命名空间改为真实 Cordis Service 后，未修复版本可稳定复现「会话或菜单状态已变化」；修复后可以加载和保存，服务卸载/重挂仍会正确拒绝旧选择。
- 在真实原生命令弹层中新增可追踪命名空间回归。
- `npm run check`：**248 项测试通过，0 失败、0 跳过**；`npm run smoke:dist` 通过。
- 不改变宿主扩展要求，不改动用户的 preset/model/effort 配置。
