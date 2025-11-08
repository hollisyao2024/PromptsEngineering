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
- 其他目录：若新增（如 `infra/`、`ops/`、`notebooks/`），请在本文件补充说明。

## `docs/` 子结构
- `docs/PRD.md`：产品需求文档（主 PRD，作为总纲与索引）。
- `docs/prd-modules/`：**大型项目 PRD 模块化目录**（按功能域拆分的详细 PRD），包含 `README.md` 模块索引。
- `docs/ARCHITECTURE.md`：架构文档（主架构文档，作为总纲与索引）。
- `docs/architecture-modules/`：**大型项目架构模块化目录**（按功能域拆分的详细架构），包含 `README.md` 模块索引。
- `docs/TASK.md`：任务计划（主任务文档，作为总纲与索引，含 WBS/依赖/里程碑/风险）。
- `docs/task-modules/`：**大型项目任务模块化目录**（按功能域拆分的详细任务计划），包含 `README.md` 模块索引。
- `docs/QA.md`：测试计划与执行记录（主 QA 文档，作为总纲与索引）。
- `docs/qa-modules/`：**大型项目 QA 模块化目录**（按功能域拆分的详细测试计划），包含 `README.md` 模块索引。
- `docs/AGENT_STATE.md`：阶段状态勾选清单。
- `CHANGELOG.md`（项目根）：主变更记录，仅保存最近 1~2 个主版本条目。
- `docs/changelogs/`：历史分卷目录，存放归档的旧 CHANGELOG 文件，并包含 `README.md` 记录分卷规则与索引。
- `docs/adr/`：架构决策记录（`NNN-{module}-title.md` 命名）。
- `docs/data/`：数据相关内容（ERD、字典、样本数据、指标定义、**追溯矩阵**）。
  - `docs/data/traceability-matrix.md`：**需求追溯矩阵**（Story → AC → Test Case ID 映射）。
- `docs/CONVENTIONS.md`：本文档，描述目录与约定。
- 可选扩展：
  - `docs/security/`：威胁建模、安全评估。
  - `docs/operations/`：运维手册、SLO、值班指南。

### CHANGELOG 拆分规范
- **触发阈值**：当根 `CHANGELOG.md` 超过 ~500 行、覆盖 3 个及以上季度/迭代，或需要归档上一季度（默认拆分单位）时，即执行拆分。
- **拆分步骤**：
  1. 将需要归档的条目从根 `CHANGELOG.md` 剪切至 `docs/changelogs/CHANGELOG-{year}Q{quarter}.md` 或 `CHANGELOG-iter-{iteration}.md`（默认优先季度或迭代命名，若需其他策略，需在目录下 `README.md` 说明）。
  2. 在 `docs/changelogs/README.md` 中登记新分卷（文件名、时间/版本范围、维护者）。
  3. 在根 `CHANGELOG.md` 顶部的“历史记录索引”段落更新链接，指向对应分卷。
- **主文件约束**：根 `CHANGELOG.md` 仅保留最近 1~2 个主版本条目，所有 `npm run changelog:*` 脚本或自动化工具只对该文件执行写操作；历史分卷视为只读。
- **引用规范**：PRD/ARCH/TASK/QA 文档或 ADR 若需引用历史变更，必须链接到具体的 `docs/changelogs/CHANGELOG-*.md`，避免模糊引用。
- **目录维护**：若拆分策略调整（例如从季度切换到模块或年份分卷），需同步更新本节与 `docs/changelogs/README.md`，确保团队统一遵循。

## 命名与引用规则
- 目录与文件名采用 kebab-case 或 snake_case，避免空格与大写混用。
- 路径引用一律使用相对路径（例如 `./docs/PRD.md`），确保跨平台读取一致。
- 若在 `AGENTS.md` 或角色卡片中引用新目录，需同步更新此文档。

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

\`\`\`markdown
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
\`\`\`

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
- **ARCH 阶段**：创建/更新 `ERD.md`、`component-dependency-graph.md`
- **TASK 阶段**：创建/更新 `task-dependency-matrix.md`、`milestone-gantt.md`
- **数据库迁移时**：同步更新 `ERD.md`
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

## 自动生成产物说明

### TASK.md 的生成与维护
- **自动生成时机**：激活 TASK 专家后，通过 `/task plan` 快捷命令自动生成或刷新
- **生成输入**：`/docs/PRD.md` + `/docs/ARCHITECTURE.md`
- **生成工具**：`npm run task:generate`（由 `/task plan` 内部调用）
- **首次生成**：TASK.md 不存在时，工具从零生成；若已存在，工具执行增量更新
- **人工调整**：生成后可手工修改 Owner、优先级、风险备注等
- **再次刷新**：下次执行 `/task plan --update-only` 时，工具保留人工标注，仅刷新 WBS/依赖/关键路径

### 拆分决策（大型项目）
- 若满足拆分条件（主文档 > 1000 行 或 50+ 工作包 或 3+ 并行开发流），TASK 专家会：
  1. 在 `/docs/task-modules/README.md` 注册模块索引
  2. 创建 `/docs/task-modules/{domain}.md` 模块任务文档
  3. 修改主 `/docs/TASK.md` 为总纲与索引（< 500 行）
- 详见 `/AgentRoles/TASK-PLANNING-EXPERT.md` 的"自动生成规范"章节

### 文档依赖关系
```
PRD.md + ARCHITECTURE.md
         ↓
    /task plan (TASK 专家激活)
         ↓
    task:generate 工具
         ↓
    /docs/TASK.md （自动生成产物）
         ↓
    TDD/QA 专家读取
```

## Scripts 约定
- 脚本按用途分类，如 `scripts/ci.sh`、`scripts/deploy.sh`、`scripts/analyze_logs.py`。
- Shell 脚本首行声明 `#!/usr/bin/env bash`（或所需解释器），并包含 `set -euo pipefail` 等安全选项。
- 每个脚本在开头给出 Usage 注释，说明参数与前置条件。

## Tests 约定
- 单元测试通常随源码存放（如 `src/__tests__/`）；跨服务、端到端测试置于根 `tests/`。
- 测试命名遵循 `test_*` / `*_spec` 约定，与所用框架一致。
- 测试数据或快照应放在 `tests/fixtures/` 或子目录，避免污染主数据目录。

## 数据库迁移文件规范 ⚠️ 强制要求

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
./scripts/tdd-tools/create-migration.sh add_user_roles
```
- 自动生成正确的时间戳
- 包含标准化的文件模板
- 确保格式一致性

#### 2. 使用 Supabase CLI（推荐）✅
```bash
supabase migration new add_user_roles
```
- 自动生成格式正确的文件名
- 与 Supabase 生态集成良好

#### 3. 手动创建（不推荐）⚠️
```bash
TIMESTAMP=$(date +%Y%m%d%H%M%S)
touch "supabase/migrations/${TIMESTAMP}_add_feature_name.sql"
```
- 需要手动编写模板
- 容易遗漏必要注释

#### 4. 手动输入日期（严禁）❌
```bash
# ❌ 错误示例 - 日期不准确！
touch "supabase/migrations/20251104093000_add_feature.sql"
```

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

使用 `./scripts/tdd-tools/create-migration.sh` 会自动生成以下模板：

```sql
-- ============================================================
-- description_here
-- 日期: YYYY-MM-DD
-- 目标: [请描述此迁移的目的]
-- ============================================================

BEGIN;

-- ============================================================
-- 在此处添加 SQL 语句
-- ============================================================

COMMIT;

-- ============================================================
-- 回滚提示
-- ============================================================
-- 如需回滚此迁移，请执行以下操作:
-- [描述如何安全回滚此迁移]
```

### 提交前验证清单

- [ ] 文件名时间戳是否使用脚本或 `date` 命令生成？
- [ ] 文件名是否符合格式 `YYYYMMDDHHmmss_description.sql`？
- [ ] 文件内容是否包含必要的注释（日期、目标、回滚提示）？
- [ ] 迁移是否可以安全回滚？
- [ ] 是否满足幂等性要求（详见 TDD Playbook）？
- [ ] 是否已测试迁移可以正确执行？

### 数据字典同步

- 任何表结构变化必须同步更新：
  - `docs/data/ERD.md`：实体关系图
  - `docs/data/dictionary.md`：数据字典

## Frontend / Backend / Shared
- `frontend/` 与 `backend/` 可以进一步拆分子项目，如 `frontend/web`、`frontend/mobile`、`backend/api`。
- 若使用 Monorepo 工具（例如 Turborepo、Nx），可在此说明 package/workspace 结构。
- `shared/` 存放可复用模块（UI 组件、SDK、API 契约、设计系统等），保持 README 或注释说明归属。

## 其他约定
- 配置文件（如 `.env.development`、`.env.production`、`.github/`、`Dockerfile`）应按技术栈默认放置；若自定义位置，在此说明理由。
- 机密文件保持 `.gitignore` 遮盖；若需本地存放，创建 `secret/README.md` 引导操作。

## PRD 模块化规范

### 何时拆分 PRD？
当项目满足以下**任一条件**时，建议采用模块化 PRD：
1. 单文件 PRD 超过 **1000 行**
2. 用户故事数量超过 **50 个**
3. 存在明确的**业务域边界**（3+ 个独立子系统）
4. **多团队并行协作**，需要独立编辑不同功能域

对于小型项目（< 20 用户故事），维护单一 `/docs/PRD.md` 即可。

### 主从结构
- **主 PRD**（`/docs/PRD.md`）：总纲与索引（< 500 行）
  - 产品概述、全局范围、用户角色、核心场景
  - 全局 NFR（性能/安全/合规）
  - 功能域索引（表格，链接到各模块 PRD）
  - 里程碑与跨模块依赖
  - 追溯矩阵引用

- **子模块 PRD**（`/docs/prd-modules/{domain}/PRD.md`）：详细需求（按功能域拆分）
  - 模块概述、用户故事、验收标准（Given-When-Then）
  - 模块级 NFR、接口与依赖、数据模型、风险

- **追溯矩阵**（`/docs/data/traceability-matrix.md`）：集中维护全局 Story→AC→TestID 映射

### 模块内部结构（v1.8+）
每个功能域模块在 `/docs/prd-modules/{domain}/` 目录下可包含以下文件：
- `PRD.md` — 模块 PRD（必需）
- `dependency-graph.md` — 模块内依赖图（推荐，模块内 Story > 10 个时）
- `nfr-tracking.md` — 模块 NFR 追踪表（推荐，有关键 NFR 时）
- `priority-matrix.md` — 模块优先级矩阵（可选，优先级决策复杂时）

**与全局数据的关系**：
- 模块依赖图：只包含模块内 Story 依赖（如 US-USER-001 → US-USER-003）
- 全局依赖图（`/docs/data/global-dependency-graph.md`）：包含跨模块依赖（如 US-USER-003 → US-PAY-001）
- 详细说明见 [STRUCTURE-GUIDE.md](prd-modules/STRUCTURE-GUIDE.md) 和 [data/README.md](data/README.md)

### ID 命名规范
- **Story ID**：`US-{MODULE}-{序号}`（如 `US-USER-001`、`US-PAY-005`）
- **AC ID**：`AC-{MODULE}-{Story序号}-{AC序号}`（如 `AC-USER-001-01`）
- **Test Case ID**：`TC-{MODULE}-{序号}`（如 `TC-REG-001`）

### 模块文件命名
- 使用 kebab-case，如 `user-management.md`、`payment-system.md`
- 在 `/docs/prd-modules/README.md` 中维护模块索引表

### 模块化工作流
1. **PRD 专家**：评估是否需要拆分，创建主 PRD 与模块 PRD
2. **ARCHITECTURE 专家**：基于主 PRD + 相关模块 PRD（按需加载）输出架构文档
3. **TASK 专家**：基于模块 PRD 拆解任务，可按模块维护独立 WBS 章节
4. **TDD 专家**：基于模块 PRD 实现，测试用例关联到追溯矩阵
5. **QA 专家**：基于追溯矩阵验证覆盖率，引用模块 PRD 执行测试

详细指南见 `/AgentRoles/Handbooks/PRD-WRITER-EXPERT.playbook.md` §7。

## ARCHITECTURE 模块化规范

### 何时拆分架构文档？
当项目满足以下**任一条件**时，建议采用模块化架构文档：
1. 主架构文档超过 **1000 行**
2. 子系统/服务数量超过 **8 个**
3. 存在明确的**业务域边界**（3+ 个独立领域模型）
4. **多团队并行开发**，需要独立维护不同领域的架构设计
5. **数据模型复杂**（30+ 实体表，跨域数据流）

对于小型项目（< 5 个服务，单一数据库），维护单一 `/docs/ARCHITECTURE.md` 即可。

### 主从结构
- **主架构文档**（`/docs/ARCHITECTURE.md`）：总纲与索引（< 500 行）
  - 系统概述、功能域架构索引
  - 全局视图（系统全景、全局数据流、横切关注点）
  - 全局技术选型与 ADR、跨模块依赖关系、全局风险

- **子模块架构文档**（`/docs/architecture-modules/{domain}.md`）：详细架构设计（按功能域拆分）
  - 模块概述、逻辑视图（领域模型、服务/组件划分）
  - 数据视图（ER 图、数据模型、数据流）
  - 运行视图（部署架构、关键流程序列图）
  - 接口与依赖、模块级 NFR、风险与限制、ADR 引用

- **ADR 命名规范**：`NNN-{module}-{title}.md`（如 `001-user-auth-strategy.md`）

### ID 命名规范
- **组件/服务 ID**：`{MODULE}-{类型}-{序号}`（如 `USER-SVC-001`、`PAY-DB-001`）
- **类型标识**：SVC（服务）、DB（数据库）、API（API 端点）、JOB（后台任务）

### 模块文件命名
- 使用 kebab-case，如 `user-management.md`、`payment-system.md`
- 在 `/docs/architecture-modules/README.md` 中维护模块索引表

### 模块化工作流
1. **ARCHITECTURE 专家**：评估是否需要拆分，创建主架构文档与模块架构文档
2. **TASK 专家**：基于主架构文档 + 相关模块架构文档（按需加载）拆解任务
3. **TDD 专家**：基于模块架构文档实现，遵循接口契约
4. **QA 专家**：基于模块架构文档验证接口与 NFR

详细指南见 `/AgentRoles/Handbooks/ARCHITECTURE-WRITER-EXPERT.playbook.md`。

## TASK 模块化规范

### 何时拆分任务文档？
当项目满足以下**任一条件**时，建议采用模块化任务文档：
1. 主任务文档超过 **1000 行**
2. 工作包（WBS）数量超过 **50 个**
3. 存在 **3+ 个并行开发流**（多团队/多模块）
4. **项目周期超过 6 个月**，需要分阶段规划
5. **跨模块依赖复杂**（10+ 个依赖关系）

对于小型项目（< 20 个任务，单一团队），维护单一 `/docs/TASK.md` 即可。

### 主从结构
- **主任务文档**（`/docs/TASK.md`）：总纲与索引（< 500 行）
  - 项目概述、模块任务索引
  - 全局里程碑（跨模块）、跨模块依赖关系
  - 全局关键路径（CPM）、全局风险与缓解

- **子模块任务文档**（`/docs/task-modules/{domain}.md`）：详细任务计划（按功能域拆分）
  - 模块概述、WBS 任务列表（任务详细说明）
  - 依赖关系矩阵（内部依赖 + 外部依赖）
  - 资源与时间线、模块级里程碑、模块级风险登记、沟通与协作

### ID 命名规范
- **任务 ID**：`TASK-{MODULE}-{序号}`（如 `TASK-USER-001`、`TASK-PAY-005`）
- **里程碑 ID**：`M{序号}-{简短描述}`（如 `M1-MVP`、`M2-Beta`）

### 模块文件命名
- 使用 kebab-case，如 `user-management.md`、`payment-system.md`
- 在 `/docs/task-modules/README.md` 中维护模块索引表

### 模块化工作流
1. **TASK 专家**：评估是否需要拆分，创建主任务文档与模块任务文档
2. **TDD 专家**：按任务列表顺序实现，完成后更新任务状态
3. **QA 专家**：基于任务列表制定测试用例，验证任务完成度

详细指南见 `/AgentRoles/Handbooks/TASK-PLANNING-EXPERT.playbook.md`。

## QA 模块化规范

### 何时拆分 QA 文档？
当项目满足以下**任一条件**时，建议采用模块化 QA 文档：
1. 主 QA 文档超过 **1000 行**
2. 测试用例数量超过 **100 个**
3. 存在多类型测试（功能、性能、安全、兼容性各 > 10 个用例）
4. **多模块并行测试**（3+ 个功能域独立测试）
5. **长周期项目**（需要分阶段回归测试）

对于小型项目（< 30 个测试用例，单一测试类型），维护单一 `/docs/QA.md` 即可。

### 主从结构
- **主 QA 文档**（`/docs/QA.md`）：总纲与索引（< 500 行）
  - 测试概述、模块测试索引
  - 全局测试策略、全局质量指标
  - 全局风险评估、发布建议

- **子模块 QA 文档**（`/docs/qa-modules/{domain}.md`）：详细测试计划（按功能域拆分）
  - 测试概述、测试策略（测试类型与覆盖率目标、测试数据准备、通过/失败标准）
  - 测试用例（功能测试、集成测试、性能测试、安全测试）
  - 缺陷清单、测试总结与建议

- **追溯矩阵更新**：测试执行过程中，及时更新 `/docs/data/traceability-matrix.md` 的测试状态（Pass/Fail）与缺陷 ID

### ID 命名规范
- **测试用例 ID**：`TC-{MODULE}-{序号}`（如 `TC-REG-001`、`TC-PAY-012`）
- **缺陷 ID**：`BUG-{MODULE}-{序号}`（如 `BUG-USER-001`）或对接外部缺陷管理系统（如 `JIRA-PROJ-1234`）

### 模块文件命名
- 使用 kebab-case，如 `user-management.md`、`payment-system.md`
- 跨模块测试使用 `performance-testing.md`、`security-testing.md` 等命名
- 在 `/docs/qa-modules/README.md` 中维护模块索引表

### 模块化工作流
1. **QA 专家**：评估是否需要拆分，创建主 QA 文档与模块 QA 文档
2. **执行测试**：按模块逐步执行测试，实时更新测试结果与缺陷清单
3. **更新追溯矩阵**：标注所有测试用例的状态与缺陷 ID
4. **汇总发布建议**：基于所有模块测试结果，给出全局发布建议

详细指南见 `/AgentRoles/Handbooks/QA-TESTING-EXPERT.playbook.md`。

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
