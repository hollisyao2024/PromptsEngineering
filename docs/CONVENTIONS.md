# 项目目录规范

本模板复制到任意项目后，请参考以下约定管理目录与文件。若现有仓库已有成熟规范，可在此基础上调整并保持 `AGENTS.md` 引用路径不变。

## 顶层结构
- `AGENTS.md`：多专家路由与流程约束（必须存在）。
- `AgentRoles/`：各阶段专家的运行时卡片；`AgentRoles/Handbooks/` 存放详细操作指南。
- `docs/`：所有产物文档、状态、数据资料的集中目录（详见下方）。
- `db/`：数据库迁移模板与脚本。
- `frontend/`、`backend/`：前端 / 后端源代码（可按技术栈命名，如 `apps/web`、`services/api`，但需在此文档说明）。
- `shared/`：多端共享的库或工具，例如 API 契约、通用组件。
- `scripts/`：自动化脚本（CI/CD、部署、诊断、数据工具），要求使用可执行命名并提供 Usage 注释。
- `tests/`：端到端或跨模块测试套件；若各子项目自带测试目录，可在此放置集成级别脚本。
- 其他目录：若新增（如 `infra/`、`ops/`、`notebooks/`），请在本文件补充说明。

## `docs/` 子结构
- `docs/PRD.md`：产品需求文档。
- `docs/ARCHITECTURE.md`：架构文档。
- `docs/TASK.md`：任务计划（WBS/依赖/里程碑/风险）。
- `docs/QA.md`：测试计划与执行记录。
- `docs/AGENT_STATE.md`：阶段状态勾选清单。
- `docs/CHANGELOG.md`：版本级变更记录（亦可放仓库根 `CHANGELOG.md`，需在此注明）。
- `docs/adr/`：架构决策记录（`NNN-title.md` 命名）。
- `docs/data/`：数据相关内容（ERD、字典、样本数据、指标定义）。
- `docs/CONVENTIONS.md`：本文档，描述目录与约定。
- 可选扩展：
  - `docs/security/`：威胁建模、安全评估。
  - `docs/operations/`：运维手册、SLO、值班指南。

## 命名与引用规则
- 目录与文件名采用 kebab-case 或 snake_case，避免空格与大写混用。
- 路径引用一律使用相对路径（例如 `./docs/PRD.md`），确保跨平台读取一致。
- 若在 `AGENTS.md` 或角色卡片中引用新目录，需同步更新此文档。

## Scripts 约定
- 脚本按用途分类，如 `scripts/ci.sh`、`scripts/deploy.sh`、`scripts/analyze_logs.py`。
- Shell 脚本首行声明 `#!/usr/bin/env bash`（或所需解释器），并包含 `set -euo pipefail` 等安全选项。
- 每个脚本在开头给出 Usage 注释，说明参数与前置条件。

## Tests 约定
- 单元测试通常随源码存放（如 `src/__tests__/`）；跨服务、端到端测试置于根 `tests/`。
- 测试命名遵循 `test_*` / `*_spec` 约定，与所用框架一致。
- 测试数据或快照应放在 `tests/fixtures/` 或子目录，避免污染主数据目录。

## Frontend / Backend / Shared
- `frontend/` 与 `backend/` 可以进一步拆分子项目，如 `frontend/web`、`frontend/mobile`、`backend/api`。
- 若使用 Monorepo 工具（例如 Turborepo、Nx），可在此说明 package/workspace 结构。
- `shared/` 存放可复用模块（UI 组件、SDK、API 契约、设计系统等），保持 README 或注释说明归属。

## 其他约定
- 配置文件（如 `.env.development`、`.env.production`、`.github/`、`Dockerfile`）应按技术栈默认放置；若自定义位置，在此说明理由。
- 机密文件保持 `.gitignore` 遮盖；若需本地存放，创建 `secret/README.md` 引导操作。

## 维护说明
- 当项目新增或调整目录结构时，请先更新本文件，再视需要调整 `AGENTS.md` 与角色卡片。
- 建议在代码评审中检查目录是否符合本约定，确保团队协作一致性。

## 版本记录
| 版本 | 日期 | 说明 |
| --- | --- | --- |
| v1.1 | 2025-10-28 | 新增文档版本记录，便于追踪目录规范调整 |
