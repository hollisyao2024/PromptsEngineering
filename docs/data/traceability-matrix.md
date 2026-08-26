# 全局需求追溯矩阵

| Story ID | Story Title | AC ID | Test Case ID | 状态 | 负责人 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| US-CMDSURF-001 | Private 服务快捷语法 | AC-CMDSURF-001-01 | TC-CMDSURF-001 | ✅ TDD 通过 | @qa | `/private restart` 文档与 CLI 路由已覆盖 |
| US-CMDSURF-002 | 客户端开发与构建 | AC-CMDSURF-002-01 | TC-CMDSURF-002 | ✅ TDD 通过 | @qa | app dev 平台/profile 精确选择已覆盖 |
| US-CMDSURF-002 | 客户端开发与构建 | AC-CMDSURF-002-02 | TC-CMDSURF-003 | ✅ TDD 通过 | @qa | app build 与 server build 路由已覆盖 |
| US-CMDSURF-003 | 负向阻断 | AC-CMDSURF-003-01 | TC-CMDSURF-004 | ✅ TDD 通过 | @qa | 缺失平台、配置和显式 profile 无回退已覆盖 |
| US-CMDSURF-004 | 模板传播所有权 | AC-CMDSURF-004-01 | TC-CMDSURF-005 | 📝 待启动 | @qa | TASK-CMDSURF-005：dry-run/apply/convergence |
| US-CMDSURF-004 | 默认命令矩阵传播 | AC-CMDSURF-004-02 | TC-CMDSURF-006 | ✅ TDD 通过 / 待 QA | @qa | 稀疏配置继承 32/32，target apply 收敛，ship 空默认值 |
| US-CMDSURF-005 | 缺失容器目录按需创建 | AC-CMDSURF-005-01 | TC-CMDSURF-007 | ✅ TDD 通过 / 待 QA | @qa | shared/devops/worktree 覆盖 worktrees、tmp、cache、artifacts 缺失场景 |
| US-CMDSURF-005 | 容器目录初始化幂等 | AC-CMDSURF-005-02 | TC-CMDSURF-008 | ✅ TDD 通过 / 待 QA | @qa | 重复初始化与 sentinel 已有内容保护通过 |
| US-CMDSURF-005 | 容器目录初始化失败边界 | AC-CMDSURF-005-03 | TC-CMDSURF-009 | ✅ TDD 通过 / 待 QA | @qa | 非法 key、文件/junction 占位、只读无副作用与 DevOps 阻断通过 |
| US-ENVINIT-001 | 首次创建六个环境文件 | AC-ENVINIT-001-01 | TC-ENVINIT-001 | ✅ TDD 通过 / 待 QA | @qa | 三组 example/实际文件配对初始化 |
| US-ENVINIT-001 | Git 所有权边界 | AC-ENVINIT-001-02 | TC-ENVINIT-002 | ✅ TDD 通过 / 待 QA | @qa | example 可跟踪、实际文件被忽略 |
| US-ENVINIT-002 | 已有文件保护 | AC-ENVINIT-002-01 | TC-ENVINIT-003 | ✅ TDD 通过 / 待 QA | @qa | 后续 apply 不修改已有内容 |
| US-ENVINIT-003 | Dry-run 无副作用 | AC-ENVINIT-003-01 | TC-ENVINIT-004 | ✅ TDD 通过 / 待 QA | @qa | 只报告缺失文件，不写盘 |

## 覆盖率统计

| 指标 | 数值 | 目标 |
| --- | --- | --- |
| 总 Story 数 | 8 | - |
| 已关联测试用例的 Story 数 | 8 | 100% |
| 总 AC 数 | 12 | - |
| 已关联测试用例的 AC 数 | 12 | 100% |
| 测试通过的 AC 数 | 11 | 100% |
| 测试失败的 AC 数 | 0 | 0 |
| 需求覆盖率 | 100% | ≥95% |
| 测试通过率 | 92% | 100% |

剩余传播 AC 由目标项目收敛 dry-run 与 QA 合并后更新为已确认。
