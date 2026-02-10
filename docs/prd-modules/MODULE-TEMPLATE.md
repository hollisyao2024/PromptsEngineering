# 模块 PRD 文档模板

> 本文档整合了模块目录约定、模板结构、协作规范与自动化脚本，是模块化需求治理的唯一权威参考。
>
> 拆分后各模块 `/docs/prd-modules/{domain}/PRD.md` 均按此模板生成，并在开头引用主 `/docs/PRD.md`。
> 完整填充示例见 `/docs/prd-modules/MODULE-EXAMPLE.md`（用户管理域）。

**维护者**：PRD 专家
**模板版本**：v1.0
**功能域**：{domain}（复制模板时替换为具体模块名称）

---

## 1. 目录与命名规范

### 1.1 模块目录结构

```
/docs/
└── prd-modules/
    ├── MODULE-TEMPLATE.md # 本模板（权威）
    ├── module-list.md # 模块清单
    └── {domain}/
        ├── PRD.md （模块 PRD 文档）
        ├── dependency-graph.md （模块依赖图，Story > 10 时创建）
        ├── nfr-tracking.md （模块 NFR 追踪表）
        ├── priority-matrix.md （模块优先级矩阵，可选）
        └── ux-specifications.md （模块 UX 规范，可选）
```

**文件说明**：
| 文件 | 用途 | 创建时机 |
|------|------|---------|
| `PRD.md` | 模块 PRD 文档 | 拆分初期必建 |
| `dependency-graph.md` | 可视化模块内 Story 依赖（Mermaid），参照 `DEPENDENCY-GRAPH-TEMPLATE.md` 生成 | Story > 10 或依赖复杂 |
| `nfr-tracking.md` | 量化 NFR（ID/Story/目标值/验证/状态/负责人），参照 `NFR-TRACKING-TEMPLATE.md` 生成 | 有关键 NFR 时 |
| `priority-matrix.md` | 量化评分模型调整优先级，参照 `PRIORITY-MATRIX-TEMPLATE.md` 生成 | 优先级冲突或资源紧张 |
| `ux-specifications.md` | 模块级 UX 规范，参照 `/docs/data/templates/prd/UX-SPECIFICATIONS-TEMPLATE.md` 生成 | 有前端界面时 |

### 1.2 命名与 ID

- **模块目录**：`{domain}` 使用 kebab-case（如 `user-management`），与主 PRD 功能域索引一致
- **Story ID**：`US-{MODULE}-{序号}`（如 `US-USER-001`）
- **验收标准 ID**：`AC-{MODULE}-{Story序号}-{AC序号}`（如 `AC-USER-001-01`）
- **测试用例 ID**：`TC-{MODULE}-{序号}`（如 `TC-REG-001`）
- **状态**：📝 待启动 ｜ 🔄 进行中 ｜ ✅ 已确认 ｜ ❌ 已废弃
- **优先级**：P0（阻塞发布）→ P1（重要）→ P2（增值）→ P3（可延后）

## 2. 模块清单模板

| 模块名称 | 优先级 | 负责团队 | 文件链接 | 状态 |
|---------|--------|---------|----------|------|
| （待添加） | - | - | - | - |

实际模块清单由 PRD 专家生成到 `module-list.md`。每次拆分、状态变更或交付调整，同步更新 `module-list.md` 并在主 PRD 模块索引段落镜像。

## 3. 标准模块 PRD 文档结构

`{domain}/PRD.md` 根据 Appendix A 模板创建。每次更新记录 `最后更新` 时间戳，重大变更同步主 PRD 变更记录并补 ADR。

## 4. 模块协作规范

- **依赖管理**：主 PRD "里程碑与依赖"维护跨模块全局视图，各模块在"接口与依赖"细化
- **数据共享**：共享实体在 `/docs/data/dictionary.md` 定义，模块直接引用
- **追溯矩阵**：`/docs/data/traceability-matrix.md` 记录 Story → AC → Test Case ID
- **跨团队对齐**：模块规划完成后通知 ARCH/TASK/QA 依次消费并更新 `AGENT_STATE`

## 5. 维护职责

| 角色 | 职责 |
|------|------|
| PRD | 拆分决策、模块规划、内容编写、一致性检查（主 PRD ↔ 模块 PRD ↔ 追溯矩阵） |
| ARCH | 基于主/模块 PRD 产出架构视图，保持 Story 与组件追溯 |
| TASK | 依据模块 PRD 拆解 WBS，同步关键依赖和里程碑 |
| QA | 覆盖追溯矩阵中的 Story/AC/Test Case，及时更新状态 |

## 6. 自动化脚本

| 命令 | 功能 |
|------|------|
| `pnpm run prd:lint` | 校验模块 PRD 结构、Story/AC（GWT）与 NFR/依赖/风险字段 |
| `pnpm run prd:check-dependency-cycles` | 检查循环依赖或缺失引用 |
| `pnpm run prd:sync-matrix` | 同步 Story→AC 映射到追溯矩阵 |

## 7. 相关资源

- `/docs/PRD.md` — 主 PRD 总纲
- `/AgentRoles/PRD-WRITER-EXPERT.md` — 角色职责与 DoD
- `/docs/data/traceability-matrix.md` — 追溯矩阵
- `/docs/data/global-dependency-graph.md` — 跨模块依赖图
- `scripts/prd-tools/*.js` — 自动化脚本

---

## Appendix A: 模块 PRD 文档模板
> 以下模板复制到 `{domain}/PRD.md` 后使用，仅由 PRD 专家编辑。

```markdown
# {功能域名称} - PRD 模块

> **所属主 PRD**: [PRD.md](../PRD.md)
> **负责团队**: @team-name
> **最后更新**: YYYY-MM-DD
> **状态**: 📝 待启动 / 🔄 进行中 / ✅ 已确认 / ⚠️ 需更新
> **追溯说明**: 列出 Story/AC/Task/QA 链接并同步 `docs/data/traceability-matrix.md`

---

## 1. 模块概述（业务目标与交付）
- 简述模块业务能力、核心价值与作用场景
- 关联 Story（`US-...`）、PRD/Task/ARCH 链接
- 交付产物列表（功能/文档/接口）

## 2. 范围与约束
- In-Scope 与 Out-of-Scope
- 关键约束（资源、合规、时间）
- 前置依赖模块与接口（指向 PRD/ARCH/Task）

## 3. 用户故事与验收

| Story ID | 验收标准（Given-When-Then） | Task ID | Test Case ID | QA 负责人 |
|----------|---------------------------|---------|--------------|-----------|
| US-XXX-001 | Given..., When..., Then... | TASK-XXX-001 | TC-XXX-001 | @qa-lead |

- 每条故事注明是否已写入 `traceability-matrix`、是否需要 ARCH/QA 复核

## 4. 非功能需求（NFR）
- 列出性能/安全/可用/可维护等指标
- 标注监控/验证方式、QA 负责人与验证状态

## 5. 依赖与风险
- 依赖表格：模块/外部系统/数据服务
- 风险表格：风险、影响、缓解、责任人、状态

## 6. 里程碑与 Gate
- Milestone ID、名称、日期、目标、验收标准
- Gate 要求的补充资料

## 7. 追溯矩阵与验证
- Story → AC → Test Case → Task 追踪表
- Traceability 与 QA 校验状态

## 8. 用户体验设计（UX）（可选，有前端界面时填写）
- 模块级用户旅程摘要（关联 Story ID）
- 关键页面/组件的线框图或原型链接
- 设计系统引用（全局 Design Token + 模块特定组件）
- 响应式断点与无障碍要求（WCAG 2.1 AA）
- 详细 UX 规范见模块 `ux-specifications.md`（参照 `/docs/data/templates/prd/UX-SPECIFICATIONS-TEMPLATE.md`）

## 9. 开放问题
- 问题描述、影响、负责人、计划解决时间

## 10. 变更记录
- 版本、日期、描述、责任人

## 11. 自检清单
- [ ] 是否运行 `pnpm run prd:lint`、`prd:check-dependency-cycles`、`prd:sync-matrix`？
- [ ] 是否同步 traceability matrix 与 QA 状态？
- [ ] 是否通知 ARCH/TASK/TDD/QA？
- [ ] 是否在 `/docs/AGENT_STATE.md` 标注阶段状态？
- [ ] 若有前端界面，是否创建了 `ux-specifications.md`？
```
