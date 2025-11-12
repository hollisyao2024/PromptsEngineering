# PRD ↔ ARCH 追溯报告模板

> **说明**：本模板由 ARCH 专家或大模型直接填充，生成 `/docs/data/arch-prd-traceability.md`。只需替换所有 `{...}` 占位符并按「生成指南」顺序补入数据，最终形成完整、可审计的 PRD ↔ ARCH 追溯报告。
>
> **上下游输入**：
> - PRD：`/docs/PRD.md` 或 `/docs/prd-modules/{domain}/PRD.md` 提供 Story/AC/优先级
> - ARCH：`/docs/ARCH.md` 或 `/docs/arch-modules/{domain}/ARCH.md` 提供组件/接口/依赖、Component ID
> - 模块 Component 图：`docs/data/templates/COMPONENT-DEPENDENCY-GRAPH-TEMPLATE.md` 或模块 `component-dependency-graph.md`

---

## 1. 报告概要

- **生成时间**：`{生成时间}`
- **报告版本**：`v{版本}`（版本由 ARCH 专家维护，建议与 `AGENT_STATE` 同步）
- **覆盖范围**：列出本报告包含的模块/Story/Component 范围（例如 `user-management / payment-system`）
- **关键发现**：简述 Story vs Arch 之间的主要差异、丢失链接、风险（若无可写 “暂无异常”）

## 2. Story ID 追溯

### 2.1 覆盖统计

| 指标 | 数值 | 目标 |
|------|------|------|
| ARCH 中引用的 Story ID | `{arch_story_refs}` | ≈ PRD Story 总数 |
| PRD 中定义的 Story ID | `{prd_story_total}` | 同上 |
| ARCH 引用但 PRD 不存在 | `{arch_extra_story}` | 0 |
| PRD 定义但 ARCH 未引用 | `{prd_missing_arch}` | ≤ 1 |

### 2.2 异常明细（若无可写“无”）

| Story ID | 来源 | 问题类型 | 说明 | 责任人 |
|----------|------|-----------|------|--------|
| US-... | ARCH | Missing Story | ARCH 提到但 PRD 缺失 | @arch-lead |

## 3. Component ID 追溯

### 3.1 覆盖统计

| 指标 | 数值 | 目标 |
|------|------|------|
| 依赖图中的 Component ID | `{graph_components}` | 与 ARCH Component 总数一致 |
| 模块文档中定义的 Component ID | `{module_components}` | 同上 |
| 依赖图引用但模块文档不存在 | `{missing_component_docs}` | 0 |
| 模块文档定义但依赖图未引用 | `{unused_component}` | 可为 0 |

### 3.2 异常明细（若无可写“无”）

| Component ID | 位置 | 问题类型 | 说明 | 责任人 |
|--------------|------|-----------|------|--------|
| USER-SVC-001 | component-dependency-graph.md | 未定义模块文档 | 请创建 `arch-modules/.../component-dependency-graph.md` | @arch-lead |

## 4. 依赖/契约补充

- 列出 ARCH 报告中存在但 PRD 未明确的依赖（如第三方接口、事件流）以及已补充的契约路径；每条依赖应包含当前状态（如 `待确认`/`已验证`）、风险等级与下一步行动。

| 依赖项 | 来源模块 | 状态 | 风险等级 | 下一步 |
|--------|---------|------|----------|--------|
| 支付网关契约 | payment-system | 待确认 | 中 | QA + TDD 明确接口返回 |

## 5. 生成指南（大模型友好）

1. **数据准备**：收集 `/docs/PRD.md` 的 Story/AC ID 与 `/docs/ARCH.md` 的 Component/接口列表，再读取模块依赖图以确认 Component ID 与引用路径。  
2. **填充表格**：逐行替换“覆盖统计”/“异常明细”/“依赖补充”的 `{}` 占位符，确保数量与来源一致；如有缺失项请在“异常明细”中新增行并标注责任人。  
3. **写入摘要**：在“报告概要”中说明本次报告是否发现 Story/Component 不一致、是否需要 PRD/ARCH 协调，并附上关联 Issue/Field。  
4. **保持一致性**：确保 `依赖图引用但模块文档不存在` 与实际 `component-dependency-graph.md` 检查结果一致，若需要追溯可追加 Mermaid 图链接或截图。  
5. **输出目标文件**：将填好的内容保存到 `/docs/data/arch-prd-traceability.md`，并在 `AgentRoles/TASK-PLANNING-EXPERT.md` 或 ARCH 文档中注明生成时间与版本。

## 6. 维护与同步

- 每次 ARCH 模块变更后（新增 Component、接口调整、依赖更替），应重新生成此报告，确保 Story/Component 状态与 `module-list.md`、`traceability-matrix`、`arch-prd-traceability` 一致。  
- 建议在 `AGENT_STATE` 中记录最新版本，引导 ARCH/PRD/QA/TASK 跟踪变更进度。  
- 若报告中发现 Story/Component 脱节，及时在 `/docs/PRD.md` 或 `/docs/ARCH.md` 中同步更新，并在下一轮生成时验证修复。

---  
> 本模板可直接复制到 `/docs/data/arch-prd-traceability.md` 并填充数据；若有其他关联文档（如 `component-dependency-graph.md`、`arch-modules/{domain}/ARCH.md`），请在“依赖/契约补充”中补充链接/说明。
