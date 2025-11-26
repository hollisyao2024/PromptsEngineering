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
- `CHANGELOG.md`：主变更记录文件，仅保留最近 1~2 个主版本的条目。
- 其他目录：若新增（如 `infra/`、`notebooks/`），请在本文件补充说明。

## `docs/` 子结构
- `docs/PRD.md`：产品需求文档（小项目时是单一 PRD.md，大项目时是主 PRD，作为总纲与索引）。
- `docs/prd-modules/`：**大型项目 PRD 模块化目录**（按功能域拆分的详细 PRD），实际的模块清单、模块 PRD 由 PRD 专家根据 `docs/prd-modules/MODULE-INVENTORY.md`动态生成。
- `docs/ARCH.md`：架构文档（主架构文档，作为总纲与索引）。
- `docs/arch-modules/`：**大型项目架构模块化目录**（按功能域拆分的详细架构），实际的设计清单、模块 ARCH 由 ARCH 专家根据 `docs/arch-modules/MODULE-INVENTORY.md`动态生成。
- `docs/TASK.md`：任务计划（主任务文档，作为总纲与索引，含 WBS/依赖/里程碑/风险）。
- `docs/task-modules/`：**大型项目任务模块化目录**（按功能域拆分的详细任务计划），实际的任务清单、任务 TASK 由 TASK 专家根据 `docs/task-modules/MODULE-INVENTORY.md`动态生成。
- `docs/QA.md`：测试计划与执行记录（主 QA 文档，作为总纲与索引）。
- `docs/qa-modules/`：**大型项目 QA 模块化目录**（按功能域拆分的详细测试计划），实际的QA清单、测试 QA 由 QA 专家根据 `docs/qa-modules/MODULE-INVENTORY.md`动态生成。
- `docs/AGENT_STATE.md`：阶段状态勾选清单。
- `CHANGELOG.md`（项目根）：主变更记录，仅保存最近 1~2 个主版本条目。
- `docs/changelogs/`：历史分卷目录，存放归档的旧 CHANGELOG 文件，并包含 `README.md` 记录分卷规则与索引。
- `docs/adr/`：架构决策记录，命名格式为 `NNN-{stage}-{module}-{title}.md`，其中 `{stage}` 取值 `prd` 表示 PRD 阶段的决策、`arch` 表示 ARCH 阶段的技术/架构决策；若为全局级别可将 `{module}` 替换为 `global`（例如 `NNN-prd-global-product-scope.md`、`NNN-arch-global-api-gateway.md`）。
- `docs/data/`：数据相关内容（ERD、字典、样本数据、指标定义、**追溯矩阵**）。
- `docs/data/traceability-matrix.md`：**需求追溯矩阵**（Story → AC → Test Case ID 映射）。
- `docs/CONVENTIONS.md`：本文档，描述目录与约定。
- 可选扩展：
  - `docs/security/`：威胁建模、安全评估。
  - `docs/ops/`：运维手册、SLO、值班指南。

## 命名与引用规则
- 目录与文件名采用 kebab-case 或 snake_case，避免空格与大写混用。
- 路径引用一律使用相对路径（例如 `./docs/PRD.md`），确保跨平台读取一致。
- 若在 `AGENTS.md` 或角色卡片中引用新目录，需同步更新此文档。
- 所有与交付相关的变更必须在以 `feature/TASK-<MODULE>-<编号>-<短描述>` 命名的分支上完成。`/tdd sync` 与 `npm run tdd:tick` 依赖分支名中包含的 `TASK-` ID 自动勾选 `/docs/TASK.md` 或模块任务中的复选框、更新 Traceability，以及让 `docs/task-modules/module-list.md` 反映状态；在没有 Task ID（例如 `main`）的分支上直接改动会被脚本拒绝（“未找到 TASK ID”），因此请先在规范命名的 feature 分支上编辑再合并。

## Mermaid 图形文件规范

### 文件格式
- **统一使用 `.md` 格式**存储所有 mermaid 图形文件
- **禁止使用 `.mmd` 格式**（已于 2025-11-08 废弃）

### 使用理由
- GitHub/GitLab/VSCode 都支持 `.md` 文件中的 mermaid 代码块预览（与 `.mmd` 效果相同）
- `.md` 格式允许添加说明文字、表格、更新日志等上下文信息，便于团队协作
- 避免文件格式与后缀不匹配的混乱情况
- 便于 CI 工具按统一的 markdown 格式解析

### 文件结构模板

所有 mermaid 图形文件应遵循以下结构：

```markdown
# {图形名称}

> **用途**：{用途说明}
> **维护者**：{专家角色（PRD/ARCH/TASK/QA）}
> **最后更新**：{YYYY-MM-DD}

---

## {图形标题}

\`\`\`mermaid
{mermaid 代码}
\`\`\`

---

## 说明

{补充说明、表格、图例、维护指南等}

---

## 参考

- [关联文档链接]
```

### 文件位置约定

| 文件类型 | 存放位置 | 维护者 | 示例 |
|---------|---------|--------|------|
| **全局依赖图** | `/docs/data/global-dependency-graph.md` | PRD 专家 | 跨模块 Story 依赖关系 |
| **组件依赖图** | `/docs/data/component-dependency-graph.md` | ARCH 专家 | 跨模块组件依赖关系 |
| **实体关系图** | `/docs/data/ERD.md` | ARCH 专家 | 全局数据模型 |
| **模块依赖图** | `/docs/prd-modules/{domain}/dependency-graph.md` | PRD 专家 | 模块内 Story 依赖关系 |
| **任务依赖矩阵** | `/docs/data/task-dependency-matrix.md` | TASK 专家 | 跨模块任务依赖关系 |
| **里程碑甘特图** | `/docs/data/milestone-gantt.md` | TASK 专家 | 项目时间线与里程碑 |

### 更新时机

- **PRD 阶段**：创建/更新 `global-dependency-graph.md`、`{domain}/dependency-graph.md`
- **ARCH 阶段**：创建/更新 `ERD.md`、`dictionary.md`、`component-dependency-graph.md`（可基于 `/docs/data/templates/COMPONENT-DEPENDENCY-GRAPH-TEMPLATE.md` 生成实际图表）
- **TASK 阶段**：创建/更新 `task-dependency-matrix.md`、`milestone-gantt.md`
- **数据库迁移时**：同步更新 `ERD.md`、`dictionary.md`
- **架构变更时**：同步更新 `component-dependency-graph.md`

### 验证清单

在提交 mermaid 图形文件前，请确认：
- [ ] 文件后缀为 `.md`（非 `.mmd`）
- [ ] 包含完整的说明区块（用途、维护者、更新时间）
- [ ] Mermaid 代码被包裹在代码块中（\`\`\`mermaid ... \`\`\`）
- [ ] 在 VSCode/GitHub 中预览正常显示
- [ ] 相关文档中的引用链接已更新

### 参考示例

- [ERD.md](data/ERD.md) — 实体关系图示例
- [global-dependency-graph.md](data/global-dependency-graph.md) — 全局依赖图示例
- [component-dependency-graph.md](data/component-dependency-graph.md) — 组件依赖图示例

## Scripts 约定
- 脚本按用途分类，如 `scripts/ci.sh`、`scripts/server/deploy.sh`、`scripts/analyze_logs.py`。
- Shell 脚本首行声明 `#!/usr/bin/env bash`（或所需解释器），并包含 `set -euo pipefail` 等安全选项。
- 每个脚本在开头给出 Usage 注释，说明参数与前置条件。

## Tests 约定
- 单元测试通常随源码存放（如 `src/__tests__/`）；跨服务、端到端测试置于根 `tests/`。
- 测试命名遵循 `test_*` / `*_spec` 约定，与所用框架一致。
- 测试数据或快照应放在 `tests/fixtures/` 或子目录，避免污染主数据目录。

## 数据库迁移文件规范 ⚠️ 强制要求（全局统一）

### 文件名格式
- **格式：** `YYYYMMDDHHmmss_description.sql`
- **时间戳：** 必须使用文件实际创建时的系统时间（14 位数字）
- **描述：** 使用英文，多个单词用下划线分隔，简洁明了

**示例：**
```
20251028174629_add_subscription_billing_cycle.sql
20251031222146_add_admin_role.sql
20251101104841_create_admin_audit_logs.sql
```

### 创建方法（按优先级）

#### 1. 使用项目脚本（最推荐）✅
```bash
# 通用数据库（PostgreSQL / MySQL / Oracle / SQLite 等）
./scripts/tdd-tools/create-migration.sh add_user_roles --dir db/migrations --dialect postgres

# Supabase 专用（输出到 supabase/migrations/）
./scripts/tdd-tools/create-migration-supabase.sh add_user_roles
```
- 自动生成正确的时间戳
- 包含标准化的文件模板及幂等性提示
- 支持自定义目录 / 方言标签（通用脚本）

#### 2. 使用 Supabase CLI（Supabase 数据库推荐）✅
```bash
supabase migration new add_user_roles
```
- 自动生成格式正确的文件名
- 与 Supabase 生态集成良好

#### 3. 手动创建（不推荐）⚠️
```bash
TIMESTAMP=$(date +%Y%m%d%H%M%S)
touch "db/migrations/${TIMESTAMP}_add_feature_name.sql"
```
- 需要手动编写模板
- 容易遗漏必要注释

#### 4. 手动输入日期（严禁）❌
```bash
# ❌ 错误示例 - 日期不准确！
touch "db/migrations/20251104093000_add_feature.sql"
```

### 数据库迁移幂等性原则 ✅
- **幂等性定义**：迁移脚本可以安全地被执行多次，最终结果保持一致，不会重复创建表、列、索引或数据；这对 dry-run、失败恢复、测试环境重复部署与生产回滚都至关重要。
- **保障机制**：
  - 使用 `IF NOT EXISTS` / `IF EXISTS` 等条件判断，避免重复定义（详见 TDD Handbook §迁移脚本的幂等性保障）。
  - 在数据迁移前增加状态检查（如 `WHERE field IS NULL`），仅处理未完成部分。
  - 用事务包裹每一步，保证脚本要么完全成功，要么完全回滚。
- **验证要求**：提交前需至少在本地执行 3 次验证：第一次正常执行、第二次重复执行、第三次回滚后再执行一次，确认幂等性。

### 为什么必须使用实际时间戳？

#### 问题 1：迁移顺序混乱
- Supabase 按文件名**字典序**执行迁移
- 不准确的日期会导致：
  - 后创建的文件可能先执行（如果日期更早）
  - 依赖关系被打破（新表还未创建就被引用）
  - 回滚和重放迁移时出错

**真实案例：**
```
❌ 错误场景：
20251104093000_add_user_table.sql     (实际创建于 10-28)
20251028174629_add_user_role.sql      (实际创建于 10-28)

执行顺序：先创建 user_table，再添加 role
实际创建时间：先写 role，再写 user_table
结果：role 迁移失败，因为 user_table 还不存在！
```

#### 问题 2：问题追溯困难
- 文件名日期与实际创建时间不一致
- Git 历史显示的时间与文件名不匹配
- 无法准确追溯问题发生的时间线

#### 问题 3：团队协作冲突
- 多人同时开发时，手动编造的日期可能冲突
- 难以确定真实的开发顺序
- 合并代码时容易产生迁移执行顺序问题

### 文件内容模板

使用 `./scripts/tdd-tools/create-migration.sh` 会自动生成以下模板（Supabase 版本同理，但输出目录不同）：

```sql
-- ============================================================
-- description_here
-- 日期: YYYY-MM-DD
-- 数据库方言: postgres|mysql|oracle|sqlite|generic
-- 目标: [请描述此迁移的目的]
-- 幂等性提示:
--   1) 使用 IF EXISTS / IF NOT EXISTS / CREATE OR REPLACE 等条件语句
--   2) 数据变更前执行状态检查，避免重复写入
--   3) 始终遵循 Expand → Migrate/Backfill → Contract 流程
-- ============================================================

BEGIN;

-- ============================================================
-- 在此处添加 SQL 语句（可保留/删除方言示例）
-- ============================================================

-- PostgreSQL 示例:
-- DO $$ BEGIN
--   IF NOT EXISTS (...) THEN
--     CREATE TABLE ...
--   END IF;
-- END $$;

-- MySQL 示例:
-- CREATE TABLE IF NOT EXISTS ...;

-- Oracle 示例:
-- BEGIN
--   EXECUTE IMMEDIATE 'CREATE TABLE ...';
-- EXCEPTION
--   WHEN OTHERS THEN
--     IF SQLCODE != -955 THEN RAISE; END IF;
-- END;

COMMIT;

-- ============================================================
-- 回滚提示（Contract 阶段）
-- ============================================================
-- 如需回滚此迁移，请执行以下操作:
-- [描述如何安全回滚此迁移]
```

### 提交前验证清单

- [ ] 文件名时间戳是否使用脚本或 `date` 命令生成？
- [ ] 文件名是否符合格式 `YYYYMMDDHHmmss_description.sql`？
- [ ] 文件内容是否包含必要的注释（日期、目标、回滚提示）？
- [ ] 迁移是否可以安全回滚？
- [ ] 是否满足幂等性要求（参见下方“数据库迁移幂等性原则”）？
- [ ] 是否已测试迁移可以正确执行？

### 数据字典同步

- 任何表结构变化必须触发数据视图生成流程，确保以下自动产出文件与模板保持一致；直接在模板 `docs/data/templates/ERD-TEMPLATE.md` 与 `docs/data/templates/dictionary-TEMPLATE.md` 中调整源数据，生成好的 `ERD.md` 与 `dictionary.md` 不应被人工引用或提交。
  - `docs/data/ERD.md`：实体关系图（自动生成，参考 `docs/data/templates/ERD-TEMPLATE.md`）
  - `docs/data/dictionary.md`：数据字典（自动生成，参考 `docs/data/templates/dictionary-TEMPLATE.md`）

## Frontend / Backend / Shared
- `frontend/` 与 `backend/` 可以进一步拆分子项目，如 `frontend/web`、`frontend/mobile`、`backend/api`。
- 若使用 Monorepo 工具（例如 Turborepo、Nx），可在此说明 package/workspace 结构。
- `shared/` 存放可复用模块（UI 组件、SDK、API 契约、设计系统等），保持 README 或注释说明归属。

## 其他约定
- 配置文件（如 `.env.local、.env.staging`、`.env.production`、`.github/`、`Dockerfile`）应按技术栈默认放置；若自定义位置，在此说明理由。
- 机密文件保持 `.gitignore` 遮盖；若需本地存放，创建 `secret/README.md` 引导操作。

## QA 模块化规范

详细的 QA 模块拆分决策、结构与工作流已移至 `/AgentRoles/QA-TESTING-EXPERT.md`（结合 Playbook §9）；本节仅保留目录/命名级约定，需拆分时请点读该角色卡，以保持 Conventions 侧重于通用目录规则。

---

## 维护说明
- 当项目新增或调整目录结构时，请先更新本文件，再视需要调整 `AGENTS.md` 与角色卡片。
- 建议在代码评审中检查目录是否符合本约定，确保团队协作一致性。

## 版本记录
| 版本 | 日期 | 说明 |
| --- | --- | --- |
| v1.3 | 2025-11-05 | 扩展模块化规范至 ARCH/TASK/QA 三个专家，支持全流程文档模块化 |
| v1.2 | 2025-11-05 | 新增 PRD 模块化规范，支持大型项目按功能域拆分 PRD |
| v1.1 | 2025-10-28 | 新增文档版本记录，便于追踪目录规范调整 |
