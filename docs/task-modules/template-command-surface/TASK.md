# 模板命令面 - 任务计划

> **所属主 TASK**：[TASK.md](../../TASK.md)  
> **关联 PRD 模块**：[PRD.md](../../prd-modules/template-command-surface/PRD.md)  
> **关联 ARCH 模块**：[ARCH.md](../../arch-modules/template-command-surface/ARCH.md)  
> **状态**：🚧 执行中  
> **AGENT_STATE Gate**：`TASK_PLANNED` → `TDD_DONE` → `QA_VALIDATED`  
> **负责团队**：@template-maintainers  
> **最后更新**：2026-08-26  
> **版本**：v1.1

## 1. 模块概述

交付单一模板执行面下的客户端 dev/build 与 private 本地服务快捷语法，保持真实命令 project-owned。交付物包括测试、配置默认结构、CLI/dispatcher、通用约定、DEVOPS 命令映射和目标项目传播证据。

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

## 4. 资源分配

| 角色 | 人员 | 分配比例 | 时间段 | 备注 |
| --- | --- | --- | --- | --- |
| PRD/ARCH/TASK/TDD | Codex | 100% | 本任务 | 单一实现者 |
| QA | Codex | Gate 阶段 | 本任务 | 独立命令复验 |

## 5. 里程碑

| 里程碑 | 目标日期 | 交付物 | 验收标准 | Gate | 状态 |
| --- | --- | --- | --- | --- | --- |
| M1-PROTOCOL | 2026-08-23 | 治理文档和 RED | 文档 lint、测试按预期失败 | TASK_PLANNED | ✅ |
| M2-TEMPLATE | 2026-08-23 | 模板实现 | 测试与 QA 全绿 | QA_VALIDATED | 🚧 |
| M3-PROPAGATE | 2026-08-23 | XiaoLan 更新 | 收敛 dry-run、主远端一致 | QA_VALIDATED | 📝 |
| M4-CONTAINER-DIRS | 2026-08-26 | 共享初始化器与调用点 | TC-CMDSURF-007~009、回归与 completion guard 全绿 | QA_VALIDATED | 🔄 TDD 通过 / 待 QA |

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

## 7. 风险登记

| 风险 | 影响 | 缓解 | 负责人 | 状态 |
| --- | --- | --- | --- | --- |
| 显式 profile 被 default 吞掉 | 操作错误目标 | 负向测试与精确选择 | @tdd | 已规划 |
| 传播覆盖项目配置 | 项目行为损坏 | manifest + dry-run 收敛 | @qa | 已规划 |
| 全量治理文档初始化引入链接错误 | QA 门禁失败 | lint 与 diff check | @qa | 已规划 |
| 中央模板遗漏默认矩阵 | 实际项目更新后命令在执行前阻断 | 完整枚举契约 + 实际项目解析验收 | @tdd/@qa | 修复中 |
| 共享 helper 在只读路径被误用 | 查询命令污染容器目录 | 纯解析无副作用测试 + 显式调用点清单 | @tdd | 已规划 |
| 容器路径被文件或链接占位 | 写入失败或越界 | `lstat` 拒绝并在副作用前阻断 | @tdd/@qa | 已规划 |

## 8. 数据库迁移任务

| 阶段 | Task | Backfill | 双写观察 | 对账 | 回滚 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| No-op | 不涉及数据库 schema 或业务数据 | 不适用 | 不适用 | 不适用 | 不适用 | ✅ |

## 9. 技术债务与约束

- 现有 dispatcher 将服务、CI、环境和 app 操作集中在单文件；本轮保持单一执行面，若后续动作显著增长再评估拆分。
- 不修改 `AGENTS.md`，不扩大模板 package scripts。

## 10. 变更记录

| 版本 | 日期 | 描述 | 负责人 |
| --- | --- | --- | --- |
| v1.0 | 2026-08-23 | 初始任务拆解 | @task-planning |
| v1.1 | 2026-08-26 | 增加容器目录按需初始化 TDD 与 QA 关键路径 | @task-planning |

## 11. 自检与 Gate 清单

- [x] WBS 覆盖全部 Story/AC。
- [x] 依赖、关键路径、DB No-op 和传播 Gate 已明确。
- [x] 执行 `task:lint`、`task:check-cycles`、`task:sync`。
- [x] TDD 阶段回写 RED 8 项预期失败、GREEN 17/17 与全量 Node 257/257 证据。
- [x] 默认矩阵修复 RED 23/26（3 项预期失败）、GREEN 29/29、全量 Node 263/263，并完成目标副本 32/32 解析。
- [x] 容器目录 RED 19/23（4 项预期失败）、GREEN 25/25；全量 Node 302/304，两个环境项复核为 `/bin/bash` 不可用与 PowerShell PATH，后者补齐运行时后通过。
- [ ] QA 与传播阶段回写最终状态与证据。
