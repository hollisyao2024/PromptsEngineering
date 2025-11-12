# 模块测试优先级矩阵模板
强调每个模块测试用例的业务价值与执行优先级，是 QA 模块级调度与 Traceability 的依据。大模型或 `/qa plan` 可直接根据此模板输出 `docs/qa-modules/{module}/priority-matrix.md`。

## 模板结构
1. **概览段**：简述当前模块优先级分布（TP0~TP3 比例）、关键缺口与预期执行窗口。
2. **优先级表格**：列出所有测试用例/测试场景的 Story 关联、评分、优先级与执行状态。
3. **行动项**：对优先级较高但未执行或阻塞的用例列出下一步行动（如环境准备、依赖协调）。

## 表格字段
| Test Case ID | Story / AC | 场景概述 | 风险等级 | 影响范围 | 频次 | 优先级 | 评分 | 拟执行轮次 | 责任人 | 当前状态 | 依赖 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-${MODULE}-001 | ${StoryID} / AC1 | 关键业务正向流程 | 高 | end-to-end | 每日 | TP0 | 95 | Round1 | @qa-${module} | 待执行 | payment service | 需联调 payment |
| TC-${MODULE}-002 | ${StoryID} / AC2 | 数据边界校验 | 中 | 模块输入 | 每轮 | TP1 | 78 | Round2 | @qa-${module} | 已通过 | config service | 依赖 config 服务 |

## 字段说明与对齐要求
- `Story / AC`：必须与 `/docs/prd-modules/{module}/PRD.md` 或主 `/docs/PRD.md` 中的 Story ID/AC 对应，确保回溯，便于追踪到 Story 优先级。
- `评分`：可使用 `TEST-PRIORITY-MATRIX-TEMPLATE.md` 中定义的计算公式（关联 Story 优先级、覆盖范围、执行难度、历史缺陷率）得出，保证分数透明可复现。
- `频次`与`拟执行轮次`：参考 `/docs/TASK.md`（或 `/docs/task-modules/{module}/TASK.md`）中的里程碑与测试轮次安排，标明本轮/下轮的执行计划。
- `依赖`：记录依赖的服务/环境/数据（可来源于 `/docs/ARCH.md` 或 Task 中的准备任务），便于协调。
- `状态`：使用 `待执行/执行中/通过/失败/阻塞` 标签，阻塞项需说明原因与下步行动。
- `备注`：补充特殊情况（例如需要第三方数据、需要模拟环境、中途新增场景）。
- 更新后务必同步 `docs/data/traceability-matrix.md` 中对应 Story/Test Case 的状态与缺陷链接。

## 扩展指南（供大模型生成）
- **优先级分布**：统计 TP0~TP3 的数量与占比，输出在概览段，引导调度重点。  
- **行动建议**：自动列出 `状态 != 通过` 的条目，并给出执行建议（如“等待 dev 提供 mock 接口”）。
- **Traceability**：生成记录时同时更新 `traceability-matrix` 的 Test Case 状态（Pending/Pass/Fail/Blocked），确保端到端可追溯。
- **版本控制**：建议在文件顶部注明模板版本与更新时间（如 `模板：v1.0`），支持 QA 团队审查。

## 使用实操
- 若由大模型生成，可提供模块名、Story 列表、优先级评分规则、当前 Task 里程碑与已知依赖，让模型填充表格并输出概览与行动项；QA 最终复核后将内容写入 `docs/qa-modules/{module}/priority-matrix.md`，并更新模块 QA 文档、traceability 与 `/docs/data/test-priority-matrix.md`（如需汇总）。  
