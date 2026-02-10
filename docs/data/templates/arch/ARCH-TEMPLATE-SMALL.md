# 系统架构文档

> 本模板供小型项目使用，复制到 `/docs/ARCH.md` 并补充内容。
> 模块化项目请使用 `ARCH-TEMPLATE-LARGE.md`。

日期：YYYY-MM-DD   版本：v0

## 1. 总览与目标
- 质量属性优先级（性能/可靠/成本/可演进…）
- 当前架构状态标签（草案/评审中/已确认）与验收人（ARCH/TDD/QA）
- PRD/Traceability 对齐：列出此架构覆盖的关键 Story/NFR、关联的组件/模块以及预期的验证 Gate（`PRD_CONFIRMED`/`ARCHITECTURE_DEFINED`），并注明由哪些角色负责确认对应的 Traceability Matrix、Goal Mapping 与 Doc Sync Gate。

## 2. 视图
### 2.1 上下文/容器/组件（C4）
- 关键依赖：列出外部系统/第三方依赖、内网服务、认证/授权服务等
- Mermaid 图或文字结构
- 验证要求：标出依赖状态（已确认/待协调）、是否与 `/docs/data/traceability-matrix.md` 和 `/docs/data/global-dependency-graph.md` 对齐，有无新增组件需在 Gate 前记录。
### 2.2 运行时视图
- 关键链路时序
- 验证要求：补充关键链路的 SLA/SLO（例如响应时间、错误率）与相关监控指标，绑定对应 TDD/QA 验证用例与责任人。
### 2.3 数据视图
- 实体/关系/主外键/约束；索引策略；容量与保留；一致性与事务边界；合规与审计；备份与恢复
- 参考：`/docs/data/ERD.md`、`/docs/data/dictionary.md`
- 验证要求：明确数据模型与合规控制的验证状态（如脱敏、备份策略、审计日志已验证），并指向负责的 Traceability/Compliance 记录。
### 2.4 接口视图
- 外部/内部 API 契约、错误码、限流/幂等
- 验证要求：各接口需表述契约状态、限流/重试策略、负责人（ARCH/TDD）与对应的默认测试场景、Traceability ID。
### 2.5 运维视图
- 部署拓扑、弹性策略、可观测性、告警、SLO
- 发布准备：列出必须验证的监控/告警/回滚流程，确保 `ARCHITECTURE_DEFINED` 阶段与 AGENT_STATE 同步
- 验证要求：提供监控/告警/回滚的具体验证输入（例如：监控指标阈值、告警联动步骤、回滚演练负责人）并在 Doc Sync Gate 前确认是否已与 CI/CD、SRE 共享。
### 2.6 安全与合规
- 身份与权限、审计、数据安全、合规要求
- 验证要求：列出所有关键安全控制（认证/授权/审计/数据安全）与合规契约（如 GDPR/PIPL），说明当前验证状态与后续安全评审时间点。

## 3. 技术选型与 ADR
- 使用表格列出关键方案对比（评估维度/优劣/成本/依赖/风险/应急方式），然后给出决策理由、预计影响以及关联的 `ADR` 文件链接或待创建的 ADR 议题，避免选型时的"匿名原因"。
  | 维度 | 方案 A | 方案 B | 选型理由 | 影响 | ADR 链接 |
  | ---- | ------ | ------ | -------- | ---- | -------- |
  | 后端服务框架 | Node.js | Spring Boot | Node 生态一致 | 运维/人才 | [ADR-002](adr/002-backend-framework.md) |

## 4. 风险与缓解
- 采用 Risk Register（风险/类型/影响/概率/缓解/责任人/Gate 条件）形式捕捉当前架构设计阶段指导关注的风险，并指出是否已同步到 `/docs/data/global-dependency-graph.md` / Traceability/Change Requests，以便 Gate 决策。
  | 风险/问题 | 类型 | 影响阶段 | 概率 | 缓解计划 | 责任人 | Gate 条件 | 当前状态 |
  | ---------- | ---- | ---------- | ---- | -------- | ------ | ---------- | -------- |
  | 外部依赖 | 技术 | ARCH | 中 | 接口契约确认 & mock | @team-b | `ARCHITECTURE_DEFINED` 前签署 SLA | 协调中 |
  | 性能瓶颈 | 稳定性 | ARCH | 高 | 增加缓存 + 压测 | @perf | Traceability 中支持的监控完成 | 压测中 |
  | 合规审计 | 合规 | ARCH | 低 | 补齐审计日志 + DR 计划 | @security | 合规审批通过 | 审批中 |

## 5. 验证与审查清单
- 小型项目也需明确验证活动，建议使用表格记录每项验证的责任人、输入产物、验证方式（review/测试/演练）、对应 Gate 以及是否与 TDD/QA/SRE 同步完成，确保 Doc Sync Gate 有据可查。
  | 验证项 | 输入产物 | 验证方式 | Gate | 责任人 | 状态 |
  | ------ | -------- | -------- | ---- | ------ | ---- |
  | Traceability 对齐 | `/docs/data/arch-prd-traceability.md` | ARCH Review | `ARCHITECTURE_DEFINED` | @arch | 进行中 |
  | 监控与告警 | 运维视图 | 回归 + 演练 | Doc Sync | @sre | 待执行 |

## 6. 文档快照与变更记录
- 每次更新架构文档时记录日期、作者、触发原因（新请求/依赖变化/性能回退）与影响范围，方便复盘与以后的发布回溯；表格也可作为审查日志供 QA/TDD 查看。
  | 日期 | 作者 | 触发原因 | 影响范围 | 版本 |
  | ---- | ---- | -------- | -------- | ---- |
  | 2025-10-10 | @arch | 新需求/ API 拆分 | 支付 + 通知 | v0.1 |

## 7. 发布准备与状态对齐
- 把本模板的状态标签/里程碑与 `/docs/AGENT_STATE.md` 中的 `ARCHITECTURE_DEFINED` 状态锁定，完成后记录确认时间与审批人。
- 要求 TDD/QA 在回归/验收前引用此节的监控/告警/回滚列表，并确认 Doc Sync Gate（如 `/docs/data/traceability-matrix.md`）已更新。
