# 任务依赖矩阵

| 前置 Task | 后置 Task | 类型 | 提前量 | 关键路径 | 说明 |
| --- | --- | --- | --- | --- | --- |
| TASK-CMDSURF-001 | TASK-CMDSURF-002 | Finish-to-start | 0 | 是 | RED 后进入配置与路由实现 |
| TASK-CMDSURF-002 | TASK-CMDSURF-003 | Finish-to-start | 0 | 是 | 配置路由后进入 Dispatcher 与文档 |
| TASK-CMDSURF-003 | TASK-CMDSURF-004 | Finish-to-start | 0 | 是 | 实现后进入模板 QA/合并 |
| TASK-CMDSURF-004 | TASK-CMDSURF-005 | Finish-to-start | 0 | 是 | 模板合并后进入目标项目传播 |

```mermaid
flowchart LR
  T1[TASK-CMDSURF-001] --> T2[TASK-CMDSURF-002]
  T2 --> T3[TASK-CMDSURF-003]
  T3 --> T4[TASK-CMDSURF-004]
  T4 --> T5[TASK-CMDSURF-005]
```
