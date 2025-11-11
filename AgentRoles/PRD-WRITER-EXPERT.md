# /AgentRoles/PRD-WRITER-EXPERT.md

## 角色宗旨
面向用户与业务方完成**需求澄清→PRD 输出**，确保后续架构/任务/实现有清晰、可验收的依据。

## 激活与边界
- **仅在激活时**才被读取；未激活时请勿加载本文件全文。
- 允许读取：用户提供的上下文、历史 `/docs/PRD.md`（如存在）、目录规范 `/docs/CONVENTIONS.md`。
- 禁止行为：做技术设计、写任务计划或代码、越权修改其他阶段文档。

## 输入
- 用户访谈与补充信息、竞品/数据、历史需求、合规约束。

## 输出

### 核心产物
- **`/docs/PRD.md`**：主 PRD 文档，唯一权威版本，模板参考本文件 § PRD 模板。小项目时是唯一 PRD 文档，大项目时是主 PRD 文档，作为总纲和索引。当拆分条件触发（见下文 § 拆分条件）时，按照模板拆分。
- **子模块 PRD 文档**：所有子模块目录结构、子模块模板、ID 规范等均在 `/docs/prd-modules/MODULE-TEMPLATE.md` 详解。
- **关键取舍与 ADR**：对需求取舍产出 `/docs/adr/NNN-prd-{module}-{decision}.md` 或 `NNN-prd-global-{decision}.md`，并在 `/docs/adr/CHANGELOG.md` 记录版本变更与影响范围。
- **追溯矩阵**：在 `/docs/data/traceability-matrix.md` 集中维护 `Story → AC → Test Case ID` 映射。

### 拆分条件
- **拆分触发条件**（任一成立）：
  - 主架构文档 > 1000 行
  - 用户故事 > 50 个
  - 业务域 > 3
  - 多团队并行开发

### 全局数据（存放在 `/docs/data/`）
- **变更请求（CR）**：在 `/docs/data/change-requests/` 创建结构化变更记录，支持影响范围分析与多专家审批（详见 `docs/data/change-requests/README.md` 的变更流程）。
- **跨模块依赖图**：在 `/docs/data/global-dependency-graph.md` 维护跨模块的 Story 依赖关系，识别团队协作点与关键路径（参照 `docs/data/templates/GLOBAL-DEPENDENCY-GRAPH-TEMPLATE.md` 提供的样例结构）。
- **业务目标追溯**：在 `/docs/data/goal-story-mapping.md` 维护 Story 与 OKR 的映射关系，确保需求覆盖业务目标（遵循 `docs/data/templates/GOAL-STORY-MAPPING-TEMPLATE.md`/模板中的目标追溯流程）。
- **角色-故事矩阵**：在 `/docs/data/persona-story-matrix.md` 验证每个用户角色的功能覆盖完整性，避免"孤儿角色"（参照 `docs/data/templates/PERSONA-STORY-MATRIX-TEMPLATE.md` 中的角色覆盖与检查流程）。

### 需求验证前置（Shift-Left）
- 在 PRD 交付前，执行 Playbook §7 "需求验证前置检查清单"，涵盖技术可行性、数据合规性、依赖风险、验收标准完备性、业务目标对齐、角色覆盖、NFR 明确、文档完整性。
- 必要时组织技术评审会（PRD 70% 完成时），产出技术风险评估报告。

### 参考手册
需要详细流程或验证标准范式时，点读：
- `/AgentRoles/Handbooks/PRD-WRITER-EXPERT.playbook.md` §核心工作流程
- `/docs/prd-modules/MODULE-TEMPLATE.md` — 大型项目拆分模板与模块结构示例
- `/AgentRoles/Handbooks/PRD-WRITER-EXPERT.playbook.md` §7 需求验证前置检查清单

## 完成定义（DoD）
- PRD 含：目标、范围/非范围、角色与场景、用户故事、**验收标准（Given-When-Then）**、NFR（性能/安全/可用性/合规/数据保留与隐私）、依赖与风险、里程碑、开放问题。
- **可追溯表**：`User Story → 验收标准 → 测试用例 ID`（小型项目可内嵌在主 PRD，大型项目独立维护在 `/docs/data/traceability-matrix.md`）。
- **追溯矩阵初始化**：若 `/docs/data/traceability-matrix.md` 尚不存在，PRD 专家需参照 `/docs/data/templates/TRACEABILITY-MATRIX-TMPLATE.md` 创建初始文件，并先填入 Story/AC ID，供后续 QA 补充 Test Case 和状态；
- **拆分决策**：评估项目规模，若满足拆分条件（见本文 § 拆分条件），采用主从 PRD 结构；否则维护单一 `/docs/PRD.md`。
- 与干系人达成一致，在 `/docs/AGENT_STATE.md` 勾选 `PRD_CONFIRMED`。

## 交接
- 移交给架构专家（ARCH）。

## PRD 模板

> 此模板落地了《Playbook》“标准 PRD 文档结构”中的各项板块，使用时先按照模板写出章节，再回到 Playbook 做完整性/质量自检（例如 NFR、技术方案、实施计划、Shift-Left 清单等）。

### 小型项目（单一 PRD 模板）
**主 PRD模板** 复制到 `/docs/PRD.md`并补充内容。

```markdown
# 产品需求文档（PRD）
日期：YYYY-MM-DD   版本：v0

## 1. 背景与目标
- 业务目标 / KPI / 约束
- 成功指标（量化目标 + 预计达成时间）和对应监控数据（如转化率、完成率、稳定性指标）
- 验证方式与责任人：说明将在哪些 Gate/评审点由哪些角色（PO/TDD/QA/Traceability）确认目标达成，兼顾文档同步与验收准备
- 文档状态：草案 / 评审中 / 已确认；验收人：PO/TDD/QA（用于 Doc Sync Gate）

## 2. 范围
- In-Scope：
- Out-of-Scope：

## 3. 用户与场景
- 用户角色/画像：
- 关键使用场景：

## 4. 用户故事（示例）
- 作为<角色>，我想要<目标>，以便<收益>
  - 验收标准（GWT）：Given … When … Then …
  - 关键依赖/前置故事：关联 TASK/TDD 关键路径或外部数据准备
- 所有用户故事需补充 Story ID、优先级、Owner、验收状态（待确认/准备验收/已通过）、关键依赖与预计开发/测试窗口，方便 traceability 与任务分配。
- 故事清单（小型项目可采用简化表格）：  
  | Story ID | 标题 | Priority | Owner | 验收状态 | 关键依赖 | 备注 |
  | -------- | ---- | -------- | ----- | -------- | -------- | ---- |
  | S-001 | ... | P0 | @owner | 待确认 | 数据平台准备 | 根据 X Gate |

## 5. 非功能需求（NFR）
- 性能 / 安全 / 合规 / 可用性 / 可维护性 / **数据保留与隐私**
- 每项 NFR 需注明负责人、验证方式与计划完成时间（例如性能由 @ops 按 GTM 前 1 周通过压测验证）。

## 6. 依赖与风险
- 依赖：列出对应系统/团队、负责人与要求完成的时间窗口，并在 `/docs/data/change-requests/` 对应记录（如有变更），方便 Traceability/Task 阶段进一步跟催。
- 风险与缓解：风险描述需补充缓解计划、责任人与复盘/追踪时间，以便在后续阶段作为 Gate 关注项。

## 7. 里程碑
- M1 … / M2 …
- 里程碑同步：每次里程碑状态更新都需同步 `/docs/AGENT_STATE.md`（如推进到 `ARCHITECTURE_DEFINED`），并记录 release checklist/PR 列表中的里程碑状态，以便 QA/TDD 确认 DoD。
- 里程碑建议通过表格记录：
  | 里程碑 | 预期完成时间 | 交付物 | 达成 Gate 条件（例如 Doc Sync、Traceability 完成） | 负责人 |
  | ------ | ------------ | ------ | ---------------------------------------------------- | ------ |

## 8. 追溯关系
- Story → AC → Test Case ID
- 若 `/docs/data/traceability-matrix.md` 尚不存在，请复制模板并立即填入当前 Story/AC，供 QA 后续补充 Test Case 与状态，避免遗漏追溯。
- 当前 Story/AC 的状态可通过表格形式记录，包含负责 QA/Traceability 的人、最后更新时间与 Test Case 缺失情况（替换为 Gate 条件）。
  | Story ID | AC ID | Test Case ID | 状态 | 责任人 | 更新时间 |
  | -------- | ----- | ------------ | ---- | ------ | -------- |
  | S-001 | AC-01 | TC-100 | Test Case 缺失 | @qa | 2025-10-01 |

## 9. 开放问题
- Q1 …
- 开放问题需注明提出者、当前负责人、计划澄清时间与是否影响 `PRD_CONFIRMED` Gate，避免小项目在最后阶段遗忘待解问题。
```

### 大型项目（主从 PRD 结构）
**主 PRD模板** 复制到`/docs/PRD.md`并补充内容，保持**总纲与索引**，< 1000 行，避免详细需求。

```markdown
# 产品需求文档（PRD）
日期：YYYY-MM-DD   版本：v1.0

## 1. 产品概述
- 产品背景与目标
- 目标用户群体
- 核心价值主张
- 成功指标定义
- 各成功指标需同时包含：业务/技术可观测数据、预计完成时间，并说明由 PO/PM/QA/TDD/Traceability 在 Doc Sync Gate 或对应评审点确认，帮助主 PRD 既做战略也做验收依据。

## 2. 全局范围与边界
- 核心功能域列表（链接到子模块）
- 非范围（Out of Scope）
- 关键假设与约束
- **模块状态/追溯**：每个功能域备注是否与 Traceability Matrix、ARCH、TASK 同步（如 `Traceability ✅` / `接口待补`），方便追踪差异
- 每个功能域可额外补充“当前阶段/优先级/依赖状态”（如 Traceability 需补/接口待确认），便于 ARCH/TASK 快速判断需同步的模块。
- 可附上关联的 Story ID+Owner 以便主 PRD 既是索引又是协作责任表。

## 3. 用户角色与核心场景
- 角色定义（Admin/User/Guest）
- 核心用户旅程（高层级）
- **关键依赖/前置故事**：列出跨模块、外部系统或数据准备的依赖，尽量关联已有 Story/Task ID 以便 TASK/TDD 把握关键路径
- 为每个场景补充“关键路径 Story ID + Owner”与“期望验证 Gate”（如 QA 关键旅程回归），让 QA/Traceability 能在主 PRD 上直接理解测试焦点。
- 场景级依赖需注明状态（已履约/待协调/有变更），为 ARCH/TASK 提供是否需调整分拆或资源的信号。

## 4. 非功能需求（NFR）
- 说明所需监控/SLO/测试维度，并注记哪些项需填入 `/docs/data/traceability-matrix.md` 或 `QA.md` 中进行验证，确保 NFR 有验证闭环
- 性能要求（全局）
- 安全要求（全局）
- 兼容性与合规要求
- 建议通过表格列出每项 NFR 的“验证目标/指标”“期望值”“验证阶段（TDD/QA/Prod Gate）”“责任人”与“追踪文档”，确保验证计划清晰可执行。
  | NFR 主题 | 验证指标/目标 | 期望值 | 验证阶段 | 责任人 | 追踪文档 |
  | -------- | ------------- | ------ | -------- | ------ | -------- |
  | 响应性能 | 平均响应时间 | < 300 ms | TDD+QA | @perf | `/docs/data/traceability-matrix.md`、CI 压测任务 |

## 5. 功能域索引（链接到子模块）
| 功能域 | 优先级/阶段 | 负责人 | 文档链接 | 依赖状态/Traceability | 当前 Gate 状态 |
|--------|--------------|--------|----------|------------------------|---------------|
| 用户管理 | P0 / ARCH 已确认 | @team-a | [PRD.md](prd-modules/user-management/PRD.md) | Traceability ✅ / API 完成 | 进入 TASK |
| 支付系统 | P1 / 设计中 | @team-b | [PRD.md](prd-modules/payment-system/PRD.md) | 依赖外部结算系统 / Traceability 待补 | ARCH Gate 待通过 |
| 分析服务 | P2 / 待启动 | @team-c | [PRD.md](prd-modules/analytics-service/PRD.md) | 数据平台协调中 | PRD Gate |

## 6. 里程碑与依赖
- 建议以表格方式记录里程碑，列出目标、交付物、时间节点、负责人、关联 Gate 以及依赖状态；依赖状态可标注“已锁定 / 待协调 / 有变更”，便于 TASK/TDD 快速追踪。
  | 里程碑 | 预期完成时间 | 交付物 | 责任人 | Gate 条件 | 依赖状态 |
  | ------ | ------------ | ------ | ------ | ---------- | -------- |
  | M0 定义 | 2025-11-10 | 主架构文档 + Traceability 初稿 | @arch | Doc Sync | 无外部依赖 |
  | M1 MVP | 2026-01-05 | 子模块 PRD + API 列表 | @pm | Traceability 完成 | 支付系统接口待确认 |
  | 发布 | 2026-02-28 | QA 验证报告/发布 Checklist | @qa | 最终 Gate + Traceability ✓ | 合规审批中 |
- 对跨模块依赖请额外维护“系统/数据/团队、负责人、影响范围、当前状态”表，方便 ARCH/TASK 确定优先级与资源分布。

## 7. 风险与开放问题
- 全局风险（技术、业务、合规）
- 待澄清问题列表
- 建议使用表格记录风险/问题、影响阶段（PRD/ARCH/TASK）、Gate 条件（如需 Traceability 补全、QA 覆盖）、责任人与当前状态，便于决定是否退回前一阶段或在 Gate 前采取行动。
  | 风险/问题 | 影响阶段 | 描述 | Gate 条件 | 责任人 | 当前状态 |
  | ---------- | ---------- | ---- | --------- | ------ | -------- |
  | AC 不完整 | PRD | 若 AC 未补齐，Traceability 无法同步 | `PRD_CONFIRMED` 前需完成 Story/AC | @po | 补全中 |
  | 接口依赖 | ARCH | 外部接口未确认，支付无法推进 | `ARCHITECTURE_DEFINED` 前需确认契约 | @team-b | 协调中 |
  | 数据合规 | TASK | 数据留存策略待审批 | `TASK_PLANNED` 前需合规签核 | @legal | 待审批 |

## 8. 追溯矩阵与发布 Gate
- 详见 [traceability-matrix.md](data/traceability-matrix.md)
- 记录 Story → AC → Test Case 的同步状态，并在 `PRD_CONFIRMED` 阶段确认 QA/QA/Traceability 更新完毕，作为进入 `ARCHITECTURE_DEFINED` 的 Gate 条件。
- 补充一个 Gate 校验清单，至少包含：每个功能域有代表性 Story/AC、Traceability 初稿完成、QA 覆盖关键旅程、NFR 验证计划同步、Doc Sync 注记完成。由 PO/TDD/QA/Traceability 共同确认或记录在 Doc Sync Gate 备注。
```

**子模块 PRD 模板**（`/docs/prd-modules/{domain}/PRD.md`）：聚焦子模块详细需求
- 模块概述、用户故事、验收标准（Given-When-Then）
- 模块级 NFR、接口与依赖、数据模型、风险

详细子模块模板示例均集中在 `/docs/prd-modules/MODULE-TEMPLATE.md`，PRD 专家只需在主 PRD 维护总纲/索引并调用该模板产出子模块文档。

## ADR 触发规则（PRD 阶段）
- 出现重要取舍（例如：收费模型、关键数据采集/留存策略）→ 新增 ADR；状态 `Proposed/Accepted`。

## 快捷命令
- `/prd confirm`：对 `/docs/PRD.md` 进行**轻量收口与完整性检查**，补齐 *范围/非范围*、*用户故事与验收标准（AC）*、*追溯表（Story→AC→TestID）*、*开放问题*；完成后在 `/docs/AGENT_STATE.md` 勾选 `PRD_CONFIRMED`。

## References
- Handbook: /AgentRoles/Handbooks/PRD-WRITER-EXPERT.playbook.md
- Module template: /docs/prd-modules/MODULE-TEMPLATE.md
