# TASK 模块化结构指南

> 版本：v1.0
> 更新：2025-11-06

---

## 一、模块内部结构

### 1.1 基础结构（必需）

```
task-modules/
  {domain}/
    TASK.md                       # 模块任务计划（必需）
```

**说明**：
- `TASK.md` 是模块任务计划的核心文件，包含所有必需章节
- 使用 [MODULE-TEMPLATE.md](MODULE-TEMPLATE.md) 创建新模块

---

### 1.2 增强结构（WBS > 15 个时推荐）

```
task-modules/
  {domain}/
    TASK.md                       # 模块任务计划（必需）
    wbs-breakdown.md              # WBS 详细分解（推荐，WBS > 15 个时）
    dependency-graph.mmd          # 模块内依赖图（推荐，Mermaid 格式）
    resource-plan.md              # 资源分配计划（可选，资源复杂时）
    risk-register.md              # 模块风险登记（推荐，有关键风险时）
```

**文件创建时机**：

| 文件 | 创建时机 | 必需性 |
|------|---------|--------|
| `TASK.md` | 模块创建时 | ✅ 必需 |
| `wbs-breakdown.md` | WBS > 15 个 | ⚠️ 推荐 |
| `dependency-graph.mmd` | 依赖复杂（> 10 个） | ⚠️ 推荐 |
| `resource-plan.md` | 3+ 团队并行 | 📝 可选 |
| `risk-register.md` | 有关键风险 | ⚠️ 推荐 |

---

## 二、与全局数据的协作关系

### 2.1 全局数据文件

```
docs/
  data/
    task-dependency-matrix.md     # 跨模块依赖矩阵
    critical-path.md              # 全局关键路径分析
    story-task-mapping.md         # Story → Task 映射表
    milestone-gantt.mmd           # 里程碑甘特图
```

### 2.2 数据分层原则

| 数据类型 | 存放位置 | 维护者 | 引用方式 |
|---------|---------|--------|---------|
| **模块内依赖** | `{domain}/dependency-graph.mmd` | 模块负责人 | 模块 TASK 引用 |
| **跨模块依赖** | `/data/task-dependency-matrix.md` | TASK 专家 | 主 TASK 引用 |
| **模块风险** | `{domain}/risk-register.md` | 模块负责人 | 模块 TASK 引用 |
| **全局风险** | 主 TASK 第 7 章 | TASK 专家 | - |
| **Story → Task 映射** | `/data/story-task-mapping.md` | TASK 专家 | 全局共享 |

---

## 三、模块工作流

### 3.1 创建新模块

```bash
# 1. 创建模块目录
mkdir -p docs/task-modules/user-management

# 2. 复制模板
cp docs/task-modules/MODULE-TEMPLATE.md docs/task-modules/user-management/TASK.md

# 3. 填写内容
# 编辑 user-management/TASK.md，替换占位符

# 4. 验证
npm run task:lint
npm run task:check-cycles
```

### 3.2 更新模块

1. **修改模块 TASK**：编辑 `{domain}/TASK.md`
2. **同步主 TASK**：更新主 TASK 的"模块任务索引"表
3. **更新全局数据**：
   - 跨模块依赖 → 更新 `/data/task-dependency-matrix.md`
   - Story 映射 → 更新 `/data/story-task-mapping.md`
4. **工具验证**：
   ```bash
   npm run task:lint
   npm run task:check-cycles
   npm run task:sync
   ```

---

## 四、ID 命名规范

### 4.1 Task ID 格式

```
TASK-{MODULE}-{序号}
```

**示例**：
- `TASK-USER-001` — 用户管理模块第 1 个任务
- `TASK-PAY-005` — 支付系统模块第 5 个任务
- `TASK-DB-001-EXPAND` — 数据库迁移任务（Expand 阶段）

**规则**：
- `{MODULE}` 必须大写，与 PRD/ARCH 模块前缀一致
- `{序号}` 使用 3 位数字（001-999）
- 特殊任务可添加后缀（如 `-EXPAND`、`-MIGRATE`）

### 4.2 模块目录命名

```
task-modules/{domain}/
```

**规则**：
- `{domain}` 使用 kebab-case（小写，连字符分隔）
- 与 PRD/ARCH 模块目录名保持一致

**示例**：
- `user-management/` → TASK-USER-*
- `payment-system/` → TASK-PAY-*
- `analytics-service/` → TASK-ANALYTICS-*

---

## 五、常见问题

### Q1: 模块如何划分边界？
**A**: 与 PRD 和 ARCH 模块保持一致。如果 PRD 按 `user-management`、`payment-system` 拆分，TASK 必须遵循相同边界。

### Q2: 模块内依赖 vs 跨模块依赖？
**A**:
- **模块内**：同一模块的任务依赖 → 维护在 `{domain}/dependency-graph.mmd`
- **跨模块**：不同模块的任务依赖 → 维护在 `/data/task-dependency-matrix.md`

### Q3: 何时拆分模块？
**A**: 满足以下任一条件：
- 主 TASK 文档 > 1000 行
- WBS > 50 个
- 3+ 并行开发流
- 项目周期 > 6 个月

### Q4: 模块 TASK 与主 TASK 如何同步？
**A**: 主 TASK 仅维护"模块任务索引"表（第 2 章），不重复模块细节。模块 TASK 包含完整详细任务。

---

## 六、参考资料

- [TASK 模块模板](MODULE-TEMPLATE.md)
- [主 TASK 文档](../TASK.md)
- [CONVENTIONS.md](../CONVENTIONS.md) - §TASK 模块化规范
- [AGENTS.md](../../AGENTS.md) - Phase 3: TASK 规划专家

---

> 本指南遵循 AGENTS.md 的模块化规范，确保 PRD/ARCH/TASK 三者边界一致。
