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
- 状态：📝 待开始 / 🚀 进行中 / 🔄 已提交 / ✅ 已完成 / ⏸️ 暂停 / ❌ 已取消。
- 优先级：P0（阻塞发布）→ P1（重要）→ P2（增值）→ P3（可延后）。

## 2. 模块清单模板

TASK 专家在创建或更新模块时须同步更新以下清单：

| 模块名称 | 文件路径 | 负责团队 | 对应 PRD 模块 | 对应 ARCH 模块 | 状态 | 最后更新 |
|---------|---------|---------|--------------|---------------|------|---------|
| 示例：用户管理 | [TASK.md](user-management/TASK.md) | @team-backend | [prd-modules/user-management/PRD.md](../prd-modules/user-management/PRD.md) | [arch-modules/user-management/ARCH.md](../arch-modules/user-management/ARCH.md) | ✅ 已确认 | 2025-11-05 |
| 示例：支付系统 | [TASK.md](payment-system/TASK.md) | @team-payment | [prd-modules/payment-system/PRD.md](../prd-modules/payment-system/PRD.md) | [arch-modules/payment-system/ARCH.md](../arch-modules/payment-system/ARCH.md) | 🔄 进行中 | 2025-11-05 |
| （待补充） | - | - | - | - | - | - |

**状态说明**：
- 📝 待开始（已规划但尚未启动）
- 🚀 进行中（正在开发或执行）
- 🔄 已提交（代码/变更已提交，待验证）
- ✅ 已完成（验证通过并已发布）
- ⏸️ 暂停（因依赖或资源问题暂缓）
- ❌ 已取消（调整范围或无需实施）

该表格仅作为模板，实际模块清单信息由 TASK 专家根据以上表格生成到`module-list.md`，每次 TASK 模块变化都更新`module-list.md`。

## 3. 标准模块 ARCH 结构

`{domain}/TASK.md` 根据模板创建，模板见本文件 § Appendix A: TASK 模块模板。
- 每次更新需记录 `最后更新` 时间戳
- 重大变更需在主 TASK 的“变更记录”章节同步

## 4. 支撑产物说明
- **组件/服务清单**：记录模块可交付的服务、数据库、缓存、任务等组件，包含 ID、职责、技术栈、部署环境、SLO 与负责人，便于同步 `component-dependency-graph.md` 及大项目的组件依赖表。
- **接口契约矩阵**：集中描述模块提供与依赖的 API/gRPC/Event 接口（路径/方法、输入输出、错误码、版本、SLA、降级策略），并标明覆盖的 PRD Story ID，支持 `arch-prd-traceability.md` 与 TASK 的接口依赖核对。
- **数据资产表**：列出核心实体/表、字段摘要、索引策略、事务边界、容量/留存/增长、脱敏与备份流程，作为 `/docs/data/ERD.md` 与 `dictionary.md` 的数据原件。
- **风险与验证表**：列出架构验证前置中识别的技术、合规、性能、依赖风险（描述、影响、缓解、责任人、状态），并引用对应 ADR（`NNN-arch-{module}-{decision}.md`），确保 Gate review 有据可查。
- **Story/Component 追溯表**：将 Story ID、Component/Interface/Module 功能点、状态、是否已落地于 ARCH、需补充 ADR/接口等列出，方便 `arch-prd-traceability` 自动或手工比对差异。

## 5. 模块协作规范

### 5.1 跨模块依赖管理
- **同步调用**：REST/gRPC 在主 ARCH 跨模块依赖章节维护。
- **异步消息**：消息队列、事件总线等在主 ARCH 依赖章节说明。
- **接口契约**：模块接口在本章详细说明，主 ARCH 维护跨模块表格。

### 5.3 ADR 命名规范
- **模块级 ADR**：`/docs/adr/NNN-arch-{module}-{decision}.md`
  - 示例：`NNN-arch-user-oauth-provider-selection.md`
- **全局级 ADR**：`NNN-arch-global-{decision}.md`
  - 示例：`NNN-arch-global-api-gateway-selection.md`
- **ADR 版本变更记录**：`NNN-arch-global-{decision}.md`
  - 在`/docs/adr/CHANGELOG.md` 记录版本变更与影响范围。

## 6. 维护与文件时机

### 6.1 ARCH 专家职责
1. 以模块 PRD + 全局 ARCH 为输入生成模块 ARCH 文档（`{domain}/ARCH.md`），覆盖 C4/运行时/数据/接口/运维/安全视图，并在文档中嵌入本模板定义的模块级数据表格。
2. 维护模块索引（`module-list.md`）、组件/服务清单、接口矩阵、数据资产表等支撑产物，确保每个表与 `/docs/data/` 下的组件依赖图、ERD、追溯报告保持同步。
3. 捕捉模块级风险与 ADR，对重大架构取舍形成 `NNN-arch-{module}-{decision}.md` 并在主 ARCH 及模块文档中标注，便于 Gate 验证与回溯。
4. 与 PRD、TASK、QA 协同：核对 Stories → Components → ARCH 路径、对应 TASK 依赖/里程碑，支持 QA 的接口/数据/风险验证。

### 6.2 与其他专家协作
- **PRD**：确认模块边界、Story/AC 清单与质量属性，提供追溯数据；ARCH 反馈组件/接口 ID 以完善 `arch-prd-traceability`。
- **TASK**：提供模块级接口/数据/风险信息供任务拆解，及时更新依赖/关键路径表格。
- **TDD/QA**：共享接口契约、数据视图、验证表，协助形成闭环的 Story → Test Case → ARCH 追溯。

### 6.3 版本管理
- 模块 ARCH 文档每次更新需记录“最后更新”与责任人；新增/变更组件、接口、数据产物时同步更新相应 `/docs/data/` 文件。
- 重大架构变更必须产出 ADR（`NNN-arch-{module}-{decision}.md` 或 `NNN-arch-global-{decision}.md`）并在主 ARCH、模块文档及 `/docs/adr/CHANGELOG.md` 中说明影响。

### 6.4 文件创建与更新时机
- ARCH 模块化启动：在 PRD 确定拆分后立即创建 `{domain}/ARCH.md`、组件清单、接口契约与支持表格，且在 `module-list.md` 中注册。
- 开发前：完成数据资产、风险/验证、Story/Component 追溯表格，并同步 `arch-prd-traceability` 及依赖图；如发现未覆盖 Story/Component，立刻补充 ARCH 或 ADR。
- 持续迭代：每个 Sprint 更新接口契约、数据表与风险表，并在回写 Gate 中核对 `component-dependency-graph` 与 `ERD` 的一致性。

## 7. 自动化脚本

| 命令 | 功能 |
|------|------|
| `npm run prd:lint` | 校验主/模块 PRD 结构、Story/AC 格式、Given-When-Then 规范 |
| `npm run prd:check-dependency-cycles` | 检测模块与全局依赖循环、无效引用 |
| `npm run nfr:check-compliance` | 汇总模块 `nfr-tracking.md`，生成发布 Gate 报告（阻塞/警告/待验证） |

## 8. 相关资源

- `/AGENTS.md` — 角色路由规范与状态机
- `/docs/CONVENTIONS.md` — 目录与产物规范
- `/AgentRoles/Handbooks/PRD-WRITER-EXPERT.playbook.md` — 角色手册（包含核心流程与 Shift-Left 检查）
- `/docs/data/traceability-matrix.md` — 全局 Story → AC → Test Case 映射

---


## Appendix A: TASK 模块模板
> 以下内容不允许 TASK 专家自动修改，只能由人工修改。

```markdown
# {模块名称} 任务计划
>
> **所属功能域**：[PRD 链接] | [ARCH 链接]
> **负责团队**：@team
> **状态**：📝/🚀/✔️
> **最后更新**：YYYY-MM-DD

## 1. 模块概述
- 业务目标、核心交付、技术范围、关键交付物

## 2. WBS（工作分解结构）
### 2.1 任务列表
| Task ID | 名称 | 负责人 | 工时 | 优先级 | 前置任务 | 状态 | 完成日期 |
|---------|------|--------|-----|--------|---------|------|---------|

### 2.2 任务详细说明
- 描述（对应 Story/PRD）、输入（PRD/ARCH/设计）、输出（代码/文档/测试）、验收标准（Given-When-Then）、依赖说明

## 3. 依赖矩阵（模块内）
- 列出 FS/SS/FF 等依赖类型与备注

## 4. 资源分配
- 角色/人员、分配比例、时间段、备注

## 5. 里程碑
- 模块级 Milestone 与目标日期、交付物、验收标准

## 6. Story → Task 映射
- Story ID、对应 Task、状态

## 7. 风险登记
- 风险/影响/缓解/负责人/状态

## 8. 数据库迁移任务
- Expand / Migrate / Contract 表格，记录幂等性与回滚

## 9. 技术债务与约束
- 技术债务列表、约束说明

## 10. 变更记录
- 版本、日期、变更描述、负责人
```

以上内容源自原 `MODULE-TEMPLATE.md`，已融入此 README。可复制本结构到新模块，也可以在目录下维护 `wbs-breakdown.md` / `dependency-graph.md` / `resource-plan.md` / `risk-register.md` 等补充文件（当 WBS >15、依赖复杂、资源/风险突出时推荐创建）。

---

## 模块创建与维护工作流

1. 创建目录：`mkdir -p docs/task-modules/{domain}`。
2. 复制基础模板：`cp docs/task-modules/MODULE-TEMPLATE.md docs/task-modules/{domain}/TASK.md`（现为 README 所述结构）。
3. 填写内容：替换占位符、填写 Story/Task/里程碑/风险。
4. 更新主 TASK：同步“模块任务索引”表。
5. 更新全局数据：
   - `/docs/data/task-dependency-matrix.md`（跨模块依赖）
   - `/docs/data/story-task-mapping.md`（Story → Task）
6. 验证工具：
   ```bash
   npm run task:lint
   npm run task:check-cycles
   npm run task:sync
   ```

更新模块时反向同步：改动模块 TASK → 更新主 TASK → 更新数据文件 → 触发 lint/检查。

---

## 与全局数据协作

| 数据类型 | 存放位置 | 维护者 | 引用方式 |
|---------|---------|--------|---------|
| 模块内依赖 | `{domain}/dependency-graph.md` | 模块负责人 | 模块 TASK 引用 |
| 跨模块依赖 | `/docs/data/task-dependency-matrix.md` | TASK 专家 | 主 TASK/模块索引 |
| 模块风险 | `{domain}/risk-register.md` | 模块负责人 | 模块 TASK |
| 全局风险 | 主 TASK 第 7 章 | TASK 专家 | - |
| Story → Task 映射 | `/docs/data/story-task-mapping.md` | TASK 专家 | 全局共享 |
| 里程碑甘特 | `/docs/data/milestone-gantt.md` | TASK 专家 | 可视化看板 |

## 示例补充文件（按需创建）

- `wbs-breakdown.md`（WBS > 15 个时细化）
- `dependency-graph.md`（Mermaid 组件依赖图）
- `resource-plan.md`（多团队/多技能时的资源分配）
- `risk-register.md`（关键风险集中登记）

---



## 参考资料

- TASK 模块模板（已迁移至本 README）
- 主 TASK：`/docs/TASK.md`
- 目录规范：`/docs/CONVENTIONS.md`
- AGENTS 状态流程：`/AGENTS.md`

> 新模块可参考本 README 中的结构，避免再造轮子。若未来需要再拆分，可在模块目录创建额外的支持文件。
