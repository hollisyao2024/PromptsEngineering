# {{MODULE_NAME}} QA 计划与报告

> 模块 ID：`{{MODULE_ID}}`
> 状态：Draft / Ready / Passed / Blocked
> 负责人：{{OWNER}}
> 测试日期：{{DATE}}
> 被测提交/PR：{{REVISION}}

本文件同时保存可执行计划和最终结论。只记录摘要与证据引用，大日志放测试报告目录。

## 1. 验收范围

### 目标

- {{QA_GOAL_1}}
- {{QA_GOAL_2}}

### 不在范围

- {{OUT_OF_SCOPE_1}}

### 输入

| 来源 | 链接/ID | 覆盖内容 |
| --- | --- | --- |
| PRD | {{PRD_LINK}} | {{PRD_SCOPE}} |
| ARCH | {{ARCH_LINK}} | {{ARCH_SCOPE}} |
| TASK | {{TASK_LINK}} | {{TASK_SCOPE}} |
| 变更集 | {{DIFF_LINK}} | {{DIFF_SCOPE}} |

## 2. 风险与策略

| 风险域 | 等级 | 影响 | 测试策略 |
| --- | --- | --- | --- |
| {{RISK_DOMAIN}} | high/medium/low | {{IMPACT}} | {{STRATEGY}} |

必须显式检查：认证/权限、数据写删、事务/缓存/并发、外部 API、schema、共享基础库、跨模块联动、迁移和回滚。未涉及项标记 N/A 并说明依据。

## 3. 环境

| 项 | 值 | 证据 |
| --- | --- | --- |
| 环境 | {{ENVIRONMENT}} | {{ENV_EVIDENCE}} |
| 版本/提交 | {{VERSION}} | {{VERSION_EVIDENCE}} |
| 数据集 | {{DATASET}} | {{DATA_EVIDENCE}} |
| 服务依赖 | {{DEPENDENCIES}} | {{DEP_EVIDENCE}} |

环境隔离、测试账号和数据清理方式：{{ISOLATION_CLEANUP}}

## 4. 验收追踪

| AC ID | 场景 | 层级 | 用例 ID | 状态 | 证据 |
| --- | --- | --- | --- | --- | --- |
| {{AC_ID}} | {{SCENARIO}} | e2e/integration/manual | QA-{{N}} | pending | {{EVIDENCE}} |

所有必需 AC 必须至少有一个测试或明确的静态验证证据。

## 5. 功能用例

### QA-{{N}} — {{CASE_NAME}}

- 对应 AC：{{AC_IDS}}
- 优先级：P0 / P1 / P2
- 前置条件：{{PRECONDITION}}
- 数据：{{TEST_DATA}}

步骤：

1. {{ACTION_1}}
2. {{ACTION_2}}
3. {{ACTION_3}}

预期：

- {{EXPECTED_1}}
- {{EXPECTED_2}}

失败/边界变体：

- {{NEGATIVE_OR_EDGE}}

自动化命令：`{{COMMAND}}`

## 6. 非功能验证

### 性能

| 指标 | 基线/门槛 | 结果 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| {{METRIC}} | {{THRESHOLD}} | {{RESULT}} | pending | {{EVIDENCE}} |

说明负载模型、预热、样本量和误差范围：{{PERF_METHOD}}

### 安全与隐私

| 检查 | 预期 | 结果 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| 权限边界 | {{AUTHZ_EXPECTED}} | {{AUTHZ_RESULT}} | pending | {{AUTHZ_EVIDENCE}} |
| 输入/注入 | {{INPUT_EXPECTED}} | {{INPUT_RESULT}} | pending | {{INPUT_EVIDENCE}} |
| 敏感数据 | {{PRIVACY_EXPECTED}} | {{PRIVACY_RESULT}} | pending | {{PRIVACY_EVIDENCE}} |
| 依赖扫描 | {{DEPENDENCY_EXPECTED}} | {{DEPENDENCY_RESULT}} | pending | {{DEPENDENCY_EVIDENCE}} |

### 可靠性与恢复

| 故障 | 预期行为 | 恢复验证 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| {{FAILURE}} | {{EXPECTED_BEHAVIOR}} | {{RECOVERY}} | pending | {{EVIDENCE}} |

## 7. 兼容与回归

| 范围 | 平台/版本 | 结果 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| {{REGRESSION_SCOPE}} | {{MATRIX}} | {{RESULT}} | pending | {{EVIDENCE}} |

最低回归范围：

- 改动模块的单元/集成测试；
- 直接上下游关键路径；
- 相关历史缺陷；
- 配置默认值和降级路径；
- 数据迁移或版本兼容路径（如适用）。

## 8. 执行记录

| Run | 时间 | 命令/动作 | 退出码 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| 1 | {{TIME}} | {{COMMAND}} | {{EXIT_CODE}} | {{SUMMARY}} | {{EVIDENCE}} |

证据应是路径、URL、哈希、截图或短结论；不得粘贴密钥、用户数据和超长日志。

## 9. 缺陷

| ID | 严重度 | 描述 | 复现 | 状态 | 负责人 |
| --- | --- | --- | --- | --- | --- |
| BUG-{{N}} | blocker/critical/major/minor | {{DESCRIPTION}} | {{REPRO_LINK}} | open | {{OWNER}} |

阻断规则：

- blocker/critical 未解决；
- 必需 AC 无证据；
- 环境或数据不足导致关键路径未执行；
- 性能、安全或恢复门槛未达标；
- 结果不确定且副作用状态未核实。

## 10. 最终结论

### 汇总

| 项目 | 结果 |
| --- | --- |
| 必需 AC | {{PASSED}} / {{TOTAL}} |
| 自动化测试 | {{AUTOMATION_SUMMARY}} |
| 手工/物理验证 | {{MANUAL_SUMMARY}} |
| 性能 | {{PERF_SUMMARY}} |
| 安全 | {{SECURITY_SUMMARY}} |
| 未关闭缺陷 | {{OPEN_DEFECTS}} |

### 发布建议

`PASS | PASS_WITH_RISK | BLOCKED`

依据：{{RECOMMENDATION_REASON}}

残余风险及接受人：{{RESIDUAL_RISK_OWNER}}

下一动作：{{NEXT_ACTION}}

## 11. 完成检查

- [ ] 被测提交、环境和数据可复现。
- [ ] 所有必需 AC 有证据且追踪完整。
- [ ] 相关功能、失败路径和回归已执行。
- [ ] 性能、安全、兼容与恢复已执行或合理标记 N/A。
- [ ] 缺陷等级、负责人和处置明确。
- [ ] 发布建议基于证据，未把未执行验证写成通过。
- [ ] 已更新模块清单；阶段状态只更新稳定 QA 里程碑。
