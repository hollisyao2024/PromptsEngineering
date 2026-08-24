# 环境文件初始化 - PRD 模块

> **所属主 PRD**：[PRD.md](../../PRD.md)  
> **负责团队**：@template-maintainers  
> **最后更新**：2026-08-24  
> **状态**：✅ 已确认  
> **追溯说明**：Story 与 AC 同步至 `docs/data/traceability-matrix.md`

## 1. 模块概述

模板首次应用到目标项目时，为本地、staging 和 production 三类环境建立一致的 example/实际文件对，避免使用者手工猜测文件名。example 文件可进入 Git；实际环境文件必须保持未跟踪并可承载本地凭据。

## 2. 范围与约束

### In Scope

- 缺失时创建 `.env.example`、`.env.staging.example`、`.env.production.example`。
- 缺失时创建 `.env.local`、`.env.staging`、`.env.production`。
- example 文件包含用途说明、变量占位与安全默认值；实际文件首次创建时取对应 example 的内容。
- `.gitignore` 默认忽略三个实际文件，不忽略三个 example 文件。
- 六个文件均采用 init-if-missing：已有文件不得追加、覆盖或重写。

### Out of Scope

- 后续同步 example 与实际文件。
- 写入真实 token、密码或目标项目专属配置。
- 自动把实际文件加入 Git，或负责 CI/CD Secret Manager。
- 改变目标项目使用何种框架加载 staging/production 文件。

## 3. 用户故事与验收

| Story ID | 验收标准（Given-When-Then） | Task ID | Test Case ID | QA 负责人 |
| --- | --- | --- | --- | --- |
| US-ENVINIT-001 | **AC-ENVINIT-001-01** Given 目标项目缺少六个文件，When 执行模板写入初始化，Then 创建三个 example 文件和三个对应实际文件 | TASK-ENVINIT-001 | TC-ENVINIT-001 | @qa |
| US-ENVINIT-001 | **AC-ENVINIT-001-02** Given 初始化已完成，When 检查 Git 状态，Then example 文件不被忽略且实际文件全部被忽略 | TASK-ENVINIT-002 | TC-ENVINIT-002 | @qa |
| US-ENVINIT-002 | **AC-ENVINIT-002-01** Given 六个文件中任一文件已有内容，When 再次应用模板，Then 已有文件内容逐字节保持不变 | TASK-ENVINIT-003 | TC-ENVINIT-003 | @qa |
| US-ENVINIT-003 | **AC-ENVINIT-003-01** Given 执行模板 dry-run，When 文件缺失或已存在，Then 只报告将创建的缺失文件且不产生写入 | TASK-ENVINIT-004 | TC-ENVINIT-004 | @qa |

## 4. 非功能需求

| NFR | 指标 | 目标 | 验证 |
| --- | --- | --- | --- |
| 安全性 | 模板内真实凭据 | 0 | 内容扫描与测试 |
| 幂等性 | 第二次应用产生的文件内容变化 | 0 | convergence 测试 |
| 可审计性 | dry-run/write 结果 | 六个文件均有明确状态 | 输出断言 |
| 兼容性 | 目标项目已有环境文件 | 100% 保留 | 预置内容回归测试 |

## 5. 依赖与风险

| 类型 | 内容 | 缓解措施 |
| --- | --- | --- |
| 依赖 | 模板 manifest 的 init-if-missing 策略 | example 文件登记为首次创建、后续不覆盖 |
| 依赖 | `.gitignore` append-block | 明确包含 `.env.local`、`.env.staging`、`.env.production` |
| 风险 | 空实际文件被误认为已配置 | 从对应 example 初始化，并保留注释与空值占位 |
| 风险 | 项目删除文件后模板再次创建 | init-if-missing 以每次 apply 时的文件存在性为准；存在即不碰 |

## 6. 里程碑与 Gate

- M0：Story、AC 与追溯矩阵确认。
- M1：架构与任务拆解完成。
- M2：定向测试先失败后实现通过。
- M3：模板 dry-run、首次 apply、再次 apply 收敛及 Git ignore 验收通过。

## 7. 追溯矩阵与验证

详见 [traceability-matrix.md](../../data/traceability-matrix.md)。所有 AC 均需独立测试，且首次创建与已有文件保护不可由同一单一 happy-path 断言替代。

## 8. 用户体验设计

不适用。本模块为 CLI 模板初始化行为。

## 9. 开放问题

无。用户已确认默认创建六个文件，并明确只在缺失时初始化、后续不管理。

## 10. 变更记录

- v1.0（2026-08-24）：确认六文件首次初始化、Git 所有权和不覆盖约束。

## 11. 自检清单

- [ ] `pnpm run prd:lint`
- [ ] `pnpm run prd:check-dependency-cycles`
- [x] 已同步 traceability matrix
- [x] 无图形界面，无需 UX 规范
