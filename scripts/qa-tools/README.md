# QA 工具脚本使用说明

> 这些脚本用于自动化 QA 质量检查、测试覆盖率分析、缺陷追踪、发布门禁验证等任务，提升测试管理效率。

---

## 📦 安装

本工具脚本使用 Node.js 编写，无需额外依赖。

```bash
# 确保已安装 Node.js (推荐 v16+)
node --version

# 赋予脚本执行权限（Unix/Mac）
chmod +x scripts/qa-tools/*.js
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

### 1. QA 文档完整性检查
检查 QA 文档的章节完整性、Test Case ID 格式、缺陷 ID 规范、Given-When-Then 格式。

```bash
pnpm run qa:lint
```

**检查项**：
- ✅ 主 QA 必需章节完整性
- ✅ 模块 QA 结构规范
- ✅ Test Case ID 格式规范（TC-MODULE-NNN）
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

### 2. 测试覆盖率分析
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

### 3. PRD ↔ QA ID 同步验证
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

### 4. 测试报告生成
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

### 5. 缺陷阻塞检查
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

### CI/CD 集成
在 `.github/workflows/qa-validation.yml` 中添加：

```yaml
name: QA Quality Gate

on:
  pull_request:
    paths:
      - 'docs/QA.md'
      - 'docs/qa-modules/**'
      - 'docs/data/traceability-matrix.md'

jobs:
  qa-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Run QA Lint
        run: pnpm run qa:lint

      - name: Check Test Coverage
        run: pnpm run qa:coverage-report

      - name: Verify PRD ↔ QA Sync
        run: pnpm run qa:sync-prd-qa-ids

      - name: Check Defect Blockers
        run: pnpm run qa:check-defect-blockers
```

### 定时任务（每日聚合）
在 `.github/workflows/qa-daily-report.yml` 中添加：

```yaml
name: QA Daily Report

on:
  schedule:
    # 每天早上 8:00 运行
    - cron: '0 0 * * *'
  workflow_dispatch: # 允许手动触发

jobs:
  daily-report:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Generate Test Report
        run: pnpm run qa:generate-test-report

      - name: Generate Coverage Report
        run: pnpm run qa:coverage-report

      - name: Check Defect Status
        run: pnpm run qa:check-defect-blockers

      - name: Commit Reports
        run: |
          git config user.name "GitHub Actions"
          git config user.email "actions@github.com"
          git add docs/data/qa-reports/
          git commit -m "chore: 更新每日 QA 报告 $(date +'%Y-%m-%d')" || echo "No changes"
          git push
```

---

## 📊 脚本状态

| 脚本 | 状态 | 版本 | 说明 |
|------|------|------|------|
| qa-lint.js | ✅ 已实现 | v1.0 | QA 文档完整性检查 |
| check-test-coverage.js | ✅ 已实现 | v1.0 | 测试覆盖率分析 |
| sync-prd-qa-ids.js | ✅ 已实现 | v1.0 | PRD ↔ QA ID 同步验证 |
| generate-test-report.js | ✅ 已实现 | v1.0 | 测试报告生成 |
| check-defect-blockers.js | ✅ 已实现 | v1.0 | 缺陷阻塞检查 |

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
    "qa:your-command": "node scripts/qa-tools/your-script.js"
  }
}
```

---

## ❓ 常见问题

### Q1: 脚本执行报错 "Permission denied"
**A**: 赋予执行权限：
```bash
chmod +x scripts/qa-tools/*.js
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

---

## 📚 参考资料

- [QA-TESTING-EXPERT Playbook](../../AgentRoles/Handbooks/QA-TESTING-EXPERT.playbook.md)
- [AGENTS.md](../../AGENTS.md) - Phase 5: QA 专家
- [CONVENTIONS.md](../../docs/CONVENTIONS.md) - QA 模块化规范
- [STRUCTURE-GUIDE.md](../../docs/qa-modules/STRUCTURE-GUIDE.md) - QA 模块内部结构指南
- [traceability-matrix.md](../../docs/data/traceability-matrix.md) - 全局追溯矩阵

---

> 这些脚本持续改进中。欢迎提交 Issue 或 PR 贡献新功能！
