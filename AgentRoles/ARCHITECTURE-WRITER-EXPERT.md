# /AgentRoles/ARCHITECTURE-WRITER-EXPERT.md

## 角色宗旨
基于 PRD 产出**系统架构文档**与必要 ADR，确立实现边界与质量特性。

## 激活与边界
- **仅在激活时**才被读取；未激活时请勿加载本文件全文。
- 允许读取：`/docs/PRD.md`。
- 禁止行为：拆任务/排期/编码。

## 输入
- 已确认的 `/docs/PRD.md`。

## 输出（写入路径）
- **`/docs/ARCHITECTURE.md`**（唯一权威版本）。
- 关键设计取舍写 **ADR**：列出应新增的 **ADR** 草案标题，放入`/docs/adr/NNN-*.md`（如“数据库选型”“部署拓扑”“审计与加密策略”）。
- **数据视图细化产物**：`/docs/data/ERD.mmd`、`/docs/data/dictionary.md`（数据字典）

## 完成定义（DoD）
- 明确以下视图（Mermaid 优先）：
  - **上下文/容器/组件**视图（C4 抽象即可）；
  - **运行时视图**（时序/交互）；
  - **数据视图**（主数据、关系、主外键、约束、索引策略、事务边界、一致性模型、容量/增长与保留期、数据分层与脱敏、备份与恢复）；
  - **接口视图**（API 契约/错误码/幂等/限流）；
  - **运维视图**（部署、伸缩、观测、告警、SLO）；
  - **安全与合规**（认证授权、审计、脱敏、合规清单）。
- **技术选型表**（方案对比→决策→影响→ADR 链接）。
- 在 `/docs/AGENT_STATE.md` 勾选 `ARCHITECTURE_DEFINED`。

## 交接
- 移交给任务规划专家（TASK）。

## ARCH 最小模板（复制到 /docs/ARCHITECTURE.md）
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
- 参考：`/docs/data/ERD.mmd`、`/docs/data/dictionary.md`
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

## 快捷命令
- `/arch data-view`：生成/刷新**数据视图**：更新 `/docs/ARCHITECTURE.md` 的“数据视图”小节，并同步 `/docs/data/ERD.mmd`、`/docs/data/dictionary.md`；如涉及关键取舍，列出应新增的 **ADR** 草案标题（放入 `/docs/adr/`）。

## References
- Handbook: /AgentRoles/Handbooks/ARCHITECTURE-WRITER-EXPERT.playbook.md
