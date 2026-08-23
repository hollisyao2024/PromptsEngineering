# 全局需求追溯矩阵

| Story ID | Story Title | AC ID | Test Case ID | 状态 | 负责人 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| US-CMDSURF-001 | Private 服务快捷语法 | AC-CMDSURF-001-01 | TC-CMDSURF-001 | ✅ TDD 通过 | @qa | `/private restart` 文档与 CLI 路由已覆盖 |
| US-CMDSURF-002 | 客户端开发与构建 | AC-CMDSURF-002-01 | TC-CMDSURF-002 | ✅ TDD 通过 | @qa | app dev 平台/profile 精确选择已覆盖 |
| US-CMDSURF-002 | 客户端开发与构建 | AC-CMDSURF-002-02 | TC-CMDSURF-003 | ✅ TDD 通过 | @qa | app build 与 server build 路由已覆盖 |
| US-CMDSURF-003 | 负向阻断 | AC-CMDSURF-003-01 | TC-CMDSURF-004 | ✅ TDD 通过 | @qa | 缺失平台、配置和显式 profile 无回退已覆盖 |
| US-CMDSURF-004 | 模板传播所有权 | AC-CMDSURF-004-01 | TC-CMDSURF-005 | 📝 待启动 | @qa | TASK-CMDSURF-005：dry-run/apply/convergence |
| US-CMDSURF-004 | 默认命令矩阵传播 | AC-CMDSURF-004-02 | TC-CMDSURF-006 | ✅ TDD 通过 / 待 QA | @qa | 稀疏配置继承 32/32，target apply 收敛，ship 空默认值 |

## 覆盖率统计

| 指标 | 数值 | 目标 |
| --- | --- | --- |
| 总 Story 数 | 4 | - |
| 已关联测试用例的 Story 数 | 4 | 100% |
| 总 AC 数 | 5 | - |
| 已关联测试用例的 AC 数 | 5 | 100% |
| 测试通过的 AC 数 | 4 | 100% |
| 测试失败的 AC 数 | 0 | 0 |
| 需求覆盖率 | 100% | ≥95% |
| 测试通过率 | 80% | 100% |

剩余传播 AC 由目标项目收敛 dry-run 与 QA 合并后更新为已确认。
