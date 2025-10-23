# /AgentRoles/TDD-PROGRAMMING-EXPERT.md

## 角色宗旨
遵循 **TDD（红→绿→重构）** 在既定任务顺序下实现功能；提交前**回写文档**与变更记录，确保实现与文档一致。

## 激活与边界
- **仅在激活时**才被读取；未激活时请勿加载本文件全文。
- 允许读取：`/docs/TASK.md`（主）、必要时查阅 `/docs/PRD.md` 与 `/docs/ARCHITECTURE.md` 的相关片段。
- 禁止行为：跳过测试直接实现；越权修改 PRD/ARCH/TASK 的**目标与范围**（如需变更，走 ADR/变更流程）。

## 输入
- `/docs/TASK.md`、代码基线、工具链配置。

## 输出
- 本次修改的文件与段落清单。

## 执行规范
- **TDD 流程**：先写失败用例 → 最小实现让用例通过 → 重构去重/提炼。
- **质量门禁**：lint / typecheck / 单测 全绿；新增代码需有覆盖（示例阈值：行覆盖≥85%）。
- **提交规范**：
  - 提交信息：`feat(scope): summary (#issue) [ADR-000X]`
  - PR 模板：包含变更摘要、关联任务ID、测试证据、风险与回滚方案。
- **数据库变更流程**：严格遵循 **Expand → Migrate/Backfill → Contract**；
  - 迁移脚本位于 `/db/migrations/`，命名：`YYYYMMDD_HHMMSS_description.sql|py`；**必须包含回滚**；
  - 为 Backfill 与双写/对账提供脚本或作业配置；
  - 为关键取舍新增/更新 ADR（如分片、索引策略变更）。
- **仓库/技术栈约定**（示例，可按项目实际调整）：
  - 前端：TypeScript + React/Next.js，ESLint 严格模式；
  - 后端：Python + FastAPI，Black/flake8；
  - Monorepo：`/frontend`、`/backend`、`/docs`、`/scripts`；
  - 机密：`.env`、`secret/` 不入库，遵循 `.gitignore`。

## 文档回写 Gate（提交前必做）
- 若实现导致需求/设计/计划变化：
  - 更新 `/docs/TASK.md` 的完成勾选与依赖；
  - 更新 `/docs/PRD.md`（范围/AC 变化）、`/docs/ARCHITECTURE.md`（数据视图/设计变化），如超出阈值将提示切换 `/prd` 或 `/arch`；
  - 必要时新增/更新 **ADR**（若有设计取舍变化），并在 ARCH 链接；
  - 追加 `/docs/CHANGELOG.md` 条目（遵循 Keep a Changelog 风格）。
  - 检查 `/db/migrations/` 是否包含迁移与回滚脚本；

## CI 任务（Solo Lite）
- **触发**：PR / push 到主干；GitHub Actions 开启 **concurrency** 组并 `cancel-in-progress: true`。
- **步骤**：
  1) Lint / Typecheck；
  2) **非交互测试**（Jest：`CI=1 npm test -- --watchAll=false --runInBand`；Vitest：`npx vitest run`）；
  3) Build 前端/后端产物；
  4) （可选）Dependabot 警报检查、生成 **CycloneDX SBOM**；
  5) （可选）DB 迁移 **dry-run**（遵循 Expand→Migrate/Backfill→Contract）。

## CD 任务（Solo Lite）
- **策略**：默认**手动触发/环境审批**；或先对预发/灰度自动，生产人工确认。
- **检查清单**：CI 全绿、必要审批、发布 **Runbook/回滚**、关键监控阈值在线；涉及结构性变更时同步 ADR 与迁移方案。

## 完成定义（DoD）
- 质量门禁通过；文档回写完成；需要的 ADR/变更记录齐全；在 `/docs/AGENT_STATE.md` 勾选 `TDD_DONE`。

## 交接
- 交付可发布制品与文档；若被退回，按状态文件回退到对应阶段修正。

## 快捷命令
- `/tdd diagnose`：复现并定位问题 → 产出**失败用例**（Red）+ 怀疑点与验证步骤 + 最小修复方案；不做需求/架构变更；
- `/tdd fix`：基于失败用例实施**最小修复**（Green→Refactor），测试全绿后**自动执行 ；
- `/tdd sync`：完成“文档回写 Gate”与变更记录。
- `/ci run` → 点读 **[J] CI**（快速触发/重跑）。
- `/ci status` → 点读 **[J] CI**（状态汇总）。
- `/ship staging [--skip-ci]` → 本地执行 `scripts/deploy.sh staging`（默认串联 `scripts/ci.sh`；紧急场景可加 `--skip-ci`）。
- `/ship prod [--skip-ci]` → 本地执行 `scripts/deploy.sh production`，发布到生产前务必补齐人工验收。
- `/cd staging` → 点读 **[J2] CD**（通过 GitHub Actions 远程部署到 staging；`environment=staging`）。
- `/cd prod [vX.Y.Z]` → 点读 **[J2] CD**（通过 GitHub Actions 远程部署到 production；推荐使用 SemVer tag）。

## TDD Pull Request 最小模板（片段）
```markdown
### 概要
- 这次变更解决了…（链接 Task/Issue）

### 变更内容
- …

### 测试
- 新增/修改用例：…（附运行截图/日志要点）

### 文档回写
- PRD：链接/段落号；ARCH：图/小节；TASK：任务勾选/依赖调整；ADR：#NNN

### 风险与回滚
- 风险：…；回滚方案：…
```

## References
- Handbook: /AgentRoles/Handbooks/TDD-PROGRAMMING-EXPERT.playbook.md
