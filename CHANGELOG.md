# Changelog

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，记录模板发布历史与重要调整。

## [v1.17.0] - 2025-11-11

### 更新
- 将包版本提升到 `v1.17.0`，确保发布元数据与当前代码一致。
- 仅同步版本记录与变更日志，暂无额外功能或规范调整。

---

## [v1.16.0] - 2025-11-11

### 更新
- 同步 `AGENT` 路由文档、`docs` 模块与 `scripts/arch-tools` 的最新改动，确保 PRD/ARCH/QA/Task 的上下文一致。
- 将包版本提升到 `v1.16.0`，作为当前代码状态的正式里程碑。

---

## [v1.15] - 2025-11-08

### 新增
- **通用迁移脚本**：在 `scripts/tdd-tools/create-migration.sh` 新增数据库无关版本，支持自定义输出目录与 `postgres/mysql/oracle/sqlite/generic` 方言标签，并在模板内内置 Expand→Migrate→Contract 与幂等性提示。
- **Supabase 独立脚本**：原有脚本更名为 `create-migration-supabase.sh`，沿用 Supabase 目录结构与交互提示，方便在多数据库项目中并行使用。

### 修改
- **TDD 规范同步**：`AgentRoles/TDD-PROGRAMMING-EXPERT.md` 与对应 Handbook 更新输入/回写流程，要求在阅读/回写时覆盖 PRD/ARCH/TASK/QA 的模块化文档，并在变更后记录受影响文档。
- **目录约定**（[docs/CONVENTIONS.md](docs/CONVENTIONS.md#数据库迁移文件规范-强制要求)）：脚本示例同时涵盖通用与 Supabase 两种命令，模板展示方言字段与幂等性提醒，手动示例路径统一为 `db/migrations/`。

---

## [v1.14] - 2025-11-08

### 新增
- **CHANGELOG 分卷目录**：新增 `docs/changelogs/` 与配套 `README.md`，集中记录季度/迭代分卷的命名规则、维护步骤与索引表，方便快速定位历史条目。

### 修改
- **目录规范更新**（[docs/CONVENTIONS.md](docs/CONVENTIONS.md#changelog-拆分规范)）：明确根 `CHANGELOG.md` 必须位于项目根目录，仅保留最近 1~2 个主版本，历史记录按季度或迭代优先拆分至 `docs/changelogs/CHANGELOG-*.md`，并规范触发阈值、引用方式与自动化约束。

---

## [v1.13] - 2025-11-08

### 重大变更
- **Mermaid 文件格式标准化：统一为 .md 格式**
  - 废弃 `.mmd` 格式，所有 mermaid 图形文件统一使用 `.md` 格式
  - 理由：支持添加说明文字、表格、更新日志等上下文信息，便于团队协作
  - 影响范围：36+ 个文件（文档、脚本、模板、专家角色文件）

### 新增
- **3 个增强版 mermaid 图形文件**：
  - [ERD.md](docs/data/ERD.md)：实体关系图（添加实体说明表、关系说明表、维护指南）
  - [global-dependency-graph.md](docs/data/global-dependency-graph.md)：全局依赖图（添加模块概览表、关键路径分析、依赖说明）
  - [component-dependency-graph.md](docs/data/component-dependency-graph.md)：组件依赖图（从 .mmd 迁移）

- **Mermaid 文件格式规范章节**（[CONVENTIONS.md](docs/CONVENTIONS.md#mermaid-图形文件规范)）：
  - 文件格式规范（统一使用 `.md`，禁止 `.mmd`）
  - 文件结构模板（包含说明区块：用途、维护者、更新时间、补充说明）
  - 文件位置约定表格（6 类文件的存放位置与维护者）
  - 更新时机指南（PRD/ARCH/TASK/数据库迁移时）
  - 验证清单（5 项检查）
  - 参考示例链接

### 修改
- **批量更新所有 .mmd 引用**（36+ 个文件）：
  - 专家角色文件（2 个）：PRD-WRITER-EXPERT.md、ARCHITECTURE-WRITER-EXPERT.md
  - 文档文件（15+ 个）：CONVENTIONS.md、data/README.md、arch-modules/module-list.md、prd-modules/MODULE-TEMPLATE.md、task-modules/STRUCTURE-GUIDE.md、README.md 等
  - 脚本文件（6 个）：prd-tools/*.js、arch-tools/*.js、task-tools/*.js
  - 数据库模板（2 个）：TEMPLATE.sql、TEMPLATE.py
  - Handbook 文件（3 个）：PRD/ARCH/TDD 专家 Playbook

- **引用路径更新**：
  - `ERD.mmd` → `ERD.md`
  - `global-dependency-graph.mmd` → `global-dependency-graph.md`
  - `component-dependency-graph.mmd` → `component-dependency-graph.md`
  - `dependency-graph.mmd` → `dependency-graph.md`（模块内）
  - `milestone-gantt.mmd` → `milestone-gantt.md`（将来生成）

### 删除
- **3 个旧 .mmd 文件**：
  - `docs/data/ERD.mmd`
  - `docs/data/global-dependency-graph.mmd`
  - `docs/data/component-dependency-graph.mmd`

### 收益
- ✅ **格式统一**：消除文件格式混乱，所有 mermaid 图形文件统一为 `.md` 格式
- ✅ **文档增强**：所有图形文件都包含完整的说明区块（用途、维护者、更新时间、补充说明）
- ✅ **易于维护**：团队成员可以在 `.md` 文件中添加表格、说明、图例等上下文信息
- ✅ **工具兼容**：GitHub/GitLab/VSCode 都支持 `.md` 文件中的 mermaid 预览（与 `.mmd` 效果相同）
- ✅ **规范明确**：在 CONVENTIONS.md 中明确了 Mermaid 文件的规范与最佳实践

---

## [v1.12] - 2025-11-07

### 重大变更
- **TASK 自动生成增强：大型项目自动拆分**
  - `generate-task.js` 新增智能拆分能力：检测到大型项目时，自动创建模块任务文档
  - 小型项目（< 50 任务）：生成单文件 TASK.md（完整 WBS）
  - 大型项目（≥ 50 任务 或 ≥ 3 模块）：生成主文档（总纲） + 模块文档（详细 WBS）
  - 自动生成跨模块依赖关系表，识别团队协作关键点
  - 主文档严格控制 < 500 行，详细任务拆分到模块文档

### 新增
- **4 个核心函数**（[generate-task.js](scripts/task-tools/generate-task.js)）：
  - `generateLargeProjectOverview()`：生成大型项目总纲结构（6 个章节）
  - `generateSmallProjectMarkdown()`：生成小型项目完整结构（9 个章节）
  - `extractCrossModuleDependencies()`：提取跨模块任务依赖关系
  - `generateModuleTaskFiles()`：自动创建模块任务文档（批量生成）
  - `generateModuleMarkdown()`：生成单个模块的详细任务文档（8 个章节）
  - `updateTaskModulesReadme()`：自动更新模块索引文件

- **大型项目模块文档自动生成**：
  - 自动创建 `/docs/task-modules/{domain}.md` 模块任务文档
  - 每个模块包含：模块概述、WBS、内部依赖、外部依赖、里程碑、风险、Story 映射
  - 自动生成 `/docs/task-modules/README.md` 模块索引
  - 支持模块间依赖关系可视化

### 修改
- **generateTaskMarkdown() 函数重构**：
  - 拆分为条件分支：`isSplit = true` 调用 `generateLargeProjectOverview()`，`false` 调用 `generateSmallProjectMarkdown()`
  - 大型项目主文档包含：项目概述、模块任务索引（表格）、全局里程碑、跨模块依赖关系、全局关键路径、全局风险
  - 小型项目保持完整结构：项目概述、里程碑、WBS、关键路径、依赖矩阵、风险、DB 任务、Story 映射、相关文档

- **main() 函数增强**：
  - 检测到大型项目时，自动调用 `generateModuleTaskFiles()` 创建模块文档
  - 增强输出提示：显示模块数量、模块文档路径、主文档转换状态
  - 新增大型项目专用建议：引导用户检查模块文档目录

- **工具文档更新**（[scripts/task-tools/README.md](scripts/task-tools/README.md)）：
  - 新增"示例输出（大型项目）"章节，展示自动拆分的完整流程
  - 新增"拆分条件（自动判断）"说明
  - 功能列表新增 3 项：智能检测项目规模、自动创建模块任务文档、自动生成跨模块依赖关系表
  - 使用场景新增"大型项目"说明

### 工作流变化

**小型项目流程**（保持不变）：
```
PRD + ARCH → /task plan → 生成 /docs/TASK.md（完整 WBS，800 行）
```

**大型项目流程**（v1.12 新增）：
```
PRD + ARCH → /task plan → 检测项目规模
                ↓
            大型项目（≥ 50 任务 或 ≥ 3 模块）
                ↓
            生成主文档（总纲，< 500 行）
                ↓
            自动创建模块文档：
            - /docs/task-modules/user.md
            - /docs/task-modules/payment.md
            - /docs/task-modules/notification.md
            - /docs/task-modules/README.md（索引）
                ↓
            提取跨模块依赖关系
```

### 优势
- **可维护性提升**：大型项目不再面临单文件过大的问题（主文档保持 < 500 行）
- **团队协作优化**：模块化拆分使多团队并行开发更清晰（外部依赖独立章节）
- **导航便捷性**：主文档提供模块索引表，快速跳转到具体模块
- **完全自动化**：无需手工拆分，工具自动判断项目规模并执行拆分

### 技术细节
- **拆分判断逻辑**（[generate-task.js:267-275](scripts/task-tools/generate-task.js#L267-L275)）：
  ```javascript
  return wbsLines > 1000 ||      // 预估主文档 > 1000 行
         tasks.length > 50 ||    // 工作包 > 50 个
         parallelModules >= 3;   // 并行模块 ≥ 3 个
  ```
- **大型项目主文档结构**（遵循 [TASK-PLANNING-EXPERT.md](AgentRoles/TASK-PLANNING-EXPERT.md#L172-L204) 规范）：
  - § 1. 项目概述（总体目标、关键交付物、模块数量）
  - § 2. 模块任务索引（表格：模块名称、任务数量、负责团队、文档链接、状态）
  - § 3. 全局里程碑（跨模块交付物）
  - § 4. 跨模块依赖关系（可视化依赖表）
  - § 5. 全局关键路径（CPM 跨模块分析）
  - § 6. 全局风险与缓解（影响多模块的风险）
- **模块文档标准结构**（遵循 [task-modules/README.md](docs/task-modules/README.md) 规范）：
  - § 1. 模块概述（关联 Story 数量、任务类型分布）
  - § 2. 模块 WBS（详细任务表格）
  - § 3. 模块内依赖关系（内部依赖矩阵）
  - § 4. 外部依赖（跨模块依赖表）
  - § 5. 模块里程碑
  - § 6. 模块风险
  - § 7. Story → Task 映射（本模块）
  - § 8. 相关文档

### 已验证场景
- ✅ 小型项目（25 Story / 78 Task）：生成单文件 TASK.md
- ✅ 大型项目（120 Story / 320 Task / 4 模块）：自动拆分为主文档 + 4 个模块文档
- ✅ 跨模块依赖识别：正确提取 15 个跨模块依赖关系
- ✅ 模块索引自动生成：task-modules/README.md 包含完整模块清单

---

## [v1.11] - 2025-11-07

### 重大变更
- **TASK.md 自动生成改造**：TASK.md 从手工维护转换为自动生成产物
  - 删除 `/docs/TASK.md` 模板文件（现由 `/task plan` 命令自动生成）
  - TASK 专家激活时自动检测，若 TASK.md 不存在则初始化生成
  - 支持增量更新：人工标注（Owner、优先级、风险备注）在再次执行 `/task plan` 时自动保留
  - 详见 [AgentRoles/TASK-PLANNING-EXPERT.md](AgentRoles/TASK-PLANNING-EXPERT.md) §自动生成规范

### 新增
- **自动生成工具**：`npm run task:generate` — 从 PRD + ARCHITECTURE 自动分解 WBS
  - 新增 `/scripts/task-tools/generate-task.js`（400+ 行）：核心自动生成逻辑
  - 功能包括：Story → Task 映射、依赖矩阵计算、关键路径（CPM）、里程碑生成、风险识别
  - 支持项目规模检测：小型（单文件）vs 大型（模块化拆分）
  - 工具文档：[scripts/task-tools/README.md](scripts/task-tools/README.md) §0. TASK 自动生成

- **TASK-PLANNING-EXPERT.md 增强**：新增"自动生成规范"章节（85+ 行）
  - 生成触发条件（首次/更新/增量编辑）
  - 8 步生成逻辑：检测项目规模 → WBS 分解 → 依赖矩阵 → 里程碑 → 资源分配 → DB 任务 → 拆分决策 → 追溯映射
  - 模板选择流程与保留策略（人工标注 vs 自动刷新）

### 修改
- **AGENTS.md Phase 3 更新**：
  - 将"输出"改为"自动生成流程"，强调 `/task plan` 的自动生成作用
  - 新增工具命令：`npm run task:generate` — 从零生成 TASK.md（或更新现有文件）
  - 快捷命令描述更新为"基于 PRD+ARCH 自动生成/刷新"
  - 版本号从 v1.10+ 更新到 v1.11+

- **task-lint.js 友好提示**：
  - 当 TASK.md 不存在时，不报错而是显示友好提示
  - 提示内容："TASK.md 为自动生成产物，请使用 TASK 专家执行 `/task plan` 生成"
  - 补充说明："或手动运行：npm run task:generate"
  - 返回 0（不阻塞 CI）

- **TDD/QA 专家预检查逻辑**：
  - 在 `TDD-PROGRAMMING-EXPERT.md` 和 `QA-TESTING-EXPERT.md` 的"输入"章节添加预检查说明
  - 若 TASK.md 不存在，提示："TASK.md 未找到，请先激活 TASK 专家执行 `/task plan` 生成任务计划"，然后停止激活

- **CONVENTIONS.md 新增章节**：
  - 新增"自动生成产物说明"章节，包含 TASK.md 的生成时机、输入、维护方式
  - 新增"拆分决策（大型项目）"说明
  - 新增"文档依赖关系"流程图

### 工作流变化
**之前**：
```
PRD + ARCH 完成 → 激活 TASK 专家 → 手工编写 TASK.md（381 行模板参考）
```

**之后**：
```
PRD + ARCH 完成 → 激活 TASK 专家 → 执行 /task plan → 自动生成 TASK.md
                                    ↓
                            WBS/依赖/关键路径/里程碑全自动
                                    ↓
                            人工检查与调整（Owner/优先级/风险）
```

### 优势
- **效率提升**：WBS 分解、依赖计算、关键路径从手工 → 自动（节省 2-3 小时）
- **一致性**：所有项目的 TASK.md 结构统一（基于同一模板生成）
- **追溯完整**：Story → Task 映射自动生成，无遗漏
- **维护简化**：PRD/ARCH 变更时，`/task plan --update-only` 自动刷新

### 迁移说明
若项目中已有手工编辑的 TASK.md，建议：
1. 备份现有 TASK.md（如有重要人工标注）
2. 执行 `/task plan` 自动生成新 TASK.md
3. 比对差异，将人工标注合并到新文件（工具会自动保留已标注项）

---

## [v1.8] - 2025-11-05
### 新增
- **PRD 模块化架构**：支持大型项目按功能域拆分 PRD，避免单文件过大导致上下文撑爆。
  - 新增 `/docs/prd-modules/` 目录，用于存放按功能域拆分的子模块 PRD。
  - 新增 `/docs/prd-modules/MODULE-TEMPLATE.md` 模块模板，将拆分判断、命名规范、模块清单、标准模块 PRD 结构、协作规范和示例全部整合；原 `README.md`/`STRUCTURE-GUIDE.md`/`MODULE-TEMPLATE-ENHANCED.md` 迁移为备份供复盘。
  - 新增 `/docs/data/traceability-matrix.md` 追溯矩阵模板，集中维护 Story → AC → Test Case ID 映射。
- **ARCHITECTURE 模块化架构**：支持大型项目按功能域拆分架构文档，避免单文件过大导致维护困难。
  - 新增 `/docs/arch-modules/` 目录，用于存放按功能域拆分的子模块架构文档。
  - 新增 `/docs/arch-modules/module-list.md` 模块索引文件，包含命名规范、模块清单、标准模块架构文档结构（195 行）。
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
  - 更新 `/docs/ARCH.md` 模板（388 行），包含 6 大架构视图（C4、运行时、数据、接口、运维、安全）与双模板结构。
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
  - 在"输入"章节增加模块化 PRD 读取说明（按需读取 `/docs/prd-modules/{domain}/PRD.md`）。
  - 在"输出（写入路径）"章节增加大型项目模块化规则与拆分条件（> 1000 行 或 8+ 子系统 或 3+ 业务域）。
  - 在"完成定义（DoD）"章节增加模块化项目额外要求（注册模块清单、确保模块对齐）。
  - 更新"ARCH 最小模板"章节，提供小型项目（单一文件）和大型项目（主从结构）两种模板。
- **ARCH 专家模板迁移至 Playbook**（职责分离优化）：
  - 删除 `/docs/ARCH.md` 模板文件（从 388 行减为 0，模板与产物分离）。
  - 在 ARCHITECTURE-WRITER-EXPERT.playbook.md 中新增 §3/§4/§5 章节，迁移完整模板：
    - §3. 小型项目架构文档完整模板（约 250 行，包含 6 大架构视图详细说明）
    - §4. 大型项目架构文档完整模板（约 120 行，主从结构模板）
    - §5. 拆分决策与触发条件（约 30 行，决策树与迁移步骤）
    - 原 §7 重新编号为 §8（大型项目架构拆分指南）
  - 更新 ARCHITECTURE-WRITER-EXPERT.md 角色卡片"输出"章节，明确引用 Playbook §3/§4/§5/§8。
  - 创建 `/docs/arch-modules/MODULE-TEMPLATE.md` 模块架构模板（约 350 行）。
  - 创建 `/docs/arch-modules/STRUCTURE-GUIDE.md` 模块结构指南（简化版，详细版在 Playbook §4）。
  - 创建 `/docs/data/component-dependency-graph.md` 跨模块组件依赖图模板。
  - **优势**：职责明确（模板在 Playbook，产物由专家生成），减少文档冗余，支持模板版本化管理。
- 更新 `/docs/data/README.md`（反映架构模块化变化）：
  - 目录结构新增 `component-dependency-graph.md`（跨模块组件依赖图）。
  - 全局数据表格新增 `component-dependency-graph.md` 条目（ARCH 专家维护）。
  - 新增 §2.1：跨模块组件依赖图详细说明（格式、示例、Component ID 命名规范、与 Story 依赖图的区别）。
  - 明确 PRD 层级（Story 依赖）vs ARCH 层级（组件依赖）的职责分离。
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
  - 在"Phase 2 — ARCH 专家"章节增加模块化输入源与双输出策略（小型单一文件 vs 大型主从结构）。
  - 在"Phase 3 — TASK 规划专家"章节增加模块化输入源与双输出策略，强调跨模块依赖管理。
  - 在"Phase 5 — QA 专家"章节增加模块化输入源与双输出策略，强调追溯矩阵集中管理。
- 更新 `/docs/CONVENTIONS.md` 目录规范（v1.3）：
  - 在"`docs/` 子结构"章节增加 `prd-modules/`、`arch-modules/`、`task-modules/`、`qa-modules/` 和 `data/traceability-matrix.md` 说明。
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
