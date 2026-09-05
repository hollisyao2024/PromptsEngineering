# CR-20260905-001：无 GitHub CI 的多电脑同权 Git 协作

## 基本信息

| 字段 | 内容 |
| --- | --- |
| CR ID | CR-20260905-001 |
| 提出人 | 用户 |
| 提出日期 | 2026-09-05 |
| 变更类型 | 协作行为 / 权限与并发安全 |
| 优先级 | High |
| 当前状态 | ✅ Approved |
| 关联里程碑 | M4 多机同权协作 |

## 1. 变更描述

模板应用到多人共享的 GitHub 项目后，每台电脑都可能执行 PRD、ARCH、TASK、TDD、QA 或 DEVOPS；不得按电脑或专家阶段限制合并权限。所有授权协作者可合并 PR 或普通更新配置主干，项目不使用 GitHub CI。模板以远端分支检测、QA base/head SHA 回执和普通非快进更新降低跨电脑误操作风险，并永久禁止模板对主干 force push。

## 2. 影响范围分析

最小范围只扩展现有“模板命令面”：worktree 创建/恢复、TDD push/PR base、QA verify 回执、QA merge、completion/cleanup、通用约定和相关测试。保留现有分支命名、squash merge、配置结构和 project-owned workflows；不新增独立功能域、机器角色、远程锁或 GitHub CI。

## 3. 验收摘要

- 远端同名分支不会被本机从主干误建，另一台电脑可从其精确 SHA 恢复。
- QA 通过回执绑定 `BASE_SHA` 与 `HEAD_SHA`，任一漂移阻断合并。
- GitHub PR merge 绑定已验证 head SHA；本地 fallback 仅普通非强制 push。
- 所有主干引用来自 `config.baseBranch`，三份独立 clone 的并发模拟通过。
- 所有电脑同权；不依赖、创建或触发 GitHub CI。

## 4. 已接受的边界

允许所有协作者普通 push 主干且不使用服务端 CI 时，模板只能防止误操作，不能从 GitHub 服务端证明每次原始 push 已执行本地 QA。该可信协作者边界由用户明确接受。

## 5. 审批记录

| 角色 | 审批结果 | 日期 | 意见 |
| --- | --- | --- | --- |
| 用户/PRD | ✅ Approved | 2026-09-05 | 同意按最小改动实施并要求完成模拟验证 |
| ARCH/TASK/QA | 🔄 随阶段验证 | - | - |

## 6. 相关链接

- 模块 PRD：[`template-command-surface`](../../prd-modules/template-command-surface/PRD.md)
- 追溯矩阵：[`traceability-matrix.md`](../traceability-matrix.md)

