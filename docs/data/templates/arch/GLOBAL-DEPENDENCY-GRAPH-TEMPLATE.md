# Global Dependency Graph 模板

> **用途**：提供 ARCH/PRD/TASK 之间的跨模块目标与 Story 依赖视图，便于直接生成 `/docs/data/global-dependency-graph.md`。  
> **维护者**：ARCH 或 ARCH+TASK 专家；大模型可读取本模板直接输出完整文件。  
> **生成时机**：主要在 `PRD_CONFIRMED` → `TASK_PLANNED` 期间，或 Story/依赖发生变更时。
>
> **输入**：PRD（主/模块）、ARCH（组件/接口）、模块 Task（依赖/状态）、component 依赖图等；输出需同步到 `module-list.md` 与 Task 依赖段。

---

## 1. 报告概要

- **生成时间**：`{生成_time}`  
- **目标模块**：{module_list}  
- **关键发现**：{summary}  
- **责任人**：@arch-lead / @task-lead

## 2. 目标与 Story 映射

| Module / Goal | Story ID | Story Title | Priority | Component | Owner | 状态 |
|---------------|----------|-------------|----------|-----------|-------|------|
| User Management - 身份认证 | US-USER-001 | 用户注册 | P0 | USER-SVC | @arch-user | `📝 待启动` |
| Payment System - 高可用结算 | US-PAY-005 | 支付确认 | P0 | PAY-SVC | @arch-pay | `🔄 进行中` |

- `Module / Goal`：按模块/目标拆分高价值 Story ；`Component` 对应 ARCH 组件 ID。  
- `Priority`：P0/P1/P2；`状态` 使用统一符号（📝/🔄/✅/⚠️），反映 Story 当前依赖态势。  
- 可追加其他列（如 Milestone、Gate）以便 QA/TASK 同步。

## 3. 依赖与契约摘要

| Source Story | Target Story | Dependency Type | Trigger | Impact | Current Status | Action |
|--------------|-------------|----------------|---------|--------|----------------|--------|
| US-USER-003 | US-PAY-001 | FS | 登录态完成 | 支付需用户 | `🔄 进行中` | Mock login service |
| US-PAY-002 | US-NOTIF-001 | SS | 支付确认完成 | 异步通知 | `⚠️ 需更新` | 补充事件契约 |

- `Dependency Type`：FS/SS/FF/Other；`Current Status` 统一使用状态符号；`Action` 写出下步协调项。

## 4. 依赖关系可视化

```
graph TB
    classDef p0 fill:#FF6B6B,stroke:#C92A2A,stroke-width:3px,color:#fff
    classDef p1 fill:#FFD93D,stroke:#F59F00,stroke-width:2px
    classDef p2 fill:#A8DADC,stroke:#457B9D,stroke-width:1px
    classDef completed fill:#90EE90,stroke:#2D6A4F,stroke-width:2px
    classDef blocked fill:#FF8C8C,stroke:#C92A2A,stroke-width:2px,stroke-dasharray: 5 5

    subgraph USER["用户管理模块"]
        US_USER_001["US-USER-001<br/>用户注册<br/>P0"]
        US_USER_002["US-USER-002<br/>邮箱验证<br/>P0"]
    end

    subgraph PAY["支付系统模块"]
        US_PAY_001["US-PAY-001<br/>创建支付订单<br/>P0"]
        US_PAY_002["US-PAY-002<br/>支付确认<br/>P0"]
    end

    US_USER_001 --> US_USER_002
    US_USER_002 --> US_PAY_001
    US_PAY_001 --> US_PAY_002
    class US_USER_001,US_USER_002,US_PAY_001 p0

    %% 如需标记完成/阻塞，一行 `class <ID> completed` 或 `class <ID> blocked`
```

- 图示节点需与 2. 表格一致，无额外或遗漏 Story。  
- 可用 `class critical`/`class blocked` 和箭头样式标注关键路径、阻塞链。

## 5. 关键路径与并行机会

- **关键路径**：列出最长依赖链（Story 列表）与对应风险/关注点。  
- **并行机会**：列出弱依赖或 P2 Story，说明可与关键路径并行执行。  
- 可附表：`Story Chain / Duration / Risk / Notes`。

## 6. 维护 & 同步

1. 复制本模板到 `/docs/data/global-dependency-graph.md` 并替换占位内容（如 `{module_list}`、`{summary}`）。  
2. 更新后同 步 `module-list.md` 与 `/docs/TASK.md` 的依赖部分；若 QA/Traceability 也受影响，请在 `/docs/data/traceability-matrix.md` 备注。  
3. 每次生成记录 `生成时间` 与 `报告版本` 到任务 state 或报告元数据，便于追踪演进。

---
> 本模板为 global dependency graph 的唯一真相，大模型只需输出上述段落以生成完整档案。
