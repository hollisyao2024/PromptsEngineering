# 模板命令面 - 任务计划

> **所属主 TASK**：[TASK.md](../../TASK.md)  
> **关联 PRD 模块**：[PRD.md](../../prd-modules/template-command-surface/PRD.md)  
> **关联 ARCH 模块**：[ARCH.md](../../arch-modules/template-command-surface/ARCH.md)  
> **状态**：✅ 多电脑协作 TDD 通过 / 待 QA
> **AGENT_STATE Gate**：`TASK_PLANNED` → `TDD_DONE` → `QA_VALIDATED`  
> **负责团队**：@template-maintainers  
> **最后更新**：2026-09-05
> **版本**：v1.4

## 1. 模块概述

交付单一模板执行面下的客户端 dev/build、private 本地服务快捷语法和多电脑同权 Git 生命周期保护，保持真实命令与 GitHub 工作流 project-owned。交付物包括测试、配置默认结构、CLI/dispatcher、远端分支恢复、QA 双 SHA 回执、精确 PR 合并、通用约定和三 clone 传播证据。

## 2. WBS（工作分解结构）

### 2.1 任务列表

| Task ID | 名称 | Owner | Effort | 优先级 | 前置任务 | 状态 | 完成日期 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TASK-CMDSURF-001 | RED：命令语法、路由与阻断测试 | @tdd | 0.5d | P0 | - | ✅ 已完成 | 2026-08-23 |
| TASK-CMDSURF-002 | 配置 schema 与 Agent CLI 路由 | @tdd | 0.5d | P0 | TASK-CMDSURF-001 | ✅ 已完成 | 2026-08-23 |
| TASK-CMDSURF-003 | Dispatcher、通用文档和专家映射 | @tdd | 0.5d | P0 | TASK-CMDSURF-002 | ✅ 已完成 | 2026-08-23 |
| TASK-CMDSURF-004 | 模板回归、QA、推送与合并 | @qa | 0.5d | P0 | TASK-CMDSURF-003 | 🚧 进行中 | - |
| TASK-CMDSURF-005 | XiaoLan 传播、项目配置与收敛验收 | @qa | 0.5d | P0 | TASK-CMDSURF-004 | 📝 待开始 | - |
| TASK-CMDSURF-006 | RED：完整默认矩阵与稀疏继承契约 | @tdd | 0.25d | P0 | TASK-CMDSURF-003 | ✅ 已完成 | 2026-08-23 |
| TASK-CMDSURF-007 | 中央模板登记客户端、服务生命周期与服务端 build 默认矩阵 | @tdd | 0.25d | P0 | TASK-CMDSURF-006 | ✅ 已完成 | 2026-08-23 |
| TASK-CMDSURF-008 | 实际项目 apply、收敛与命令解析验收 | @qa | 0.25d | P0 | TASK-CMDSURF-007 | 🚧 待 QA 合并复验 | - |
| TASK-CMDSURF-009 | RED：容器目录缺失、幂等、非法目标与只读边界 | @tdd | 0.5d | P0 | ADR-003 | ✅ 已完成 | 2026-08-26 |
| TASK-CMDSURF-010 | 共享容器目录初始化器与安全校验 | @tdd | 0.5d | P0 | TASK-CMDSURF-009 | ✅ 已完成 | 2026-08-26 |
| TASK-CMDSURF-011 | Worktree、任务状态、模板与 DevOps 调用点集成 | @tdd | 0.5d | P0 | TASK-CMDSURF-010 | ✅ 已完成 | 2026-08-26 |
| TASK-CMDSURF-012 | 回归、语义审查、同步、推送与 QA 合并 | @qa | 0.5d | P0 | TASK-CMDSURF-011 | 🔄 待 QA | - |
| TASK-CMDSURF-013 | RED：mutation 显式验收与 Codex 配置内容扫描 | @tdd | 0.25d | P0 | ADR-004 | ✅ 已完成 | 2026-08-27 |
| TASK-CMDSURF-014 | 任务输入规则与 `createTask()` 最小门禁实现 | @tdd | 0.25d | P0 | TASK-CMDSURF-013 | ✅ 已完成 | 2026-08-27 |
| TASK-CMDSURF-015 | Codex 审批策略示例收敛 | @tdd | 0.25d | P1 | TASK-CMDSURF-013 | ✅ 已完成 | 2026-08-27 |
| TASK-CMDSURF-016 | 定向回归、模板检查、QA 与合并 | @qa | 0.25d | P0 | TASK-CMDSURF-014~015 | 🚧 进行中 | - |
| TASK-CMDSURF-017 | RED：远端前进、fetch/base 失败、显式 skip、dry-run 与 resume 契约 | @tdd | 0.5d | P0 | ADR-005 | ✅ 已完成 | 2026-09-01 |
| TASK-CMDSURF-018 | 严格远端 base 解析、固定 SHA 创建与结构化新鲜度输出 | @tdd | 0.5d | P0 | TASK-CMDSURF-017 | ✅ 已完成 | 2026-09-01 |
| TASK-CMDSURF-019 | 通用约定与模板 patch 版本同步 | @tdd | 0.25d | P0 | TASK-CMDSURF-018 | ✅ 已完成 | 2026-09-01 |
| TASK-CMDSURF-020 | 定向/全量回归、语义审查、同步、推送与 QA 合并 | @qa | 0.5d | P0 | TASK-CMDSURF-019 | 🚧 进行中 | - |
| TASK-CMDSURF-021 | RED：远端分支、QA 回执、精确合并与并发契约 | @tdd | 0.5d | P0 | ADR-006 | ✅ 完成 | RED 分组确认现有缺口 |
| TASK-CMDSURF-022 | 远端同名分支阻断与显式 resume | @tdd | 0.5d | P0 | TASK-CMDSURF-021 | ✅ 完成 | worktree 定向与三 clone 通过 |
| TASK-CMDSURF-023 | `tdd push` 显式 PR base 与 `qa verify` 双 SHA 回执 | @tdd | 0.5d | P0 | TASK-CMDSURF-021 | ✅ 完成 | PR base/QA receipt 定向通过 |
| TASK-CMDSURF-024 | `qa merge` 配置主干、期望 head 与非强制更新门禁 | @tdd | 0.75d | P0 | TASK-CMDSURF-022~023 | ✅ 完成 | merge 定向 24/24 |
| TASK-CMDSURF-025 | 同权、无 CI 和本地状态职责协议同步 | @tdd | 0.25d | P0 | TASK-CMDSURF-024 | ✅ 完成 | policy 与 workflow 所有权测试通过 |
| TASK-CMDSURF-026 | 定向/全量回归、三 clone 模拟、模板收敛与 QA 合并 | @qa | 0.75d | P0 | TASK-CMDSURF-025 | 🔄 TDD/模板通过，待 QA | Windows 可执行全集 342/342；目标副本 22/22 |

### 2.2 任务详细说明

- TASK-CMDSURF-001：为 `/private restart` 文档口径、`app dev/build` CLI 路由、平台/profile 精确选择和缺失配置阻断先写失败测试。
- TASK-CMDSURF-002：在模板默认配置增加空 `app.commands.dev/build`，在 Agent CLI 增加 `app` domain，不新增 package alias。
- TASK-CMDSURF-003：扩展 dispatcher 解析平台与 profile；显式 profile 只允许精确值；更新 `docs/CONVENTIONS.md` 和 DEVOPS 专家映射。
- TASK-CMDSURF-004：运行 Node 全量、setup、PRD/ARCH/TASK lint、diff check，执行 tdd push、QA verify/merge。
- TASK-CMDSURF-005：模板源合并后在 XiaoLan 独立 worktree dry-run/apply，补项目 `app.commands`，执行目标回归与 QA merge。
- TASK-CMDSURF-006：枚举 mac、win、ios、android 的 dev/build 默认与 private、本地服务五项生命周期、服务端三环境 build，先证明中央模板当前缺失。
- TASK-CMDSURF-007：只修改 template-owned 默认配置和直接相关协议文档；保留稀疏项目配置与 ship 空默认值。
- TASK-CMDSURF-008：从已合并中央模板更新实际项目，验证 apply 收敛及 `/dev app mac --dry-run` 等完整矩阵解析。
- TASK-CMDSURF-009：先在 shared config、worktree、task/template 与 devops 测试中建立 RED，覆盖四类目录缺失、重复初始化、文件/符号链接占位、非法 key 和纯解析无副作用。
- TASK-CMDSURF-010：在共享路径层实现白名单、拓扑复用、recursive mkdir 与 `lstat` 真实目录复核；不改变 `loadConfig()` 和 `resolveContainerPath()` 的无副作用语义。
- TASK-CMDSURF-011：将写入调用点迁移到共享 helper；构建/CI/发布执行前初始化并传递 `AGENT_TMP_DIR`、`AGENT_CACHE_DIR`、`AGENT_ARTIFACTS_DIR`，列表与状态审计保持只读。
- TASK-CMDSURF-012：运行定向与全量测试、文档 Gate、高风险路径语义审查，以及固定的 tdd/qa 合并门禁。
- TASK-CMDSURF-013：先为 mutation 缺少显式验收的失败路径、只读类型目标回退和模板 Codex 配置内容扫描建立 RED。
- TASK-CMDSURF-014：在 `AGENTS.md` 集中短提示词补齐规则，在 `createTask()` 写盘前增加 mutation 门禁，并让 Conventions 只保留引用和命令示例。
- TASK-CMDSURF-015：把交互式 Codex 审批策略示例收敛为 `on-request`，保留非交互式 `never`，移除重复的已弃用值说明。
- TASK-CMDSURF-016：执行定向与全量 Node 测试、治理文档与模板门禁，再进入固定的 tdd/qa 合并流程。
- TASK-CMDSURF-017：使用本地 bare remote 建立 RED，覆盖远端 base 从 A 前进到 B 后默认创建、fetch 失败、远端 base 缺失、显式 skip 的缓存/local base、无任意 HEAD fallback、dry-run 与 resume 无网络。
- TASK-CMDSURF-018：在请求与恢复态预检后执行默认 required fetch，严格解析 `refs/remotes/origin/<base>^{commit}`，以 commit SHA 创建新分支，并输出 `FETCH_STATUS`、`BASE_REF`、`BASE_COMMIT` 与 `BASE_FRESHNESS`；现有 skip/env 入口保持兼容。
- TASK-CMDSURF-019：更新 `docs/CONVENTIONS.md` 的创建/合并双同步边界，将模板版本提升为 `2.1.1`；不修改 `AGENTS.md`、配置 schema、remote 或 session schema。
- TASK-CMDSURF-020：执行 worktree 定向测试、全量 Node/setup/治理文档/模板收敛门禁和高风险语义审查，再按固定顺序进入 tdd sync/push 与 QA merge。
- TASK-CMDSURF-021：以本地 bare origin 和三个独立 clone 建立 RED，覆盖远端同名分支、远端 resume、QA base/head 漂移、PR head 漂移、主干竞态、同权与 workflow 所有权边界。
- TASK-CMDSURF-022：`worktree new` 在 required fetch 后若发现 `origin/<branch>` 则 fail closed；只有显式 `worktree resume` 可按远端 commit SHA 创建跟踪分支与本机 session。
- TASK-CMDSURF-023：`tdd push` 创建 PR 时显式传递 `config.baseBranch`；`qa verify` 在本地检查通过后原子写入绑定 `BASE_SHA`、`HEAD_SHA`、branch 与 base 的通过回执。
- TASK-CMDSURF-024：`qa merge` 重新 fetch 并校验回执、PR base/head 和远端引用；GitHub 合并提交期望 head SHA，本地 squash 兜底只普通 push 配置主干，任何非快进或 SHA 漂移均阻断且保留恢复状态。
- TASK-CMDSURF-025：在 `AGENTS.md`、`docs/CONVENTIONS.md` 和直接相关 QA 文档明确专家阶段不绑定电脑、所有授权协作者同权、主干禁止 force/delete、门禁完全本地执行，并将模板版本提升为 `2.1.2`；不触碰 `.github/workflows`。
- TASK-CMDSURF-026：执行定向与全量测试、三个 clone 的交错提交模拟、模板 dry-run/apply/convergence 与固定 tdd/qa 门禁，最终证明本地和远端配置主干一致。

每项验收均采用 Given-When-Then：Given 前置任务完成，When 执行对应测试或传播 Gate，Then 输出明确成功证据且无范围外文件变化。

## 3. 依赖矩阵（模块内）

| 前置序号 | 后置序号 | 类型 | 说明 |
| --- | --- | --- | --- |
| 001 | 002 | Finish-to-start | RED 后实现 |
| 002 | 003 | Finish-to-start | 先冻结配置/路由 |
| 003 | 004 | Finish-to-start | 实现完整后回归 |
| 004 | 005 | Finish-to-start | 只传播已合并模板；完整 ID 以全局依赖矩阵为准 |
| 006 | 007 | Finish-to-start | RED 后登记中央模板默认矩阵 |
| 007 | 008 | Finish-to-start | 中央模板登记后执行真实项目传播验收 |
| 009 | 010 | Finish-to-start | 先建立缺目录和负向 RED，再实现共享 helper |
| 010 | 011 | Finish-to-start | helper 合约冻结后接入写入命令 |
| 011 | 012 | Finish-to-start | 集成完成后进入回归与合并门禁 |
| 013 | 014 | Finish-to-start | RED 后实现任务输入与创建门禁 |
| 013 | 015 | Finish-to-start | 内容扫描 RED 后收敛 Codex 配置示例 |
| 014~015 | 016 | Finish-to-start | 两条最小实现完成后统一回归与合并 |
| 017 | 018 | Finish-to-start | 先建立远端与失败边界 RED，再实现严格基线同步 |
| 018 | 019 | Finish-to-start | 实现冻结后同步协议与模板版本 |
| 019 | 020 | Finish-to-start | 代码、测试与文档齐备后进入回归和合并门禁 |
| 021 | 022 | Finish-to-start | 先冻结远端分支冲突与恢复 RED，再实现 worktree 门禁 |
| 021 | 023 | Finish-to-start | 先冻结 SHA 回执与 PR base RED，再实现验证链 |
| 022~023 | 024 | Finish-to-start | 远端恢复和 QA 身份证据稳定后实现精确合并 |
| 024 | 025 | Finish-to-start | 合并行为冻结后同步同权、无 CI 和状态职责协议 |
| 025 | 026 | Finish-to-start | 代码、测试与协议齐备后执行三 clone 与最终 QA |

## 4. 资源分配

| 角色 | 人员 | 分配比例 | 时间段 | 备注 |
| --- | --- | --- | --- | --- |
| PRD/ARCH/TASK/TDD | 任一授权协作者 | 100% | 对应阶段 | 角色是阶段职责，不是机器身份 |
| QA/合并 | 任一授权协作者 | Gate 阶段 | 对应阶段 | 使用本机回执与远端 SHA 复验 |

## 5. 里程碑

| 里程碑 | 目标日期 | 交付物 | 验收标准 | Gate | 状态 |
| --- | --- | --- | --- | --- | --- |
| M1-PROTOCOL | 2026-08-23 | 治理文档和 RED | 文档 lint、测试按预期失败 | TASK_PLANNED | ✅ |
| M2-TEMPLATE | 2026-08-23 | 模板实现 | 测试与 QA 全绿 | QA_VALIDATED | 🚧 |
| M3-PROPAGATE | 2026-08-23 | XiaoLan 更新 | 收敛 dry-run、主远端一致 | QA_VALIDATED | 📝 |
| M4-CONTAINER-DIRS | 2026-08-26 | 共享初始化器与调用点 | TC-CMDSURF-007~009、回归与 completion guard 全绿 | QA_VALIDATED | 🔄 TDD 通过 / 待 QA |
| M5-INTAKE-GATE | 2026-08-27 | 短提示词规则、mutation 门禁与配置清理 | TC-CMDSURF-010~011、模板回归与 completion guard 全绿 | QA_VALIDATED | 🔄 TDD 通过 / 待 QA |
| M6-WORKTREE-BASE | 2026-09-01 | required fetch、固定 SHA 创建、显式 skip 与结构化证据 | TC-CMDSURF-012~015、全量回归、模板收敛与 completion guard 全绿 | QA_VALIDATED | 🔄 TDD 通过 / 待 QA |
| M7-MULTI-HOST | 2026-09-05 | 远端分支恢复、QA 双 SHA 回执、精确合并与三 clone 模拟 | TC-CMDSURF-016~021、全量回归、模板收敛与 completion guard 全绿 | QA_VALIDATED | 🔄 TDD 与模拟通过 / 待 QA |

## 6. Story → Task 映射

| Story ID | AC ID | Task ID | Test Case ID | QA | 状态 |
| --- | --- | --- | --- | --- | --- |
| US-CMDSURF-001 | AC-CMDSURF-001-01 | TASK-CMDSURF-001 | TC-CMDSURF-001 | @qa | ✅ TDD 通过 |
| US-CMDSURF-002 | AC-CMDSURF-002-01 | TASK-CMDSURF-002 | TC-CMDSURF-002 | @qa | ✅ TDD 通过 |
| US-CMDSURF-002 | AC-CMDSURF-002-02 | TASK-CMDSURF-003 | TC-CMDSURF-003 | @qa | ✅ TDD 通过 |
| US-CMDSURF-003 | AC-CMDSURF-003-01 | TASK-CMDSURF-003 | TC-CMDSURF-004 | @qa | ✅ TDD 通过 |
| US-CMDSURF-004 | AC-CMDSURF-004-01 | TASK-CMDSURF-005 | TC-CMDSURF-005 | @qa | 📝 |
| US-CMDSURF-004 | AC-CMDSURF-004-02 | TASK-CMDSURF-006~008 | TC-CMDSURF-006 | @qa | ✅ TDD 通过 / 待 QA 合并复验 |
| US-CMDSURF-005 | AC-CMDSURF-005-01 | TASK-CMDSURF-009~011 | TC-CMDSURF-007 | @qa | ✅ TDD 通过 / 待 QA |
| US-CMDSURF-005 | AC-CMDSURF-005-02 | TASK-CMDSURF-009~011 | TC-CMDSURF-008 | @qa | ✅ TDD 通过 / 待 QA |
| US-CMDSURF-005 | AC-CMDSURF-005-03 | TASK-CMDSURF-009~012 | TC-CMDSURF-009 | @qa | ✅ TDD 通过 / 待 QA |
| US-CMDSURF-006 | AC-CMDSURF-006-01 | TASK-CMDSURF-013~014 | TC-CMDSURF-010 | @qa | ✅ TDD 通过 / 待 QA |
| US-CMDSURF-006 | AC-CMDSURF-006-02 | TASK-CMDSURF-013、015 | TC-CMDSURF-011 | @qa | ✅ TDD 通过 / 待 QA |
| US-CMDSURF-007 | AC-CMDSURF-007-01 | TASK-CMDSURF-017~020 | TC-CMDSURF-012 | @qa | ✅ TDD 通过 / 待 QA |
| US-CMDSURF-007 | AC-CMDSURF-007-02 | TASK-CMDSURF-017~020 | TC-CMDSURF-013 | @qa | ✅ TDD 通过 / 待 QA |
| US-CMDSURF-007 | AC-CMDSURF-007-03 | TASK-CMDSURF-017~020 | TC-CMDSURF-014 | @qa | ✅ TDD 通过 / 待 QA |
| US-CMDSURF-007 | AC-CMDSURF-007-04 | TASK-CMDSURF-017~020 | TC-CMDSURF-015 | @qa | ✅ TDD 通过 / 待 QA |
| US-CMDSURF-008 | AC-CMDSURF-008-01 | TASK-CMDSURF-021~022 | TC-CMDSURF-016 | @qa | ✅ TDD 通过 / 待 QA |
| US-CMDSURF-008 | AC-CMDSURF-008-02 | TASK-CMDSURF-021~022 | TC-CMDSURF-017 | @qa | ✅ TDD 通过 / 待 QA |
| US-CMDSURF-008 | AC-CMDSURF-008-03 | TASK-CMDSURF-021、023~024 | TC-CMDSURF-018 | @qa | ✅ TDD 通过 / 待 QA |
| US-CMDSURF-008 | AC-CMDSURF-008-04 | TASK-CMDSURF-021、024、026 | TC-CMDSURF-019 | @qa | ✅ TDD 通过 / 待 QA |
| US-CMDSURF-008 | AC-CMDSURF-008-05 | TASK-CMDSURF-024~026 | TC-CMDSURF-020 | @qa | ✅ TDD 通过 / 待 QA |
| US-CMDSURF-008 | AC-CMDSURF-008-06 | TASK-CMDSURF-025~026 | TC-CMDSURF-021 | @qa | ✅ TDD 通过 / 待 QA |

## 7. 风险登记

| 风险 | 影响 | 缓解 | 负责人 | 状态 |
| --- | --- | --- | --- | --- |
| 显式 profile 被 default 吞掉 | 操作错误目标 | 负向测试与精确选择 | @tdd | 已规划 |
| 传播覆盖项目配置 | 项目行为损坏 | manifest + dry-run 收敛 | @qa | 已规划 |
| 全量治理文档初始化引入链接错误 | QA 门禁失败 | lint 与 diff check | @qa | 已规划 |
| 中央模板遗漏默认矩阵 | 实际项目更新后命令在执行前阻断 | 完整枚举契约 + 实际项目解析验收 | @tdd/@qa | 修复中 |
| 共享 helper 在只读路径被误用 | 查询命令污染容器目录 | 纯解析无副作用测试 + 显式调用点清单 | @tdd | 已规划 |
| 容器路径被文件或链接占位 | 写入失败或越界 | `lstat` 拒绝并在副作用前阻断 | @tdd/@qa | 已规划 |
| 文档规则重复导致提示词膨胀或漂移 | Agent 行为不一致 | `AGENTS.md` 单一语义入口，Conventions 仅引用 | @tdd/@qa | 已规划 |
| fetch 或远端 base 失败后仍创建 | 新任务基线不可证明 | 默认 fail closed，断言无 branch/worktree/session | @tdd/@qa | 已规划 |
| 显式 skip 回退任意 HEAD | 从错误分支创建新任务 | skip 只允许缓存 remote/local base；负向测试缺失两者 | @tdd | 已规划 |
| 可变 remote ref 与实际 HEAD 竞态 | 输出基线与实际 worktree 不一致 | 解析 commit 后以固定 SHA 创建并比对 HEAD | @tdd | 已规划 |
| 不同电脑误建同名分支 | 两条任务历史使用同一分支名并相互覆盖 | required fetch 后检测远端冲突；显式 resume 才允许恢复 | @tdd/@qa | 已规划 |
| QA 后 base/head 漂移 | 未验证代码或陈旧基线被合并 | 本地回执双 SHA + 合并前 fetch/PR ref 复核 | @tdd/@qa | 已规划 |
| 两台电脑同时更新主干 | 后到操作覆盖先到提交 | 期望 head SHA、配置主干精确值和普通非强制 push | @tdd/@qa | 已规划 |
| 无 CI 且协作者可绕过工具 | 服务端无法证明本地 QA | 明确信任边界、保留审计证据并禁止模板触碰 workflows | @qa | 已接受 |

## 8. 数据库迁移任务

| 阶段 | Task | Backfill | 双写观察 | 对账 | 回滚 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| No-op | 不涉及数据库 schema 或业务数据 | 不适用 | 不适用 | 不适用 | 不适用 | ✅ |

## 9. 技术债务与约束

- 现有 dispatcher 将服务、CI、环境和 app 操作集中在单文件；本轮保持单一执行面，若后续动作显著增长再评估拆分。
- 任务输入语义只修改 `AGENTS.md`，不新增专家、schema、CLI 参数或 package scripts。
- Worktree 基线本轮固定使用现有 `origin`、`baseBranch`、`--skip-fetch` 与环境变量；不新增 remote/policy/retry/session 配置面。
- 多电脑增量不新增 machine role、QA 专用身份、远程锁、candidate worktree、随机分支后缀或配置字段；本机 session/锁不承担跨电脑互斥。
- 保留 squash merge；功能分支可按正常协作需要使用 `--force-with-lease`，配置主干只允许普通非强制 push，且所有主干引用必须来自 `config.baseBranch`。
- `.github/workflows` 是 project-owned，模板测试只确认本轮 diff 与传播结果没有创建、修改、触发或依赖 workflow/required checks。

## 10. 变更记录

| 版本 | 日期 | 描述 | 负责人 |
| --- | --- | --- | --- |
| v1.0 | 2026-08-23 | 初始任务拆解 | @task-planning |
| v1.1 | 2026-08-26 | 增加容器目录按需初始化 TDD 与 QA 关键路径 | @task-planning |
| v1.2 | 2026-08-27 | 增加短提示词补齐、mutation 显式验收和 Codex 配置清理任务 | @task-planning |
| v1.3 | 2026-09-01 | 增加 worktree required fetch、固定 SHA、显式 skip 与 QA 任务 | @task-planning |
| v1.4 | 2026-09-05 | 增加无 CI 多电脑同权协作、远端恢复、QA 双 SHA 和主干乐观并发任务 | @task-planning |

## 11. 自检与 Gate 清单

- [x] WBS 覆盖全部 Story/AC。
- [x] 依赖、关键路径、DB No-op 和传播 Gate 已明确。
- [x] 执行 `task:lint`、`task:check-cycles`、`task:sync`。
- [x] TDD 阶段回写 RED 8 项预期失败、GREEN 17/17 与全量 Node 257/257 证据。
- [x] 默认矩阵修复 RED 23/26（3 项预期失败）、GREEN 29/29、全量 Node 263/263，并完成目标副本 32/32 解析。
- [x] 容器目录 RED 19/23（4 项预期失败）、GREEN 25/25；全量 Node 302/304，两个环境项复核为 `/bin/bash` 不可用与 PowerShell PATH，后者补齐运行时后通过。
- [x] 短提示词门禁 RED 32/35（3 项预期失败）、GREEN 35/35；补齐 Windows 运行时后可运行全量 306/306，另有硬编码 `/bin/bash` 的既有迁移用例在 Windows 不适用。
- [x] Worktree 基线 RED 1/5（4 项按预期失败）、GREEN 9/9；worktree 核心 40/40、全仓 Node 305/305、setup 56/56。
- [x] 多电脑协作完成 RED/GREEN；定向回归 90/90、补充 merge 回归 24/24、Windows 可执行全集 342/342、三 clone 交错模拟通过；模板副本 dry-run/apply/convergence 收敛且相关测试 22/22。
- [ ] QA 与传播阶段回写最终状态与证据。
