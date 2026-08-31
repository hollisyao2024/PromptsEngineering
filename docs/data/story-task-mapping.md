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
| US-CMDSURF-005 | 缺失容器目录按需创建 | TASK-CMDSURF-009 | RED：缺失、幂等、非法目标与只读边界 | AC-CMDSURF-005-01~03 / TC-CMDSURF-007~009 |
| US-CMDSURF-005 | 缺失容器目录按需创建 | TASK-CMDSURF-010 | 共享初始化器与安全校验 | AC-CMDSURF-005-01~03 / TC-CMDSURF-007~009 |
| US-CMDSURF-005 | 缺失容器目录按需创建 | TASK-CMDSURF-011 | 写入命令调用点集成 | AC-CMDSURF-005-01~03 / TC-CMDSURF-007~009 |
| US-CMDSURF-005 | 缺失容器目录按需创建 | TASK-CMDSURF-012 | 回归与 QA 合并门禁 | AC-CMDSURF-005-03 / TC-CMDSURF-009 |
| US-CMDSURF-006 | 短提示词补齐与显式验收门禁 | TASK-CMDSURF-013 | RED：任务创建与模板内容契约 | AC-CMDSURF-006-01~02 / TC-CMDSURF-010~011 |
| US-CMDSURF-006 | 短提示词补齐与显式验收门禁 | TASK-CMDSURF-014 | 任务输入规则与创建门禁 | AC-CMDSURF-006-01 / TC-CMDSURF-010 |
| US-CMDSURF-006 | Codex 审批策略示例收敛 | TASK-CMDSURF-015 | 配置示例清理 | AC-CMDSURF-006-02 / TC-CMDSURF-011 |
| US-CMDSURF-006 | 短提示词补齐与显式验收门禁 | TASK-CMDSURF-016 | 回归与 QA 合并门禁 | AC-CMDSURF-006-01~02 / TC-CMDSURF-010~011 |
| US-CMDSURF-007 | Worktree 已验证远端基线 | TASK-CMDSURF-017 | RED：远端、失败、skip 与无网络例外契约 | AC-CMDSURF-007-01~04 / TC-CMDSURF-012~015 |
| US-CMDSURF-007 | Worktree 已验证远端基线 | TASK-CMDSURF-018 | 严格 fetch、固定 SHA 与结构化证据 | AC-CMDSURF-007-01~04 / TC-CMDSURF-012~015 |
| US-CMDSURF-007 | Worktree 已验证远端基线 | TASK-CMDSURF-019 | 协议与模板版本同步 | AC-CMDSURF-007-01~04 / TC-CMDSURF-012~015 |
| US-CMDSURF-007 | Worktree 已验证远端基线 | TASK-CMDSURF-020 | 回归与 QA 合并门禁 | AC-CMDSURF-007-01~04 / TC-CMDSURF-012~015 |
| US-ENVINIT-001 | 首次创建六个环境文件 | TASK-ENVINIT-001 | RED：首次创建与 Git 所有权契约 | AC-ENVINIT-001-01~02 / TC-ENVINIT-001~002 |
| US-ENVINIT-001 | 首次创建六个环境文件 | TASK-ENVINIT-002 | example、manifest 与 ignore 合约 | AC-ENVINIT-001-01~02 / TC-ENVINIT-001~002 |
| US-ENVINIT-001 | 首次创建六个环境文件 | TASK-ENVINIT-003 | 实际文件初始化器 | AC-ENVINIT-001-01 / TC-ENVINIT-001 |
| US-ENVINIT-001 | Git 所有权边界 | TASK-ENVINIT-004 | 传播与 Git QA | AC-ENVINIT-001-02 / TC-ENVINIT-002 |
| US-ENVINIT-002 | 已有文件保护 | TASK-ENVINIT-001 | RED：sentinel 内容保护 | AC-ENVINIT-002-01 / TC-ENVINIT-003 |
| US-ENVINIT-002 | 已有文件保护 | TASK-ENVINIT-003 | exclusive create 实现 | AC-ENVINIT-002-01 / TC-ENVINIT-003 |
| US-ENVINIT-003 | Dry-run 无副作用 | TASK-ENVINIT-001 | RED：dry-run 契约 | AC-ENVINIT-003-01 / TC-ENVINIT-004 |
| US-ENVINIT-003 | Dry-run 无副作用 | TASK-ENVINIT-003 | dry-run 初始化计划 | AC-ENVINIT-003-01 / TC-ENVINIT-004 |
| US-ENVINIT-003 | Dry-run 无副作用 | TASK-ENVINIT-004 | dry-run 集成验收 | AC-ENVINIT-003-01 / TC-ENVINIT-004 |

所有 Story 和 Task 均有映射；环境文件模块沿 RED → example/manifest → 初始化器 → 传播 QA 的关键路径交付。
