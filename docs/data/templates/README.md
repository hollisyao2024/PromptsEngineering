# 模板文件使用说明

> 本目录存放各专家的文档模板，供大模型或开发者快速生成结构化文档。

## 目录结构

```
templates/
├── prd/                # PRD 专家模板
├── arch/               # ARCH 专家模板
├── task/               # TASK 专家模板
├── qa/                 # QA 专家模板
└── devops/             # DevOps 专家模板
```

---

## PRD 专家模板（`prd/`）

| 模板文件 | 用途 | 使用场景 |
|---------|------|---------|
| `PRD-TEMPLATE-SMALL.md` | 小型项目主 PRD 模板 | 用户故事 < 20，单一业务域 |
| `PRD-TEMPLATE-LARGE.md` | 大型项目主 PRD 模板 | 用户故事 > 50，多业务域 |
| `UX-SPECIFICATIONS-TEMPLATE.md` | UX 规范文档模板 | 有前端界面的项目 |
| `PERSONA-STORY-MATRIX-TEMPLATE.md` | 角色-故事矩阵模板 | 验证功能覆盖完整性 |
| `TRACEABILITY-MATRIX-TEMPLATE.md` | 追溯矩阵模板 | Story → AC → Test Case 映射 |
| `DEPENDENCY-GRAPH-TEMPLATE.md` | 跨模块依赖图模板 | 多模块项目，识别协作点 |
| `NFR-TRACKING-TEMPLATE.md` | 非功能需求追踪表模板 | 量化 NFR（性能/安全/可用性） |
| `PRIORITY-MATRIX-TEMPLATE.md` | 优先级矩阵模板 | Story 优先级评估 |

**注意**：
- 模块级 PRD 文档使用 `/docs/prd-modules/MODULE-TEMPLATE.md`（核心模板，非本目录）
- PRD 拆分条件：主 PRD > 1000 行 ｜ 用户故事 > 50 个 ｜ 业务域 > 3

---

## ARCH 专家模板（`arch/`）

| 模板文件 | 用途 | 使用场景 |
|---------|------|---------|
| `ARCH-TEMPLATE-SMALL.md` | 小型项目架构文档模板 | 单体应用，简单架构 |
| `ARCH-TEMPLATE-LARGE.md` | 大型项目架构文档模板 | 微服务/分布式，复杂架构 |
| `ERD-TEMPLATE.md` | 实体关系图模板 | 数据库设计，数据模型 |
| `dictionary-TEMPLATE.md` | 数据字典模板 | 字段定义、枚举值说明 |
| `COMPONENT-DEPENDENCY-GRAPH-TEMPLATE.md` | 组件依赖图模板 | 模块间依赖关系 |
| `GLOBAL-DEPENDENCY-GRAPH-TEMPLATE.md` | 全局依赖图模板 | 跨模块依赖总览 |
| `GOAL-STORY-MAPPING-TEMPLATE.md` | 业务目标映射模板 | Story 与 OKR 关联 |
| `ARCH-PRD-TRACEABILITY-TEMPLATE.md` | 架构-需求追溯模板 | Component ID ↔ Story ID |

**注意**：
- 模块级 ARCH 文档使用 `/docs/arch-modules/MODULE-TEMPLATE.md`
- ADR（架构决策记录）使用 `/docs/adr/` 目录单独管理

---

## TASK 专家模板（`task/`）

| 模板文件 | 用途 | 使用场景 |
|---------|------|---------|
| `TASK-TEMPLATE-SMALL.md` | 小型项目任务规划模板 | 单人/小团队，简单项目 |
| `TASK-TEMPLATE-LARGE.md` | 大型项目任务规划模板 | 多团队并行，复杂项目 |
| `TASK-DEPENDENCY-MATRIX-TEMPLATE.md` | 任务依赖矩阵模板 | WBS 任务依赖关系 |

**注意**：
- 模块级 TASK 文档使用 `/docs/task-modules/MODULE-TEMPLATE.md`
- 任务 ID 规范：`TASK-<DOMAIN>-<序号>`（如 `TASK-USER-001`）

---

## QA 专家模板（`qa/`）

| 模板文件 | 用途 | 使用场景 |
|---------|------|---------|
| `QA-TEMPLATE-SMALL.md` | 小型项目 QA 文档模板 | 简单测试策略 |
| `QA-TEMPLATE-LARGE.md` | 大型项目 QA 文档模板 | 复杂测试策略，多层次测试 |
| `TEST-STRATEGY-MATRIX-TEMPLATE.md` | 测试策略矩阵模板 | 测试类型、覆盖范围 |
| `TEST-PRIORITY-MATRIX-TEMPLATE.md` | 测试优先级矩阵模板 | P0/P1/P2 测试用例分级 |
| `TEST-RISK-MATRIX-TEMPLATE.md` | 测试风险矩阵模板 | 风险识别、缓解措施 |
| `DEFECT-LOG-TEMPLATE.md` | 缺陷日志模板 | 缺陷跟踪、修复记录 |
| `NFR-VALIDATION-TEMPLATE.md` | NFR 验证模板 | QA 阶段验证非功能需求 |
| `PRIORITY-MATRIX-TEMPLATE.md` | 优先级矩阵模板 | 测试用例优先级 |

**注意**：
- 模块级 QA 文档使用 `/docs/qa-modules/MODULE-TEMPLATE.md`
- QA 报告归档到 `/docs/data/qa-reports/`

---

## DevOps 专家模板（`devops/`）

| 模板文件 | 用途 | 使用场景 |
|---------|------|---------|
| `ENVIRONMENT-CONFIG-TEMPLATE.md` | 环境配置文档模板 | dev/staging/prod 环境说明 |
| `DEPLOYMENT-RECORD-TEMPLATE.md` | 部署记录模板 | 每次部署的详细记录 |
| `DEPLOYMENT-README-TEMPLATE.md` | 部署说明文档模板 | 部署流程、操作手册 |
| `CI-WORKFLOW-TEMPLATE.yml` | CI 流水线模板 | GitHub Actions/GitLab CI |

**注意**：
- 部署记录归档到 `/docs/data/deployment-records/`
- 命名规范：`YYYY-MM-DD-vX.Y.Z-<env>.md`

---

## 使用指南

### 1. 选择合适的模板

**项目规模判断**：
- **小型项目**：单一业务域，< 20 个 Story，单人/小团队 → 使用 `*-TEMPLATE-SMALL.md`
- **大型项目**：多业务域，> 50 个 Story，多团队并行 → 使用 `*-TEMPLATE-LARGE.md`

### 2. 复制模板

**手动复制**：
```bash
# 创建主 PRD
cp docs/data/templates/prd/PRD-TEMPLATE-SMALL.md docs/PRD.md

# 创建模块级 PRD
cp docs/prd-modules/MODULE-TEMPLATE.md docs/prd-modules/user-management/PRD.md
```

**脚本生成**：
```bash
# PRD 专家使用 prd:lint 脚本校验
pnpm run prd:lint

# ARCH 专家使用 arch:lint 脚本校验
pnpm run arch:lint
```

### 3. 填充内容

- 按照模板中的章节结构填充内容
- 删除不适用的章节（标注 `[可选]` 的部分）
- 保留所有必需章节（标注 `[必需]` 的部分）

### 4. 跨专家协作

```
PRD 模板 → PRD.md
  ↓
ARCH 模板 → ARCH.md （引用 PRD 中的 Story ID）
  ↓
TASK 模板 → TASK.md （引用 ARCH 中的 Component ID）
  ↓
QA 模板 → QA.md （引用 TASK 中的任务 ID）
  ↓
部署记录模板 → deployment-records/YYYY-MM-DD-vX.Y.Z-<env>.md
```

---

## 模板命名规范

### 文件命名
- **主模板**：`{DOCTYPE}-TEMPLATE-{SIZE}.md`（如 `PRD-TEMPLATE-SMALL.md`）
- **辅助模板**：`{PURPOSE}-TEMPLATE.md`（如 `ERD-TEMPLATE.md`）

### 大小写规范
- 全部使用大写字母和连字符
- 文件扩展名小写：`.md`、`.yml`

### 常见错误
- ❌ `TEMPLATE` 拼写错误为 `TMPLATE` 或 `TEMPALTE`
- ❌ 使用下划线 `_` 而非连字符 `-`
- ❌ 混合大小写 `Template` 而非 `TEMPLATE`

---

## 模板更新规范

### 何时更新模板
1. 发现通用性问题（多个项目都需要的章节）
2. 框架升级（如 AGENTS.md v2.0 变更）
3. 最佳实践变化（如引入新的测试策略）

### 如何更新模板
1. 在 `/docs/adr/` 创建 ADR 记录模板变更原因
2. 更新模板文件
3. 在 `/CHANGELOG.md` 记录变更
4. 通知所有使用该框架的项目

### 版本管理
- 模板文件本身不含版本号
- 通过 Git 历史追溯模板演进
- 重大变更时在 `AGENTS.md` 头部更新 `version` 字段

---

## 常见问题

### Q1: 模块级模板在哪里？
**A**: 模块级模板（`MODULE-TEMPLATE.md`）在核心产出目录，不在本 `templates/` 目录：
- PRD 模块模板：`/docs/prd-modules/MODULE-TEMPLATE.md`
- ARCH 模块模板：`/docs/arch-modules/MODULE-TEMPLATE.md`
- TASK 模块模板：`/docs/task-modules/MODULE-TEMPLATE.md`
- QA 模块模板：`/docs/qa-modules/MODULE-TEMPLATE.md`

### Q2: 如何选择 SMALL vs LARGE 模板？
**A**: 参考决策表：

| 维度 | SMALL | LARGE |
|------|-------|-------|
| Story 数量 | < 20 | > 50 |
| 业务域 | 1 个 | 3+ 个 |
| 团队规模 | 1-3 人 | 5+ 人 |
| 项目周期 | < 2 个月 | > 6 个月 |
| 架构复杂度 | 单体应用 | 微服务 |

### Q3: 模板是否强制使用？
**A**: 分情况：
- **大模型生成文档**：强制使用模板，确保结构一致性
- **人工编写文档**：推荐使用模板，但可根据项目实际情况调整
- **跨专家协作**：必须遵循模板中的 ID 规范（如 Story ID、Component ID）

### Q4: 如何处理模板冲突？
**A**: 如果项目已有自定义模板：
1. 优先使用项目自定义模板
2. 从框架模板中挑选缺失的章节补充
3. 确保 ID 规范与框架一致（便于工具解析）

---

## 相关文档

- [AGENTS.md](../../../AGENTS.md) - 框架总体规范
- [CONVENTIONS.md](../../CONVENTIONS.md) - 文档规范与最佳实践
- [目录职责规范](../../../AGENTS.md#文档目录职责规范) - `*-modules/` vs `data/` 的区别

---

> 本目录由 AGENTS.md 框架维护，所有模板遵循统一的结构和命名规范。
