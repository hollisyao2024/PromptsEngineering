# CR-20260906-001：息壤模板身份与实际项目自更新

## 基本信息

| 字段 | 内容 |
| --- | --- |
| CR ID | CR-20260906-001 |
| 提出人 | 用户 |
| 提出日期 | 2026-09-06 |
| 变更类型 | 用户可见需求 / 外部模板来源契约 |
| 优先级 | High |
| 当前状态 | ✅ Approved |
| 关联里程碑 | M5 息壤模板自更新 |

## 1. 变更描述

模板正式命名为“息壤（Xirang）”。模板应用到实际项目后，用户只需提出“更新息壤模板”，实际项目中的 Agent 即可识别该固定意图，并通过稳定入口从 `https://github.com/hollisyao2024/PromptsEngineering.git` 获取默认分支的最新模板代码，以本次 fetch 后解析的固定 SHA 安全更新当前项目。

## 2. 影响范围分析

本变更扩展现有“模板命令面”，涉及模板身份与默认配置、`AGENTS.md` 自然语言路由、统一 CLI、GitHub 获取和 SHA 锁定、模板 apply/convergence、测试与传播验证。继续保护 `RULES.md`、项目业务代码、真实项目文档、既有 `agent.config.json` 和 `.github/workflows`；不重命名 GitHub 仓库，不增加后台或定时更新。

## 3. 验收摘要

- 实际项目中的“更新息壤模板”确定性映射到 `pnpm agent -- template sync`。
- 普通同步必须成功访问固定官方 GitHub 源，锁定远端 SHA，并从该 SHA 的模板执行器与 manifest 应用更新。
- fetch、ref 或来源验证失败时，在目标 tracked 文件写入前阻断，不静默回退旧缓存。
- 应用前 dry-run，冲突时阻断；成功应用后再次 dry-run 并达到收敛。
- 输出模板 ID、仓库、分支、SHA 和 fetch/apply/convergence 状态；重复同步保持幂等。

## 4. 已接受的边界

- 自然语言触发由随模板传播的 `AGENTS.md` 约定实现；确定性执行由 `template sync` CLI 承担。
- 普通触发只认固定官方源，不允许静默替换为第三方仓库。
- GitHub 不可用时普通同步失败；本次不提供自动缓存降级或后台重试。
- 模板更新仍是 tracked mutation，必须在实际项目专用 worktree 中执行并完成其项目门禁。

## 5. 审批记录

| 角色 | 审批结果 | 日期 | 意见 |
| --- | --- | --- | --- |
| 用户/PRD | ✅ Approved | 2026-09-06 | 确认名称“息壤”，要求实际项目可用一句话从 GitHub 自动拉取最新模板 |
| ARCH/TASK/QA | 🔄 随阶段验证 | - | - |

## 6. 相关链接

- 模块 PRD：[`template-command-surface`](../../prd-modules/template-command-surface/PRD.md)
- 追溯矩阵：[`traceability-matrix.md`](../traceability-matrix.md)
