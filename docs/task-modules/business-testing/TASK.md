# 业务测试自动化 - 任务计划

> **所属主 TASK**：[TASK.md](../../TASK.md)  
> **关联 PRD 模块**：[PRD.md](../../prd-modules/business-testing/PRD.md)  
> **关联 ARCH 模块**：[ARCH.md](../../arch-modules/business-testing/ARCH.md)  
> **关联 ADR**：[ADR-038](../../adr/038-arch-business-test-automation.md)  
> **状态**：P1 最小闭环 `TASK-BIZTEST-001~011` 已完成，验收通过 / Go；P2~P4 另行立项
> **Task state Gate**：`TASK_PLANNED` → `TDD_DONE` → `QA_VALIDATED`
> **Story→Task ID**：`US-BIZTEST-001~006` / `TASK-BIZTEST-001~011` / `TC-BIZTEST-001~022`；主 TASK 对应 §2 模块任务索引与 §7 相关文档
> **负责团队**：@template-maintainers  
> **最后更新**：2026-10-07
> **版本**：v0.2.0

## 1. 模块概述

让实际项目中的大模型依据 PRD 推导页面或客户端的业务操作路径与测试用例，再由脚本确定性地完成路径校验、套件运行、结果绑定与 `qa verify` 门禁判定。本模块交付 PRD 里程碑 P1 最小闭环：在 `infra/scripts/qa-tools/` 新增 6 个零第三方依赖的脚本，接入 `agent-cli.js` 与 `qa-verify.js`，并随模板更新传播 PRD/QA 模板、`PATHS-TEMPLATE.md`、QA 指引与四个角色文件的约束（ADR-038）。

- 范围：`US-BIZTEST-001~006`；组件 `BIZTEST-SVC-001~008` 与 `BIZTEST-API-001`。
- 非范围：PRD 里程碑 P2（`qa plan` 生成 TC 骨架、断言质量检查）、P3（架构包 Playwright 与客户端驱动脚手架）、P4（flaky 策略、变异抽样、人工验收记录、性能与安全测试）另行立项，本计划不为其设置 Task ID。
- 方法：创作期由模型按指引推导路径与用例；脚本期只做解析、校验、运行、绑定与判定，不调用模型与网络，不依赖模型自述。
- 顺序：每个实现任务先写失败的定向测试（RED），再实现（GREEN）；任务 001 冻结夹具与规格层、配置层 RED，其余任务在各自开头补写本层 RED。
- 治理关系：PRD、ARCH 已完成；收尾流水线（`tdd sync` → `tdd push` → `qa plan` → `qa verify` → `qa merge`）由 task state 步骤承担，不作为 WBS 任务。

交付产物：

- 脚本：`business-spec.js`、`business-config.js`、`business-results.js`、`qa-paths.js`、`qa-run.js`、`qa-business-gate.js`，均位于 `infra/scripts/qa-tools/`。
- 接入：`infra/scripts/agent-runner/agent-cli.js` 路由 `qa paths`、`qa run`；`qa-verify.js` 业务门禁；`qa-verification-state.js` 导出 `worktreeReceiptKey`；`infra/templates/agent/config.example.json` 的 `qa.business` 默认值。
- 模板与指引：PRD/QA 模块模板与示例、`docs/data/templates/qa/PATHS-TEMPLATE.md` 与 manifest 所有权登记、QA playbook 章节、PRD/ARCH/QA/TDD 角色文件、`docs/CONVENTIONS.md`、`infra/scripts/qa-tools/README.md`。
- 测试：`infra/scripts/qa-tools/__tests__/` 下的定向测试与夹具，用例名携带 AC/TC 标识。

## 2. WBS（工作分解结构）

### 2.1 任务列表

| Task ID | 名称 | 负责人 | 工时 | 优先级 | 前置任务 | 状态 | 完成日期 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TASK-BIZTEST-001 | RED：夹具与规格层、配置层失败测试 | @tdd | 0.5d | P0 | - | ✅ 已完成 | 2026-10-06 |
| TASK-BIZTEST-002 | 规格解析器 `business-spec.js` | @tdd | 1d | P0 | TASK-BIZTEST-001 | ✅ 已完成 | 2026-10-06 |
| TASK-BIZTEST-003 | 路径校验器与 `qa paths`（`qa-paths.js`） | @tdd | 1d | P0 | TASK-BIZTEST-002 | ✅ 已完成 | 2026-10-06 |
| TASK-BIZTEST-004 | 配置解析器 `business-config.js` 与 `qa.business` 默认值 | @tdd | 0.5d | P0 | TASK-BIZTEST-001 | ✅ 已完成 | 2026-10-06 |
| TASK-BIZTEST-005 | 结果绑定器 `business-results.js`（JUnit 解析与结果文件） | @tdd | 1d | P0 | TASK-BIZTEST-002 | ✅ 已完成 | 2026-10-06 |
| TASK-BIZTEST-006 | 套件运行器与 `qa run`（`qa-run.js`） | @tdd | 1d | P0 | TASK-BIZTEST-003、TASK-BIZTEST-004、TASK-BIZTEST-005 | ✅ 已完成 | 2026-10-06 |
| TASK-BIZTEST-007 | 业务验收门禁 `qa-business-gate.js` | @tdd | 1d | P0 | TASK-BIZTEST-003、TASK-BIZTEST-004、TASK-BIZTEST-005 | ✅ 已完成 | 2026-10-06 |
| TASK-BIZTEST-008 | 命令路由与 `qa verify` 门禁接入 | @tdd | 0.5d | P0 | TASK-BIZTEST-006、TASK-BIZTEST-007 | ✅ 已完成 | 2026-10-06 |
| TASK-BIZTEST-009 | 模板、示例与所有权传播 | @tdd / @template-maintainers | 0.5d | P0 | TASK-BIZTEST-003 | ✅ 已完成 | 2026-10-06 |
| TASK-BIZTEST-010 | 指引与角色文件同步 | @tdd / @qa | 1d | P1 | TASK-BIZTEST-008、TASK-BIZTEST-009 | ✅ 已完成 | 2026-10-06 |
| TASK-BIZTEST-011 | 闭环夹具与非功能验证 | @qa / @tdd | 1d | P0 | TASK-BIZTEST-008、TASK-BIZTEST-010 | ✅ 已完成 | 2026-10-06 |

合计约 9 人日，关键路径约 6 人日（见 §3）。

### 2.2 任务详细说明

- `TASK-BIZTEST-001`（RED，US-BIZTEST-001/002/003）
  - 输入：PRD 原子 AC 表、ARCH §4 原子 AC 表与路径模型语法、`qa.business` 配置约束。
  - 输出：`infra/scripts/qa-tools/__tests__/fixtures/business-testing/`（合法与逐类违规的原子 AC 表、合法与逐类违规的 `PATHS.md`、JUnit 样本、桩套件命令）；先失败的 `business-spec.test.js`（TC-BIZTEST-001、003）、`qa-paths.test.js`（TC-BIZTEST-004~006）、`business-config.test.js`（配置校验与摘要），测试名携带 AC/TC 标识。
  - 验收：`Given` 夹具与测试已落盘 `When` 执行 `pnpm agent -- test --file <测试文件> -- node --test` `Then` 因被测模块缺失而非零退出，失败原因不是夹具或语法错误；RED 退出码写入 step evidence。
  - 依赖：无；是 002、004 的前置。
- `TASK-BIZTEST-002`（US-BIZTEST-001/002；BIZTEST-SVC-001）
  - 输入：任务 001 的夹具与测试、`governance-ids.js` 的 `AC_ID_SOURCE`、`TEST_CASE_ID_SOURCE`、`STORY_ID_SOURCE`、`MODULE_ID_SOURCE`。
  - 输出：`business-spec.js`——原子 AC 表识别与解析（直接子级 Markdown、转义竖线还原）、`PATHS.md` 四表与覆盖准则解析、`SCR-`/`STA-`/`TRN-`/`PTH-` 标识语法、逐项违规（稳定代码、文件、行号），全部输出按标识排序；纯函数，文件读取可注入。
  - 验收：`Given` 含 5 条合法原子 AC 的模块 PRD `When` 解析 `Then` 返回 5 条 AC 及 Story、优先级、验证、端、Given/When/Then、TC；`Given` 逐类违规夹具 `When` 解析 `Then` 每类违规输出对应稳定代码与行号（AC-BIZTEST-001-01、002-01）。
  - 依赖：001 的夹具；是 003、005 的前置。
- `TASK-BIZTEST-003`（US-BIZTEST-002；BIZTEST-SVC-003）
  - 输入：002 的规格模型、ARCH §3 `qa paths` 调用链与输出契约。
  - 输出：`qa-paths.js`——引用、衔接、覆盖准则、P0 自动化 AC 关联校验；`STATUS`/`SUMMARY`/`NEXT_ACTION`/计数/`MATRIX_AC`/`MATRIX_PATH`/`VIOLATION` 行；只读、不创建目录；导出供门禁复用的校验函数。
  - 验收：`Given` 转移引用不存在的状态或路径相邻转移不衔接 `When` 执行 `qa paths` `Then` `STATUS=BLOCKED`、退出码非零并逐项列出 `VIOLATION`；`Given` 声明 `all-transitions` 而路径未覆盖全部转移 `Then` `COVERAGE_GAP`；`Given` 合法模型 `Then` `STATUS=OK` 并输出覆盖矩阵与计数（AC-BIZTEST-002-02~04）。
  - 依赖：002；是 006、007、009 的前置。
- `TASK-BIZTEST-004`（US-BIZTEST-003/004；BIZTEST-SVC-002）
  - 输入：ARCH §4 `qa.business` 配置约束、`config.example.json` 现有 `qa` 配置块。
  - 输出：`business-config.js`（逐项违规、规范化、`sha256:` 配置摘要且不含 `enabled`）；`infra/templates/agent/config.example.json` 增加 `qa.business` 默认值（`enabled:false`、`requiredPriorities:["P0"]`、`suites:[]`）；`business-config.test.js` 转为 GREEN，并核对既有配置默认值测试不受影响。
  - 验收：`Given` 套件名重复、`timeoutSeconds` 越界或 `report` 越出仓库 `When` 校验 `Then` 逐项违规；`Given` 仅切换 `enabled` `Then` 配置摘要不变；`Given` 默认配置 `Then` 业务门禁关闭（AC-BIZTEST-004-03、004-04 的配置部分、AC-BIZTEST-003-01 的套件约束）。
  - 依赖：001；是 006、007 的前置。
- `TASK-BIZTEST-005`（US-BIZTEST-003；BIZTEST-SVC-005、BIZTEST-API-001）
  - 输入：ARCH §3 状态语义、§4 报告约定与绑定语义、§5 `ac-results.json` 字段。
  - 输出：先写 `business-results.test.js`（RED）；`business-results.js`——安全 JUnit 解析（仅 UTF-8、拒绝 `<!DOCTYPE` 与实体声明、单报告 64 MiB 上限、零用例即 `report_invalid`）、按 AC/TC 标识绑定与按端聚合（`error` > `failure` > `skipped` > `passed`）、未标识用例计数与 `unknown_ids`、报告副本与 `ac-results.json` 的原子写入与读取、报告 SHA256。
  - 验收：`Given` 报告含通过的 `AC-…` 用例与跳过的 `TC-…` 用例 `When` 绑定 `Then` AC 为 `passed`、TC 为 `skipped`，不含标识的用例只计入未标识数；`Given` 含 `<!DOCTYPE` 的报告 `Then` 该套件为 `report_invalid`；`Given` 同一 TC 的多条数据行有一条失败 `Then` 聚合为 `failed`（AC-BIZTEST-003-02~04）。
  - 依赖：002；是 006、007 的前置。
- `TASK-BIZTEST-006`（US-BIZTEST-003；BIZTEST-SVC-004）
  - 输入：003 的静态校验、004 的配置、005 的绑定与结果写入、ARCH §3 `qa run` 调用链。
  - 输出：先写 `qa-run.test.js`（RED，用夹具桩套件）；`qa-run.js`——先校验后运行；仅此命令通过 `ensureContainerDirectories(config, mainRoot, ['tmp'])` 创建 `<tmp>/qa-business-results/<worktree-key>/`；逐套件带超时运行、记录退出码、拷贝报告并计算 SHA256；输出 `SUITE=…` 与 `RESULTS_FILE=`；记录 HEAD SHA 与运行前工作区洁净状态。
  - 验收：`Given` 桩套件退出码为 1 且报告含失败用例 `When` 执行 `qa run` `Then` `STATUS=FAILED`、结果文件仍写出、套件状态 `exit_nonzero`、失败用例不被掩盖；`Given` 套件超时、无法启动或不产出报告 `Then` 分别记为 `timeout`、`spawn_error`、`report_missing`；`Given` 规格违规或配置非法 `Then` `BLOCKED` 且不启动任何套件（AC-BIZTEST-003-01、003-03）。
  - 依赖：003、004、005；是 008 的前置。
- `TASK-BIZTEST-007`（US-BIZTEST-004、US-BIZTEST-006；BIZTEST-SVC-006）
  - 输入：ARCH §3 门禁判定顺序、AC 验收判定与风险披露表；003 的校验函数、004 的配置与摘要、005 的重算能力。
  - 输出：先写 `qa-business-gate.test.js`（RED）；`qa-business-gate.js`——纯函数，注入 HEAD、工作区状态、结果目录与读取器；判定顺序 `CONFIG_INVALID` → `NO_ATOMIC_AC`/`SPEC_INVALID` → `RESULTS_MISSING`/`RESULTS_INVALID` → `RESULTS_STALE_HEAD`/`RESULTS_DIRTY_WORKTREE`/`RESULTS_CONFIG_DRIFT` → `SUITE_HARD_FAILURE` → `REPORT_TAMPERED`/`RESULTS_MISMATCH` → `AC_NOT_PROVEN` → `PATH_COVERAGE_GAP`；第 3~6 步失败即跳过后续判定；风险披露 `RISK_*` 不阻断。
  - 验收：`Given` 结果文件 `head_sha` 与已捕获 HEAD 不同 `When` 判定 `Then` 仅返回 `RESULTS_STALE_HEAD` 并提示重新 `qa run`；`Given` P0 自动化 AC 无绑定用例、存在失败或仅有跳过 `Then` `AC_NOT_PROVEN` 并附原因与端；`Given` 低于必需优先级的 AC 未通过或验证方式为 `manual` `Then` 仅 `RISK_LOWER_PRIORITY`/`RISK_MANUAL_AC` 披露（AC-BIZTEST-004-01~02、004-04~06）。
  - 依赖：003、004、005；是 008 的前置。
- `TASK-BIZTEST-008`（US-BIZTEST-004；BIZTEST-SVC-007）
  - 输入：006 的 `qa run`、007 的门禁、`agent-cli.js` 路由表（`ROUTES`）与 `qa-verify.js` 主流程。
  - 输出：`infra/scripts/agent-runner/agent-cli.js` 路由 `qa:paths` → `qa-paths.js`、`qa:run` → `qa-run.js` 与帮助文本，并扩展 `infra/scripts/agent-runner/__tests__/agent-cli.test.js`；`qa-verify.js` 仅在非模板源且 `qa.business.enabled===true` 时，于测试范围证据校验之后、写回执之前调用门禁；`qa-verification-state.js` 导出 `worktreeReceiptKey`；扩展 `qa-verify.test.js`。
  - 验收：`Given` `qa.business.enabled` 缺省 `When` 执行 `qa verify` `Then` 输出与退出码和既有逐字节一致且不读取规格与结果；`Given` `enabled=true` 且门禁有阻断项 `Then` 打印阻断原因、非零退出、不写回执；`Given` 门禁通过 `Then` 打印风险披露并沿用既有流程，回执结构不变（AC-BIZTEST-004-03）。
  - 依赖：006、007；是 010、011 的前置。
- `TASK-BIZTEST-009`（US-BIZTEST-001、US-BIZTEST-006；BIZTEST-SVC-008）
  - 输入：003 冻结的路径模型语法；`docs/prd-modules/MODULE-TEMPLATE.md`、`MODULE-EXAMPLE.md`、`docs/qa-modules/MODULE-TEMPLATE.md`、`infra/templates/agent/template.manifest.json`。
  - 输出：PRD 模板与示例改为原子 AC 表（`AC ID | Story | 优先级 | 验证 | 端 | Given | When | Then | TC`）；QA 模板把 `QA-{{N}}` 统一为 `TC-{MODULE}-NNN`；新增 `docs/data/templates/qa/PATHS-TEMPLATE.md` 并在模板 manifest 登记 `overwrite`；`business-templates.test.js`（TC-BIZTEST-002、022）；执行模板收敛 dry-run。
  - 验收：`Given` 更新后的模板源 `When` 内容扫描 `Then` 测试用例标识统一为 `TC-{MODULE}-NNN`、QA 模板不含 `QA-N`、示例 AC 每条 Given/When/Then 独立成行；`Given` 模板 manifest `When` 校验 `Then` 新增模板自有文件均已登记所有权策略，`docs/prd-modules/**`、`docs/qa-modules/**`、追溯矩阵与 `agent.config.json` 仍为 project-owned（AC-BIZTEST-001-02、006-02）。
  - 依赖：003；是 010 的前置。
- `TASK-BIZTEST-010`（US-BIZTEST-005；BIZTEST-SVC-008）
  - 输入：008 的命令与输出契约、009 的模板、ARCH §7~§8 使用顺序。
  - 输出：`AgentRoles/Handbooks/QA-TESTING-EXPERT.playbook.md` 增加“业务测试自动化”章节（预言机来源、路径推导步骤、覆盖准则、等价类、边界值、判定表、状态迁移、两两组合、按优先级的预算、数据驱动、刷新不覆盖已评审用例、忽略驱动产物与跨平台输出路径）；PRD、ARCH、QA、TDD 四个角色文件的命令表与完成定义同步；`docs/CONVENTIONS.md` 与 `infra/scripts/qa-tools/README.md` 同步命令面与门禁；`business-guidance.test.js`（TC-BIZTEST-017~020）。
  - 验收：`Given` QA 指引与四个角色文件 `When` 内容扫描 `Then` 明确预言机只来自 PRD AC、数据字典、UX 规范与 ARCH 契约且禁止以被测代码当前输出作期望；含路径推导与覆盖准则、测试设计技术与预算；刷新策略只新增或提出差异；四个角色文件同步原子 AC、`qa paths`、`qa run` 与测试名携带 AC/TC 标识（AC-BIZTEST-005-01~04）。
  - 依赖：008、009；是 011 的前置。
- `TASK-BIZTEST-011`（US-BIZTEST-006；跨组件闭环与非功能）
  - 输入：全部脚本与模板、ARCH §6 质量属性、§9 可测试性。
  - 输出：`business-closed-loop.test.js`——临时 Git 仓库夹具（PRD 原子 AC、`PATHS.md`、可运行桩套件、`qa.business.enabled=true`）；基线全绿后逐一破坏（用例失败、跳过、缺失、结果过期、报告副本被改、工作区不洁净、配置漂移），每项门禁变红并给出对应代码，恢复后变绿；非功能：确定性（重复运行输出一致）、性能（500 条 AC、2000 条用例 ≤ 5 秒）、安全负向（路径越界、`DOCTYPE` 与实体、日志与结果不含环境变量值）；按 `docs/CONVENTIONS.md` §8 记录 `TEST_SCOPE_DECISION` 与 `TEST_SCOPE_RESULT`。
  - 验收：`Given` 夹具项目基线全绿 `When` 逐项故意破坏 `Then` 对应门禁逐一变红，`When` 恢复 `Then` 变绿；`Given` 同一输入重复运行 `Then` 输出逐字节一致（AC-BIZTEST-006-01 与 NFR）。
  - 依赖：008、010；其通过后进入 QA 与合并门禁。

## 3. 依赖矩阵（模块内）

| 任务 | 依赖 | 类型 | 说明 |
| --- | --- | --- | --- |
| TASK-BIZTEST-002 | TASK-BIZTEST-001 | FS | 夹具与 RED 冻结后实现规格解析 |
| TASK-BIZTEST-003 | TASK-BIZTEST-002 | FS | 路径校验复用规格模型与违规结构 |
| TASK-BIZTEST-004 | TASK-BIZTEST-001 | FS | 配置层 RED 先行 |
| TASK-BIZTEST-005 | TASK-BIZTEST-002 | FS | 绑定需要 AC/TC 规格模型 |
| TASK-BIZTEST-006 | TASK-BIZTEST-003 | FS | 运行前复用静态校验 |
| TASK-BIZTEST-006 | TASK-BIZTEST-004 | FS | 套件与超时来自规范化配置 |
| TASK-BIZTEST-006 | TASK-BIZTEST-005 | FS | 运行后绑定并写结果文件 |
| TASK-BIZTEST-007 | TASK-BIZTEST-003 | FS | 门禁的规格与路径违规判定复用校验器 |
| TASK-BIZTEST-007 | TASK-BIZTEST-004 | FS | 必需优先级与配置摘要来自配置层 |
| TASK-BIZTEST-007 | TASK-BIZTEST-005 | FS | 门禁用报告副本重算并比对 |
| TASK-BIZTEST-008 | TASK-BIZTEST-006 | FS | 路由 `qa run` 需要运行器就绪 |
| TASK-BIZTEST-008 | TASK-BIZTEST-007 | FS | `qa verify` 接入需要门禁就绪 |
| TASK-BIZTEST-009 | TASK-BIZTEST-003 | FS | 模板语法须通过路径校验器 |
| TASK-BIZTEST-010 | TASK-BIZTEST-008 | FS | 指引引用已冻结的命令与输出 |
| TASK-BIZTEST-010 | TASK-BIZTEST-009 | FS | 指引引用已冻结的模板 |
| TASK-BIZTEST-011 | TASK-BIZTEST-008 | FS | 闭环夹具需要完整命令与门禁 |
| TASK-BIZTEST-011 | TASK-BIZTEST-010 | FS | 闭环验收与指引、角色文件一并交付 |

关键路径：001 → 002 → 003/005（并行，各 1d）→ 006/007（并行，各 1d）→ 008 → 010 → 011，约 6 人日；004、009 有浮动时间。已同步 [task-dependency-matrix.md](../../data/task-dependency-matrix.md) 与主 TASK 关键路径。

## 4. 资源分配

| 角色 | 人员 | 分配比例 | 时间段 | 备注 |
| --- | --- | --- | --- | --- |
| TDD | @template-maintainers | 100% | 任务 001~010 | 测试先行；脚本零第三方依赖，不调用模型与网络 |
| QA | @qa | 按 Gate | 任务 010~011 与验收阶段 | 夹具闭环、非功能验证、`TEST_SCOPE` 证据 |
| DevOps | @devops | 按 Gate | 传播阶段 | 模板 manifest 收敛 dry-run 与 `qa merge` |

## 5. 里程碑

| 里程碑 | 目标日期 | 交付物 | 验收标准 | Gate | 状态 |
| --- | --- | --- | --- | --- | --- |
| M1-BIZ-RED | 2026-10-06 | 夹具与规格层、配置层失败测试 | 新能力缺失导致预期失败，失败原因可定位 | TASK_PLANNED | ✅ 已完成 |
| M2-BIZ-GREEN | 2026-10-06 | 6 个脚本、命令与门禁接入、模板与指引 | 定向测试全部通过；默认关闭时 `qa verify` 行为与既有一致 | TDD_DONE | ✅ 已完成 |
| M3-BIZ-QA | 2026-10-06 | 闭环夹具、非功能验证与所有权传播证据 | `TC-BIZTEST-001~022` 通过；模板收敛 dry-run 无差异；QA 合并门禁通过 | QA_VALIDATED | TC-BIZTEST-001~022 验收通过；回执及合并以运行态为准 |

## 6. Story → Task 映射

| Story ID | AC ID | Task ID | Test Case ID | QA | 状态 |
| --- | --- | --- | --- | --- | --- |
| US-BIZTEST-001 | AC-BIZTEST-001-01 | TASK-BIZTEST-001~002 | TC-BIZTEST-001 | @qa | ✅ QA 通过 |
| US-BIZTEST-001 | AC-BIZTEST-001-02 | TASK-BIZTEST-009 | TC-BIZTEST-002 | @qa | ✅ QA 通过 |
| US-BIZTEST-002 | AC-BIZTEST-002-01 | TASK-BIZTEST-001~002 | TC-BIZTEST-003 | @qa | ✅ QA 通过 |
| US-BIZTEST-002 | AC-BIZTEST-002-02 | TASK-BIZTEST-001、003 | TC-BIZTEST-004 | @qa | ✅ QA 通过 |
| US-BIZTEST-002 | AC-BIZTEST-002-03 | TASK-BIZTEST-001、003 | TC-BIZTEST-005 | @qa | ✅ QA 通过 |
| US-BIZTEST-002 | AC-BIZTEST-002-04 | TASK-BIZTEST-001、003 | TC-BIZTEST-006 | @qa | ✅ QA 通过 |
| US-BIZTEST-003 | AC-BIZTEST-003-01 | TASK-BIZTEST-004、006 | TC-BIZTEST-007 | @qa | ✅ QA 通过 |
| US-BIZTEST-003 | AC-BIZTEST-003-02 | TASK-BIZTEST-005 | TC-BIZTEST-008 | @qa | ✅ QA 通过 |
| US-BIZTEST-003 | AC-BIZTEST-003-03 | TASK-BIZTEST-005~006 | TC-BIZTEST-009 | @qa | ✅ QA 通过 |
| US-BIZTEST-003 | AC-BIZTEST-003-04 | TASK-BIZTEST-005 | TC-BIZTEST-010 | @qa | ✅ QA 通过 |
| US-BIZTEST-004 | AC-BIZTEST-004-01 | TASK-BIZTEST-007~008 | TC-BIZTEST-011 | @qa | ✅ QA 通过 |
| US-BIZTEST-004 | AC-BIZTEST-004-02 | TASK-BIZTEST-007~008 | TC-BIZTEST-012 | @qa | ✅ QA 通过 |
| US-BIZTEST-004 | AC-BIZTEST-004-03 | TASK-BIZTEST-004、008 | TC-BIZTEST-013 | @qa | ✅ QA 通过 |
| US-BIZTEST-004 | AC-BIZTEST-004-04 | TASK-BIZTEST-004、007 | TC-BIZTEST-014 | @qa | ✅ QA 通过 |
| US-BIZTEST-004 | AC-BIZTEST-004-05 | TASK-BIZTEST-007 | TC-BIZTEST-015 | @qa | ✅ QA 通过 |
| US-BIZTEST-004 | AC-BIZTEST-004-06 | TASK-BIZTEST-007 | TC-BIZTEST-016 | @qa | ✅ QA 通过 |
| US-BIZTEST-005 | AC-BIZTEST-005-01 | TASK-BIZTEST-010 | TC-BIZTEST-017 | @qa | ✅ QA 通过 |
| US-BIZTEST-005 | AC-BIZTEST-005-02 | TASK-BIZTEST-010 | TC-BIZTEST-018 | @qa | ✅ QA 通过 |
| US-BIZTEST-005 | AC-BIZTEST-005-03 | TASK-BIZTEST-010 | TC-BIZTEST-019 | @qa | ✅ QA 通过 |
| US-BIZTEST-005 | AC-BIZTEST-005-04 | TASK-BIZTEST-010 | TC-BIZTEST-020 | @qa | ✅ QA 通过 |
| US-BIZTEST-006 | AC-BIZTEST-006-01 | TASK-BIZTEST-011 | TC-BIZTEST-021 | @qa | ✅ QA 通过 |
| US-BIZTEST-006 | AC-BIZTEST-006-02 | TASK-BIZTEST-009 | TC-BIZTEST-022 | @qa | ✅ QA 通过 |

已同步 `traceability-matrix.md`、`story-task-mapping.md` 与 `task-dependency-matrix.md`。

## 7. 风险登记

风险权威来源为 [ARCH §10](../../arch-modules/business-testing/ARCH.md)；本表登记其与任务的对应及本计划新增的实施风险。仓库无独立 `risk-register.md`，无需另行同步。

| 风险 | 影响 | 缓解 | 负责人 | 状态 |
| --- | --- | --- | --- | --- |
| R-BIZ-001 预言机污染 | 模型把被测代码当前输出当作期望值，门禁形同虚设 | 任务 010 在指引与角色文件限定预言机来源；任务 011 以故意破坏夹具证明门禁可证伪 | @qa | 已缓解 |
| R-BIZ-002 路径模型臆造或过度细化 | 覆盖虚高或用例膨胀 | 任务 003 校验引用、衔接与覆盖；指引要求 P0 路径人工评审 | @qa | 已缓解 |
| R-BIZ-003 结果陈旧、被手写或被改动 | 门禁误放行 | 任务 005~007 绑定 HEAD、配置摘要与报告 SHA256 并重算比对；信任边界与既有本地门禁一致，已接受 | @template-maintainers | 已接受边界 |
| R-BIZ-004 项目忽略用例命名约定 | P0 AC 无绑定用例 | 任务 007 无绑定即阻断，未标识用例计数披露 | @tdd | 已缓解 |
| R-BIZ-005 不稳定用例造成误报 | 门禁间歇性变红 | 失败即失败、不自动重试；flaky 策略归入 P4 另行立项 | @template-maintainers | 已接受 |
| R-BIZ-006 既有项目未采用原子 AC 表 | 门禁覆盖面不足 | 任务 007：开启时全无原子表即阻断，部分模块缺表披露 `RISK_MODULE_WITHOUT_TABLE` | @tdd | 已缓解 |
| R-BIZ-007 结果只存本机 | 换电脑须重新 `qa run` | 与 QA 回执一致；任务 010 指引说明 | @template-maintainers | 已接受 |
| R-BIZ-008 运行产物使工作区不洁净 | 结果无法绑定 HEAD | 任务 010 指引要求忽略驱动产物；任务 007 给出明确原因 | @tdd | 已缓解 |
| R-BIZ-009 命令内联环境变量不可跨平台 | Windows 套件无法运行 | 任务 010 指引建议把输出路径写入驱动配置文件 | @tdd | 已缓解 |
| 默认关闭兼容回归 | 既有 `qa verify` 行为被改变 | 任务 008 以逐字节一致测试守护，既有 `qa-verify` 测试保持全绿 | @tdd | 已缓解 |
| 新增模板文件漏登记所有权 | 项目更新拿不到 `PATHS-TEMPLATE.md` 或覆盖项目文档 | 任务 009 校验 manifest 并执行收敛 dry-run | @tdd | 已缓解 |

## 8. 数据库迁移任务

| 阶段 | Backfill | 双写观察 | 对账 | 回滚 |
| --- | --- | --- | --- | --- |
| Expand | 不适用 | 不适用 | 不适用 | 不适用 |
| Migrate | 不适用 | 不适用 | 不适用 | 不适用 |
| Contract | 不适用 | 不适用 | 不适用 | 不适用 |

本模块无数据库、schema 或数据迁移；`ac-results.json` 是容器 `tmp` 下的运行态文件，不属于数据 schema。

## 9. 技术债务与约束

- P2（`qa plan` 生成 TC 骨架与断言质量检查）、P3（架构包驱动脚手架）、P4（flaky 策略、变异抽样、人工验收记录、性能与安全测试）另行立项，不在本计划。
- 脚本零第三方依赖，不调用模型与网络，不执行文档或报告中的内容；解析与判定为可注入 HEAD、工作区状态与结果目录的纯函数。
- `qa paths` 与门禁只读；仅 `qa run` 创建容器 `tmp` 下的结果目录；门禁关闭时不读取规格与结果、不产生输出。
- QA 回执结构不变；模板源不执行业务门禁，只对实际项目生效。
- 结果文件只存本机，不跨电脑；`qa run` 须在最终提交之后执行，提交后 HEAD 变化会使结果过期。
- 模板只提供模板、校验与门禁；项目测试驱动（Playwright、Maestro、XCUITest、Espresso 等）由项目自选，约定仅限 JUnit XML、用例名标识与套件 `platform` 标签。
- 仓库级 `task:sync`、`prd:lint`、`arch:sync` 的既有失败与本模块无关，交付时如实报告，不在本任务修复。

## 10. 变更记录

| 版本 | 日期 | 描述 | 负责人 |
| --- | --- | --- | --- |
| v0.1.0 | 2026-10-06 | 首次规划业务测试自动化 P1 最小闭环（TASK-BIZTEST-001~011） | @template-maintainers |
| v0.2.0 | 2026-10-07 | 实现完成并验收通过：回填任务、里程碑、映射与风险状态，登记 [QA](../../qa-modules/business-testing/QA.md) | @template-maintainers |

## 11. 自检与 Gate 清单

- [x] `pnpm run task:lint`
- [x] `pnpm run task:check-cycles`
- [ ] `pnpm run task:sync`（仓库既有失败，与本模块无关，见 §9）
- [x] 已同步模块索引、全局依赖矩阵与 Story→Task 映射
- [x] 已定义 TDD、QA 交接与 Gate
- [x] 工作态记录于任务 state（`business-test-automation`）与 worktree session
