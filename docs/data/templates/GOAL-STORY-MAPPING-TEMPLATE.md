# Global Dependency Graph 模板

> **目的**：提供 ARCH/PRD/QA/TDD 之间的跨模块依赖视图，说明模块目标、Story 对应关系、依赖类型与执行状态，为 `global-dependency-graph.md` 提供唯一模板。  
> **维护者**：ARCH 专家与 TASK 专家协同填充，大模型可根据此模板直接输出完整文件。

## 1. 生成说明

- **输入来源**：
  - `/docs/PRD.md` 与 `/docs/prd-modules/{domain}/PRD.md` 提供 Story ID/Title、Goal、Priority
  - `/docs/ARCH.md` 与 `/docs/arch-modules/{domain}/ARCH.md` 提供 Component ID、Module/Service 结构
  - `/docs/task-modules/{domain}/TASK.md` 提供 Task ID、里程碑/状态、依赖关系
  - `docs/data/templates/COMPONENT-DEPENDENCY-GRAPH-TEMPLATE.md` 用于补充细化依赖图形

- **输出位置**：生成路径 `/docs/data/global-dependency-graph.md`，并在 `qa-modules/module-list.md`、`task-modules/module-list.md` 中同步记录依赖状态。
- **生成方式**：大模型可根据模板结构依次填充“目标/Story Mapping”、“依赖摘要”、“依赖图”与“风险、一致性核查”段落。

## 2. 目标与 Story Mapping

| Module/Goal | Story ID | Story Title | 相应 ARCH Component | Priority | Owner | 状态 |
|-------------|----------|-------------|--------------------|----------|-------|------|
| User Management - 身份认证目标 | US-USER-001 | 用户注册 | USER-SVC-001 | P0 | @arch-lead | `📝 待启动` |
| Payment System - 高可用结算 | US-PAY-005 | 支付确认 | PAY-SVC-001 | P0 | @arch-pay | `🔄 进行中` |

- `Module/Goal`：按 ARCH 服务或目标拆分（如“支付安全目标”、“通知高可靠性”）。  
- `Story ID`：来源 PRD/模块 PRD。  
- `Arch Component`：与 `Component ID` 保持一致，方便 `component-dependency-graph` 与 `global-dependency-graph` 对齐。  
- `状态`：使用统一状态 `📝/🔄/✅/⚠️` 反馈依赖评审/Story/Task 进度。

## 3. 跨模块依赖摘要

| 来源模块 | 目标模块 | 依赖类型 | 触发条件 | 影响 | 当前状态 | 缓解措施 |
|-----------|-----------|----------|----------|------|------------|------------------|
| auth-service | payment-system | FS | 用户注册完成 | 支付需要认证 | `🔄 进行中` | mock auth, 补充接口契约 |
| payment-system | notification | SS | 支付完成后推送 | 通知依赖回调 | `⚠️ 需更新` | 事件重试队列 |

- `依赖类型`：FS/SS/FF/Other。  
- `触发条件`：描述何种事件/里程碑使后置任务触发。  
- `当前状态`：依赖当前是否确认；若阻塞列 `⚠️`，并补充后续行动。

## 4. 依赖图示

```
graph TB
    USER-SVC["USER-SVC<br/>用户管理<br/>P0"]
    AUTH-SVC["AUTH-SVC<br/>认证<br/>P0"]
    PAY-SVC["PAY-SVC<br/>支付<br/>P0"]

    USER-SVC --> AUTH-SVC
    AUTH-SVC --> PAY-SVC

    classDef critical fill:#f96,stroke:#333,stroke-width:2px;
    class USER-SVC,AUTH-SVC critical;
```

- 图中节点命名应与模块/Component 动态同步，如 `AUTH-SVC`。  
- `class critical/blocked` 用于标记关键路径/阻塞模块。  
- 箭头关系须与“依赖摘要”表格一致。

## 5. 风险与一致性核查

1. **发现**：列出 Story<>Component 还未对齐的项（如 PRD Story 未在 ARCH 任何 Component 中体现）。  
2. **影响**：说明可能影响的里程碑/测试（如“若认证延迟，则支付无法执行 E2E”）。  
3. **责任人**：明确归属（ARCH/QA/TASK）。  
4. **行动计划**：如“补充 Mock 接口”“调整依赖顺序”。

## 6. 生成与维护建议

- 大模型生成时可先列出 Story/Component 对应表，再输出“依赖摘要”、“Mermaid 图”、“风险”段，每段保持标题明确。  
- 更新时同步 `/docs/prd-modules/module-list.md` 与 `/docs/task-modules/module-list.md` 中的“依赖”状态，保持 ARCH/PRD/TASK/QA 完整追溯。  
- 有新增模块或依赖时，调用 `/task plan` 或 `npm run arch:sync` 以刷新 global dependency 视图，确保 `global-dependency-graph.md` 与 `global-dependency-graph` 计划一致。

---  
> 将本模板复制到 `/docs/data/global-dependency-graph.md` 并替换占位内容即可，生成后与 ARCH/PRD/QA 流程共享，保持跨模块依赖清晰。  
