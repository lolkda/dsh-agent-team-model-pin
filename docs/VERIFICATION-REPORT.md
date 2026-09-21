# 独立验证报告 · dsh-agent-team-model-pin

| 项 | 值 |
|---|---|
| 验证人 | `verifier`（Agent Team teammate，独立于实现者） |
| 首次验证 | 2026-09-21T20:04:55Z（2026-09-22T04:04:55+0800） |
| 复核更新 | `task-7`（2026-09-21T20:16Z 前后；新增 `tests/command.test.mjs` + 破坏性抽检，见 §10）<br>`task-8`（2026-09-21T20:19Z；仅文档：README 版本引用对齐 + 指纹刷新）<br>`task-9`（2026-09-21T20:44Z 前后；npm 发布形态复核 + 打包验证，见 §11）<br>**`task-10`（2026-09-21T20:57Z 前后；`prepare` 修复复核 + e2e#2 证据核对，见 §12）** |
| 契约源 | [`docs/SPEC.md`](SPEC.md) **v1.3** + §9 裁定 v1.1/v1.2/v1.3（`sha256 f3b28b32…d176e`；§6 脚本清单现已含 `prepare`） |
| 验证对象 | 包内全部非 `node_modules` 工件：`src/`、`tests/`、`dist/`、`package.json`、`package-lock.json`、`tsconfig.json`、`tsconfig.build.json`、`cordis.patch.yml`、`.gitignore`、`LICENSE`、`.github/workflows/*`、`docs/`、`README.md` |
| 运行时 | Node `v24.21.0`（`process.features.typescript === 'strip'`）；npm `11.19.0`；tsc `7.0.2`（现为包内 devDependency） |
| 独立性 | 本次验证**未修改任何实现文件**；只写本报告与 [`README.md`](../README.md) |

> **变更历史**
> - 首版报告基于 `task-5` 修复后的工件（SPEC v1 + §9 v1.1/v1.2 裁定）。
> - `task-7`：SPEC 修订为 v1.2，新增 `tests/command.test.mjs`；`src/` 两个文件 hash 未变，故 §4–§9 结论继续成立。
> - `task-8`：仅文档（README 版本引用对齐 v1.2 + 指纹刷新）。
> - **`task-9`（结构性变更）**：插件由「零构建本地 bundle」改造为**可发布到 npm 的公开包** —— 包名 `@local/…` → `@lolkda/…`、入口 `src/index.ts` → 构建产物 `dist/index.js`、`schemastery` 由 peer 改为 dependency、SPEC 重写 §6 并新增 9.13–9.15。**关键事实：`src/pin.ts`、`src/index.ts`、`tests/pin.test.mjs`、`tests/command.test.mjs` 四项 hash 与首版逐字相同**，故 §3–§9 关于行为契约（第 4–7 节）的全部结论**无需重开**；新增的打包/发布维度见 §11，指纹见下方「冻结工件」。
> - **`task-10`（收尾）**：修掉 §11.5 报的打包陷阱（`package.json` 新增 `prepare`，SPEC §6 同步）；并在**新形态下重跑队友 e2e**（e2e#2，见 §12.2）。**仅 `package.json`（+`prepare`）、`docs/SPEC.md`（§6 一行）、`README.md`（同步 `prepare` 与打包说明）三个文件变化；`src/`、`tests/`、`tsconfig*`、`cordis.patch.yml`、`.github/**`、`dist/*` 全部未变。**

## 冻结工件（本次结论只对这些字节有效）

复核后（`task-10` 收尾，2026-09-22 04:57 +0800）包内全部工件的 `sha256`：

```
# —— 行为实现与测试（自首版起逐字未变）——
f966c02cdd8b73b7de512fe2bb9f6f579f75ae2050e1df9d7575d59ec47df2a2  src/pin.ts
be85f9ec7738de7b560a320f7aaf4bf751cf046518ece8017d4699d7a318dc48  src/index.ts
14481df1bf972b6867a6b57851a27024b82bdbed061a64edbf21f028269dbc93  tests/pin.test.mjs
3be211c1310c0625632349950eacd9d21511cea36d8ebc9d97ead4483a67c176  tests/command.test.mjs

# —— 发布形态 ——
ec086d4a227240bd37b9539f6fd83eab4aed9fc828ffc745decc1b41c88c7219  package.json          ← task-10 加 prepare
3de74c5f75b3109ef3375b20f4a59d4f7922fde20d3acd99531ec3ffb3fdbdf1  package-lock.json
b6b1cac6029f31c6d7537ccbc45f38ca794e40bf82ffd5d898a0977d8df2f491  tsconfig.json
28c3fc96952ca393208a697c67149997c14bcf4f5719f8be554d0e46c02e530c  tsconfig.build.json
8b3d4c09bd327d2b0654984fda0bab555561957c54a509d7a8c95f13c919fdf5  cordis.patch.yml
2e4ead25137262ecfba05a235acfc8d30acfadf76ae2125cfbbd4b4a2cb76194  .gitignore
f7278ab9030ddf47f9bf91c5b244fc6b887d659c6055a2f7b95485ab35fd72e1  LICENSE
8f866271f5805cbf891bcb73d8feb2a3d453253d94b14b3a1a47fa49f573f68d  .github/workflows/ci.yml
f887eebea19111b5fb638503120650d7be45b050723a36a193bdba28900a2745  .github/workflows/release.yml
71c9f1f3ed584fa39dbb415fd7fca7d49f75b37797eb0d7a350c12d2354ceced  dist/index.js
81d9536d401e52cfb07c25b02f8605b8103af8e01159b4b2ca5e2acf50ecc2bb  dist/index.d.ts
576e7100b778a9e0dd3674809850de8b53c1c0aaa8414f235d5edd47e7d8338b  dist/pin.js
a06b756f5d0b1db6f0ef41142355f9b3ca27d5ae41c3014dce3e143985f2d850  dist/pin.d.ts

# —— 文档 ——
f3b28b32a13f988dd044bdb1090b5cfe6b8ef19b66eed4f8c8cf05e7915d176e  docs/SPEC.md          ← task-10 §6 加 prepare
85188b44ade46ede5623036c50b5521fb7f1d5d63d8a8cc9a06912fce0aaee94  README.md             ← task-10 同步 prepare + 打包说明
```

> 本文件（`docs/VERIFICATION-REPORT.md`）**不列入上表**：一个文件无法包含自身的最终 hash（自指）。本段编辑前的上一版为 `sha256 472277e433ccda8083a2a7fc2625e4b7254d5dc2fb056b6dd10861131c4ec710`；上表因此覆盖包内 19 个非 `node_modules` 工件中的 18 个。

**`task-10` 变更摘要（仅 3 个文件，实现与产物零变化）**

| 工件 | 变化 | 说明 |
|---|---|---|
| `package.json` | `b58b9751…82a0` → `ec086d4a…7219` | **仅新增 `"prepare": "npm run build"`** |
| `docs/SPEC.md` | `fdb4ffc1…8377` → `f3b28b32…d176e` | **仅 §6 脚本清单那一行**加入 `prepare` 并说明其覆盖面 |
| `README.md` | `8e1c3a17…7934` → `85188b44…ee94` | 同步 `prepare` 到脚本表 + 重写「打包」段（陷阱已修） |
| `src/*`、`tests/*`、`tsconfig*.json`、`cordis.patch.yml`、`.gitignore`、`LICENSE`、`.github/**`、`dist/*` | **未变**（hash 逐字相同） | 实现、测试、构建配置、产物均未动 |

**`task-9` 变更摘要（结构性，非文档）**

| 工件 | 变化 | 说明 |
|---|---|---|
| `src/pin.ts`、`src/index.ts`、`tests/*.mjs` | **未变**（hash 逐字相同） | 行为实现完全未动 |
| `package.json` | `854c0361…985b` → `b58b9751…82a0` | 改名 / 去 `private` / exports 指向 dist / schemastery 转 dependency / 新增 devDeps+scripts+publishConfig+repository |
| `cordis.patch.yml` | `b48a25f3…d3f2` → `8b3d4c09…fdf5` | 行内 `name` 改为 `@lolkda/dsh-agent-team-model-pin` |
| `tsconfig.json` | `370cae1c…b4bf` → `b6b1cac6…f491` | `types` 由 `[]` 改为 `["node"]` |
| `docs/SPEC.md` | `ddc4a7ce…e6e6` → `fdb4ffc1…8377` | v1.2 → **v1.3**：重写 §6、新增 9.13–9.15 |
| 新增 | `dist/*`、`tsconfig.build.json`、`.gitignore`、`LICENSE`、`package-lock.json`、`.github/workflows/*` | 发布形态基础设施 |

**`task-10` 复跑**（工作区；`src/`+`tests/`+`dist/` 均未变）：

```
$ node --test tests/*.test.mjs        ℹ tests 59 / pass 59 / fail 0
$ npm run typecheck                   [exit=0]（无输出）
$ npm run build                       [exit=0]
$ npm run smoke:dist                  dist entry OK: agent-team-model-pin ["agentTeams","commands"]
```

> **顺带修复的环境问题**：首版 §8.3 记录的「裸跑 `tsc` 会报 5 条 `node:*`/`AbortSignal` 噪声」在 v1.3 下**已消失**——`@types/node` 成为 devDependency 且 `tsconfig.json` 声明 `types: ["node"]` 后，`tsc -p tsconfig.json` 无需 `--typeRoots` 变通即 exit 0 且无输出。SPEC 9.12 记录的限制在新形态下已解除（见 §8.4）。

---

## 1. 结论摘要

**结论：通过（0 个偏离项），附 9 项未验证项。**

| 检查 | 结论 |
|---|---|
| C1 单元测试复跑 | **通过** 59/59（`pin.test.mjs` 34 + `command.test.mjs` 25），0 失败 |
| C2 SPEC 7.1 A1–A7 覆盖 | **通过** A1–A7 全部有用例（共 32 例）+ 2 例额外覆盖（`pin.test.mjs`） |
| C3 静态核对 5.1/5.2/5.3/5.4/5.5/§6 | **符合**（逐项 24 条，见 §4）；§6 已按 v1.3 重写，新增发布形态维度见 §11.1 |
| C4 反向检查（§2 明令禁止项） | **通过** 9 项全部未违反（`src/` hash 未变，故结论不变） |
| C5 边界核对 | **通过** 5/5；其中 4 项已由 `command.test.mjs` 转为**运行时**证据（见 §10.2），仅 `agentTeams` 缺失负例仍只剩代码证据 |
| C6 安装态核对 | **通过** 行 `include:agent-team-model-pin` 为 `active`，模块名现为 `@lolkda/dsh-agent-team-model-pin`；开发期**手工符号链接已取消**（schemastery 为包内真实目录，见 §11.1） |
| C7 类型检查（含 task-5 修复复核） | **通过**：v1.3 下 `tsc -p tsconfig.json` **无需 `--typeRoots` 变通即无输出 exit 0**（首版记录的 5 条环境噪声已消失，见 §8.4） |
| C8 端到端证据交叉核对 | **通过（已在新形态下补测）**：`audit.jsonl` 6 行 —— 前 3 行来自改名前 `@local` 的 e2e（证明**模型切换** `deepseek-flash → gpt-6-astra`），后 3 行来自 `task-10` 的 e2e#2（`@lolkda` + dist 入口，证明 **effort 改写** `high → low`）。见 §9、§12.2 |
| C9 新增 handler 测试复核 + 破坏性抽检（§10，task-7） | **通过**：10/10 要求逐条命中；3 个注入缺陷**全部**令测试变红，其中 test 4 的零写入断言与 test 6 的零写入断言各自独立生效 |
| C10 npm 发布形态复核 + 打包验证（§11，task-9） | **通过**：构建可复现（4 个 dist 文件重建前后 hash 逐字相同）；tarball 恰 8 个文件、`src/tests/docs/.github` 全部不在内；9.14 的 d.ts 说明符独立复现成功 |
| **C11 收尾复核：`prepare` 修复 + e2e#2**（§12，task-10） | **通过**：打包陷阱**已修**（`prepare` 让 `rm -rf dist && npm pack --dry-run` 自动重建、仍 8 文件）；e2e#2 证据字段逐条核对一致；中性状态已恢复 |

**偏离项清单：无。** 详见 §13。

### 首版两点观察（均已被 Lead 处理，不再是观察项）

1. ~~`docs/SPEC.md:5` 版本行仍写「版本：v1」~~ → **已修**：v1.2 时同步为「版本：v1.2（TS + 零构建；…）」；v1.3 又改为「版本：v1.3（源码 TS + 发布构建产物；v1.1/v1.2/v1.3 的裁定见第 9 节）」（`docs/SPEC.md:5`）。
2. ~~`docs/SPEC.md:226` A6 行写「前四者解析正确，后两者 `invalid`」~~ → **已修**：现为「前五个形态分别解析为 `show`/`show`/`clear`/`set`/`set`；后两者 `invalid`」。

### `task-9` 引入、`task-10` 已关闭的风险观察

1. ~~**`dist/` 不在 git 里，且没有 `prepare`/`prepack` 脚本**~~ → **已修（`task-10`）**。Lead 加了 `"prepare": "npm run build"`（不是 `prepack`——`prepare` 同时覆盖 `npm install`/`npm ci`/`npm pack`/`npm publish`/git 安装，覆盖面更广），SPEC §6 脚本清单同步。**我独立复现确认陷阱消失**：`npm ci && rm -rf dist && npm pack --dry-run` → `prepare` 自动重建 → `total files: 8`（含 4 个 `dist/**`），exit 0。详见 §12.1。
2. ~~**profile 里残留孤儿符号链接** `node_modules/@local/dsh-agent-team-model-pin`~~ → **已清理（`task-10`）**。实测 `ls /app/.dsh/profiles/web/node_modules/@local/` → `No such file or directory`。
3. **`prepare` 带来的新边界（已知、非缺陷）**：若**连依赖都没装**（刚 clone 完直接 `npm pack`），`prepare` 里的 `tsc` 不存在 → `npm pack` **明确报错退出**（`sh: 1: tsc: not found`，`npm error code 127`），不会静默产出空壳包。这比修复前「静默 4 文件 tarball」更安全；先 `npm ci`/`npm install` 即可。已在 README §6 与 §12.1 记录。

---

## 2. C1 单元测试复跑

**命令**（工作目录 `dsh-agent-team-model-pin/`；v1.3 起 `npm test` 就是同一条命令）

```
node --test tests/*.test.mjs      # 等价于 npm test
```

**原始输出（尾部，复核后 = 首版 `pin.test.mjs` + 新增 `command.test.mjs`）**

```
✔ A7 a pin that sets nothing is a no-op (0.20324ms)
ℹ tests 59
ℹ suites 0
ℹ pass 59
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 784.480216
```

**分文件用例数**（`grep -c "^test("`）

| 文件 | `test(` 数 | 单独复跑 |
|---|---|---|
| `tests/pin.test.mjs` | 34 | `tests 34 / pass 34 / fail 0` |
| `tests/command.test.mjs` | 25 | `tests 25 / pass 25 / fail 0` |
| 合计 | **59** | `tests 59 / pass 59 / fail 0` |

**结论：通过。** 59 例全部通过，0 失败、0 跳过。首版报告的 34 例在新文件加入后**一条未减、一条未放宽**（§10.3 已核对）。

**v1.3 补充**：`task-9` 改了入口与打包，但**测试仍是加载源码 `src/*.ts`**（靠 Node type stripping），因此单测覆盖的是源码而非 `dist/`。发布产物的入口由 `npm run smoke:dist` 单独把关（§11.2）；在**临时副本**里从零 `npm ci` + `npm run build` + `npm test` 也得到同样的 59/59（§11.2）。`task-10` 的复跑同样为 59/59（工作区与副本各一次，§12.4）。`tests/` 两个文件 hash 自首版起逐字未变。

**顺带核对（测试的自我约束）**：`tests/command.test.mjs:151-161` 内置了护栏，断言任何用例的 `auditPath` 必须位于 `tmpdir()` 下且**不得**以真实 `$DSH_HOME` 开头，避免测试污染 e2e 审计证据。复核时实测 `/app/.dsh/agent-team-model-pin/audit.jsonl` 仍为 3 行、内容与 §9.1 逐字一致（`sha256 a1812c7d…3d0b0`），说明该护栏有效——`task-9` 的复核也再次确认该文件未被扰动。

---

## 3. C2 SPEC 7.1 A1–A7 逐条覆盖映射

`grep -o "^test('[^']*'" tests/pin.test.mjs` 统计：A1=4、A2=1、A3=4、A4=3、A5=6、A6=6、A7=8，合计 32；另有 2 例非 A 编号用例 → 32+2=34，与测试总数吻合。

| # | SPEC 场景 | 对应测试用例名（逐字） | 覆盖 |
|---|---|---|---|
| A1 | `scope=teammates`，role=teammate / lead | `A1 scope=teammates pins role=teammate and leaves lead unpinned`；补充：`A1 scope=members pins lead and teammate, not non-members`、`A1 scope=all pins every agent key, including non-members`、`A1 no configured layer anywhere yields undefined` | 覆盖（含 members/all/无层 三个补充态） |
| A2 | 会话 A 有钉、会话 B 无 | `A2 pin set for session A does not leak into session B` | 覆盖 |
| A3 | `defaults` + session 层只写 `model` | `A3 defaults plus session layer writing only model keeps lower provider and effort`；补充：`A3 config session layer overrides defaults field by field`、`A3 blank field in a higher layer counts as unset and falls through to the lower layer`、`A3 a layer that exists but pins nothing is equivalent to no layer` | 覆盖 |
| A4 | 运行期层覆盖 Composition 层；clear 后回落 | `A4 live session layer wins over composition session layer, field by field`、`A4 after clear (live layer for that session is undefined) resolution falls back to composition`（同时断言 `undefined` 键与被删键两种回落路径）；补充：`A4 a live pin on another session does not affect this session` | 覆盖 |
| A5 | 仅改 effort / 仅改 model | `A5 pin giving only effort keeps the inherited provider and model`、`A5 pin changing only the route discards the inherited reasoningEffort`；补充：`A5 pin changing only the route keeps the untouched fields of the call config`、`A5 pin giving route plus explicit effort keeps that explicit effort`、`A5 applyPin leaves unrelated call-config fields untouched and does not mutate its input`、`A5 applyPin on an empty pin returns an equivalent config` | 覆盖 |
| A6 | `/team-model`、`show`、`clear`、`a b`、`a b c`、`a`、`a b c d` | `A6 empty input and "show" both mean show`（覆盖空输入 + `show` + 空白 `show`）、`A6 "clear" means clear`、`A6 two and three tokens mean set (provider+model, provider+model+effort)`（覆盖 `a b`、`a b c`）、`A6 one token (non-keyword) and four tokens are invalid with a displayable message`（覆盖 `a`、`a b c d`）；补充：`A6 invalid input never carries a provider/model payload (zero-write precondition)`（含 9.4 的 `clear me`）、`A6 mutationFor maps set/clear onto the [sessions, sessionId] settings path` | 覆盖（7 个形态全部有断言） |
| A7 | `assertRouteSelectable`：未知 provider / 未知 model / 非法 effort / 合法三元组 | `A7 unknown provider is rejected`、`A7 unknown model is rejected`、`A7 effort the model does not publish is rejected`、`A7 a legal provider/model/effort triple resolves without throwing`；补充：`A7 explicit effort on a model publishing no reasoning block is rejected`、`A7 provider-only pin needs no model catalogue entry, model-only pin validates against fallback`（含 9.1/9.2 裁定）、`A7 effort-only pin is validated against the fallback route`、`A7 a pin that sets nothing is a no-op` | 覆盖 |

A7 使用手写假 `LlmLike`（`tests/pin.test.mjs:19-46`），全程不连真实 `llm` 服务；`rejectionMessage` 辅助函数断言抛出的必须是 `Error` 且 `message` 非空可展示（`tests/pin.test.mjs:48-58`），对应 SPEC 5.1「抛出的 Error.message 必须是可直接展示给用户的一句话」。

**缺失场景：无。A1–A7 全部覆盖。**

---

## 4. C3 静态核对（实现 vs SPEC）

### 4.1 SPEC 5.1 `src/pin.ts` 导出名与签名

| 契约项 | 证据 | 结论 |
|---|---|---|
| `export type Scope` | `src/pin.ts:4` `'teammates' \| 'members' \| 'all'` | 符合 |
| `export type Pin` | `src/pin.ts:5` `{ provider?, model?, reasoningEffort? }` | 符合 |
| `normalizePin(raw: unknown): Pin \| undefined` | `src/pin.ts:15` | 符合 |
| `resolvePin(input: {scope, defaults?, configSessions?, liveSessions?, sessionId, role?})` | `src/pin.ts:57-64`，字段名与可选性逐一相符 | 符合 |
| `applyPin<T extends {provider: string; model: string; reasoningEffort?: string}>(config: T, pin: Pin): T` | `src/pin.ts:75-78` | 符合 |
| `CommandPlan` 四分支 | `src/pin.ts:93-97`（`show` / `clear` / `set{provider,model,reasoningEffort?}` / `invalid{error}`） | 符合 |
| `parseCommandInput(rawInput: string): CommandPlan` | `src/pin.ts:101` | 符合 |
| `PinMutation` | `src/pin.ts:120-122` `set{op,path,value}` / `unset{op,path}` | 符合 |
| `mutationFor` v1.2 可判别联合签名 | `src/pin.ts:127-132`：`\| { action: 'set'; provider: string; model: string; reasoningEffort?: string } \| { action: 'clear' }` | 符合（与 SPEC 5.1 v1.2 逐字一致） |
| `mutationFor` 语义：set → `['sessions', sessionId]`，clear → unset 同路径 | `src/pin.ts:133-137` | 符合 |
| `describePin(pin: Pin \| undefined): string`；无钉时明确「未设置」 | `src/pin.ts:141`；`src/pin.ts:143` 返回 `当前会话未设置模型钉（沿用继承路由）` | 符合 |
| `interface LlmLike`：`listProviders()` + `resolveModelInfo()` | `src/pin.ts:153-158` | 符合 |
| `assertRouteSelectable(llm, pin, fallback): Promise<void>` | `src/pin.ts:164-168` | 符合 |
| pin.ts 零 import | `grep -n "^import" src/pin.ts` → 无输出；仅导出与本地函数 | 符合 |

### 4.2 SPEC 5.2 `src/index.ts` 导出与 apply 五项职责

| 契约项 | 证据 | 结论 |
|---|---|---|
| `export const name = 'agent-team-model-pin'` | `src/index.ts:222` | 符合 |
| `export const inject = ['agentTeams', 'commands']` | `src/index.ts:224` | 符合 |
| `export function apply(ctx, config)` | `src/index.ts:232` | 符合 |
| **不导出 `Config`** | `grep -n "^export" src/index.ts` 仅 3 条（`name`/`inject`/`apply`） | 符合 |
| ① 归一化配置 `{scope, defaults, sessions, auditPath}`，非法值只告警不抛 | `src/index.ts:242-298`；非法值走 `warnOnce`（`src/index.ts:234-238`）后回退默认（scope `src/index.ts:249-253`、defaults `src/index.ts:272`、sessions `src/index.ts:276-287`、auditPath `src/index.ts:291-298`），全程无 `throw` | 符合 |
| ② `ctx.inject(['settings'], …)` + `installSection(ctx, 'agent-team-model-pin', schema, {sessions:{}}, hooks)`，`setSource` 保存同步 thunk | `src/index.ts:304`、`src/index.ts:306`、`setSource` 于 `src/index.ts:307-309` 写入 `liveSource`；`readLiveSessions()` 同步调用 `liveSource()`（`src/index.ts:323-333`） | 符合 |
| ③ 注册全局命令 `team-model`，`input.hint` 给出语法提示 | `ctx.commands.register` 于 `src/index.ts:428-429`；`name: 'team-model'` 于 `src/index.ts:430`；`input.hint` 于 `src/index.ts:432` | 符合 |
| ④ **一个**全局 `agent/request` 监听，先 `await next()` 再决定 | `ctx.on('agent/request', …)` 全文件**恰好 1 次**（`grep -c` = 1，`src/index.ts:538`）；`const config = await next();` 在 `src/index.ts:539`，其后才判定/改写；未命中时原样返回（`src/index.ts:551`） | 符合 |
| ⑤ 审计：每次改写追加一行 JSONL，写失败只记一次日志 | `src/index.ts:392-410`；`JSON.stringify(record)` + `\n`（`src/index.ts:399`）；`catch` 内仅 `warnOnce`（`src/index.ts:400-408`） | 符合 |
| 复用 `./pin.ts` 纯逻辑，不重复实现 | 导入 `src/index.ts:19-27`（值）+ `src/index.ts:28`（类型）；`applyPin`/`resolvePin`/`parseCommandInput`/`mutationFor`/`describePin`/`assertRouteSelectable`/`normalizePin` 均来自 pin.ts | 符合 |

### 4.3 SPEC 5.3 配置字段与默认值 / `cordis.patch.yml`

`cordis.patch.yml` 全文（9 行；`name` 已按 v1.3 更新为 `@lolkda/…`，行 id 未变）：

```yaml
- insert:
    - id: agent-team-model-pin
      name: '@lolkda/dsh-agent-team-model-pin'
      config:
        scope: teammates
        defaults: {}
        sessions: {}
        auditPath: ''
```

| 字段 | 契约默认 | 实现证据 | 结论 |
|---|---|---|---|
| `scope` | `teammates` | `src/index.ts:37` `DEFAULT_SCOPE: Scope = 'teammates'`；patch 行 5 | 符合 |
| `defaults` | `{}` | `src/index.ts:272`（缺失 → `undefined` 层）；patch 行 6 | 符合 |
| `sessions` | `{}` | `src/index.ts:274` `const sessions: PinDict = {}`；patch 行 7 | 符合 |
| `auditPath` | `''` → `$DSH_HOME/agent-team-model-pin/audit.jsonl` | `src/index.ts:179-183` `defaultAuditPath()`：`DSH_HOME` 去空白后非空则用，否则 `join(homedir(), '.dsh')`，再拼 `agent-team-model-pin/audit.jsonl`；`src/index.ts:290-298` 空串/全空白保留默认 | 符合（SPEC 5.3 与 9.8） |

`scope` 合法值集合与告警回退：`src/index.ts:34` `SCOPES = ['teammates','members','all']`，`src/index.ts:246-253`。

### 4.4 SPEC 5.4 运行期存储：命名空间与路径

| 契约项 | 证据 | 结论 |
|---|---|---|
| 命名空间 `agent-team-model-pin` | `src/index.ts:31` `const SETTINGS_NS = 'agent-team-model-pin';` | 符合 |
| schema `{ sessions: dict(pin) }` | `src/index.ts:160-168` `z.object({ sessions: z.dict(z.object({ provider: z.string(), model: z.string(), reasoningEffort: z.string() })) })` | 符合 |
| 段落基准 entry `{ sessions: {} }` | `src/index.ts:171` `SETTINGS_ENTRY` | 符合 |
| 命令写入走 `settings.mutate(ns, [mutationFor(plan, sessionId)])` | set 于 `src/index.ts:505`，clear 于 `src/index.ts:520`；两者都传 `SETTINGS_NS` 与 `mutationFor(plan, sessionId)` | 符合 |
| 运行期层按 `sessions[sessionId]` 读取 | `src/index.ts:419`、`src/index.ts:421` 直接 `readLiveSessions()[sessionId]`；`resolvePin` 侧 `src/pin.ts:32-36` `layerFor` | 符合 |

### 4.5 SPEC 5.5 审计行字段

契约字段：`at`、`sessionId`、`agentId`、`role`、`from{provider,model,reasoningEffort}`、`to{...}`。

| 契约项 | 证据 | 结论 |
|---|---|---|
| 类型定义含全部字段 | `src/index.ts:150-157` `AuditRecord`（`at, sessionId, agentId, role?, from, to`） | 符合 |
| `from` = 改前路由 | `src/index.ts:564` `from: routeOf(config)` | 符合 |
| `to` = 改后路由 | `src/index.ts:565` `to: routeOf(pinned)` | 符合 |
| `role` 非成员时省略（不写 `null`） | `src/index.ts:563` `role: membership?.role`，`undefined` 由 `JSON.stringify` 丢弃 → 符合 9.9 | 符合 |
| 只保留路由三字段 | `src/index.ts:186-192` `routeOf` 只取 `provider`/`model`/`reasoningEffort`，`temperature`/`maxTokens`/`stop` 不入审计 | 符合 |
| `at` 为 ISO8601 | `src/index.ts:560` `new Date().toISOString()` | 符合 |
| 目录不存在自动创建 | `src/index.ts:395-398` `mkdir(dirname(auditPath), { recursive: true })`，一次性标记 `auditDirReady` | 符合（9.8） |

### 4.6 SPEC 第 6 节语言与构建约束

> 本节首版核对的是 SPEC **v1.2** 的 §6（「零构建」形态）。`task-9` 重写了 §6 为 v1.3（「源码 TS + 发布构建产物」），下表已按新契约改写；`src/` 下源码未变，故前三行结论与首版相同。**v1.3 新增的发布形态维度（exports/files/dependencies/scripts/publishConfig 等）在 §11.1 单独逐条核对。**

| 契约项（SPEC §6 v1.3） | 证据 | 结论 |
|---|---|---|
| **源码形态**：只写可擦除语法（禁 `enum`/`namespace`/参数属性/装饰器/`import =`） | 去注释后 `grep -n "\benum\b\|\bnamespace\b\|@[A-Za-z]+\s*(\|import .*requires\|import [A-Za-z]* *=" src/*.ts` → 无匹配。唯一「装饰器形」匹配是 JSDoc 里的 `@param`/`@module` | 符合 |
| **源码形态**：相对导入显式带 `.ts`（使测试可 type-strip 直接加载源码） | `src/index.ts:27` `} from './pin.ts';`、`src/index.ts:28` `import type { … } from './pin.ts';`；`tests/*.test.mjs` 用 `import … from '../src/index.ts'` 实测可加载 | 符合 |
| **源码形态**：除 schemastery 外无外部 import | 全部 import 源集合（去重）：`'./pin.ts'`、`'@deepseek-ai/schemastery'`、`'node:fs/promises'`、`'node:os'`、`'node:path'`。后三者是 Node 内置模块，非外部包（SPEC 5.2 括注「Node 内置模块除外」） | 符合 |
| **发布形态**：`exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } }` | `package.json` 一致；`dist/index.js` 与 `dist/index.d.ts` 均存在且实测可加载（§7、§11.1） | 符合 |
| **发布形态**：`tsconfig.build.json` 显式 `rootDir: "src"` + `rewriteRelativeImportExtensions`，使 emit 的 `./pin.ts` 变 `./pin.js` | `tsconfig.build.json` 含 `rootDir:"src"`、`rewriteRelativeImportExtensions:true`；`dist/*.js` 中相对导入为 `from './pin.js'`，**无** `.ts` 残留；`dist/*.d.ts` 中保留 `from './pin.ts'`（9.14 已独立复现可用，§11.4） | 符合 |
| **发布形态**：`files` 只含 `dist`、`cordis.patch.yml`、`README.md`、`LICENSE` | `package.json` 的 `files` 完全一致；`npm pack --dry-run` 实测 tarball 恰 8 个文件，`src/tests/docs/.github/tsconfig*` 全部不在内（§11.3） | 符合 |
| **发布形态**：运行时依赖是 `dependencies` 而非 peer，`@deepseek-ai/schemastery` 固定 `3.18.2` | `dependencies: {"@deepseek-ai/schemastery":"3.18.2"}`；**无** `peerDependencies`；包内 `node_modules/@deepseek-ai/schemastery` 是真实目录、版本 3.18.2（§7） | 符合 |
| **发布形态**：devDeps `typescript` + `@types/node`；`tsconfig.json` 的 `types: ["node"]` | `devDependencies: {"@types/node":"^26.6.2","typescript":"^7.0.2"}`；`tsconfig.json` `types:["node"]`；`npm run typecheck` 无需 `--typeRoots` 即 exit 0（§8.4） | 符合 |
| **发布形态**：脚本 `typecheck`/`build`/`test`/`check`/`smoke:dist`/`prepublishOnly` | 六者齐备，语义与契约一致（§11.1） | 符合 |
| **发布形态**：不再要求手工 `node_modules` 符号链接 | `test -L node_modules/@deepseek-ai/schemastery` → 非符号链接（真实目录），符合 9.15 | 符合 |
| 构建产物**必须**存在（v1.3 与首版相反） | `dist/` 含 4 个文件（`index.js`/`index.d.ts`/`pin.js`/`pin.d.ts`）；干净 `npm ci` + 从零 `npm run build` 可逐字节复现（§11.2）。首版「不引入构建产物（无 `dist/`）」的要求**已被 v1.3 取代** | 符合 |

---

## 5. C4 反向检查（SPEC 第 2 节非目标）

> 第 5、6 两项按 SPEC **v1.3** 重写：首版「不引入构建产物」「无 `dependencies`」的要求已被 v1.3 取代（v1.3 明确要求 `dist/` 与 `dependencies`）。反向检查的核心仍然成立——**§2 的九项非目标一个都没被违反**。`src/` 两个文件 hash 未变，故第 1、2、4、7、8、9 项结论与首版完全相同。

| # | 禁止项 | 检查命令 | 结果 | 结论 |
|---|---|---|---|---|
| 1 | 改官方包 | `find /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai /usr/local/lib/node_modules/@deepseek-ai/dsh/lib -newermt "2026-09-20 04:30"` | 输出为空（count = 0）。含 `dsh-experimental-agent-team`、`dsh-experimental-tool-agent-team`，目录 mtime 全为安装时间 `Sep 20 04:26`（root 属主） | **未违反** |
| 2 | 改 shipped preset | 同一次 `find` 覆盖 `dsh-agent-presets/presets/{cordis,ptc,minimal,standard}`（`agent.cordis.yml`/`preset.yml`），无新于安装时间的文件；`find / -maxdepth 6 -name agent-presets -type d` 与 `/app/.dsh/.agent-presets/` 均不存在（未新增 preset） | 输出为空 | **未违反** |
| 3 | 改 host 组合其它行 | 本插件随 profile bundle 安装：`/app/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 末项为 `@lolkda/dsh-agent-team-model-pin`，`dependencies` 有对应 `link:` 项；`/app/.dsh/profiles/web/cordis.patch.yml` 内容仍为 `[]`，`cordis.yml` 仍为文档头 + `[]` | 仅新增/替换本插件自己的行与 bundle 项，未动其它行 | **未违反** |
| 4 | 新增 Service / Remote / 工具 schema | `grep -n "ctx\.set\|ctx\.provide\|\.service(\|registerTool\|toolSchema\|ctx\.tool\|\.remote(" src/*.ts` | 唯一匹配 `src/index.ts:87` 是注释「`ctx.settings` 用到的两个方法」。源码中无 Service 注册、无 Remote、无 Tool schema（`src/` hash 未变，结论不变） | **未违反** |
| 5 | ~~不引入构建产物（无 `dist/`）~~ → **v1.3 已反转该要求** | SPEC v1.3 §6 明确要求 `dist/` 作为发布入口；`dist/` 4 个文件存在且可复现构建（§11.2）。**非目标第 2 条「不改 host 组合的其它行」仍未被违反** | `dist/` 存在是**契约要求**，非违规 | **不适用（契约已变）** |
| 6 | 引入**额外**外部依赖 | `package.json`：`dependencies` 仅 `@deepseek-ai/schemastery@3.18.2`（SPEC §6 明确要求）；`devDependencies` 仅 `typescript` + `@types/node`（SPEC §6 明确要求）。`npm ls --depth=0` 实际落地 7 个包（含 schemastery 的传递依赖 `@standard-schema`/`cosmokit`、`@types/node` 的 `undici-types`） | 无 SPEC 之外的直接依赖 | **未违反** |
| 7 | 多个 `agent/request` 监听 | `grep -c "ctx.on('agent/request'" src/index.ts` | `1`（`src/index.ts:538`）；`grep -n "ctx.on(" src/index.ts` 也只有这一行 | **未违反** |
| 8 | 审计失败会抛错打断请求 | 读 `src/index.ts:392-410`：`audit()` 返回 `void`，把写入挂到 `auditTail` 串行链（`src/index.ts:393` `auditTail = auditTail.then(async () => {…})`），链内 `try/catch` 吞掉异常（`src/index.ts:400-408`），调用点 `src/index.ts:559` **不 `await`**；监听器返回值只由 `return pinned`/`return config` 决定（`src/index.ts:551`、`src/index.ts:567`） | 演进链上无任何未捕获 Promise；`audit()` 本体不抛 | **未违反** |
| 9 | 改 `list_agents` 的 `model` 列（R7） | `grep -rn "list_agents\|listAgents\|options.model" src/` | 无任何引用 | **未违反** |

---

## 6. C5 边界核对（读代码）

> 首版本节全部结论来自**静态阅读**（`task-4` 的授权范围是「读代码即可」）。`task-7` 复核时，其中第 2、3、4、5 项已由 `tests/command.test.mjs` 转为**运行时证据**（对应 §10.2 的要求 10、8、6 与 7 的对照面），第 1 项仍只有代码证据。下表保留原始静态证据，运行时证据见 §10.2。

| # | SPEC「失败与边界」情形 | 要求 | 代码证据 | 结论 | 运行时证据 |
|---|---|---|---|---|---|
| 1 | `agentTeams` 服务缺失 | 不激活、不报错、不抛 | `src/index.ts:224` `export const inject = ['agentTeams', 'commands']`；`apply` 内无自建 guard，完全依赖注入门控。列表实测该行 `active`（§7），即 `agentTeams` 存在时正常激活。**负例（移除服务）未在运行时复现** → 见 §14 第 5 项 | 符合（机制）；运行时负例未验证 | ❌ 无（仅代码） |
| 2 | `settings` 服务缺失 | Composition 层仍生效；命令返回明确错误文本，不抛 | `liveSource` 初值 `() => SETTINGS_ENTRY`（`src/index.ts:302`），settings 段落安装放在嵌套 `ctx.inject(['settings'], …)`（`src/index.ts:304`）内——服务缺失则回调不执行，`liveSource` 保持空段落，`readLiveSessions()` 返回 `{}`（`src/index.ts:323-333`），组合层照常解析。命令侧：`show` 于 `src/index.ts:454-463` 返回 `kind:'error'` 且附组合层结果；`set`/`clear` 于 `src/index.ts:477-483` 返回 `kind:'error'`。三处均无 `throw` | 符合 | ✅ `command.test.mjs` 用例 `10a`/`10b`/`10c`（L640/L653/L679） |
| 3 | 未知 / 已失效 agent | `tryMembership` 返回 `undefined` → 不钉、不抛 | `src/index.ts:544-546`：`tryMembership` 在 `try` 内，`sessionId = membership?.root?.id ?? agent.id`；`resolvePin` 在 `scope='teammates'` 且 `role === undefined` 时经 `inScope`（`src/pin.ts:50-55`）返回 `undefined`；`src/index.ts:551` `if (pin === undefined) return config;`。异常路径 `src/index.ts:547-550` 也返回 `config` | 符合 | ✅ 用例 `7a` 非成员分支（L516-518）+ `8` 抛错分支（L556） |
| 4 | 运行期 pin 含空串 | 视为未设置该字段 | `src/pin.ts:8-12` `asField`：非字符串或 `trim()` 后为空 → `undefined`；`src/pin.ts:15-29` `normalizePin` 只在字段非空时写入，全空返回 `undefined`；`src/pin.ts:21-23`。命令侧 `src/index.ts:495-497` 对空 effort 不写该键 | 符合（另有 `A3 blank field…`、`normalizePin …drops empty/blank fields` 单测直证） | ✅ 用例 `3b`（L345）+ `6` 的纯空白分支（L487） |
| 5 | 运行期 route 非法 | 不校验、不回退 | 请求路径 `src/index.ts:538-567`：`effectivePin`（`src/index.ts:347-361`）→ `resolveLayer` → `resolvePin`，全链路无 `llm` 调用。`assertRouteSelectable` 全文件只在命令 handler 的 set 分支被调用（`grep` 命中 `src/index.ts:21` 导入、`src/index.ts:500` 调用；`llmService()` 只在 `src/index.ts:486`），即**仅设置时校验** | 符合 | ✅ 用例 `7a`/`7b` 以假 llm 直接改写（L497/L521），请求路径未触碰校验 |

---

## 7. C6 安装态核对

> 本节在 `task-9` 后**已更新**：模块名从 `@local/dsh-agent-team-model-pin` 变为 `@lolkda/dsh-agent-team-model-pin`，入口从源码 `.ts` 变为构建产物 `dist/index.js`，手工符号链接前提取消。首版（`@local` + `.ts` 入口 + 符号链接）的记录保留在下面的「首版记录」小节以便对照。

**命令**：`plugin_manager` `action=list_plugins`（`limit=100`，`offset=0` 与 `offset=100` 两页；只读操作）。

**命中条目（v1.3 实测原始字段）**

```json
{"entryId":"include:agent-team-model-pin","moduleName":"@lolkda/dsh-agent-team-model-pin","enabled":true,"fiberPhase":"active","patchId":"agent-team-model-pin"}
```

**结论：通过。** 行 `include:agent-team-model-pin` 的 `fiberPhase` 为 `active`（非 `null`、非 restart-required），`enabled: true`。由于 v1.3 的入口是 `dist/index.js`，这一行 `active` 同时是「**构建产物入口被真实加载成功**」的证据。

**profile 安装方式**：bundle 安装（`link:` 指向工作区目录），非 patch 手写。

- `/app/.dsh/profiles/web/package.json` → `dependencies["@lolkda/dsh-agent-team-model-pin"] = "link:/app/project/dsh-files/dsh-agent-team-model-pin"`，且 `dsh.profile.bundles` 末项为 `"@lolkda/dsh-agent-team-model-pin"`；**无** `@local/*` 引用。
- `/app/.dsh/profiles/web/node_modules/@lolkda/dsh-agent-team-model-pin` → 符号链接指向工作区目录。

**依赖落地形态核对（v1.3 取消了手工符号链接前提，SPEC 9.15）**

```
$ test -L node_modules/@deepseek-ai/schemastery && echo SYMLINK || echo "REAL DIR"
REAL DIR
$ node -e "console.log(require('./node_modules/@deepseek-ai/schemastery/package.json').version)"
3.18.2
```

**结论：符合。** `schemastery` 现在是 `dependencies`，由 `npm install` 落地为包内**真实目录**（不再是首版那种指向 profile `node_modules` 的手工符号链接）。因此首版 README 里「缺这个链接就会 `ERR_MODULE_NOT_FOUND`」的前提**已不成立**，README §5 已随之改写。

**入口 smoke（两条，独立复跑）**

```
$ node -e "import('./src/index.ts').then(m=>console.log(m.name, JSON.stringify(m.inject), typeof m.apply))"
agent-team-model-pin ["agentTeams","commands"] function

$ npm run smoke:dist
dist entry OK: agent-team-model-pin ["agentTeams","commands"]
```

源码入口与**发布入口**都通过；`node -e "console.log(process.features.typescript)"` → `strip`。

### 首版记录（`@local` + `.ts` 入口 + 手工符号链接，保留供对照）

```json
{"entryId":"include:agent-team-model-pin","moduleName":"@local/dsh-agent-team-model-pin","enabled":true,"fiberPhase":"active","patchId":"agent-team-model-pin"}
```

```
$ readlink node_modules/@deepseek-ai/schemastery
/app/.dsh/profiles/web/node_modules/@deepseek-ai/schemastery
$ test -L node_modules/@deepseek-ai/schemastery && echo "IS SYMLINK"
IS SYMLINK
```

首版结论「行 active + 符号链接存在」在当时成立；该形态已于 `task-9` 被替换。

**残留观察**：`/app/.dsh/profiles/web/node_modules/@local/dsh-agent-team-model-pin` 这个孤儿符号链接仍在（profile 已不引用 `@local/*`），不影响运行，可清理。

---

## 8. C7 类型检查（含 task-5 修复复核）

**工具**：`node /app/project/dsh-files/dsh-file-manager-ts/node_modules/typescript/bin/tsc`，`Version 7.0.2`。

### 8.1 修复后（当前冻结版本）

```
$ node .../tsc -p tsconfig.json --noEmit \
    --typeRoots /app/project/dsh-files/dsh-file-manager-ts/node_modules/@types --types node
(无输出)
[exit=0]
```

**结论：通过，输出为空。** `tsconfig.json` 的 `include: ["src/**/*.ts"]` 覆盖 `src/index.ts`，故 index.ts 对 `mutationFor` 的调用点（`src/index.ts:505`、`src/index.ts:520`）也一并通过类型检查。

### 8.2 修复前基线（同一命令，`task-5` 之前）

```
src/pin.ts(128,39): error TS2339: Property 'provider' does not exist on type '{ action: "clear" | "set"; }'.
src/pin.ts(128,61): error TS2339: Property 'model' does not exist on type '{ action: "clear" | "set"; }'.
src/pin.ts(129,12): error TS2339: Property 'reasoningEffort' does not exist on type '{ action: "clear" | "set"; }'.
src/pin.ts(129,72): error TS2339: Property 'reasoningEffort' does not exist on type '{ action: "clear" | "set"; }'.
[exit=1]
```

即修复前**恰好 4 条**真实类型错误，与 `task-5` 描述一致，且与修复后形成 before/after 对照（修复后 0 条）。

### 8.3 裸跑（不带 `--typeRoots`，修复后）

```
$ node .../tsc -p tsconfig.json --noEmit
src/index.ts(16,35): error TS2591: Cannot find name 'node:fs/promises'. …
src/index.ts(17,25): error TS2591: Cannot find name 'node:os'. …
src/index.ts(18,31): error TS2591: Cannot find name 'node:path'. …
src/index.ts(106,11): error TS2304: Cannot find name 'AbortSignal'.
src/index.ts(119,68): error TS2304: Cannot find name 'AbortSignal'.
[exit=1]
```

**结论：仅环境噪声，非代码缺陷。** 5 条全部是「缺 `@types/node` / DOM lib」导致的内置名未定义：3 条 `node:*` 模块名（`src/index.ts:16-18` 的 import）+ 2 条 `AbortSignal`（`src/index.ts:106` 命令入参、`src/index.ts:119` 瀑布 payload）。修复前后的**裸跑都含这 5 条**，且裸跑中已**不再**出现任何 TS2339——与 SPEC 9.12 记录的环境限制完全一致。当时本机离线、包内无 `@types/node`，故这是 SPEC 9.12 描述的环境限制，按裁定计为「符合」。

### 8.4 v1.3 更新：该环境限制已解除

`task-9` 把 `@types/node` 加为 `devDependencies`（`package.json`）并在 `tsconfig.json` 声明 `types: ["node"]`，因此 §8.3 的 5 条噪声**不再出现**。复核实测（工作区，包内 `node_modules/.bin/tsc`，`Version 7.0.2`）：

```
$ node node_modules/.bin/tsc -p tsconfig.json        # 裸跑，无 --typeRoots
(无输出)
[exit=0]

$ npm run typecheck
> @lolkda/dsh-agent-team-model-pin@1.0.0 typecheck
> tsc -p tsconfig.json
(无输出)
[exit=0]
```

**结论：符合，且比首版更强。** SPEC 9.12 曾把「必须用 `--typeRoots` 指向工作区内其它项目的 `@types`」记为环境限制与变通手段；v1.3 下该变通**已不需要**，`npm run typecheck` 在包内自足即可通过。首版 §8.1 的 `--typeRoots` 命令仍然可用且结果相同（作为交叉验证保留）。

---

## 9. C8 端到端证据交叉核对（**由 lead 执行**）

> 本节全部证据**不是本 verifier 产生的**：e2e 由 **lead** 执行（SPEC 7.2 明确「Lead 执行，teammate 不参与」）。本 verifier 只**只读**核对文件字段，未触发任何请求、未写任何状态。
>
> ✅ **`task-9` 的时效性缺口已由 `task-10` 关闭**：`task-9` 时本节证据（3 行审计 + 投影缓存）**产生于改名前**（`@local` + `src/index.ts` 入口），当时「改名后的安装是否仍能对真实队友生效」缺直接观测。`task-10` 在**新形态下重跑了 e2e**（e2e#2，`@lolkda` + `dist` 入口，见 §9.3、§12.2），审计文件现为 6 行。两轮证据的分工见 §9.4。

### 9.1 审计文件 `/app/.dsh/agent-team-model-pin/audit.jsonl`（e2e#1，改名前 `@local`）

`wc -l` = 3（这是 `task-9` 时的状态；`task-10` 后为 6 行，见 §9.3），当时全文 3 行：

```json
{"at":"2026-09-21T20:01:08.651Z","sessionId":"session-26ad87e0-ac8d-49b5-ab61-4cb606827674","agentId":"06ecb40b-cf1b-4748-9b51-bd12c69159f1","role":"teammate","from":{"provider":"cpa","model":"deepseek-flash","reasoningEffort":"high"},"to":{"provider":"cpa","model":"gpt-6-astra","reasoningEffort":"medium"}}
{"at":"2026-09-21T20:01:18.871Z","sessionId":"session-26ad87e0-ac8d-49b5-ab61-4cb606827674","agentId":"06ecb40b-cf1b-4748-9b51-bd12c69159f1","role":"teammate","from":{"provider":"cpa","model":"gpt-6-astra","reasoningEffort":"medium"},"to":{"provider":"cpa","model":"gpt-6-astra","reasoningEffort":"medium"}}
{"at":"2026-09-21T20:01:25.930Z","sessionId":"session-26ad87e0-ac8d-49b5-ab61-4cb606827674","agentId":"06ecb40b-cf1b-4748-9b51-bd12c69159f1","role":"teammate","from":{"provider":"cpa","model":"gpt-6-astra","reasoningEffort":"medium"},"to":{"provider":"cpa","model":"gpt-6-astra","reasoningEffort":"medium"}}
```

逐字段核对：

| 核对项 | 期望 | 实测 | 结论 |
|---|---|---|---|
| 首行 `from` | `cpa/deepseek-flash/high`（继承 Lead 路由） | `{"provider":"cpa","model":"deepseek-flash","reasoningEffort":"high"}` | ✅ |
| 首行 `to` | `cpa/gpt-6-astra/medium`（钉住的路由） | `{"provider":"cpa","model":"gpt-6-astra","reasoningEffort":"medium"}` | ✅ |
| 只出现 teammate 的 agentId | 仅 `06ecb40b-cf1b-4748-9b51-bd12c69159f1` | 3 行全部是该 id（`list_agents` 中该 id = `pin-e2e`，role teammate） | ✅ |
| Lead 无记录 | 无 lead 的 agentId | 无 `session-26ad87e0-…`（Lead 自身 id）出现于 `agentId` | ✅ |
| `role` 字段 | `teammate` | 3 行均为 `"teammate"` | ✅ |
| 行格式 | 每行一个 JSON 对象，字段 = SPEC 5.5 | 6 个字段齐全，`from`/`to` 各 3 子字段，无多余字段 | ✅ |
| `sessionId` | 作用键 = Lead 会话 id | 3 行均为 `session-26ad87e0-ac8d-49b5-ab61-4cb606827674`（即 Lead 会话），**不是** teammate 自身 id | ✅ 符合 R2 |

**它证明了什么**：队友（`pin-e2e`）的模型请求在 `agent/request` 瀑布被改写，路由从继承的 `cpa/deepseek-flash/high` 变为钉住的 `cpa/gpt-6-astra/medium`；作用键取的是 Lead 会话 id（R2）；Lead 自身请求未被钉（无 Lead 记录）；审计行字段与 SPEC 5.5 一致；且第 2、3 行 `from == to` 说明钉持续生效（后续请求进入时已是钉住路由，改写为幂等）。**这一轮是唯一证明「模型切换」能力（`deepseek-flash` → `gpt-6-astra`，含 `reasoningEffort` 一并改写）的证据。**

**它不能证明什么**：

1. **不能证明队友侧「实际发送给提供商」的就是 `to`。** 审计行是插件在瀑布出口记录的自述；它证明「瀑布里被改写成的路由」，不证明 HTTP 请求体里的 model 字段。SPEC 7.2 第 3 步（读队友会话记录确认落库请求路由）需另行核对。
2. **只能间接、单点地支持「Lead 自身不被钉」，不能证明 Lead 请求的完整处置链路。** 依据是：本实现只要 `pin !== undefined` 就写审计行（与 `from == to` 无关，见 `src/index.ts:551-566`），所以「无 Lead 记录」⟹「Lead 的每次请求 `resolvePin` 都返回 `undefined`」⟹ 在 `scope=teammates` 下 `inScope` 对 `role='lead'` 返回 false（`src/pin.ts:51`），即 R1 门控生效。但这是**同一次运行、单一 scope 取值**的观察，既不覆盖 `members`/`all`，也不排除「该窗口内 Lead 恰好没有发起请求」这一替代解释（同窗口内确实无法从文件区分这两种情况）。
3. **不能证明命令侧 `/team-model` 被人类触发过。** 审计行证明的是请求路径，与 slash 命令的注册/触发无关。
4. **不能证明「无需重启生效」的时间属性**：3 行审计都在 7 秒内（20:01:08→20:01:25），无法从文件本身推断设置钉的命令是在何时执行、队友是否在设置前就已存在。该属性依赖 SPEC 7.2 的完整流程记录。

### 9.2 子会话投影缓存

文件：`/app/.dsh/storages/session_projcache/sessions/06ecb40b-cf1b-4748-9b51-bd12c69159f1.json`（文件名即 `pin-e2e` 的 agentId，与审计行 agentId 一致）。

提取 `record.rows.modelSelection`：

```json
{"ver": 2, "seq": 27, "val": {"lastUsed": {"provider": "cpa", "model": "gpt-6-astra", "reasoningEffort": "medium"}, "pending": null}}
```

同一缓存中 `rows.titleInput.val.first.text` 的前缀为：

```
<system-reminder>
You are teammate "pin-e2e".
</system-reminder>
…
（背景：lead 正在验证一个新插件是否把 teammate 的模型请求钉到了 cpa/gpt-6-astra/medium。你只要正常发出一次模型请求，就会产生验证证据。）
```

**它证明了什么**：该队友会话的**模型选择投影**记录为 `cpa/gpt-6-astra/medium`，且 `pending: null`（无待生效的模型切换）。这是独立于审计文件的**第二来源**证据：审计说"瀑布改写成了 gpt-6-astra/medium"，投影缓存说"该会话最后使用的模型是 gpt-6-astra/medium"——两者一致，排除了"审计自述与真实调用配置不符"的最直接怀疑。

**它不能证明什么**：

1. **不能证明该 `lastUsed` 是由本插件写入的。** `lastUsed` 通常由 `model-selection` 机制在解析模型时写入（SPEC 3 提到 DSH 自身模型选择走同一瀑布）。它与插件的因果关系是「时间与取值吻合 + 三处证据（审计/投影/list_agents）互不矛盾」的推断，**不是**孤证。若要严格归因，需要「同一 action 在插件卸载前后的 `lastUsed` 对照」——本次没有做这个对照。
2. **不能证明队友实际请求的 HTTP body。** 投影缓存是会话状态，不是网络流量。按 CTF 证据优先级（运行时行为 > 抓包 > 服务端资产…），它属于「持久化状态」，弱于抓包。
3. **`seq: 27` 是投影事件序号，不是请求计数**；不能据此推断「发了几次请求」。

### 9.3 审计文件（e2e#2，**新形态** `@lolkda` + dist 入口）—— `task-10` 新增

`task-10` 后 `wc -l` = **6**，sha256 `fa99df80348e678b7af8bcba7ed64b627769d9a558be61933bc647cb4674b7d2`。第 4–6 行是本次新增（前 3 行即 §9.1 的内容，逐字未变）：

```json
{"at":"2026-09-21T20:56:00.314Z","sessionId":"session-26ad87e0-ac8d-49b5-ab61-4cb606827674","agentId":"d49d5ca1-cbf4-405c-8b40-a15239ef8b7f","role":"teammate","from":{"provider":"cpa","model":"deepseek-flash","reasoningEffort":"high"},"to":{"provider":"cpa","model":"deepseek-flash","reasoningEffort":"low"}}
{"at":"2026-09-21T20:56:01.793Z","sessionId":"session-26ad87e0-ac8d-49b5-ab61-4cb606827674","agentId":"d49d5ca1-cbf4-405c-8b40-a15239ef8b7f","role":"teammate","from":{"provider":"cpa","model":"deepseek-flash","reasoningEffort":"low"},"to":{"provider":"cpa","model":"deepseek-flash","reasoningEffort":"low"}}
{"at":"2026-09-21T20:56:06.279Z","sessionId":"session-26ad87e0-ac8d-49b5-ab61-4cb606827674","agentId":"d49d5ca1-cbf4-405c-8b40-a15239ef8b7f","role":"teammate","from":{"provider":"cpa","model":"deepseek-flash","reasoningEffort":"low"},"to":{"provider":"cpa","model":"deepseek-flash","reasoningEffort":"low"}}
```

逐字段核对：

| 核对项 | 期望 | 实测 | 结论 |
|---|---|---|---|
| 本次新增行数 | 3 行 | 3 行（第 4–6 行） | ✅ |
| 首行 `from` | `cpa/deepseek-flash/high`（继承 Lead 路由） | `{"provider":"cpa","model":"deepseek-flash","reasoningEffort":"high"}` | ✅ |
| 首行 `to` | `cpa/deepseek-flash/low`（钉住的 effort） | `{"provider":"cpa","model":"deepseek-flash","reasoningEffort":"low"}` | ✅ |
| agentId | 仅 `d49d5ca1-cbf4-405c-8b40-a15239ef8b7f`（`pin-e2e2`） | 3 行全部是该 id；与前 3 行的 `06ecb40b…` **不混** | ✅ |
| Lead 无记录 | 无 lead 的 agentId | 6 行中**无** `agentId == session-26ad87e0-…` | ✅ |
| `role` | `teammate` | 3 行均为 `"teammate"` | ✅ |
| `sessionId` | 作用键 = Lead 会话 id | 3 行均为 `session-26ad87e0-ac8d-49b5-ab61-4cb606827674`（**不是** teammate 自身 id） | ✅ 符合 R2 |
| 行格式 | SPEC 5.5 的 6 个字段 | 字段齐全、`from`/`to` 各 3 子字段、无多余字段 | ✅ |
| 第 5、6 行 | `from == to`（幂等） | 均为 `deepseek-flash/low → deepseek-flash/low` | ✅ |

**子会话投影**（`/app/.dsh/storages/session_projcache/sessions/d49d5ca1-cbf4-405c-8b40-a15239ef8b7f.json`，文件名即 agentId）：

```json
{"ver": 2, "seq": 27, "val": {"lastUsed": {"provider": "cpa", "model": "deepseek-flash", "reasoningEffort": "low"}, "pending": null}}
```

`rows.titleInput.val.first.text` 开头为 `You are teammate "pin-e2e2"`，其背景句自述「lead 在验证 `@lolkda/dsh-agent-team-model-pin` 以构建产物 dist 安装后，是否仍能把本会话 teammate 的模型请求钉到 cpa/deepseek-flash/low」——与审计行取值一致。

**这组证据证明了什么**：

1. **改名 + 改入口（`dist/index.js`）后的安装，仍能对真实队友生效**。这是 `task-9` 遗留缺口的直接闭合：审计行由**运行中的 `@lolkda` + dist 入口**实例写出（行 `active`，§7），而非改名前那次。
2. **effort 改写能力**：`reasoningEffort` 从继承的 `high` 被改写为钉住的 `low`，且 `provider`/`model` 保持不变——正好对应 R4 的「pin 只给 effort → 保留原 provider/model」分支（本轮 pin 只指定了 effort）。
3. 作用键仍取 Lead 会话 id（R2）；Lead 自身无审计行（R1 的 `scope=teammates` 门控）；投影缓存的 `lastUsed` 与审计一致（第二来源）。

**这组证据不能证明什么**：

1. **不能证明「模型切换」**：本轮 `from`/`to` 的 `provider` 与 `model` **完全相同**（都是 `cpa/deepseek-flash`），只有 `reasoningEffort` 变了。**模型切换能力（`deepseek-flash → gpt-6-astra`）仍只由 e2e#1（改名前那次）证明**，见 §9.1。两轮合起来才覆盖「改模型」与「只改 effort」两条路径。
2. **不能证明实际发给提供商的 HTTP body**（同 §9.2 第 2 点：投影/审计都是进程内状态，不是抓包）。
3. **不能证明「无需重启生效」的时间属性**：3 行都在 6 秒内（20:56:00→20:56:06），无法从文件推断设钉命令的执行时刻。
4. **不能证明中性配置已恢复**——那要靠 §12.3 的独立核对（profile `cordis.patch.yml` 为 `[]`），不是这组文件本身。

### 9.4 两轮 e2e 的分工（避免误读）

| | e2e#1（§9.1/§9.2） | e2e#2（§9.3，`task-10`） |
|---|---|---|
| 安装形态 | `@local/…`，入口 `src/index.ts`（源码） | **`@lolkda/…`，入口 `dist/index.js`（构建产物）** |
| 队友 | `pin-e2e`（`06ecb40b…`） | `pin-e2e2`（`d49d5ca1…`） |
| 钉住的路由 | `cpa/gpt-6-astra/medium` | `cpa/deepseek-flash/low` |
| 改写了什么 | **`provider` + `model` + `effort`**（三者都变） | **只有 `effort`**（`high → low`） |
| 独有结论 | **模型切换能力** | **新形态（dist 入口）下仍生效** + effort-only 路径（R4） |
| 执行者 | lead | lead |

> 两轮都不是本 verifier 产生的；我只做了只读字段核对。

---

## 10. C9 复核（task-7）：新增 handler 测试与破坏性抽检

首版报告的 §11（未验证项清单）曾保留「命令 handler 函数体未被任何测试执行」。`task-6` 新建了 `tests/command.test.mjs`（25 例，`sha256 3be211c1…c176`）。本节记录我对它的**独立复核**，重点是判断它是否**真的在测行为**，而不是只看它绿。

### 10.1 复跑与既有结论复核

| 复核项 | 命令 | 结果 | 结论 |
|---|---|---|---|
| 全量测试 | `node --test tests/*.test.mjs` | `tests 59 / pass 59 / fail 0` | 通过 |
| `pin.test.mjs` 单独 | `node --test tests/pin.test.mjs` | `tests 34 / pass 34 / fail 0` | 与首版一致（未减、未放宽） |
| `command.test.mjs` 单独 | `node --test tests/command.test.mjs` | `tests 25 / pass 25 / fail 0` | 通过 |
| A1–A7 映射 | `grep -o "^test('\(A[1-7]\)" tests/pin.test.mjs \| sort \| uniq -c` | A1=4 A2=1 A3=4 A4=3 A5=6 A6=6 A7=8 | 与首版逐字一致 |
| 类型检查 | `tsc -p tsconfig.json --noEmit --typeRoots … --types node` | 无输出、`[exit=0]` | 与首版一致（`src/` 未变） |
| 入口 smoke | `node -e "import('./src/index.ts')…"` | `agent-team-model-pin ["agentTeams","commands"] function` | 与首版一致 |
| `ctx.on('agent/request'` 次数 | `grep -c` | `1` | 与首版一致 |
| 安装态 | `plugin_manager action=list_plugins`（两页） | `include:agent-team-model-pin` → `enabled:true, fiberPhase:"active"` | 与首版一致 |
| 开发期符号链接 | `readlink node_modules/@deepseek-ai/schemastery` | `/app/.dsh/profiles/web/node_modules/@deepseek-ai/schemastery` | 与首版一致 |
| e2e 证据未被测试污染 | `wc -l` + `cat` + `sha256sum` `audit.jsonl` | 仍 3 行、内容与 §9.1 逐字一致，`sha256 a1812c7d…3d0b0` | 测试的 DSH_HOME 护栏有效 |
| 反例：`src/index.ts` 指纹 | `sha256sum`（抽检前后各一次） | 前后均 `be85f9ec…dc48` | 工作区未被改动 |

### 10.2 task-6 十条要求逐条命中（断言与行号）

| # | task-6 要求 | 测试用例 | 关键断言（`tests/command.test.mjs` 行号） | 变红验证方式 |
|---|---|---|---|---|
| 1 | 命令注册：`name==='team-model'` 且带 `input.hint` | `1b`（L248） | `:255` name、`:256` `typeof input.hint === 'string'`、`:257` `/show/`、`:258` `/clear/`、`:259` handler 是函数、`:260` 监听器恰 1 个、`:261` settings inject 恰 1 次 | 由断言形式推断（未逐一注入） |
| 2 | `show` 无钉 / 有钉 | `2a`（L282）、`2b`（L296）、`2c`（L310） | `2a`：`:290` `kind==='success'`、`:291` `/未设置/`、`:292` `/沿用继承路由/`（遍历 `''`/`show`/`  SHOW  `）；`2b`：`:304-307` 文本含 `provider=cpa`/`model=deepseek-flash`/`reasoningEffort=high`；`2c`：`:319-322` set 后立即出现在 show 文本 | 由断言形式推断 |
| 3 | `set` 合法：`mutate` 恰好一次 + 参数精确 | `3a`（L329）、`3b`（L345）、`3c`（L362） | `3a`：`:337` success、`:338` `mutateCalls.length===1`、`:339` ns、`:340-342` `deepEqual(ops,[{op:'set',path:['sessions',LEAD_ID],value:{provider,model,reasoningEffort}}])`；`3b`：`:352-354` 无 effort 时 value 恰 2 字段；`3c`：`:369-371` teammate 触发时 path 仍是 Lead 会话 id | **注入 C 已证**：`3a` 因 `:338`（`2 !== 1`）变红 |
| 4 | `set` 非法 route：`error` 且 **`mutate` 为 0** | `4`（L378） | `:385` `kind==='error'`、`:386` `/provider 未注册/`、**`:387` `mutateCalls.length===0`**；`:389-391` 未知 model、`:393-396` 非法 effort 各再断言一次；`:399-400` 失败后 show 仍「未设置」 | **注入 B 已证**（`:385`）+ **注入 C 已证**（`:387`，`1 !== 0`） |
| 5 | `clear`：`unset` 路径精确 + R6b 文本 | `5a`（L407）、`5b`（L420）、`5c`（L450） | `5a`：`:413` success、`:414` length 1、`:416` `deepEqual(ops,[{op:'unset',path:['sessions',LEAD_ID]}])`、`:417` `/无生效钉/`；`5b`：`:441` `/仍被组合配置钉住/`、`:442` `/per-session-model/`、`:445-447` 清后回落组合层；`5c`：`:462` R6b 文本、`:465-467` 清后回落到 `defaults` 的 `reasoningEffort='low'` | 由断言形式推断 |
| 6 | 非法输入：`error` 且 **`mutate` 为 0** | `6`（L474） | `:481` 三个非法输入均 `kind==='error'`、`:488` 纯空白等价于 show（success）、**`:490` `mutateCalls.length===0`** | **注入 A 已证**（`:490`，`actual:3, expected:0`） |
| 7 | 请求监听器：teammate 被改写、lead 原配置（R1） | `7a`（L497）、`7b`（L521）、`7c`（L534） | `7a`：`:507-509` teammate 路由=钉住值、`:510` `temperature` 保全、`:513` lead `deepEqual` 继承配置、**`:514` `lead.out === lead.original`（对象同一性）**、`:517-518` 非成员同样不被钉；`7b`：`:529-531` `scope='all'` 下非成员以自身 id 为键被钉；`7c`：`:545` 外部改写运行期层、`:548-549` 下一次请求即生效（证 `setSource` thunk 是活的） | 由断言形式推断；`:514` 的同一性断言比 `deepEqual` 强，能抓住「无钉时返回新对象」的缺陷 |
| 8 | `tryMembership` 抛错 → 返回原配置且不抛 | `8`（L556） | `:566` `deepEqual(out, original)`（若抛错则本用例整体报错）、`:567-570` 记一次 `/团队成员判定失败/` 告警 | 由断言形式推断 |
| 9 | 审计：6 字段 + 写失败仍钉住不抛 | `9a`（L577）、`9b`（L606） | `9a`：`:589` 恰好 1 行、**`:591` `Object.keys(rec).sort()` 恰为 6 个**、`:592` sessionId=Lead 会话、`:593` role、`:594` `at` 可解析、`:595`/`:596` from/to 精确值、`:597-598` from/to 键集恰 3 个、`:603` Lead 无审计行；`9b`：`:617` 审计路径父级是普通文件（`mkdir` ENOTDIR）、`:623-624` 两次请求**仍被钉住**、`:629-633` `/审计写入失败/` 告警**恰一次** | 由断言形式推断 |
| 10 | settings 缺失 → 组合层仍生效 + 命令不抛 | `10a`（L640）、`10b`（L653）、`10c`（L679） | `10a`：`:649-650` 无 settings 时仍被组合层钉住；`10b`：`:663-665` show 返回 error 且含 `/settings 服务不可用/` 与 `/Composition/`、`:668-673` set/clear 同样 error、`:675` `mutateCalls.length===0`、`:676` `installCalls.length===0`；`10c`：`:685-687` llm 缺失时 error 且零写入 | 由断言形式推断 |

**额外加固（task-6 未明文要求，但属实现已承诺的健壮性）**：`11`（L694）断言 `mutate` 拒绝时 set/clear 返回 error 文本而非抛错、读路径不受影响；`11b`（L713）断言空输入与 `show` 文本完全相同、命令注册经 `ctx.effect` 登记（`:723` `effects.length >= 1`）。

### 10.3 是否存在「断言过弱 / 只断言 mock 自身 / 恒真断言」

逐条检查结论：**未发现这三类问题。**

- **无「只断言 mock 自身」**：假 ctx（`tests/command.test.mjs:62-236`）只做记录与转发，所有断言都打在 `apply()` 之后对外可观察的产物上——`commands.register` 收到的定义、`settings.mutate` 收到的参数、`agent/request` 监听器的返回值、审计文件内容、`logger.warn` 文本。唯一在假 ctx 内部的断言是 `:82`（`entry` 必须能通过实现自己声明的 schema）与 `:154-161`（审计路径必须在 `tmpdir()` 下），前者是「实现自洽性」检查、后者是防污染护栏，都不是把 mock 当被测对象。
- **无恒真断言**：`:591/:595/:596/:597/:598` 用的是 `deepEqual` 精确比对（键集 + 取值），`:514/:518` 用对象同一性 `===`，`:338/:387/:391/:396/:414/:490/:675/:676/:687` 用调用计数严格相等——注入实验（§10.4）直接证明了其中 3 处（`:338`、`:387`、`:490`）会变红。
- **无「断言过弱」的实质缺口**，但有 2 处措辞级宽松，已在下面列出，且都有更强的兄弟断言兜底：
  1. `2a` 的 `/未设置/`、`/沿用继承路由/` 是正则匹配，而 `describeLayers` 会把多行 `describePin` 结果拼进同一段文本，因此这两条正则会命中该文本的多处。**兜底**：`2b` 用精确三元组断言「有钉时会显示钉」，`5b/5c` 用 `/仍被组合配置钉住/` 断言反例分支，故「show 永远只说未设置」这一缺陷类型不会漏检。
  2. `1b` 的 `:257/:258` 只要求 hint 里出现 `show`/`clear` 子串，不校验完整语法串。这是对 `input.hint` 的**存在性**断言，不是对其文案的契约断言——SPEC 5.2 只要求「`input.hint` 给出语法提示」，故与契约一致。

### 10.4 破坏性抽检（临时副本，工作区未被改动）

**方法**：把整个包（含 `node_modules` 符号链接）`cp -a` 到 `mktemp -d /tmp/verifier-task7-XXXXXX`，**只在副本里**注入缺陷，然后运行副本的测试。工作区 `src/` 一个字节都没碰。选择临时副本而非直接改工作区，是为了同时满足「证明测试有效」与「保持 verifier 只读」两个要求。

**副本保真性先验**：未注入的副本先跑一次 → `tests 59 / pass 59 / fail 0`，与工作区结果相同（说明副本是忠实拷贝，`schemastery` 符号链接解析正常，副本入口 `import` 成功）。

| 注入 | 缺陷内容（仅副本） | 结果 | 失败的断言（原始输出摘录） |
|---|---|---|---|
| **A** | 把 `src/index.ts` 的 `if (plan.action === 'invalid') return {…}` 改成「先 `settings.mutate(...)` 再返回错误」——即**非法输入也写入** | `tests 25 / pass 24 / fail 1` | `✖ 6 非法输入：error 且 mutate 次数为 0`；`AssertionError [ERR_ASSERTION]: 非法输入必须零写入`，`actual: 3, expected: 0`，`at TestContext.<anonymous> (…/tests/command.test.mjs:490:10)` |
| **B** | 把 `await assertRouteSelectable(llm, pin, fallback);` 替换为 `void llm; void pin; void fallback;`——即**跳过 route 校验** | `tests 25 / pass 24 / fail 1` | `✖ 4 非法 route：error 且 mutate 次数为 0（零写入）`；`AssertionError: {"kind":"success","text":"已设置本会话（lead-session）运行期钉：当前会话模型钉：provider=nope, model=some-model…"}`，`'success' !== 'error'`，`at …command.test.mjs:385:10` |
| **C** | 在 `set` 分支把 `settings.mutate(...)` **移到** `assertRouteSelectable` **之前**——即**先写后校验** | `tests 25 / pass 22 / fail 3` | `✖ 4 …（零写入）`：`AssertionError: 校验失败必须零写入`，`1 !== 0`，**`at …command.test.mjs:387:10`**（正是那条零写入断言）<br>`✖ 3a set 合法…`：`2 !== 1`，`at …command.test.mjs:338:10`（「恰好一次」断言）<br>`✖ 11 settings.mutate 拒绝…`（连带：重复 mutate 打破该用例前提） |

**结论**：

1. **测试确实在测行为**，不是「只看它绿」。
2. 注入 A 与注入 C 分别独立命中 **task-6 要求 6 与要求 4 的零写入断言**——即这两条断言在 `mutate` 被多余调用时**真的会失败**（这正是 lead 要求特别核对的两条）。注入 B 与 C 还共同覆盖了要求 4 的另一半（`kind` 必须为 `error`）。
3. 注入 C 的连带失败额外证明 `3a` 的「`mutate` 恰好一次」与 `11` 的写失败路径也是有效断言。

**工作区未被改动的证据**（抽检前后各一次，逐字相同）：

```
# BEFORE
be85f9ec7738de7b560a320f7aaf4bf751cf046518ece8017d4699d7a318dc48  /app/project/dsh-files/dsh-agent-team-model-pin/src/index.ts
# AFTER
be85f9ec7738de7b560a320f7aaf4bf751cf046518ece8017d4699d7a318dc48  /app/project/dsh-files/dsh-agent-team-model-pin/src/index.ts
```

**临时产物已清理**：`rm -rf /tmp/verifier-task7-WoJCMp`；复核后 `ls -d /tmp/verifier-task7-*` 与 `ls -d /tmp/atmp-cmd-*` 均无残留。清理后工作区再次 `node --test tests/*.test.mjs` → `tests 59 / pass 59 / fail 0`。（**注**：此处「工作区文件清单仍只有 10 个文件、无 `dist/`」是 `task-7` 当时的形态描述；`task-9` 之后包内已新增 `dist/`、`tsconfig.build.json`、`LICENSE`、`.gitignore`、`package-lock.json`、`.github/` 等，见「冻结工件」。）

### 10.5 新测试仍覆盖不到的部分

1. **slash 命令的真实触发**：`tests/command.test.mjs` 是通过 `commands.register` 拿到的 handler **直接调用**，绕过了「人类在输入框敲 `/`」这一层（SPEC 7.3）。命令是否出现在 `/` 菜单、`input.hint` 是否被 UI 正确渲染，仍未验证。
2. **真实 `ctx` 的真实服务**：假 ctx 的 `settings`/`llm`/`agentTeams` 都是手写替身。因此「`settings.mutate` 真的写进 `/app/.dsh/settings.yaml`」「`resolveModelInfo` 对该 provider 的真实行为」不在覆盖范围内。真实落盘只由 §9 的 e2e 审计间接佐证。
3. **审计的持久化细节**：`9b` 证明了「父路径不可写时不抛、只告警一次」，但用的是 `ENOTDIR`（父级是普通文件），不是权限拒绝（`EACCES`）或磁盘满（`ENOSPC`）。
4. **并发**：全部用例串行、单进程；`auditTail` 串行链在并发请求下的顺序性未验证（SPEC 非目标）。

---

## 11. C10 复核（task-9）：npm 发布形态与打包

`task-9` 把插件从「零构建本地 bundle」改造成**可发布到 npm 的公开包**（SPEC v1.3）。本节是对新形态的独立复核。**`src/pin.ts`、`src/index.ts`、`tests/*.mjs` 四项 hash 未变**，所以本节只审「发布与打包」这一新维度。

### 11.1 静态核对 `package.json` vs SPEC 第 6 节

| 契约项（SPEC §6 v1.3） | 实测 | 结论 |
|---|---|---|
| `exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } }` | 完全一致（另附 `"./package.json"` 子路径） | 符合 |
| `files` 只含 `dist`、`cordis.patch.yml`、`README.md`、`LICENSE` | `["dist","cordis.patch.yml","README.md","LICENSE"]` | 符合 |
| 运行时依赖是 `dependencies` 而非 peer：`@deepseek-ai/schemastery` 固定 `3.18.2` | `dependencies: {"@deepseek-ai/schemastery":"3.18.2"}`；**无** `peerDependencies` | 符合 |
| `devDependencies`: `typescript` + `@types/node` | `{"@types/node":"^26.6.2","typescript":"^7.0.2"}`（实装 `@types/node@26.6.2`、`tsc 7.0.2`） | 符合 |
| `tsconfig.json` 的 `types: ["node"]` | `["node"]` | 符合 |
| `tsconfig.build.json` 显式 `rootDir: "src"` + `rewriteRelativeImportExtensions` | `rootDir:"src"`、`outDir:"dist"`、`declaration:true`、`rewriteRelativeImportExtensions:true` | 符合 |
| 脚本 `typecheck`/`build`/`test`/`check`/`smoke:dist`/`prepublishOnly` | 六者齐备，`check = typecheck && build && test`，`prepublishOnly = check && smoke:dist` | 符合 |
| 包名 `@lolkda/dsh-agent-team-model-pin`，`private` 移除 | `name` 一致；`package.json` 中**无** `private` 字段 | 符合 |
| `publishConfig` / `repository` | `publishConfig:{access:"public",registry:"https://registry.npmjs.org/"}`；`repository.url = git+https://github.com/lolkda/dsh-agent-team-model-pin.git`（另有 `homepage`/`bugs`/`license:MIT`/`engines.node>=20`） | 符合（SPEC §6 未规定后两项，属合理补充） |
| 手工 `node_modules` 符号链接前提取消（9.15） | `node_modules/@deepseek-ai/schemastery` 现为**真实目录**（`test -L` → 非符号链接），由 `npm install` 落地 | 符合 |
| `cordis.patch.yml` 行内包名 | `name: '@lolkda/dsh-agent-team-model-pin'`（行 id 仍为 `agent-team-model-pin`） | 符合 |

**发布形态核对**：

```
$ grep -ho "from '[^']*'" dist/*.js | sort -u
from './pin.js'
from '@deepseek-ai/schemastery'
from 'node:fs/promises'
from 'node:os'
from 'node:path'

$ grep -n "from '\./[^']*\.ts'" dist/*.js
(无匹配) — 相对导入已全部改写为 .js

$ grep -ho "from '[^']*'" dist/*.d.ts | sort -u
from './pin.ts'          ← 9.14 所述：类型说明符保留 .ts

$ node -e "import('./dist/index.js').then(m=>console.log(m.name,JSON.stringify(m.inject),typeof m.apply))"
agent-team-model-pin ["agentTeams","commands"] function
```

### 11.2 构建可复现性（临时副本，**未在工作区跑 `npm ci`**）

**方法**：`tar` 打包排除 `node_modules` 与 `.git` 后解到 `mktemp -d /tmp/verifier-task9-XXXXXX`，在副本内执行。工作区的包内 `node_modules` 一个字节未被触碰（profile 正以 `link:` 指向该目录、行处于 `active`）。用后已 `rm -rf` 清理。

```
$ tar -cf - --exclude=./node_modules --exclude=./.git -C "$WORK" . | tar -xf - -C "$TMP"
$ cd "$TMP"
$ npm ci --no-audit --no-fund
added 7 packages in 716ms
[exit=0]

$ npm run typecheck
> tsc -p tsconfig.json
[exit=0]

$ npm run build
> tsc -p tsconfig.build.json
[exit=0]

$ npm test
ℹ tests 59 / ℹ pass 59 / ℹ fail 0
[exit=0]

$ npm run smoke:dist
dist entry OK: agent-team-model-pin ["agentTeams","commands"]
[exit=0]
```

**可复现性判定（关键）**：先把副本里随包带来的 `dist/` 记录 hash，然后 `rm -rf dist` 强制重新构建，再比对：

```
=== dist hashes BEFORE rebuild ===        === dist hashes AFTER rebuild ===
71c9f1f3…ceced  dist/index.js             71c9f1f3…ceced  dist/index.js
81d9536d…cc2bb  dist/index.d.ts           81d9536d…cc2bb  dist/index.d.ts
576e7100…d8338b dist/pin.js               576e7100…d8338b dist/pin.js
a06b756f…f2d850 dist/pin.d.ts             a06b756f…f2d850 dist/pin.d.ts
```

**结论：构建完全可复现** —— 4 个产物在「干净 `npm ci` + 从零 `build`」后与仓库中已有的 `dist/` **逐字节相同**。

### 11.3 发布产物清单（`npm pack --dry-run`，副本内）

```
$ npm pack --dry-run
npm notice 📦  @lolkda/dsh-agent-team-model-pin@1.0.0
npm notice Tarball Contents
npm notice 1.1kB LICENSE
npm notice 9.2kB README.md
npm notice 190B cordis.patch.yml
npm notice 3.1kB dist/index.d.ts
npm notice 18.2kB dist/index.js
npm notice 2.3kB dist/pin.d.ts
npm notice 8.2kB dist/pin.js
npm notice 1.8kB package.json
npm notice total files: 8
npm notice package size: 14.5 kB / unpacked size: 44.1 kB
[exit=0]
```

机器可读清单（`npm pack --json --dry-run`）与**负向检查**：

| 路径 | 是否在 tarball |
|---|---|
| `dist/index.js`、`dist/index.d.ts`、`dist/pin.js`、`dist/pin.d.ts` | ✅ 在内（4 个） |
| `cordis.patch.yml`、`README.md`、`LICENSE`、`package.json` | ✅ 在内（4 个） |
| `src/` | ❌ **ABSENT** |
| `tests/` | ❌ **ABSENT** |
| `docs/`（含本报告与 SPEC） | ❌ **ABSENT** |
| `.github/` | ❌ **ABSENT** |
| `tsconfig.json` / `tsconfig.build.json` | ❌ **ABSENT** |
| `node_modules/` | ❌ **ABSENT** |
| `package-lock.json` | ❌ **ABSENT** |

**结论：符合 SPEC §6** —— tarball 恰 **8 个文件**，只含 `dist/**` + `cordis.patch.yml` + `README.md` + `LICENSE` + `package.json`，源码/测试/docs/工作流全部留在仓库。

### 11.4 独立复核 9.14（`dist/index.d.ts` 保留 `'./pin.ts'` 说明符）

**方法**：在 `/tmp` 造一个消费者工程，`node_modules/@lolkda/dsh-agent-team-model-pin` 软链到**真实包目录**，`@types/node` 软链到包内 `node_modules/@types/node`；两份 `tsconfig` 均为 `module: nodenext` / `moduleResolution: nodenext` / `strict` / `types:["node"]`，只 `include` 不同。

**① 解析链（`--traceResolution`，关键三行）**

```
Resolving module '@lolkda/dsh-agent-team-model-pin' from '.../src/clean.ts'.
Found 'package.json' at '.../node_modules/@lolkda/dsh-agent-team-model-pin/package.json'.
File '.../dist/index.d.ts' exists - use it as a name resolution result.
→ resolved to '/app/project/dsh-files/dsh-agent-team-model-pin/dist/index.d.ts' (Package ID '…/dist/index.d.ts@1.0.0')

Resolving module './pin.ts' from '.../dist/index.d.ts'.
File name '.../dist/pin.ts' has a '.ts' extension - stripping it.
File '.../dist/pin.ts' does not exist.
File '.../dist/pin.d.ts' exists - use it as a name resolution result.
```

**② 干净消费者（只 `import { apply, name, inject }`）→ 无报错**

```
$ tsc -p tsconfig.clean.json
(无输出)
[exit=0]
```

**③ `const n: number = name` → 必须报 TS2322**

```
$ tsc -p tsconfig.bad.json
src/typecheck-probe.ts(2,7): error TS2322: Type 'string' is not assignable to type 'number'.
[exit=1]
```

**结论：9.14 独立复现成功。** TS 确实先剥离 `.ts` 再命中 `pin.d.ts`，因此 `name` 的真实类型是 `string`（而非 `any`）——`TS2322` 就是类型真实生效的证据。这与 SPEC 9.14 的裁定一致，故「不为 `.d.ts` 里的说明符改动源码」是可接受的决定。

### 11.5 风险观察：`dist/` 缺失时的 `npm pack`（**`task-10` 已修，见 §12.1**）

> ⚠️ **本节记录的是 `task-9` 时的问题状态；该问题已由 `task-10` 用 `prepare` 修掉。** 保留原始证据以便对照，最新结论见 **§12.1**。

`.gitignore:2` 忽略 `dist/`，`task-9` 时 `package.json` 的 `scripts` 中**没有 `prepare` / `prepack`**（只有 `prepublishOnly`）。在副本里模拟干净检出（`rm -rf dist`）后实测：

```
$ rm -rf dist && npm pack --dry-run
npm notice Tarball Contents
npm notice package size: 6.3 kB
npm notice unpacked size: 12.3 kB
npm notice total files: 4          ← 从 8 掉到 4，dist/ 完全没有进包
[exit=0]                            ← 但仍然 exit 0
```

即：**`npm pack` 在 `dist/` 缺失时会「成功」产出一个不可用的包**（`exports` 指向不存在的 `dist/index.js`）。影响面有限：

- `npm publish` **不受影响** —— `prepublishOnly` 会先跑 `check`（含 `build`）；
- CI（`.github/workflows/ci.yml`）与发布工作流（`release.yml`）都在 `pack`/`publish` **之前**显式 `npm run build`，顺序正确；
- 只有「人手动在干净检出上跑 `npm pack`」会踩到。

**当时的判定**：不构成 SPEC 偏离（SPEC §6 只要求那六个脚本），建议加一行构建前置脚本。**后续**：`task-10` 加了 `"prepare": "npm run build"`（覆盖面比 `prepack` 更广），SPEC §6 同步；独立复现确认现在为 8 文件且含 `dist/**`（§12.1）。**已关闭。**

### 11.6 新形态下既有结论复核

| 复核项 | 命令 | 结果 |
|---|---|---|
| 单测仍全绿 | `node --test tests/*.test.mjs` | `tests 59 / pass 59 / fail 0` |
| `agent/request` 监听仍恰 1 个 | `grep -c "ctx.on('agent/request'" src/index.ts` | `1`（`src/index.ts:538`） |
| 行仍 active 且模块名已切换 | `plugin_manager action=list_plugins`（两页，只读） | `{"entryId":"include:agent-team-model-pin","moduleName":"@lolkda/dsh-agent-team-model-pin","enabled":true,"fiberPhase":"active"}` |
| profile 侧已切换 | 读 `/app/.dsh/profiles/web/package.json` | `dependencies` 与 `dsh.profile.bundles` 均为 `@lolkda/dsh-agent-team-model-pin`（无 `@local/*` 引用） |
| 开发期符号链接前提已取消 | `test -L node_modules/@deepseek-ai/schemastery` | **非符号链接**（真实目录），符合 9.15 |
| 类型检查自足 | `npm run typecheck` | 无输出、`exit=0`（见 §8.4） |

---

## 12. C11 收尾复核（task-10）：`prepare` 修复 + e2e#2

`task-9` 报出两项待办（打包陷阱、改名后未重跑 e2e），`task-10` 均处理。本节是对处理结果的独立复核。

### 12.1 打包陷阱已修（用 `prepare`，不是 `prepack`）

**改动**：`package.json` 新增 `"prepare": "npm run build"`（`sha256 b58b9751…82a0` → `ec086d4a…7219`）；SPEC §6 脚本清单那一行同步（`docs/SPEC.md:228`）；README §6 脚本表与「打包」段同步。

**为何 `prepare` 比 `prepack` 覆盖面更广**（Lead 的选型，我复核认可）：`prepare` 由 npm 在 `npm install`、`npm ci`、`npm pack`、`npm publish` 以及 **git 安装**时运行；`prepack` 只覆盖 `pack`/`publish`。所以 git 依赖安装路径也被兜住。

**独立复现（临时副本 `/tmp/verifier-task10-2ADV0z`，`tar` 排除 `node_modules`/`.git`；用后已 `rm -rf` 清理，无残留）**

```
# (a) 依赖已装（npm ci 之后）→ 删掉 dist 再打包
$ rm -rf dist && npm pack --dry-run
> @lolkda/dsh-agent-team-model-pin@1.0.0 prepare
> npm run build
> tsc -p tsconfig.build.json
npm notice total files: 8
[exit=0]
$ ls dist/
index.d.ts  index.js  pin.d.ts  pin.js
$ sha256sum dist/*      # 与仓库中已有 dist 逐字节相同
81d9536d…cc2bb  dist/index.d.ts
71c9f1f3…ceced  dist/index.js
a06b756f…f2d850 dist/pin.d.ts
576e7100…d8338b dist/pin.js
```

**修复前后对照**：`task-9` 时同样操作得到 **4 个文件、不含 `dist/`、仍 exit 0**（静默空壳包）；现在得到 **8 个文件、含 4 个 `dist/**`、exit 0**。

```
# (b) npm ci 是否触发 prepare？→ 是
$ rm -rf dist node_modules && npm ci --no-audit --no-fund
> @lolkda/dsh-agent-team-model-pin@1.0.0 prepare
> npm run build
> tsc -p tsconfig.build.json
added 7 packages in 1s
[exit=0]
$ sha256sum dist/*      # 同样逐字节一致
```

```
# (c) tarball 清单（prepare 重建后）
LICENSE / README.md / cordis.patch.yml / package.json
dist/index.d.ts / dist/index.js / dist/pin.d.ts / dist/pin.js
TOTAL files: 8
dist/** present: ['dist/index.d.ts','dist/index.js','dist/pin.d.ts','dist/pin.js']
src/  -> ABSENT ok      tests/ -> ABSENT ok     docs/ -> ABSENT ok
.github/ -> ABSENT ok   tsconfig -> ABSENT ok
```

**新边界（已知、非缺陷，比修复前更安全）**：若**连依赖都没装**（刚 clone 直接 `npm pack`），`prepare` 里的 `tsc` 不存在 →

```
$ npm pack --dry-run          # 无 node_modules 时
> @lolkda/dsh-agent-team-model-pin@1.0.0 prepare
> npm run build
sh: 1: tsc: not found
npm error code 127
npm error command sh -c npm run build
[npm pack exit=127]
```

即**明确失败**（exit 127）而非静默产出空壳包。这是可接受的行为：没有依赖本就无法构建。先 `npm ci`/`npm install` 即可。已写入 README §6。

**结论：§11.5 报的陷阱已修，且修复方式覆盖面正确。**

### 12.2 e2e#2 证据独立核对

完整字段级核对见 **§9.3**（含 6 行审计、投影缓存、逐项期望 vs 实测）。要点：

- 审计 6 行，sha256 `fa99df80…b7d2`；第 4–6 行 agentId = `d49d5ca1-cbf4-405c-8b40-a15239ef8b7f`（`pin-e2e2`），首行 `from cpa/deepseek-flash/high → to cpa/deepseek-flash/low`；
- `sessionId` = `session-26ad87e0-…`（Lead 会话，符合 R2）；`role` = `teammate`；6 行中**无** Lead 的 agentId；
- 投影缓存 `modelSelection.val.lastUsed = {cpa, deepseek-flash, low}`、`pending: null`，与审计一致；
- 前 3 行（e2e#1）**逐字未变**，两轮 agentId 不混。

**如实区分**：e2e#2 只证明 **effort 改写**（`high → low`，provider/model 未变，即 R4 的 effort-only 分支）与**新形态（dist 入口）下仍生效**；**模型切换能力仍只由 e2e#1 的 `deepseek-flash → gpt-6-astra` 证明**。详见 §9.4 的分工表。

### 12.3 中性状态与安装态确认

```
$ cat /app/.dsh/profiles/web/cordis.patch.yml
# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; `!!js` expressions allowed).
[]
```

`plugin_manager action=list_plugins`（两页，只读）→ 行仍为：

```json
{"entryId":"include:agent-team-model-pin","moduleName":"@lolkda/dsh-agent-team-model-pin","enabled":true,"fiberPhase":"active","patchId":"agent-team-model-pin"}
```

```
$ ls /app/.dsh/profiles/web/node_modules/@local/
ls: cannot access '/app/.dsh/profiles/web/node_modules/@local/': No such file or directory
```

**结论**：profile 组合已恢复中性（`[]`，不钉任何人）；插件行仍 `active`；`task-9` 报的孤儿符号链接**已清理**。`dist/` 的 mtime 为 04:54:59（被 `prepare` 重建过），但 **4 个文件的 hash 与 `task-9` 记录逐字相同**——再次佐证构建可复现。

### 12.4 复跑（工作区与副本一致）

```
# 工作区
$ node --test tests/*.test.mjs     ℹ tests 59 / pass 59 / fail 0
$ npm run typecheck                [exit=0]（无输出）
$ npm run build                    [exit=0]
$ npm run smoke:dist               dist entry OK: agent-team-model-pin ["agentTeams","commands"]

# 临时副本（干净 npm ci 之后）
node --test tests/*.test.mjs       ℹ tests 59 / pass 59 / fail 0
npm run typecheck exit=0 / npm run build exit=0 / smoke:dist → dist entry OK
```

---

## 13. 偏离项清单

**无偏离项。** 本次验证未发现实现与 SPEC（第 4–7 节行为规则 + §9 v1.1/v1.2/v1.3 裁定）不一致之处；`task-5` 修复后类型检查干净，单测全绿，反向检查全部未违反；`task-7` 复核中 3 个注入缺陷**全部**被现有测试捕获；`task-9` 的打包/发布形态符合 SPEC §6；`task-10` 的 `prepare` 修复经独立复现确认陷阱消失，e2e#2 证据字段一致、中性状态已恢复。**§11.5 与 §1 曾列的两项风险观察均已关闭。**

若后续有人改动 `src/`、`tests/`、`package.json`、`cordis.patch.yml`、`tsconfig.json`，本次结论即失效——请对照 §「冻结工件」的 `sha256` 判断是否仍成立。

---

## 14. 本次未验证项（明确清单）

> 状态列反映 `task-10` 收尾复核后的最新结论，共 **9 项仍缺**（首版 9 项 → task-6/7 覆盖 2 项 → task-9 新增 5 项 → **task-10 覆盖 1 项（原第 8 项）、关闭 1 项（原第 11 项）**）。

| # | 未验证项 | 状态 | 原因 | 影响 / 补验建议 |
|---|---|---|---|---|
| 1 | **slash 命令 `/team-model` 的真实触发与 `/` 菜单可见性** | **仍缺** | 模型侧无法在输入框敲 `/` 命令（SPEC 7.3）。`tests/command.test.mjs` 是直接调用 handler，绕过了 UI 触发层 | 「命令注册成功但菜单不显示」「hint 渲染异常」这类故障测不到。**仍需人类**在输入框敲一次 `/team-model`（建议再敲 `/team-model a` 确认错误文本） |
| 2 | ~~handler 函数体未被任何测试执行~~ → **已覆盖**；剩余：**真实服务落盘** | **部分已覆盖** | ✅ 已覆盖：`tests/command.test.mjs` 25 例真正执行了 handler 与请求监听器，R6「零写入」与 R6b 返回文本现有**运行时**断言（§10.2 第 4、5、6 条）。❌ 仍缺：假 ctx 是手写替身，「`settings.mutate` 真的写进 `/app/.dsh/settings.yaml`」只由 §9 的 e2e 审计间接佐证 | 补验建议：真实敲一次 `/team-model cpa <model>`，再读 `/app/.dsh/settings.yaml` 确认 `agent-team-model-pin.sessions.<sessionId>` 落盘 |
| 3 | **端到端整体流程** | **仍缺**（超出我的角色） | 由 **lead** 执行（SPEC 7.2）。本报告 §9 只做**只读字段核对**，未跑、未复现 | 无法独立重现「安装→设钉→建队友→观察→恢复」全过程（两轮 e2e 均由 lead 跑） |
| 4 | **「队友实际发送给提供商的 model」** | **仍缺** | 需要抓包或服务端侧证据；`projcache`/`audit.jsonl` 都是进程内状态 | SPEC 7.2 第 3 步（读队友会话记录确认落库请求路由）未在本报告内独立完成 |
| 5 | **`agentTeams` 服务缺失时不激活的运行时负例** | **仍缺** | 无法在本 profile 运行时移除 `agentTeams`（会破坏 Agent Team 本身）。新测试的假 ctx 可以删掉 `agentTeams` 属性，但那测的是 `apply` 的行为，**不是** Cordis `inject` 门控本身 | 只剩代码层证据（`src/index.ts:224` 的 `inject` 声明）；「不激活、不报错、不抛」的**负例观察**未取得 |
| 6 | ~~离线是否能安装 `@types/node`、联网补 devDep 后的裸跑~~ → **已解决** | **已解决** | ✅ v1.3 已把 `@types/node` 加为 devDependency 并声明 `types:["node"]`，实测 `npm run typecheck` 无输出 exit 0（§8.4）。本机 npm registry 可达（`npm ping` PONG），`npm ci` 在临时副本内成功（§11.2、§12.1） | 无需补验 |
| 7 | ~~审计写入失败的运行时负例~~ → **已覆盖（受限）** | **已覆盖，含一种失败模式** | ✅ `tests/command.test.mjs:606-634`（用例 `9b`）已构造审计写入失败（父路径是普通文件 → `mkdir` `ENOTDIR`），并断言请求**仍被钉住**、告警**恰一次**。❌ 未覆盖 `EACCES`（权限拒绝）与 `ENOSPC`（磁盘满）两种失败模式 | 「写失败只告警一次、绝不阻断请求」现有**运行时**证据；如需更强，可加只读目录或满盘场景 |
| 8 | ~~改名后的队友 e2e 未重跑~~ → **已覆盖（`task-10`）** | **已覆盖，范围受限** | ✅ `task-10` 在**新形态**（`@lolkda` + `dist` 入口）下重跑 e2e：审计第 4–6 行 agentId `d49d5ca1…`（`pin-e2e2`）、`from cpa/deepseek-flash/high → to cpa/deepseek-flash/low`，投影缓存一致（§9.3、§12.2）。⚠️ **本轮只覆盖 effort 改写**：`provider`/`model` 未变，**模型切换能力仍只由 e2e#1 的 `deepseek-flash → gpt-6-astra` 证明**（§9.4） | 已覆盖「新形态下对真实队友生效」。若要单独再证一次「新形态下的模型切换」，可再用 `@lolkda` 安装钉一个**不同 model** 跑一轮 |
| 9 | **GitHub Actions 工作流从未真实运行过** | **仍缺** | `.github/workflows/{ci,release}.yml` 只做了静态阅读；本机无 GitHub runner、仓库无 remote、`git log` 为空（无任何提交）。我**没有**执行也无法执行它们 | 「工作流语法/权限/矩阵正确」「`npm ci` 在 ubuntu-latest 上可解」「`npm pack --dry-run` 步骤真能跑通」均未经运行验证。补验建议：推到 GitHub 后看首次 CI 结论。**注**：ci.yml 的 build 步骤在 `prepare` 之外仍独立存在，两者不冲突 |
| 10 | **`npm publish` 未执行** | **仍缺** | 本机未登录 npm（无 `.npmrc` token），且发布是**不可逆的对外动作**，超出本次只读复核范围。`release.yml` 的 `NPM_TOKEN` secret 是否存在也**无法从本机确认** | 「包能否真正发布成功」「provenance/OIDC 是否工作」「`prepublishOnly` + `prepare` 在真实 publish 路径上的叠加行为」均未验证。`npm pack --dry-run`（§11.3、§12.1）是**替代**证据，不等于真实发布 |
| 11 | ~~`prepack` 缺失导致的打包陷阱~~ → **已修（`task-10`）** | **已关闭** | ✅ `task-10` 加了 `"prepare": "npm run build"`（覆盖面含 `npm pack`/`npm publish`/git 安装），SPEC §6 同步。我独立复现：`npm ci && rm -rf dist && npm pack --dry-run` → 自动重建 → **8 文件含 `dist/**`**、exit 0（§12.1）。⚠️ 唯一残留边界：**连依赖都没装**时 `npm pack` 会明确报错（`tsc: not found`，exit 127），不会静默产空壳包 | 无需补验；README §6 已写明该边界 |
| 12 | **多进程并发写同一审计路径的行为** | **仍缺**（SPEC 非目标） | 全部用例串行、单进程；`auditTail` 串行链在并发请求下的顺序性也未验证 | 已作为已知限制写入 README §7 |

**已从首版清单中移除/关闭的项**：首版第 2 项中「handler 函数体未被任何测试执行」、第 7 项「审计写入失败的运行时负例」、以及 §6 边界核对中 4 项的运行时证据——已由 `tests/command.test.mjs` 覆盖（§10.2）；首版第 6 项（`@types/node` 环境限制）由 v1.3 解决（§8.4）；原第 8 项「改名后 e2e 未重跑」由 `task-10` 的 e2e#2 覆盖（§9.3）；原第 11 项「打包陷阱」由 `task-10` 的 `prepare` 修复并关闭（§12.1）。**剩余 9 项中有 2 项（第 9、10）是「从未在真实 CI/npm 环境执行」，属环境与授权边界，不是实现缺陷。**

---

## 15. 复现命令速查

全部命令的工作目录为 `dsh-agent-team-model-pin/`。

```bash
# C1 / C9 全量单元测试（59 例）
node --test tests/*.test.mjs
node --test tests/pin.test.mjs        # 34 例（A1-A7）
node --test tests/command.test.mjs    # 25 例（handler + 请求监听器）

# C2 A1-A7 用例名映射
grep -o "^test('[^']*'" tests/pin.test.mjs | sort

# C7 类型检查（v1.3 起包内自足，无需 --typeRoots 变通）
node node_modules/.bin/tsc -p tsconfig.json     # 裸跑：应无输出、exit 0（§8.4）
npm run typecheck                               # 同上，经 npm 脚本
# 首版记录的历史变通（仍可用，结果相同）：
node /app/project/dsh-files/dsh-file-manager-ts/node_modules/typescript/bin/tsc \
  -p tsconfig.json --noEmit \
  --typeRoots /app/project/dsh-files/dsh-file-manager-ts/node_modules/@types --types node

# C7 源码入口 smoke（同时证明 .ts 可被 Node strip 加载）
node -e "import('./src/index.ts').then(m=>console.log(m.name, JSON.stringify(m.inject), typeof m.apply))"
# C10 发布入口 smoke
npm run smoke:dist

# C4 反向检查
grep -c "ctx.on('agent/request'" src/index.ts
grep -n "ctx\.set\|ctx\.provide\|registerTool\|toolSchema\|ctx\.tool\|\.remote(" src/*.ts
grep -n "^import\|from '" src/*.ts
find . -path ./node_modules -prune -o -name dist -print
find /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai \
     /usr/local/lib/node_modules/@deepseek-ai/dsh/lib \
     -newermt "2026-09-20 04:30"        # 官方包/preset 应无新于安装时间的文件

# C6 依赖落地形态（v1.3：应为真实目录，非符号链接）
test -L node_modules/@deepseek-ai/schemastery && echo SYMLINK || echo "REAL DIR (expected)"

# 工件指纹（判断本次结论是否仍有效）
sha256sum src/pin.ts src/index.ts tests/pin.test.mjs tests/command.test.mjs \
          package.json package-lock.json tsconfig.json tsconfig.build.json \
          cordis.patch.yml .gitignore LICENSE docs/SPEC.md README.md \
          dist/index.js dist/index.d.ts dist/pin.js dist/pin.d.ts \
          .github/workflows/ci.yml .github/workflows/release.yml
```

**C10 打包复核的复现（只读工作区：一切都在临时副本里做）**

```bash
WORK=/app/project/dsh-files/dsh-agent-team-model-pin
# ⚠️ 不要在工作区跑 npm ci —— 它会删掉包内 node_modules，而 profile 正以 link: 指向该目录
TMP=$(mktemp -d /tmp/verifier-task9-XXXXXX)
tar -cf - --exclude=./node_modules --exclude=./.git -C "$WORK" . | tar -xf - -C "$TMP"
cd "$TMP"
npm ci --no-audit --no-fund        # 7 packages
npm run typecheck && npm run build && npm test && npm run smoke:dist
# 构建可复现性：记录 dist hash → 删除 → 重建 → 比对
sha256sum dist/* > /tmp/before.txt && rm -rf dist && npm run build
sha256sum dist/* > /tmp/after.txt  && diff /tmp/before.txt /tmp/after.txt && echo "REPRODUCIBLE"
# 发布产物清单
npm pack --dry-run                 # 期望 8 个文件，无 src/tests/docs/.github
npm pack --json --dry-run | python3 -c "import json,sys;[print(f['path']) for f in json.load(sys.stdin)[0]['files']]"
cd / && rm -rf "$TMP"
```

**C11 `prepare` 修复的复现（task-10；仍在临时副本里做）**

```bash
WORK=/app/project/dsh-files/dsh-agent-team-model-pin
TMP=$(mktemp -d /tmp/verifier-task10-XXXXXX)
tar -cf - --exclude=./node_modules --exclude=./.git -C "$WORK" . | tar -xf - -C "$TMP"
cd "$TMP"
npm ci --no-audit --no-fund          # 输出里应出现 "> prepare" → "> build"（证明 npm ci 触发构建）
# (a) 依赖已装 → 删掉 dist 再打包：prepare 应自动重建
rm -rf dist && npm pack --dry-run    # 期望："> prepare"/"> build" + total files: 8 + exit 0
ls dist/ && sha256sum dist/*         # 4 个文件，hash 应与仓库中一致
# (b) 新边界：连依赖都没装时打包会明确失败（而不是静默空壳包）
mv node_modules /tmp/_held_nm && rm -rf dist
npm pack --dry-run                   # 期望：sh: 1: tsc: not found → npm error code 127
mv /tmp/_held_nm node_modules
cd / && rm -rf "$TMP"
```

**C11 e2e#2 证据的只读核对（不要自己触发请求）**

```bash
wc -l /app/.dsh/agent-team-model-pin/audit.jsonl            # 期望 6
sha256sum /app/.dsh/agent-team-model-pin/audit.jsonl        # fa99df80…b7d2
tail -3 /app/.dsh/agent-team-model-pin/audit.jsonl          # agentId d49d5ca1…，high → low
python3 -c "
import json
d=json.load(open('/app/.dsh/storages/session_projcache/sessions/d49d5ca1-cbf4-405c-8b40-a15239ef8b7f.json'))
print(json.dumps(d['record']['rows']['modelSelection'], ensure_ascii=False))"
cat /app/.dsh/profiles/web/cordis.patch.yml                 # 期望 []
ls /app/.dsh/profiles/web/node_modules/@local/ 2>&1         # 期望 No such file or directory
```

**C10 / 9.14 消费者编译探针的复现**

```bash
WORK=/app/project/dsh-files/dsh-agent-team-model-pin
C=$(mktemp -d /tmp/verifier-task9-consumer-XXXXXX)
mkdir -p "$C/node_modules/@lolkda" "$C/node_modules/@types" "$C/src"
ln -s "$WORK" "$C/node_modules/@lolkda/dsh-agent-team-model-pin"
ln -s "$WORK/node_modules/@types/node" "$C/node_modules/@types/node"
printf '{ "name": "consumer-probe", "private": true, "type": "module" }\n' > "$C/package.json"
# 两份 tsconfig，均为 nodenext + strict + types:["node"]，只有 include 不同
#   tsconfig.clean.json -> src/clean.ts           : import { apply, name, inject } from '@lolkda/...'
#   tsconfig.bad.json   -> src/typecheck-probe.ts : const n: number = name;
cd "$C"
"$WORK/node_modules/.bin/tsc" -p tsconfig.clean.json                  # 期望：无输出、exit 0
"$WORK/node_modules/.bin/tsc" -p tsconfig.bad.json                    # 期望：TS2322
"$WORK/node_modules/.bin/tsc" --traceResolution -p tsconfig.clean.json | grep -A3 "Resolving module './pin.ts'"
cd / && rm -rf "$C"
```

**C9 破坏性抽检的复现（只读工作区：改的是临时副本）**

```bash
WORK=/app/project/dsh-files/dsh-agent-team-model-pin
sha256sum "$WORK/src/index.ts"                 # BEFORE，应为 be85f9ec…dc48
TMP=$(mktemp -d /tmp/verifier-task7-XXXXXX)
cp -a "$WORK/." "$TMP/"                        # 含 node_modules 符号链接
cd "$TMP" && node --test tests/*.test.mjs      # 副本基线：59 pass
# 注入缺陷（示例：让非法输入也写入）——只改 $TMP
python3 - "$TMP/src/index.ts" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
old = "        if (plan.action === 'invalid') return { kind: 'error', text: plan.error };"
new = ("        if (plan.action === 'invalid') {\n"
       "          const s0 = settingsService();\n"
       "          const sid0 = ctx.agentTeams.tryMembership(agent)?.root?.id ?? agent.id;\n"
       "          if (s0) { await s0.mutate(SETTINGS_NS, [{ op: 'unset', path: ['sessions', sid0] }]); }\n"
       "          return { kind: 'error', text: plan.error };\n        }")
assert s.count(old) == 1
open(p, 'w', encoding='utf-8').write(s.replace(old, new))
PY
cd "$TMP" && node --test tests/command.test.mjs   # 期望：✖ 6 …（mutateCalls 3 !== 0）@ command.test.mjs:490
cd / && rm -rf "$TMP"
sha256sum "$WORK/src/index.ts"                 # AFTER，必须仍为 be85f9ec…dc48
```

`plugin_manager action=list_plugins` 与 `plugin_manager action=list_plugins offset=100`（只读）用于 C6；`/app/.dsh/agent-team-model-pin/audit.jsonl` 与 `/app/.dsh/storages/session_projcache/sessions/06ecb40b-cf1b-4748-9b51-bd12c69159f1.json` 的只读读取用于 §9 交叉核对。