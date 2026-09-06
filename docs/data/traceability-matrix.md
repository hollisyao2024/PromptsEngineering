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
| US-CMDSURF-008 | 远端同名分支保护 | AC-CMDSURF-008-01 | TC-CMDSURF-016 | ✅ QA 通过 | @qa | worktree new 冲突阻断与三 clone 交错模拟通过 |
| US-CMDSURF-008 | 跨电脑远端恢复 | AC-CMDSURF-008-02 | TC-CMDSURF-017 | ✅ QA 通过 | @qa | worktree resume 从精确远端 SHA 建立本机 session |
| US-CMDSURF-008 | QA 双 SHA 回执 | AC-CMDSURF-008-03 | TC-CMDSURF-018 | ✅ QA 通过 | @qa | base/head 漂移、PR ref 失配与实际 QA 收据验证通过 |
| US-CMDSURF-008 | 主干乐观并发 | AC-CMDSURF-008-04 | TC-CMDSURF-019 | ✅ QA 通过 | @qa | 期望 head、普通 push 与 stale base 拒绝模拟通过 |
| US-CMDSURF-008 | 所有电脑同权 | AC-CMDSURF-008-05 | TC-CMDSURF-020 | ✅ QA 通过 | @qa | 无身份门禁，配置主干 force/delete 拒绝测试通过 |
| US-CMDSURF-008 | 无 GitHub CI | AC-CMDSURF-008-06 | TC-CMDSURF-021 | ✅ QA 通过 | @qa | workflows 源与模板目标均未变化；所有门禁本地完成 |
| US-CMDSURF-009 | 息壤身份与自然语言路由 | AC-CMDSURF-009-01 | TC-CMDSURF-022 | ✅ QA 通过 | @qa | 身份、官方源、自然语言与 CLI 路由传播通过 |
| US-CMDSURF-009 | 官方模板固定 SHA 同步 | AC-CMDSURF-009-02 | TC-CMDSURF-023 | ✅ QA 通过 | @qa | required fetch、远端前进、固定 SHA 与源执行器自举通过 |
| US-CMDSURF-009 | 模板来源失败阻断 | AC-CMDSURF-009-03 | TC-CMDSURF-024 | ✅ QA 通过 | @qa | fetch/source/manifest gap 均在目标 tracked 写入前阻断 |
| US-CMDSURF-009 | 模板所有权与收敛应用 | AC-CMDSURF-009-04 | TC-CMDSURF-025 | ✅ QA 通过 | @qa | dry-run、冲突阻断、apply 与 project-owned sentinel 通过 |
| US-CMDSURF-009 | 模板同步幂等与审计输出 | AC-CMDSURF-009-05 | TC-CMDSURF-026 | ✅ QA 通过 | @qa | 二次收敛、固定审计字段与临时快照清理通过 |
| US-ENVINIT-001 | 首次创建六个环境文件 | AC-ENVINIT-001-01 | TC-ENVINIT-001 | ✅ TDD 通过 / 待 QA | @qa | 三组 example/实际文件配对初始化 |
| US-ENVINIT-001 | Git 所有权边界 | AC-ENVINIT-001-02 | TC-ENVINIT-002 | ✅ TDD 通过 / 待 QA | @qa | example 可跟踪、实际文件被忽略 |
| US-ENVINIT-002 | 已有文件保护 | AC-ENVINIT-002-01 | TC-ENVINIT-003 | ✅ TDD 通过 / 待 QA | @qa | 后续 apply 不修改已有内容 |
| US-ENVINIT-003 | Dry-run 无副作用 | AC-ENVINIT-003-01 | TC-ENVINIT-004 | ✅ TDD 通过 / 待 QA | @qa | 只报告缺失文件，不写盘 |
| US-CMDSURF-009 | 官方模板匿名获取 | AC-CMDSURF-009-06 | TC-CMDSURF-027 | ✅ TDD 通过 | @qa | 官方无/无效 token、HTTP 请求无凭据、401 单次阻断、真实匿名 fetch 及项目鉴权回归通过 |

## 覆盖率统计

| 指标 | 数值 | 目标 |
| --- | --- | --- |
| 总 Story 数 | 12 | - |
| 已关联测试用例的 Story 数 | 12 | 100% |
| 总 AC 数 | 30 | - |
| 已关联测试用例的 AC 数 | 30 | 100% |
| 测试通过的 AC 数 | 29 | 100% |
| 测试失败的 AC 数 | 0 | 0 |
| 需求覆盖率 | 100% | ≥95% |
| 测试通过率 | 97% | 100% |

US-CMDSURF-007 已通过 worktree 核心 40/40、全仓 Node 305/305 与 setup 56/56；剩余传播 AC 由目标项目收敛 dry-run 与 QA 合并后更新为已确认。

US-CMDSURF-008 已完成 TC-CMDSURF-016~021：定向回归、三电脑 bare Git、模板传播收敛与 QA 双 SHA 收据均通过；GitHub workflows 保持 project-owned 且未被触碰。

US-CMDSURF-009 的 TC-CMDSURF-022~026 已完成 QA：定向、setup、完整模板引导与全量 Node 回归均零失败，QA receipt 已绑定当前 base/head，等待合并门禁。
