# 环境文件初始化 - 任务计划

> **所属主 TASK**：[TASK.md](../../TASK.md)  
> **关联 PRD 模块**：[PRD.md](../../prd-modules/environment-file-initialization/PRD.md)  
> **关联 ARCH 模块**：[ARCH.md](../../arch-modules/environment-file-initialization/ARCH.md)  
> **状态**：✅ 已规划  
> **AGENT_STATE Gate**：`TASK_PLANNED` → `TDD_DONE` → `QA_VALIDATED`  
> **Story→Task ID**：`US-ENVINIT-001~003` / `TASK-ENVINIT-001~004` / `TC-ENVINIT-001~004`  
> **负责团队**：@template-maintainers  
> **最后更新**：2026-08-24  
> **版本**：v1.0.0

## 1. 模块概述

以 TDD 完成六个环境文件的首次初始化。交付包括两个新增 example source、manifest 所有权变更、实际文件初始化器、Git ignore 契约、定向测试和传播收敛证据。

## 2. WBS（工作分解结构）

### 2.1 任务列表

| Task ID | 名称 | 负责人 | 工时 | 优先级 | 前置任务 | 状态 | 完成日期 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TASK-ENVINIT-001 | RED：首次创建、dry-run 与已有内容保护测试 | @tdd | 0.5d | P0 | - | 📝 待开始 | - |
| TASK-ENVINIT-002 | Example sources、manifest 与 ignore 契约 | @tdd | 0.5d | P0 | TASK-ENVINIT-001 | 📝 待开始 | - |
| TASK-ENVINIT-003 | 实际文件 init-if-missing 初始化器 | @tdd | 0.5d | P0 | TASK-ENVINIT-002 | 📝 待开始 | - |
| TASK-ENVINIT-004 | 双次 apply、Git 状态、回归与合并 Gate | @qa / @devops | 0.5d | P0 | TASK-ENVINIT-003 | 📝 待开始 | - |

### 2.2 任务详细说明

- `TASK-ENVINIT-001`：新增会先失败的测试，覆盖三组映射、dry-run 无写入、已有六文件 sentinel 内容逐字节不变。
- `TASK-ENVINIT-002`：新增 `.env.staging.example`、`.env.production.example`；把三个 example 登记为 `init-if-missing`；确认 ignore block 精确覆盖三个实际文件。
- `TASK-ENVINIT-003`：以固定映射在 manifest write 后读取目标 example，并 exclusive create 对应实际文件；逐文件输出 created/unchanged，错误 fail closed。
- `TASK-ENVINIT-004`：临时 Git 目标执行 dry-run、首次 write、第二次收敛；验证三个 example 可跟踪、三个实际文件 ignored，并执行相关全量回归与仓库门禁。

## 3. 依赖矩阵（模块内）

| 前置序号 | 后置序号 | 类型 | 说明 |
| --- | --- | --- | --- |
| 001 | 002 | Finish-to-start | RED 先冻结验收口径 |
| 002 | 003 | Finish-to-start | 实际文件必须从已创建的目标 example 读取 |
| 003 | 004 | Finish-to-start | QA 验证完整实现与收敛；完整 ID 以全局依赖矩阵为准 |

## 4. 资源分配

| 角色 | 人员 | 分配比例 | 时间段 | 备注 |
| --- | --- | --- | --- | --- |
| TDD | @template-maintainers | 100% | 实现阶段 | 测试先行与代码实现 |
| QA | @qa | 按 Gate | 验收阶段 | AC 与回归验证 |
| DevOps | @devops | 按 Gate | 传播阶段 | Git ignore 与目标初始化边界 |

## 5. 里程碑

| 里程碑 | 目标日期 | 交付物 | 验收标准 | Gate | 状态 |
| --- | --- | --- | --- | --- | --- |
| M1-ENV-RED | 2026-08-24 | 失败测试 | 新能力缺失导致预期失败 | TASK_PLANNED | 📝 |
| M2-ENV-GREEN | 2026-08-24 | source、manifest、初始化器 | 定向测试通过 | TDD_DONE | 📝 |
| M3-ENV-QA | 2026-08-24 | 传播与 Git 证据 | 四条 AC 全通过 | QA_VALIDATED | 📝 |

## 6. Story → Task 映射

| Story ID | AC ID | Task ID | Test Case ID | QA | 状态 |
| --- | --- | --- | --- | --- | --- |
| US-ENVINIT-001 | AC-ENVINIT-001-01 | TASK-ENVINIT-001~003 | TC-ENVINIT-001 | @qa | 📝 |
| US-ENVINIT-001 | AC-ENVINIT-001-02 | TASK-ENVINIT-002、004 | TC-ENVINIT-002 | @qa | 📝 |
| US-ENVINIT-002 | AC-ENVINIT-002-01 | TASK-ENVINIT-001、003 | TC-ENVINIT-003 | @qa | 📝 |
| US-ENVINIT-003 | AC-ENVINIT-003-01 | TASK-ENVINIT-001、003、004 | TC-ENVINIT-004 | @qa | 📝 |

已同步 `traceability-matrix.md`、`story-task-mapping.md` 与 `task-dependency-matrix.md`。

## 7. 风险登记

| 风险 | 影响 | 缓解 | 负责人 | 状态 |
| --- | --- | --- | --- | --- |
| 旧 append 行为残留 | 已有 `.env.local` 被修改 | sentinel 回归 + 删除 append 路径 | @tdd | 已规划 |
| example 未先创建 | 实际文件来源缺失 | 固定 write 顺序 + fail closed | @tdd | 已规划 |
| 实际文件进入 Git | 凭据泄漏 | ignore 精确匹配集成测试 | @qa / @devops | 已规划 |

## 8. 数据库迁移任务

| 阶段 | Backfill | 双写观察 | 对账 | 回滚 |
| --- | --- | --- | --- | --- |
| Expand | 不适用 | 不适用 | 不适用 | 不适用 |
| Migrate | 不适用 | 不适用 | 不适用 | 不适用 |
| Contract | 不适用 | 不适用 | 不适用 | 不适用 |

本模块无数据库、schema 或数据迁移。

## 9. 技术债务与约束

- 不增加自动加载 `.env.staging`/`.env.production` 的框架耦合。
- 不把实际文件加入模板 manifest 或 Git。
- 已有文件存在即停止该文件的后续处理。

## 10. 变更记录

| 版本 | 日期 | 描述 | 负责人 |
| --- | --- | --- | --- |
| v1.0.0 | 2026-08-24 | 首次规划 | @template-maintainers |

## 11. 自检与 Gate 清单

- [ ] `pnpm run task:lint`
- [ ] `pnpm run task:check-cycles`
- [ ] `pnpm run task:sync`
- [x] 已同步模块索引与手工追溯映射
- [x] 已定义 TDD、QA、DevOps 交接与 Gate
