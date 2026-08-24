# Story → Task 映射

| Story ID | Story Title | Task ID | Task Title | AC/Test |
| --- | --- | --- | --- | --- |
| US-CMDSURF-001 | Private 服务快捷语法 | TASK-CMDSURF-001 | RED：语法契约 | AC-CMDSURF-001-01 / TC-CMDSURF-001 |
| US-CMDSURF-002 | 客户端开发与构建 | TASK-CMDSURF-002 | 配置与 CLI | AC-CMDSURF-002-01 / TC-CMDSURF-002 |
| US-CMDSURF-002 | 客户端开发与构建 | TASK-CMDSURF-003 | Dispatcher 与文档 | AC-CMDSURF-002-02 / TC-CMDSURF-003 |
| US-CMDSURF-003 | 负向阻断 | TASK-CMDSURF-003 | Dispatcher 与文档 | AC-CMDSURF-003-01 / TC-CMDSURF-004 |
| US-CMDSURF-004 | 模板传播所有权 | TASK-CMDSURF-004 | 模板回归、QA 与合并 | AC-CMDSURF-004-01 / TC-CMDSURF-005 |
| US-CMDSURF-004 | 模板传播所有权 | TASK-CMDSURF-005 | XiaoLan 传播验收 | AC-CMDSURF-004-01 / TC-CMDSURF-005 |
| US-CMDSURF-004 | 默认命令矩阵传播 | TASK-CMDSURF-006 | RED：完整矩阵契约 | AC-CMDSURF-004-02 / TC-CMDSURF-006 |
| US-CMDSURF-004 | 默认命令矩阵传播 | TASK-CMDSURF-007 | 中央模板登记 | AC-CMDSURF-004-02 / TC-CMDSURF-006 |
| US-CMDSURF-004 | 默认命令矩阵传播 | TASK-CMDSURF-008 | 实际项目传播验收 | AC-CMDSURF-004-02 / TC-CMDSURF-006 |
| US-ENVINIT-001 | 首次创建六个环境文件 | TASK-ENVINIT-001~003 | RED、source/manifest、初始化器 | AC-ENVINIT-001-01 / TC-ENVINIT-001 |
| US-ENVINIT-001 | Git 所有权边界 | TASK-ENVINIT-002、004 | ignore 契约与传播 QA | AC-ENVINIT-001-02 / TC-ENVINIT-002 |
| US-ENVINIT-002 | 已有文件保护 | TASK-ENVINIT-001、003 | sentinel RED 与 exclusive create | AC-ENVINIT-002-01 / TC-ENVINIT-003 |
| US-ENVINIT-003 | Dry-run 无副作用 | TASK-ENVINIT-001、003、004 | dry-run 契约与集成验收 | AC-ENVINIT-003-01 / TC-ENVINIT-004 |

所有 Story 和 Task 均有映射；环境文件模块沿 RED → example/manifest → 初始化器 → 传播 QA 的关键路径交付。
