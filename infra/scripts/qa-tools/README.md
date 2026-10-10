# QA 工具脚本使用说明

> 这些脚本用于自动化 QA 质量检查、测试覆盖率分析、缺陷追踪、发布门禁验证等任务，提升测试管理效率。

---

## 📦 安装

本工具脚本使用 Node.js 编写，无需额外依赖。

```bash
# 确保已安装 Node.js (推荐 v16+)
node --version

# 赋予脚本执行权限（Unix/Mac）
chmod +x infra/scripts/qa-tools/*.js
```

---

## 🚀 快速开始

### 0. `/qa plan` 文档生成（推荐先执行）

```bash
# 默认 session（仅当前会话关联模块；不会全量重写 docs/QA.md）
pnpm run qa:generate

# session + 显式模块（可由大模型先推断后传入，支持多个模块）
pnpm run qa:generate -- --modules pro-create,quick-create

# project（全项目刷新：主 QA + 所有模块 QA）
pnpm run qa:generate -- --project
```

说明：
- 裸命令默认是 `session` 作用域，避免误生成大量无关 QA 文档。
- 只有显式传入 `--project` 才会执行全量刷新。
- `session` 模式可通过 `--modules`/`--module` 显式指定模块（如 `pro-create,quick-create`），脚本会优先使用该列表，不再依赖 Git 改动推断。
- 也支持通过环境变量传入：`QA_SESSION_MODULES=pro-create,quick-create pnpm run qa:generate`。
- 模块 PRD 含原子 AC 表（见第 7 节）时，模块 QA 按该表生成：Story 清单取自 PRD 的 Story 定义表与 AC 表的 Story 列，只含本模块自己的 Story，横幅、依赖列等处提到的他模块 Story 不计入；测试用例表按 AC 表 `TC` 列登记的真实编号逐条生成，一个 TC 对应多条 AC 时合并为一行（关联 Story 去重，优先级取其中最高者，前置条件取第一条 AC 的 Given），编号前缀取 AC 表里的模块标识，不再臆造顺序编号；`TC` 列为 `-` 的 AC 与没有 AC 的 Story 列入「3.2 尚未登记用例的验收标准」，用例总数是 AC 表里不同 TC 的精确条数。`qa verify` 的 Story 覆盖率分母与此同源。
- 既没有 Story 定义表也没有 AC 表的旧式 PRD 沿用旧骨架（顺序编号、至多 10 行、`（预估）`），但 Story 先按编号去重，`US-MODEL-CONFIG-001` 这类多段或带数字的模块标识也能解析。
- 结尾固定输出 `STATUS=OK|BLOCKED|FAILED`、`SUMMARY=`、`NEXT_ACTION=` 三行，非 OK 时另给 `REASON=<code>`：`PRD_MISSING`（PRD 总纲不存在）、`NO_MODULES`（没有可生成的模块）、`MODULE_STORIES_EMPTY`（模块 PRD 没有 Story）、`MODULE_SET_MISMATCH`（PRD/ARCH/TASK 模块集合不一致，逐项输出 `MODULE_SET_MISMATCH=<missingArch|extraArch|missingTask|extraTask>|<module>`）均为 `BLOCKED`；未预期异常为 `FAILED`、`REASON=UNEXPECTED_ERROR` 并把堆栈写到 stderr。模板源直接 `STATUS=OK`。

### 1. `/qa verify` 验收检查（推荐第二步）

```bash
# 默认 session（优先读取 /qa plan 的会话状态，仅验证本次会话 QA 目标）
pnpm run qa:verify

# session + 显式模块
pnpm run qa:verify -- --modules pro-create,quick-create

# project（全项目验收）
pnpm run qa:verify -- --project

# project + 写入报告（按需）
pnpm run qa:verify -- --project --write-reports
```

说明：
- `session` 模式优先读取 `/qa plan` 记录文件。默认路径为主 repo 所在容器的 `tmp/worktree-sessions/qa-plan/<worktree-name>-<worktree-path-hash>.json`，同一 worktree 稳定复用、不同 worktree 相互隔离；可通过 `QA_PLAN_SESSION_STATE_PATH` 显式覆盖。
- 若会话状态文件不存在，再回退到当前工作区 QA 改动 / 会话推断。
- `project` 模式会复用 `qa:lint`、`qa:sync-prd-qa-ids`、`qa:coverage-report`、`qa:check-defect-blockers`。
- `project` 默认只校验不写 `qa-reports`，显式传 `--write-reports` 才会输出报告文件。
- 结尾固定输出 `STATUS=OK|BLOCKED|FAILED`、`SUMMARY=`、`NEXT_ACTION=`，非 OK 时另给 `REASON=<code>`；既有的 `QA_RECEIPT=`、`BASE_BRANCH=`、`BASE_SHA=`、`HEAD_SHA=` 行保留。`BLOCKED` 代码：`QA_BRANCH_REQUIRED`（不在任务功能分支）、`STALE_QA_BASE`（功能分支落后配置主干）、`HEAD_NOT_PUSHED`（本地 HEAD 与远端分支不一致）、`TEST_SCOPE_EVIDENCE`（`TEST_SCOPE_DECISION`/`TEST_SCOPE_RESULT` 缺失或不合法）、`QA_VERDICT_NO_GO`（QA 文档检查有错误）、`BUSINESS_GATE_BLOCKED`（业务验收门禁未通过）、`ARCHITECTURE_PACKAGE_MISSING`（项目声明了架构包但 `architecture/` 目录缺失）、`ARCHITECTURE_CHECK_FAILED`（`architecture check` 有失败项）。`FAILED` 代码：`QA_FETCH_FAILED`（签发回执前的 `git fetch --prune` 失败；同一命令至多重试一次、共 2 次，仍失败即停止且不签发回执）、`UNEXPECTED_ERROR`（堆栈写到 stderr）。每个代码的 `NEXT_ACTION` 见 Playbook §qa verify 阻断码。
- 前置条件（`QA_BRANCH_REQUIRED`、`QA_FETCH_FAILED`、`HEAD_NOT_PUSHED`、`STALE_QA_BASE`）与 `FAILED` 类错误立即结束；其后的架构检查、QA 文档/projectChecks、测试范围证据、业务验收门禁一次全部执行，每个阻断输出 `QA_VERIFY_BLOCK=<代码>|<摘要>`。多个阻断时 `REASON=` 取第一个，`SUMMARY=` 以「N 项门禁阻断」开头并点名全部代码，`NEXT_ACTION=` 逐个代码列出处理；单个阻断时结果块不变。
- `TEST_SCOPE_RESULT.checks[].evidence` 写成 `evidence/<name>.log sha256=<hex>`（即 `task exec` 输出的 `LOG_PATH`/`LOG_SHA256`）时，`qa verify` 会核对当前任务 `evidence/` 目录下该文件存在且 SHA256 一致，缺失或不符按 `TEST_SCOPE_EVIDENCE` 阻断；其他写法只做结构校验，旧任务记录不受影响。

### 2. QA 文档完整性检查
检查 QA 文档的章节完整性、Test Case ID 格式、缺陷 ID 规范、Given-When-Then 格式。

```bash
pnpm run qa:lint
```

**检查项**：
- ✅ 主 QA 必需章节完整性
- ✅ 模块 QA 结构规范
- ✅ Test Case ID 格式规范（TC-MODULE-NNN）
- ⚠️ TC 引用写法：主/模块 QA、主/模块 PRD 与追溯矩阵中的区间（`TC-X-001~005`）和子编号（`TC-X-035-A`）输出 `TC_ID_NONCANONICAL=<文件>:<行> <写法>`，只警告、不改变退出码
- ✅ 缺陷 ID 格式规范（BUG-MODULE-NNN）
- ✅ Given-When-Then 格式验证
- ✅ 测试优先级标记（P0/P1/P2）
- ✅ Story ID 关联完整性

**示例输出**：
```
============================================================
QA 文档完整性检查工具 v1.0
============================================================

✅ 主 QA 存在: /docs/QA.md
✅ 全局追溯矩阵存在: /docs/data/traceability-matrix.md

📋 检查主 QA 章节完整性...
✅ 主 QA 包含所有必需章节

🔍 检查模块 QA 文档...
✅ 找到 3 个模块 QA 文档:
   - /docs/qa-modules/user-management/QA.md
   - /docs/qa-modules/payment-system/QA.md
   - /docs/qa-modules/notification/QA.md

🔍 检查 Test Case ID 格式规范...
✅ 所有 Test Case ID 格式规范（共 115 个）

🔍 检查缺陷 ID 格式规范...
✅ 所有缺陷 ID 格式规范（共 25 个）

🔍 检查 Given-When-Then 格式...
⚠️  发现 5 个测试用例未使用 Given-When-Then 格式:
   - TC-PAY-012: 支付失败重试 — 缺少 Given 前置条件
   - TC-PAY-018: 订单超时取消 — 缺少 When 触发动作
   - TC-NOTIF-010: 推送通知 — 缺少 Then 预期结果
   - TC-USER-025: 用户头像上传 — 缺少完整的 Given-When-Then
   - TC-ADMIN-005: 权限管理 — 缺少 Given 前置条件

🔍 检查 Story ID 关联...
⚠️  发现 3 个测试用例未关联 Story ID:
   - TC-PAY-030: 支付回调处理
   - TC-NOTIF-015: 邮件通知重试
   - TC-ADMIN-008: 审计日志查询

============================================================
检查结果汇总:
============================================================
⚠️  发现 8 个警告，建议修正。
```

---

### 3. 测试覆盖率分析
基于追溯矩阵，分析需求覆盖率（Story → Test Case 映射完整性）。

```bash
pnpm run qa:coverage-report
```

**检查项**：
- ✅ 解析 PRD 中的所有 Story ID
- ✅ 解析 QA 文档中的所有 Test Case ID
- ✅ 分析追溯矩阵（Story → AC → Test Case）
- ✅ 统计需求覆盖率（按模块、按优先级）
- ✅ 识别未覆盖的 Story（Missing Test Cases）
- ✅ 识别孤儿测试用例（无对应 Story）

**示例输出**：
```
============================================================
测试覆盖率分析工具 v1.0
============================================================

📖 解析 PRD 中的 Story ID...
✅ 找到 45 个用户故事

📖 解析 QA 文档中的 Test Case ID...
✅ 找到 115 个测试用例

📖 解析追溯矩阵...
✅ 追溯矩阵存在: /docs/data/traceability-matrix.md
📊 映射关系数: 42 个 Story → 112 个 Test Case

🔍 分析需求覆盖率...

📊 按模块统计:
| 模块 | 总 Story 数 | 已覆盖 Story | 覆盖率 | 未覆盖 Story |
|------|-----------|------------|---------|------------|
| user-management | 15 | 15 | 100% ✅ | - |
| payment-system | 20 | 18 | 90% ⚠️ | US-PAY-012, US-PAY-018 |
| notification | 10 | 9 | 90% ⚠️ | US-NOTIF-010 |
| **总计** | **45** | **42** | **93%** | **3** |

📊 按优先级统计:
| 优先级 | 总 Story 数 | 已覆盖 Story | 覆盖率 |
|-------|-----------|------------|---------|
| P0 | 20 | 20 | 100% ✅ |
| P1 | 18 | 16 | 89% ⚠️ |
| P2 | 7 | 6 | 86% |

🔍 未覆盖 Story 列表（需补充测试用例）:
❌ US-PAY-012（P1）：支付失败重试
   - 关联 AC: AC-PAY-012-01, AC-PAY-012-02
   - 建议补充: 异常场景测试、重试逻辑测试

❌ US-PAY-018（P1）：订单超时取消
   - 关联 AC: AC-PAY-018-01
   - 建议补充: 定时任务测试、状态流转测试

❌ US-NOTIF-010（P2）：推送通知
   - 关联 AC: AC-NOTIF-010-01, AC-NOTIF-010-02
   - 建议补充: 移动端推送测试、失败重试测试

🔍 孤儿测试用例（无对应 Story，建议删除或关联）:
⚠️  TC-PAY-099: 支付网关健康检查
   - 未关联任何 Story ID
   - 建议: 关联到 US-PAY-001 或删除

⚠️  TC-NOTIF-088: 通知模板缓存
   - 未关联任何 Story ID
   - 建议: 关联到 US-NOTIF-002 或删除

⚠️  TC-ADMIN-077: 日志归档脚本
   - 未关联任何 Story ID
   - 建议: 关联到 US-ADMIN-005 或删除

============================================================
检查结果汇总:
============================================================
✅ 总体覆盖率: 93% (阈值: ≥ 85%)
⚠️  发现 3 个未覆盖 Story（其中 2 个 P1）
⚠️  发现 3 个孤儿测试用例

📝 报告已保存到: /docs/data/qa-reports/coverage-summary.md
```

---

### 4. PRD ↔ QA ID 同步验证
验证 QA 文档中引用的 Story ID 是否在 PRD 中存在，以及 PRD 中的 Story 是否都有对应测试用例。

```bash
pnpm run qa:sync-prd-qa-ids
```

**检查项**：
- ✅ 解析 PRD 中的所有 Story ID
- ✅ 解析 QA 文档中引用的所有 Story ID
- ✅ 验证 Story ID 有效性（QA 引用的 Story 是否存在）
- ✅ 检测孤儿 Story（PRD 有但 QA 未测试）
- ✅ 检测孤儿测试用例（QA 引用的 Story 不存在）

**示例输出**：
```
============================================================
PRD ↔ QA ID 同步验证工具 v1.0
============================================================

📖 解析 PRD 中的 Story ID...
✅ 找到 45 个用户故事:
   - user-management: 15 个
   - payment-system: 20 个
   - notification: 10 个

📖 解析 QA 文档中引用的 Story ID...
✅ 找到 42 个被测试的 Story

🔍 验证 Story ID 有效性...
✅ 所有 QA 文档中引用的 Story ID 都在 PRD 中存在

🔍 检测孤儿 Story（PRD 有但 QA 未测试）...
⚠️  发现 3 个孤儿 Story:
   - US-PAY-012（P1）：支付失败重试
     PRD: /docs/prd-modules/payment-system/PRD.md
     建议: 在 /docs/qa-modules/payment-system/QA.md 添加测试用例

   - US-PAY-018（P1）：订单超时取消
     PRD: /docs/prd-modules/payment-system/PRD.md
     建议: 在 /docs/qa-modules/payment-system/QA.md 添加测试用例

   - US-NOTIF-010（P2）：推送通知
     PRD: /docs/prd-modules/notification/PRD.md
     建议: 在 /docs/qa-modules/notification/QA.md 添加测试用例

🔍 检测孤儿测试用例（关联不存在的 Story）...
✅ 所有测试用例都关联到有效的 Story

🔍 检查 AC 覆盖率...
📊 解析所有 Story 的验收标准（AC）...
✅ 找到 128 个验收标准（AC）

📊 AC 覆盖率统计:
| 模块 | 总 AC 数 | 已测试 AC | 覆盖率 |
|------|---------|----------|--------|
| user-management | 42 | 42 | 100% ✅ |
| payment-system | 58 | 53 | 91% ⚠️ |
| notification | 28 | 26 | 93% |
| **总计** | **128** | **121** | **95%** |

⚠️  未测试的 AC（共 7 个）:
   - AC-PAY-012-01: 支付失败后自动重试 3 次
   - AC-PAY-012-02: 重试间隔指数退避
   - AC-PAY-018-01: 订单 30 分钟后自动取消
   - AC-NOTIF-010-01: 推送通知到用户设备
   - AC-NOTIF-010-02: 推送失败后进入重试队列
   - AC-NOTIF-015-01: 邮件发送失败重试 5 次
   - AC-NOTIF-015-02: 重试失败后记录告警日志

============================================================
检查结果汇总:
============================================================
⚠️  发现 3 个孤儿 Story（其中 2 个 P1）
⚠️  发现 7 个未测试的 AC

💡 建议:
   1. 优先补充 P1 Story 的测试用例（US-PAY-012, US-PAY-018）
   2. 确保所有 AC 都有对应的测试步骤
   3. 定期运行此脚本，保持 PRD ↔ QA 同步
```

---

### 5. 测试报告生成
汇总所有模块的测试执行结果，生成全局测试报告。

```bash
pnpm run qa:generate-test-report
```

**功能**：
- ✅ 扫描所有模块 QA 文档
- ✅ 解析测试执行记录
- ✅ 统计 Pass/Fail/Blocked 用例数
- ✅ 按模块/优先级分组统计
- ✅ 识别失败用例和阻塞用例
- ✅ 生成测试通过率趋势

**示例输出**：
```
============================================================
测试报告生成工具 v1.0
============================================================

📖 扫描模块 QA 文档...
✅ 找到 3 个模块 QA 文档

📊 解析测试执行记录...
✅ 解析完成

📋 全局测试执行汇总:

测试轮次: R3（2025-11-06）
测试环境: Staging

📊 按模块统计:
| 模块 | 总用例数 | Pass | Fail | Blocked | 通过率 | 状态 |
|------|---------|------|------|---------|--------|------|
| user-management | 35 | 35 | 0 | 0 | 100% | ✅ 通过 |
| payment-system | 52 | 48 | 3 | 1 | 92% | ⚠️  有失败 |
| notification | 28 | 26 | 2 | 0 | 93% | ⚠️  有失败 |
| **总计** | **115** | **109** | **5** | **1** | **95%** | **⚠️** |

📊 按优先级统计:
| 优先级 | 总用例数 | Pass | Fail | Blocked | 通过率 |
|-------|---------|------|------|---------|--------|
| P0 | 48 | 48 | 0 | 0 | 100% ✅ |
| P1 | 42 | 38 | 3 | 1 | 90% ⚠️ |
| P2 | 25 | 23 | 2 | 0 | 92% |

🔍 失败用例列表（需处理）:

❌ TC-PAY-012: 支付失败重试
   - Story ID: US-PAY-012
   - 优先级: P1
   - 失败原因: 重试逻辑未生效，只执行了 1 次
   - 关联缺陷: BUG-PAY-005（P0，In Progress）
   - 负责人: @dev-a
   - 预计修复: 2025-11-07

❌ TC-PAY-018: 订单超时取消
   - Story ID: US-PAY-018
   - 优先级: P1
   - 失败原因: 定时任务未触发，订单未自动取消
   - 关联缺陷: BUG-PAY-006（P0，In Progress）
   - 负责人: @dev-b
   - 预计修复: 2025-11-08

❌ TC-PAY-023: 订单并发创建
   - Story ID: US-PAY-015
   - 优先级: P1
   - 失败原因: 数据库死锁
   - 关联缺陷: BUG-PAY-007（P1，Open）
   - 负责人: @dev-c
   - 预计修复: 2025-11-09

❌ TC-NOTIF-010: 推送通知
   - Story ID: US-NOTIF-010
   - 优先级: P2
   - 失败原因: 推送服务响应超时（> 5s）
   - 关联缺陷: BUG-NOTIF-003（P1，In Progress）
   - 负责人: @dev-d
   - 预计修复: 2025-11-08

❌ TC-NOTIF-015: 邮件格式校验
   - Story ID: US-NOTIF-012
   - 优先级: P2
   - 失败原因: 邮件 HTML 模板渲染错误
   - 关联缺陷: BUG-NOTIF-004（P2，Open）
   - 负责人: @dev-e
   - 预计修复: 2025-11-10

🚧 阻塞用例列表（环境/依赖问题）:

⏸️  TC-PAY-030: 第三方支付网关集成
   - Story ID: US-PAY-020
   - 优先级: P1
   - 阻塞原因: 依赖第三方支付网关未就绪（沙盒环境维护中）
   - 预计解决: 2025-11-08
   - 负责人: @qa-a

📈 通过率趋势:
| 轮次 | 日期 | 总用例 | 通过率 | 趋势 |
|------|------|--------|--------|------|
| R3 | 2025-11-06 | 115 | 95% | ⬆️ +2% |
| R2 | 2025-11-05 | 115 | 93% | ⬆️ +5% |
| R1 | 2025-11-04 | 115 | 88% | - |

============================================================
检查结果汇总:
============================================================
✅ P0 用例全部通过（100%）
⚠️  5 个失败用例（其中 3 个 P1）
⚠️  1 个阻塞用例（P1）
📊 总体通过率: 95%（阈值: ≥ 90%）

💡 建议:
   1. 优先处理 3 个 P1 失败用例（BUG-PAY-005, BUG-PAY-006, BUG-PAY-007）
   2. 关注 1 个 P1 阻塞用例（TC-PAY-030）
   3. 通过率持续上升，测试质量改善明显

📝 报告已保存到:
   - /docs/data/qa-reports/test-execution-summary.md
   - /docs/data/qa-reports/test-execution-2025-11-06.json
```

---

### 6. 缺陷阻塞检查
扫描所有模块的缺陷列表，识别 P0/P1 阻塞性缺陷，生成发布门禁报告。

```bash
pnpm run qa:check-defect-blockers
```

**检查项**：
- ✅ 扫描所有模块 QA 的缺陷列表
- ✅ 按严重级别分类（P0/P1/P2）
- ✅ 按状态统计（Open/In Progress/Resolved/Closed）
- ✅ 识别阻塞性缺陷（P0 未关闭）
- ✅ 检查 NFR 达标情况
- ✅ 生成发布建议（Go/No-Go）

**示例输出**：
```
============================================================
缺陷阻塞检查工具 v1.0
============================================================

📖 扫描模块 QA 缺陷列表...
✅ 找到 3 个模块 QA 文档

📊 解析缺陷列表...
✅ 解析完成

📋 全局缺陷汇总:

更新时间: 2025-11-06 14:30:00

📊 按严重级别统计:
| 严重级别 | 总数 | Open | In Progress | Resolved | Closed | 状态 |
|---------|------|------|------------|---------|--------|------|
| P0（阻塞发布） | 2 | 0 | 2 | 0 | 0 | ❌ 阻塞 |
| P1（严重） | 8 | 1 | 5 | 2 | 0 | ⚠️  关注 |
| P2（一般） | 15 | 3 | 7 | 3 | 2 | ✅ 可控 |
| **总计** | **25** | **4** | **14** | **5** | **2** | - |

🚨 P0 缺陷列表（阻塞发布）:

❌ BUG-PAY-005: 支付失败重试逻辑未生效
   - 模块: payment-system
   - 影响 Story: US-PAY-012
   - 状态: In Progress
   - 负责人: @dev-a
   - 预计修复: 2025-11-07 18:00
   - 影响范围: 影响所有支付失败场景，用户无法自动重试
   - 风险: 高（核心支付功能）

❌ BUG-PAY-006: 订单超时定时任务未触发
   - 模块: payment-system
   - 影响 Story: US-PAY-018
   - 状态: In Progress
   - 负责人: @dev-b
   - 预计修复: 2025-11-08 12:00
   - 影响范围: 超时订单无法自动取消，占用库存
   - 风险: 中（影响订单管理，但可手动清理）

⚠️  P1 缺陷列表（需关注）:

⚠️  BUG-PAY-007: 订单并发创建时数据库死锁（Open）
   - 模块: payment-system
   - 影响 Story: US-PAY-015
   - 负责人: @dev-c
   - 预计修复: 2025-11-09

⚠️  BUG-NOTIF-003: 推送服务响应超时（In Progress）
   - 模块: notification
   - 影响 Story: US-NOTIF-010
   - 负责人: @dev-d
   - 预计修复: 2025-11-08

⚠️  BUG-USER-003: 密码重置邮件延迟 > 5 分钟（In Progress）
   - 模块: user-management
   - 影响 Story: US-USER-008
   - 负责人: @dev-e
   - 预计修复: 2025-11-09

... (省略其他 5 个 P1 缺陷)

📊 按模块统计:
| 模块 | P0 | P1 | P2 | 总计 | 状态 |
|------|----|----|----|----- |------|
| user-management | 0 | 2 | 5 | 7 | ✅ 无阻塞 |
| payment-system | 2 | 5 | 8 | 15 | ❌ 阻塞发布 |
| notification | 0 | 1 | 2 | 3 | ✅ 无阻塞 |

🔍 检查 NFR 达标情况...
📖 读取 NFR 追踪表: /docs/data/nfr-tracking.md
⚠️  发现 1 项 NFR 未达标:
   - NFR-PAY-PERF-001: 订单创建 P95 响应时间 > 1s（当前 1.2s）
   - 目标值: < 1s
   - 当前值: 1.2s
   - 状态: ❌ 未达标

============================================================
发布门禁检查:
============================================================

🚨 阻塞性问题（必须解决才能发布）:
   ❌ 2 个 P0 缺陷未关闭
   ❌ 1 项 NFR 未达标

⚠️  警告项（建议解决，可延后）:
   ⚠️  1 个 P1 缺陷未修复（BUG-PAY-007）
   ⚠️  5 个 P1 缺陷修复中

✅ 通过项:
   ✅ 需求覆盖率 93%（阈值: ≥ 85%）
   ✅ 测试通过率 95%（阈值: ≥ 90%）
   ✅ P0 缺陷全部修复中（无 Open 状态）

============================================================
发布建议:
============================================================
❌ **不建议发布**

阻塞原因:
   1. 2 个 P0 缺陷未关闭（BUG-PAY-005, BUG-PAY-006）
   2. 1 项 NFR 未达标（订单创建性能）

建议行动:
   1. 等待 BUG-PAY-005、BUG-PAY-006 修复并验证通过
   2. 优化订单创建性能，使 P95 响应时间 < 1s
   3. 预计最早发布时间: 2025-11-09

可接受风险（如强行发布）:
   - P1 缺陷影响用户体验，但不阻塞核心功能
   - 性能问题可通过后续版本优化
   - 建议延后发布，确保质量

📝 发布门禁报告已保存到:
   /docs/data/qa-reports/release-gate-2025-11-06.md
```

### 7. 业务测试自动化（`qa paths` / `qa run` / 业务验收门禁）

面向有页面或客户端界面的功能域：PRD 原子 AC 表是唯一规格来源，界面状态、操作路径与用例由模型在创建阶段推导和编写，脚本只做确定性的校验、运行、绑定与把关。预言机来源、路径推导、覆盖准则、用例预算与刷新策略见 [QA Playbook「业务测试自动化」](../../AgentRoles/Handbooks/QA-TESTING-EXPERT.playbook.md)。

```bash
# 只读：校验原子 AC 表与 docs/qa-modules/<domain>/PATHS.md，输出 AC/路径追溯矩阵
pnpm agent -- qa paths

# 运行 agent.config.json 的 qa.business.suites，把 JUnit XML 报告绑定到 AC/TC/路径
pnpm agent -- qa run
```

说明：
- `qa paths` 不创建目录、不运行测试；存在违规时 `STATUS=BLOCKED` 且退出码非零，逐条输出 `VIOLATION=<code>|<位置>|<说明>`，并给出 `MATRIX_AC=`、`MATRIX_PATH=` 追溯行。
- `qa run` 逐个套件运行命令（在仓库根目录经 shell 执行），读取各套件的 JUnit XML；测试名须携带 AC/TC 标识才能绑定到原子 AC。结果写入容器 `tmp/qa-business-results/<工作区标识>/ac-results.json`，绑定当前 HEAD、配置摘要与报告 SHA256，并输出 `SUITE=` 行与 `RESULTS_FILE=`。该命令不受 `qa.business.enabled` 影响。
- `qa run` 的 `STATUS=OK` 表示套件都正常完成，且 `requiredPriorities` 内的 `auto` AC 全部有通过的用例。套件失败时 `STATUS=FAILED`、`REASON=SUITE_FAILED`；套件都正常完成、但必需优先级的 `auto` AC 仍有未证明的（缺用例、用例被跳过、声明的端没有套件覆盖），逐条输出 `AC_OPEN=<AC>|<优先级>|<状态>|<原因>`，并以 `STATUS=FAILED`、`REASON=AC_NOT_PROVEN`、非零退出码结束。两种 FAILED 都照常写出结果文件（`SUITE_FAILED` 优先，不叠加第二个原因）；判定与 `qa verify` 的业务验收门禁共用同一函数，所以 `qa run` 通过的结果在验收一项上不会被 `qa verify` 推翻。`STATUS=BLOCKED` 仍表示运行前就被拒绝（配置非法、没有套件、规格违规、仓库无提交、报告路径不安全），此时没有运行任何套件、也没有写结果。
- `qa verify` 的业务验收门禁放行并签发回执时，回执附带一个可选的 `business` 摘要：`gate`（固定为 `PASS`）、`required_priorities`、`acs_proven`（本次必需优先级内已证明的自动化 AC 条数）、`risk_count`（披露的 `BUSINESS_RISK=` 项数）与 `config_digest`（套件配置摘要）。门禁未启用时回执不带该字段；`schema_version` 仍为 1，`qa merge` 的复验只比对 `schema_version`、`verdict`、base/branch、两端 SHA 与 PR 引用，不读取 `business`，新旧回执互相兼容。
- `task exec` 的测试范围护栏拦截 `pnpm exec playwright test` 这类无目标文件的聚合命令（见 `docs/CONVENTIONS.md` §8）。登记在 `qa.business.suites[].command` 的命令例外：与登记原文逐词相同时放行，便于把 `qa run` 将要运行的同一条套件命令也落成任务证据。登记命令里含引号、变量、管道、重定向、通配符等需要 shell 解释的词时不参与匹配；加了包装器（`sh -c …`）或改了任何参数的变体、`qa.business` 配置无效时，都按原规则拦截。`pnpm agent -- test --file <文件> -- <运行器>` 对同一批登记命令同样放行：只校验文件，并把文件原样追加到命令末尾，所以登记的套件命令须能接受末尾的文件参数；未登记命令仍只接受既有的文件级运行器。
- 须在最后一次提交之后运行，且工作区干净：报告、截图等驱动产物请加入 `.gitignore`，否则门禁报 `RESULTS_DIRTY_WORKTREE`；运行之后再提交则报 `RESULTS_STALE_HEAD`。
- `qa.business.enabled=true`（默认 `false`）时，`qa verify` 在测试范围校验之后、签发回执之前运行业务验收门禁：输出 `BUSINESS_GATE=PASS|BLOCKED`，阻断项为 `BUSINESS_BLOCK=`，风险项为 `BUSINESS_RISK=`；阻断时不签发回执。官方息壤源自身不启用该门禁。

配置示例（写入项目 `agent.config.json`，只保存与默认值不同的键）：

```json
{
  "qa": {
    "business": {
      "enabled": true,
      "requiredPriorities": ["P0"],
      "suites": [
        {
          "name": "web-e2e",
          "platform": "web",
          "command": "pnpm exec playwright test",
          "report": "reports/business/web-e2e.xml",
          "timeoutSeconds": 900
        }
      ]
    }
  }
}
```

---

## 📋 所有可用命令

### QA 核心检查（优先级 ⭐⭐⭐）
| 命令 | 说明 | 优先级 |
|------|------|--------|
| `pnpm run qa:lint` | QA 文档完整性检查 | ⭐⭐⭐ |
| `pnpm run qa:coverage-report` | 测试覆盖率分析 | ⭐⭐⭐ |
| `pnpm run qa:sync-prd-qa-ids` | PRD ↔ QA ID 同步验证 | ⭐⭐⭐ |
| `pnpm run qa:check-defect-blockers` | 缺陷阻塞检查 | ⭐⭐⭐ |
| `pnpm run qa:generate-test-report` | 测试报告生成 | ⭐⭐⭐ |

### 业务测试自动化（可选，启用 `qa.business` 时）
| 命令 | 说明 | 优先级 |
|------|------|--------|
| `pnpm agent -- qa paths` | 校验原子 AC 表与 `PATHS.md`，输出 AC/路径追溯矩阵（只读）；含 `auto` AC 的域缺少 `PATHS.md` 时输出 `VIOLATION=PATHS_MISSING` 并退出 1 | ⭐⭐ |
| `pnpm agent -- qa run` | 运行 `qa.business.suites`，把报告绑定到原子 AC/TC/路径并写入结果文件 | ⭐⭐ |

---

## 🔧 集成到工作流

### 本地开发
在提交 QA 变更前运行：

```bash
pnpm run qa:lint && pnpm run qa:sync-prd-qa-ids
```

### 测试执行后
每次测试轮次完成后运行：

```bash
pnpm run qa:generate-test-report && pnpm run qa:coverage-report
```

### 发布前检查
在发布前运行完整的质量门禁：

```bash
pnpm run qa:check-defect-blockers
```

### 本地 QA 与合并门禁

本模板的 TDD、QA 与合并门禁完全在执行者电脑上运行，不创建、修改、触发或依赖 GitHub CI、required checks 或 `.github/workflows`。工作流目录属于实际项目，模板更新保持其内容不变。

```bash
pnpm agent -- qa plan
pnpm agent -- qa verify
pnpm agent -- qa merge
```

`qa verify` 通过后会在当前电脑原子写入绑定配置主干、功能分支、`BASE_SHA` 和 `HEAD_SHA` 的回执（启用业务验收门禁时另带一个 `business` 摘要，仅作审计记录，见第 7 节）。`qa merge` 会重新 fetch，并把回执与 PR base/head refs、远端引用逐项复验；任一 SHA 漂移、冲突或主干非快进拒绝都会停止合并并保留恢复状态。回执不跨电脑共享：换电脑合并时，在该电脑重新执行 `qa verify` 即可，不需要专用 QA 电脑或账号。

`qa plan` 与 `qa verify` 都以 `STATUS=`、`SUMMARY=`、`NEXT_ACTION=` 三行结束，非 OK 时另给 `REASON=<code>`，退出码非零；执行器按 `NEXT_ACTION` 行动即可，不必从堆栈推断原因，代码清单见上文第 0、1 节与 Playbook §qa verify 阻断码。

启用 `qa.business` 的项目在 `qa verify` 之前依次运行 `pnpm agent -- qa paths` 与 `pnpm agent -- qa run`（见上文第 7 节）；业务验收门禁同样只在本机运行，结果不跨电脑共享，换电脑后须重新 `qa run`。

---

## 📊 脚本状态

| 脚本 | 状态 | 版本 | 说明 |
|------|------|------|------|
| qa-lint.js | ✅ 已实现 | v1.0 | QA 文档完整性检查 |
| check-test-coverage.js | ✅ 已实现 | v1.0 | 测试覆盖率分析 |
| sync-prd-qa-ids.js | ✅ 已实现 | v1.0 | PRD ↔ QA ID 同步验证 |
| generate-test-report.js | ✅ 已实现 | v1.0 | 测试报告生成 |
| check-defect-blockers.js | ✅ 已实现 | v1.0 | 缺陷阻塞检查 |
| business-spec.js | ✅ 已实现 | v1.0 | 解析 PRD 原子 AC 表与 `PATHS.md`（`qa paths`、`qa run`、门禁共用）；`parsePrdStories` 同时供 `qa:generate` 与 `qa verify` 的 Story 清单使用 |
| qa-paths.js | ✅ 已实现 | v1.1 | `pnpm agent -- qa paths`：规格校验与追溯矩阵；含 `auto` AC 的域缺少 `PATHS.md` 时报 `PATHS_MISSING` |
| business-config.js | ✅ 已实现 | v1.0 | 解析并校验 `qa.business` 配置 |
| qa-run.js | ✅ 已实现 | v1.0 | `pnpm agent -- qa run`：运行套件、解析 JUnit XML、写入结果；必需优先级的自动化 AC 未证明时 `FAILED(AC_NOT_PROVEN)` |
| business-results.js | ✅ 已实现 | v1.1 | 把用例绑定到 AC/TC/路径并判定验收；测试名显式带 AC ID 时只绑定该 AC，不再按 TC 扩散到同 TC 的其他 AC |
| qa-business-gate.js | ✅ 已实现 | v1.0 | `qa verify` 的业务验收门禁 |

---

## 🛠️ 开发新脚本

### 脚本模板

```javascript
#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// 颜色输出工具
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// 读取文件工具
function readFile(filePath) {
  const fullPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`文件不存在: ${filePath}`);
  }
  return fs.readFileSync(fullPath, 'utf-8');
}

// 主函数
function main() {
  log('='.repeat(60), 'cyan');
  log('工具名称 v1.0', 'cyan');
  log('='.repeat(60), 'cyan');

  // 你的逻辑...

  log('\n' + '='.repeat(60), 'cyan');
  log('检查结果汇总:', 'cyan');
  log('='.repeat(60), 'cyan');
  log('✅ 检查完成', 'green');

  process.exit(0);
}

// 运行
if (require.main === module) {
  try {
    main();
  } catch (error) {
    log(`\n❌ 执行出错: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  }
}
```

### 添加到 package.json

```json
{
  "scripts": {
    "qa:your-command": "node infra/scripts/qa-tools/your-script.js"
  }
}
```

---

## ❓ 常见问题

### Q1: 脚本执行报错 "Permission denied"
**A**: 赋予执行权限：
```bash
chmod +x infra/scripts/qa-tools/*.js
```

### Q2: 覆盖率分析结果不准确？
**A**: 确保：
1. 追溯矩阵（`/docs/data/traceability-matrix.md`）及时更新
2. 所有测试用例都正确关联 Story ID
3. PRD 中的 Story ID 格式规范（`US-MODULE-NNN`）

### Q3: 如何自定义检查规则？
**A**: 编辑对应脚本的配置部分。例如在 `qa-lint.js` 中修改 `REQUIRED_SECTIONS` 数组，自定义必需章节。

### Q4: 测试报告生成失败？
**A**: 检查：
1. 模块 QA 文档是否存在（`/docs/qa-modules/{domain}/QA.md`）
2. 测试执行记录章节是否存在
3. Test Case ID 格式是否规范（`TC-MODULE-NNN`）

### Q5: 能否在 Windows 上运行？
**A**: 可以。脚本使用纯 JavaScript 编写，跨平台兼容。但颜色输出在 Windows CMD 中可能显示异常（PowerShell 和 Windows Terminal 正常）。

### Q6: 如何与 PRD/TASK 工具联动？
**A**: 使用 `pnpm run qa:sync-prd-qa-ids` 可自动验证 PRD 中的 Story ID 与 QA 中的测试用例映射关系。确保需求追溯完整。

### Q7: 发布门禁报告的判断标准是什么？
**A**: 阻塞发布条件：
- 存在未关闭的 P0 缺陷
- 关键 NFR 未达标（性能、安全）
- P0 用例通过率 < 100%
- 总体通过率 < 90%

### Q8: 业务验收门禁报 `RESULTS_DIRTY_WORKTREE` 或 `RESULTS_STALE_HEAD`？
**A**: 结果文件绑定运行时的 HEAD 与工作区状态：
1. `RESULTS_DIRTY_WORKTREE`：`qa run` 时工作区有未提交改动，常见原因是报告被跟踪或未忽略。把报告输出路径加入 `.gitignore`（已跟踪的先 `git rm --cached`），提交其余改动后重新运行 `pnpm agent -- qa run`
2. `RESULTS_STALE_HEAD`：运行之后又有新提交，在最后一次提交之后重新运行 `pnpm agent -- qa run`
3. 其余阻断码与风险码的含义和处理见 QA Playbook「业务测试自动化」一章的速查表

---

## 📚 参考资料

- [QA-TESTING-EXPERT Playbook](../../AgentRoles/Handbooks/QA-TESTING-EXPERT.playbook.md)
- [AGENTS.md](../../AGENTS.md) - Phase 5: QA 专家
- [CONVENTIONS.md](../../docs/CONVENTIONS.md) - QA 模块化规范
- [STRUCTURE-GUIDE.md](../../docs/qa-modules/STRUCTURE-GUIDE.md) - QA 模块内部结构指南
- [traceability-matrix.md](../../docs/data/traceability-matrix.md) - 全局追溯矩阵

---

> 这些脚本持续改进中。欢迎提交 Issue 或 PR 贡献新功能！
