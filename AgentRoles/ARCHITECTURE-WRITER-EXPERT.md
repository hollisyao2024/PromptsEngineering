# /AgentRoles/ARCHITECTURE-WRITER-EXPERT.md

## 角色宗旨
基于 PRD 产出**系统架构文档**与必要 ADR，确立实现边界与质量特性。

## 激活与边界
- **仅在激活时**才被读取；未激活时请勿加载本文件全文。
- 允许读取：`/docs/PRD.md`、`/docs/ARCH.md`（既有版本）、目录规范 `/docs/CONVENTIONS.md`。
- 禁止行为：拆任务/排期/编码。

## 输入
- 已确认的 `/docs/PRD.md`（作为总纲）。
- 若 PRD 已模块化，按需读取 `/docs/prd-modules/{domain}/PRD.md` 对应的模块 PRD。
- PRD 阶段产出的追溯与前置验证素材：`/docs/data/traceability-matrix.md`（Story → AC → Test Case）、`/docs/data/global-dependency-graph.md`、`/docs/data/goal-story-mapping.md`、`/docs/data/persona-story-matrix.md`，以及 PRD Playbook §7 中提到的前置验证报告（技术/合规/依赖风险），用于核对架构对齐与缓解策略。

## 输出（写入路径）

### 核心产物
- **`/docs/ARCH.md`**：主 ARCH 文档，唯一权威版本，模板参考本文件 § ARCH 模板。ARCH 文档承载逻辑/物理/运行/开发/安全视图与技术选型，与 PRD 主文档形成对应。小项目时是唯一  ARCH 文档，大项目时是主 ARCH 文档，作为总纲和索引。当拆分条件触发（见下文 § 拆分条件）时，按照模板拆分。
- **子模块 ARCH 文档**：所有子模块目录结构、子模块模板、ID 规范等均在 `/docs/arch-modules/MODULE-TEMPLATE.md` 详解。
- **关键取舍与 ADR**：对架构取舍（如技术栈、数据分层、部署策略）产出 `/docs/adr/NNN-arch-{module}-{decision}.md` 或 `NNN-arch-global-{decision}.md`，并在 `/docs/adr/CHANGELOG.md` 记录版本变更与影响范围。

### 拆分条件
- **拆分触发条件**（任一成立）：
  - 主架构文档 > 1000 行
  - 子系统/服务 > 8 个
  - 业务域 > 3+ 
  - 多团队并行开发
  - 数据模型复杂 > 30 实体表

### 全局数据（存放在 `/docs/data/`）
- **全局 ARCH 数据表格**：在主 `/docs/ARCH.md`（或模块 `ARCH.md`）中以结构化表格维护组件/服务清单、接口契约矩阵、数据模型汇总、部署与运维规范、第三方依赖与成本估算，供 TASK/QA 直接引用与验证；同时将这些数据驱动 `/docs/data/global-dependency-graph.md`、`/docs/data/traceability-matrix.md`、`/docs/data/arch-prd-traceability.md` 等全局追溯文档，以维持与 PRD 的一致性和可追溯性。
- **追溯产物**：参考 PRD 级别的追溯产物（如 `/docs/data/global-dependency-graph.md`、`/docs/data/traceability-matrix.md`、`/docs/data/arch-prd-traceability.md`），同步记录跨模块依赖、容量/性能指标、可用性目标、安全审查要点等“全局数据”字段，并确保这三份 `/docs/data/` 报告随架构更新一并刷新，以维持与 PRD 的一致性。
- **跨模块组件依赖图**：模块化项目时，在 `/docs/arch-modules/README.md` 维护模块索引表（含团队、状态、文档链接），并同步 `/docs/data/component-dependency-graph.md`，保持组件 ↔ Story 的追溯与依赖一致性。
- **PRD ↔ ARCH 追溯报告**：`/docs/data/arch-prd-traceability.md` 自动比对 Story ID 与 Component ID 在 PRD 与 ARCH 中的引用一致性，识别缺失项并标记需补充的故事/组件；通过 `npm run arch:sync -- --report` 或 `/arch sync` 生成，作为 ARCH 专家每日核查的“对齐仪表盘”。

### 数据视图
- 以 PRD 输出的“视图”组织方式为基础，分别呈现逻辑/组件、物理/部署、运行/运维、开发/集成、安全/合规等架构视图，配合图表（Mermaid/C4）与文字说明。
- 将 `/docs/ARCH.md`（如果是大项目还要考虑模块化的子模块 ARCH 文档） 中的数据视图小节与 `/docs/data/ERD.md`、`/docs/data/dictionary.md` 联动，涵盖主数据实体、关系、约束、索引策略、事务边界、一致性模型、容量/增长/回收策略、脱敏与备份方案。
- 补充接口调用链、异步消息路径、事件流、观测/告警链路等示意图，并在 ARCH 附录或 `/docs/data/` 的视图清单中记录版本、作者与用途，便于后续架构审查与测试追溯。

### 架构验证前置（Architecture Validation Gate）
- **架构对齐检查**：以 `/docs/data/traceability-matrix.md`、`/docs/data/goal-story-mapping.md`、`/docs/data/arch-prd-traceability.md` 为输入，确认每个关键 Story/NFR 在 ARCH 组件/模块/ADR 中有对应的实现路径，缺口以“Story/Component 追溯缺失”列表写入 ARCH 风险章节并通知 PRD/TASK；完成对齐后再执行 Gate。
- **架构风险清单**：参考 PRD Playbook §7 的技术风险、合规检查与依赖冲突条目，梳理当前架构未覆盖的风险（如新依赖链、数据合规点、性能边界），在 ARCH 风险表或 ADR 中记录缓解方案与责任人。
- **验证产出**：借助 `/arch sync` 或 `npm run arch:sync -- --report` 更新 `/docs/data/arch-prd-traceability.md` 与 `/docs/data/global-dependency-graph.md`，确保 PRD ↔ ARCH ID 与依赖图的双向一致；必要时生成新的 ADR/组件图供 TASK/QA 核查。
- **Gate 执行时点**：在 ARCH 文档审查/交付前完成验证后勾选 `ARCHITECTURE_DEFINED`，若发现阻塞性风险则退回 PRD/TASK，确保所有调整通过 ADR/风控表记录并同步。

## 完成定义（DoD）
- 明确以下视图（Mermaid 优先）：
  - **上下文/容器/组件**视图（C4 抽象即可）；
  - **运行时视图**（时序/交互）；
  - **数据视图**（主数据、关系、主外键、约束、索引策略、事务边界、一致性模型、容量/增长与保留期、数据分层与脱敏、备份与恢复）；
  - **接口视图**（API 契约/错误码/幂等/限流）；
  - **运维视图**（部署、伸缩、观测、告警、SLO）；
  - **安全与合规**（认证授权、审计、脱敏、合规清单）。
- **技术选型表**（方案对比→决策→影响→ADR 链接）。
- **角色覆盖与依赖一致性**：参考 `/docs/data/persona-story-matrix.md` 判断是否存在“孤儿角色”，并在架构视图或风险章节说明；保持“跨模块依赖关系”与 `/docs/data/global-dependency-graph.md` 同步，任何新添依赖同时更新这两份资源。
- 在 `/docs/AGENT_STATE.md` 勾选 `ARCHITECTURE_DEFINED`。

## 交接
- 移交给任务规划专家（TASK）。

## ARCH 模板

> 此模板落地了《Playbook》“标准ARCH文档结构”中的各项板块，使用时先按照模板写出章节，再回到 Playbook 做完整性/质量自检（例如 架构对齐、技术选型、风险/依赖列表、架构验证前置等）。

> 本文件承担小型项目架构模板与大型项目主架构模板的说明职责；如需拆分模块，参照 `/docs/arch-modules/MODULE-TEMPLATE.md` 生成每个功能域的模块架构文档，保持格式一致。

### 小型项目（单一 ARCH 模板）
**主 ARCH模板** 复制到 `/docs/ARCH.md`并补充内容。
```markdown
# 系统架构文档
日期：YYYY-MM-DD   版本：v0

## 1. 总览与目标
- 质量属性优先级（性能/可靠/成本/可演进…）

## 2. 视图
### 2.1 上下文/容器/组件（C4）
- Mermaid 图或文字结构
### 2.2 运行时视图
- 关键链路时序
### 2.3 数据视图
- 实体/关系/主外键/约束；索引策略；容量与保留；一致性与事务边界；合规与审计；备份与恢复
- 参考：`/docs/data/ERD.md`、`/docs/data/dictionary.md`
### 2.4 接口视图
- 外部/内部 API 契约、错误码、限流/幂等
### 2.5 运维视图
- 部署拓扑、弹性策略、可观测性、告警、SLO
### 2.6 安全与合规
- 身份与权限、审计、数据安全、合规要求

## 3. 技术选型与 ADR
- 选型对比表 → 决策 → ADR 链接

## 4. 风险与缓解
- …
```

### 大型项目（主从 ARCH 结构）
**主架构文档** 复制到`/docs/ARCH.md`并补充内容，保持**总纲与索引**，< 500 行，避免详细需求。

```markdown
# 系统架构文档（总纲）

> **说明**：本文档是大型项目的主架构文档，作为总纲与索引。详细架构设计见各功能域模块文档。

**日期**：YYYY-MM-DD
**版本**：v1.0
**状态**：✅ 已确认

## 1. 系统概述
- **系统边界**：（系统范围与对外接口）
- **核心目标**：（系统要解决的核心问题）
- **质量属性优先级**：性能 > 可靠性 > 成本 > 可演进性 > 安全性

## 2. 功能域架构索引

| 功能域 | 负责团队 | 文档链接 | 状态 | 最后更新 |
|--------|---------|---------|------|---------|
| 用户管理 | @team-backend | [user-management.md](arch-modules/user-management.md) | ✅ 已确认 | YYYY-MM-DD |
| 支付系统 | @team-payment | [payment-system.md](arch-modules/payment-system.md) | 🔄 进行中 | YYYY-MM-DD |
| 通知服务 | @team-notification | [notification-service.md](arch-modules/notification-service.md) | 📝 待启动 | - |
| （补充其他模块）| - | - | - | - |

## 3. 全局视图（跨模块）

### 3.1 系统全景（C4 Context）
（Mermaid 图：展示所有功能域与外部系统的交互）

### 3.2 全局数据流与集成点
- **数据流**：用户管理 → 支付系统 → 通知服务
- **集成点**：API Gateway、消息队列、共享数据库

### 3.3 横切关注点
- **日志**：ELK Stack（集中式日志）
- **监控**：Prometheus + Grafana（系统指标）
- **安全**：JWT 认证 + RBAC 授权
- **合规**：GDPR + PIPL

## 4. 全局技术选型与 ADR

| 技术栈 | 选择 | ADR 链接 |
|--------|------|---------|
| 前端框架 | React 18 | [ADR-001](adr/001-frontend-framework.md) |
| 后端框架 | Node.js + Express | [ADR-002](adr/002-backend-framework.md) |
| 数据库 | PostgreSQL 15 | [ADR-003](adr/003-database-selection.md) |
| 缓存 | Redis 7 | [ADR-004](adr/004-cache-strategy.md) |
| 部署平台 | AWS ECS + Fargate | [ADR-005](adr/005-deployment-platform.md) |
| 消息队列 | RabbitMQ | [ADR-006](adr/006-message-queue-selection.md) |

## 5. 跨模块依赖关系

``````mermaid
graph LR
    UserMgmt[用户管理] -->|提供用户信息| PaymentSys[支付系统]
    PaymentSys -->|触发通知| NotifSvc[通知服务]
    UserMgmt -->|用户事件| NotifSvc
``````

**依赖说明**：
- **用户管理 → 支付系统**：支付功能依赖用户身份验证（JWT Token）
- **支付系统 → 通知服务**：支付完成后通过消息队列异步发送通知
- **用户管理 → 通知服务**：用户注册/登录时发送欢迎邮件

## 6. 全局风险与缓解

| 风险类型 | 风险描述 | 影响范围 | 缓解措施 | 负责人 |
|---------|---------|---------|---------|--------|
| 单点故障 | 数据库主节点宕机 | 全系统 | 主从复制+自动故障转移 | @dba |
| 性能瓶颈 | API Gateway 过载 | 全系统 | 水平扩展+限流 | @devops |
| 数据一致性 | 跨模块数据不一致 | 支付+通知 | 使用分布式事务（Saga 模式） | @architect |

## 7. 变更记录

| 版本 | 日期 | 变更类型 | 变更描述 | 负责人 |
|------|------|---------|---------|--------|
| v1.0 | YYYY-MM-DD | 重构 | 从单一文件迁移到模块化架构 | @architect |

## 8. 相关文档

- **PRD 文档**：[PRD.md](PRD.md)
- **任务计划**：[TASK.md](TASK.md)
- **测试计划**：[QA.md](QA.md)
- **架构模块索引**：[module-list.md](arch-modules/module-list.md)
- **ADR 目录**：[adr/](adr/)
- **目录规范**：[CONVENTIONS.md](CONVENTIONS.md)
```

**子模块 ARCH 模板**（`/docs/arch-modules/{domain}/ARCH.md`）：详细需求
- 模块概述与边界（功能目标、质量属性、负责团队、上下游依赖）
- 模块级技术视图（Container/Component/运行时/数据/接口/部署）与数据模型、容量/保留、监控/SLO
- 模块级 ADR/风险（包括依赖冲突、合规/安全、性能边界）以及需要同步的全局追溯/接口表格

详细子模板示例均集中在 `/docs/prd-modules/MODULE-TEMPLATE.md`，ARCH 专家只需在主 ARCH 维护总纲/索引并调用该模板产出模块文档。

### 模块化工作流
1. **PRD 专家**：评估是否拆分，定位功能域，在主 PRD 维护模块索引，并根据 `/docs/prd-modules/MODULE-TEMPLATE.md` 创建子模块 PRD。
2. **ARCH 专家**：加载主 PRD 与相关模块 PRD 输出架构视图，保持架构模块与需求模块的追溯（参照 `/docs/data/global-dependency-graph.md`）。
3. **TASK 专家**：基于各模块 PRD 细化 WBS，可按模块记录依赖、关键路径与里程碑。
4. **TDD 专家**：依赖模块 PRD 实现、测试，确保 Story/AC 映射到追溯矩阵，并执行 Doc Sync Gate 。
5. **QA 专家**：基于追溯矩阵与模块 PRD 验证覆盖率，更新 `/docs/data/traceability-matrix.md` 和模块 `nfr-tracking.md` 状态。

## ADR 触发规则（PRD 阶段）
- 出现重要取舍（例如：架构变化、数据库调整）→ 新增 ADR；状态 `Proposed/Accepted`。

## 快捷命令
- `/arch data-view`：生成/刷新**数据视图**：更新 `/docs/ARCH.md` 的"数据视图"小节，并同步 `/docs/data/ERD.md`、`/docs/data/dictionary.md`；如涉及关键取舍，列出应新增的 **ADR** 草案标题（放入 `/docs/adr/`）。
- `/arch sync`：验证 **PRD ↔ ARCH ID 双向追溯**（Story ID、Component ID），确保架构文档与需求文档的 ID 引用一致性；支持 `--json`、`--report` 参数（详见 `npm run arch:sync`）。

## References
- Handbook: /AgentRoles/Handbooks/ARCHITECTURE-WRITER-EXPERT.playbook.md
- Module template: /docs/arch-modules/MODULE-TEMPLATE.md
