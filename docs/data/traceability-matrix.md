# 全局需求追溯矩阵

| Story ID | Story Title | AC ID | Test Case ID | 状态 | 负责人 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| US-CMDSURF-001 | Private 服务快捷语法 | AC-CMDSURF-001-01 | TC-CMDSURF-001 | ✅ TDD 通过 | @qa | `/private restart` 文档与 CLI 路由已覆盖 |
| US-CMDSURF-002 | 客户端开发与构建 | AC-CMDSURF-002-01 | TC-CMDSURF-002 | ✅ TDD 通过 | @qa | app dev 平台/profile 精确选择已覆盖 |
| US-CMDSURF-002 | 客户端开发与构建 | AC-CMDSURF-002-02 | TC-CMDSURF-003 | ✅ TDD 通过 | @qa | app build 与 server build 路由已覆盖 |
| US-CMDSURF-003 | 负向阻断 | AC-CMDSURF-003-01 | TC-CMDSURF-004 | ✅ TDD 通过 | @qa | 缺失平台、配置和显式 profile 无回退已覆盖 |
| US-CMDSURF-004 | 模板传播所有权 | AC-CMDSURF-004-01 | TC-CMDSURF-005 | 📝 待启动 | @qa | TASK-CMDSURF-005：dry-run/apply/convergence |
| US-CMDSURF-004 | 默认命令矩阵传播 | AC-CMDSURF-004-02 | TC-CMDSURF-006 | ✅ QA 通过 | @qa | 稀疏配置继承 32/32，target apply 收敛，ship 空默认值 |
| US-CMDSURF-005 | 缺失容器目录按需创建 | AC-CMDSURF-005-01 | TC-CMDSURF-007 | ✅ QA 通过 | @qa | shared/devops/worktree 覆盖 worktrees、tmp、cache、artifacts 缺失场景 |
| US-CMDSURF-005 | 容器目录初始化幂等 | AC-CMDSURF-005-02 | TC-CMDSURF-008 | ✅ QA 通过 | @qa | 重复初始化与 sentinel 已有内容保护通过 |
| US-CMDSURF-005 | 容器目录初始化失败边界 | AC-CMDSURF-005-03 | TC-CMDSURF-009 | ✅ QA 通过 | @qa | 非法 key、文件/junction 占位、只读无副作用与 DevOps 阻断通过 |
| US-CMDSURF-006 | 短提示词补齐与显式验收门禁 | AC-CMDSURF-006-01 | TC-CMDSURF-010 | ✅ QA 通过 | @qa | 任务输入规则与 mutation/non-mutation 启动边界 |
| US-CMDSURF-006 | Codex 审批策略示例收敛 | AC-CMDSURF-006-02 | TC-CMDSURF-011 | ✅ QA 通过 | @qa | 模板内容扫描不得推荐 `on-failure` |
| US-CMDSURF-007 | Worktree 默认最新远端基线 | AC-CMDSURF-007-01 | TC-CMDSURF-012 | ✅ QA 通过 | @qa | 远端前进后 required fetch、固定 SHA 与 HEAD 一致性回归通过 |
| US-CMDSURF-007 | Worktree 基线失败阻断 | AC-CMDSURF-007-02 | TC-CMDSURF-013 | ✅ QA 通过 | @qa | fetch/base 失败无 branch、worktree、session 副作用回归通过 |
| US-CMDSURF-007 | Worktree 显式离线基线 | AC-CMDSURF-007-03 | TC-CMDSURF-014 | ✅ QA 通过 | @qa | skip 仅缓存 remote/local base 且无任意 HEAD fallback 回归通过 |
| US-CMDSURF-007 | Worktree 无网络例外路径 | AC-CMDSURF-007-04 | TC-CMDSURF-015 | ✅ QA 通过 | @qa | dry-run/resume 无 fetch、无 HEAD 变化回归通过 |
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
| US-ENVINIT-001 | 首次创建六个环境文件 | AC-ENVINIT-001-01 | TC-ENVINIT-001 | ✅ QA 通过 | @qa | 三组 example/实际文件配对初始化 |
| US-ENVINIT-001 | Git 所有权边界 | AC-ENVINIT-001-02 | TC-ENVINIT-002 | ✅ QA 通过 | @qa | example 可跟踪、实际文件被忽略 |
| US-ENVINIT-002 | 已有文件保护 | AC-ENVINIT-002-01 | TC-ENVINIT-003 | ✅ QA 通过 | @qa | 后续 apply 不修改已有内容 |
| US-ENVINIT-003 | Dry-run 无副作用 | AC-ENVINIT-003-01 | TC-ENVINIT-004 | ✅ QA 通过 | @qa | 只报告缺失文件，不写盘 |
| US-ENVINIT-004 | 主 repo 环境文件补齐 | AC-ENVINIT-004-01 | TC-ENVINIT-005 | 待验证 | @qa | linked worktree 更新以目标项目主 repo 为准 |
| US-ENVINIT-004 | 主 repo 优先与幂等 | AC-ENVINIT-004-02 | TC-ENVINIT-006 | 待验证 | @qa | 主 repo example 优先、dry-run 无写入、重复收敛 |
| US-CMDSURF-009 | 官方模板匿名获取 | AC-CMDSURF-009-06 | TC-CMDSURF-027 | ✅ TDD 通过 | @qa | 官方无/无效 token、HTTP 请求无凭据、401 单次阻断、真实匿名 fetch 及项目鉴权回归通过 |
| US-ARCHPLAT-001 | 独立模型作业包 | AC-ARCHPLAT-001-01 | TC-ARCHPLAT-001 | ✅ QA 通过 | @qa | [QA 证据](../qa-modules/architecture-platform/QA.md) |
| US-ARCHPLAT-002 | 多应用与多存储选型 | AC-ARCHPLAT-002-01 | TC-ARCHPLAT-002 | ✅ QA 通过 | @qa | [QA 证据](../qa-modules/architecture-platform/QA.md) |
| US-ARCHPLAT-003 | 按配置初始化 | AC-ARCHPLAT-003-01 | TC-ARCHPLAT-003 | ✅ QA 通过 | @qa | [QA 证据](../qa-modules/architecture-platform/QA.md) |
| US-ARCHPLAT-004 | 既有项目检测和接管 | AC-ARCHPLAT-004-01 | TC-ARCHPLAT-004 | ✅ QA 通过 | @qa | [QA 证据](../qa-modules/architecture-platform/QA.md) |
| US-ARCHPLAT-005 | shadcn 与公共表格 | AC-ARCHPLAT-005-01 | TC-ARCHPLAT-005 | ✅ QA 通过 | @qa | [QA 证据](../qa-modules/architecture-platform/QA.md) |
| US-ARCHPLAT-006 | 按所有权更新 | AC-ARCHPLAT-006-01 | TC-ARCHPLAT-006 | ✅ QA 通过 | @qa | [QA 证据](../qa-modules/architecture-platform/QA.md) |
| US-ARCHPLAT-007 | 冻结计划与中断恢复 | AC-ARCHPLAT-007-01 | TC-ARCHPLAT-007 | ✅ QA 通过 | @qa | [QA 证据](../qa-modules/architecture-platform/QA.md) |
| US-ARCHPLAT-008 | 可选工程模块 | AC-ARCHPLAT-008-01 | TC-ARCHPLAT-008 | ✅ QA 通过 | @qa | [QA 证据](../qa-modules/architecture-platform/QA.md) |
| US-ARCHPLAT-009 | 旧版模板兼容 | AC-ARCHPLAT-009-01 | TC-ARCHPLAT-009 | ✅ QA 通过 | @qa | [QA 证据](../qa-modules/architecture-platform/QA.md) |

## 覆盖率统计

3.1 公共 UI 扩展追踪：

| Story ID | AC ID | Test Case ID | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| US-ARCHPLAT-010 | AC-ARCHPLAT-010-01 | TC-ARCHPLAT-010 | Pass | [表单、校验及嵌套面板 QA](../qa-modules/architecture-platform/QA.md)；D13/D14 Closed |
| US-ARCHPLAT-011 | AC-ARCHPLAT-011-01 | TC-ARCHPLAT-011 | Pass | [选择器与失败恢复 QA](../qa-modules/architecture-platform/QA.md)；D11 Closed |
| US-ARCHPLAT-012 | AC-ARCHPLAT-012-01 | TC-ARCHPLAT-012 | Pass | [日期边界、时区及弹层 QA](../qa-modules/architecture-platform/QA.md)；D14 Closed |
| US-ARCHPLAT-013 | AC-ARCHPLAT-013-01 | TC-ARCHPLAT-013 | Pass | [反馈、确认、状态 QA](../qa-modules/architecture-platform/QA.md) |
| US-ARCHPLAT-014 | AC-ARCHPLAT-014-01 | TC-ARCHPLAT-014 | Pass | [按需生成与消费者升级 QA](../qa-modules/architecture-platform/QA.md)；D12 Closed |

3.8 界面视觉契约追踪：

| Story ID | AC ID | Test Case ID | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| US-ARCHPLAT-015 | AC-ARCHPLAT-015-01 | TC-ARCHPLAT-015 | Pass | [骨架契约 QA](../qa-modules/architecture-platform/QA.md)；行数、front matter、八章节、Token 同源、manifest 与 README 登记 |
| US-ARCHPLAT-015 | AC-ARCHPLAT-015-02 | TC-ARCHPLAT-016 | Pass | [所有权、去重与误标更正 QA](../qa-modules/architecture-platform/QA.md)；根 `DESIGN.md` 项目所有、模板去重 |
| US-ARCHPLAT-015 | AC-ARCHPLAT-015-03 | TC-ARCHPLAT-017 | Pass | [专家按需路由 QA](../qa-modules/architecture-platform/QA.md)；TASK/DEVOPS 不加载、体量上限 |

下表为 3.0 基线统计；3.1 新增 5 项 Story/AC、3.8 新增 1 项 Story 与 3 项 AC 由上表单独记录，覆盖及通过分别为 5/5 与 3/3。

| 指标 | 数值 | 目标 |
| --- | --- | --- |
| 总 Story 数 | 21 | - |
| 已关联测试用例的 Story 数 | 21 | 100% |
| 总 AC 数 | 40 | - |
| 已关联测试用例的 AC 数 | 40 | 100% |
| 测试通过的 AC 数 | 39 | 100% |
| 测试失败的 AC 数 | 0 | 0 |
| 需求覆盖率 | 100% | ≥95% |
| 测试通过率 | 98% | 100% |

US-CMDSURF-007 的原始 worktree 核心 40/40、全仓 Node 305/305 与 setup 56/56 已通过，后续兼容回归见 [命令面 QA](../qa-modules/template-command-surface/QA.md)；真实项目接入继续以目标项目证据为准。

US-CMDSURF-008 已完成 TC-CMDSURF-016~021：定向回归、三电脑 bare Git、模板传播收敛与 QA 双 SHA 收据均通过；GitHub workflows 保持 project-owned 且未被触碰。

US-CMDSURF-009 的 TC-CMDSURF-022~026 已完成 QA：定向、setup、完整模板引导与全量 Node 回归均零失败。历史合并运行态由当次 task/session 保存，后续兼容结论见 [命令面 QA](../qa-modules/template-command-surface/QA.md)。

## 核查任务记录与权限边界

| Story ID | AC ID | Test Case ID | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| US-CMDSURF-010 | AC-CMDSURF-010-01 | TC-CMDSURF-028 | Pass | [命令面 QA](../qa-modules/template-command-surface/QA.md) |
| US-CMDSURF-010 | AC-CMDSURF-010-02 | TC-CMDSURF-029 | Pass | [命令面 QA](../qa-modules/template-command-surface/QA.md) |
| US-CMDSURF-010 | AC-CMDSURF-010-03 | TC-CMDSURF-030 | Pass | [命令面 QA](../qa-modules/template-command-surface/QA.md) |

## 多端 Monorepo 与 Prisma

| Story ID | AC ID | Test Case ID | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| US-MONOPLAT-001 | AC-MONOPLAT-001-01 | TC-MONOPLAT-001 | Pass | [PRD](../prd-modules/monorepo-platform/PRD.md) |
| US-MONOPLAT-002 | AC-MONOPLAT-002-01 | TC-MONOPLAT-002 | Pass | [PRD](../prd-modules/monorepo-platform/PRD.md) |
| US-MONOPLAT-003 | AC-MONOPLAT-003-01 | TC-MONOPLAT-003 | Pass | [PRD](../prd-modules/monorepo-platform/PRD.md) |
| US-MONOPLAT-004 | AC-MONOPLAT-004-01 | TC-MONOPLAT-004 | Pass | [PRD](../prd-modules/monorepo-platform/PRD.md) |
| US-MONOPLAT-005 | AC-MONOPLAT-005-01 | TC-MONOPLAT-005 | Pass | [PRD](../prd-modules/monorepo-platform/PRD.md) |
| US-MONOPLAT-006 | AC-MONOPLAT-006-01 | TC-MONOPLAT-006 | Pass | [PRD](../prd-modules/monorepo-platform/PRD.md) |
| US-MONOPLAT-007 | AC-MONOPLAT-007-01 | TC-MONOPLAT-007 | Pass | [PRD](../prd-modules/monorepo-platform/PRD.md) |
| US-MONOPLAT-008 | AC-MONOPLAT-008-01 | TC-MONOPLAT-008 | Pass | [PRD](../prd-modules/monorepo-platform/PRD.md) |
| US-MONOPLAT-009 | AC-MONOPLAT-009-01 | TC-MONOPLAT-009 | Pass | [PRD](../prd-modules/monorepo-platform/PRD.md) |

## 统一文件存储

| Story ID | AC ID | Test Case ID | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| US-STORAGE-001 | AC-STORAGE-001-01 | TC-STORAGE-001 | Pass | [PRD](../prd-modules/file-storage/PRD.md) |
| US-STORAGE-002 | AC-STORAGE-002-01 | TC-STORAGE-002 | Pass | [PRD](../prd-modules/file-storage/PRD.md) |
| US-STORAGE-003 | AC-STORAGE-003-01 | TC-STORAGE-003 | Pass | [PRD](../prd-modules/file-storage/PRD.md) |
| US-STORAGE-004 | AC-STORAGE-004-01 | TC-STORAGE-004 | Pass | [PRD](../prd-modules/file-storage/PRD.md) |
| US-STORAGE-005 | AC-STORAGE-005-01 | TC-STORAGE-005 | Pass | [PRD](../prd-modules/file-storage/PRD.md) |
| US-STORAGE-006 | AC-STORAGE-006-01 | TC-STORAGE-006 | Pass | [PRD](../prd-modules/file-storage/PRD.md) |
| US-STORAGE-007 | AC-STORAGE-007-01 | TC-STORAGE-007 | Pass | [PRD](../prd-modules/file-storage/PRD.md) |
| US-STORAGE-008 | AC-STORAGE-008-01 | TC-STORAGE-008 | Pass | [PRD](../prd-modules/file-storage/PRD.md) |
| US-STORAGE-009 | AC-STORAGE-009-01 | TC-STORAGE-009 | 实现验收 | [TASK-STORAGE-008](../task-modules/file-storage/TASK.md) |

## 开源公共组件

| Story ID | AC ID | Test Case ID | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| US-OSSKIT-001 | AC-OSSKIT-001-01 | TC-OSSKIT-001 | Pass | [QA](../qa-modules/open-source-components/QA.md) |
| US-OSSKIT-002 | AC-OSSKIT-002-01 | TC-OSSKIT-002 | Pass | [QA](../qa-modules/open-source-components/QA.md) |
| US-OSSKIT-003 | AC-OSSKIT-003-01 | TC-OSSKIT-003 | Pass | [QA](../qa-modules/open-source-components/QA.md) |
| US-OSSKIT-004 | AC-OSSKIT-004-01 | TC-OSSKIT-004 | Pass | [QA](../qa-modules/open-source-components/QA.md) |
| US-OSSKIT-005 | AC-OSSKIT-005-01 | TC-OSSKIT-005 | Pass | [QA](../qa-modules/open-source-components/QA.md) |
| US-OSSKIT-006 | AC-OSSKIT-006-01 | TC-OSSKIT-006 | Pass | [QA](../qa-modules/open-source-components/QA.md) |
| US-OSSKIT-007 | AC-OSSKIT-007-01 | TC-OSSKIT-007 | Pass | [QA](../qa-modules/open-source-components/QA.md) |
| US-OSSKIT-008 | AC-OSSKIT-008-01 | TC-OSSKIT-008 | Pass | [QA](../qa-modules/open-source-components/QA.md) |

## 架构按需获取

| Story ID | AC ID | Test Case ID | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| US-LAZYARCH-001 | AC-LAZYARCH-001-01 | TC-LAZYARCH-001 | Pass | [QA](../qa-modules/architecture-on-demand/QA.md) |
| US-LAZYARCH-002 | AC-LAZYARCH-002-01 | TC-LAZYARCH-002 | Pass | [QA](../qa-modules/architecture-on-demand/QA.md) |
| US-LAZYARCH-003 | AC-LAZYARCH-003-01 | TC-LAZYARCH-003 | Pass | [QA](../qa-modules/architecture-on-demand/QA.md) |
| US-LAZYARCH-004 | AC-LAZYARCH-004-01 | TC-LAZYARCH-004 | Pass | [QA](../qa-modules/architecture-on-demand/QA.md) |
| US-LAZYARCH-005 | AC-LAZYARCH-005-01 | TC-LAZYARCH-005 | Pass | [QA](../qa-modules/architecture-on-demand/QA.md) |
| US-LAZYARCH-006 | AC-LAZYARCH-006-01 | TC-LAZYARCH-006 | Pass | [QA](../qa-modules/architecture-on-demand/QA.md) |

## 开发目录与合并边界

| Story ID | AC ID | Test Case ID | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| US-CMDSURF-011 | AC-CMDSURF-011-01 | TC-CMDSURF-031 | Pass | [QA](../qa-modules/template-command-surface/QA.md) |
| US-CMDSURF-011 | AC-CMDSURF-011-02 | TC-CMDSURF-032 | Pass | [QA](../qa-modules/template-command-surface/QA.md) |
| US-CMDSURF-011 | AC-CMDSURF-011-03 | TC-CMDSURF-033 | Pass | [QA](../qa-modules/template-command-surface/QA.md) |

| US-CMDSURF-012 | AC-CMDSURF-012-01/02 | TASK-CMDSURF-043 | TC-CMDSURF-LEGACY | Pass：真实 Git 迁移与同步收敛 |
| US-CMDSURF-012 | AC-CMDSURF-012-03 | TASK-CMDSURF-044 | TC-CMDSURF-CONSUMER | Pass：安装副本执行边界测试 |

## 测试范围决策与 QA 证据门禁

| Story ID | AC ID | Test Case ID | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| US-CMDSURF-013 | AC-CMDSURF-013-01 | TC-CMDSURF-034 | 待 TDD/QA | 范围决策与纯文档任务用例 |
| US-CMDSURF-013 | AC-CMDSURF-013-02 | TC-CMDSURF-035 | 待 TDD/QA | 全量触发与非触发规则检查 |
| US-CMDSURF-013 | AC-CMDSURF-013-03 | TC-CMDSURF-036 | 待 TDD/QA | `qa verify` 证据门禁正反例 |
| US-CMDSURF-013 | AC-CMDSURF-013-04 | TC-CMDSURF-037 | 待 TDD/QA | QA 证据复用与语义复核 |

## Drizzle 数据访问

| Story ID | AC ID | Test Case ID | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| US-DRIZZLE-001 | AC-DRIZZLE-001 | TC-DRIZZLE-001 | 已验证 | [QA](../qa-modules/drizzle/QA.md) |
| US-DRIZZLE-002 | AC-DRIZZLE-002 | TC-DRIZZLE-002 | 已验证 | [QA](../qa-modules/drizzle/QA.md) |
| US-DRIZZLE-003 | AC-DRIZZLE-003 | TC-DRIZZLE-003 | 已验证 | [QA](../qa-modules/drizzle/QA.md) |
| US-DRIZZLE-004 | AC-DRIZZLE-004 | TC-DRIZZLE-004 | 已验证 | [QA](../qa-modules/drizzle/QA.md) |
| US-DRIZZLE-005 | AC-DRIZZLE-005 | TC-DRIZZLE-006 | 已验证 | [QA](../qa-modules/drizzle/QA.md) |

## 项目规则初始化

| Story ID | AC ID | Test Case ID | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| US-CMDSURF-014 | AC-CMDSURF-014-01 | TC-CMDSURF-038 | 待验证 | 首次应用/同步与 dry-run |
| US-CMDSURF-014 | AC-CMDSURF-014-02 | TC-CMDSURF-039 | 待验证 | 既有规则字节保护 |
| US-CMDSURF-014 | AC-CMDSURF-014-03 | TC-CMDSURF-040 | 待验证 | 收敛与预读契约 |

## 数据语义约定

| Story ID | AC ID | Test Case ID | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| US-DATA-001 | AC-DATA-001 | TC-DATA-001 | TDD 通过 | 静态复核 `architecture/standards/data.md`、ADR-034、专家清单 |
| US-DATA-002 | AC-DATA-002 | TC-DATA-002 | TDD 通过 | `infra/scripts/tdd-tools/__tests__/schema-governance.test.js` |
| US-DATA-003 | AC-DATA-003 | TC-DATA-003 | TDD 通过 | `infra/scripts/tdd-tools/__tests__/schema-governance.test.js`（warn/required/off） |
| US-DATA-004 | AC-DATA-004 | TC-DATA-004 | TDD 通过 | `architecture/__tests__/task-semantics.test.js`；真实数据库集成测试未运行 |
| US-DATA-005 | AC-DATA-005 | TC-DATA-005 | TDD 通过 | `infra/scripts/tdd-tools/__tests__/schema-governance.test.js`（默认 required、warn 降级、仅新增迁移） |
| US-DATA-006 | AC-DATA-006 | TC-DATA-006 | TDD 通过 | `infra/scripts/tdd-tools/__tests__/schema-governance.test.js`（按安装形态条件豁免、同名业务表照常检查、hard-delete） |
| US-DATA-007 | AC-DATA-007 | TC-DATA-007 | TDD 通过 | `infra/scripts/tdd-tools/__tests__/schema-governance.test.js`；`architecture/__tests__/module-semantics.test.js`；drizzle-kit 0.31.11 真实生成三库迁移并注释（任务证据） |
| US-DATA-008 | AC-DATA-008 | TC-DATA-008 | TDD 通过 | `architecture/__tests__/module-semantics.test.js`；Better Auth 1.7.3 真实运行（任务证据）；真实数据库集成未运行 |
| US-DATA-009 | AC-DATA-009 | TC-DATA-009 | TDD 通过 | `architecture/__tests__/module-semantics.test.js`；`architecture/__tests__/storage.test.js`、`storage-core.test.js` |
| US-DATA-010 | AC-DATA-010 | TC-DATA-010 | TDD 通过 | `architecture/__tests__/module-semantics.test.js`；`architecture/__tests__/upgrades.test.js` |

## 固定提交证据增量（2026-10-04）

| Story ID | AC ID | Test Case ID | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| US-CMDSURF-015 | AC-CMDSURF-015-01 | TC-CMDSURF-041 | Planned | qa-merge 配置与严格模式 |
| US-CMDSURF-015 | AC-CMDSURF-015-02 | TC-CMDSURF-042 | Planned | merge-evidence 固定快照 |
| US-CMDSURF-015 | AC-CMDSURF-015-03 | TC-CMDSURF-043 | Planned | 删除、缺失与闭环 |
| US-CMDSURF-015 | AC-CMDSURF-015-04 | TC-CMDSURF-044 | Planned | 逐记录语义指纹 |
| US-CMDSURF-016 | AC-CMDSURF-016-01 | TC-CMDSURF-045 | Planned | update/template-sync 夹具 |
| US-CMDSURF-016 | AC-CMDSURF-016-02 | TC-CMDSURF-046 | Planned | tdd-tick-codex.compat |
