# 用户角色与故事覆盖矩阵模板（Persona → Story Mapping）

> **目的**：确保每个定义的角色都有对应的 Story/验收标准和测试计划，快速识别孤儿角色、权限冲突或功能空白。  
> **维护者**：PRD 专家（协同 ARCH/QA）；大模型或自动化脚本可直接填充本模板，生成 `/docs/data/persona-story-matrix.md`。  
> **输入**：PRD/模块 PRD 的角色描述、Story 列表、目标权限等级、测试/权限需求。

---

## 1. 概览

- **生成时间**：`{generation_time}`  
- **覆盖角色**：列出本报告包含的角色（如 Admin / User / Auditor / Merchant）  
- **关键发现**：简要说明发现的角色覆盖风险或权限冲突（例如“Auditor 缺乏关键审计 Story”）  
- **责任人**：@po / @arch-lead / @qa-lead

## 2. 角色 ↔ Story 覆盖矩阵

| Story ID | Story Title | Role | Coverage Type | Priority | Notes |
|----------|-------------|------|---------------|----------|-------|
| US-USER-001 | 用户注册 | Admin | ✅ 主要使用者 | P0 | 需要登录/权限校验 |
| US-USER-001 | 用户注册 | User | ✅ 主要使用者 | P0 | 重点回归 |
| US-USER-001 | 用户注册 | Guest | 📝 覆盖规划中 | P1 | 待定义匿名流程 |
| US-USER-001 | 用户注册 | Auditor | - | P2 | 审计需读取日志 |

- `Coverage Type`：使用统一符号（✅ 主要使用者 / ⚙️ 配置 / 🔍 只读 / - 不涉及 / 📝 待规划）  
- `Priority`：PRD 中 Story 优先级（P0/P1/P2）  
- `Notes` 用于说明权限细节或依赖（如“需与 SSO 结合”）。  
- 大模型填充时，只需复制此表格结构并按角色填写即可。

## 3. 角色覆盖率统计

| Role | Total Stories | Covered Stories | Coverage% | Risk |
|------|---------------|----------------|-----------|------|
| Admin | 25 | 18 | 72% | 无孤儿角色 |
| Auditor | 25 | 10 | 40% | 需补充审计 Story |

- `Coverage%` = Covered / Total * 100；`Risk` 描述覆盖不足/冲突。  
- `Total Stories` 可从 PRD/模块 Story 列表计数；`Covered Stories` 为 `Coverage Type != -`。

## 4. 权限异常与冲突

| Story ID | Role | Issue | Impact | Action |
|----------|------|-------|--------|--------|
| US-PAY-001 | Guest | 赋予创建订单权限 | 数据一致性风险 | 改为只读（🔍）或新增 Guest-Order 流程 |
| US-ANALYTICS-002 | Admin | 缺少数据脱敏说明 | 合规风险 | 补充 NFR、Traceability 链接 |

- `Issue`：如“Guest 拥有高权限”、“角色无覆盖 Story”  
- `Impact` & `Action` 提供处理建议，便于 QA/ARCH/PRD 协同。

## 5. 推荐动作

- 补齐 Coverage% < 50% 的角色对应的 Story（新增 Story 或补充现有）。  
- 将 “Coverage Type = 📝” 的表项加入下一轮任务计划，由 TASK/QA 明确 Test Case 与 Traceability。  
- 若检测到权限冲突（Guest 具备 Admin 权限），必须在 `docs/data/traceability-matrix.md` 及 `QA` 测试计划中注明验证策略。

## 6. 生成与维护指南

1. 填表前先从 `docs/prd-modules/{domain}/PRD.md` 抽取角色、Story、优先级，确保 Story ID 与跨模块依赖一致。  
2. 模板复制生成后，将文件保存到 `/docs/data/persona-story-matrix.md`，并在 `module-list.md` 或 `AGENT_STATE` 中记录更新时间。  
3. 更改后同步到 `docs/data/persona-story-matrix.md` 的 coverage 统计（以及 QA 的 Story/Test Case）。  
4. 推荐使用 `npm run persona:check-orphans` 等脚本校验角色覆盖，输出可直接填入 `Coverage%` 表。

---  
> 模板中每段均可由大模型输出，填充完成后即可作为 `goal-story-mapping.md` 的基础视图或 `persona-story-matrix.md` 的换代。  
