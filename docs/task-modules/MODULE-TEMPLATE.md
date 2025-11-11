# 子模块 TASK 模板

> 本文档整合了模块目录约定、模板结构、协作规范等要素，是模块化需求治理的唯一权威参考。
>
> **提醒**：TASK 专家在评估拆分前，请先梳理本文件的目录与模板规范后再展开模块产出，生成的模块 TASK 仍以 `{domain}/TASK.md` 为主体，从本模板获取章节/支撑产物的定义。

## 1. 目录与命名规范

### 1.1 模块目录结构

```
/docs/
└── task-modules/
    ├── MODULE-TEMPLATE.md # 本模板（权威）
    ├── module-list.md # 模板清单（由 TASK 专家根据本文件 §3 模块清单模板 生成）
    └── {domain}/
        └── TASK.md
```

### 1.2 命名与 ID

- **模块目录**：`{domain}` 使用 kebab-case 域名（如 `user-management`、`payment-system`），保持与主 PRD 功能域索引中的 ID 一致，便于追溯与自动化脚本查找。
- **模块文件**：`{domain}/ARCH.md`（目录固定，文件名统一为 `ARCH.md`），与主 ARCH 的结构保持同步，方便引用与导航。
- **Story ID**：`US-{MODULE}-{序号}`（例如 `US-USER-001`、`US-PAY-005`）
- **验收标准 ID**：`AC-{MODULE}-{Story序号}-{AC序号}`（例如 `AC-USER-001-01`）
- **测试用例 ID**：`TC-{MODULE}-{序号}`（例如 `TC-REG-001`）

#### Task ID
- 格式：`TASK-{MODULE}-{序号}`（3 位数字或附加后缀）。例如：
  - `TASK-USER-001`（用户管理第 1 个任务）
  - `TASK-PAY-005`（支付功能第 5 个任务）
  - `TASK-DB-001-EXPAND`（数据库迁移的 Expand 阶段）

#### 里程碑 ID
- 格式：`M{序号}-{简短描述}`（如 `M1-MVP`、`M2-Beta`、`M3-GA`）。

#### 状态与优先级
- 状态
   - 📝 待开始（已规划但尚未启动）
   - 🚀 进行中（正在开发或执行）
   - 🔄 已提交（代码/变更已提交，待验证）
   - ✅ 已完成（验证通过并已发布）
   - ⏸️ 暂停（因依赖或资源问题暂缓）
   - ❌ 已取消（调整范围或无需实施）📝 待开始 / 🚀 进行中 / 🔄 已提交 / ✅ 已完成 / ⏸️ 暂停 / ❌ 已取消。
   
- 优先级：P0（阻塞发布）→ P1（重要）→ P2（增值）→ P3（可延后）。

## 2. 模块清单模板

TASK 专家在创建或更新模块时须同步更新以下清单：

| 模块名称 | 文件路径 | 负责团队 | 对应 PRD 模块 | 对应 ARCH 模块 | 状态 | 最后更新 |
|---------|---------|---------|--------------|---------------|------|---------|
| 示例：用户管理 | [TASK.md](user-management/TASK.md) | @team-backend | [prd-modules/user-management/PRD.md](../prd-modules/user-management/PRD.md) | [arch-modules/user-management/ARCH.md](../arch-modules/user-management/ARCH.md) | ✅ 已确认 | 2025-11-05 |
| 示例：支付系统 | [TASK.md](payment-system/TASK.md) | @team-payment | [prd-modules/payment-system/PRD.md](../prd-modules/payment-system/PRD.md) | [arch-modules/payment-system/ARCH.md](../arch-modules/payment-system/ARCH.md) | 🔄 进行中 | 2025-11-05 |
| （待补充） | - | - | - | - | - | - |

该表格仅作为模板，实际模块清单信息由 TASK 专家根据以上表格生成到`module-list.md`，每次 TASK 模块变化都更新`module-list.md`。

## 3. 标准模块 ARCH 结构

`{domain}/TASK.md` 根据模板创建，模板见本文件 § Appendix A: TASK 模块模板。
- 每次更新需记录 `最后更新` 时间戳
- 重大变更需在主 TASK 的“变更记录”章节同步

## 4. 支撑产物说明
- **任务清单与交付物**：维护包含 Task ID、产出（代码、脚本、文档）、负责角色与验收标准的列表，突出必须完成的 Deliverable 与验证人。
- **依赖与验证产物**：指明本模块依赖的 PRD/ARCH/其他模块 Task（Story→Task），以及需触发的验证（接口契约验证、DB 回归、性能/安全测试），并在 Traceability Matrix 中打标。
- **状态同步与 Gate**：列出需同步的主 TASK/模块索引字段（如状态、里程碑、AGENT_STATE），并记录进入 `TDD_DONE`/`QA_VALIDATED` 所需的检查清单与责任人，以确保任务交付与流程一致。

## 5. 模块协作规范

### 5.0 分支与 Task ID 绑定
- **分支命名**：每个 Task 实施前，在仓库根执行 `git checkout -b feature/TASK-<MODULE>-<编号>-<短描述>`。将 Task ID 编入分支名让 `npm run task:sync`、`npm run tdd:tick`（`/tdd sync`）等自动化工具能直接识别当前 Task，在 `/docs/TASK.md`、模块 TASK、`module-list.md` 中标记状态。
- **保持分支一致性**：文档更新、实现代码与测试都在这个 feature 分支上完成，避免先在 `main`/其他 default 分支改动再 cherry-pick；若需要同时推进多个紧密相关 Task，可以通过 `feature/TASK-FOO-001+TASK-FOO-002` 把它们一起放入分支名。
- **进度回写**：每次 `tdd-tick`、`task:sync` 执行时，保证触发它们的分支名仍包含当前 Task ID，否则脚本会因为“未找到 TASK ID”而拒绝，提示切回规范命名的 feature 分支再重试。

### 5.1 跨模块依赖协作
- 在模块 Task 中列出依赖模块/团队（Task/Story/接口），并同步更新 `/docs/data/task-dependency-matrix.md` 与 `module-list.md` 中的关键路径。
- 依赖变更（scope 延迟、外部服务变动）要通知对应模块/团队，并在主 TASK 或 module list 的“状态”栏中标明阻塞点。
- 每个依赖应附带对应 Story/Task/ARCH 链接及必要的 Gate 条件（Gate 例如 `TASK_PLANNED` → `TDD_DONE`）。

### 5.2 验收与交付协作
- 明确接口/数据依赖的验收标准与验证人（QA/TDD），在模块 Task 中列出对应 AC/TC ID 与 Traceability Matrix 链接。
- 完成后把验证结果（测试报告、Qa sign-off）附在模块文档，并同步到 `prj/traceability-matrix.md` 或 `docs/data/traceability-matrix.md`。
- 若涉及 DB 迁移或接口合同更新，还需通知 ARCH（提供接口文档链接）。

### 5.3 状态同步与 Gate
- 模块状态、优先级、完成度要能在主看板/AGENT_STATE 中实时反映，并将 `TASK_PLANNED`/`TDD_DONE`/`QA_VALIDATED` 的触发条件列在 Gate 清单。
- 每次 Gate 触发前，确认 Story→Task → Test 追溯、里程碑、依赖、风险已同步，并记录在模块 Task 的“自检”或“Gate remarks”字段。

### 5.4 通知与演练
- 模块变更时通过 Slack/邮件/会议告知 ARCH/PRD/TDD/QA，附上需验证的区块和预期完成时间。
- 若模块交付包含演练（如数据迁移/回归），附注演练步骤、负责人、完成情况，并用 “演练报告” 章节记录执行结果。

## 6. 维护与文件时机

### 6.1 更新节奏
- 每当 Task/WBS/依赖/风险/里程碑变化时，立即在模块 TASK 中记录版本、日期、负责人，并同步更新 `module-list.md` 与主 TASK 的“模块任务索引”表。
- 完成变更后运行 `npm run task:lint`、`npm run task:check-cycles`、`npm run task:sync`，保障结构、依赖与 Traceability 与主线对齐。
- 重大交付（接口变更、DB 迁移、关键里程碑）触发时，按照 AGENT_STATE 的阶段（`TASK_PLANNED` → `TDD_DONE` → `QA_VALIDATED`）更新状态并填补 Gate 注记。

### 6.2 状态与 Gate 自检
- 在每个 Gate 之前，确认 Story→Task→Test 追溯、依赖矩阵、里程碑/风险表、验收报告已同步，并把对应信息写入模块 TASK 的自检段。
- Gate 回归：`TASK_PLANNED` 触发时需完成 WBS/依赖审查，`TDD_DONE` 触发时需完成验证记录，`QA_VALIDATED` 触发时需确保测试门控/Traceability 完整。

### 6.3 协作与通知
- 模块变更通过 Slack、邮件或 PR 说明通知 ARCH/PRD/TDD/QA，附上变更范围、验证需求与预期完成时间。
- 如变更涉及 ARCH 接口/数据、QA 验收或任务依赖，模块文档中应含有相关文档/Story ID 链接以及 QA 验收人。

## 7. 自动化脚本

| 命令 | 功能 |
|------|------|
| `npm run task:lint` | 校验模块 TASK 结构、Task ID、依赖矩阵、Story→Task 映射 |
| `npm run task:check-cycles` | 检查模块与跨模块依赖中的环路与资源冲突 |
| `npm run task:sync` | 同步 `module-list.md`、`story-task-mapping.md`、依赖表与 traceability 记录 |
| `npm run task:generate` | 生成任务卡片/里程碑表、可选 WBS 拆解初稿 |
| `/tdd tick` | 自动勾选模块/主 TASK 中完成的任务，确保 AGENT_STATE/QA 交付状态更新 |

## 8. 相关资源

- `/docs/TASK.md` — 主 TASK 总纲与模块索引
- `/docs/task-modules/README.md` — 模块化指南与标准流程
- `/docs/data/task-dependency-matrix.md` — 跨模块依赖矩阵
- `/docs/data/story-task-mapping.md` — Story → Task 映射
- `/docs/data/traceability-matrix.md` — Story → AC → Test Case 跟踪
- `/docs/data/milestone-gantt.md` — 里程碑甘特图
- `/docs/AGENT_STATE.md` + `/AGENTS.md` — 状态阶段与 Agent 阶段职责
- `/docs/CONVENTIONS.md` — 命名、Task ID、里程碑/模块目录规范
- `scripts/task-tools/*` 与 `package.json` 中的 `task:*` 命令（`task:lint`/`task:check-cycles`/`task:sync`/`task:generate`）以及 `/tdd tick`
- `AgentRoles/TASK-PLANNING-EXPERT.md` 与 Handbook — 角色责任、DoD、自检清单
---


## Appendix A: TASK 模块模板
> 以下内容不允许 TASK 专家自动修改，只能由人工修改。

# {功能域名称} - 任务计划
>
>
> **所属功能域**：[PRD 链接] | [ARCH 链接]
> **负责团队**：@team
> **状态**：📝/🚀/✔️/🔄/⏸️/❌
> **AGENT_STATE Gate**：`TASK_PLANNED` → `TDD_DONE` → `QA_VALIDATED`
> **Story→Task ID**：列出 `US-...` / `TASK-...` / `TC-...` 并注明主 TASK 对应章节
> **最后更新**：YYYY-MM-DD
>
## 1. 模块概述
- 业务目标、核心交付、技术范围、关键交付物
- 关联 Story/PRD/ARCH/Task 链接
- 交付产物列表（代码/文档/部署/演练）

## 2. WBS（工作分解结构）
### 2.1 任务列表
| Task ID | 名称 | 负责人 | 工时 | 优先级 | 前置任务 | 状态 | 完成日期 |
|---------|------|--------|-----|--------|---------|------|---------|
| TASK-{MODULE}-001 | 核心 API | @dev | 3d | P0 | - | 📝 | - |

### 2.2 任务详细说明
- 描述（对应 Story/PRD）、输入（PRD/ARCH/设计）、输出（代码/文档/测试）、验收标准（Given-When-Then）、依赖说明
- 验收例：``Given ... When ... Then ...``

## 3. 依赖矩阵（模块内）
- 表格：`| 任务 | 依赖 | 类型 | 说明 |`
- 同步 `task-dependency-matrix.md` 与主 TASK 关键路径

## 4. 资源分配
- 表格：`| 角色 | 人员 | 分配比例 | 时间段 | 备注 |`
- 标注备份与技能要求

## 5. 里程碑
- 表格：`| 里程碑 | 目标日期 | 交付物 | 验收标准 | Gate | 状态 |`
- Gate 示例：`PRD_CONFIRMED` → `ARCHITECTURE_DEFINED`

## 6. Story → Task 映射
| Story ID | AC ID | Task ID | Test Case ID | QA | 状态 |
|----------|-------|---------|--------------|-----|------|
| US-{MODULE}-001 | AC-{MODULE}-001-01 | TASK-{MODULE}-004 | TC-{MODULE}-001 | @qa | ✅ |
- 是否同步 `traceability-matrix.md` / `story-task-mapping.md`

## 7. 风险登记
- 表格：`| 风险 | 影响 | 缓解 | 负责人 | 状态 |`
- 标注是否同步 `risk-register.md`

## 8. 数据库迁移任务
- Expand / Migrate / Contract 表格（含幂等性、回滚、验证）

## 9. 技术债务与约束
- 描述技术债务、约束条件、影响版本

## 10. 变更记录
- 表格：`| 版本 | 日期 | 描述 | 负责人 |`

## 11. 自检与 Gate 清单
- [ ] 执行 `npm run task:lint`、`task:check-cycles`、`task:sync`
- [ ] 同步 `module-list.md`、`traceability-matrix.md`、`story-task-mapping.md`
- [ ] 通知 ARCH/TDD/QA（接口、依赖、风险、验证）
- [ ] 工作态更新至 `/docs/AGENT_STATE.md`
