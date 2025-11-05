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
- `docs/PRD.md`：产品需求文档（主 PRD，作为总纲与索引）。
- `docs/prd-modules/`：**大型项目 PRD 模块化目录**（按功能域拆分的详细 PRD），包含 `README.md` 模块索引。
- `docs/ARCHITECTURE.md`：架构文档（主架构文档，作为总纲与索引）。
- `docs/architecture-modules/`：**大型项目架构模块化目录**（按功能域拆分的详细架构），包含 `README.md` 模块索引。
- `docs/TASK.md`：任务计划（主任务文档，作为总纲与索引，含 WBS/依赖/里程碑/风险）。
- `docs/task-modules/`：**大型项目任务模块化目录**（按功能域拆分的详细任务计划），包含 `README.md` 模块索引。
- `docs/QA.md`：测试计划与执行记录（主 QA 文档，作为总纲与索引）。
- `docs/qa-modules/`：**大型项目 QA 模块化目录**（按功能域拆分的详细测试计划），包含 `README.md` 模块索引。
- `docs/AGENT_STATE.md`：阶段状态勾选清单。
- `docs/CHANGELOG.md`：版本级变更记录（亦可放仓库根 `CHANGELOG.md`，需在此注明）。
- `docs/adr/`：架构决策记录（`NNN-{module}-title.md` 命名）。
- `docs/data/`：数据相关内容（ERD、字典、样本数据、指标定义、**追溯矩阵**）。
  - `docs/data/traceability-matrix.md`：**需求追溯矩阵**（Story → AC → Test Case ID 映射）。
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
- `dependency-graph.mmd` — 模块内依赖图（推荐，模块内 Story > 10 个时）
- `nfr-tracking.md` — 模块 NFR 追踪表（推荐，有关键 NFR 时）
- `priority-matrix.md` — 模块优先级矩阵（可选，优先级决策复杂时）

**与全局数据的关系**：
- 模块依赖图：只包含模块内 Story 依赖（如 US-USER-001 → US-USER-003）
- 全局依赖图（`/docs/data/global-dependency-graph.mmd`）：包含跨模块依赖（如 US-USER-003 → US-PAY-001）
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
