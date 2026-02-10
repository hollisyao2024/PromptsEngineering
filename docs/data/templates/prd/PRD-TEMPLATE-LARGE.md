# 产品需求文档（PRD）— 大型项目主文档模板

> 本模板供大型项目使用，复制到 `/docs/PRD.md` 作为**总纲与索引**，保持 < 1000 行，避免详细需求。模块级需求拆分到 `/docs/prd-modules/{domain}/PRD.md`。

日期：YYYY-MM-DD   版本：v1.0

## 1. 产品概述
- 产品背景与目标
- 目标用户群体
- 核心价值主张
- 成功指标定义
- 各成功指标需同时包含：业务/技术可观测数据、预计完成时间，并说明由 PO/PM/QA/TDD/Traceability 在 Doc Sync Gate 或对应评审点确认，帮助主 PRD 既做战略也做验收依据。

## 2. 全局范围与边界
- 核心功能域列表（链接到模块）
- 非范围（Out of Scope）
- 关键假设与约束
- **模块状态/追溯**：每个功能域备注是否与 Traceability Matrix、ARCH、TASK 同步（如 `Traceability ✅` / `接口待补`），方便追踪差异
- 每个功能域可额外补充"当前阶段/优先级/依赖状态"（如 Traceability 需补/接口待确认），便于 ARCH/TASK 快速判断需同步的模块。
- 可附上关联的 Story ID+Owner 以便主 PRD 既是索引又是协作责任表。

## 3. 用户角色与核心场景
- 角色定义（Admin/User/Guest）
- 核心用户旅程（高层级）
- **关键依赖/前置故事**：列出跨模块、外部系统或数据准备的依赖，尽量关联已有 Story/Task ID 以便 TASK/TDD 把握关键路径
- 为每个场景补充"关键路径 Story ID + Owner"与"期望验证 Gate"（如 QA 关键旅程回归），让 QA/Traceability 能在主 PRD 上直接理解测试焦点。
- 场景级依赖需注明状态（已履约/待协调/有变更），为 ARCH/TASK 提供是否需调整分拆或资源的信号。

## 4. 非功能需求（NFR）
- 说明所需监控/SLO/测试维度，并注记哪些项需填入 `/docs/data/traceability-matrix.md` 或 `QA.md` 中进行验证，确保 NFR 有验证闭环
- 性能要求（全局）
- 安全要求（全局）
- 兼容性与合规要求
- 建议通过表格列出每项 NFR 的"验证目标/指标""期望值""验证阶段（TDD/QA/Prod Gate）""责任人"与"追踪文档"，确保验证计划清晰可执行。
  | NFR 主题 | 验证指标/目标 | 期望值 | 验证阶段 | 责任人 | 追踪文档 |
  | -------- | ------------- | ------ | -------- | ------ | -------- |
  | 响应性能 | 平均响应时间 | < 300 ms | TDD+QA | @perf | `/docs/data/traceability-matrix.md`、CI 压测任务 |

## 5. 功能域索引（链接到模块）
| 功能域 | 优先级/阶段 | 负责人 | 文档链接 | 依赖状态/Traceability | 当前 Gate 状态 |
|--------|--------------|--------|----------|------------------------|---------------|
| 用户管理 | P0 / ARCH 已确认 | @team-a | [PRD.md](prd-modules/user-management/PRD.md) | Traceability ✅ / API 完成 | 进入 TASK |
| 支付系统 | P1 / 设计中 | @team-b | [PRD.md](prd-modules/payment-system/PRD.md) | 依赖外部结算系统 / Traceability 待补 | ARCH Gate 待通过 |
| 分析服务 | P2 / 待启动 | @team-c | [PRD.md](prd-modules/analytics-service/PRD.md) | 数据平台协调中 | PRD Gate |

## 6. 里程碑与依赖
- 建议以表格方式记录里程碑，列出目标、交付物、时间节点、负责人、关联 Gate 以及依赖状态；依赖状态可标注"已锁定 / 待协调 / 有变更"，便于 TASK/TDD 快速追踪。
  | 里程碑 | 预期完成时间 | 交付物 | 责任人 | Gate 条件 | 依赖状态 |
  | ------ | ------------ | ------ | ------ | ---------- | -------- |
  | M0 定义 | 2025-11-10 | 主架构文档 + Traceability 初稿 | @arch | Doc Sync | 无外部依赖 |
  | M1 MVP | 2026-01-05 | 模块 PRD + API 列表 | @pm | Traceability 完成 | 支付系统接口待确认 |
  | 发布 | 2026-02-28 | QA 验证报告/发布 Checklist | @qa | 最终 Gate + Traceability ✓ | 合规审批中 |
- 对跨模块依赖请额外维护"系统/数据/团队、负责人、影响范围、当前状态"表，方便 ARCH/TASK 确定优先级与资源分布。

## 7. 风险与开放问题
- 全局风险（技术、业务、合规）
- 待澄清问题列表
- 建议使用表格记录风险/问题、影响阶段（PRD/ARCH/TASK）、Gate 条件（如需 Traceability 补全、QA 覆盖）、责任人与当前状态，便于决定是否退回前一阶段或在 Gate 前采取行动。
  | 风险/问题 | 影响阶段 | 描述 | Gate 条件 | 责任人 | 当前状态 |
  | ---------- | ---------- | ---- | --------- | ------ | -------- |
  | AC 不完整 | PRD | 若 AC 未补齐，Traceability 无法同步 | `PRD_CONFIRMED` 前需完成 Story/AC | @po | 补全中 |
  | 接口依赖 | ARCH | 外部接口未确认，支付无法推进 | `ARCHITECTURE_DEFINED` 前需确认契约 | @team-b | 协调中 |
  | 数据合规 | TASK | 数据留存策略待审批 | `TASK_PLANNED` 前需合规签核 | @legal | 待审批 |

## 8. 用户体验设计（UX）
- 用户研究摘要与关键洞察
- 核心用户旅程线框图/原型索引（附设计工具链接）
- 设计系统规范摘要（Token 定义概览）
- 响应式设计与无障碍访问（WCAG AA）要求
- 设计-开发交接规范
- 详见 `/docs/data/ux-specifications.md`
- （纯后端项目可标注"不适用"并跳过）

## 9. 追溯矩阵与发布 Gate
- 详见 [traceability-matrix.md](data/traceability-matrix.md)
- 记录 Story → AC → Test Case 的同步状态，并在 `PRD_CONFIRMED` 阶段确认 QA/QA/Traceability 更新完毕，作为进入 `ARCHITECTURE_DEFINED` 的 Gate 条件。
- 补充一个 Gate 校验清单，至少包含：每个功能域有代表性 Story/AC、Traceability 初稿完成、QA 覆盖关键旅程、NFR 验证计划同步、Doc Sync 注记完成。由 PO/TDD/QA/Traceability 共同确认或记录在 Doc Sync Gate 备注。
