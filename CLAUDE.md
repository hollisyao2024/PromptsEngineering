# 强制规范 — AGENTS.md 多专家协作框架

以下 `@./AGENTS.md` 为本项目核心路由规范，**强制生效**。

- 激活专家时，**立即** Read `AgentRoles/<对应专家>.md`，读取完成前禁止执行任何操作
- 未激活时，不主动加载专家文件

@./AGENTS.md

## Plan Mode 工具绑定（Claude Code 专属）

通用的计划执行衔接规则和 TDD 收尾流水线已定义在 AGENTS.md「TDD 开发全流程」章节，以下为 Claude Code 特有的工具绑定：

**ExitPlanMode 前置检查**：调用 ExitPlanMode **之前**，检查 plan 文件是否已在编码步骤之后包含 AGENTS.md 定义的 5 个收尾步骤，**缺少则补全后再退出**（`--no-qa` 跳过步骤 3-4，保留步骤 5）。

**TodoWrite 执行追踪**：所有编码步骤完成后，**立即**用 TodoWrite 将 5 个收尾步骤写入待办列表（status: pending），执行每步后立即标记 completed。TodoWrite 列表在每个 turn 持续可见，确保收尾流水线不会中断。

<!-- ⚠️ 以上为模板核心区域，禁止修改。定制内容在分隔线后追加，变更仅在模板源项目（PromptsEngineering）中进行后同步。 -->

---
