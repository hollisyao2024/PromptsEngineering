# 任务模块化指南与索引

> 该目录存放按功能域拆分的模块 TASK 文档。主 TASK (`/docs/TASK.md`) 演化为总纲与索引，模块目录则承载详细拆分。本文档聚合模板、结构指南与运行步骤，供 TASK 专家参考。

**维护者**：TASK 专家  
**创建日期**：2025-11-05  
**模板版本**：v1.8（包含本 README 中嵌入的结构与样例）

> 原 `MODULE-TEMPLATE.md` 与 `STRUCTURE-GUIDE.md` 的内容已合并到本文件，并作为 `.backup` 保留。

---

## 何时需要模块化拆分？
当项目满足任一条件，建议从主 TASK 拆分出模块：

1. 主 TASK 文档超过 1000 行
2. WBS 数量超过 50 个
3. 存在 3+ 个并行开发流（多团队/多模块）
4. 项目周期超过 6 个月，需阶段性交付
5. 跨模块依赖复杂（10+ 条）

小型项目（< 20 个任务，单一团队）可继续维护单一 `/docs/TASK.md`。

---

## 命名与 ID 规范

### 模块文件与目录
- 文件模板：`task-modules/{domain}/TASK.md`（`{domain}` 使用 kebab-case，与 PRD/ARCH 模块名保持一致）。
- 示例：`task-modules/user-management/TASK.md`、`task-modules/payment-system/TASK.md`。

### Task ID
- 格式：`TASK-{MODULE}-{序号}`（3 位数字或附加后缀）。例如：
  - `TASK-USER-001`（用户管理第 1 个任务）
  - `TASK-PAY-005`（支付功能第 5 个任务）
  - `TASK-DB-001-EXPAND`（数据库迁移的 Expand 阶段）

### 里程碑 ID
- 格式：`M{序号}-{简短描述}`（如 `M1-MVP`、`M2-Beta`、`M3-GA`）。

### 状态与优先级
- 状态标识：📝 待开始 / 🚀 进行中 / 🔄 已提交 / ✅ 已完成 / ⏸️ 暂停 / ❌ 已取消。
- 优先级：P0（阻塞发布）→ P1（重要）→ P2（增值）→ P3（可延后）。

---

## 模块清单（索引）

TASK 专家在创建或更新模块时须同步更新以下清单：

| 模块名称 | 文件路径 | 负责团队 | 对应 PRD 模块 | 对应 ARCH 模块 | 状态 | 最后更新 |
|---------|---------|---------|--------------|---------------|------|---------|
| 示例：用户管理 | [user-management.md](user-management.md) | @team-backend | [prd-modules/user-management.md](../prd-modules/user-management.md) | [arch-modules/user-management.md](../arch-modules/user-management.md) | ✅ 已确认 | 2025-11-05 |
| 示例：支付系统 | [payment-system.md](payment-system.md) | @team-payment | [prd-modules/payment-system.md](../prd-modules/payment-system.md) | [arch-modules/payment-system.md](../arch-modules/payment-system.md) | 🔄 进行中 | 2025-11-05 |
| （待补充） | - | - | - | - | - | - |

**状态说明**：✅ 已确认；🔄 进行中；📝 待启动；🚀 执行中；✔️ 已完成。

---

## 模块 TASK 文档标准结构

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

## 常见问题

### Q1: 如何划分模块边界？
与 PRD/ARCH 模块保持一致，名称、聚合范围需同步，各模块仅负责自己的核心交付。

### Q2: 模块内依赖 vs 跨模块依赖？
- 模块内依赖写入 `{domain}/dependency-graph.md`（Mermaid）。
- 跨模块依赖写入 `/docs/data/task-dependency-matrix.md`。

### Q3: 何时拆分模块？
满足前述任一拆分条件即可；若不满足，主 TASK 保持单一文档。

### Q4: 模块与主 TASK 如何同步？
主 TASK 只维护“模块任务索引”表；模块 TASK 担任详细任务。每次模块更新都要同步状态与依赖到主 TASK/数据文件。

---

## 参考资料

- TASK 模块模板（已迁移至本 README）
- 主 TASK：`/docs/TASK.md`
- 目录规范：`/docs/CONVENTIONS.md`
- AGENTS 状态流程：`/AGENTS.md`

> 新模块可参考本 README 中的结构，避免再造轮子。若未来需要再拆分，可在模块目录创建额外的支持文件。
