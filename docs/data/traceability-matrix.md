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
| US-CMDSURF-006 | 短提示词补齐与显式验收门禁 | AC-CMDSURF-006-01 | TC-CMDSURF-010 | ✅ TDD 通过 / 待 QA | @qa | 任务输入规则与 mutation/non-mutation 启动边界 |
| US-CMDSURF-006 | Codex 审批策略示例收敛 | AC-CMDSURF-006-02 | TC-CMDSURF-011 | ✅ TDD 通过 / 待 QA | @qa | 模板内容扫描不得推荐 `on-failure` |
| US-CMDSURF-007 | Worktree 默认最新远端基线 | AC-CMDSURF-007-01 | TC-CMDSURF-012 | ✅ TDD 通过 / 待 QA | @qa | 远端前进后 required fetch、固定 SHA 与 HEAD 一致性回归通过 |
| US-CMDSURF-007 | Worktree 基线失败阻断 | AC-CMDSURF-007-02 | TC-CMDSURF-013 | ✅ TDD 通过 / 待 QA | @qa | fetch/base 失败无 branch、worktree、session 副作用回归通过 |
| US-CMDSURF-007 | Worktree 显式离线基线 | AC-CMDSURF-007-03 | TC-CMDSURF-014 | ✅ TDD 通过 / 待 QA | @qa | skip 仅缓存 remote/local base 且无任意 HEAD fallback 回归通过 |
| US-CMDSURF-007 | Worktree 无网络例外路径 | AC-CMDSURF-007-04 | TC-CMDSURF-015 | ✅ TDD 通过 / 待 QA | @qa | dry-run/resume 无 fetch、无 HEAD 变化回归通过 |
| US-CMDSURF-008 | 远端同名分支保护 | AC-CMDSURF-008-01 | TC-CMDSURF-016 | ✅ TDD 通过 / 待 QA | @qa | worktree new 冲突阻断与三 clone 交错模拟通过 |
| US-CMDSURF-008 | 跨电脑远端恢复 | AC-CMDSURF-008-02 | TC-CMDSURF-017 | ✅ TDD 通过 / 待 QA | @qa | worktree resume 从精确远端 SHA 建立本机 session |
| US-CMDSURF-008 | QA 双 SHA 回执 | AC-CMDSURF-008-03 | TC-CMDSURF-018 | ✅ TDD 通过 / 待 QA | @qa | base/head 漂移与 PR ref 失配回归通过 |
| US-CMDSURF-008 | 主干乐观并发 | AC-CMDSURF-008-04 | TC-CMDSURF-019 | ✅ TDD 通过 / 待 QA | @qa | 期望 head、普通 push 与 stale base 拒绝模拟通过 |
| US-CMDSURF-008 | 所有电脑同权 | AC-CMDSURF-008-05 | TC-CMDSURF-020 | ✅ TDD 通过 / 待 QA | @qa | 无身份门禁，配置主干 force/delete 拒绝测试通过 |
| US-CMDSURF-008 | 无 GitHub CI | AC-CMDSURF-008-06 | TC-CMDSURF-021 | ✅ TDD 通过 / 待 QA | @qa | workflows 源与模板目标均未变化；本地门禁测试通过 |
| US-ENVINIT-001 | 首次创建六个环境文件 | AC-ENVINIT-001-01 | TC-ENVINIT-001 | ✅ TDD 通过 / 待 QA | @qa | 三组 example/实际文件配对初始化 |
| US-ENVINIT-001 | Git 所有权边界 | AC-ENVINIT-001-02 | TC-ENVINIT-002 | ✅ TDD 通过 / 待 QA | @qa | example 可跟踪、实际文件被忽略 |
| US-ENVINIT-002 | 已有文件保护 | AC-ENVINIT-002-01 | TC-ENVINIT-003 | ✅ TDD 通过 / 待 QA | @qa | 后续 apply 不修改已有内容 |
| US-ENVINIT-003 | Dry-run 无副作用 | AC-ENVINIT-003-01 | TC-ENVINIT-004 | ✅ TDD 通过 / 待 QA | @qa | 只报告缺失文件，不写盘 |

## 覆盖率统计

| 指标 | 数值 | 目标 |
| --- | --- | --- |
| 总 Story 数 | 11 | - |
| 已关联测试用例的 Story 数 | 11 | 100% |
| 总 AC 数 | 24 | - |
| 已关联测试用例的 AC 数 | 24 | 100% |
| 测试通过的 AC 数 | 17 | 100% |
| 测试失败的 AC 数 | 0 | 0 |
| 需求覆盖率 | 100% | ≥95% |
| 测试通过率 | 71% | 100% |

US-CMDSURF-007 已通过 worktree 核心 40/40、全仓 Node 305/305 与 setup 56/56；剩余传播 AC 由目标项目收敛 dry-run 与 QA 合并后更新为已确认。

US-CMDSURF-008 已由用户确认最小实现范围；待完成 TC-CMDSURF-016~021 的定向、三电脑 bare Git 和模板传播验收。
