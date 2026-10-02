# DSH continuable child setup v1 — 宿主扩展候选

**这不是原版 DSH 已提供的接口，也不是自动安装脚本。** 插件 1.5.0-rc.1 的新建队友预设选择需要本扩展或语义等效的宿主升级；未扩展的宿主会拒绝预设保存，已有模型功能不受影响。

## 为什么不在 agent/created 中修改

Cordis 在调用第一个 `agent/created` 监听器前就已按旧 scope 筛选了回调列表。此时换 preset，即使赶在模型首轮前，也可能执行旧预设的初始化并漏掉目标预设的初始化。本补丁把可等待的 composition 钩子放在 **未发布的 continuation child setup** 内，先完成预设绑定，然后才发布 Session/Agent。

## 补丁内容和边界

- 基线：`@deepseek-ai/dsh-subagent@0.2.0-rc.2` 的 npm 包。`dsh-subagent-child-setup-v1.baseline.json` 记录每个修改文件的修改前/后 SHA-256。
- 公开 `subagents.childSetupVersion === 1`、`registerChildSetup(callback)`。
- 回调接收 `{childCtx, child, parent, source, signal}`，在原生 delegation composition 之后、发布之前 awaited 执行。可返回同步 `{commit()}`，保留取消和 owner 卸载的最终验证。
- 不替换 Agent factory，不重新派发 `agent/created`，不修改运行中的服务方法，不修改权限记录。
- 冷恢复从子会话自己的 `agent-preset/selected` 后缀读取身份，header 为后备；排除 fork 父历史。即使选择插件已卸载，宿主仍按该身份恢复。找不到预设时拒绝恢复，不回退。
- 钩子适用于 continuable child；插件自行过滤 Team roster，普通 subagent 不采用 Team 配置。
- 恢复逻辑仍经过原生 `applyChildComposition` 的限制检查。历史 toolFilter 与父 preset 的工具名称不一致时，可能保守地拒绝恢复，绝不因此放宽过滤。
- Team 协作工具应采用 DSH 标准 **Host 层** `dsh-experimental-tool-agent-team` 安装方式；不能要求目标 preset 包含任意旧 preset 的私有工具。本插件不会从旧 preset 偷复制工具。
- 持久化的是 preset ID，不是完整插件代码/YAML 的永久快照；同名预设升级遵从宿主原有语义。

## 人工应用前检查（维护者操作）

1. 在隔离的 DSH 安装副本中确认包名、版本和每个文件的 `beforeSha256`。不要仅凭版本号认为字节一致。
2. 在该包根目录先执行 dry-run；若任何 hunk 有偏移、模糊匹配或拒绝，不要继续：

   ```bash
   patch --dry-run --fuzz=0 -p1 < /absolute/path/dsh-subagent-child-setup-v1.patch
   ```

3. 经维护者审查后，才对隔离副本应用并运行测试：

   ```bash
   patch --fuzz=0 -p1 < /absolute/path/dsh-subagent-child-setup-v1.patch
   ```

4. 核对所有 `afterSha256`，测试创建/恢复、权限与工具，然后决定部署。运行中的生产 DSH 不应直接热补丁。部署需要重启宿主，再刷新 Web。
5. 回滚优先恢复完整的原始包并重启；若还有使用指定预设的队友，不要让旧宿主静默恢复为 Lead 的预设。先保留日志并评估恢复兼容性。

本仓库开发时**没有执行上述生产安装或重启**。

## 可复现开发验证

仓库内 `tests/fixtures/preset-host-extension.mjs` 从原 SDK 复制隔离测试包并执行精确、唯一的源码标记变换；它不修改 node_modules 的原包，也不 monkeypatch live 实例。测试加载这份真正的扩展后服务。

```bash
node scripts/generate-child-setup-patch.mjs   # 仅重建补丁/哈希文件
node --test tests/preset-host-extension.test.mjs tests/preset-runtime.test.mjs
npm run check
```

补丁同时覆盖 bundle、模块化 JS 和类型声明。测试包括真实 Cordis/Loader/PresetRegistry/AgentLoop/Agent Teams/JSONL 持久化路径；模型 IO 为可取消的捕获边界，不调用付费模型。
