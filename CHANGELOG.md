# Changelog

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，记录模板发布历史与重要调整。

## [v1.8] - 2025-11-05
### 新增
- **PRD 模块化架构**：支持大型项目按功能域拆分 PRD，避免单文件过大导致上下文撑爆。
  - 新增 `/docs/prd-modules/` 目录，用于存放按功能域拆分的子模块 PRD。
  - 新增 `/docs/prd-modules/README.md` 模块索引文件，包含命名规范、模块清单、标准模块 PRD 结构。
  - 新增 `/docs/data/traceability-matrix.md` 追溯矩阵模板，集中维护 Story → AC → Test Case ID 映射。
- **ARCHITECTURE 模块化架构**：支持大型项目按功能域拆分架构文档，避免单文件过大导致维护困难。
  - 新增 `/docs/architecture-modules/` 目录，用于存放按功能域拆分的子模块架构文档。
  - 新增 `/docs/architecture-modules/README.md` 模块索引文件，包含命名规范、模块清单、标准模块架构文档结构（195 行）。
  - 支持跨模块依赖管理与组件 ID 命名规范（`{MODULE}-{TYPE}-{序号}`，如 `USER-SVC-001`、`PAY-DB-001`）。
- **TASK 模块化架构**：支持大型项目按功能域拆分任务计划，避免 WBS 过大导致依赖关系混乱。
  - 新增 `/docs/task-modules/` 目录，用于存放按功能域拆分的子模块任务计划。
  - 新增 `/docs/task-modules/README.md` 模块索引文件，包含命名规范、模块清单、标准模块任务文档结构（220 行）。
  - 支持内部依赖与外部依赖分离管理，任务 ID 命名规范（`TASK-{MODULE}-{序号}`，如 `TASK-USER-001`）。
- **QA 模块化架构**：支持大型项目按功能域拆分测试计划，避免测试用例过多导致可读性下降。
  - 新增 `/docs/qa-modules/` 目录，用于存放按功能域拆分的子模块测试计划。
  - 新增 `/docs/qa-modules/README.md` 模块索引文件，包含命名规范、模块清单、标准模块 QA 文档结构（230 行）。
  - 支持测试用例 ID 命名规范（`TC-{MODULE}-{序号}`）与缺陷 ID 命名规范（`BUG-{MODULE}-{序号}`）。
- **主文档模板升级**：为所有核心文档提供小型项目与大型项目的双模板结构。
  - 更新 `/docs/ARCHITECTURE.md` 模板（388 行），包含 6 大架构视图（C4、运行时、数据、接口、运维、安全）与双模板结构。
  - 更新 `/docs/TASK.md` 模板（381 行），包含 12 个标准章节（WBS、依赖矩阵、关键路径、风险登记、测试映射、DB 迁移等）与双模板结构。
  - 更新 `/docs/QA.md` 模板（522 行），包含 9 个标准章节（测试策略、用例、缺陷、执行记录、指标、发布建议等）与双模板结构。
- 在 PRD-WRITER-EXPERT.playbook.md 中新增"§7. 大型项目 PRD 拆分指南"，包含：
  - 拆分触发条件与决策树（单文件 > 1000 行 或 50+ 用户故事 或 3+ 业务域）
  - 主从 PRD 结构设计（主 PRD < 500 行，子模块 PRD 按需加载）
  - 追溯矩阵分离策略
  - 模块拆分最佳实践（功能域边界划分、ID 命名规范、依赖管理、数据共享）
  - 与其他专家的协作方式
  - 常见问题与解决方案
  - 拆分实施步骤（5 步）
  - 从单体到模块化的迁移示例

### 调整
- 更新 PRD-WRITER-EXPERT.md 角色卡片：
  - 在"输出（写入路径）"章节增加大型项目模块化规则与追溯矩阵说明。
  - 在"完成定义（DoD）"章节增加拆分决策要求。
  - 重构"PRD 模板"章节，区分小型项目（单一 PRD）和大型项目（主从结构）。
- 更新 ARCHITECTURE-WRITER-EXPERT.md 角色卡片：
  - 在"输入"章节增加模块化 PRD 读取说明（按需读取 `/docs/prd-modules/{domain}.md`）。
  - 在"输出（写入路径）"章节增加大型项目模块化规则与拆分条件（> 1000 行 或 8+ 子系统 或 3+ 业务域）。
  - 在"完成定义（DoD）"章节增加模块化项目额外要求（注册模块清单、确保模块对齐）。
  - 更新"ARCH 最小模板"章节，提供小型项目（单一文件）和大型项目（主从结构）两种模板。
- 更新 TASK-PLANNING-EXPERT.md 角色卡片：
  - 在"输入"章节增加模块化 PRD/ARCH 读取说明（按需读取对应模块文档）。
  - 在"输出（写入路径）"章节增加大型项目模块化规则与拆分条件（> 1000 行 或 50+ 工作包 或 3+ 并行开发流）。
  - 在"完成定义（DoD）"章节增加模块化项目额外要求（明确标注跨模块依赖关系）。
  - 更新"TASK 最小模板"章节，提供小型项目（单一文件）和大型项目（主从结构）两种模板，增加 DB 任务固定表头（Expand/Migrate/Contract）。
- 更新 QA-TESTING-EXPERT.md 角色卡片：
  - 在"输入"章节增加模块化 PRD/ARCH/TASK 读取说明与追溯矩阵引用。
  - 在"输出（写入路径）"章节增加大型项目模块化规则与拆分条件（> 1000 行 或 100+ 测试用例 或 3+ 功能域）。
  - 在"输出（写入路径）"章节强化追溯矩阵更新要求与缺陷模板规范（Handbook §8.3）。
  - 在"完成定义（DoD）"章节增加模块化项目额外要求（注册模块清单、更新追溯矩阵）。
  - 新增"环境预检（首次激活时自动执行）"章节，包含 package.json scripts 完整性检查与自动修复逻辑（v1.7 功能）。
- 更新 AGENTS.md 路由说明（v1.7）：
  - 在"目录与产物约定"章节增加 PRD/ARCH/TASK/QA 模块、追溯矩阵的说明。
  - 在"Phase 1 — PRD 专家"章节详细说明小型/大型项目的不同输出策略与拆分条件。
  - 在"Phase 2 — ARCHITECTURE 专家"章节增加模块化输入源与双输出策略（小型单一文件 vs 大型主从结构）。
  - 在"Phase 3 — TASK 规划专家"章节增加模块化输入源与双输出策略，强调跨模块依赖管理。
  - 在"Phase 5 — QA 专家"章节增加模块化输入源与双输出策略，强调追溯矩阵集中管理。
- 更新 `/docs/CONVENTIONS.md` 目录规范（v1.3）：
  - 在"`docs/` 子结构"章节增加 `prd-modules/`、`architecture-modules/`、`task-modules/`、`qa-modules/` 和 `data/traceability-matrix.md` 说明。
  - 新增"PRD 模块化规范"章节，包含拆分条件、主从结构、ID 命名规范、模块文件命名、模块化工作流。
  - 新增"ARCHITECTURE 模块化规范"章节，包含拆分条件、组件 ID 命名（`{MODULE}-{TYPE}-{序号}`）、ADR 命名规范、跨模块协作指南。
  - 新增"TASK 模块化规范"章节，包含拆分条件、任务 ID 命名（`TASK-{MODULE}-{序号}`）、依赖矩阵分离（内部/外部依赖）、DB 迁移任务规范（Expand→Migrate→Contract）。
  - 新增"QA 模块化规范"章节，包含拆分条件、测试用例 ID 命名（`TC-{MODULE}-{序号}`）、缺陷 ID 命名（`BUG-{MODULE}-{序号}`）、追溯矩阵集中管理、缺陷模板规范（Handbook §8.3）。

### 优势
- **按需加载**：大模型只读取需要的模块，避免上下文撑爆，Token 占用最小化。
- **便于维护**：功能域独立编辑，支持多团队并行协作，变更追踪更清晰。
- **追溯完整**：集中矩阵便于 QA 专家验证需求覆盖率与测试通过率。
- **向下兼容**：小型项目无需改动，大型项目自动评估拆分，保持现有"产物驱动"和"单阶段激活"设计。
- **一致性保障**：PRD、ARCH、TASK、QA 四个阶段采用统一的模块化策略，功能域边界对齐，ID 命名规范一致。
- **视觉化增强**：所有主文档模板增加 Mermaid 图表支持（C4 架构图、关键路径图、质量趋势图等），提升可读性。

## [v1.4] - 2025-11-01
### 新增
- 在 QA-TESTING-EXPERT.md 和 Playbook 中新增完整的部署与发布流程章节（§5），包含部署前检查清单、部署命令使用、部署后验证、回滚流程。
- 在 QA-TESTING-EXPERT.playbook.md 中新增"§2.5 部署与发布阶段"作业流程。
- 在 `/docs/QA.md` 推荐模板中新增"部署记录"表格，用于记录部署历史、冒烟结果与监控链接。
- 在 AGENTS.md 中新增"快捷命令与自动激活"章节，明确所有快捷命令会自动激活对应专家。

### 调整
- **职责分离优化**：明确 CI 命令归属 TDD 专家，CD/部署命令归属 QA 专家，建立清晰的质量门禁。
- 从 TDD-PROGRAMMING-EXPERT.md 中移除 4 个部署命令（`/ship staging`, `/ship prod`, `/cd staging`, `/cd prod`），移交给 QA 专家。
- 在 TDD-PROGRAMMING-EXPERT.playbook.md 中注释掉部署脚本，添加说明指向 QA 专家负责部署。
- 强化 TDD 专家的 QA 移交清单，明确移交条件（CI全绿、文档回写完成、CHANGELOG已更新、TDD_DONE已勾选）。
- 扩展 QA-TESTING-EXPERT.md 角色职责，新增部署与发布职责说明及5项前置条件。
- 优化 AGENTS.md 的"快捷命令速查"章节，按专家分组展示命令，每个命令都标注功能说明。

### 修复
- 清理 CHANGELOG.md 中的重复内容。
- 更新 QA-TESTING-EXPERT.playbook.md 章节编号（因插入新章节导致后续章节顺延）。
- 确保 AGENTS.md、专家角色文件、Playbook 三层文档的快捷命令完全一致。

## [v1.3] - 2025-10-13
### 新增
- `CHANGELOG.md`，作为模板版本历史记录入口。
- `.gemini/` 配置说明，默认将 Gemini CLI 上下文指向 `AGENTS.md`。
- `docs/AGENT_STATE.md` 增补 QA 阶段勾选项，确保状态机五阶段对齐。

### 调整
- 全面重写五位专家 Playbook 的结构，新增"输入与参考 / 输出与回写"段落并引用 `docs/CONVENTIONS.md`。
- 向各专家卡片和 `AGENTS.md` 添加点读 Playbook 提示，明确激活后获取模板与 Checklist 的路径。
- 更新 README 目录速览、快速开始与拷贝指引，说明文档回写 Gate、state 文件与 Playbook 用法。

### 修复
- 统一 QA 流程描述，补充 `/docs/QA.md`、`/docs/CHANGELOG.md`、ADR 等文档回写要求。

## [v1.2] - 2025-10-12
### 新增
- 首次公开发布 Agents Router 模板，包含五位专家卡片、配套 Playbook、`docs/AGENT_STATE.md` 状态机与目录骨架。
- 提供 `docs/CONVENTIONS.md` 目录规范、`db/migrations/` 双语言模板、`docs/data/` 数据视图示例。

### 调整
- 将 Handbooks 架构重构为按章节点读，强调激活后加载对应 Playbook。
- 状态机扩展至五阶段（PRD → ARCH → TASK → TDD → QA），同步更新 `AGENTS.md` 与 `docs/AGENT_STATE.md`。

### 修复
- 补全 QA 阶段文档回写说明，使 `/docs/QA.md`、`/docs/CHANGELOG.md`、ADR 与状态机保持一致。

[v1.4]: https://github.com/your-org/agents-router/releases/v1.4
[v1.3]: https://github.com/your-org/agents-router/releases/v1.3
[v1.2]: https://github.com/your-org/agents-router/releases/v1.2
