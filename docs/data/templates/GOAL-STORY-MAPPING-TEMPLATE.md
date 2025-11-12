# 业务目标追溯模板（Goal → Story Mapping）

> **用途**：帮助 ARCH/PRD/QA 明确每个业务目标对应的 Story/验收标准与依赖；大模型或 ARCH 专家可依据本模板直接输出 `/docs/data/goal-story-mapping.md`。  
> **维护者**：ARCH/PRD 专家；在每轮需求/架构更新后重新生成。  
> **输入**：PRD（目标/Story/AC）、ARCH（组件/接口）、QA 测试要求、OKR/KPI 数据。  

---

## 1. 概要

- **生成时间**：`{generation_time}`  
- **覆盖目标**：列出本次报告覆盖的业务目标（如“增长转化、稳定性、合规”）  
- **关键发现**：指出目标与 Story/架构之间的差异、依赖瓶颈或风险  
- **负责人**：@po / @arch-lead

## 2. 目标 → Story 映射

| 业务目标 GOAL | Story ID | Story Title | Priority | ARCH Component | QA Gate | Traceability 状态 |
|---------------|----------|-------------|----------|----------------|---------|-------------------|
| 提升注册转化 | US-USER-001 | 用户注册 | P0 | USER-SVC | ✅ 已覆盖 | 📝 待启动 |
| 全链路支付一致性 | US-PAY-005 | 支付确认 | P0 | PAY-SVC | 🔄 进行中 | 🔄 进行中 |

- `业务目标 GOAL`：直接引用 OKR/KPI/Business Mission 语言；  
- `Priority`：P0/P1/P2；`ARCH Component` 保持与 `component-dependency-graph` 中一致；  
- `QA Gate` 与 `Traceability 状态` 采用统一 emoji（📝/🔄/✅/⚠️）表示准备度。

## 3. Story → Goal 亲密度分析

| Story ID | Goal Linked | Coverage Gap | 验收标准 | 状态 |
|----------|-------------|--------------|----------|------|
| US-USER-001 | 提升注册转化 | 无 | AC-USER-001-01/02 | ✅ 已确认 |
| US-PAY-002 | 全链路支付一致性 | 依赖第三方接口 | AC-PAY-002-01 | ⚠️ 需更新 |

- `Coverage Gap`：说明 GOAL 与 Story/AC 之间的差距（如“架构未包含 X 接口”）；  
- `状态` 使用统一符号，便于 QA/Traceability 迅速识别需补充项。

## 4. 目标依赖关系摘录

| Goal | Dependent Module/Story | Dependency Type | Impact | Action | Status |
|------|------------------------|----------------|--------|--------|--------|
| 提升注册转化 | payment-system / US-PAY-001 | FS | 支付需登录 | 协调接口契约 | `🔄 进行中` |
| 提升注册转化 | analytics / US-ANALYTICS-001 | Weak | 埋点需 login 触发 | 同步 Data Platform | `📝 待启动` |

- `Dependency Type`：FS/SS/Weak/Other；`Action` 写出下步协调（比如“补充 API 设计”）；  
- `Status` 与全局追踪状态一致，用 emoji 表示是否需要更新或已完成。

## 5. 指标与验收（可选）

- 列出与 Goal 相关的关键指标（如转化率、响应/成功率）及其目标值、验证方式与责任人，便于 QA/Traceability 对齐测试。  
- 可添加表格：`Metric / Target / Owner / Validation`。

## 6. 维护指南

1. 复制本模板到 `/docs/data/goal-story-mapping.md` 并替换占位值；  
2. 每次 Story/Goal 修改时更新此文件并同步 `/docs/prd-modules/module-list.md`、`/docs/data/traceability-matrix.md`；  
3. 若发现 Goal 未对应 Story，立即在 PRD 中补齐 Story/AC 与 Traceability 跟踪；  
4. 生成完成后记录 `generation_time` 到 `AGENT_STATE` 以便审计。

---
> 本模板提供业务目标追溯的一致视图，大模型可直接填充表格、状态与摘要内容，生成后即可交付 `goal-story-mapping.md`。EOF
